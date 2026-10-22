# Satoshi & Sterling

*Currency, crypto and stocks in one browser extension.*

Satoshi & Sterling is a browser extension I built for Brave (it also runs in Chrome, Edge and other Chromium browsers, and there's a Firefox version). It converts between about 160 currencies, tracks around 2,000 cryptocurrencies with real-time prices, follows the US stock market, and analyses stocks and coins, all from one popup.

## What it does

The popup has six tabs.

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

**Stock analysis**
- Search any US stock or ETF (or tap **Analyse** on a stock page) for a full check-up, with a score showing how many checks it passes.
- **Price & momentum:** VWAP, RSI, money flow, momentum (MACD), volume, the 200-day average and the 52-week range.
- **Reversal points:** nearest support and resistance, and RSI divergence.
- **Valuation:** P/E, PEG, book value (NAV), a fair-value range from a discounted-cash-flow model, and the margin of safety below the low-end fair value.
- **Profitability, growth and health:** EPS growth, ROE, ROIC, EBIT margin, revenue growth, free cash flow, debt/equity, current ratio, interest coverage and dividends, all from the company's SEC filings.
- **Options walls:** the call wall (sell wall), put wall (buy wall), max pain and gamma flip, with a chart of open option contracts by price.

**Crypto analysis**
- The same price and momentum checks for any coin traded on Binance.
- **Live order book walls:** the biggest resting buy and sell orders near the price, buy vs sell pressure, and a depth chart, refreshed every 10 seconds.
- Market structure: market cap, liquidity, supply issued and distance from the all-time high.

The analysis is for information only and isn't financial advice.

**Everywhere**
- Select a price on any web page (like `$49.99` or `0.5 BTC`), right-click, and choose **Convert** to see it in your currency.
- Light and dark themes, and it keeps working offline with the last saved prices.

## Trying it out

The extension isn't on the Chrome Web Store yet. To try it:

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

**On Android (Microsoft Edge Canary):** download the `.crx` file from the latest release. In Edge Canary, open **Settings → About Microsoft Edge** and tap the build number about five times to turn on **Developer options**. Then go to **Settings → Developer options → Extension install by crx** and pick the file. Everything works on Android except right-click Convert, since phones have no right-click menu.

## Data sources

All the data comes from free public sources:

- **Exchange rates:** [ExchangeRate-API](https://www.exchangerate-api.com), with history from [Frankfurter](https://frankfurter.dev) (European Central Bank data)
- **Crypto prices and coin data:** [CoinPaprika](https://coinpaprika.com), with real-time prices and charts from [Binance](https://www.binance.com)
- **Stocks:** [Yahoo Finance](https://finance.yahoo.com)
- **Company financials:** [SEC EDGAR](https://www.sec.gov/edgar) (the US regulator's database of company filings)
- **Options data:** [Cboe](https://www.cboe.com) (delayed about 15 minutes)

Prices are for information only and may be delayed. Nothing you convert ever leaves your browser.

## Support

If you find it useful, you can [buy me a coffee on Ko-fi](https://ko-fi.com/road2avg).

---

© 2026 Abdallah Hasan. All rights reserved.
