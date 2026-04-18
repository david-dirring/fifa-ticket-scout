# FIFA Ticket Scout

A Chrome extension that tracks real-time seat prices for FIFA World Cup 2026 tickets. Works on both the official resale site and the Last Minute Sales (LMS) face-value site. See every available seat, price distribution, and best deals — plus crowdsourced market insights across all users.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![Version](https://img.shields.io/badge/version-2.3.0-brightgreen)

## Screenshots

![Dashboard with seat map](store-assets/screenshot-1-dashboard.png)
*Live dashboard showing match pricing alongside the FIFA seat map*

![Best deals and actions](store-assets/screenshot-2-deals.png)
*Best deals list, scan controls, and CSV export*

## Features

### Scanner Tab
- **Live seat capture** — Automatically intercepts seat data as you browse the FIFA resale or LMS ticket site
- **Auto-scan** — Scans all map sections when you open a match (4x4 grid of 10k tiles)
- **Scan speed control** — Stealth, Cautious, Balanced, or Aggressive speeds with remote-configurable timing profiles
- **Multi-tab support** — Open multiple matches in different tabs, each tracked independently
- **Multi-site support** — Works on both resale (`fwc26-resale-*.tickets.fifa.com`) and Last Minute Sales (`fwc26-shop-*.tickets.fifa.com`)
- **Price dashboard** — Total seats, cheapest/most expensive prices, category breakdowns with histograms
- **Best deals finder** — Groups consecutive same-price seats, ranked by value
- **Seats together filter** — Filter by group size (1–6+) to find consecutive seats
- **Block-by-block view** — Collapsible table showing seat count and min/max per block
- **CSV export** — Export all seat data with match details and timestamps
- **Resilient scanning** — Handles bot detection (403s) gracefully with retry cooldowns
- **Scan-ago timer** — Shows how long ago the last scan completed

### Insights Tab
- **Avg "Priced to Sell"** — Bar chart showing the average of the cheapest 15% of listings each day over 7 days, with day-over-day % change
- **Wall Movement heatmap** — Price distribution grid showing where sellers cluster by price over time. Dark bands = price walls. Bands drifting down = sellers capitulating
- **Multi-select filters** — Filter by game, city, team, or category with cascading logic
- **LMS toggle** — Include Last Minute Sales data alongside resale
- **All 104 matches** — Group stage shows team names, knockout shows stage + matchup codes
- **"Current" column** — Today's data refreshed hourly
- **Info button** — Explains what each chart means

### Alerts Tab
- **Price drop alerts** — Pick up to 3 games, set a price threshold, get emailed when prices drop below your target
- **Per-pick locking** — Saved picks are permanent, but you can add more until you hit the limit
- **Face value comparison** — See how current prices compare to face value

## Installation

### Option 1: Chrome Web Store (Stable)

One-click install with auto-updates. Core scanner and alerts.

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/fifa-ticket-scout/afopejgeljigjifkfeccobckjpoifjmn)

### Option 2: GitHub (Advanced — Latest Features)

Includes features not yet on the store: LMS support, Market Insights charts.

1. Clone the repository:
   ```bash
   git clone https://github.com/david-dirring/fifa-ticket-scout.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder
5. Navigate to the [FIFA resale site](https://fwc26-resale-usd.tickets.fifa.com) or [LMS site](https://fwc26-shop-usd.tickets.fifa.com) and open any match
6. Click the extension icon to see the dashboard

To update: `git pull` and click the reload button on `chrome://extensions`.

