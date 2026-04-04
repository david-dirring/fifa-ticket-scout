# FIFA Ticket Scout

A Chrome extension that tracks real-time seat prices for FIFA World Cup 2026 resale tickets. Browse any match on the official resale site and instantly see every available seat, price distribution, and best deals — all at a glance.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)

## Features

- **Live seat capture** — Automatically intercepts seat data as you browse the FIFA resale ticket site
- **Auto-scan** — Automatically scans all map sections when you open a match, so you get full coverage without lifting a finger
- **Price dashboard** — See total seats, cheapest and most expensive prices at a glance
- **Category breakdown** — Filter seats by category with price distribution histograms showing cheapest, median, average, and highest prices
- **Best deals finder** — Groups consecutive same-price seats and ranks them, with pagination
- **Block-by-block view** — Collapsible table showing seat count and min/max prices per block
- **Manual re-scan** — Trigger a full scan on demand if you want to refresh all sections
- **CSV export** — Export all seat data with match details and timestamps

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder
5. Navigate to the [FIFA World Cup 2026 Resale Tickets](https://fwc26-resale-usd.tickets.fifa.com) site and open any match seat map
6. Click the extension icon to see the dashboard

> **Note:** This is a Chrome-only extension using Manifest V3. It requires Chrome 88 or later.

## How It Works

The extension uses a multi-layer architecture to capture data from the FIFA ticketing platform:

1. **`injected.js`** runs in the page's own context (MAIN world) and patches `fetch` and `XMLHttpRequest` to intercept API responses containing seat data, pricing, and match details. It also handles the full-scan feature by tiling the seat map into a 5x5 grid and requesting each section.

2. **`content.js`** bridges the page context and the extension by relaying messages between `injected.js` and the background service worker.

3. **`background.js`** processes incoming API data, deduplicates seats by ID, and stores everything in `chrome.storage.local`. It also auto-triggers a full scan when a new match is detected.

4. **`popup.js` + `popup.html`** read from storage and render the dashboard UI — stats, histograms, best-deal clusters, and block breakdown.

Displayed prices include the platform's 15% service fee.

## Project Structure

```
extension/
  manifest.json    Chrome extension manifest (V3)
  background.js    Service worker — data processing and storage
  injected.js      Runs in page context — intercepts API calls, runs scans
  content.js       Bridges page context and extension messaging
  popup.html       Extension popup markup
  popup.js         Dashboard rendering and interaction logic
  popup.css        All popup styles
  icons/           Extension icons (16, 48, 128px)
```

## Tech Stack

- **Vanilla JavaScript** — no frameworks, no build step, no dependencies
- **Chrome Manifest V3** APIs — `chrome.storage.local`, `chrome.runtime`, `chrome.tabs`
- **HTML/CSS** — hand-written popup UI

## Privacy

- All data is stored locally in Chrome's extension storage
- No external servers or analytics
- No data collection whatsoever
- The extension only activates on `fwc26-resale-usd.tickets.fifa.com`

## Support

If you find this useful, consider buying me a coffee!

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/davidrd)
