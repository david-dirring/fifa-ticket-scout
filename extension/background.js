// Background service worker — processes API data and stores it

// --- Site discrimination ---
function siteFromUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes("-resale-")) return "resale";
    if (h.includes("-shop-"))   return "lms";
  } catch {}
  return "unknown";
}

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

function syncToSupabase(gameKey, durationMs) {
  getStorage().then(async (data) => {
    const game = data.games?.[gameKey];
    if (!game) return;
    // Allow LMS zero-seat scans to sync (records "we checked, nothing there")
    if (Object.keys(game.seats || {}).length === 0 && game.site !== "lms") return;

    const visitorId = await getOrCreateVisitorId();
    const license = data.license;
    const licenseHash = license?.key ? await sha256(license.key) : null;

    const performanceId = game.match?.performanceId || gameKey.split(":").pop();
    const payload = {
      visitorId,
      licenseHash,
      site: game.site || "resale",
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

async function fetchInsights() {
  try {
    const data = await getStorage();
    const license = data.license;
    if (!license?.key) {
      return { ok: false, error: "No license found." };
    }
    if ((license.level || 0) < TIERS.PRO_WEB) {
      return { ok: false, error: "Insights requires Pro + Web tier." };
    }

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-insights`, {
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
    console.log("[FIFA Ticket Scout] fetchInsights error:", err.message);
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
// --- Refresh remote scan config every 60 minutes ---
chrome.alarms.create("refresh-scan-config", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reverify-license") reverifyLicense();
  if (alarm.name === "refresh-scan-config") fetchScanConfig();
});

async function fetchScanConfig() {
  try {
    const resp = await fetch(
      "https://raw.githubusercontent.com/david-dirring/fifa-ticket-scout/main/scan_config.json"
    );
    if (!resp.ok) return;
    const config = await resp.json();
    if (config && config.profiles) {
      await chrome.storage.local.set({ scanConfig: config });
    }
  } catch (err) {
    console.log("[FIFA Ticket Scout] Scan config fetch failed (non-blocking):", err.message);
  }
}

// Fetch scan config + re-verify license on service worker startup
fetchScanConfig();
getStorage().then((data) => {
  if (data.license && Date.now() - data.license.verifiedAt > REVERIFY_INTERVAL_MS) {
    reverifyLicense();
  }
  // One-shot migration: rewrite bare perfId keys → resale:perfId
  const games = data.games;
  if (games) {
    let changed = false;
    for (const key of Object.keys(games)) {
      if (!key.includes(":")) {
        games[key].site = "resale";
        games[`resale:${key}`] = games[key];
        delete games[key];
        changed = true;
      }
    }
    if (changed) chrome.storage.local.set({ games });
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
  removeScannedGamesForTab(tabId);
});

// On page refresh/navigation, clear scanned state so auto-scan fires again
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    delete tabGameMap[tabId];
    removeScannedGamesForTab(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  if (message.type === "API_RESPONSE") {
    processApiResponse(message.url, message.body, tabId);
  }
  if (message.type === "CLEAR_DATA") {
    chrome.storage.session.remove("scannedGames");
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
  if (message.type === "FETCH_INSIGHTS") {
    fetchInsights().then(sendResponse);
    return true;
  }
  if (message.type === "SAVE_ALERTS") {
    saveAlerts(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === "START_SCAN") {
    // Clear existing seats for this game so the scan gives a fresh snapshot
    const perfId = message.performanceId;
    const site = message.site || "resale";
    const gameKey = `${site}:${perfId}`;
    if (perfId) {
      getStorage().then((data) => {
        const games = data.games || {};
        if (games[gameKey]) {
          games[gameKey].seats = {};
          chrome.storage.local.set({ games }, () => {
            notifyDataUpdated();
          });
        }
      });
    }
    sendScanToTab(message.productId, message.performanceId, tabId, true);
  }
  if (message.type === "SCAN_PROGRESS") {
    // Forward progress to popup immediately (non-blocking)
    chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      performanceId: message.performanceId,
      completed: message.completed,
      total: message.total,
      status: message.status,
      eta: message.eta,
    }).catch(() => {});

    // Resolve gameKey — may need async storage lookup
    const resolveGameKey = () => {
      const cached = tabId ? tabGameMap[tabId] : null;
      if (cached) return Promise.resolve(cached);
      if (!message.performanceId) return Promise.resolve(null);
      // Fallback: check storage for which site has this perfId
      return getStorage().then((data) => {
        const games = data.games || {};
        const lmsKey = `lms:${message.performanceId}`;
        const resaleKey = `resale:${message.performanceId}`;
        const resolved = games[lmsKey] ? lmsKey : games[resaleKey] ? resaleKey : null;
        if (resolved && tabId) tabGameMap[tabId] = resolved;
        return resolved;
      });
    };

    resolveGameKey().then((gameKey) => {
      if (!gameKey) return;

      // Track scan timing
      if (message.completed === 0 && message.status === "scanning") {
        scanStartTimes[gameKey] = Date.now();
      }

      // Sync to Supabase when scan completes
      if (message.status === "done") {
        const startTime = scanStartTimes[gameKey];
        const durationMs = startTime ? Date.now() - startTime : null;
        delete scanStartTimes[gameKey];
        chrome.storage.local.set({ lastScanTime: Date.now() });
        syncToSupabase(gameKey, durationMs);
      }
    });
  }
});

async function processApiResponse(url, body, tabId) {
  if (!body) return;

  const site = siteFromUrl(url);

  // Match info
  if (url.includes("google-ecommerce-detail") && body.ecommerceViewProduct) {
    const perfId = String(body.ecommerceViewProduct.performanceId);
    await enforceGameLimit(`${site}:${perfId}`);
    await saveMatchInfo(body.ecommerceViewProduct, tabId, site);
  }

  // Availability / price ranges
  if (url.includes("seatmap/availability") && body.priceRangeCategories) {
    const perfId = extractParam(url, "perfId");
    if (perfId) {
      await enforceGameLimit(`${site}:${perfId}`);
      await saveAvailability(perfId, body, tabId, site);
    }
  }

  // Individual seats
  if (url.includes("seats/free") && body.features) {
    const perfId = extractParam(url, "performanceId");
    const prodId = extractParam(url, "productId");
    if (perfId) {
      await enforceGameLimit(`${site}:${perfId}`);
      await saveSeats(perfId, body.features, tabId, site);
      if (prodId) {
        await saveProductId(perfId, prodId, site);
      }
    }
  }

  // Config — also has productId — auto-trigger scan
  if (url.includes("seatmap/config")) {
    const perfId = extractParam(url, "performanceId");
    const prodId = extractParam(url, "productId");
    if (perfId && prodId) {
      await enforceGameLimit(`${site}:${perfId}`);
      await saveProductId(perfId, prodId, site);
      autoScan(perfId, prodId, tabId, site);
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

async function saveMatchInfo(product, tabId, site) {
  const perfId = String(product.performanceId);
  const gameKey = `${site}:${perfId}`;
  const data = await getStorage();
  const games = data.games || {};

  if (!games[gameKey]) games[gameKey] = emptyGame();

  games[gameKey].site = site;
  games[gameKey].match = {
    name: product.name,
    date: product.date,
    currency: product.currency,
    performanceId: perfId,
    imgUrl: product.imgUrl,
  };

  if (tabId) tabGameMap[tabId] = gameKey;
  await chrome.storage.local.set({ games });
}

async function saveAvailability(perfId, body, tabId, site) {
  const gameKey = `${site}:${perfId}`;
  const data = await getStorage();
  const games = data.games || {};

  if (!games[gameKey]) {
    games[gameKey] = emptyGame();
  }

  games[gameKey].site = site;
  games[gameKey].availability = {
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

  // Backfill seat prices from category prices (handles seats arriving before availability)
  const seats = games[gameKey].seats || {};
  const catPrices = {};
  for (const c of games[gameKey].availability.categories) {
    catPrices[c.id] = c.minPrice;
  }
  for (const s of Object.values(seats)) {
    if (s.price == null && s.categoryId && catPrices[s.categoryId]) {
      s.price = catPrices[s.categoryId];
    }
  }

  if (tabId) tabGameMap[tabId] = gameKey;
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

async function saveSeats(perfId, features, tabId, site) {
  const gameKey = `${site}:${perfId}`;
  const data = await getStorage();
  const games = data.games || {};

  if (!games[gameKey]) {
    games[gameKey] = emptyGame();
  }

  games[gameKey].site = site;
  const seats = games[gameKey].seats || {};

  // Build category price lookup from availability (if already loaded).
  // LMS seats often lack per-seat pricing — price comes from the category.
  const catPrices = {};
  if (games[gameKey].availability?.categories) {
    for (const c of games[gameKey].availability.categories) {
      catPrices[c.id] = c.minPrice;
    }
  }

  for (const f of features) {
    const p = f.properties;
    if (!p) continue;

    const seatId = String(p.id);
    const rawPrice = p.amount != null ? p.amount
      : p.seatBasedPriceAmount != null ? p.seatBasedPriceAmount
      : catPrices[p.seatCategoryId] ?? null;
    seats[seatId] = {
      block: p.block?.name?.en || "",
      area: p.area?.name?.en || "",
      row: p.row || "",
      seat: p.number || "",
      category: p.seatCategory || "",
      categoryId: p.seatCategoryId,
      price: rawPrice,
      color: p.color || "",
      exclusive: p.exclusive || false,
      blockId: p.block?.id,
      areaId: p.area?.id,
      tariffId: p.tariffId ?? p.tariff?.id,
      advantageId: p.advantageId ?? p.advantage?.id,
      movementId: p.movementId ?? p.resaleMovementId,
      contingentId: p.contingentId,
      seatQuality: p.seatQuality,
      extent: bboxOf(f.geometry?.coordinates),
      ticketType: p.resaleMovementId ? "resale"
        : (p.seatBasedPriceAmount != null ? "face_value" : "unknown"),
    };
  }

  games[gameKey].seats = seats;
  if (tabId) tabGameMap[tabId] = gameKey;
  await chrome.storage.local.set({ games });
}

async function saveProductId(perfId, productId, site) {
  const gameKey = `${site}:${perfId}`;
  const data = await getStorage();
  const games = data.games || {};
  if (!games[gameKey]) {
    games[gameKey] = emptyGame();
  }
  games[gameKey].site = site;
  games[gameKey].productId = productId;
  await chrome.storage.local.set({ games });
}

// Track which tab+game combos we've already auto-scanned.
// Persisted in chrome.storage.session so state survives SW restarts
// but clears on browser close. Stored as { "tabId:site:perfId": timestamp }.
async function getScannedGames() {
  const data = await chrome.storage.session.get("scannedGames");
  return data.scannedGames || {};
}

async function addScannedGame(key) {
  const sg = await getScannedGames();
  sg[key] = Date.now();
  await chrome.storage.session.set({ scannedGames: sg });
}

async function removeScannedGamesForTab(tabId) {
  const sg = await getScannedGames();
  const prefix = tabId + ":";
  let changed = false;
  for (const k of Object.keys(sg)) {
    if (k.startsWith(prefix)) { delete sg[k]; changed = true; }
  }
  if (changed) await chrome.storage.session.set({ scannedGames: sg });
}

async function autoScan(performanceId, productId, tabId, site) {
  const key = tabId ? `${tabId}:${site}:${performanceId}` : `${site}:${performanceId}`;
  const sg = await getScannedGames();
  if (sg[key]) return;
  await addScannedGame(key);

  const gameKey = `${site}:${performanceId}`;
  // Clear old seats for a fresh snapshot before scanning
  const data = await getStorage();
  const games = data.games || {};
  if (games[gameKey]) {
    games[gameKey].seats = {};
    await chrome.storage.local.set({ games });
  }
  sendScanToTab(productId, performanceId, tabId);
}

// Free tier: only one game at a time — clear old game when switching
async function enforceGameLimit(gameKey) {
  const data = await getStorage();
  const level = data.license?.level || 0;
  if (level >= TIERS.PRO) return;

  const games = data.games || {};
  const existingKeys = Object.keys(games);
  if (existingKeys.length > 0 && !existingKeys.includes(gameKey)) {
    await chrome.storage.local.set({ games: {} });
  }
}

function sendScanToTab(productId, performanceId, tabId, force) {
  chrome.storage.local.get(["scanSpeed", "license", "scanConfig"], (data) => {
    let speed = data.scanSpeed || "balanced";
    const level = data.license?.level || 0;
    // Enforce: non-balanced speeds require Pro
    if (speed !== "balanced" && level < TIERS.PRO) {
      speed = "balanced";
    }
    const msg = {
      type: "START_SCAN",
      productId,
      performanceId,
      scanSpeed: speed,
      scanConfig: data.scanConfig || null,
      force: !!force,
    };
    if (tabId) {
      chrome.tabs.sendMessage(tabId, msg);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, msg);
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
