import * as store from './storage.js';
import { fetchJson } from './http.js';
import { API, TTL } from './config.js';
import { isCrypto, coinId } from './currencies.js';

export const RANGES = {
  '24h': { label: '24H', days: 1, ttl: 2 * 60e3 },
  '7d': { label: '7D', days: 7, ttl: 10 * 60e3 },
  '30d': { label: '30D', days: 30, ttl: 30 * 60e3 },
  '1y': { label: '1Y', days: 365, ttl: 6 * 3600e3 },
};

const MAX_POINTS = 180;

function downsample(points) {
  if (points.length <= MAX_POINTS) return points;
  const step = points.length / MAX_POINTS;
  const out = [];
  for (let i = 0; i < MAX_POINTS - 1; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

// Binance candle size and count per range: intraday detail for coins Binance lists.
const BINANCE = { '24h': ['15m', 96], '7d': ['1h', 168], '30d': ['4h', 180], '1y': ['1d', 365] };

async function binanceSeries(coin, range) {
  const [interval, limit] = BINANCE[range];
  const d = await fetchJson(`${API.binanceKlines}?symbol=${coin.symbol}USDT&interval=${interval}&limit=${limit}`);
  const points = d.map(k => [k[6], Number(k[4])]).filter(p => p[1] > 0);
  // Tickers can collide between coins: only trust Binance if it agrees with our price.
  const last = points.at(-1)?.[1];
  if (!last || Math.abs(last - coin.usd) / coin.usd > 0.15) return null;
  return points;
}

// CoinPaprika's free plan: hourly data for the last 24 hours, daily data for up to a year.
async function paprikaSeries(coin, range) {
  const now = Date.now();
  const query = range === '24h'
    ? `start=${Math.floor((now - 23.5 * 3600e3) / 1000)}&interval=1h`
    : `start=${new Date(now - RANGES[range].days * 864e5).toISOString().slice(0, 10)}&interval=1d`;
  const d = await fetchJson(`${API.coinTicker}/${encodeURIComponent(coin.id)}/historical?${query}`);
  const points = d.map(x => [Date.parse(x.timestamp), x.price]).filter(p => p[1] > 0);
  if (coin.usd > 0 && coin.priced > (points.at(-1)?.[0] ?? 0)) points.push([coin.priced, coin.usd]);
  return points;
}

/** USD price history of a coin: Binance when available, otherwise CoinPaprika. */
async function coinUsdSeries(coin, range) {
  if (/^[A-Z0-9]{2,12}$/.test(coin.symbol) && coin.symbol !== 'USDT') {
    try {
      const points = await binanceSeries(coin, range);
      if (points?.length > 1) return points;
    } catch {
      // not listed on Binance, or Binance unreachable from here
    }
  }
  return paprikaSeries(coin, range);
}

/** Divides series a by series b, pairing each point of a with the nearest-in-time point of b. */
function divide(a, b) {
  const out = [];
  let j = 0;
  for (const [t, v] of a) {
    while (j < b.length - 1 && Math.abs(b[j + 1][0] - t) <= Math.abs(b[j][0] - t)) j++;
    if (b[j]) out.push([t, v / b[j][1]]);
  }
  return out;
}

async function frankfurterCurrencies() {
  const cached = await store.get('ffCurrencies');
  if (cached && Date.now() - cached.fetched < TTL.frankfurterCurrencies) return new Set(cached.codes);
  const codes = Object.keys(await fetchJson(`${API.fiatHistory}/currencies`));
  await store.set('ffCurrencies', { codes, fetched: Date.now() });
  return new Set(codes);
}

export { divide };

async function fiatSeries(from, to, days) {
  const supported = await frankfurterCurrencies();
  if (!supported.has(from) || !supported.has(to)) return null;
  const iso = d => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const d = await fetchJson(`${API.fiatHistory}/${iso(start)}..${iso(end)}?base=${from}&symbols=${to}`);
  const points = Object.entries(d.rates)
    .map(([date, r]) => [Date.parse(date), r[to]])
    .filter(p => p[1] > 0)
    .sort((a, b) => a[0] - b[0]);
  return { points, approx: false };
}

async function load(from, to, range, ctx) {
  if (!isCrypto(from) && !isCrypto(to)) return fiatSeries(from, to, RANGES[range].days);

  // Each side is either a USD price series (crypto) or a fixed rate (fiat, at today's rate).
  const side = async key => {
    if (!isCrypto(key)) {
      if (key === 'USD') return { perUsd: 1, exact: true };
      const rate = ctx.fiat?.rates?.[key];
      return rate ? { perUsd: rate, exact: false } : null;
    }
    const coin = ctx.coinsById?.get(coinId(key));
    return coin ? { points: await coinUsdSeries(coin, range) } : null;
  };
  const [a, b] = await Promise.all([side(from), side(to)]);
  if (!a || !b) return null;
  if (a.points && b.points) return { points: divide(a.points, b.points), approx: false };
  if (a.points) return { points: a.points.map(([t, v]) => [t, v * b.perUsd]), approx: !b.exact };
  return { points: b.points.map(([t, v]) => [t, 1 / (a.perUsd * v)]), approx: !a.exact };
}

/**
 * Price history of 1 `from` in `to` units: { points: [[timeMs, value]], approx, fetched }.
 * Returns null when no source has history for the pair.
 * `ctx` is { fiat, coinsById }: fiat rates for non-USD currencies and the coin list for crypto.
 */
export async function getHistory(from, to, range, ctx) {
  if (from === to) return null;
  const { ttl } = RANGES[range];
  const cacheKey = `${from}|${to}|${range}`;
  const cache = await store.get('history', {});
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.fetched < ttl) return hit;

  let result;
  try {
    result = await load(from, to, range, ctx);
  } catch (err) {
    if (hit) return { ...hit, stale: true };
    throw err;
  }
  if (!result) return null;

  const entry = { points: downsample(result.points), approx: result.approx, fetched: Date.now() };
  for (const [k, v] of Object.entries(cache)) {
    if (Date.now() - v.fetched > 24 * 3600e3) delete cache[k];
  }
  cache[cacheKey] = entry;
  await store.set('history', cache);
  return entry;
}
