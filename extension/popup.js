const TIERS = { FREE: 0, PRO: 10, PRO_WEB: 20, PRO_WEB_ALERTS: 30 };
let userLevel = 0;
let lastScanTime = 0;

document.addEventListener("DOMContentLoaded", () => {
  // Load license first, then data
  chrome.runtime.sendMessage({ type: "GET_LICENSE" }, (resp) => {
    userLevel = resp?.license?.level || 0;
    loadData();
    renderLicenseSection(resp?.license);
  });

  // Read max_picks from scan_config (fetched from GitHub by background.js)
  chrome.storage.local.get("scanConfig", (data) => {
    if (typeof data.scanConfig?.max_picks === "number") {
      maxPicks = data.scanConfig.max_picks;
    }
  });

  // Check for updates
  checkForUpdate();

  // Tab switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.style.display = p.id === `tab-${target}` ? "" : "none";
      });
      if (target === "alerts") renderAlertsTab();
      if (target === "insights") renderInsightsTab();
    });
  });

  // Listen for live updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DATA_UPDATED") {
      loadData();
    }
    if (message.type === "SCAN_PROGRESS") {
      updateScanProgress(message.performanceId, message.completed, message.total, message.status, message.eta);
    }
    if (message.type === "LICENSE_CHANGED") {
      chrome.runtime.sendMessage({ type: "GET_LICENSE" }, (resp) => {
        userLevel = resp?.license?.level || 0;
        renderLicenseSection(resp?.license);
        lastMatchName = null;
        loadData();
      });
    }
  });

  // Block toggle
  document.getElementById("blockToggle").addEventListener("click", () => {
    const body = document.getElementById("blockBody");
    const chevron = document.querySelector("#blockToggle .chevron");
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "block";
    chevron.classList.toggle("open", !isOpen);
  });

  // License toggle
  document.getElementById("licenseToggle").addEventListener("click", () => {
    const body = document.getElementById("licenseBody");
    const chevron = document.querySelector("#licenseToggle .chevron");
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "block";
    chevron.classList.toggle("open", !isOpen);
  });

  // Scan all sections
  document.getElementById("scanBtn").addEventListener("click", startScan);

  // Export CSV
  document.getElementById("exportBtn").addEventListener("click", exportCSV);

  // Clear data
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (confirm("Clear all captured data?")) {
      chrome.runtime.sendMessage({ type: "CLEAR_DATA" }, () => {
        loadData();
      });
    }
  });

});

async function getCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || "";
  } catch { return ""; }
}

function siteFromUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes("-shop-")) return "lms";
    if (h.includes("-resale-")) return "resale";
  } catch {}
  return "resale";
}

function loadData() {
  getCurrentTabUrl().then((url) => {
    const isFifaSite = /\.tickets\.fifa\.com/.test(url);
    const isSeatMap = isFifaSite && (/perfId=/.test(url) || /\/seat\//.test(url) || /\/performance\/\d+/.test(url));

    chrome.storage.local.get(null, (data) => {
      if (chrome.runtime.lastError || !data?.games) {
        showEmpty(isFifaSite, isSeatMap);
        return;
      }

      const games = data.games;
      const gameKeys = Object.keys(games);

      if (gameKeys.length === 0) {
        showEmpty(isFifaSite, isSeatMap);
        return;
      }

      // Detect site + perfId from the active tab URL
      const tabSite = siteFromUrl(url);
      const perfIdMatch = url.match(/perfId=(\d+)/) || url.match(/\/performance\/(\d+)/);
      const tabPerfId = perfIdMatch ? perfIdMatch[1] : null;

      // Try compound key matching: preferred site first, then other site, then first cached
      let activeKey = null;
      if (tabPerfId) {
        const preferred = `${tabSite}:${tabPerfId}`;
        const other = `${tabSite === "lms" ? "resale" : "lms"}:${tabPerfId}`;
        if (games[preferred]) activeKey = preferred;
        else if (games[other]) activeKey = other;
      }
      // Backward-compat: try bare perfId (pre-migration)
      if (!activeKey && tabPerfId && games[tabPerfId]) {
        activeKey = tabPerfId;
      }
      if (!activeKey) activeKey = gameKeys[0];

      const game = games[activeKey];

      if (!game || Object.keys(game.seats || {}).length === 0) {
        showEmpty(isFifaSite, isSeatMap);
        return;
      }

      // Restore persisted filters
      if (data.filters) {
        activeCatIndex = data.filters.activeCatIndex ?? -1;
        selectedTogether = new Set(data.filters.selectedTogether ?? [1, 2, 3, 4, 5, 6]);
      }

      currentPerfId = activeKey;
      currentSite = game.site || "resale";
      renderDashboard(game);
    });
  });
}

function showEmpty(isFifaSite, isSeatMap) {
  document.getElementById("noData").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("liveBadge").style.display = "none";

  const title = document.getElementById("emptyTitle");
  const hint = document.getElementById("emptyHint");
  const action = document.getElementById("emptyAction");
  const scanningHelp = document.getElementById("scanningHelp");

  if (isSeatMap) {
    title.textContent = "Scanning\u2026";
    hint.textContent = "Capturing seat data from the map. This usually takes a few seconds.";
    action.style.display = "none";
    scanningHelp.style.display = "block";
  } else if (isFifaSite) {
    title.textContent = "Open a seat map";
    hint.textContent = "You\u2019re on the FIFA ticket site \u2014 select a match and open its seat map to start capturing prices.";
    action.style.display = "none";
    scanningHelp.style.display = "none";
  } else {
    title.textContent = "FIFA Ticket Scout";
    hint.textContent = "Open the FIFA resale or LMS ticket site and browse a seat map to start capturing prices.";
    action.textContent = "Open Resale Site";
    action.style.display = "";
    action.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "https://fwc26-resale-usd.tickets.fifa.com" });
    };
    // Show LMS button
    const lmsBtn = document.getElementById("emptyActionLms");
    if (lmsBtn) {
      lmsBtn.style.display = "";
      lmsBtn.onclick = (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: "https://fwc26-shop-usd.tickets.fifa.com" });
      };
    }
    scanningHelp.style.display = "none";
  }
}

function renderDashboard(game) {
  document.getElementById("noData").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("liveBadge").style.display = "inline-flex";

  // Restore scan time from storage
  if (!lastScanTime) {
    chrome.storage.local.get("lastScanTime", (d) => {
      lastScanTime = d.lastScanTime || 0;
      updateScanAgo();
    });
  }

  const seats = Object.values(game.seats || {}).filter(s => s.exclusive !== false && s.price != null);
  const match = game.match;

  renderMatchInfo(match);
  renderStatsBar(seats);
  renderCategorySections(seats);
  renderBlockTable(seats);
}

// --- Match Info ---

function scanSpeedHtml() {
  const locked = userLevel < TIERS.PRO;
  const lock = '<span class="lock-icon">&#x1F512;</span>';

  function speedBtn(speed, emoji, title) {
    const isLocked = locked && speed !== "balanced";
    const cls = isLocked ? "speed-btn locked" : "speed-btn";
    const suffix = isLocked ? " (Pro)" : "";
    return `<button class="${cls}" data-speed="${speed}" title="${title}${suffix}">${emoji}${isLocked ? lock : ""}</button>`;
  }

  return `<div class="scan-speed-container">
    <span class="scan-speed-title">Scan</span>
    <div class="scan-speed-btns" id="scanSpeedBtns">
      ${speedBtn("stealth", "&#x1F422;", "Stealth &#8212; Looks like a human casually browsing. Lowest detection risk.")}
      ${speedBtn("cautious", "&#x1F6B6;", "Cautious &#8212; Slower, good for accounts with tickets you can't afford to lose.")}
      ${speedBtn("balanced", "&#x2696;&#xFE0F;", "Balanced &#8212; Good mix of speed and safety. Recommended.")}
      ${speedBtn("aggressive", "&#x1F525;", "Aggressive &#8212; Fastest scan. Higher detection risk.")}
    </div>
    <div class="scan-pill" id="scanPill"><div class="scan-pill-bar"><div class="scan-pill-fill" id="scanPillFill"></div></div><span class="scan-pill-text" id="scanPillText"></span></div>
  </div>`;
}

let lastMatchName = null;

function renderMatchInfo(match) {
  const el = document.getElementById("matchInfo");

  // Skip re-render if match info hasn't changed (avoids pill/speed flicker)
  if (el.children.length > 0 && (match?.name ?? null) === lastMatchName) return;
  lastMatchName = match?.name ?? null;

  if (match?.name) {
    const parts = match.name.split(" / ");
    const matchNum = parts[1] || "";
    const teams = parts[2] || match.name;
    const venue = parts[3] || "";
    const date = match.date ? formatDate(match.date) : "";

    const siteBadge = `<span class="site-badge site-${currentSite}">${currentSite === "lms" ? "LMS" : "Resale"}</span>`;
    el.innerHTML = `
      <div class="match-top-row">
        <div class="match-teams">${escapeHtml(teams)} ${siteBadge}</div>
        ${scanSpeedHtml()}
      </div>
      <div class="match-meta">
        ${matchNum ? `<span>${escapeHtml(matchNum)}</span>` : ""}
        ${matchNum && venue ? `<span class="sep">&middot;</span>` : ""}
        ${venue ? `<span>${escapeHtml(venue)}</span>` : ""}
        ${(matchNum || venue) && date ? `<span class="sep">&middot;</span>` : ""}
        ${date ? `<span>${escapeHtml(date)}</span>` : ""}
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="match-top-row">
        <div class="match-teams">Match data loading&hellip;</div>
        ${scanSpeedHtml()}
      </div>
      <div class="match-meta">Browse the seat map to capture match info</div>
    `;
  }
  initSpeedButtons();
  restorePillProgress();
}

let lastPillPct = 0;
let scanStartTime = 0;
let scanElapsed = 0;
let currentPerfId = null;
let currentSite = "resale";

function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  return Math.ceil(s / 2) * 2 + "s";
}

function restorePillProgress() {
  const fill = document.getElementById("scanPillFill");
  const text = document.getElementById("scanPillText");
  const pct = lastPillPct > 0 ? lastPillPct : 100;
  if (fill) fill.style.width = pct + "%";
  if (text && scanElapsed > 0) {
    text.textContent = formatElapsed(scanElapsed);
  }
}

// --- Stats Bar ---

let cachedScanSpeed = null;

function initSpeedButtons() {
  const container = document.getElementById("scanSpeedBtns");
  if (!container || container.dataset.listenersAttached) return;
  container.dataset.listenersAttached = "1";
  const btns = container.querySelectorAll(".speed-btn");
  const apply = (speed) => {
    btns.forEach((b) => b.classList.toggle("active", b.dataset.speed === speed));
  };
  if (cachedScanSpeed) {
    // Clamp if user was Pro but downgraded
    if (cachedScanSpeed !== "balanced" && userLevel < TIERS.PRO) {
      cachedScanSpeed = "balanced";
      chrome.storage.local.set({ scanSpeed: cachedScanSpeed });
    }
    apply(cachedScanSpeed);
  } else {
    chrome.storage.local.get("scanSpeed", (data) => {
      cachedScanSpeed = data.scanSpeed || "balanced";
      if (cachedScanSpeed !== "balanced" && userLevel < TIERS.PRO) {
        cachedScanSpeed = "balanced";
        chrome.storage.local.set({ scanSpeed: cachedScanSpeed });
      }
      apply(cachedScanSpeed);
    });
  }
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const speed = btn.dataset.speed;

      // Gate non-balanced speeds behind Pro
      if (speed !== "balanced" && userLevel < TIERS.PRO) {
        const licenseBody = document.getElementById("licenseBody");
        const licenseToggle = document.getElementById("licenseToggle");
        if (licenseBody.style.display === "none") {
          licenseBody.style.display = "block";
          licenseToggle.querySelector(".chevron").classList.add("open");
        }
        document.getElementById("licenseSection").scrollIntoView({ behavior: "smooth" });
        const input = document.getElementById("licenseInput");
        if (input) {
          input.focus();
          input.classList.add("flash");
          setTimeout(() => input.classList.remove("flash"), 600);
        }
        return;
      }

      cachedScanSpeed = speed;
      apply(cachedScanSpeed);
      chrome.storage.local.set({ scanSpeed: cachedScanSpeed });
    });
  });
}

