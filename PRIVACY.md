# Privacy Policy — FIFA Ticket Scout

**Last updated:** April 14, 2026

## Overview

FIFA Ticket Scout is an open-source Chrome browser extension that helps users view and compare resale ticket prices for FIFA World Cup 2026 matches. This policy describes exactly what data the extension handles, where it goes, and why. The complete source code is published at [github.com/david-dirring/fifa-ticket-scout](https://github.com/david-dirring/fifa-ticket-scout) — every claim in this document can be verified by reading the code.

## What the extension does not collect

- No names, addresses, phone numbers, payment information, or government IDs
- No browsing history outside the FIFA resale ticket site
- No analytics, telemetry, fingerprinting, or tracking cookies
- No advertising identifiers
- No data is ever sold, rented, or shared for marketing purposes

## What the extension does collect and why

### 1. Seat and match data (local + anonymized cloud sync)

As you browse a FIFA resale ticket page, the extension captures the seat data the page itself loads from FIFA's servers: seat IDs, prices, block/row/seat labels, categories, and match metadata (team names, venue, date). This data is:

- **Stored locally** in Chrome's `chrome.storage.local` so the popup dashboard can render it.
- **Synced anonymously to a shared database (Supabase)** at the end of each scan so the community benefits from everyone's scans. The sync payload contains the seat data, the match identifier, and two IDs described below — it does **not** contain your IP address, email, name, browser fingerprint, or any identifier that ties the scan to you as a person. (Supabase itself may log the request IP at the network layer like any web service; the extension does not read or use it.)
- Removable at any time with the **Clear Data** button in the Scanner tab. This only wipes the local copy; previously-contributed anonymous scans remain in the shared database because they are not linked to any user-controlled identifier (see below).

### 2. Anonymous visitor ID

On first run, the extension generates a random 128-bit hex string (`visitorId`) using the browser's cryptographic RNG and stores it locally. It is sent alongside each scan sync so the backend can rate-limit abuse and roughly estimate unique contributors. It is **not** derived from your hardware, browser, account, IP, or anything else — it is pure randomness, tied to nothing, and there is no way for anyone (including me) to link it back to you. If you uninstall the extension a new ID is generated on reinstall.

### 3. License key (Pro tiers only)

If you purchase a Pro license from [fifaticketscout.com](https://fifaticketscout.com/#pricing) (sold through Gumroad), the extension stores the license key you enter locally and:

- Sends it to **api.gumroad.com** to verify the purchase when you activate it, and again every 24 hours in the background to confirm the license is still valid.
- Sends a **SHA-256 hash** of the key (not the raw key) alongside scan syncs so the server can attribute them to the correct Pro tier for feature gating.

Free users do not have a license key and this step does not apply.

### 4. Email address (Pro + Web + Alerts tier only, optional)

If you purchase the **Pro + Web + Alerts** tier and choose to use the Alerts tab, you voluntarily enter an email address to receive price-drop notifications. That email is sent (together with your license key and chosen match picks) to the extension's Supabase backend so the dispatcher can email you when a watched match crosses your price threshold. Specifically:

- Your email is stored in the `alert_configs` table, keyed by a hash of your license key.
- An audit row is written to `alert_configs_history` each time you save or update your picks.
- An audit row is written to `alerts_sent` each time the dispatcher actually sends you a notification email (for deduplication and cooldown enforcement).
- Alert config rows expire and are automatically deletable 180 days after creation.
- If you never use the Alerts tab, **no email address is ever collected or transmitted**. Free, Pro, and Pro + Web users never go through this code path.

You can request deletion of your Alerts data at any time — see the Contact section below.

### 5. Update check

The extension periodically fetches `https://raw.githubusercontent.com/david-dirring/fifa-ticket-scout/main/version.json` to compare against the installed version and surface an "update available" hint. This is a plain unauthenticated GET request for a public file — no user data is sent in the request body, headers, or query string. GitHub itself will see the request IP like any web visit, but the extension sends no cookies or identifiers along with it.

## Where your data goes

| Destination | What is sent | Purpose |
|-------------|-------------|---------|
| **Local browser storage** (`chrome.storage.local`) | Captured seats, license key, anonymous visitor ID, scan speed, filter state, locally-cached alert picks | Powers the dashboard; nothing leaves your machine unless listed below |
| **Supabase backend** (`yaydpahqlqwesqdddgfi.supabase.co`) | Scan payloads (seats + match + anonymous visitor ID + license key hash); for Alerts users only: email, license key, match picks, thresholds | Crowdsourced price data, Alerts feature |
| **Gumroad API** (`api.gumroad.com`) | License key (Pro users only) | Verify the license is legitimate and still active |
| **GitHub raw** (`raw.githubusercontent.com`) | Nothing — GET request for a public file | Check whether a newer extension version has been released |

The extension does not contact any other servers, advertising networks, analytics providers, or CDNs.

## Host permissions

| Host | Why it's needed |
|------|----------------|
| `*://*.tickets.fifa.com/*` | Inject the data-capture content script on the official FIFA resale ticket site (all currencies — USD, CAD, EUR, etc.) |
| `https://api.gumroad.com/*` | Verify Pro license keys (Pro users only) |
| `https://yaydpahqlqwesqdddgfi.supabase.co/*` | Sync anonymous scan data and, for Alerts users, save alert picks |
| `https://raw.githubusercontent.com/*` | Fetch the public `version.json` file to check for updates |

## Chrome permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | Persist captured seats, license, visitor ID, and preferences across sessions |
| `activeTab` | Send scan commands to the currently-open FIFA resale ticket tab |
| `tabs` | Detect which match you are viewing in the active tab, and enable multi-tab tracking for Pro users |
| `alarms` | Trigger the 24-hour background license re-verification |

## Your rights and controls

- **Stop contributing anonymous scans**: uninstall the extension, or simply don't use it on FIFA's resale site.
- **Delete local data**: click **Clear Data** in the Scanner tab or uninstall the extension.
- **Delete your Alerts data** (Pro + Web + Alerts users only): email me (see Contact below) with your license key or the email address you used, and I will delete the matching rows from `alert_configs`, `alert_configs_history`, and `alerts_sent`. Alert configs also auto-expire after 180 days.
- **Inspect the source code**: everything the extension does is in [the public repository](https://github.com/david-dirring/fifa-ticket-scout) — audit it yourself or ask any AI of your choice to examine it.

## Data retention

- Local browser storage: until you click Clear Data or uninstall.
- Anonymous scan contributions in Supabase: retained indefinitely to power price trends, but never linked to any personally identifying information.
- Alert configs in Supabase: auto-expire 180 days after creation (a database-level default), or on request.
- Alert history and send logs: retained for dedup/cooldown purposes; deletable on request.

## Third parties

The extension uses three third-party services, all of them minimally:

- **Supabase** — hosts the crowdsourced scan database and Alerts backend. See [supabase.com/privacy](https://supabase.com/privacy).
- **Gumroad** — processes license key purchases and verification. See [gumroad.com/privacy](https://gumroad.com/privacy).
- **GitHub** — hosts the source code and the `version.json` file used for update checks. See [docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

No data is shared with any fourth party. No data is used for advertising. No data is sold.

## Children

The extension is not directed at children under 13 and does not knowingly collect any information from them. If you are a parent and believe your child has provided information through the Alerts feature, contact me and it will be deleted.

## Changes to this policy

If this privacy policy is updated, the "Last updated" date at the top will change and the updated version will be committed to the public repository. Significant changes to the data handling practices (e.g. new data fields, new third parties) will also be called out in the project changelog.

## Contact

For privacy questions, data deletion requests, or any other concerns, open an issue on [GitHub](https://github.com/david-dirring/fifa-ticket-scout/issues) or email the address listed on the [maintainer's Gumroad profile](https://daviddirring.gumroad.com/).
