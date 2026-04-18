// Content script — bridges page context (injected.js) and extension (background.js)
// injected.js runs in MAIN world via manifest, no manual injection needed.

// ─── Seat preselect bridge (?fts_seats=A,B,C) ─────────────────────────────
// When the user clicks a "View these seats" link from an alert email, the
// URL carries an ?fts_seats=<comma-separated seat_ids> param. We need to
// transplant that into Secutix's sessionStorage *before* the seat-picker
// bundle reads it on init, so the picker boots up with our seats already
// selected.
//
// Storage shape (reverse-engineered from stx2js-all.js):
//   sessionStorage["seatMapSelection_<perfId>"] = JSON.stringify({
//     contactNumber: null,
//     data: {
//       selectedSeats: [
//         { seatData: { data: { id, seatId, areaId, area, block, row, number, ... } },
//           numbered: true }
//       ],
//       nonSeatData: {}
//     }
//   })
//
// Seat metadata comes from chrome.storage.local where background.js caches
// every scan as games[<perfId>].seats[<seat_id>]. If a requested seat isn't
// in the cache (user hasn't scanned this match recently), we silently skip
// it and let the picker open without preselect — fail-soft, never break.
(function preselectSeatsFromUrl() {
  const SEAT_PICKER_RE = /\/secure\/selection\/event\/seat\/performance\/(\d+)/;
  const m = location.pathname.match(SEAT_PICKER_RE);
  if (!m) return;
  const perfId = m[1];

  const params = new URLSearchParams(location.search);
  const raw = params.get("fts_seats");
  if (!raw) return;
  const wantedSeatIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (wantedSeatIds.length === 0) return;

  chrome.storage.local.get("games", (data) => {
    try {
      const seats = data?.games?.[perfId]?.seats || {};
      const selectedSeats = [];

      for (const sid of wantedSeatIds) {
        const seat = seats[sid];
        if (!seat) continue; // not in cache — skip silently

        // Build a `data` blob shaped like what Secutix's own seat features
        // carry. Numeric `id` / `seatId` matter — Secutix uses === comparisons.
        const seatIdNum = Number(sid);
        /** @type {Record<string, any>} */
        const data = {
          id: seatIdNum,
          seatId: seatIdNum,
          area: seat.area || "",
          block: seat.block || "",
          row: seat.row || "",
          number: seat.seat || "",
          seatCategory: seat.category || "",
          seatCategoryId: seat.categoryId ?? null,
          amount: seat.price || 0,
          color: seat.color || "",
          exclusive: seat.exclusive !== false,
        };
        // Only set these when we actually captured them — Secutix tolerates
        // missing keys but rejects mismatched ones in some code paths.
        if (seat.areaId != null) data.areaId = seat.areaId;
        if (seat.blockId != null) data.blockId = seat.blockId;
        if (seat.tariffId != null) data.tariffId = seat.tariffId;
        if (seat.advantageId != null) data.advantageId = seat.advantageId;
        if (seat.movementId != null) data.movementId = seat.movementId;

        selectedSeats.push({ seatData: { data }, numbered: true });
      }

      if (selectedSeats.length === 0) return;

      const entry = {
        contactNumber: null,
        data: {
          selectedSeats,
          nonSeatData: {},
        },
      };
      sessionStorage.setItem(
        "seatMapSelection_" + perfId,
        JSON.stringify(entry)
      );

      // Strip the param from the visible URL so reloads / bookmarks don't
      // re-trigger the bridge and so the URL stays clean.
      params.delete("fts_seats");
      const newSearch = params.toString();
      const newUrl = location.pathname + (newSearch ? "?" + newSearch : "") + location.hash;
      history.replaceState(null, "", newUrl);
    } catch (e) {
      // Never break the page — log and move on.
      console.warn("[FIFA Ticket Scout] preselect bridge error:", e);
    }
  });
})();

// Listen for messages from injected code
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  if (event.data?.type === "FIFA_TICKET_SCOUT") {
    chrome.runtime.sendMessage({
      type: "API_RESPONSE",
      url: event.data.url,
      body: event.data.body,
    });
  }

  if (event.data?.type === "FIFA_TICKET_SCOUT_SCAN_PROGRESS") {
    chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      performanceId: event.data.performanceId,
      completed: event.data.completed,
      total: event.data.total,
      status: event.data.status,
      eta: event.data.eta,
    });
  }
});

// Listen for scan commands from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_SCAN") {
    window.postMessage({
      type: "FIFA_TICKET_SCOUT_SCAN",
      productId: message.productId,
      performanceId: message.performanceId,
      scanSpeed: message.scanSpeed,
      scanConfig: message.scanConfig || null,
      force: message.force || false,
    }, "*");
  }
});
