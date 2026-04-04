# Changelog

All notable changes to FIFA Ticket Scout are documented here. Timestamps are in Eastern Time (ET).

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
