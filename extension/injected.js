// Runs in PAGE context — intercepts fetch/XHR responses
// and relays matching ones back to the content script via postMessage

(function () {
  if (window.__fifaTicketScoutLoaded) return;
  window.__fifaTicketScoutLoaded = true;
  console.log("[FIFA Ticket Scout] Injected script loaded successfully");
  const MATCH_PATTERNS = ["/seatmap/", "/performance/"];

  function shouldCapture(url) {
    return MATCH_PATTERNS.some((p) => url.includes(p));
  }

  // Capture headers from real requests so the scan can reuse them
  let capturedHeaders = null;

  // Patch fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    // Capture headers from any seatmap request the page makes
    if (shouldCapture(url) && !capturedHeaders) {
      const init = args[1] || {};
      if (init.headers) {
        capturedHeaders = init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : { ...init.headers };
        console.log("[FIFA Ticket Scout] Captured request headers");
      }
    }

    const response = await originalFetch.apply(this, args);

    if (shouldCapture(url)) {
      try {
        const clone = response.clone();
        const body = await clone.json();
        window.postMessage(
          { type: "FIFA_TICKET_SCOUT", url, body },
          "*"
        );
      } catch {
        // not JSON or parse error
      }
    }

    return response;
  };

  // Patch XMLHttpRequest — also capture headers
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ftsUrl = url;
    this._ftsHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._ftsHeaders) {
      this._ftsHeaders[name] = value;
    }
    return originalSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._ftsUrl && shouldCapture(this._ftsUrl)) {
      // Capture headers from real XHR requests
      if (!capturedHeaders && this._ftsHeaders && Object.keys(this._ftsHeaders).length > 0) {
        capturedHeaders = { ...this._ftsHeaders };
        console.log("[FIFA Ticket Scout] Captured XHR headers");
      }

      this.addEventListener("load", function () {
        try {
          const body = JSON.parse(this.responseText);
          window.postMessage(
            { type: "FIFA_TICKET_SCOUT", url: this._ftsUrl, body },
            "*"
          );
        } catch {
          // not JSON
        }
      });
    }
    return originalSend.apply(this, args);
  };

  // Listen for scan commands from the content script
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "FIFA_TICKET_SCOUT_SCAN") return;

    const { productId, performanceId, scanSpeed, scanConfig: cfg } = event.data;
    if (!productId || !performanceId) return;
    console.log("[FIFA Ticket Scout] Scan started for", performanceId, "speed:", scanSpeed || "balanced");

    // Build headers — use captured ones or construct minimal required set
    const headers = capturedHeaders
      ? { ...capturedHeaders }
      : {
          "Accept": "application/json",
          "X-Secutix-Host": window.location.hostname,
          "X-Secutix-SecretKey": "DUMMY",
        };

    // Ensure required headers are present
    if (!headers["X-Secutix-Host"]) {
      headers["X-Secutix-Host"] = window.location.hostname;
    }
    if (!headers["X-Secutix-SecretKey"]) {
      headers["X-Secutix-SecretKey"] = "DUMMY";
    }

    // Also try to get CSRF token from the page if not in headers
    if (!headers["X-CSRF-Token"]) {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta) headers["X-CSRF-Token"] = csrfMeta.content;
    }

    console.log("[FIFA Ticket Scout] Using headers:", Object.keys(headers).join(", "));

    // Scan config — remote values from DB, with hardcoded fallbacks
    const SPEED_PROFILES = (cfg && cfg.profiles) || {
      aggressive: { min: 0,    max: 0 },
      balanced:   { min: 600,  max: 1000 },
      cautious:   { min: 1200, max: 1800 },
      stealth:    { min: 1300, max: 2700 },
    };
    const baseUrl = `/tnwr/v1/secure/seatmap/seats/free/ol`;
    const tileSize = (cfg && cfg.tile_size) || 10000;
    const mapMax = (cfg && cfg.map_max) || 40000;
    const MAX_CONSECUTIVE_BLOCKS_CFG = (cfg && cfg.max_consecutive_blocks) || 3;
    const retryCooldown = (cfg && cfg.retry_cooldown_ms) || 3000;

    // Build tile grid
    const tiles = [];
    for (let x = 0; x < mapMax; x += tileSize) {
      for (let y = 0; y < mapMax; y += tileSize) {
        tiles.push({ x, y, w: tileSize, h: tileSize });
      }
    }
    const totalTiles = tiles.length;

    const profile = SPEED_PROFILES[scanSpeed] || SPEED_PROFILES.balanced;
    const DELAY_MIN = profile.min;
    const DELAY_MAX = profile.max;
    const AVG_DELAY = (DELAY_MIN + DELAY_MAX) / 2;

    if (cfg) {
      console.log("[FIFA Ticket Scout] Using remote scan config:", JSON.stringify(cfg).substring(0, 200));
    }

    let completed = 0;
    let foundSeats = 0;
    let consecutiveBlocks = 0;
    let consecutiveEmpties = 0;
    let foundAnySeats = false;
    const MAX_CONSECUTIVE_BLOCKS = MAX_CONSECUTIVE_BLOCKS_CFG;
    const MAX_CONSECUTIVE_EMPTIES = Math.max(Math.floor(totalTiles / 4), 5);

    window.postMessage({
      type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
      performanceId,
      completed: 0,
      total: totalTiles,
      status: "scanning",
      eta: Math.round((totalTiles * AVG_DELAY) / 1000),
    }, "*");

    let aborted = false;
    let abortReason = null;

    // Scan a list of tiles, return any that were blocked
    async function scanTiles(tilesToScan) {
      const blocked = [];
      for (const tile of tilesToScan) {
        if (aborted) break;
        if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
          console.log("[FIFA Ticket Scout] Rate limited — stopping after", MAX_CONSECUTIVE_BLOCKS, "consecutive blocks");
          window.postMessage({
            type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
            performanceId,
            completed: totalTiles,
            total: totalTiles,
            status: "captcha",
          }, "*");
          abortReason = "captcha";
          aborted = true;
          break;
        }
        if (foundAnySeats && consecutiveEmpties >= MAX_CONSECUTIVE_EMPTIES) {
          console.log("[FIFA Ticket Scout] Stopping early — no more seats in remaining tiles");
          aborted = true;
          break;
        }

        const bbox = tile.x + "," + tile.y + "," + tile.w + "," + tile.h;
        const url = baseUrl + "?productId=" + productId + "&performanceId=" + performanceId + "&isSeasonTicketMode=false&advantageId=&isModifyAllSeatsMode=false&ppid=&reservationIdx=&crossSellId=&baseOperationIdsString=&bbox=" + bbox + "&isExclusive=true";

        try {
          const resp = await originalFetch(url, {
            credentials: "include",
            headers,
          });
          if (resp.ok) {
            consecutiveBlocks = 0;
            const body = await resp.json();
            const count = body.features ? body.features.length : 0;
            if (count > 0) {
              foundSeats += count;
              foundAnySeats = true;
              consecutiveEmpties = 0;
              console.log("[FIFA Ticket Scout] Tile found", count, "seats (total:", foundSeats + ")");
            } else {
              if (foundAnySeats) consecutiveEmpties++;
            }
            window.postMessage(
              { type: "FIFA_TICKET_SCOUT", url: window.location.origin + url, body },
              "*"
            );
          } else {
            const ct = resp.headers.get("content-type") || "";
            if ((resp.status === 403 || resp.status === 429) && !ct.includes("application/json")) {
              consecutiveBlocks++;
              blocked.push(tile);
              console.log("[FIFA Ticket Scout] Tile blocked (", resp.status, ") —", consecutiveBlocks, "consecutive");
            } else {
              const errText = await resp.text().catch(() => "");
              console.log("[FIFA Ticket Scout] Tile failed:", resp.status, errText.substring(0, 200));
            }
          }
        } catch (err) {
          console.log("[FIFA Ticket Scout] Scan tile error:", err.message);
          blocked.push(tile);
        }

        completed++;
        const remaining = totalTiles - completed;
        const eta = Math.round((remaining * (AVG_DELAY + 500)) / 1000);
        window.postMessage({
          type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
          performanceId,
          completed,
          total: totalTiles,
          status: "scanning",
          eta,
        }, "*");

        const jitter = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
        await new Promise((r) => setTimeout(r, jitter));
      }
      return blocked;
    }

    // First pass
    const blockedTiles = await scanTiles(tiles);

    // Retry pass — wait a few seconds then retry blocked tiles
    if (blockedTiles.length > 0 && !aborted) {
      console.log("[FIFA Ticket Scout] Retrying", blockedTiles.length, "blocked tiles in", Math.round(retryCooldown / 1000) + "s...");
      await new Promise((r) => setTimeout(r, retryCooldown));
      consecutiveBlocks = 0;
      completed = totalTiles - blockedTiles.length;
      const stillBlocked = await scanTiles(blockedTiles);
      if (stillBlocked.length > 0) {
        console.log("[FIFA Ticket Scout]", stillBlocked.length, "tiles still blocked after retry");
      }
    }

    // Always send a terminal status — either "done" or "captcha"
    if (abortReason === "captcha") {
      // captcha status already sent inside scanTiles, but ensure progress shows 100%
      window.postMessage({
        type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
        performanceId,
        completed: totalTiles,
        total: totalTiles,
        status: "captcha",
      }, "*");
    } else {
      window.postMessage({
        type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
        performanceId,
        completed: totalTiles,
        total: totalTiles,
        status: "done",
      }, "*");
    }
    console.log("[FIFA Ticket Scout] Scan", aborted ? "aborted (" + (abortReason || "early stop") + ")" : "complete", ":", foundSeats, "seats found");
  });
})();
