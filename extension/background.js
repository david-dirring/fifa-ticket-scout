// Background service worker — processes API data and stores it

// --- Tier / License constants ---
const TIERS = { FREE: 0, PRO: 10, PRO_WEB: 20, PRO_WEB_ALERTS: 30 };
const REVERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================
// LICENSE PROVIDER — swap this section to change providers
// Must export: PRODUCTS array and verifyKey(productId, licenseKey) function
// ============================================================

const PRODUCTS = [
  { productId: "qQRSGWNOL13FKrC3bHvmkA==",  level: 10 },  // Scout Pro ($19.99)
  { productId: "_EOsxJwpud5MDG4IX3a-Ig==",   level: 20 },  // Pro + Web ($29.99)
  { productId: "HEzB2VDD6QMDXaFiynXo5w==",   level: 30 },  // Pro + Web + Alerts ($49.99)
];

// Returns { valid: true, test: bool } or { valid: false }
// Throws on network error
async function verifyKey(productId, licenseKey) {
  const resp = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      product_id: productId,
      license_key: licenseKey,
      increment_uses_count: "false",
    }),
  });
  const result = await resp.json();
  return { valid: !!result.success, test: result.purchase?.test || false };
}

// ============================================================
// END LICENSE PROVIDER
// ============================================================

// ============================================================
// SUPABASE SYNC — fire-and-forget data sync after each scan
// ============================================================

const SUPABASE_URL = "https://yaydpahqlqwesqdddgfi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlheWRwYWhxbHF3ZXNxZGRkZ2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDg1NDEsImV4cCI6MjA5MTQ4NDU0MX0.QQJuKz9Fnb_schlS6FEioMtyRvrJVBwAL71dzitZU-g";

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateVisitorId() {
  const data = await getStorage();
  if (data.visitorId) return data.visitorId;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const visitorId = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ visitorId });
  return visitorId;
}

