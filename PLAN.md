# Currency + Crypto Converter: Browser Extension Plan

Based on: https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Currency-Converter.md
Targets: Chromium browsers (Brave, Chrome, Edge, Opera, Vivaldi) through **Manifest V3**.

---

## 1. Required features from the spec

| # | User story | How we meet it |
|---|---|---|
| 1 | Enter up to 9 digits in a source input | Input caps the number at 9 digits (decimal point excluded, so `0.00012345` BTC still fits). Pasting more than that is blocked and a message explains why. |
| 2 | Sorted, selectable source currency list | Searchable dropdown sorted A→Z by code. Fiat and crypto sit in separate groups. |
| 3 | Sorted, selectable destination currency list | The same component, reused. |
| 4 | Converted value updates as soon as the amount or either currency changes, rounded to 2 decimals | Recalculates on every `input`/`change` event (debounced ~150 ms). **Fiat output uses 2 decimals, as the spec says.** Crypto output switches to significant digits (for example 8 for BTC), because 2 decimals would show `0.00 BTC` for most amounts. This is the one place we go beyond the spec on purpose. |
| 5 | Alert the user if the input isn't a number | Inline error under the field (red border plus a message). We use this instead of a blocking `alert()` popup, which is annoying inside a popup window. |
| Bonus | Swap source and destination | ⇅ button, plus a keyboard shortcut (`Alt+S` inside the popup). |

## 2. Crypto conversion

- **Supported pairs:** crypto↔crypto, crypto↔fiat and fiat↔fiat, all through one converter.
- **Real-time prices:** while the popup is open, prices refresh every **30 s** and the UI shows a "Live" indicator and a "last updated" time. A later option could stream ticks over a public exchange WebSocket (Coinbase or Binance) for truly second-by-second prices on major coins.
- **Coin list:** the top ~250 coins by market cap, plus search across the full CoinGecko list so smaller coins can be added.
- **Cross rates:** everything converts through USD as the pivot, so any coin works against any fiat or other coin.

## 3. Data sources (free, no secrets shipped in the extension)

| Purpose | API | Notes |
|---|---|---|
| Fiat rates (~160 currencies) | `open.er-api.com` (ExchangeRate-API open access) | No key needed. Updates daily. The license asks for an attribution link, so we show one. |
| Fiat history (charts) | `api.frankfurter.app` (ECB data) | No key needed. Covers about 30 major currencies. |
| Crypto prices and coin list | CoinGecko public API (`/simple/price`, `/coins/markets`) | No key needed, but rate limited (~30 calls/min). We batch requests and cache results, so one popup open makes about one call. |
| Fallback | `fawazahmed0/currency-api` via jsDelivr | Covers fiat and crypto. Used when the other APIs are down. |

All responses are cached in `chrome.storage.local` with timestamps. If a call fails, the extension keeps working from the last cached rates and shows a "rates from X ago" warning.

## 4. Tech stack and structure

- **Vanilla JS (ES modules) + HTML + CSS, with no build step.** You load the folder unpacked in Brave and it runs. This keeps the project easy to understand. Moving to TypeScript + Vite later is optional if it grows.
- Manifest V3 permissions are kept minimal: `storage`, `alarms` (only needed for price alerts), and `host_permissions` for the APIs above only. Keeping the list short means fewer scary install warnings and a faster Web Store review.

```
Currency-Converter-Extension/
├── manifest.json
├── popup/            popup.html, popup.css, popup.js   ← main converter UI
├── options/          options.html/js                   ← settings page
├── background/       service-worker.js                 ← alarms, alerts, context menu
├── lib/
│   ├── rates.js      fetch + cache + fallback logic
│   ├── convert.js    pure conversion/rounding functions (unit-testable)
│   └── currencies.js names, symbols, flags
├── icons/            16/32/48/128 px
└── tests/            convert.test.js (run with Node's built-in test runner)
```

