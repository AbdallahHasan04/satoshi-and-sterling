// "Walls": options-based levels for stocks (from Cboe's delayed option chain) and real order-book
// walls for crypto (from Binance's live order book). Analysis is pure; fetching is at the bottom.
import { fetchJson } from './http.js';
import { API } from './config.js';

const median = values => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* ---------- Stocks: options positioning ---------- */

/** Parses an OCC option symbol like "AAPL261023C00110000" → { expiry, type, strike }. */
export function parseOptionSymbol(symbol) {
  const m = /^(.+?)(\d{6})([CP])(\d{8})$/.exec(symbol);
  if (!m) return null;
  const [, , d, type, strike] = m;
  return {
    expiry: Date.UTC(2000 + Number(d.slice(0, 2)), Number(d.slice(2, 4)) - 1, Number(d.slice(4, 6))),
    type,
    strike: Number(strike) / 1000,
  };
}

/**
 * Options walls from an option chain ([{ option, open_interest, gamma, volume }]):
 * - call wall: strike above the price with the most call open interest (tends to cap rallies)
 * - put wall: strike below the price with the most put open interest (tends to act as support)
 * - max pain: price where the nearest expiry's options lose the most value
 * - gamma flip: where dealers' net gamma exposure turns from negative to positive
 * Uses expiries within `days` (at least the nearest one).
 */
export function analyzeOptions(chain, price, { now = Date.now(), days = 45 } = {}) {
  const contracts = chain
    .map(o => ({ ...parseOptionSymbol(o.option), oi: Number(o.open_interest) || 0, gamma: Number(o.gamma) || 0 }))
    .filter(o => o.strike && o.expiry >= now - 864e5);
  if (!contracts.length) return null;
  const expiries = [...new Set(contracts.map(o => o.expiry))].sort((a, b) => a - b);
  const horizon = Math.max(expiries[0], now + days * 864e5);
  const near = contracts.filter(o => o.expiry <= horizon);

  const byStrike = new Map();
  for (const o of near) {
    const s = byStrike.get(o.strike) ?? { strike: o.strike, callOi: 0, putOi: 0, gex: 0 };
    if (o.type === 'C') { s.callOi += o.oi; s.gex += o.oi * o.gamma; } else { s.putOi += o.oi; s.gex -= o.oi * o.gamma; }
    byStrike.set(o.strike, s);
  }
  // Dollar gamma per 1% move: contracts × 100 shares × gamma × price² × 1%.
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike)
    .map(s => ({ ...s, gex: s.gex * 100 * price * price * 0.01 }));
  const inRange = strikes.filter(s => s.strike >= price * 0.75 && s.strike <= price * 1.25);
  const top = (list, key) => list.reduce((best, s) => (s[key] > (best?.[key] ?? 0) ? s : best), null);
  const callWall = top(inRange.filter(s => s.strike > price), 'callOi');
  const putWall = top(inRange.filter(s => s.strike < price), 'putOi');

  // Max pain for the nearest expiry that has open interest.
  const nextExpiry = expiries.find(e => contracts.some(o => o.expiry === e && o.oi > 0));
  const nearest = contracts.filter(o => o.expiry === nextExpiry && o.oi > 0);
  let maxPain = null;
  let minPain = Infinity;
  for (const k of new Set(nearest.map(o => o.strike))) {
    const pain = nearest.reduce((sum, o) =>
      sum + o.oi * (o.type === 'C' ? Math.max(0, k - o.strike) : Math.max(0, o.strike - k)), 0);
    if (pain < minPain) { minPain = pain; maxPain = k; }
  }

  // Gamma flip: where cumulative net gamma (low → high strikes) crosses zero, nearest the price.
  let cumulative = 0;
  let flip = null;
  for (const s of strikes) {
    const before = cumulative;
    cumulative += s.gex;
    if (before < 0 && cumulative >= 0 && (flip == null || Math.abs(s.strike - price) < Math.abs(flip - price))) flip = s.strike;
  }
  const netGex = strikes.reduce((sum, s) => sum + s.gex, 0);

  return {
    callWall: callWall && { strike: callWall.strike, oi: callWall.callOi },
    putWall: putWall && { strike: putWall.strike, oi: putWall.putOi },
    maxPain,
    maxPainExpiry: nextExpiry,
    gammaFlip: flip,
    netGex,
    putCallRatio: (() => {
      const calls = near.filter(o => o.type === 'C').reduce((s, o) => s + o.oi, 0);
      const puts = near.filter(o => o.type === 'P').reduce((s, o) => s + o.oi, 0);
      return calls ? puts / calls : null;
    })(),
    // For the chart: strikes within ±12% of the price.
    bars: strikes.filter(s => s.strike >= price * 0.88 && s.strike <= price * 1.12),
    expiriesUsed: expiries.filter(e => e <= horizon).length,
  };
}

