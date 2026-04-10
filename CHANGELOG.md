# Changelog

All notable changes to FIFA Ticket Scout are documented here. Timestamps are in Eastern Time (ET).

---

## April 10, 2026

### Retry Blocked Tiles — 6:31 PM ET
When a tile gets blocked by bot detection (403), it's now retried after a 3-second cooldown instead of being permanently skipped. Blocked tiles are collected during the first pass, then retried as a batch. If still blocked, the scan completes with partial data instead of failing entirely.

**Files changed:** `injected.js`

### Clear Seats on Tab Re-navigate — 5:45 PM ET
When navigating back to a previously scanned game on the same tab, old seat data is now cleared before the fresh scan starts. Also clears scanned state on page refresh via `chrome.tabs.onUpdated` so auto-scan always fires on reload.

**Files changed:** `background.js`

### Resilient 403 Handling — 4:30 PM ET
Intermittent 403 blocks from DataDome are now skipped instead of aborting the entire scan. Only aborts after 3 consecutive blocks. Removed exponential backoff on 403s. Broadened CAPTCHA detection to catch any non-JSON 403/429 response.

**Files changed:** `injected.js`

### 10k Tile Grid (Mimics Site Pattern) — 3:00 PM ET
Switched from a variable-size tile grid (20k/50k) to a fixed 4×4 grid of 10k×10k tiles covering 0-40k coordinate space. This matches the tile sizes and alignment the FIFA site's own client uses when a user clicks through blocks. Speed profiles now only control delay between tiles (16 tiles for all speeds). Significantly reduces bot detection triggers.

**Files changed:** `injected.js`

### Multi-Tab Support — 2:00 PM ET
Multiple games can now be open in different tabs simultaneously. The popup auto-detects which game to show based on the active tab's URL. Scans route to the correct tab via `tabId` tracking. No more game data being wiped when switching between matches. Tab cleanup on close.

**Files changed:** `background.js`, `popup.js`

### Scan Speed UI — 12:00 PM ET
Added scan speed selector (Stealth, Cautious, Balanced, Aggressive) in the match header with emoji buttons. Pill progress indicator shows scan percentage and elapsed time. Speed selection persists across popup open/close. Match info caching prevents UI flicker during scan updates.

**Files changed:** `popup.js`, `popup.html`, `popup.css`, `background.js`, `content.js`, `injected.js`

### $NaN Price Fix — 11:00 AM ET
Seats with null/undefined prices are now filtered out of the dashboard and CSV export. Prevents "$NaN" from appearing in the stats bar.

**Files changed:** `popup.js`

---

## April 6, 2026

### Etsy Shop Links — 9:18 AM ET
Added links to My Son's Etsy Shop (fidgetforge6.etsy.com) in two places: replaced the refresh button in the header with an Etsy "E" icon (orange hover, tooltip "My Son's Etsy Shop"), and replaced the GitHub footer link with an Etsy footer link.

**Files changed:** `popup.html`, `popup.css`, `popup.js`

