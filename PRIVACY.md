# Privacy Policy — FIFA Ticket Scout

**Last updated:** April 3, 2026

## Overview

FIFA Ticket Scout is a Chrome browser extension that helps users view and compare resale ticket prices for FIFA World Cup 2026 matches. This policy explains what data the extension accesses and how it is handled.

## Data Collection

**FIFA Ticket Scout does not collect, transmit, or share any user data.**

- No personal information is collected
- No browsing history is tracked
- No analytics or telemetry of any kind
- No cookies are set by the extension
- No data is sent to any external server

## Data Storage

The extension stores captured seat and pricing data locally in your browser using Chrome's `chrome.storage.local` API. This data:

- Never leaves your device
- Is only accessible to the extension itself
- Can be cleared at any time using the "Clear Data" button in the extension popup
- Is automatically removed if you uninstall the extension

## Website Access

The extension only activates on the official FIFA World Cup 2026 resale ticket website (`fwc26-resale-usd.tickets.fifa.com`). It does not run on any other website.

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | To save captured seat data locally in your browser |
| `activeTab` | To communicate with the ticket website tab when scanning |
| Host permission for `fwc26-resale-usd.tickets.fifa.com` | To inject the data capture script on the FIFA resale site |

## Third Parties

The extension does not integrate with, send data to, or receive data from any third-party services.

## Open Source

The complete source code is publicly available at [github.com/david-dirring/fifa-ticket-scout](https://github.com/david-dirring/fifa-ticket-scout). You can inspect exactly what the extension does.

## Changes

If this privacy policy is updated, the changes will be reflected in this document with an updated date.

## Contact

For questions or concerns, please open an issue on [GitHub](https://github.com/david-dirring/fifa-ticket-scout/issues).
