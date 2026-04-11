# FIFA Ticket Scout — Handoff for New Claude Code Session

## What This Is
A Chrome extension (Manifest V3, vanilla JS, no frameworks) that scans the FIFA World Cup 2026 resale ticket site and shows a dashboard of all available seats and prices. 500+ Reddit upvotes, 100K+ views, 39+ Chrome Web Store users.

## Repo Structure
- **Public repo:** `david-dirring/fifa-ticket-scout` (origin)
- **Private repo:** `david-dirring/fifa-ticket-scout-private` (private remote)
- **Current branch:** `optimize-scan` (ahead of main with scan improvements + multi-tab)
- **Main branch:** stable, published to Chrome Web Store as v1.1.0

## Key Branches
- `main` — stable, public, on Chrome Web Store
- `optimize-scan` — all scan optimizations, multi-tab support, 403 resilience. NOT merged to main yet. This is the branch to build Pro features on.

## Extension Architecture
```
injected.js (MAIN world) → patches fetch/XHR to intercept API responses
    ↓ window.postMessage
content.js (isolated world) → bridges page context to extension
    ↓ chrome.runtime.sendMessage
background.js (service worker) → processes data, stores to chrome.storage.local
    ↓ chrome.runtime.sendMessage
popup.js + popup.html + popup.css → dashboard UI
```

## How the Scan Works
- `seatmap/config` API response triggers `autoScan()`
- Scans a 4×4 grid of 10k×10k tiles covering 0-40k coordinate space (mimics what the FIFA site's own client sends when a user clicks blocks)
- `isExclusive=true` only (exclusive=false are in-cart seats, filtered out)
- Speed selector: Stealth/Cautious/Balanced/Aggressive controls delay between tiles
- Resilient to intermittent 403s (DataDome bot detection) — skips blocked tiles, retries after 3s cooldown
- Multi-tab: tracks `tabId→perfId`, routes scans to correct tab, popup auto-detects game from active tab URL

## Key Technical Decisions Already Made
1. **10k tiles, not 20k** — matches the site's native tile pattern, avoids DataDome triggers
2. **No `isExclusive=false` pass** — same seats returned, was redundant
3. **`exclusive=false` seats filtered in popup** — they're in someone's cart, not actually available
4. **`world: "MAIN"` for injected.js** — Chrome injects directly into page context, no script element injection race
5. **`tabs` permission added** — for context-aware empty states and multi-tab URL detection
6. **Scan speed persisted** in `chrome.storage.local`
7. **No `activeGame` global** — popup reads perfId from active tab URL instead

## What's on `optimize-scan` (not yet on main)
- 10k tile grid (was 20k variable)
- Multi-tab support (tabGameMap, per-tab scan routing)
- Scan speed UI with emoji buttons + pill progress
- Resilient 403 handling (skip + retry)
- Clear seats on re-navigate
- $NaN price fix
- Match info caching (prevents flicker)
- All `console.warn` → `console.log` (no error page noise)

## What's Next: Pro Build Plan
The user has a detailed Pro build plan. Key components:

### Tiers
- **Free ($0)** — current extension, Balanced + Aggressive speeds
- **Scout Pro ($14.99)** — Stealth + Cautious speeds, Market Intel tab, data sync to Supabase
- **Pro + Web ($29.99)** — webapp at app.fifaticketscout.com
- **Pro + Web + Alerts ($49.99)** — email price drop alerts

### Tech Stack for Pro
- **Payments:** Lemonsqueezy (license keys, one-time payments)
- **Backend:** Supabase (Postgres, Edge Functions, pg_cron)
- **Webapp:** Next.js or plain HTML on Vercel
- **Alerts:** Resend or SendGrid

### Build Order
1. Extension paywall UI (license key input, tier gating, upgrade buttons)
2. Supabase backend (seats table, match_snapshots, hourly aggregation)
3. Extension data sync (POST scan data to Supabase for Pro users)
4. Market Intel tab (crowdsourced all-matches dashboard in extension)
5. Webapp (all-matches dashboard, price history charts)
6. Email alerts (price drops, new listings)

### Important Constraints
- Tournament ends July 19, 2026 (~14 weeks). Ship fast.
- Free version stays free forever. No bait and switch.
- Anonymity by design — no user identity in database, license key stored as SHA256 hash.
- Data sync is fire-and-forget, never blocks the user.
- Extension works identically whether backend is up or down.

## Files Overview
| File | Purpose |
|------|---------|
| `extension/manifest.json` | Chrome extension config, permissions, content script injection |
| `extension/injected.js` | Runs in page context, patches fetch/XHR, handles tile scanning |
| `extension/content.js` | Message bridge between page and extension |
| `extension/background.js` | Service worker, data processing, storage, scan routing |
| `extension/popup.js` | Dashboard rendering, filters, CSV export, scan speed UI |
| `extension/popup.html` | Popup markup |
| `extension/popup.css` | Popup styles (royal blue theme) |
| `CHANGELOG.md` | Detailed changelog with ET timestamps |
| `STORE_LISTING.md` | Chrome Web Store copy + permission justifications |
| `PRIVACY.md` | Privacy policy |
| `console-script.js` | Standalone DevTools paste script (separate from extension) |
| `REDDIT_POST.md` | Reddit post drafts |

## DataDome / Bot Detection
- FIFA uses DataDome for bot detection
- 403 responses with HTML "Bad request" or `captcha-delivery` URLs = blocked
- Intermittent — same bbox sometimes works, sometimes blocked
- Our 10k tiles + jittered delays significantly reduce triggers
- Rate limits seem to expire after ~5 minutes
- Scan retries blocked tiles after 3s cooldown

## Gotchas
- `ecommerce-detail` API (match name/date) only fires ONCE per session — if data is cleared, match name is lost until full page reload
- Service worker `scannedGames` Set persists in memory across page refreshes — must clear on tab navigation via `onUpdated` listener
- FIFA site redirects from `?perfId=X` URL to `/performance/X/` path — popup URL matching handles both formats
- Some stadiums (Dallas, LA) use wider coordinate space (up to 45k×40k) but all fit within our 40k grid
- Block coordinates in `seatmap/config` include 2 giant outline polygons (500k+) — ignore those
