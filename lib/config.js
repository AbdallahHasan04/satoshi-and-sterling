// Your Ko-fi username (the part after ko-fi.com/).
export const KOFI_USERNAME = 'road2avg';
export const KOFI_URL = `https://ko-fi.com/${KOFI_USERNAME}`;
// Ko-fi's official embeddable donation panel, shown on the in-extension support page.
export const KOFI_EMBED_URL = `${KOFI_URL}/?hidefeed=true&widget=true&embed=true&preview=true`;

export const API = {
  fiat: 'https://open.er-api.com/v6/latest/USD',
  fiatFallback: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  // CoinPaprika (keyless): top 2,000 coins in one call, per-coin tickers, tags and daily history.
  coins: 'https://api.coinpaprika.com/v1/tickers?quotes=USD',
  coinTicker: 'https://api.coinpaprika.com/v1/tickers',
  coinTags: 'https://api.coinpaprika.com/v1/tags?additional_fields=coins',
  coinLogo: 'https://static.coinpaprika.com/coin',
  // Binance public market data (keyless): intraday candles for coins it lists.
  binanceKlines: 'https://api.binance.com/api/v3/klines',
  // Binance's market-data-only stream: every USDT pair's price, pushed about once a second.
  binanceStream: 'wss://data-stream.binance.vision/ws/!miniTicker@arr',
  binanceDepth: 'https://api.binance.com/api/v3/depth',
  // US SEC EDGAR company facts (XBRL financials from 10-K/10-Q filings), by CIK number.
  secFacts: 'https://data.sec.gov/api/xbrl/companyfacts/CIK',
  // Cboe's delayed (~15 min) option chains, for options-based walls.
  cboeOptions: 'https://cdn-api.cboe.com/api/global/delayed_quotes/options/',
  fiatHistory: 'https://api.frankfurter.dev/v1',
  // Yahoo Finance's public (unofficial, keyless) endpoints.
  stockSpark: 'https://query1.finance.yahoo.com/v7/finance/spark',
  stockChart: 'https://query1.finance.yahoo.com/v8/finance/chart',
  stockSearch: 'https://query2.finance.yahoo.com/v1/finance/search',
};

// How long cached data is considered fresh, in ms.
export const TTL = {
  fiat: 60 * 60e3,              // provider updates once a day
  coins: 5 * 60e3,              // full coin list (CoinPaprika refreshes about every 5 min)
  coinsLive: 2 * 60e3,          // full coin list while the Crypto tab is open
  memeTags: 24 * 3600e3,
  stocks: 25e3,                 // stock quotes (list); the stock page refreshes every 10 s
  frankfurterCurrencies: 7 * 24 * 3600e3,
};

export const LIVE_REFRESH_MS = 30e3;
export const MAX_DIGITS = 9;
export const MAX_RECENTS = 5;

// How many coins (by market cap rank) to load.
export const MAX_COINS = 2000;

// Memecoins are hidden unless they're established: big enough and trading long enough
// (keeps Dogecoin, Shiba Inu, Pepe, Bonk, Floki…; drops short-lived joke coins).
export const ESTABLISHED_MEME = { minMarketCap: 200e6, minYears: 2 };

// Shown on the Stocks tab: major indices, then the largest US companies.
export const INDICES = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^DJI', name: 'Dow Jones' },
  { symbol: '^IXIC', name: 'Nasdaq' },
];
export const POPULAR_STOCKS = [
  'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'BRK-B', 'JPM',
  'WMT', 'LLY', 'V', 'ORCL', 'NFLX', 'XOM', 'MA', 'COST', 'AMD', 'SPY',
];

// Your father's thresholds for the Stock analysis checks (edit to taste).
export const RULES = {
  rsiOversold: 30,      // RSI below this = oversold (his "must")
  rsiOverbought: 70,
  peMax: 20,
  pegMax: 1,
  roicMin: 15,          // %
  debtToEquityMax: 1,
  epsGrowthMin: 10,     // % a year
  roeMin: 15,           // %
  ebitMarginMin: 10,    // %
  safetyMin: 15,        // % below the low-end fair value = buy zone
  safetyDeep: 30,       // % below = deep value
  currentRatioMin: 1,
  interestCoverageMin: 3,
};