function renderStatsBar(seats) {
  const el = document.getElementById("statsBar");

  if (seats.length > 0) {
    const prices = seats.map((s) => centsToUSD(s.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    el.innerHTML = `
      <div class="stat">
        <div class="stat-value">${seats.length.toLocaleString()}</div>
        <div class="stat-label">Seats</div>
      </div>
      <div class="stat">
        <div class="stat-value">$${formatPrice(min)}</div>
        <div class="stat-label">Cheapest</div>
      </div>
      <div class="stat">
        <div class="stat-value">$${formatPrice(max)}</div>
        <div class="stat-label">Priciest</div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="stat">
        <div class="stat-value">0</div>
        <div class="stat-label">Seats</div>
      </div>
      <div class="stat">
        <div class="stat-value">&mdash;</div>
        <div class="stat-label">Cheapest</div>
      </div>
      <div class="stat">
        <div class="stat-value">&mdash;</div>
        <div class="stat-label">Priciest</div>
      </div>
    `;
  }
}

// --- Category Tabs with Distribution + Cheapest Clusters ---

let activeCatIndex = -1;
let currentCatData = [];

function saveFilters() {
  chrome.storage.local.set({ filters: { activeCatIndex, selectedTogether: [...selectedTogether] } });
}
let selectedTogether = new Set([1, 2, 3, 4, 5, 6]); // all ON by default

function renderCategorySections(seats) {
  const tabsEl = document.getElementById("catTabs");
  const contentEl = document.getElementById("catContent");

  // Group seats by category
  const groups = {};
  for (const s of seats) {
    const cat = s.category || "Unknown";
    if (!groups[cat]) groups[cat] = { seats: [], color: s.color };
    groups[cat].seats.push(s);
  }

  // Sort by seat count descending
  currentCatData = Object.entries(groups).sort((a, b) => {
    return b[1].seats.length - a[1].seats.length;
  });

  if (currentCatData.length === 0) {
    tabsEl.innerHTML = "";
    contentEl.innerHTML = "";
    return;
  }

  // Clamp active index (-1 = All)
  if (activeCatIndex >= currentCatData.length) activeCatIndex = -1;

  // Render tabs — "All" first, then categories by seat count
  const totalSeats = currentCatData.reduce((sum, [, d]) => sum + d.seats.length, 0);
  const allTab = `<button class="cat-tab ${activeCatIndex === -1 ? "active" : ""}" data-index="-1">
    All
    <span class="cat-tab-count">${totalSeats}</span>
  </button>`;

  const catTabs = currentCatData
    .map(([cat, data], i) => {
      const shortName = cat.replace("Category ", "Cat ");
      const dotColor = data.color || "#6b7588";
      return `<button class="cat-tab ${i === activeCatIndex ? "active" : ""}" data-index="${i}">
        <span class="category-dot" style="background:${dotColor}"></span>${escapeHtml(shortName)}
        <span class="cat-tab-count">${data.seats.length}</span>
      </button>`;
    })
    .join("");

  tabsEl.innerHTML = allTab + catTabs;

  // Tab click handlers
  tabsEl.querySelectorAll(".cat-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCatIndex = parseInt(btn.dataset.index);
      saveFilters();
      renderCategorySections(seats);
    });
  });

  // Render active category content
  let activeSeats, activeColor;
  if (activeCatIndex === -1) {
    // All categories combined
    activeSeats = currentCatData.flatMap(([, d]) => d.seats);
    activeColor = "#1a3d8f";
  } else {
    const [, data] = currentCatData[activeCatIndex];
    activeSeats = data.seats;
    activeColor = data.color || "#1a3d8f";
  }

  // Build clusters first so we can filter seats by "together" count
  const allClusters = buildAllClusters(activeSeats);
  const allOn = selectedTogether.size === 6;
  const filteredClusters = allOn
    ? allClusters
    : allClusters.filter((c) => {
        if (c.count >= 6) return selectedTogether.has(6);
        return selectedTogether.has(c.count);
      });

  // When filtering by together count, only use seats from qualifying clusters
  let displaySeats;
  if (!allOn) {
    const qualifyingKeys = new Set();
    for (const c of filteredClusters) {
      for (const s of c.seats) qualifyingKeys.add(seatKey(s));
    }
    displaySeats = activeSeats.filter((s) => qualifyingKeys.has(seatKey(s)));
  } else {
    displaySeats = activeSeats;
  }

  const prices = displaySeats.map((s) => centsToUSD(s.price));
  const sortedPrices = prices.slice().sort((a, b) => a - b);

  let statsHtml, histHtml;
  if (sortedPrices.length > 0) {
    const min = sortedPrices[0];
    const max = sortedPrices[sortedPrices.length - 1];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const median = sortedPrices.length % 2 === 0
      ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
      : sortedPrices[Math.floor(sortedPrices.length / 2)];

    statsHtml = `
      <div class="cat-stats">
        <span class="cat-stat">
          <span class="cat-stat-label">Cheapest</span>
          <span class="price-green">$${formatPrice(min)}</span>
        </span>
        <span class="cat-stat">
          <span class="cat-stat-label">Median</span>
          <span class="price-white">$${formatPrice(median)}</span>
          <span class="price-avg">avg $${formatPrice(avg)}</span>
        </span>
        <span class="cat-stat">
          <span class="cat-stat-label">Highest</span>
          <span class="price-red">$${formatPrice(max)}</span>
        </span>
      </div>`;
    histHtml = buildDistribution(prices, activeColor);
  } else {
    statsHtml = `
      <div class="cat-stats">
        <span class="cat-stat">
          <span class="cat-stat-label">Cheapest</span>
          <span class="price-green">&mdash;</span>
        </span>
        <span class="cat-stat">
          <span class="cat-stat-label">Median</span>
          <span class="price-white">&mdash;</span>
        </span>
        <span class="cat-stat">
          <span class="cat-stat-label">Highest</span>
          <span class="price-red">&mdash;</span>
        </span>
      </div>`;
    histHtml = "";
  }

  const clustersHtml = renderClusterPage(filteredClusters, 0);

  const togetherBtns = [1, 2, 3, 4, 5, 6]
    .map((n) => {
      const label = n === 6 ? "6+" : String(n);
      const active = selectedTogether.has(n) ? "active" : "";
      return `<button class="together-btn ${active}" data-tog="${n}">${label}</button>`;
    })
    .join("");

  const seatCount = !allOn
    ? `<span class="together-count">${displaySeats.length} seats</span>`
    : "";

  contentEl.innerHTML = `
    <div class="together-filter">
      <span class="together-label">Seats together</span>
      <div class="together-btns">${togetherBtns}</div>
      ${seatCount}
    </div>
    ${statsHtml}
    ${histHtml}
    <div class="cheapest-header">
      Best Deals <span class="deals-count">${filteredClusters.length} groups</span>
    </div>
    <div id="clusterContainer">${clustersHtml}</div>
  `;

  // Together-filter click handlers
  contentEl.querySelectorAll(".together-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = parseInt(btn.dataset.tog);
      if (selectedTogether.has(n)) {
        selectedTogether.delete(n);
      } else {
        selectedTogether.add(n);
      }
      // If all toggled off, reset to all ON
      if (selectedTogether.size === 0) {
        selectedTogether = new Set([1, 2, 3, 4, 5, 6]);
      }
      saveFilters();
      renderCategorySections(seats);
    });
  });

  // Attach pagination handler
  attachClusterPagination(filteredClusters);

  // Drag-to-scroll on category tabs
  initCatTabsDrag();
}

function initCatTabsDrag() {
  const el = document.getElementById("catTabs");
  if (!el || el.dataset.dragInit) return;
  el.dataset.dragInit = "1";
  let isDown = false, startX, scrollLeft, moved;
  el.addEventListener("mousedown", (e) => {
    isDown = true; moved = false;
    el.classList.add("grabbing");
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  });
  el.addEventListener("mouseleave", () => { isDown = false; el.classList.remove("grabbing"); });
  el.addEventListener("mouseup", () => { isDown = false; el.classList.remove("grabbing"); });
  el.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    moved = true;
    el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX);
  });
}

function buildDistribution(prices, color) {
  const isLms = currentSite === "lms";
  if (prices.length < (isLms ? 1 : 2)) return "";

  const sorted = prices.slice().sort((a, b) => a - b);
  const totalSeats = sorted.length;

  // LMS: show full distribution (face-value, no outliers to trim)
  // Resale: bottom 80% get individual buckets, top 20% lumped together
  const useTail = !isLms;
  const cutoffIndex = useTail ? Math.floor(totalSeats * 0.8) : totalSeats;
  const mainPrices = sorted.slice(0, cutoffIndex);
  const tailPrices = sorted.slice(cutoffIndex);

  if (mainPrices.length < (isLms ? 1 : 2)) return "";

  const mainMin = mainPrices[0];
  const mainMax = mainPrices[mainPrices.length - 1];
  const mainRange = mainMax - mainMin;

  // LMS: single-price categories get one bar with empty flanking buckets; resale needs a range
  if (mainRange === 0 && !isLms) return "";
  if (mainRange === 0) {
    const lo = mainMin - 250;
    const hi = mainMin + 250;
    const emptyBar = `<div class="hist-bar" title="$${formatPrice(lo < 0 ? 0 : lo)}: 0 seats" style="height:1px;background:${color};opacity:0.08;"></div>`;
    const fullBar = `<div class="hist-bar" title="$${formatPrice(mainMin)}: ${totalSeats} seat${totalSeats !== 1 ? "s" : ""}" style="height:100%;background:${color};opacity:0.8;"></div>`;
    const emptyBar2 = `<div class="hist-bar" title="$${formatPrice(hi)}: 0 seats" style="height:1px;background:${color};opacity:0.08;"></div>`;
    return `
    <div class="distribution">
      <div class="hist-chart">${emptyBar}${fullBar}${emptyBar2}</div>
      <div class="hist-labels">
        <span>$${formatPrice(lo < 0 ? 0 : lo)}</span>
        <span class="hist-total">${totalSeats} seats</span>
        <span>$${formatPrice(hi)}</span>
      </div>
    </div>`;
  }

  // Target ~20 bars for the main section, round bucket size to a clean number
  let rawBucketSize = mainRange / 20;
  // Round to nearest nice number: 50, 100, 250, 500, 1000, 2500, 5000
  const niceSteps = [25, 50, 100, 250, 500, 1000, 2500, 5000];
  let bucketSize = niceSteps.find((s) => s >= rawBucketSize) || rawBucketSize;

  const bucketStart = Math.floor(mainMin / bucketSize) * bucketSize;
  const mainBucketCount = Math.ceil((mainMax - bucketStart) / bucketSize) + 1;
  const hasTail = tailPrices.length > 0;
  const totalBuckets = mainBucketCount + (hasTail ? 1 : 0);
  const buckets = new Array(totalBuckets).fill(0);

  for (const p of mainPrices) {
    let idx = Math.floor((p - bucketStart) / bucketSize);
    if (idx < 0) idx = 0;
    if (idx >= mainBucketCount) idx = mainBucketCount - 1;
    buckets[idx]++;
  }
  if (hasTail) buckets[totalBuckets - 1] = tailPrices.length;

  const maxBucket = Math.max(...buckets);
  const tailMin = tailPrices.length > 0 ? tailPrices[0] : 0;
  const tailMax = tailPrices.length > 0 ? tailPrices[tailPrices.length - 1] : 0;

  const bars = buckets
    .map((count, i) => {
      const isTail = hasTail && i === totalBuckets - 1;
      let label;
      if (isTail) {
        label = `$${formatPrice(tailMin)}-$${formatPrice(tailMax)}: ${count} seat${count !== 1 ? "s" : ""} (top 20%)`;
      } else {
        const lo = bucketStart + i * bucketSize;
        const hi = lo + bucketSize;
        label = `$${formatPrice(lo)}-$${formatPrice(hi)}: ${count} seat${count !== 1 ? "s" : ""}`;
      }

      if (count === 0) {
        return `<div class="hist-bar" title="${label}" style="height:1px;background:${color};opacity:0.08;"></div>`;
      }
      const height = Math.max(Math.round((count / maxBucket) * 100), 4);
      return `<div class="hist-bar" title="${label}" style="height:${height}%;background:${isTail ? "var(--text-muted)" : color};opacity:${isTail ? 0.5 : 0.8};"></div>`;
    })
    .join("");

  return `
    <div class="distribution">
      <div class="hist-chart">${bars}</div>
      <div class="hist-labels">
        <span>$${formatPrice(bucketStart)}</span>
        <span class="hist-total">${totalSeats} seats &middot; $${formatPrice(bucketSize)} bars</span>
        ${hasTail ? `<span>top 20%</span>` : `<span>$${formatPrice(mainPrices[mainPrices.length - 1])}</span>`}
      </div>
    </div>
  `;
}

