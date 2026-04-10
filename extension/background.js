// Background service worker — processes API data and stores it

function emptyGame() {
  return { match: null, seats: {}, availability: null };
}

let dataUpdatedTimer = null;
function notifyDataUpdated() {
  clearTimeout(dataUpdatedTimer);
  dataUpdatedTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: "DATA_UPDATED" }).catch(() => {});
  }, 500);
}

// Track which tab is showing which game
const tabGameMap = {};

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabGameMap[tabId];
  for (const key of scannedGames) {
    if (key.startsWith(tabId + ":")) scannedGames.delete(key);
  }
});

// On page refresh/navigation, clear scanned state so auto-scan fires again
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    delete tabGameMap[tabId];
    for (const key of scannedGames) {
      if (key.startsWith(tabId + ":")) scannedGames.delete(key);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  if (message.type === "API_RESPONSE") {
    processApiResponse(message.url, message.body, tabId);
  }
  if (message.type === "CLEAR_DATA") {
    scannedGames.clear();
    chrome.storage.local.clear(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "START_SCAN") {
    // Clear existing seats for this game so the scan gives a fresh snapshot
    const perfId = message.performanceId;
    if (perfId) {
      getStorage().then((data) => {
        const games = data.games || {};
        if (games[perfId]) {
          games[perfId].seats = {};
          chrome.storage.local.set({ games }, () => {
            notifyDataUpdated();
          });
        }
      });
    }
    sendScanToTab(message.productId, message.performanceId, tabId);
  }
  if (message.type === "SCAN_PROGRESS") {
    // Forward progress to popup
    chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      performanceId: message.performanceId,
      completed: message.completed,
      total: message.total,
      status: message.status,
      eta: message.eta,
    }).catch(() => {});
  }
});

async function processApiResponse(url, body, tabId) {
  if (!body) return;

  // Match info
  if (url.includes("google-ecommerce-detail") && body.ecommerceViewProduct) {
    await saveMatchInfo(body.ecommerceViewProduct, tabId);
  }

  // Availability / price ranges
  if (url.includes("seatmap/availability") && body.priceRangeCategories) {
    const perfId = extractParam(url, "perfId");
    if (perfId) {
      await saveAvailability(perfId, body, tabId);
    }
  }

  // Individual seats
  if (url.includes("seats/free") && body.features) {
    const perfId = extractParam(url, "performanceId");
    const prodId = extractParam(url, "productId");
    if (perfId) {
      await saveSeats(perfId, body.features, tabId);
      if (prodId) {
        await saveProductId(perfId, prodId);
      }
    }
  }

  // Config — also has productId — auto-trigger scan
  if (url.includes("seatmap/config")) {
    const perfId = extractParam(url, "performanceId");
    const prodId = extractParam(url, "productId");
    if (perfId && prodId) {
      await saveProductId(perfId, prodId);
      autoScan(perfId, prodId, tabId);
    }
  }

  notifyDataUpdated();
}

function extractParam(url, param) {
  try {
    const u = new URL(url);
    return u.searchParams.get(param);
  } catch {
    const match = url.match(new RegExp(`[?&]${param}=([^&]+)`));
    return match ? match[1] : null;
  }
}

async function saveMatchInfo(product, tabId) {
  const perfId = String(product.performanceId);
  const data = await getStorage();
  const games = data.games || {};

  if (!games[perfId]) games[perfId] = emptyGame();

  games[perfId].match = {
    name: product.name,
    date: product.date,
    currency: product.currency,
    performanceId: perfId,
    imgUrl: product.imgUrl,
  };

  if (tabId) tabGameMap[tabId] = perfId;
  await chrome.storage.local.set({ games });
}

async function saveAvailability(perfId, body, tabId) {
  const data = await getStorage();
  const games = data.games || {};

  if (!games[perfId]) {
    games[perfId] = emptyGame();
  }

  games[perfId].availability = {
    categories: body.priceRangeCategories.map((c) => ({
      id: c.id,
      name: c.name?.en || "Unknown",
      rank: c.rank,
      minPrice: c.minPrice,
      maxPrice: c.maxPrice,
      bgColor: c.bgColor,
      textColor: c.textColor,
    })),
    globalMin: body.seatMapPriceRanges?.min || null,
    globalMax: body.seatMapPriceRanges?.max || null,
    lastUpdated: body.seatMapPriceRanges?.lastUpdated || null,
  };

  if (tabId) tabGameMap[tabId] = perfId;
  await chrome.storage.local.set({ games });
}

async function saveSeats(perfId, features, tabId) {
  const data = await getStorage();
  const games = data.games || {};

  if (!games[perfId]) {
    games[perfId] = emptyGame();
  }

  const seats = games[perfId].seats || {};

  for (const f of features) {
    const p = f.properties;
    if (!p) continue;

    const seatId = String(p.id);
    seats[seatId] = {
      block: p.block?.name?.en || "",
      area: p.area?.name?.en || "",
      row: p.row || "",
      seat: p.number || "",
      category: p.seatCategory || "",
      categoryId: p.seatCategoryId,
      price: p.amount,
      color: p.color || "",
      exclusive: p.exclusive || false,
    };
  }

  games[perfId].seats = seats;
  if (tabId) tabGameMap[tabId] = perfId;
  await chrome.storage.local.set({ games });
}

async function saveProductId(perfId, productId) {
  const data = await getStorage();
  const games = data.games || {};
  if (!games[perfId]) {
    games[perfId] = emptyGame();
  }
  games[perfId].productId = productId;
  await chrome.storage.local.set({ games });
}

// Track which tab+game combos we've already auto-scanned
const scannedGames = new Set();

function autoScan(performanceId, productId, tabId) {
  const key = tabId ? `${tabId}:${performanceId}` : performanceId;
  if (scannedGames.has(key)) return;
  scannedGames.add(key);

  // Clear old seats for a fresh snapshot before scanning
  getStorage().then((data) => {
    const games = data.games || {};
    if (games[performanceId]) {
      games[performanceId].seats = {};
      chrome.storage.local.set({ games }, () => {
        sendScanToTab(productId, performanceId, tabId);
      });
    } else {
      sendScanToTab(productId, performanceId, tabId);
    }
  });
}

function sendScanToTab(productId, performanceId, tabId) {
  chrome.storage.local.get("scanSpeed", (data) => {
    const speed = data.scanSpeed || "balanced";
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "START_SCAN",
        productId,
        performanceId,
        scanSpeed: speed,
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "START_SCAN",
            productId,
            performanceId,
            scanSpeed: speed,
          });
        }
      });
    }
  });
}

function getStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });
}
