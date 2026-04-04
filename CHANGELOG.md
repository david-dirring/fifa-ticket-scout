# Changelog

All notable changes to FIFA Ticket Scout are documented here. Timestamps are in Eastern Time (ET).

---

## [Unreleased]

### Scan Reliability Improvements (branch: `claude/scan-jitter-backoff-eta`)
- Randomized delay between scan requests (200–700ms jitter) to reduce CAPTCHA/bot detection triggers
- Added exponential backoff on failed requests (2s, 4s, 8s, up to 15s cap) instead of immediately counting toward the abort threshold
- Scan progress bar now shows estimated time remaining (e.g. "42% · ~12s left")

---

## April 4, 2026

### "Seats Together" Filter — 12:49 PM ET
Moved the together filter to the top of the content area (directly below category tabs) so it acts as a primary filter. Selecting a value like "3+" now filters the stats (cheapest/median/highest), the price distribution histogram, and the Best Deals cluster list — all update to reflect only seats from groups of that size or larger. Shows a seat count badge when filtering is active.

**Files changed:** `popup.js`, `popup.css`

### "Seats Together" Filter (initial) — 12:41 PM ET
Added a row of toggle buttons (`Any | 2 | 3 | 4 | 5 | 6`) to the Best Deals section, allowing users to filter seat clusters by minimum group size. For example, selecting "4" shows only groups where 4 or more consecutive same-price seats are available. Defaults to "Any" (no filtering).

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