function seatKey(s) { return s.seat + "_" + s.block + "_" + s.row; }

function buildAllClusters(seats) {
  const sorted = seats.slice().sort((a, b) =>
    a.price - b.price
    || a.block.localeCompare(b.block, undefined, { numeric: true })
    || a.row.localeCompare(b.row, undefined, { numeric: true })
    || a.seat.localeCompare(b.seat, undefined, { numeric: true })
  );
  const clusters = [];
  const used = new Set();

  // Group seats by block+row+price for O(n) neighbor lookup
  const groupMap = new Map();
  for (const s of sorted) {
    const k = s.block + "_" + s.row + "_" + s.price;
    if (!groupMap.has(k)) groupMap.set(k, []);
    groupMap.get(k).push(s);
  }

  for (const seat of sorted) {
    if (used.has(seatKey(seat))) continue;

    const k = seat.block + "_" + seat.row + "_" + seat.price;
    const neighbors = groupMap.get(k).filter((s) => !used.has(seatKey(s)));

    neighbors.sort((a, b) =>
      a.seat.localeCompare(b.seat, undefined, { numeric: true })
    );

    // Find consecutive runs
    const consecutive = [neighbors[0]];
    for (let i = 1; i < neighbors.length; i++) {
      const prev = parseInt(neighbors[i - 1].seat);
      const curr = parseInt(neighbors[i].seat);
      if (curr === prev + 1) {
        consecutive.push(neighbors[i]);
      } else {
        break;
      }
    }

    for (const s of consecutive) {
      used.add(seatKey(s));
    }

    const seatNums = consecutive.map((s) => s.seat);
    const seatDisplay =
      seatNums.length === 1
        ? `Seat ${seatNums[0]}`
        : `Seats ${seatNums[0]}-${seatNums[seatNums.length - 1]}`;

    clusters.push({
      block: seat.block,
      row: seat.row,
      seatDisplay,
      count: consecutive.length,
      price: centsToUSD(seat.price),
      area: seat.area,
      seats: consecutive,
    });
  }

  return clusters;
}

const CLUSTERS_PER_PAGE = 10;

function renderClusterPage(clusters, page) {
  if (clusters.length === 0) return "<div class='no-deals'>No seats found</div>";

  const start = page * CLUSTERS_PER_PAGE;
  const pageItems = clusters.slice(start, start + CLUSTERS_PER_PAGE);
  const hasMore = start + CLUSTERS_PER_PAGE < clusters.length;
  const hasPrev = page > 0;
  const totalPages = Math.ceil(clusters.length / CLUSTERS_PER_PAGE);

  const rows = pageItems
    .map((c, i) => {
      const rank = start + i + 1;
      return `
      <div class="cluster-row">
        <div class="cluster-rank">${rank}</div>
        <div class="cluster-info">
          <div class="cluster-location">Block ${escapeHtml(c.block)} &middot; Row ${escapeHtml(c.row)} &middot; ${escapeHtml(c.seatDisplay)}</div>
          <div class="cluster-detail">${c.count > 1 ? c.count + " together" : "single seat"}${c.area ? " &middot; " + escapeHtml(c.area.length > 30 ? c.area.substring(0, 28) + "\u2026" : c.area) : ""}</div>
        </div>
        <div class="cluster-price">$${formatPrice(c.price)}${c.count > 1 ? "<span class='each'>ea</span>" : ""}</div>
      </div>`;
    })
    .join("");

  const pagination =
    totalPages > 1
      ? `<div class="cluster-pagination">
          <button class="page-btn" data-page="${page - 1}" ${hasPrev ? "" : "disabled"}>&#8592; Prev</button>
          <span class="page-info">${page + 1} / ${totalPages}</span>
          <button class="page-btn" data-page="${page + 1}" ${hasMore ? "" : "disabled"}>Next &#8594;</button>
        </div>`
      : "";

  return `<div class="clusters">${rows}</div>${pagination}`;
}

function attachClusterPagination(allClusters) {
  const container = document.getElementById("clusterContainer");
  if (!container) return;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".page-btn");
    if (!btn || btn.disabled) return;
    const page = parseInt(btn.dataset.page);
    container.innerHTML = renderClusterPage(allClusters, page);
    attachClusterPagination(allClusters);
  });
}

// --- Block Table ---

function renderBlockTable(seats) {
  const tbody = document.querySelector("#blockTable tbody");

  const groups = {};
  for (const s of seats) {
    const key = s.block;
    if (!groups[key]) groups[key] = { area: s.area, prices: [] };
    groups[key].prices.push(centsToUSD(s.price));
  }

  const sorted = Object.entries(groups).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  );

  tbody.innerHTML = sorted
    .map(([block, data]) => {
      const min = Math.min(...data.prices);
      const max = Math.max(...data.prices);
      const areaDisplay =
        data.area.length > 26 ? data.area.substring(0, 24) + "\u2026" : data.area;

      return `<tr>
        <td>${escapeHtml(block)}</td>
        <td title="${escapeHtml(data.area)}">${escapeHtml(areaDisplay)}</td>
        <td class="num">${data.prices.length}</td>
        <td class="num price">$${formatPrice(min)}</td>
        <td class="num price">$${formatPrice(max)}</td>
      </tr>`;
    })
    .join("");
}


// --- Export CSV ---

function exportCSV() {
  chrome.storage.local.get(null, (data) => {
    if (!data?.games) return;

    const activeId = currentPerfId || Object.keys(data.games)[0];
    const game = data.games[activeId];
    if (!game) return;

    const seats = Object.values(game.seats || {}).filter(s => s.exclusive !== false && s.price != null);
    if (seats.length === 0) return;

    const match = game.match;
    const now = new Date();
    const exportTime = now.toISOString();

    const meta = [
      `# Match: ${match?.name || "Unknown"}`,
      `# Date: ${match?.date || "Unknown"}`,
      `# Currency: ${match?.currency || "USD"}`,
      `# Site: ${game.site || "resale"}`,
      `# Performance ID: ${game.match?.performanceId || activeId}`,
      `# Exported: ${exportTime}`,
      `# Total Seats: ${seats.length}`,
    ];

    const header = "Block,Area,Row,Seat,Category,Price_USD,Exclusive";
    const rows = seats
      .sort((a, b) =>
        a.price - b.price
        || a.block.localeCompare(b.block, undefined, { numeric: true })
        || a.row.localeCompare(b.row, undefined, { numeric: true })
        || a.seat.localeCompare(b.seat, undefined, { numeric: true })
      )
      .map((s) => {
        const area = s.area.includes(",") ? `"${s.area}"` : s.area;
        return `${s.block},${area},${s.row},${s.seat},${s.category},${centsToUSD(s.price).toFixed(2)},${s.exclusive}`;
      });

    const csv = [...meta, "", header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const matchName =
      game.match?.name?.replace(/[^a-zA-Z0-9]/g, "_") || "seats";
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${matchName}_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// --- Version Check ---

function checkForUpdate() {
  const current = chrome.runtime.getManifest().version;
  fetch("https://raw.githubusercontent.com/david-dirring/fifa-ticket-scout/main/version.json")
    .then(r => r.json())
    .then(data => {
      if (data.latest && compareVersions(data.latest, current) > 0) {
        const banner = document.getElementById("updateBanner");
        if (banner) banner.style.display = "flex";
      }
    })
    .catch(() => {}); // silently fail
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// --- Utilities ---

const FEE_MULTIPLIER_BY_SITE = { resale: 1.15, lms: 1.0 };
function centsToUSD(cents) { return cents / 1000 * (FEE_MULTIPLIER_BY_SITE[currentSite] ?? 1.15); }

function formatPrice(n) {
  if (n >= 1000) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return n.toFixed(2);
}

function formatDate(dateStr) {
  // Input format: "15-06-2026 - 12:00"
  const m = dateStr.match(/(\d{2})-(\d{2})-(\d{4})\s*-\s*(\d{2}:\d{2})/);
  if (!m) return dateStr;
  const [, day, month, year, time] = m;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year} \u00B7 ${time}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- License UI ---

function renderLicenseSection(license) {
  const body = document.getElementById("licenseBody");
  const badge = document.getElementById("tierBadge");

  if (license && license.level > 0) {
    const tierName = license.level >= 30 ? "Pro + Alerts"
                   : license.level >= 20 ? "Pro + Web"
                   : "Scout Pro";
    badge.textContent = tierName;
    badge.className = "tier-badge tier-pro";

    body.innerHTML = `
      <div class="license-active">
        <div class="license-status">
          <span class="license-check">&#10003;</span>
          <span>${tierName} active</span>
        </div>
        <div class="license-key-display">${maskKey(license.key)}</div>
        <button class="btn-deactivate" id="deactivateBtn">Deactivate</button>
      </div>
    `;

    document.getElementById("deactivateBtn").addEventListener("click", () => {
      if (confirm("Deactivate your license? You can re-activate anytime.")) {
        chrome.runtime.sendMessage({ type: "DEACTIVATE_LICENSE" }, () => {
          userLevel = 0;
          renderLicenseSection(null);
          lastMatchName = null;
          loadData();
        });
      }
    });
  } else {
    badge.textContent = "Free";
    badge.className = "tier-badge tier-free";

    body.innerHTML = `
      <div class="license-form">
        <p class="license-hint">Have a license key? Enter it below to unlock Pro features.</p>
        <div class="license-input-row">
          <input type="text" id="licenseInput" class="license-input"
                 placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                 spellcheck="false" autocomplete="off">
          <button class="btn-activate" id="activateBtn">Activate</button>
        </div>
        <div class="license-error" id="licenseError" style="display:none;"></div>
        <a href="https://fifaticketscout.com/#pricing" target="_blank" class="upgrade-link">
          Get a license &rarr;
        </a>
      </div>
    `;

    document.getElementById("activateBtn").addEventListener("click", handleActivate);
    document.getElementById("licenseInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleActivate();
    });
  }
}

function maskKey(key) {
  if (key.length <= 8) return key;
  return key.substring(0, 8) + key.substring(8).replace(/[A-Z0-9]/gi, "*");
}

function handleActivate() {
  const input = document.getElementById("licenseInput");
  const errorEl = document.getElementById("licenseError");
  const btn = document.getElementById("activateBtn");
  const key = input.value.trim();

  if (!key) {
    errorEl.textContent = "Please enter a license key.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying\u2026";
  errorEl.style.display = "none";

  chrome.runtime.sendMessage({ type: "ACTIVATE_LICENSE", licenseKey: key }, (resp) => {
    if (resp?.ok) {
      userLevel = resp.level;
      chrome.storage.local.get("license", (data) => {
        renderLicenseSection(data.license);
        lastMatchName = null;
        loadData();
      });
    } else {
      errorEl.textContent = resp?.error || "Verification failed.";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Activate";
    }
  });
}

// --- Alerts Tab ---

const SUPABASE_URL = "https://yaydpahqlqwesqdddgfi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlheWRwYWhxbHF3ZXNxZGRkZ2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDg1NDEsImV4cCI6MjA5MTQ4NDU0MX0.QQJuKz9Fnb_schlS6FEioMtyRvrJVBwAL71dzitZU-g";

let alertsTabLoaded = false;
let matchList = [];
let faceValueMap = {}; // match_number -> { cat1, cat2, cat3 }
let selectedAlertGames = new Map(); // match_number -> prefs
let alertFilters = { search: "", stages: new Set(["All"]), countries: new Set() };
let expandedDrawer = null; // match_number of currently open drawer
// Pick limit. maxPicks is read from scan_config.json
// (fetched from GitHub on startup) with a fallback default of 6.
let maxPicks = 6;

// City → host country
const CITY_COUNTRY = {
  "Los Angeles": "USA", "NY / NJ": "USA", "Dallas": "USA", "Miami": "USA",
  "Atlanta": "USA", "Boston": "USA", "Houston": "USA", "Kansas City": "USA",
  "Philadelphia": "USA", "San Francisco": "USA", "Seattle": "USA",
  "Toronto": "CAN", "Vancouver": "CAN",
  "Mexico City": "MEX", "Guadalajara": "MEX", "Monterrey": "MEX",
};

function renderAlertsTab() {
  const container = document.getElementById("alertsContent");

  // Check tier
  if (userLevel < TIERS.PRO_WEB_ALERTS) {
    container.innerHTML = renderAlertsLocked();
    bindLockedLicenseForm(() => renderAlertsTab());
    return;
  }

  // Already loaded? Just re-render with current state
  if (alertsTabLoaded) {
    loadSavedAlertConfig().then((config) => renderAlertsForm(container, config));
    return;
  }

  // Loading state
  container.innerHTML = `
    <div class="alerts-header">
      <h2>Alerts</h2>
      <p class="alerts-subtitle">Pick ${maxPicks} matches. We'll ping you when prices drop.</p>
    </div>
    <div class="alerts-msg">Loading matches&hellip;</div>
  `;

  // Load match list + face values + cloud config in parallel.
  // Cloud is the source of truth; local cache is a fallback when offline.
  Promise.all([fetchMatchList(), fetchFaceValues(), fetchAlertsFromCloud()]).then(([matches, faceValues, cloudConfig]) => {
    matchList = matches || [];
    faceValueMap = buildFaceValueMap(faceValues || []);

    if (cloudConfig?.ok) {
      // Server may return a per-license pick limit higher than scan_config default.
      if (typeof cloudConfig.maxPicks === "number") {
        maxPicks = cloudConfig.maxPicks;
      }
      // Canonical: overwrite local cache with the server copy
      chrome.storage.local.set({ alertConfigs: cloudConfig });
      if (cloudConfig.games?.length) {
        selectedAlertGames = new Map(
          cloudConfig.games.map((g) => [g.match_number, migratePickToNewShape(g)])
        );
      }
      alertsTabLoaded = true;
      renderAlertsForm(container, cloudConfig);
      return;
    }

    // Cloud fetch failed — fall back to whatever's in local cache and
    // surface an "offline" hint so the user knows they may be looking at
    // stale data.
    loadSavedAlertConfig().then((localConfig) => {
      if (localConfig?.games) {
        selectedAlertGames = new Map(
          localConfig.games.map((g) => [g.match_number, migratePickToNewShape(g)])
        );
      }
      alertsTabLoaded = true;
      renderAlertsForm(container, localConfig, { offline: true });
    });
  }).catch((err) => {
    container.innerHTML = `
      <div class="alerts-header"><h2>Alerts</h2></div>
      <div class="alerts-msg error">Could not load matches. Try again later.</div>
    `;
    console.log("[FIFA Ticket Scout] Alerts load error:", err);
  });
}

function fetchFaceValues() {
  return fetch(`${SUPABASE_URL}/rest/v1/face_values?select=match_number,category,face_value&order=match_number.asc`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  }).then((r) => r.json());
}

function buildFaceValueMap(rows) {
  const map = {};
  for (const r of rows) {
    if (!map[r.match_number]) map[r.match_number] = {};
    map[r.match_number][`cat${r.category}`] = r.face_value;
  }
  return map;
}

function getFaceValueForCategory(matchNumber, category) {
  const fv = faceValueMap[matchNumber];
  if (!fv) return null;
  if (category === "any" || !category) {
    // cheapest cat
    const vals = [fv.cat1, fv.cat2, fv.cat3].filter((v) => v != null);
    return vals.length > 0 ? Math.min(...vals) : null;
  }
  if (category === "CAT 1") return fv.cat1;
  if (category === "CAT 2") return fv.cat2;
  if (category === "CAT 3") return fv.cat3;
  return null;
}

function renderAlertsLocked() {
  return `
    <div class="locked-preview-wrap">
      <img src="images/alerts-preview.png" class="locked-preview-bg" alt="">
      <div class="locked-overlay">
        <div class="alerts-locked-icon">&#x1F512;</div>
        <div class="alerts-locked-title">Alerts is a Pro + Web + Alerts feature</div>
        <p class="alerts-locked-msg">
          Pick up to 3 games and we'll email you when prices drop below your target.
          Built for fans trying to get into the stadium with their family, not for flippers.
        </p>
        <a href="https://fifaticketscout.com/#pricing" target="_blank" class="btn-upgrade">
          Upgrade &mdash; choose PRO + WEB + ALERTS &rarr;
        </a>
        ${lockedLicenseFormHtml()}
      </div>
    </div>
  `;
}

function fetchMatchList() {
  return fetch(`${SUPABASE_URL}/rest/v1/match_schedule?select=match_number,match_date,stage,city,home_team,away_team,matchup,performance_id&order=match_number.asc`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  }).then((r) => r.json());
}

function loadSavedAlertConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get("alertConfigs", (data) => {
      resolve(data.alertConfigs || null);
    });
  });
}

