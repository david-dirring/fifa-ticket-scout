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

    const { productId, performanceId } = event.data;
    if (!productId || !performanceId) return;
    console.log("[FIFA Ticket Scout] Scan started for", performanceId);

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

    const baseUrl = `/tnwr/v1/secure/seatmap/seats/free/ol`;
    const tileSize = 20000;
    const mapMax = 100000;
    const exclusiveValues = [true, false];

    let completed = 0;
    let foundSeats = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 5;
    const totalTiles = Math.ceil(mapMax / tileSize) * Math.ceil(mapMax / tileSize) * exclusiveValues.length;

    window.postMessage({
      type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
      completed: 0,
      total: totalTiles,
      status: "scanning",
    }, "*");

    let aborted = false;
    for (const isExclusive of exclusiveValues) {
      if (aborted) break;
      for (let x = 0; x < mapMax; x += tileSize) {
        if (aborted) break;
        for (let y = 0; y < mapMax; y += tileSize) {
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.warn("[FIFA Ticket Scout] Aborting scan after", MAX_CONSECUTIVE_FAILURES, "consecutive failures");
            aborted = true;
            break;
          }

          const bbox = x + "," + y + "," + tileSize + "," + tileSize;
          const url = baseUrl + "?productId=" + productId + "&performanceId=" + performanceId + "&isSeasonTicketMode=false&advantageId=&isModifyAllSeatsMode=false&ppid=&reservationIdx=&crossSellId=&baseOperationIdsString=&bbox=" + bbox + "&isExclusive=" + isExclusive;

          try {
            const resp = await originalFetch(url, {
              credentials: "include",
              headers,
            });
            if (resp.ok) {
              consecutiveFailures = 0;
              const body = await resp.json();
              const count = body.features ? body.features.length : 0;
              if (count > 0) {
                foundSeats += count;
                console.log("[FIFA Ticket Scout] Tile found", count, "seats (total:", foundSeats + ")");
              }
              window.postMessage(
                { type: "FIFA_TICKET_SCOUT", url: window.location.origin + url, body },
                "*"
              );
            } else {
              consecutiveFailures++;
              const errText = await resp.text().catch(() => "");
              if (consecutiveFailures === 1) {
                console.warn("[FIFA Ticket Scout] Tile failed:", resp.status, errText.substring(0, 200));
              }
            }
          } catch (err) {
            consecutiveFailures++;
            console.warn("[FIFA Ticket Scout] Scan tile error:", err.message);
          }

          completed++;
          window.postMessage({
            type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
            completed,
            total: totalTiles,
            status: completed >= totalTiles ? "done" : "scanning",
          }, "*");

          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }

    window.postMessage({
      type: "FIFA_TICKET_SCOUT_SCAN_PROGRESS",
      completed: totalTiles,
      total: totalTiles,
      status: "done",
    }, "*");
    console.log("[FIFA Ticket Scout] Scan", aborted ? "aborted" : "complete", ":", foundSeats, "seats found");
  });
})();