function syncToSupabase(performanceId, durationMs) {
  getStorage().then(async (data) => {
    const game = data.games?.[performanceId];
    if (!game?.seats || Object.keys(game.seats).length === 0) return;

    const visitorId = await getOrCreateVisitorId();
    const license = data.license;
    const licenseHash = license?.key ? await sha256(license.key) : null;

    const payload = {
      visitorId,
      licenseHash,
      performanceId,
      match: game.match || {},
      seats: game.seats,
      scanDurationMs: durationMs,
    };

    fetch(`${SUPABASE_URL}/functions/v1/ingest-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.log("[FIFA Ticket Scout] Supabase sync failed (non-blocking):", err.message);
    });
  }).catch((err) => {
    console.log("[FIFA Ticket Scout] Sync prep failed:", err.message);
  });
}

async function fetchAlerts() {
  // Cloud rehydrate path. Returns { ok: true, email, games, gamesLocked, savedAt, updatedAt }
  // on success, or { ok: false, error } on failure. Does NOT write to
  // chrome.storage.local — the caller decides whether to cache the result
  // (so an offline fallback path can't accidentally clobber the canonical copy).
  try {
    const data = await getStorage();
    const license = data.license;
    if (!license?.key) {
      return { ok: false, error: "No license found." };
    }
    if ((license.level || 0) < TIERS.PRO_WEB_ALERTS) {
      return { ok: false, error: "Alerts requires Pro + Web + Alerts tier." };
    }

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ licenseKey: license.key }),
    });

    const result = await resp.json();
    if (!resp.ok || !result.ok) {
      return { ok: false, error: result.error || "Fetch failed." };
    }
    return result;
  } catch (err) {
    console.log("[FIFA Ticket Scout] fetchAlerts error:", err.message);
    return { ok: false, error: "Could not reach server. Check your connection." };
  }
}

async function saveAlerts(payload) {
  try {
    const data = await getStorage();
    const license = data.license;
    if (!license?.key) {
      return { ok: false, error: "No license found." };
    }
    if ((license.level || 0) < TIERS.PRO_WEB_ALERTS) {
      return { ok: false, error: "Alerts requires Pro + Web + Alerts tier." };
    }

    const body = {
      licenseKey: license.key,  // raw key, Edge Function will verify + hash
      email: payload.email,
      games: payload.games,
    };

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/save-alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });

    const result = await resp.json();
    if (!resp.ok || !result.ok) {
      return { ok: false, error: result.error || "Save failed." };
    }

    // Persist locally
    await chrome.storage.local.set({
      alertConfigs: {
        email: payload.email,
        games: payload.games,
        gamesLocked: result.gamesLocked !== false,
        savedAt: Date.now(),
      },
    });

    return { ok: true, gamesLocked: result.gamesLocked !== false };
  } catch (err) {
    console.log("[FIFA Ticket Scout] saveAlerts error:", err.message);
    return { ok: false, error: "Could not reach server. Check your connection." };
  }
}

// ============================================================
// END SUPABASE SYNC
// ============================================================

// --- Re-verify license on alarm ---
chrome.alarms.create("reverify-license", { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reverify-license") reverifyLicense();
});

// Re-verify on service worker startup if stale
getStorage().then((data) => {
  if (data.license && Date.now() - data.license.verifiedAt > REVERIFY_INTERVAL_MS) {
    reverifyLicense();
  }
});

async function activateLicense(licenseKey) {
  const trimmed = licenseKey.trim();
  if (!trimmed) return { ok: false, error: "Please enter a license key." };

  // Try each product, highest tier first
  const sorted = [...PRODUCTS].sort((a, b) => b.level - a.level);

  for (const product of sorted) {
    try {
      const result = await verifyKey(product.productId, trimmed);

      if (result.valid) {
        const license = {
          key: trimmed,
          level: product.level,
          productId: product.productId,
          verifiedAt: Date.now(),
          test: result.test,
        };
        await chrome.storage.local.set({ license });
        return { ok: true, level: product.level };
      }
    } catch (err) {
      console.log("[FIFA Ticket Scout] License verify error:", err.message);
      return { ok: false, error: "Could not verify license. Check your connection and try again." };
    }
  }

  return { ok: false, error: "Invalid license key. Please check and try again." };
}

async function reverifyLicense() {
  const data = await getStorage();
  if (!data.license?.key) return;

  const product = PRODUCTS.find((p) => p.productId === data.license.productId);
  if (!product) return;

  try {
    const result = await verifyKey(product.productId, data.license.key);

    if (result.valid) {
      data.license.verifiedAt = Date.now();
      await chrome.storage.local.set({ license: data.license });
    } else {
      await chrome.storage.local.remove("license");
      chrome.runtime.sendMessage({ type: "LICENSE_CHANGED" }).catch(() => {});
    }
  } catch {
    // Network error — keep cached license, retry next cycle
  }
}

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
const scanStartTimes = {};

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
    // Surgical: only wipe the captured-scan data. Everything else
    // (alertConfigs, license, visitorId, scanSpeed, filters) survives by
    // default. Avoids the historical "restore the things I forgot to wipe"
    // footgun where each new top-level storage key had to be added to a
    // rescue whitelist.
    chrome.storage.local.remove("games", () => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "ACTIVATE_LICENSE") {
    activateLicense(message.licenseKey).then(sendResponse);
    return true;
  }
  if (message.type === "DEACTIVATE_LICENSE") {
    chrome.storage.local.remove("license", () => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "GET_LICENSE") {
    chrome.storage.local.get("license", (data) => {
      sendResponse({ license: data.license || null });
    });
    return true;
  }
  if (message.type === "FETCH_ALERTS") {
    fetchAlerts().then(sendResponse);
    return true;
  }
  if (message.type === "SAVE_ALERTS") {
    saveAlerts(message.payload).then(sendResponse);
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
    // Track scan timing
    if (message.completed === 0 && message.status === "scanning") {
      scanStartTimes[message.performanceId] = Date.now();
    }

    // Forward progress to popup
    chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      performanceId: message.performanceId,
      completed: message.completed,
      total: message.total,
      status: message.status,
      eta: message.eta,
    }).catch(() => {});

    // Sync to Supabase when scan completes
    if (message.status === "done") {
      const startTime = scanStartTimes[message.performanceId];
      const durationMs = startTime ? Date.now() - startTime : null;
      delete scanStartTimes[message.performanceId];
      syncToSupabase(message.performanceId, durationMs);
    }
  }
});

async function processApiResponse(url, body, tabId) {
  if (!body) return;

  // Match info
  if (url.includes("google-ecommerce-detail") && body.ecommerceViewProduct) {
    await enforceGameLimit(String(body.ecommerceViewProduct.performanceId));
    await saveMatchInfo(body.ecommerceViewProduct, tabId);
  }

  // Availability / price ranges
  if (url.includes("seatmap/availability") && body.priceRangeCategories) {
    const perfId = extractParam(url, "perfId");
    if (perfId) {
      await enforceGameLimit(perfId);
      await saveAvailability(perfId, body, tabId);
    }
  }

  // Individual seats
  if (url.includes("seats/free") && body.features) {
    const perfId = extractParam(url, "performanceId");
    const prodId = extractParam(url, "productId");
    if (perfId) {
      await enforceGameLimit(perfId);
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
      await enforceGameLimit(perfId);
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

// Bounding box of any nested coordinate array (Point, Polygon, MultiPolygon).
// Returns [minX, minY, maxX, maxY] or undefined if no numeric pairs found.
function bboxOf(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (function walk(c) {
    if (!Array.isArray(c) || c.length === 0) return;
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    for (const child of c) walk(child);
  })(coords);
  return isFinite(minX) ? [minX, minY, maxX, maxY] : undefined;
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
      // Extra IDs needed by the seat-preselect bridge (content.js) so the
      // FIFA seat picker can re-render a "selected" state from sessionStorage.
      // All optional — undefined values are dropped from the JSON automatically.
      blockId: p.block?.id,
      areaId: p.area?.id,
      tariffId: p.tariffId ?? p.tariff?.id,
      advantageId: p.advantageId ?? p.advantage?.id,
      movementId: p.movementId ?? p.resaleMovementId,
      contingentId: p.contingentId,
      seatQuality: p.seatQuality,
      extent: bboxOf(f.geometry?.coordinates),
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

// Free tier: only one game at a time — clear old game when switching
async function enforceGameLimit(perfId) {
  const data = await getStorage();
  const level = data.license?.level || 0;
  if (level >= TIERS.PRO) return;

  const games = data.games || {};
  const existingIds = Object.keys(games);
  if (existingIds.length > 0 && !existingIds.includes(perfId)) {
    await chrome.storage.local.set({ games: {} });
  }
}

function sendScanToTab(productId, performanceId, tabId) {
  chrome.storage.local.get(["scanSpeed", "license"], (data) => {
    let speed = data.scanSpeed || "balanced";
    const level = data.license?.level || 0;
    // Enforce: non-balanced speeds require Pro
    if (speed !== "balanced" && level < TIERS.PRO) {
      speed = "balanced";
    }
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