Step-by-step instructions with screenshots: [fifaticketscout.com/#install](https://fifaticketscout.com/#install)

> **Note:** Requires Chrome 88 or later (Manifest V3).

## How It Works

### Data Pipeline

1. **`injected.js`** runs in the page's MAIN world, patches `fetch`/`XMLHttpRequest` to intercept seat data. Handles full-scan by tiling the seat map into a 4x4 grid with configurable scan speeds and jittered delays.

2. **`content.js`** bridges page context and extension messaging.

3. **`background.js`** processes API data, deduplicates seats, stores in `chrome.storage.local`. Handles license verification, multi-tab tracking, and syncs scan data to Supabase (fire-and-forget).

4. **`popup.js` + `popup.html`** render three tabs: Scanner (dashboard), Insights (charts), Alerts (price drop config).

### Crowdsourced Data

Every completed scan is anonymously submitted to Supabase. A materialized table (`insights_priced_to_sell`) refreshes hourly via `pg_cron`, computing per-match pricing metrics and price distribution histograms. The Insights tab reads this data through an Edge Function.

Scan timing profiles (jitter, cooldowns, speed presets) are fetched from a remote config on startup and every 60 minutes, allowing live tuning without extension updates.

Displayed resale prices include the platform's 15% service fee. LMS prices are face value.

## Project Structure

```
extension/
  manifest.json    Chrome extension manifest (V3)
  background.js    Service worker — data processing, storage, Supabase sync
  injected.js      Runs in page context — intercepts API calls, runs scans
  content.js       Bridges page context and extension messaging
  popup.html       Extension popup markup (Scanner, Insights, Alerts tabs)
  popup.js         Dashboard rendering, charts, filters, alerts UI
  popup.css        All popup styles
  icons/           Extension icons (16, 48, 128px)
  images/          Preview screenshots for locked tab states
supabase/
  schema.sql         Database schema (tables, indexes, RLS policies)
  functions/
    _shared/         Shared constants (MAX_PICKS, EXPIRES_DAYS)
    ingest-scan/     Edge Function — receives and processes scan data
    get-insights/    Edge Function — serves materialized insights data
    get-alerts/      Edge Function — reads saved alert configs
    save-alerts/     Edge Function — saves alert configs with per-pick locking
```

## Tech Stack

- **Vanilla JavaScript** — no frameworks, no build step, no dependencies
- **Chrome Manifest V3** APIs — `chrome.storage.local`, `chrome.runtime`, `chrome.tabs`, `chrome.alarms`
- **Supabase** — Postgres database, Edge Functions, `pg_cron` for scheduled refreshes
- **HTML/CSS** — hand-written popup UI with bar charts and heatmaps

## Free vs Pro

The extension is fully functional for free. Pro features are optional upgrades:

| Feature | Free | Pro | Pro + Web | Pro + Web + Alerts |
|---------|------|-----|-----------|-------------------|
| Live seat capture & dashboard | Yes | Yes | Yes | Yes |
| Auto-scan (Balanced speed) | Yes | Yes | Yes | Yes |
| Category filters, histograms, best deals | Yes | Yes | Yes | Yes |
| CSV export | Yes | Yes | Yes | Yes |
| Contribute to crowdsourced data | Yes | Yes | Yes | Yes |
| Stealth, Cautious & Aggressive scan speeds | - | Yes | Yes | Yes |
| Multi-tab (multiple matches at once) | - | Yes | Yes | Yes |
| Market Insights (Avg Priced to Sell, Wall Movement) | - | - | Yes | Yes |
| Email alerts for price drops | - | - | - | Yes |

Get a license key at [fifaticketscout.com](https://fifaticketscout.com/#pricing).

## Privacy

- All scan data is stored locally in Chrome's extension storage
- Scan data synced to Supabase is anonymous (visitor ID only, no personal info)
- Crowdsourced insights are aggregated — no individual user data is exposed
- License key verification goes through Gumroad's API only
- No user tracking or analytics
- The extension only activates on `*.tickets.fifa.com`

## Publishing to Chrome Web Store

See [`STORE_LISTING.md`](STORE_LISTING.md) for the full store listing copy, required assets checklist, and submission steps.

## Disclaimer

This project is for **personal and educational use only**. It is not affiliated with, endorsed by, or connected to FIFA, Secutix, or any official ticketing partner. Use of this extension is at your own risk. The author is not responsible for any consequences resulting from its use, including but not limited to account restrictions on the ticketing platform. Please review and comply with the terms of service of any site you use this extension on.

## Support

If you find this useful, consider buying me a coffee!

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/davidrd)

## License

[ISC](LICENSE)
