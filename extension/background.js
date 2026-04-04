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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "API_RESPONSE") {
    processApiResponse(message.url, message.body);
  }
  if (message.type === "CLEAR_DATA") {
    chrome.storage.local.clear(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "START_SCAN") {
    // Forward to the content script on the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "START_SCAN",
          productId: message.productId,
          performanceId: message.performanceId,
        });
      }
    });
  }
  if (message.type === "SCAN_PROGRESS") {
    // Forward progress to popup
    chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      completed: message.completed,
      total: message.total,
      status: message.status,
      eta: message.eta,
    }).catch(() => {});
  }
});

async function processApiResponse(url, body) {
  if (!body) return;

  // Match info
  if (url.includes("google-ecommerce-detail") && body.ecommerceViewProduct) {
    await saveMatchInfo(body.ecommerceViewProduct);
  }

  // Availability / price ranges
  if (url.includes("seatmap/availability") && body.priceRangeCategories) {
    const perfId = extractParam(url, "perfId");
    if (perfId) {
      await saveAvailability(perfId, body);
    }
  }

  // Individual seats
  if (url.includes("seats/free") && body.features) {
    const perfId = extractParam(url, "performanceId");
    const prodId = extractParam(url, "productId");
    if (perfId) {
      await saveSeats(perfId, body.features);
      // Save productId for scan feature
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
      autoScan(perfId, prodId);
    }
  }

  notifyDataUpdated();
}

function extractParam(url, param) {
  try {
    const u = new URL(url);
    return u.searchParams.get(param);
  } catch {
    // Try regex fallback for relative URLs
    const match = url.match(new RegExp(`[?&]${param}=([^&]+)`));
    return match ? match[1] : null;
  }
}

async function saveMatchInfo(product) {
  const perfId = String(product.performanceId);
  const data = await getStorage();
  const oldActive = data.activeGame;
  let games = data.games || {};

  // New game — keep only the new game's data (if any already captured)
  if (oldActive && oldActive !== perfId) {
    const existing = games[perfId] || emptyGame();
    games = { [perfId]: existing };
    scannedGames.clear();
  }

  if (!games[perfId]) games[perfId] = emptyGame();

  games[perfId].match = {
    name: product.name,
    date: product.date,
    currency: product.currency,
    performanceId: perfId,
    imgUrl: product.imgUrl,
  };

  await chrome.storage.local.set({ games, activeGame: perfId });
}

async function saveAvailability(perfId, body) {
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

  await chrome.storage.local.set({ games, activeGame: perfId });
}

async function saveSeats(perfId, features) {
  const data = await getStorage();
  const games = data.games || {};

  if (!games[perfId]) {
    games[perfId] = emptyGame();
  }

  const seats = games[perfId].seats || {};

  for (const f of features) {
    const p = f.properties;
    if (!p) continue;

    // Use seat ID as key to deduplicate
    const seatId = String(p.id);
    seats[seatId] = {
      block: p.block?.name?.en || "",
      area: p.area?.name?.en || "",
      row: p.row || "",
      seat: p.number || "",
      category: p.seatCategory || "",
      categoryId: p.seatCategoryId,
      price: p.amount, // in cents
      color: p.color || "",
      exclusive: p.exclusive || false,
    };
  }

  games[perfId].seats = seats;
  await chrome.storage.local.set({ games, activeGame: perfId });
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

// Track which games we've already auto-scanned so we don't re-scan on every page load
const scannedGames = new Set();

function autoScan(performanceId, productId) {
  if (scannedGames.has(performanceId)) return;
  scannedGames.add(performanceId);

  // Send scan command to the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "START_SCAN",
        productId,
        performanceId,
      });
    }
  });
}

function getStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });
}