### Filter Out In-Cart Seats — 9:15 AM ET
Seats with `exclusive=false` (likely locked in another user's cart but not yet purchased) are now excluded from the dashboard and CSV export. These seats appear in the API data but aren't actually available to buy, so showing them was misleading.

**Files changed:** `popup.js`

---

## April 5, 2026

### Fix Clear & Rescan Not Recapturing Data — 11:27 AM ET
Fixed bug where refreshing the page after Clear & Rescan wouldn't recapture seat data. Root cause: the `scannedGames` Set in the background service worker wasn't cleared when storage was wiped, so `autoScan` thought it had already scanned. Now sends `CLEAR_DATA` message to the background to reset both storage and in-memory state.

**Files changed:** `background.js`, `popup.js`

### Clear & Rescan Button — 11:09 AM ET
Renamed "Scan All Sections" to "Clear & Rescan". Clicking it now clears all captured data and prompts the user to refresh their browser to repull fresh data. Simpler and more predictable than the previous background scan approach.

**Files changed:** `popup.js`, `popup.html`

### Clear Seats Before Scan — 8:12 PM ET (Apr 4)
When a scan is triggered, existing seats for the game are now cleared first so the results are a fresh snapshot rather than accumulating stale data.

**Files changed:** `background.js`

---

## April 4, 2026

### Persist Filter State — 5:45 PM ET
Category tab and seats-together selections now persist when the popup is closed and reopened. Previously all filters reset to defaults every time. Uses `chrome.storage.local` to save and restore state.

**Files changed:** `popup.js`

### Context-Aware Empty States — 5:30 PM ET
The popup now detects whether you're on the FIFA site, a seat map, or elsewhere, and shows contextual guidance instead of a generic "No data captured yet" message. Includes an "Open FIFA Resale Site" button when off-site. Removed redundant refresh button. Larger, cleaner logo in empty state. Added `tabs` permission.

**Files changed:** `popup.js`, `popup.html`, `popup.css`, `manifest.json`

### "Seats Together" Multi-Select Toggle — 5:02 PM ET
Redesigned the seats-together filter from single-select "N+" buttons to multi-select toggle buttons (`1 | 2 | 3 | 4 | 5 | 6+`). All sizes are ON by default. Users toggle OFF sizes they don't want — for example, turning off "1" hides single seats. Multiple selections are supported (e.g. only "2" and "3" active). "6+" covers clusters of 6–8 consecutive seats. Toggling all off resets to all ON. Stats, histogram, and Best Deals all update to reflect the filter.

**Files changed:** `popup.js`

### Scan Reliability: Jitter, Backoff & ETA — 4:39 PM ET
Merged scan improvements: randomized delay between requests (200–700ms jitter), exponential backoff on failures (2s → 15s cap), and estimated time remaining in the progress bar (e.g. "42% · ~12s left").

**Files changed:** `injected.js`, `popup.js`, `background.js`, `content.js`

### "Seats Together" Filter — 12:49 PM ET
Added toggle buttons for filtering seat clusters by group size. Filter acts as a primary control — stats, histogram, and Best Deals all update to reflect the selected group sizes. Shows a seat count badge when filtering is active.

**Files changed:** `popup.js`, `popup.css`

### Fix Host Permission Wildcard — 8:01 AM ET
Fixed an invalid wildcard pattern in `manifest.json`. Changed host permissions to use the correct `*.tickets.fifa.com` glob pattern, resolving extension load errors on some Chrome versions.

**Files changed:** `manifest.json`

### Support All FIFA Resale Currency Subdomains — 7:52 AM ET
Updated `manifest.json` host permissions and content script matches to work across all FIFA resale subdomains (e.g. `fwc26-resale-usd.tickets.fifa.com`, `fwc26-resale-cad.tickets.fifa.com`, `fwc26-resale-eur.tickets.fifa.com`, etc.) instead of only the USD subdomain.

**Files changed:** `manifest.json`

---

## April 3, 2026

### Load-from-Source Install Instructions — 11:24 PM ET
Added step-by-step instructions to the README for installing the extension directly from source via Chrome's "Load unpacked" developer mode, as an alternative to the Chrome Web Store.

**Files changed:** `README.md`

### Screenshots in README — 11:13 PM ET
Added screenshot images to the README showing the extension dashboard and Best Deals view.

**Files changed:** `README.md`

### Privacy Policy, Store Assets & Permissions — 11:04 PM ET
Created a full privacy policy (`PRIVACY.md`) documenting that all data stays local with no external transmission. Added Chrome Web Store promotional images and screenshots to `store-assets/`. Updated `STORE_LISTING.md` with detailed permission justifications for the store review process.

**Files changed:** `PRIVACY.md`, `STORE_LISTING.md`, and 5 image assets added to `store-assets/`

### ISC License & README Disclaimer — 10:23 PM ET
Added the ISC open-source license (`LICENSE`). Added a disclaimer to the README noting the extension is for educational/personal use and that users are responsible for compliance with FIFA's terms of service.

**Files changed:** `LICENSE`, `README.md`

### Chrome Web Store Listing Copy (PR #1) — 10:05 PM ET
Merged PR #1 with two changes:
- Rewrote the README to accurately reflect the extension's real behavior: API interception (not scraping), auto-scan functionality, price distribution histograms, and CSV export
- Created `STORE_LISTING.md` with full Chrome Web Store submission copy including short/long descriptions, category tags, and a submission checklist

**Files changed:** `README.md`, `STORE_LISTING.md`

### Initial Release — 9:32 PM ET
First commit of FIFA Ticket Scout, a Chrome extension (Manifest V3) for tracking real-time FIFA World Cup 2026 resale ticket prices. Core features:
- Automatic interception of FIFA ticketing API responses (fetch and XHR patching)
- Background service worker for data processing and seat deduplication
- Multi-layer messaging architecture (injected.js → content.js → background.js → popup.js)
- Full seat map scan via 5x5 tile grid covering the 100,000x100,000 coordinate space
- Interactive popup dashboard with match info, price stats, category tabs, price distribution histogram, and "Best Deals" consecutive-seat clustering
- Block breakdown table with per-section price ranges
- CSV export with match metadata
- Auto-scan triggered on new match detection

**Files added:** `background.js`, `content.js`, `injected.js`, `manifest.json`, `popup.html`, `popup.js`, `popup.css`, icons, `.gitignore`, `README.md` (12 files, ~2,150 lines)