// Pull the canonical alert config from Supabase via the get-alerts Edge
// Function. Returns the config on success, or null on any failure (network,
// auth, server). The caller is responsible for falling back to the local
// cache and rendering an offline state.
function fetchAlertsFromCloud() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_ALERTS" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        resolve(null);
        return;
      }
      resolve(resp);
    });
  });
}

function renderAlertsForm(container, savedConfig, opts) {
  const savedEmail = savedConfig?.email || "";
  const count = selectedAlertGames.size;
  const slotsAvailable = count < maxPicks;
  const offline = opts?.offline === true;

  container.innerHTML = `
    <div class="alerts-header">
      <h2>Alerts</h2>
      <p class="alerts-subtitle">Pick ${maxPicks} matches. We'll ping you when prices drop.</p>
      ${offline ? '<span class="offline-chip" title="Could not reach the server — showing the picks from your last successful save">&#9888; Offline &mdash; cached picks</span>' : ''}
    </div>
    ${slotsAvailable ? `
    <div class="alerts-warning">
      You can swap your picks anytime &mdash; just remove a match and add a new one.
    </div>
    ` : ''}

    ${!savedEmail ? `
    <div class="alerts-section">
      <div class="alerts-section-title">Email</div>
      <input type="email" id="alertsEmail" class="alerts-email-input" placeholder="you@example.com">
      <div class="alerts-helper">Where should we send your price drop alerts?</div>
    </div>
    ` : `
    <div class="alerts-section alerts-email-locked">
      <div class="alerts-section-title">Email</div>
      <div class="email-display">${escapeHtml(maskEmail(savedEmail))}
        <span class="lock-inline">&#x1F512;</span>
      </div>
      <div class="alerts-helper">Locked to your license.</div>
    </div>
    `}

    <!-- Your Picks -->
    <div class="picks-section">
      <div class="picks-header">
        <span class="picks-title">Your Picks</span>
        <span class="picks-counter">${count} of ${maxPicks}</span>
      </div>
      <div id="pickSlots"></div>
    </div>

    ${slotsAvailable ? `
    <!-- Browse -->
    <div class="alerts-browse">
      <input type="text" id="alertsSearch" class="alerts-search" placeholder="Search team, city, or stage..." value="${escapeHtml(alertFilters.search)}">
      <div class="filter-pills" id="stagePills"></div>
      <div class="filter-pills" id="countryPills"></div>
    </div>
    <div class="match-list-header" id="matchListHeader"></div>
    <div class="match-list" id="matchList"></div>
    ` : ""}

    <div id="alertsMsg"></div>

    <button class="btn-save-alerts" id="saveAlertsBtn" ${count === 0 ? "disabled" : ""}>
      Save my ${count} pick${count !== 1 ? "s" : ""}
    </button>
  `;

  renderPickSlots();
  if (slotsAvailable) {
    renderFilterPills();
    renderMatchList();
    document.getElementById("alertsSearch").addEventListener("input", (e) => {
      alertFilters.search = e.target.value;
      renderMatchList();
    });
  }
  document.getElementById("saveAlertsBtn").addEventListener("click", handleSaveAlerts);
}

function renderPickSlots() {
  const slotsEl = document.getElementById("pickSlots");
  const slots = Array.from({ length: maxPicks }, (_, i) => i + 1);
  const picks = Array.from(selectedAlertGames.values());

  slotsEl.innerHTML = slots.map((n) => {
    const pick = picks[n - 1];
    if (!pick) {
      return `<div class="pick-slot pick-slot-empty">+ Add pick ${n}</div>`;
    }
    const match = matchList.find((m) => m.match_number === pick.match_number);
    if (!match) return "";
    const teams = (match.home_team && match.away_team)
      ? `${match.home_team} vs ${match.away_team}`
      : (match.matchup || "TBD");
    const dateStr = match.match_date ? new Date(match.match_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    const summary = summarizeThreshold(pick);
    const isExpanded = expandedDrawer === pick.match_number;

    return `
      <div class="pick-slot ${isExpanded ? 'expanded' : ''}" data-match="${pick.match_number}">
        <div class="pick-slot-header">
          <div class="pick-slot-info">
            <div class="pick-slot-teams">#${pick.match_number} &middot; ${escapeHtml(teams)}</div>
            <div class="pick-slot-meta">${escapeHtml(match.city || "")} &middot; ${escapeHtml(match.stage || "")} &middot; ${dateStr}</div>
            <div class="pick-summary">${summary}</div>
          </div>
          <button class="pick-edit-btn" data-edit="${pick.match_number}">${isExpanded ? 'Close' : 'Edit'}</button>
        </div>
        ${isExpanded ? renderThresholdDrawer(pick) : ""}
      </div>
    `;
  }).join("");

  // Wire up edit buttons
  slotsEl.querySelectorAll(".pick-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const matchNum = parseInt(btn.dataset.edit);
      expandedDrawer = expandedDrawer === matchNum ? null : matchNum;
      renderPickSlots();
    });
  });

  // Wire up drawer inputs
  wireThresholdDrawer();
}

// Normalize a saved game config into the current pref shape.
// Handles legacy { mode: "face" | "custom", threshold } entries.
function migratePickToNewShape(g) {
  if (g.thresholdMode) {
    return {
      ...g,
      percentOfFace: g.percentOfFace || 0,
      dollarOffset: g.dollarOffset || 0,
      absolute: g.absolute || 0,
    };
  }
  const base = {
    match_number: g.match_number,
    performance_id: g.performance_id || null,
    category: g.category || "any",
    seats: g.seats || 2,
    thresholdMode: "percent",
    percentOfFace: 0,
    dollarOffset: 0,
    absolute: 0,
  };
  if (g.mode === "face") return base;
  // Legacy "custom" with a fixed dollar threshold → absolute mode
  if (g.threshold && g.threshold > 0) {
    return { ...base, thresholdMode: "absolute", absolute: g.threshold };
  }
  return base;
}

// Compute effective dollar threshold from a pick's threshold settings.
// Returns null if face value required but not available.
function computeThresholdForPick(pick) {
  const mode = pick.thresholdMode || "percent";
  if (mode === "absolute") {
    return pick.absolute != null ? pick.absolute : null;
  }
  const fv = getFaceValueForCategory(pick.match_number, pick.category);
  if (fv == null) return null;
  if (mode === "dollarOffset") {
    const offset = pick.dollarOffset != null ? pick.dollarOffset : 0;
    return Math.max(0, Math.round(fv + offset));
  }
  // percent
  const pct = pick.percentOfFace != null ? pick.percentOfFace : 0;
  return Math.max(0, Math.round(fv * (1 + pct / 100)));
}

function summarizeThreshold(pick) {
  const seats = pick.seats || 2;
  const cat = pick.category === "any" ? "Any" : (pick.category || "Any");
  const mode = pick.thresholdMode || "percent";

  let head;
  if (mode === "absolute") {
    const abs = pick.absolute != null ? pick.absolute : 0;
    head = `&le;$${abs}`;
  } else if (mode === "dollarOffset") {
    const off = pick.dollarOffset || 0;
    if (off === 0) head = `&le;Face`;
    else if (off > 0) head = `&le;+$${off} vFace`;
    else head = `&le;-$${Math.abs(off)} vFace`;
  } else {
    const pct = pick.percentOfFace != null ? pick.percentOfFace : 0;
    if (pct === 0) head = `&le;Face`;
    else if (pct > 0) head = `&le;+${pct}% vFace`;
    else head = `&le;${pct}% vFace`;
  }
  return `${head} &middot; ${cat} &middot; ${seats}tix`;
}

