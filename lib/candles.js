// Price candles ({ t, o, h, l, c, v }, oldest → newest) for the analysis tabs.
import { fetchJson } from './http.js';
import { API } from './config.js';

const cache = new Map();

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetched < ttl) return hit.data;
  const data = await load();
  cache.set(key, { data, fetched: Date.now() });
  return data;
}

/** Yahoo candles, e.g. (AAPL, '1y', '1d') or (AAPL, '1d', '5m'). */
export function yahooCandles(symbol, range, interval, ttl = 60e3) {
  return cached(`y|${symbol}|${range}|${interval}`, ttl, async () => {
    const d = await fetchJson(`${API.stockChart}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&_=${Date.now()}`);
    const r = d.chart?.result?.[0];
    if (!r) throw new Error(d.chart?.error?.description ?? 'No price data');
    const q = r.indicators?.quote?.[0] ?? {};
    return (r.timestamp ?? [])
      .map((t, i) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] ?? 0 }))
      .filter(k => k.c != null && k.h != null && k.l != null);
  });
}

/** Binance candles for a coin's USDT pair, e.g. (BTC, '1d', 365) or (BTC, '5m', 288). */
export function binanceCandles(symbol, interval, limit, ttl = 60e3) {
  return cached(`b|${symbol}|${interval}|${limit}`, ttl, async () => {
    const d = await fetchJson(`${API.binanceKlines}?symbol=${encodeURIComponent(symbol)}USDT&interval=${interval}&limit=${limit}`);
    return d.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  });
}
