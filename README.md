# Satoshi & Sterling

*Currency, crypto and stocks in one browser extension.*

Satoshi & Sterling is a browser extension I built for Brave (it also runs in Chrome, Edge and other Chromium browsers). It converts between about 160 currencies, tracks around 2,000 cryptocurrencies with real-time prices, and follows the US stock market, all from one popup.

## What it does

The popup has four tabs.

**Currencies**
- Convert between about 160 currencies, with results that update as you type.
- Swap the two currencies with one click (or **Alt+S**); the result becomes the new amount.
- Save favourite pairs, and jump back to recent ones.
- See how a rate has moved over the last 7 days, 30 days or year.

**Crypto**
- The top ~2,000 coins by market cap, with prices in your own currency. Memecoins only appear once they're established (Dogecoin, Shiba Inu, Pepe and the like), so short-lived joke coins stay out of the way.
- Real-time prices for every major coin, updating about once a second.
- A page for each coin with its chart (24H to 1Y), market stats, a converter to any coin or currency, and its exchange rates.

**Stocks**
- The S&P 500, Dow Jones and Nasdaq at a glance, and whether the US market is open.
- Popular US stocks, plus search for any US-listed stock or ETF.
- A page for each stock with its live price, a chart from 1 day to 5 years, and key numbers like the day range and 52-week range.

**Favourites**
- Your saved rates, coins and stocks side by side, all updating live.

**Everywhere**
- Select a price on any web page (like `$49.99` or `0.5 BTC`), right-click, and choose **Convert** to see it in your currency.
- Light and dark themes, and it keeps working offline with the last saved prices.

## Trying it out

The extension isn't on the Chrome Web Store yet. To try it:

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

## Data sources

All the data comes from free public sources:

- **Exchange rates:** [ExchangeRate-API](https://www.exchangerate-api.com), with history from [Frankfurter](https://frankfurter.dev) (European Central Bank data)
- **Crypto prices and coin data:** [CoinPaprika](https://coinpaprika.com), with real-time prices and charts from [Binance](https://www.binance.com)
- **Stocks:** [Yahoo Finance](https://finance.yahoo.com)

Prices are for information only and may be delayed. Nothing you convert ever leaves your browser.

## Support

If you find it useful, you can [buy me a coffee on Ko-fi](https://ko-fi.com/road2avg).

---

© 2026 Abdallah Hasan. All rights reserved.
