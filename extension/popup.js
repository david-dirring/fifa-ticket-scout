document.addEventListener("DOMContentLoaded", () => {
  loadData();

  // Listen for live updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DATA_UPDATED") {
      loadData();
    }
    if (message.type === "SCAN_PROGRESS") {
      updateScanProgress(message.completed, message.total, message.status, message.eta);
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

  // Refresh button
  document.getElementById("refreshBtn").addEventListener("click", loadData);

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

function loadData() {
  getCurrentTabUrl().then((url) => {
    const isFifaSite = /\.tickets\.fifa\.com/.test(url);
    const isSeatMap = isFifaSite && (/perfId=/.test(url) || /\/seat\//.test(url));

    chrome.storage.local.get(null, (data) => {
      if (chrome.runtime.lastError || !data?.games) {
        showEmpty(isFifaSite, isSeatMap);
        return;
      }

      const games = data.games;
      const gameIds = Object.keys(games);

      if (gameIds.length === 0) {
        showEmpty(isFifaSite, isSeatMap);
        return;
      }

      const activeId = data.activeGame || gameIds[0];
      const game = games[activeId];

      if (!game || Object.keys(game.seats || {}).length === 0) {
        showEmpty(isFifaSite, isSeatMap);
        return;
      }

      // Restore persisted filters
      if (data.filters) {
        activeCatIndex = data.filters.activeCatIndex ?? -1;
        selectedTogether = new Set(data.filters.selectedTogether ?? [1, 2, 3, 4, 5, 6]);
      }

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

  if (isSeatMap) {
    title.textContent = "Scanning\u2026";
    hint.textContent = "Capturing seat data from the map. This usually takes a few seconds.";
    action.style.display = "none";
  } else if (isFifaSite) {
    title.textContent = "Open a seat map";
    hint.textContent = "You\u2019re on the FIFA ticket site \u2014 select a match and open its seat map to start capturing prices.";
    action.style.display = "none";
  } else {
    title.textContent = "FIFA Ticket Scout";
    hint.textContent = "Open the FIFA resale ticket site and browse a seat map to start capturing prices.";
    action.textContent = "Open FIFA Resale Site";
    action.style.display = "";
    action.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "https://fwc26-resale-usd.tickets.fifa.com" });
    };
  }
}

function renderDashboard(game) {
  document.getElementById("noData").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("liveBadge").style.display = "inline-flex";

  const seats = Object.values(game.seats || {});
  const match = game.match;

  renderMatchInfo(match);
  renderStatsBar(seats);
  renderCategorySections(seats);
  renderBlockTable(seats);
}

// --- Match Info ---

function renderMatchInfo(match) {
  const el = document.getElementById("matchInfo");

  if (match?.name) {
    const parts = match.name.split(" / ");
    const matchNum = parts[1] || "";
    const teams = parts[2] || match.name;
    const venue = parts[3] || "";
    const date = match.date ? formatDate(match.date) : "";

    el.innerHTML = `
      <div class="match-teams">${escapeHtml(teams)}</div>
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
      <div class="match-teams">Match data loading&hellip;</div>
      <div class="match-meta">Browse the seat map to capture match info</div>
    `;
  }
}

// --- Stats Bar ---

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
}

function buildDistribution(prices, color) {
  if (prices.length < 2) return "";

  const sorted = prices.slice().sort((a, b) => a - b);
  const totalSeats = sorted.length;

  // Bottom 80% get individual buckets, top 20% lumped together
  const cutoffIndex = Math.floor(totalSeats * 0.8);
  const mainPrices = sorted.slice(0, cutoffIndex);
  const tailPrices = sorted.slice(cutoffIndex);

  if (mainPrices.length < 2) return "";

  const mainMin = mainPrices[0];
  const mainMax = mainPrices[mainPrices.length - 1];
  const mainRange = mainMax - mainMin;

  if (mainRange === 0) return "";

  // Target ~20 bars for the main section, round bucket size to a clean number
  let rawBucketSize = mainRange / 20;
  // Round to nearest nice number: 50, 100, 250, 500, 1000, 2500, 5000
  const niceSteps = [25, 50, 100, 250, 500, 1000, 2500, 5000];
  let bucketSize = niceSteps.find((s) => s >= rawBucketSize) || rawBucketSize;

  const bucketStart = Math.floor(mainMin / bucketSize) * bucketSize;
  const mainBucketCount = Math.ceil((mainMax - bucketStart) / bucketSize) + 1;
  const totalBuckets = mainBucketCount + 1; // +1 for the tail bucket
  const buckets = new Array(totalBuckets).fill(0);

  for (const p of mainPrices) {
    let idx = Math.floor((p - bucketStart) / bucketSize);
    if (idx < 0) idx = 0;
    if (idx >= mainBucketCount) idx = mainBucketCount - 1;
    buckets[idx]++;
  }
  buckets[totalBuckets - 1] = tailPrices.length;

  const maxBucket = Math.max(...buckets);
  const tailMin = tailPrices.length > 0 ? tailPrices[0] : 0;
  const tailMax = tailPrices.length > 0 ? tailPrices[tailPrices.length - 1] : 0;

  const bars = buckets
    .map((count, i) => {
      const isTail = i === totalBuckets - 1;
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
        <span>top 20%</span>
      </div>
    </div>
  `;
}

function seatKey(s) { return s.seat + "_" + s.block + "_" + s.row; }

function buildAllClusters(seats) {
  const sorted = seats.slice().sort((a, b) => a.price - b.price);
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

    const activeId = data.activeGame || Object.keys(data.games)[0];
    const game = data.games[activeId];
    if (!game) return;

    const seats = Object.values(game.seats || {});
    if (seats.length === 0) return;

    const match = game.match;
    const now = new Date();
    const exportTime = now.toISOString();

    const meta = [
      `# Match: ${match?.name || "Unknown"}`,
      `# Date: ${match?.date || "Unknown"}`,
      `# Currency: ${match?.currency || "USD"}`,
      `# Performance ID: ${activeId}`,
      `# Exported: ${exportTime}`,
      `# Total Seats: ${seats.length}`,
    ];

    const header = "Block,Area,Row,Seat,Category,Price_USD,Exclusive";
    const rows = seats
      .sort((a, b) => a.price - b.price)
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

// --- Utilities ---

const FEE_MULTIPLIER = 1.15;
function centsToUSD(cents) { return cents / 1000 * FEE_MULTIPLIER; }

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

// --- Scan All Sections ---

function startScan() {
  chrome.storage.local.get(null, (data) => {
    if (!data?.games) {
      alert("No game data yet. Browse to a match seat map first.");
      return;
    }

    const activeId = data.activeGame || Object.keys(data.games)[0];
    const game = data.games[activeId];

    if (!game?.productId || !activeId) {
      alert("Browse to a match seat map first so the extension can detect the game IDs.");
      return;
    }

    chrome.storage.local.clear(() => {
      document.getElementById("dashboard").style.display = "none";
      document.getElementById("noData").style.display = "block";
      document.getElementById("liveBadge").style.display = "none";
      document.getElementById("emptyTitle").textContent = "Data cleared";
      document.getElementById("emptyHint").textContent = "Click refresh in your browser to repull the data.";
      document.getElementById("emptyAction").style.display = "none";
    });
  });
}

function updateScanProgress(completed, total, status, eta) {
  const pct = Math.round((completed / total) * 100);
  document.getElementById("progressFill").style.width = pct + "%";

  if (status === "done") {
    document.getElementById("progressText").textContent = "Done!";
    const btn = document.getElementById("scanBtn");
    btn.disabled = false;
    document.getElementById("scanBtnText").textContent = "Scan Complete!";
    setTimeout(() => {
      document.getElementById("scanBtnText").textContent = "Scan All Sections";
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