## 5. Extra features

> **Chosen and built in v1.0:** all five quick wins (1–5, plus offline mode 6), #7 right-click conversion,
> #8 24h change and history charts, and Ko-fi donations. The other items remain ideas for later.
>
> **Deviations from the original plan:** the coin list covers the top 250 coins by market cap (no search across
> CoinGecko's full list yet). The "assumed currency" for right-click selections without a symbol is the popup's last
> **From** currency. Instead of a sparkline next to every price, a full chart sits under the result.

**High value, low effort**
1. **Favorites / recent pairs.** One-click chips for pairs you use often (for example USD→EUR, BTC→USD).
2. **Multi-convert view.** Converts one amount into 5–10 chosen currencies at once.
3. **Remembers your last pair and amount** between popup opens.
4. **Copy result** button, with a choice of formatted (`€1,234.56`) or raw (`1234.56`) output.
5. **Dark/light theme** that follows the system setting.
6. **Offline mode** that works from cached rates and shows a clear staleness label.

**Medium effort**

7. **Right-click "Convert selection."** Highlight `$49.99` on any web page, right-click, and the conversion appears in a small notification or the popup.
8. **24h change and a sparkline** next to crypto prices, plus 7d/30d/1y history charts.
9. **Price alerts**, for example "notify me when BTC > $120k". These use `chrome.alarms` and system notifications.
10. **Omnibox command:** type `cc 100 usd eur` in the address bar.
11. **Keyboard shortcut** to open the converter (default `Ctrl+Shift+Y`, rebindable).

**Larger / later**

12. **Side panel mode**, so the converter stays docked while you browse (`chrome.sidePanel`).
13. **Inline price hover** on pages. Hover over any price and see it in your home currency. This is opt-in only because it needs broad page access.
14. **Localization** of the UI and number formats (`Intl.NumberFormat` handles most of it).

## 6. Monetization (fair, never gates functionality)

Being realistic: a converter extension earns small amounts. These options are honest and comply with Chrome Web Store policy.

1. **Donations (recommended baseline).** Add an unobtrusive "Support this project" link in Settings and the footer (Ko-fi, GitHub Sponsors or Buy Me a Coffee). **Crypto donation addresses** fit the theme well, shown as a QR code plus a copy button.
2. **Disclosed exchange referral link (optional).** On the crypto tab, a small, clearly labeled "Buy / Trade" link to an exchange's referral program (for example Coinbase or Kraken). It is labeled "affiliate link", and users can hide it in Settings. It must **not** inject affiliate codes into other websites, which the Web Store bans.
3. **Cosmetic "Supporter" perks (optional).** Extra themes or icon styles unlocked by donating. Every conversion feature stays free.

**What we will never do:** ads injected into pages, selling or collecting browsing data, paywalled features, or nag screens. Doing any of these would also break Web Store policy or hurt reviews.

## 7. Roadmap

| Phase | Deliverable |
|---|---|
| ✅ Phases 1–3 + parts of 4 | Built in v1.0 (see section 5). |
| **1. MVP** | Manifest V3 skeleton, popup UI, fiat conversion, all spec user stories plus swap, caching. Load unpacked in Brave and test. |
| **2. Crypto** | CoinGecko integration, crypto↔crypto and crypto↔fiat, 30 s live refresh, adaptive precision. |
| **3. Quality of life** | The extras you pick from section 5 (favorites, multi-convert, copy, theme, and so on). |
| **4. Power features** | Context menu, price alerts, charts, omnibox. |
| **5. Polish and publish** | Icons, store screenshots, privacy policy page, unit tests, Chrome Web Store listing (one-time $5 developer fee). Brave installs directly from the Chrome Web Store, so one listing covers Brave, Chrome, Opera and Vivaldi. Edge Add-ons is a free second listing. |

### Testing in Brave
1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

Brave Shields doesn't block an extension's own API calls, so no special handling is needed.