function formatPercentLabel(pct) {
  if (pct === 0) return "Face";
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

function formatDollarOffsetLabel(d) {
  if (d === 0) return "Face";
  if (d > 0) return `+$${d}`;
  return `-$${Math.abs(d)}`;
}

function formatAbsoluteLabel(d) {
  return `$${d}`;
}

function buildSliderExample(pick, _fv) {
  // Examples use a fixed $500 face value for easy mental math,
  // regardless of the actual match face value.
  const mode = pick.thresholdMode || "percent";
  const EXAMPLE_FV = 500;

  if (mode === "absolute") {
    const abs = pick.absolute != null ? pick.absolute : 0;
    return `Ignore face value, you'll be alerted when the price drops at or below $${abs}.`;
  }

  if (mode === "dollarOffset") {
    const off = pick.dollarOffset != null ? pick.dollarOffset : 0;
    const threshold = Math.max(0, EXAMPLE_FV + off);
    const offStr = off === 0 ? "$0" : off > 0 ? `+$${off}` : `-$${Math.abs(off)}`;
    return `If face value is $${EXAMPLE_FV}, at ${offStr}, you'll be alerted when the price drops at or below $${threshold}.`;
  }

  // percent
  const pct = pick.percentOfFace != null ? pick.percentOfFace : 0;
  const threshold = Math.max(0, Math.round(EXAMPLE_FV * (1 + pct / 100)));
  const pctStr = pct === 0 ? "0%" : pct > 0 ? `+${pct}%` : `${pct}%`;
  return `If face value is $${EXAMPLE_FV}, at ${pctStr}, you'll be alerted when the price drops at or below $${threshold}.`;
}

function isPickDeal(pick, fv) {
  const mode = pick.thresholdMode || "percent";
  if (mode === "percent") return (pick.percentOfFace || 0) <= 0;
  if (mode === "dollarOffset") return (pick.dollarOffset || 0) <= 0;
  if (mode === "absolute") return fv != null && (pick.absolute || 0) <= fv;
  return false;
}

function sliderConfigForMode(mode, currentValue) {
  if (mode === "dollarOffset") {
    let max = 3000;
    if (currentValue != null && currentValue > max) max = Math.ceil(currentValue / 500) * 500;
    return { min: -500, max, step: 100, leftLabel: "-$500", midLabel: "Face", rightLabel: `+$${max}` };
  }
  if (mode === "absolute") {
    let max = 10000;
    if (currentValue != null && currentValue > max) max = Math.ceil(currentValue / 1000) * 1000;
    return { min: 0, max, step: 50, leftLabel: "$0", midLabel: "", rightLabel: `$${max}` };
  }
  let max = 300;
  if (currentValue != null && currentValue > max) max = Math.ceil(currentValue / 50) * 50;
  return { min: -50, max, step: 5, leftLabel: "-50%", midLabel: "Face", rightLabel: `+${max}%` };
}

function sliderValueForMode(pick) {
  const mode = pick.thresholdMode || "percent";
  if (mode === "dollarOffset") return pick.dollarOffset != null ? pick.dollarOffset : 0;
  if (mode === "absolute") return pick.absolute != null ? pick.absolute : 0;
  return pick.percentOfFace != null ? pick.percentOfFace : 0;
}

function sliderFillPct(value, min, max) {
  if (max === min) return 0;
  const p = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, p));
}

function sliderLabelForMode(pick) {
  const mode = pick.thresholdMode || "percent";
  if (mode === "dollarOffset") return formatDollarOffsetLabel(pick.dollarOffset || 0);
  if (mode === "absolute") return formatAbsoluteLabel(pick.absolute || 0);
  return formatPercentLabel(pick.percentOfFace || 0);
}

function renderThresholdDrawer(pick) {
  const category = pick.category || "any";
  const seats = pick.seats || 2;
  const mode = pick.thresholdMode || "percent";
  const catFv = getFaceValueForCategory(pick.match_number, category);
  const example = buildSliderExample(pick, catFv);
  const isDeal = isPickDeal(pick, catFv);
  const val = sliderValueForMode(pick);
  const cfg = sliderConfigForMode(mode, val);
  const valLabel = sliderLabelForMode(pick);
  const fillPct = sliderFillPct(val, cfg.min, cfg.max);

  return `
    <div class="threshold-drawer" data-match="${pick.match_number}">
      <div class="drawer-label">Alert me when price is at or below</div>
      <div class="threshold-mode-pills">
        <button class="mode-pill ${mode === "percent" ? "active" : ""}" data-mode="percent">% vs Face</button>
        <button class="mode-pill ${mode === "dollarOffset" ? "active" : ""}" data-mode="dollarOffset">$ vs Face</button>
        <button class="mode-pill ${mode === "absolute" ? "active" : ""}" data-mode="absolute">Absolute $</button>
      </div>
      <div class="threshold-slider-wrap ${isDeal ? 'is-deal' : ''}">
        <div class="slider-value-display" id="sliderVal-${pick.match_number}" title="Click to type exact value">${valLabel}</div>
        <input type="range" class="threshold-slider" data-field="${mode}"
          min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${val}"
          style="--fill: ${fillPct}%">
        <div class="slider-labels">
          <span>${cfg.leftLabel}</span>
          <span class="slider-mid-label">${cfg.midLabel}</span>
          <span>${cfg.rightLabel}</span>
        </div>
        <div class="slider-example" id="sliderExample-${pick.match_number}">${escapeHtml(example)}</div>
      </div>

      <div class="drawer-label">Category</div>
      <div class="filter-pills drawer-cat-pills">
        <button class="filter-pill ${category === "any" ? "active" : ""}" data-cat="any">Any</button>
        <button class="filter-pill ${category === "CAT 1" ? "active" : ""}" data-cat="CAT 1">CAT 1</button>
        <button class="filter-pill ${category === "CAT 2" ? "active" : ""}" data-cat="CAT 2">CAT 2</button>
        <button class="filter-pill ${category === "CAT 3" ? "active" : ""}" data-cat="CAT 3">CAT 3</button>
      </div>

      <div class="drawer-label">Seats needed</div>
      <div class="stepper">
        <button class="step-btn" data-step="-1">&minus;</button>
        <span class="step-value">${seats}</span>
        <button class="step-btn" data-step="+1">+</button>
      </div>

      <div class="drawer-actions">
        <button class="drawer-remove" data-remove="${pick.match_number}">Remove pick</button>
      </div>
    </div>
  `;
}

function wireThresholdDrawer() {
  document.querySelectorAll(".threshold-drawer").forEach((drawer) => {
    const matchNum = parseInt(drawer.dataset.match);
    const prefs = selectedAlertGames.get(matchNum);
    if (!prefs) return;

    // Mode toggle pills
    drawer.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextMode = btn.dataset.mode;
        if (prefs.thresholdMode === nextMode) return;
        prefs.thresholdMode = nextMode;
        // Seed absolute with face value on first switch if unset
        if (nextMode === "absolute" && (prefs.absolute == null || prefs.absolute === 0)) {
          const fv = getFaceValueForCategory(matchNum, prefs.category);
          if (fv != null) prefs.absolute = fv;
        }
        selectedAlertGames.set(matchNum, prefs);
        renderPickSlots();
      });
    });

    // Slider (routes value to correct pref field based on mode)
    const slider = drawer.querySelector(".threshold-slider");
    const valEl = drawer.querySelector(`#sliderVal-${matchNum}`);
    const exampleEl = drawer.querySelector(`#sliderExample-${matchNum}`);
    const wrap = drawer.querySelector(".threshold-slider-wrap");
    if (slider) {
      slider.addEventListener("input", (e) => {
        e.stopPropagation();
        const v = parseInt(e.target.value);
        const mode = prefs.thresholdMode || "percent";
        if (mode === "dollarOffset") prefs.dollarOffset = v;
        else if (mode === "absolute") prefs.absolute = v;
        else prefs.percentOfFace = v;
        selectedAlertGames.set(matchNum, prefs);
        if (valEl) valEl.textContent = sliderLabelForMode(prefs);
        const fv = getFaceValueForCategory(matchNum, prefs.category);
        if (exampleEl) exampleEl.textContent = buildSliderExample(prefs, fv);
        if (wrap) wrap.classList.toggle("is-deal", isPickDeal(prefs, fv));
        const cfg = sliderConfigForMode(mode, v);
        slider.style.setProperty("--fill", sliderFillPct(v, cfg.min, cfg.max) + "%");
      });
      slider.addEventListener("change", () => renderPickSlots());
    }

    // Click-to-edit on value display
    if (valEl) {
      valEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (valEl.querySelector("input")) return; // already editing
        const mode = prefs.thresholdMode || "percent";
        const raw = sliderValueForMode(prefs);
        const input = document.createElement("input");
        input.type = "number";
        input.className = "slider-value-input";
        input.value = raw;
        if (mode === "percent") { input.min = -100; input.step = 1; }
        else if (mode === "dollarOffset") { input.step = 1; }
        else { input.min = 0; input.step = 1; }
        valEl.textContent = "";
        valEl.appendChild(input);
        input.focus();
        input.select();

        function commit() {
          const v = parseInt(input.value);
          if (isNaN(v)) { renderPickSlots(); return; }
          if (mode === "dollarOffset") prefs.dollarOffset = v;
          else if (mode === "absolute") prefs.absolute = Math.max(0, v);
          else prefs.percentOfFace = v;
          selectedAlertGames.set(matchNum, prefs);
          renderPickSlots();
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (ke) => {
          if (ke.key === "Enter") { ke.preventDefault(); input.blur(); }
          if (ke.key === "Escape") { renderPickSlots(); }
        });
      });
    }

    // Category pills
    drawer.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        prefs.category = btn.dataset.cat;
        selectedAlertGames.set(matchNum, prefs);
        renderPickSlots();
      });
    });

    // Stepper
    drawer.querySelectorAll(".step-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const delta = parseInt(btn.dataset.step);
        const next = Math.max(1, Math.min(6, (prefs.seats || 2) + delta));
        prefs.seats = next;
        selectedAlertGames.set(matchNum, prefs);
        renderPickSlots();
      });
    });

    // Remove
    drawer.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const mn = parseInt(btn.dataset.remove);
        selectedAlertGames.delete(mn);
        expandedDrawer = null;
        loadSavedAlertConfig().then((config) => {
          renderAlertsForm(document.getElementById("alertsContent"), config);
        });
      });
    });
  });
}

function renderFilterPills() {
  const stageEl = document.getElementById("stagePills");
  const countryEl = document.getElementById("countryPills");

  const stages = ["All", "Group", "R32", "R16", "QF", "SF", "Bronze", "Final"];
  stageEl.innerHTML = stages.map((s) => {
    const active = alertFilters.stages.has(s) ? "active" : "";
    return `<button class="filter-pill ${active}" data-stage="${s}">${s}</button>`;
  }).join("");

  const countries = ["USA", "CAN", "MEX"];
  countryEl.innerHTML = countries.map((c) => {
    const active = alertFilters.countries.has(c) ? "active" : "";
    return `<button class="filter-pill ${active}" data-country="${c}">${c}</button>`;
  }).join("");

  stageEl.querySelectorAll("[data-stage]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = btn.dataset.stage;
      if (stage === "All") {
        alertFilters.stages = new Set(["All"]);
      } else {
        alertFilters.stages.delete("All");
        if (alertFilters.stages.has(stage)) alertFilters.stages.delete(stage);
        else alertFilters.stages.add(stage);
        if (alertFilters.stages.size === 0) alertFilters.stages = new Set(["All"]);
      }
      renderFilterPills();
      renderMatchList();
    });
  });

  countryEl.querySelectorAll("[data-country]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const country = btn.dataset.country;
      if (alertFilters.countries.has(country)) alertFilters.countries.delete(country);
      else alertFilters.countries.add(country);
      renderFilterPills();
      renderMatchList();
    });
  });
}

