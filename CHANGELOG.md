# Changelog

All notable changes to FIFA Ticket Scout are documented here. Timestamps are in Eastern Time (ET).

---

## April 13, 2026

### Cloud Restore for Alerts + "Picks Are Final" Warning — 1:00 AM ET
Added a `get-alerts` Edge Function so the extension can rehydrate the Alerts tab from Supabase whenever the local cache is missing or stale. Previously, if `chrome.storage.local.alertConfigs` was lost (extension reinstall, new browser, new machine, profile switch, Chrome Sync reset, or — until earlier today — a Clear & Rescan click), the Alerts tab would show as empty even though the dispatcher was still firing emails to the user from the server-side `alert_configs` row. Worse, re-saving with a different email would hit the email-lock 403 with no way for the user to recover. Now: every Alerts tab open does a cloud fetch first using the user's license key, falls back to local cache only on network/server failure, and shows a small "⚠ Offline — cached picks" chip in the header when running offline. Server is always the source of truth on conflict; local cache is purely an offline fallback. New `FETCH_ALERTS` message type in the background service worker, mirroring the existing `SAVE_ALERTS` structure (license verify → hash → service-role read on `alert_configs`).

Also added a prominent orange warning banner at the top of the Alerts tab (before first save only) reminding users that match picks are final after saving — only price thresholds can change later. Disappears once `gamesLocked` becomes true so it doesn't nag users who already committed.

**Files changed:** `extension/background.js`, `extension/popup.js`, `extension/popup.css`, `CHANGELOG.md`
**Files added:** `supabase/functions/get-alerts/index.ts`

### Fix: Clear & Rescan No Longer Wipes Alerts — 12:00 AM ET
The "Clear & Rescan" and "Clear Data" buttons on the Scanner tab were silently destroying the user's saved Alerts tab picks (matches, thresholds, category, seats) as a side effect. Root cause: the `CLEAR_DATA` background handler used `chrome.storage.local.clear()` and manually rescued only the `license` key, so any other top-level key (including `alertConfigs` and `visitorId`) got nuked. Replaced the clear-then-restore dance with a surgical `chrome.storage.local.remove("games")` — only the captured scan data is removed, everything else (Alerts picks, license, visitor ID, scan speed preference, filter state) is untouched. Forward-compatible: any future storage key automatically survives by default. Also fixes a silent secondary bug where `visitorId` (the anonymous Supabase attribution key) was being regenerated on every Clear & Rescan, inflating "unique scanners" stats and breaking per-user scan history correlation on the backend.

**Files changed:** `background.js`

---

## April 12, 2026

### Alerts Tab — Pro + Web + Alerts Tier — 10:00 PM ET
Added a third tab to the popup ("Alerts") for Pro + Web + Alerts ($49.99) users. Pick up to 3 World Cup matches, set a price threshold per match (3 modes: % of face value, $ offset from face, or absolute $), choose a category filter (Any / CAT 1 / CAT 2 / CAT 3) and number of seats needed. Picks are saved to Supabase via a new `save-alerts` Edge Function that verifies the Gumroad license server-side and locks the user's email + chosen matches. Threshold drawer features a custom range slider with a green "deal zone" (gradient fill that follows the thumb) and a live example that updates in real time as the user drags. Free / lower-tier users see an upgrade prompt instead of the picker. Match list is searchable + filterable by stage and country. Locked picks show as read-only after first save; only thresholds can be adjusted.

**Files changed:** `popup.js`, `popup.css`, `popup.html`, `background.js`
**Files added:** `supabase/functions/save-alerts/index.ts`

### Threshold Slider — 3-Mode Price Targeting — 9:00 PM ET
Replaced the original "Below face / Custom $" segmented control in the Alerts threshold drawer with a slider supporting three modes:
- **% vs Face** (default): -50% to +300%, snaps to 5% steps
- **$ vs Face**: -$500 to +$3000, snaps to $100 steps
- **Absolute $**: $0 to $5000, snaps to $50 steps

Slider track has a green fill that tracks the thumb, current value displayed above as a label (`+10%` / `Face` / `+$250` / `$550`), and a live example sentence using a fixed $500 reference face value for easy mental math (e.g. "If face value is $500, at +20%, you'll be alerted when the price drops at or below $600."). The Absolute mode is honest: "Ignore face value, you'll be alerted when the price drops at or below $X." Pick summary line shows the user's intent compactly: `≤+10% vFace · Any · 2tix` instead of just dollars. Threshold dollar value resolved at save time using the actual face value from the `face_values` table.

**Files changed:** `popup.js`, `popup.css`

### `alerts_sent` Audit Table + Dispatcher Dedup Hooks — 8:30 PM ET
Added an `alerts_sent` table to track every email the (forthcoming) dispatcher fires. Each row captures `license_hash`, `email`, `match_number`, `performance_id`, `threshold`, `fired_price`, `category`, and `fired_at`. Indexed on `(license_hash, match_number, fired_at DESC)` for fast dedup lookups. RLS locks it down to service-role only. Used by the dispatcher to enforce: 24-hour cooldown per `(license, match)` pair, with a re-fire allowed if the new price is at least 10% lower than the last fired price (meaningful re-drop only).

