# FIFA Ticket Scout

A Chrome extension that tracks real-time seat prices for FIFA World Cup 2026 resale tickets. Browse any match on the official resale site and instantly see every available seat, price distribution, and best deals — all at a glance.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)

## Features

- **Live seat capture** — Automatically intercepts seat data as you browse the FIFA resale ticket site
- **Price dashboard** — See total seats, cheapest and most expensive prices at a glance
- **Category breakdown** — Filter seats by category with price distribution histograms
- **Best deals finder** — Groups consecutive seats by price and ranks them
- **Block-by-block view** — Collapsible table showing min/max prices per block
- **Full scan** — Scan all map sections to capture every available seat
- **CSV export** — Export all seat data with match details and timestamps

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder
5. Navigate to [FIFA World Cup 2026 Resale Tickets](https://fwc26-resale-usd.tickets.fifa.com) and browse a match seat map
6. Click the extension icon to see the dashboard

## How It Works

The extension intercepts API responses from the FIFA ticketing platform as you browse. It captures seat availability, pricing, and match details, then presents them in a clean dashboard. No data is sent anywhere — everything stays in your browser's local storage.

## Privacy

- All data is stored locally in Chrome's extension storage
- No external servers or analytics
- No data collection whatsoever
- The extension only activates on `fwc26-resale-usd.tickets.fifa.com`

## Support

If you find this useful, consider buying me a coffee!

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/davidrd)

## License

ISC