function filterMatches() {
  const q = alertFilters.search.toLowerCase().trim();
  return matchList.filter((m) => {
    // Stage filter
    if (!alertFilters.stages.has("All")) {
      const matchesStage = Array.from(alertFilters.stages).some((s) => {
        if (s === "Group") return (m.stage || "").startsWith("Group ");
        return m.stage === s;
      });
      if (!matchesStage) return false;
    }
    // Country filter
    if (alertFilters.countries.size > 0) {
      const country = CITY_COUNTRY[m.city];
      if (!country || !alertFilters.countries.has(country)) return false;
    }
    // Search filter
    if (q) {
      const hay = [
        m.home_team, m.away_team, m.matchup, m.city, m.stage,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderMatchList() {
  const listEl = document.getElementById("matchList");
  const headerEl = document.getElementById("matchListHeader");
  if (!listEl || !headerEl) return;

  const filtered = filterMatches();
  const count = selectedAlertGames.size;
  const canAdd = count < maxPicks;

  headerEl.innerHTML = `Showing ${filtered.length} of ${matchList.length}`;

  listEl.innerHTML = filtered.map((m) => {
    const isSelected = selectedAlertGames.has(m.match_number);
    const teams = (m.home_team && m.away_team)
      ? `${m.home_team} vs ${m.away_team}`
      : (m.matchup || "TBD");
    const dateStr = m.match_date ? new Date(m.match_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    const fv = faceValueMap[m.match_number];
    const cheapestFv = fv ? Math.min(...[fv.cat1, fv.cat2, fv.cat3].filter((v) => v != null)) : null;
    const fvStr = cheapestFv != null ? `$${cheapestFv}` : "";

    const btnState = isSelected ? "added" : (canAdd ? "can-add" : "disabled");
    const btnSymbol = isSelected ? "&#10003;" : "+";
    const btnTitle = isSelected ? "Added" : (canAdd ? "Add to picks" : "Remove a pick first");

    return `
      <div class="match-list-row ${isSelected ? 'selected' : ''}" data-match="${m.match_number}">
        <div class="match-row-info">
          <div class="match-row-teams">#${m.match_number} &middot; ${escapeHtml(teams)}</div>
          <div class="match-row-meta">${escapeHtml(m.city || "")} &middot; ${escapeHtml(m.stage || "")} &middot; ${dateStr}${fvStr ? ' &middot; ' + fvStr : ''}</div>
        </div>
        <button class="match-row-add ${btnState}" data-add="${m.match_number}" title="${btnTitle}">${btnSymbol}</button>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".match-row-add").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const matchNum = parseInt(btn.dataset.add);
      if (selectedAlertGames.has(matchNum)) return;
      if (selectedAlertGames.size >= maxPicks) return;
      addGameSelection(matchNum);
    });
  });
}

function addGameSelection(matchNumber) {
  const match = matchList.find((m) => m.match_number === matchNumber);
  selectedAlertGames.set(matchNumber, {
    match_number: matchNumber,
    performance_id: match?.performance_id || null,
    category: "any",
    seats: 2,
    thresholdMode: "percent",
    percentOfFace: 0,
    dollarOffset: 0,
    absolute: 0,
  });
  // Re-render form
  loadSavedAlertConfig().then((config) => {
    renderAlertsForm(document.getElementById("alertsContent"), config);
  });
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.length > 2
    ? local[0] + "•".repeat(Math.min(local.length - 2, 5)) + local.slice(-1)
    : local;
  return `${masked}@${domain}`;
}

function validEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(email)) return false;
  if (/[,;\s]/.test(email)) return false;
  return true;
}

function handleSaveAlerts() {
  const msgEl = document.getElementById("alertsMsg");
  const btn = document.getElementById("saveAlertsBtn");
  const emailInput = document.getElementById("alertsEmail");

  loadSavedAlertConfig().then((config) => {
    const savedEmail = config?.email || "";
    const email = savedEmail || (emailInput ? emailInput.value.trim() : "");

    // Email validation only when there's no saved one yet
    if (!savedEmail && !validEmail(email)) {
      msgEl.innerHTML = '<div class="alerts-msg error">Please enter a single valid email address.</div>';
      return;
    }

    if (selectedAlertGames.size === 0) {
      msgEl.innerHTML = '<div class="alerts-msg error">Pick at least one game.</div>';
      return;
    }

    // Compute effective threshold per game from the threshold mode/value
    const games = Array.from(selectedAlertGames.values()).map((prefs) => {
      const threshold = computeThresholdForPick(prefs);
      return {
        match_number: prefs.match_number,
        performance_id: prefs.performance_id,
        threshold: threshold || 0,
        category: prefs.category || "any",
        seats: prefs.seats || 2,
        thresholdMode: prefs.thresholdMode || "percent",
        percentOfFace: prefs.percentOfFace || 0,
        dollarOffset: prefs.dollarOffset || 0,
        absolute: prefs.absolute || 0,
      };
    });

    // Validate each game has a positive threshold
    for (const g of games) {
      if (!g.threshold || g.threshold <= 0) {
        msgEl.innerHTML = `<div class="alerts-msg error">Set a price threshold for match ${g.match_number} (face value may not be available yet).</div>`;
        return;
      }
    }

    btn.disabled = true;
    btn.textContent = "Saving...";
    msgEl.innerHTML = "";

    chrome.runtime.sendMessage(
      { type: "SAVE_ALERTS", payload: { email, games } },
      (resp) => {
        if (resp?.ok) {
          msgEl.innerHTML = '<div class="alerts-msg success">Saved. We\'re watching these for you.</div>';
          alertsTabLoaded = false; // force reload on next open
          setTimeout(() => renderAlertsTab(), 600);
        } else {
          msgEl.innerHTML = `<div class="alerts-msg error">${resp?.error || "Save failed. Try again."}</div>`;
          btn.disabled = false;
          btn.textContent = "Save my picks";
        }
      }
    );
  });
}

// --- Scan All Sections ---

function startScan() {
  getCurrentTabUrl().then((url) => {
    const perfIdMatch = url.match(/perfId=(\d+)/);
    const tabPerfId = perfIdMatch ? perfIdMatch[1] : null;
    const tabSite = siteFromUrl(url);

    chrome.storage.local.get(null, (data) => {
      if (!data?.games) {
        alert("No game data yet. Browse to a match seat map first.");
        return;
      }

      const gameKeys = Object.keys(data.games);
      let activeId = null;
      if (tabPerfId) {
        const preferred = `${tabSite}:${tabPerfId}`;
        if (data.games[preferred]) activeId = preferred;
        else if (data.games[tabPerfId]) activeId = tabPerfId; // legacy
      }
      if (!activeId) activeId = gameKeys[0];
      const game = data.games[activeId];

      if (!game?.productId || !activeId) {
        alert("Browse to a match seat map first so the extension can detect the game IDs.");
        return;
      }

      scanStartTime = 0;
      scanElapsed = 0;
      lastPillPct = 0;
      lastMatchName = null;
      chrome.runtime.sendMessage({ type: "CLEAR_DATA" }, () => {
        document.getElementById("dashboard").style.display = "none";
        document.getElementById("noData").style.display = "block";
        document.getElementById("liveBadge").style.display = "none";
        document.getElementById("emptyTitle").textContent = "Data cleared";
        document.getElementById("emptyHint").textContent = "Click refresh in your browser to repull the data.";
        document.getElementById("emptyAction").style.display = "none";
      });
    });
  });
}

function updateScanAgo() {
  const el = document.getElementById("scanAgo");
  if (!el || !lastScanTime) return;
  const secs = Math.floor((Date.now() - lastScanTime) / 1000);
  if (secs < 60) {
    el.textContent = "just now";
  } else if (secs < 3600) {
    const mins = Math.floor(secs / 60);
    el.textContent = mins + " min" + (mins !== 1 ? "s" : "") + " ago";
  } else {
    const hrs = Math.floor(secs / 3600);
    el.textContent = hrs + " hr" + (hrs !== 1 ? "s" : "") + " ago";
  }
}
setInterval(updateScanAgo, 60000);

function updateScanProgress(perfId, completed, total, status, eta) {
  // Only update progress for the currently displayed game
  // currentPerfId is now a compound key (site:perfId), so compare the perfId suffix
  if (perfId && currentPerfId && !currentPerfId.endsWith(perfId)) return;
  const pct = Math.round((completed / total) * 100);
  document.getElementById("progressFill").style.width = pct + "%";

  // Header badge: SCANNING while in progress, SCANNED once done.
  const badgeText = document.getElementById("liveBadgeText");
  if (badgeText) {
    badgeText.textContent = (status === "done" || pct >= 100) ? "SCANNED" : "SCANNING";
  }
  if (status === "done") {
    lastScanTime = Date.now();
    updateScanAgo();
  }

  // Track scan timing
  if (pct > 0 && scanStartTime === 0) scanStartTime = Date.now();
  if (status === "done" || status === "captcha") scanElapsed = Date.now() - scanStartTime;

  // Update pill progress in match header
  const snapped = status === "done" ? 100 : Math.floor(pct / 10) * 10;
  lastPillPct = snapped;
  const pillFill = document.getElementById("scanPillFill");
  const pillText = document.getElementById("scanPillText");
  if (pillFill) {
    pillFill.style.width = snapped + "%";
  }
  if (pillText) {
    if (status === "done") {
      pillText.textContent = formatElapsed(scanElapsed);
    } else {
      pillText.textContent = snapped + "%";
    }
  }

  if (status === "captcha") {
    // Show rate limit warning in the empty state area
    document.getElementById("noData").style.display = "block";
    document.getElementById("emptyTitle").textContent = "Rate limited";
    document.getElementById("emptyHint").textContent = "Bot detection was triggered. Wait about 5 minutes, then refresh the page to try again. Try a slower scan speed next time.";
    document.getElementById("emptyAction").style.display = "none";

    lastPillPct = 100;
    if (pillFill) {
      pillFill.style.width = "100%";
      pillFill.style.background = "#d44040";
    }
  } else if (status === "done") {
    document.getElementById("progressText").textContent = "Done!";
    const btn = document.getElementById("scanBtn");
    btn.disabled = false;
    document.getElementById("scanBtnText").textContent = "Scan Complete!";
    setTimeout(() => {
      document.getElementById("scanBtnText").textContent = "Clear & Rescan";
      document.getElementById("scanProgress").style.display = "none";
    }, 3000);
  } else {
    let label = pct + "%";
    if (eta != null && eta > 0) {
      label += eta >= 60
        ? " · ~" + Math.ceil(eta / 60) + "m left"
        : " · ~" + eta + "s left";
    }
    document.getElementById("progressText").textContent = label;
  }
}

// --- Insights Tab ---

let insightsLoaded = false;
let insightsData = [];
let insightsChartType = "wall-movement";
let insightsIncludeLms = false;
// Each filter is a Set of selected values, empty Set = "All"
let insightsFilters = { game: new Set(), stadium: new Set(), team: new Set(), category: new Set() };

function renderInsightsTab() {
  const container = document.getElementById("insightsContent");

  if (userLevel < TIERS.PRO_WEB) {
    container.innerHTML = renderInsightsLocked();
    bindLockedLicenseForm(() => renderInsightsTab());
    return;
  }

  if (insightsLoaded) {
    renderInsightsChart();
    return;
  }

  container.innerHTML = `
    <div class="insights-header">
      <h2>Market Insights</h2>
      <p class="insights-subtitle">Loading crowdsourced pricing data&hellip;</p>
    </div>
    <div class="insights-loading">Loading&hellip;</div>
  `;

  chrome.runtime.sendMessage({ type: "FETCH_INSIGHTS" }, (result) => {
    if (!result || !result.ok) {
      container.innerHTML = `
        <div class="insights-header">
          <h2>Market Insights</h2>
          <p class="insights-subtitle">${escapeHtml(result?.error || "Could not load insights.")}</p>
        </div>
      `;
      return;
    }
    insightsData = result.data || [];
    insightsLoaded = true;
    renderInsightsChart();
  });
}

function lockedLicenseFormHtml() {
  return `
    <div class="locked-license-form">
      <p class="license-hint">Already have a license key?</p>
      <div class="license-input-row">
        <input type="text" id="lockedLicenseInput" class="license-input"
               placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
               spellcheck="false" autocomplete="off">
        <button class="btn-activate" id="lockedActivateBtn">Activate</button>
      </div>
      <div class="license-error" id="lockedLicenseError" style="display:none;"></div>
    </div>
  `;
}

function bindLockedLicenseForm(onSuccess) {
  const input = document.getElementById("lockedLicenseInput");
  const btn = document.getElementById("lockedActivateBtn");
  const errorEl = document.getElementById("lockedLicenseError");
  if (!btn || !input) return;

  function doActivate() {
    const key = input.value.trim();
    if (!key) {
      errorEl.textContent = "Please enter a license key.";
      errorEl.style.display = "block";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Activating\u2026";
    errorEl.style.display = "none";

    chrome.runtime.sendMessage({ type: "ACTIVATE_LICENSE", licenseKey: key }, (resp) => {
      if (resp && resp.ok) {
        userLevel = resp.level || 0;
        renderLicenseSection(resp.license || { key, level: userLevel });
        if (onSuccess) onSuccess();
      } else {
        btn.disabled = false;
        btn.textContent = "Activate";
        errorEl.textContent = resp?.error || "Activation failed.";
        errorEl.style.display = "block";
      }
    });
  }

  btn.addEventListener("click", doActivate);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doActivate(); });
}

function renderInsightsLocked() {
  return `
    <div class="locked-preview-wrap">
      <img src="images/insights-preview.png" class="locked-preview-bg" alt="">
      <div class="locked-overlay">
        <div class="insights-locked-icon">&#x1F512;</div>
        <div class="insights-locked-title">Insights is a Pro + Web feature</div>
        <p class="insights-locked-msg">
          See the average bottom-15% price for every match, broken down by category.
          Powered by data from every Ticket Scout user.
        </p>
        <a href="https://fifaticketscout.com/#pricing" target="_blank" class="btn-upgrade">
          Upgrade &mdash; choose PRO + WEB &rarr;
        </a>
        ${lockedLicenseFormHtml()}
      </div>
    </div>
  `;
}

// Interpolate between green (#1a9850) and black (#000000) by t (0=green, 1=black)
function insightsBarColor(t) {
  const r = Math.round(0x1a * (1 - t));
  const g = Math.round(0x98 * (1 - t));
  const b = Math.round(0x50 * (1 - t));
  return `rgb(${r},${g},${b})`;
}

// Build wall movement heatmap HTML from filtered data
function buildWallHeatmap(filtered, dates, fmtDate, fmtDateLabel) {
  if (filtered.length === 0 || dates.length === 0) {
    return `<div class="insights-empty">No data for the selected filters.</div>`;
  }

  // Merge price_histogram by date: { date → { bucket → count } }
  const merged = {};
  for (const d of dates) merged[d] = {};
  for (const r of filtered) {
    const d = r.scan_date;
    if (!merged[d]) continue;
    const hist = r.price_histogram;
    if (!hist || typeof hist !== "object") continue;
    for (const [bucket, cnt] of Object.entries(hist)) {
      const b = Number(bucket);
      merged[d][b] = (merged[d][b] || 0) + Number(cnt);
    }
  }

  // Collect all prices to compute percentiles
  const allPrices = [];
  for (const d of dates) {
    for (const [bucket, cnt] of Object.entries(merged[d])) {
      for (let i = 0; i < cnt; i++) allPrices.push(Number(bucket));
    }
  }
  if (allPrices.length === 0) {
    return `<div class="insights-empty">No price data available.</div>`;
  }
  allPrices.sort((a, b) => a - b);

  const p50 = allPrices[Math.floor(allPrices.length * 0.50)];
  const p80 = allPrices[Math.floor(allPrices.length * 0.80)];
  const minPrice = allPrices[0];

  // Build dynamic bucket ranges
  // Bottom 50%: ~8-10 rows of equal width from minPrice to p50
  const bottomRange = p50 - minPrice;
  const bucketWidth = bottomRange > 0 ? Math.max(25, Math.ceil(bottomRange / 10 / 25) * 25) : 50;
  const bucketRanges = []; // { floor, ceil, label }

  // Bottom 50% buckets
  for (let floor = Math.floor(minPrice / bucketWidth) * bucketWidth; floor < p50; floor += bucketWidth) {
    bucketRanges.push({ floor, ceil: floor + bucketWidth, label: `$${Math.round(floor)}-${Math.round(floor + bucketWidth)}` });
  }
  // P50-P80 bucket
  if (p80 > p50) {
    bucketRanges.push({ floor: p50, ceil: p80, label: `$${Math.round(p50)}-${Math.round(p80)}` });
  }
  // Above P80 bucket
  const maxBucket = Math.max(...Object.keys(merged[dates[0]] || {}).map(Number), ...Object.keys(merged[dates[dates.length - 1]] || {}).map(Number), p80 + 50);
  bucketRanges.push({ floor: p80, ceil: maxBucket + 50, label: `$${Math.round(p80)}+` });

  if (bucketRanges.length === 0) {
    return `<div class="insights-empty">Not enough price variation.</div>`;
  }

  // Map raw $50 histogram buckets into dynamic ranges for each date
  const grid = []; // grid[rowIdx][colIdx] = count
  for (let ri = 0; ri < bucketRanges.length; ri++) {
    grid[ri] = [];
    for (let ci = 0; ci < dates.length; ci++) {
      const dayHist = merged[dates[ci]];
      let count = 0;
      for (const [rawBucket, cnt] of Object.entries(dayHist)) {
        const price = Number(rawBucket);
        if (price >= bucketRanges[ri].floor && price < bucketRanges[ri].ceil) {
          count += cnt;
        }
      }
      grid[ri][ci] = count;
    }
  }

  // Compute column totals for percentage-based coloring
  const colTotals = [];
  for (let ci = 0; ci < dates.length; ci++) {
    let total = 0;
    for (let ri = 0; ri < bucketRanges.length; ri++) total += grid[ri][ci];
    colTotals[ci] = total;
  }

  // Find max percentage across all cells for color scaling
  let maxPct = 0;
  for (let ri = 0; ri < bucketRanges.length; ri++) {
    for (let ci = 0; ci < dates.length; ci++) {
      if (colTotals[ci] > 0) {
        const pct = grid[ri][ci] / colTotals[ci];
        if (pct > maxPct) maxPct = pct;
      }
    }
  }

  // Render grid: rows from top (cheap) to bottom (expensive)
  let cellsHtml = "";
  for (let ri = 0; ri < bucketRanges.length; ri++) {
    for (let ci = 0; ci < dates.length; ci++) {
      const count = grid[ri][ci];
      const pct = colTotals[ci] > 0 ? count / colTotals[ci] : 0;
      const intensity = maxPct > 0 ? pct / maxPct : 0;
      // Color: royal blue (#1a3cb5) → white, with power curve so white only appears near zero
      let bg = "transparent";
      if (count > 0) {
        // t=1 at full intensity (royal blue), t=0 at zero (white)
        // Power curve: stay blue longer, fade to white only at very low values
        const t = Math.pow(intensity, 0.35);
        const r = Math.round(255 - t * (255 - 26));
        const g = Math.round(255 - t * (255 - 60));
        const b = Math.round(255 - t * (255 - 181));
        bg = `rgb(${r},${g},${b})`;
      }
      const pctLabel = colTotals[ci] > 0 ? (pct * 100).toFixed(1) + "%" : "0%";
      const tooltip = `${fmtDate(dates[ci])}\n${bucketRanges[ri].label}\n${count} listing${count !== 1 ? "s" : ""}\n${pctLabel} of day's tickets`;
      const cellLabel = count > 0 ? pctLabel : "";
      const textColor = intensity > 0.3 ? "#fff" : "#4a5568";
      cellsHtml += `<div class="heatmap-cell" style="background:${bg};color:${textColor};" title="${escapeHtml(tooltip)}">${cellLabel}</div>`;
    }
  }

  // Y-axis labels (top = cheap, bottom = expensive)
  let yLabelsHtml = "";
  for (let ri = 0; ri < bucketRanges.length; ri++) {
    yLabelsHtml += `<div class="heatmap-y-label">${bucketRanges[ri].label}</div>`;
  }

  // X-axis labels
  let xLabelsHtml = dates.map((d) => `<div class="heatmap-x-label">${fmtDateLabel(d)}</div>`).join("");

  // Pad x-axis left to match y-axis width
  return `
    <div class="heatmap-wrap">
      <div class="heatmap-y-axis" style="grid-template-rows:repeat(${bucketRanges.length},1fr);">${yLabelsHtml}</div>
      <div class="heatmap-grid" style="grid-template-columns:repeat(${dates.length},1fr);grid-template-rows:repeat(${bucketRanges.length},1fr);">
        ${cellsHtml}
      </div>
    </div>
    <div class="heatmap-x-axis" style="padding-left:70px;">
      ${xLabelsHtml}
    </div>
  `;
}

function renderInsightsChart() {
  const container = document.getElementById("insightsContent");

  if (insightsData.length === 0) {
    container.innerHTML = `
      <div class="insights-header">
        <h2>Market Insights</h2>
        <p class="insights-subtitle">No scan data available yet. Check back after scans have been recorded.</p>
      </div>
    `;
    return;
  }

  // Helper: get both team names from a row
  function rowTeams(r) {
    return [r.home_team, r.away_team].filter(Boolean);
  }

  // Helper: does a Set-based filter match? Empty set = all
  function filterActive(filterSet) {
    return filterSet.size > 0;
  }

  // Apply each filter independently so we can derive cascading options
  function applyFiltersExcept(skip) {
    let rows = insightsData;
    // Site filter: always applied (not part of cascading)
    if (!insightsIncludeLms) {
      rows = rows.filter((r) => r.site === "resale");
    }
    if (skip !== "game" && filterActive(insightsFilters.game)) {
      rows = rows.filter((r) => insightsFilters.game.has(r.performance_id));
    }
    if (skip !== "stadium" && filterActive(insightsFilters.stadium)) {
      rows = rows.filter((r) => insightsFilters.stadium.has(r.city));
    }
    if (skip !== "team" && filterActive(insightsFilters.team)) {
      rows = rows.filter((r) => rowTeams(r).some((t) => insightsFilters.team.has(t)));
    }
    if (skip !== "category" && filterActive(insightsFilters.category)) {
      rows = rows.filter((r) => insightsFilters.category.has(r.category));
    }
    return rows;
  }

  // Cascading options: each dropdown shows only values compatible with the other filters
  const gamePool = applyFiltersExcept("game");
  const gameOptions = [];
  const seen = new Set();
  for (const r of gamePool) {
    if (!seen.has(r.performance_id) && r.match_number) {
      seen.add(r.performance_id);
      let gameLabel;
      if (r.home_team && r.away_team) {
        gameLabel = `#${r.match_number} \u00B7 ${r.home_team} vs ${r.away_team}`;
      } else {
        // Knockout: show stage + matchup code (e.g. "R32 · 2A v 2B")
        const stageShort = { "QF": "R8", "Final": "F", "Bronze": "3rd" }[r.stage] || r.stage || "";
        const matchup = r.matchup || "TBD";
        gameLabel = `#${r.match_number} \u00B7 ${stageShort} \u00B7 ${matchup}`;
      }
      gameOptions.push({ id: r.performance_id, label: gameLabel, num: r.match_number });
    }
  }
  gameOptions.sort((a, b) => a.num - b.num);

  const stadiumPool = applyFiltersExcept("stadium");
  const stadiums = [...new Set(stadiumPool.map((r) => r.city).filter(Boolean))].sort();

  const teamPool = applyFiltersExcept("team");
  const teamSet = new Set();
  for (const r of teamPool) {
    for (const t of rowTeams(r)) teamSet.add(t);
  }
  const individualTeams = [...teamSet].sort();

  const categoryPool = applyFiltersExcept("category");
  const categories = [...new Set(categoryPool.map((r) => r.category).filter(Boolean))].sort();

  // Prune any stale selections that are no longer in available options
  const gameIds = new Set(gameOptions.map((g) => g.id));
  for (const v of insightsFilters.game) { if (!gameIds.has(v)) insightsFilters.game.delete(v); }
  for (const v of insightsFilters.stadium) { if (!stadiums.includes(v)) insightsFilters.stadium.delete(v); }
  for (const v of insightsFilters.team) { if (!individualTeams.includes(v)) insightsFilters.team.delete(v); }
  for (const v of insightsFilters.category) { if (!categories.includes(v)) insightsFilters.category.delete(v); }

  // Final filtered set (all filters applied)
  const filtered = applyFiltersExcept(null);

  // Aggregate by scan_date: weighted avg of avg_priced_to_sell by seats_in_bottom_15
  const byDate = {};
  for (const r of filtered) {
    const d = r.scan_date;
    if (!byDate[d]) byDate[d] = { weightedSum: 0, totalWeight: 0, totalSeats: 0, bottom15Count: 0, seenMatches: new Set() };
    const w = r.seats_in_bottom_15 || 1;
    byDate[d].weightedSum += Number(r.avg_priced_to_sell) * w;
    byDate[d].totalWeight += w;
    byDate[d].bottom15Count += r.seats_in_bottom_15 || 0;
    // Deduplicate total_seats by match+day (each category row has the same match-wide total)
    const matchKey = r.performance_id;
    if (!byDate[d].seenMatches.has(matchKey)) {
      byDate[d].seenMatches.add(matchKey);
      byDate[d].totalSeats += r.total_seats || 0;
    }
  }

  // Build 7-day array (oldest first)
  const dates = Object.keys(byDate).sort();
  const bars = dates.map((d) => {
    const b = byDate[d];
    const avg = b.totalWeight > 0 ? b.weightedSum / b.totalWeight : 0;
    return {
      date: d,
      avg: Math.round(avg * 100) / 100,
      totalSeats: b.totalSeats,
      bottom15Count: b.bottom15Count,
    };
  });

  // Color gradient: cheapest = green, most expensive = black, by value
  const withData = bars.filter((b) => b.avg > 0);
  let minPrice = 0, maxPrice = 0;
  if (withData.length > 0) {
    minPrice = Math.min(...withData.map((b) => b.avg));
    maxPrice = Math.max(...withData.map((b) => b.avg));
  }
  const priceRange = maxPrice - minPrice;

  // Dampen color range when spread is small relative to avg price
  // e.g. $3,200-$3,400 is only 6% spread — shouldn't go full black
  const avgPrice = withData.length > 0 ? withData.reduce((s, b) => s + b.avg, 0) / withData.length : 1;
  const spreadPct = avgPrice > 0 ? priceRange / avgPrice : 0;
  // Cap the color intensity: full range only when spread > 30%, otherwise scale down
  const colorScale = Math.min(1, spreadPct / 0.30);

  for (const bar of bars) {
    if (bar.avg <= 0) {
      bar.color = null; // no data
    } else if (priceRange === 0) {
      bar.color = insightsBarColor(0); // all same → green
    } else {
      const t = ((bar.avg - minPrice) / priceRange) * colorScale;
      bar.color = insightsBarColor(t);
    }
    bar.limited = bar.totalSeats > 0 && bar.totalSeats < 5;
  }

  // Y-axis max (round up to nearest nice number)
  const yMax = maxPrice > 0 ? Math.ceil(maxPrice / 100) * 100 : 100;

  // Format date label: "Apr 10" or "Current" for today
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const todayStr = new Date().toISOString().split("T")[0];
  function fmtDate(d) {
    if (d === todayStr) return "Current";
    const p = d.split("-");
    return months[parseInt(p[1]) - 1] + " " + parseInt(p[2]);
  }
  function fmtDateLabel(d) {
    if (d === todayStr) return `Current<br><span class="date-sub">Earlier Today</span>`;
    const p = d.split("-");
    return months[parseInt(p[1]) - 1] + " " + parseInt(p[2]);
  }

  // Active filter context string
  function filterLabel(filterSet, allLabel, options) {
    if (filterSet.size === 0) return allLabel;
    if (options) return options.filter((o) => filterSet.has(o.id)).map((o) => o.label).join(", ");
    return [...filterSet].join(", ");
  }
  const filterCtx = [
    filterLabel(insightsFilters.game, "All games", gameOptions),
    filterLabel(insightsFilters.stadium, "All cities"),
    filterLabel(insightsFilters.team, "All teams"),
    filterLabel(insightsFilters.category, "All categories"),
  ].join(" \u00B7 ");

  // Build bar HTML
  const CHART_HEIGHT = 200;
  let barsHtml = "";
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.avg <= 0) {
      barsHtml += `
        <div class="chart-bar-slot">
          <div class="chart-bar-value-label">&nbsp;</div>
          <div class="chart-bar-pct-label">&nbsp;</div>
          <div class="chart-bar-wrapper" style="height:${CHART_HEIGHT}px;">
            <div class="chart-bar-nodata">No data</div>
          </div>
          <div class="chart-bar-date">${fmtDateLabel(bar.date)}</div>
        </div>`;
      continue;
    }

    // Day-over-day % change
    let pctChangeHtml = "&nbsp;";
    const prev = i > 0 ? bars[i - 1] : null;
    if (prev && prev.avg > 0) {
      const change = ((bar.avg - prev.avg) / prev.avg * 100).toFixed(1);
      const sign = change > 0 ? "+" : "";
      const cls = change < 0 ? "pct-down" : change > 0 ? "pct-up" : "pct-flat";
      pctChangeHtml = `<span class="${cls}">${sign}${change}%</span>`;
    }

    const pct = (bar.avg / yMax) * 100;
    const opacity = bar.limited ? 0.5 : 1;
    const tooltipLines = [
      fmtDate(bar.date),
      `$${formatPrice(bar.avg)}`,
      `avg of ${bar.bottom15Count} listing${bar.bottom15Count !== 1 ? "s" : ""}`,
      `${bar.totalSeats} total listing${bar.totalSeats !== 1 ? "s" : ""} that day`,
      filterCtx,
    ];
    if (bar.limited) tooltipLines.push("limited data");
    const tooltip = tooltipLines.join("\n");

    barsHtml += `
      <div class="chart-bar-slot">
        <div class="chart-bar-value-label">$${formatPrice(bar.avg)}</div>
        <div class="chart-bar-pct-label">${pctChangeHtml}</div>
        <div class="chart-bar-wrapper" style="height:${CHART_HEIGHT}px;">
          <div class="chart-bar" style="height:${pct}%;background:${bar.color};opacity:${opacity};" title="${escapeHtml(tooltip)}"></div>
        </div>
        <div class="chart-bar-date">${fmtDateLabel(bar.date)}</div>
      </div>`;
  }

  // Empty state
  if (bars.length === 0) {
    barsHtml = `<div class="insights-empty">No data for the selected filters.</div>`;
  }

  // Build multi-select filter dropdown HTML
  function multiFilterHtml(id, allLabel, options, filterSet) {
    // options = [{ value, label }]
    const count = filterSet.size;
    const btnLabel = count === 0 ? allLabel
      : count === 1 ? (options.find((o) => o.value === [...filterSet][0])?.label || [...filterSet][0])
      : `${count} selected`;
    const items = options.map((o) => {
      const checked = filterSet.has(o.value) ? "checked" : "";
      return `<label class="mf-item"><input type="checkbox" value="${escapeHtml(o.value)}" ${checked}><span>${escapeHtml(o.label)}</span></label>`;
    }).join("");
    return `
      <div class="mf-wrap" id="${id}">
        <button class="mf-btn ${count > 0 ? 'mf-active' : ''}" type="button">${escapeHtml(btnLabel)}</button>
        <div class="mf-dropdown">${items}</div>
      </div>`;
  }

  const gameItems = gameOptions.map((g) => ({ value: g.id, label: g.label }));
  const stadiumItems = stadiums.map((s) => ({ value: s, label: s }));
  const teamItems = individualTeams.map((t) => ({ value: t, label: t }));
  const categoryItems = categories.map((c) => ({ value: c, label: c }));

  // Build chart content based on selected type
  let chartHtml = "";
  let chartSubtitle = "";
  let chartInfo = "";
  if (insightsChartType === "wall-movement") {
    chartSubtitle = "Darker bands = price walls. Watch for bands drifting down.";
    chartInfo = "Each cell shows what percentage of that day's listings sit in that price range. Dark bands are price walls \u2014 where sellers cluster. If a band drifts downward over time, sellers are lowering their ask (capitulating).\n\nCrowdsourced from the Ticket Scout community. Each column uses the last scan from that day (UTC). Data refreshed hourly.";
    chartHtml = buildWallHeatmap(filtered, dates, fmtDate, fmtDateLabel);
  } else {
    chartSubtitle = "Avg &ldquo;priced to sell&rdquo; &mdash; bottom 15% of seats, last 7 days";
    chartInfo = "Takes the cheapest 15% of listings for each match and averages them. This represents what motivated sellers are actually asking \u2014 the price you'd realistically pay if you acted now. Computed per category when filtered.\n\nCrowdsourced from the Ticket Scout community. Each column uses the last scan from that day (UTC). Data refreshed hourly.";
    chartHtml = `<div class="chart-bars">${barsHtml}</div>`;
  }

  container.innerHTML = `
    <div class="insights-filters">
      ${multiFilterHtml("mfGame", "All games", gameItems, insightsFilters.game)}
      ${multiFilterHtml("mfStadium", "All cities", stadiumItems, insightsFilters.stadium)}
      ${multiFilterHtml("mfTeam", "All teams", teamItems, insightsFilters.team)}
      ${multiFilterHtml("mfCategory", "All categories", categoryItems, insightsFilters.category)}
      <label class="lms-toggle"><input type="checkbox" id="insightsLmsToggle" ${insightsIncludeLms ? "checked" : ""}> Include Last Minute Sales site</label>
    </div>
    <div class="insights-header">
      <div class="insights-header-row">
        <h2>Market Insights <button class="info-btn" id="insightsInfoBtn" type="button">i</button></h2>
        <select id="insightsChartType" class="insights-chart-select">
          <option value="priced-to-sell" ${insightsChartType === "priced-to-sell" ? "selected" : ""}>Avg "Priced to Sell"</option>
          <option value="wall-movement" ${insightsChartType === "wall-movement" ? "selected" : ""}>Wall Movement</option>
        </select>
      </div>
      <p class="insights-subtitle">${chartSubtitle}</p>
      <div class="info-panel" id="insightsInfoPanel" style="display:none;">${escapeHtml(chartInfo)}</div>
    </div>
    <div class="insights-chart">${chartHtml}</div>
  `;

  // Bind multi-filter handlers
  function bindMultiFilter(wrapperId, filterKey) {
    const wrap = document.getElementById(wrapperId);
    const btn = wrap.querySelector(".mf-btn");
    const dropdown = wrap.querySelector(".mf-dropdown");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close all other open dropdowns
      container.querySelectorAll(".mf-dropdown.open").forEach((d) => {
        if (d !== dropdown) d.classList.remove("open");
      });
      dropdown.classList.toggle("open");
    });

    dropdown.addEventListener("change", (e) => {
      const val = e.target.value;
      if (e.target.checked) {
        insightsFilters[filterKey].add(val);
      } else {
        insightsFilters[filterKey].delete(val);
      }
      renderInsightsChart();
    });

    // Prevent dropdown clicks from closing it
    dropdown.addEventListener("click", (e) => e.stopPropagation());
  }

  bindMultiFilter("mfGame", "game");
  bindMultiFilter("mfStadium", "stadium");
  bindMultiFilter("mfTeam", "team");
  bindMultiFilter("mfCategory", "category");

  // LMS toggle
  document.getElementById("insightsLmsToggle").addEventListener("change", (e) => {
    insightsIncludeLms = e.target.checked;
    renderInsightsChart();
  });

  // Chart type switcher
  document.getElementById("insightsChartType").addEventListener("change", (e) => {
    insightsChartType = e.target.value;
    renderInsightsChart();
  });

  // Info button toggle
  document.getElementById("insightsInfoBtn").addEventListener("click", () => {
    const panel = document.getElementById("insightsInfoPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", () => {
    container.querySelectorAll(".mf-dropdown.open").forEach((d) => d.classList.remove("open"));
  }, { once: true });

  // Animate bars in
  requestAnimationFrame(() => {
    container.querySelectorAll(".chart-bar").forEach((el) => {
      const target = el.style.height;
      el.style.height = "0%";
      requestAnimationFrame(() => { el.style.height = target; });
    });
  });
}