**Files changed:** `supabase/schema.sql`

### `alert_configs_history` Audit Log — 8:00 PM ET
Added an `alert_configs_history` table that captures every save against `alert_configs` (insert or update) as an immutable row. Lets us see how a user's picks evolve over time without rewriting the live `alert_configs` row. The `save-alerts` Edge Function appends to history on every successful save (best-effort — failure here doesn't fail the user's save). Indexed on `(license_hash, saved_at DESC)` and `(saved_at DESC)`. RLS service-role only.

**Files changed:** `supabase/schema.sql`, `supabase/functions/save-alerts/index.ts`

### Seat Preselect Bridge Scaffolding (Inactive — Future Feature) — 7:30 PM ET
Added the client-side scaffolding for an "email link → preselected seats" feature: when the dispatcher's alert email link includes `?fts_seats=A,B`, the extension's `content.js` content script parses the param, looks up rich seat metadata from `chrome.storage.local`, and writes to the FIFA seat picker's sessionStorage so the picker boots with those seats already highlighted. `background.js` now captures additional FIFA seat fields (`blockId`, `areaId`, `tariffId`, `advantageId`, `movementId`) per scan to support this. **Currently inactive** — the storage shape needs to be reverse-engineered against the live FIFA SPA (the legacy Secutix shape this was built against has been replaced by a newer frontend); the bridge writes to a key the SPA doesn't read, which is a silent no-op. No user-facing impact until the bridge is rewritten and the dispatcher starts emitting `?fts_seats=` URLs.

**Files changed:** `background.js`, `content.js`

### Supabase Composite Indexes + Match Schedule Performance IDs — 6:00 PM ET
Added composite indexes to `scan_snapshots` for the most common query patterns: `(performance_id, scanned_at DESC)` and `(visitor_id, scanned_at DESC)`. Backfilled `performance_id` into the `match_schedule` table so dispatcher and webapp can resolve match → performance_id without a join through `match_summary`.

**Files changed:** `supabase/schema.sql`, `supabase/seed_match_schedule.sql`

### Seats Table Reflects Current Availability — 5:00 PM ET
Changed `ingest-scan` from upsert-by-seat-id to delete-then-insert per match. Old behavior left stale rows in `seats` for seats that had since been bought — every scan would silently grow the table. Now each scan deletes all rows for that `performance_id` first and inserts the fresh set, so `seats` always reflects the current availability snapshot from the most recent scanner. `first_seen_at` is set to the same timestamp as `last_seen_at` since we no longer track historical first-sightings (use `scan_snapshots` for that).

**Files changed:** `supabase/functions/ingest-scan/index.ts`

### Match Schedule Seed (Full Country Names) — 4:00 PM ET
Added `supabase/seed_match_schedule.sql` containing all 104 World Cup 2026 matches with date, stage, city, home/away teams (full English country names like "United States" not "USA"), and `matchup` fallback for TBD knockout fixtures. Public read RLS for the extension's anon key.

**Files added:** `supabase/seed_match_schedule.sql`

### Face Values Seed — 3:00 PM ET
Added `supabase/seed_face_values.sql` with FIFA's official face value per category (CAT 1/2/3) for all 104 World Cup 2026 matches, taken from the December 11, 2025 randomized drawing. Public read RLS so the extension and dispatcher can resolve `(match_number, category) → face_value` without needing a service-role key.

**Files added:** `supabase/seed_face_values.sql`

### Version Update Checker + Footer Link — 2:00 PM ET
Extension now checks GitHub for the latest version (via raw `manifest.json`) on popup open, debounced to once every 6 hours via `chrome.alarms`. Shows a banner at the top of the popup if a newer version is available, with a one-click link to the Chrome Web Store listing. Added a `fifaticketscout.com` link to the popup footer alongside Buy Me a Coffee and the Etsy shop. Bumped extension version to **2.1.0**.

**Files changed:** `popup.js`, `popup.html`, `popup.css`, `background.js`, `manifest.json`

---

## April 11, 2026

### Supabase Data Sync — 5:30 PM ET
Every completed scan now syncs seat data to Supabase. All users (free and Pro) contribute crowdsourced data. Each install gets an anonymous visitor ID. Scan history is preserved as full snapshots for future price trend analysis. Match summaries are aggregated per match with hourly snapshots for trend charts. Sync is fire-and-forget — never blocks scanning, silently fails if backend is unreachable.

**Files changed:** `background.js`, `manifest.json`
**Files added:** `supabase/schema.sql`, `supabase/functions/ingest-scan/index.ts`

### Pro Tier & License Key System — 12:00 AM ET
Added Gumroad-based license key verification with a numeric tier system (level 0/10/20/30). Free users get Balanced scan speed and single-game storage. Pro users (level 10+) unlock Stealth, Cautious, and Aggressive scan speeds plus multi-tab support. License section in the popup with activation/deactivation UI. Re-verifies license every 24 hours via `chrome.alarms`. Extension works identically if Gumroad is unreachable (cached license). License provider is modular — one function to swap if we change payment providers.

**Files changed:** `background.js`, `popup.js`, `popup.html`, `popup.css`, `manifest.json`

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
