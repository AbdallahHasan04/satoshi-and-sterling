import * as store from './storage.js';
import { fetchJson } from './http.js';
import { API, TTL } from './config.js';

// Yahoo exchange codes for US markets (Nasdaq tiers, NYSE, NYSE American, NYSE Arca, Cboe BZX).
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NAS', 'NYQ', 'NYS', 'ASE', 'PCX', 'BTS']);
const BATCH = 20; // the spark endpoint returns nothing for more symbols than this

// Yahoo's servers cache identical requests for up to 5 minutes (Cache-Control: max-age=300), so live
// requests carry a unique throwaway parameter to always get the current price.
const fresh = () => `&_=${Date.now()}`;
/**
 * The latest pre-market or after-hours trade in a chart/spark result fetched with includePrePost:
 * { session: 'pre' | 'post', price, changePct, time }, with the change measured from the last regular
 * close. Null while the latest trade is in regular hours, or for symbols without extended trading.
 */
export function extendedHours(res) {
  const m = res?.meta;
  const period = m?.currentTradingPeriod;
  if (!period?.regular || !(m.regularMarketPrice > 0)) return null;
  const times = res.timestamp ?? [];
  const closes = res.indicators?.quote?.[0]?.close ?? [];
  for (let i = times.length - 1; i >= 0; i--) {
    if (closes[i] == null) continue;
    const t = times[i];
    if (t >= period.regular.start && t < period.regular.end) return null;
    // Before today's pre-market (e.g. overnight data from the last session) counts as after hours.
    const session = t < period.regular.start && t >= (period.pre?.start ?? 0) ? 'pre' : 'post';
    const price = closes[i];
    return { session, price, changePct: ((price - m.regularMarketPrice) / m.regularMarketPrice) * 100, time: t * 1000 };
  }
  return null;
}

/** Converts one spark result into our quote shape, or null if it has no price. */
export function toQuote(result) {
  const res = result?.response?.[0];
  const m = res?.meta;
  if (!(m?.regularMarketPrice > 0)) return null;
  const prev = m.previousClose ?? m.chartPreviousClose ?? null;
  const price = m.regularMarketPrice;
  return {
    symbol: m.symbol,
    name: m.longName || m.shortName || m.symbol,
    type: m.instrumentType,
    exchange: m.fullExchangeName,
    price,
    prevClose: prev,
    changePct: m.regularMarketChangePercent ?? (prev ? ((price - prev) / prev) * 100 : 0),
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    yearHigh: m.fiftyTwoWeekHigh ?? null,
    yearLow: m.fiftyTwoWeekLow ?? null,
    volume: m.regularMarketVolume ?? null,
    time: m.regularMarketTime * 1000,
    period: m.currentTradingPeriod ?? null,
    ext: extendedHours(res),
    fetched: Date.now(),
  };
}

/**
 * Quotes for the given symbols, fetching only those older than `maxAge`.
 * Returns { quotes: { SYMBOL: quote }, ok } where ok is false if any request failed.
 */
export async function getQuotes(symbols, { maxAge = TTL.stocks } = {}) {
  const cache = await store.get('stocks', {});
  const now = Date.now();
  const stale = symbols.filter(s => !cache[s] || now - cache[s].fetched > maxAge);
  let ok = true;

  for (let i = 0; i < stale.length; i += BATCH) {
    const chunk = stale.slice(i, i + BATCH);
    try {
      const d = await fetchJson(`${API.stockSpark}?symbols=${chunk.map(encodeURIComponent).join(',')}&range=1d&interval=5m&includePrePost=true${fresh()}`);
      for (const r of d.spark?.result ?? []) {
        const q = toQuote(r);
        if (q) cache[q.symbol] = q;
      }
    } catch {
      ok = false;
    }
  }

  if (stale.length) {
    for (const [s, q] of Object.entries(cache)) {
      if (now - q.fetched > 7 * 24 * 3600e3) delete cache[s];
    }
    await store.set('stocks', cache);
  }
  return { quotes: Object.fromEntries(symbols.filter(s => cache[s]).map(s => [s, cache[s]])), ok };
}

/** Searches US-listed stocks and ETFs by ticker or company name. */
export async function searchStocks(query) {
  const d = await fetchJson(`${API.stockSearch}?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0`);
  return (d.quotes ?? [])
    .filter(x => (x.quoteType === 'EQUITY' || x.quoteType === 'ETF') && US_EXCHANGES.has(x.exchange))
    .map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol }));
}

/**
 * Trading session at `now` from a quote's currentTradingPeriod:
 * { state: 'open' | 'pre' | 'post' | 'closed', at } where `at` is when it closes (open) or the next open.
 */
export function marketSession(period, now = Date.now()) {
  if (!period?.regular) return null;
  const t = now / 1000;
  const within = p => p && t >= p.start && t < p.end;
  const nextOpen = period.regular.start > t ? period.regular.start * 1000 : null;
  if (within(period.regular)) return { state: 'open', at: period.regular.end * 1000 };
  if (within(period.pre)) return { state: 'pre', at: nextOpen };
  if (within(period.post)) return { state: 'post', at: null };
  return { state: 'closed', at: nextOpen };
}

// Chart ranges for the stock page: Yahoo range → candle interval.
export const STOCK_RANGES = {
  '1d': { label: '1D', interval: '5m', ttl: 60e3, prePost: true }, // with pre-market and after hours
  '5d': { label: '5D', interval: '15m', ttl: 5 * 60e3 },
  '1mo': { label: '1M', interval: '60m', ttl: 15 * 60e3 },
  '6mo': { label: '6M', interval: '1d', ttl: 3600e3 },
  '1y': { label: '1Y', interval: '1d', ttl: 3600e3 },
  '5y': { label: '5Y', interval: '1wk', ttl: 6 * 3600e3 },
};

const chartCache = new Map();

/** Price history for a stock or index: [[timeMs, close]], cached in memory per range. */
export async function getStockChart(symbol, range) {
  const key = `${symbol}|${range}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.fetched < STOCK_RANGES[range].ttl) return hit.points;
  const d = await fetchJson(`${API.stockChart}/${encodeURIComponent(symbol)}?range=${range}&interval=${STOCK_RANGES[range].interval}${STOCK_RANGES[range].prePost ? '&includePrePost=true' : ''}${fresh()}`);
  const r = d.chart?.result?.[0];
  if (!r) throw new Error(d.chart?.error?.description ?? 'No chart data');
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const points = (r.timestamp ?? []).map((t, i) => [t * 1000, closes[i]]).filter(p => p[1] != null);
  chartCache.set(key, { points, fetched: Date.now() });
  return points;
}
