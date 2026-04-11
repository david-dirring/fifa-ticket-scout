# Chrome Web Store Listing

Copy for the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## Short Description (132 characters max)

```
Track every resale seat and price for FIFA World Cup 2026 matches. Find the best deals instantly — no spreadsheets, no refreshing.
```

## Detailed Description

```
Stop overpaying for FIFA World Cup 2026 resale tickets.

FIFA Ticket Scout gives you a real-time dashboard of every available resale seat, its price, and how it compares to everything else — right inside your browser. No more clicking through the map section by section, no more guessing if you're getting a good deal.

━━━━━━━━━━━━━━━━━━━━━━━━━━━

HOW IT WORKS

1. Install the extension
2. Go to the official FIFA resale ticket site and open any match
3. Click the extension icon — your dashboard is ready

That's it. The extension captures seat data as the page loads and automatically scans every section of the stadium. You don't need to click anything, configure anything, or wait.

━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT YOU GET

★ Full Stadium Overview
See every available seat across all sections in one place. Total seat count, cheapest price, and highest price — at a glance.

★ Price Distribution Histograms
Visual breakdown of how prices are spread within each ticket category. Instantly spot where the value is.

★ Best Deals Finder
The extension groups consecutive seats at the same price and ranks them. Looking for 4 seats together at the lowest price? It's right there. Use the seats-together toggle to filter by exact group size — select 2 and 3 to see only pairs and trios.

★ Category Filtering
Toggle between ticket categories (Cat 1, Cat 2, etc.) to compare pricing. Each category shows its own stats: cheapest, median, average, and highest price. Your filter selections persist when you close and reopen the popup.

★ Block-by-Block Breakdown
Collapsible table showing every stadium block with seat count, min price, and max price. Sort through the entire venue in seconds.

★ CSV Export
Download all seat data as a CSV file with match details, timestamps, and per-seat pricing. Great for analysis or sharing with your group.

★ Scan Speed Control
Choose from four scan speeds — Stealth, Cautious, Balanced, or Aggressive — to balance speed vs. detection risk. Stealth and Cautious are Pro features for users who want the lowest risk possible.

★ Automatic Full Scan
When you open a match, the extension scans all map sections automatically so you have complete data from the start. Hit "Clear & Rescan" and refresh to get a fresh snapshot anytime. Resilient to intermittent bot detection — skips blocked sections and retries.

★ Multi-Tab Support (Pro)
Open multiple matches in different tabs and track them all simultaneously. Free users can view one match at a time.

★ Smart Filtering
Seats currently in another buyer's cart are automatically hidden so you only see what's actually available. No phantom listings cluttering your results.

★ Crowdsourced Data
Every scan contributes anonymously to a shared database. Pro users will soon get access to Market Intel — crowdsourced pricing data across all matches — plus a web dashboard with price trends and email alerts for price drops.

━━━━━━━━━━━━━━━━━━━━━━━━━━━

FREE VS PRO

The extension is fully functional for free. Pro unlocks extra scan speeds, multi-tab support, and upcoming features like Market Intel, a web dashboard, and price drop alerts.

Get a license key at: https://daviddirring.gumroad.com/

━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRIVACY & SECURITY

• All scan data is stored locally in your browser
• Scan results are synced anonymously — no personal information collected
• Each install gets a random anonymous ID (not tied to any identity)
• License key verification goes through Gumroad's API only
• No analytics, no tracking
• The extension only runs on official FIFA resale ticket sites (all currencies: USD, CAD, EUR, etc.)
• Open source: https://github.com/david-dirring/fifa-ticket-scout

━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHO THIS IS FOR

• Fans trying to find the best available seats for a specific match
• Groups looking for multiple seats together at a good price
• Anyone who wants to compare prices across the entire stadium without clicking through every section manually

━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prices shown include the platform's 15% service fee so you see what you'll actually pay.

Built with zero external dependencies. Pure JavaScript, no frameworks, no bloat.

Questions or feedback? Open an issue on GitHub:
https://github.com/david-dirring/fifa-ticket-scout/issues
```

## Category

```
Shopping
```

## Language

```
English
```

---

## Required Assets

| Asset | Spec | Notes |
|-------|------|-------|
| Extension icon | 128×128 PNG | Already exists: `extension/icons/icon128.png` |
| Small promo tile | 440×280 PNG | Needed — shown in search results |
| Screenshots | 1280×800 or 640×400 PNG | Need 1–5 screenshots of the popup in action |
| Marquee promo | 1400×560 PNG (optional) | Large banner for featured placement |

### Suggested Screenshots

1. **Dashboard overview** — Full popup showing match info, stats bar, category tabs, and histogram
2. **Best Deals view** — The cluster list showing grouped consecutive seats ranked by price
3. **Category filter** — A specific category tab active, showing filtered stats and distribution
4. **Block breakdown** — The block table expanded, showing per-block pricing
5. **Scan in progress** — The scan progress bar mid-scan

### Screenshot Tips

- Use a real match with a good amount of seat data (500+ seats)
- Chrome's device toolbar can help get exact 1280×800 dimensions
- Keep it clean — no other tabs or bookmarks visible
- Add a thin border or drop shadow so the screenshots don't blend into the store's white background

---

## Single Purpose

```
Display real-time resale ticket prices and seat availability for FIFA World Cup 2026 matches.
```

---

## Permission Justifications

### storage

```
Stores captured seat pricing, match data, scan speed preference, and license key locally so the popup dashboard can display it and settings persist across sessions.
```

### activeTab

```
Sends scan commands to the active FIFA resale ticket tab to request seat data from all stadium sections.
```

### tabs

```
Detects which FIFA match the user is viewing in the active tab to show the correct game data. Enables multi-tab support for tracking multiple matches simultaneously.
```

### alarms

```
Periodically re-verifies Pro license keys (every 24 hours) to ensure they remain valid. Runs in the background without user interaction.
```

### Host permissions

```
*.tickets.fifa.com — Injects a content script to intercept seat pricing API responses as the user browses. The extension only runs on official FIFA resale ticket sites.

api.gumroad.com — Verifies Pro license keys purchased through Gumroad.

*.supabase.co — Syncs anonymous scan data to a shared database for crowdsourced pricing features.
```

---

## Store Listing Checklist

- [ ] Create a Chrome Web Store developer account ($5 one-time fee)
- [ ] Prepare 128×128 icon (already done)
- [ ] Create 440×280 small promotional tile
- [ ] Capture 3–5 screenshots at 1280×800
- [ ] Add a privacy policy URL (can be a GitHub page or a simple hosted page)
- [ ] Add `LICENSE` file to the repository
- [ ] Upload extension ZIP (the `extension/` folder contents)
- [ ] Submit for review