/* ---------- Crypto: live order book ---------- */

/**
 * Buy and sell walls from an order book (bids/asks as [price, quantity] strings, best first).
 * Orders are grouped into price buckets sized to how deep the book reaches (about 20 buckets a
 * side, 0.02–0.25% wide); a wall is a bucket holding at least 3× the median bucket's value.
 * The bucket touching the current price is skipped: liquidity always clusters there.
 * Also returns the bid/ask balance within ±2% (or the visible depth, if smaller).
 */
export function analyzeOrderBook(bids, asks, { maxRangePct = 5 } = {}) {
  const b = bids.map(([p, q]) => [Number(p), Number(q)]);
  const a = asks.map(([p, q]) => [Number(p), Number(q)]);
  if (!b.length || !a.length) return null;
  const mid = (b[0][0] + a[0][0]) / 2;
  const depthPct = Math.min((mid - b[b.length - 1][0]) / mid, (a[a.length - 1][0] - mid) / mid) * 100;
  const rangePct = Math.min(maxRangePct, depthPct);
  const bucketPct = Math.min(0.25, Math.max(0.02, rangePct / 20));
  const step = (mid * bucketPct) / 100;

  const bucketize = (levels, side) => {
    const map = new Map();
    for (const [p, q] of levels) {
      if (Math.abs(p - mid) / mid > rangePct / 100) continue;
      const key = side === 'bid' ? Math.floor(p / step) * step : Math.ceil(p / step) * step;
      map.set(key, (map.get(key) ?? 0) + p * q);
    }
    return [...map.entries()].map(([price, value]) => ({ price, value }));
  };
  const bidBuckets = bucketize(b, 'bid').sort((x, y) => y.price - x.price);
  const askBuckets = bucketize(a, 'ask').sort((x, y) => x.price - y.price);
  const typical = median([...bidBuckets.slice(1), ...askBuckets.slice(1)].map(x => x.value)) || 1;
  const walls = list => list
    .slice(1)
    .filter(x => x.value >= typical * 3)
    .sort((x, y) => y.value - x.value)
    .slice(0, 3)
    .map(x => ({ ...x, strength: x.value / typical, distancePct: ((x.price - mid) / mid) * 100 }));

  const within = (levels, pct) => levels.filter(([p]) => Math.abs(p - mid) / mid <= pct / 100).reduce((s, [p, q]) => s + p * q, 0);
  const balancePct = Math.min(2, depthPct);
  const bid2 = within(b, balancePct);
  const ask2 = within(a, balancePct);

  return {
    mid,
    spreadPct: ((a[0][0] - b[0][0]) / mid) * 100,
    buyWalls: walls(bidBuckets),
    sellWalls: walls(askBuckets),
    bidShare: bid2 + ask2 > 0 ? (bid2 / (bid2 + ask2)) * 100 : null,
    balancePct,
    depthPct,
    bucketPct,
    bidBuckets,
    askBuckets,
  };
}

/* ---------- Fetching ---------- */

const optionCache = new Map();

/** Cboe's option chain for a stock or ETF (delayed ~15 min; cached 10 min), or null if none. */
export async function getOptionChain(symbol) {
  const hit = optionCache.get(symbol);
  if (hit && Date.now() - hit.fetched < 10 * 60e3) return hit.data;
  let data = null;
  try {
    const d = await fetchJson(`${API.cboeOptions}${encodeURIComponent(symbol.replace('-', '.'))}.json`, 20000);
    data = d?.data?.options?.length ? { options: d.data.options, time: d.timestamp } : null;
  } catch (err) {
    if (!/HTTP 40[34]/.test(err.message)) throw err; // no options listed for this symbol
  }
  optionCache.set(symbol, { data, fetched: Date.now() });
  return data;
}

/** Binance order book (5,000 levels a side) for a coin's USDT pair. */
export async function getOrderBook(symbol) {
  return fetchJson(`${API.binanceDepth}?symbol=${encodeURIComponent(symbol)}USDT&limit=5000`, 15000);
}
