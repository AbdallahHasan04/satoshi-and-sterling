// Published rating methods, implemented as documented by their authors. Pure functions, no I/O.
//
// - Technical rating: TradingView's "Technical Ratings" (26 indicators → −1…+1 → Strong sell…Strong buy).
//   https://www.tradingview.com/support/solutions/43000614331
// - Valuation: Morningstar's star rating (price ÷ fair value, with cut-offs that widen with uncertainty).
//   Morningstar Equity Research Methodology (2022), Exhibit 4.
// - Financial strength: the Piotroski F-Score (nine pass/fail accounting tests, 0–9).
//   Piotroski (2000), "Value Investing: The Use of Historical Financial Statement Information".
import { emaSeries, rsiSeries } from './indicators.js';

const lastOf = arr => arr[arr.length - 1];
const prevOf = arr => arr[arr.length - 2];
const ok = (...v) => v.every(x => x != null && Number.isFinite(x));

/* ---------- Series helpers (Pine Script equivalents) ---------- */

function smaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0; // values in the window that aren't null
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null) { sum += values[i]; count++; }
    if (i >= n && values[i - n] != null) { sum -= values[i - n]; count--; }
    if (i >= n - 1 && count === n) out[i] = sum / n;
  }
  return out;
}

function wmaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    let bad = false;
    for (let j = 0; j < n; j++) {
      const v = values[i - j];
      if (v == null) { bad = true; break; }
      s += v * (n - j);
    }
    if (!bad) out[i] = s / denom;
  }
  return out;
}

/** Hull moving average: WMA(2·WMA(n/2) − WMA(n), √n), as Pine's ta.hma. */
function hmaSeries(values, n) {
  const half = wmaSeries(values, Math.floor(n / 2));
  const full = wmaSeries(values, n);
  const diff = values.map((_, i) => (half[i] != null && full[i] != null ? 2 * half[i] - full[i] : null));
  return wmaSeries(diff, Math.floor(Math.sqrt(n)));
}

const windowed = (values, n, fn) => values.map((_, i) => (i < n - 1 ? null : fn(values.slice(i - n + 1, i + 1))));
const highest = (values, n) => windowed(values, n, w => Math.max(...w));
const lowest = (values, n) => windowed(values, n, w => Math.min(...w));
const donchian = (k, n) => {
  const hi = highest(k.map(x => x.h), n);
  const lo = lowest(k.map(x => x.l), n);
  return hi.map((h, i) => (h == null ? null : (h + lo[i]) / 2));
};

/** Stochastic %K (raw), as Pine's ta.stoch(source, high, low, n). */
function stochRaw(src, high, low, n) {
  const hi = highest(high, n);
  const lo = lowest(low, n);
  return src.map((v, i) => (hi[i] == null || v == null ? null : hi[i] === lo[i] ? 0 : (100 * (v - lo[i])) / (hi[i] - lo[i])));
}

/** Wilder's moving average (Pine's ta.rma), seeded with a simple average. */
function rmaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  let seed = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + v) / n;
      out[i] = prev;
    }
  }
  return out;
}

/** +DI, −DI and ADX series (Pine's ta.dmi). */
function dmi(k, diLen, adxLen) {
  const tr = k.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - k[i - 1].c), Math.abs(x.l - k[i - 1].c)) : null));
  const plusDM = k.map((x, i) => {
    if (!i) return null;
    const up = x.h - k[i - 1].h;
    const down = k[i - 1].l - x.l;
    return up > down && up > 0 ? up : 0;
  });
  const minusDM = k.map((x, i) => {
    if (!i) return null;
    const up = x.h - k[i - 1].h;
    const down = k[i - 1].l - x.l;
    return down > up && down > 0 ? down : 0;
  });
  const atr = rmaSeries(tr, diLen);
  const pRma = rmaSeries(plusDM, diLen);
  const mRma = rmaSeries(minusDM, diLen);
  const plus = atr.map((a, i) => (a ? (100 * pRma[i]) / a : null));
  const minus = atr.map((a, i) => (a ? (100 * mRma[i]) / a : null));
  const dx = plus.map((p, i) => (p == null || minus[i] == null ? null : p + minus[i] === 0 ? 0 : (100 * Math.abs(p - minus[i])) / (p + minus[i])));
  return { plus, minus, adx: rmaSeries(dx, adxLen) };
}

/* ---------- TradingView Technical Ratings ---------- */

export const TECH_BANDS = [
  { min: 0.5, label: 'Strong buy', tone: 'buy' },
  { min: 0.1, label: 'Buy', tone: 'buy' },
  { min: -0.1, label: 'Neutral', tone: 'neutral' },
  { min: -0.5, label: 'Sell', tone: 'sell' },
  { min: -Infinity, label: 'Strong sell', tone: 'sell' },
];

/** TradingView's label for a −1…+1 rating: above 0.5 Strong buy, above 0.1 Buy, −0.1…0.1 Neutral… */
export function techLabel(value) {
  if (value > 0.5) return TECH_BANDS[0];
  if (value > 0.1) return TECH_BANDS[1];
  if (value >= -0.1) return TECH_BANDS[2];
  if (value >= -0.5) return TECH_BANDS[3];
  return TECH_BANDS[4];
}

const vote = (buy, sell) => (buy ? 1 : sell ? -1 : 0);

/** Averages the indicators that have a value; null when none do. */
function summarize(items) {
  const have = items.filter(x => x.vote != null);
  if (!have.length) return null;
  const value = have.reduce((a, x) => a + x.vote, 0) / have.length;
  return {
    value,
    ...techLabel(value),
    buy: have.filter(x => x.vote > 0).length,
    neutral: have.filter(x => x.vote === 0).length,
    sell: have.filter(x => x.vote < 0).length,
    items,
  };
}

/**
 * TradingView's Technical Ratings on daily candles ({ o, h, l, c, v }, oldest → newest).
 * Returns { value (−1…+1), label, tone, ma, osc } where ma and osc are the moving-average and
 * oscillator groups with their buy/neutral/sell counts. Indicators without enough history are
 * left out, as TradingView does.
 */
export function technicalRating(k) {
  if (!k || k.length < 2) return null;
  const close = k.map(x => x.c);
  const high = k.map(x => x.h);
  const low = k.map(x => x.l);
  const price = lastOf(close);
  // Every moving average: buy when it's below the price, sell when above.
  const maVote = series => {
    const m = lastOf(series);
    return m == null ? null : m < price ? 1 : m > price ? -1 : 0;
  };

  const ma = [];
  for (const n of [10, 20, 30, 50, 100, 200]) {
    ma.push({ name: `SMA ${n}`, vote: maVote(smaSeries(close, n)) });
    ma.push({ name: `EMA ${n}`, vote: maVote(emaSeries(close, n)) });
  }
  ma.push({ name: 'Hull MA 9', vote: maVote(hmaSeries(close, 9)) });
  const pvAvg = smaSeries(k.map(x => x.c * x.v), 20);
  const volAvg = smaSeries(k.map(x => x.v), 20);
  const vwma = pvAvg.map((s, i) => (s == null || !volAvg[i] ? null : s / volAvg[i]));
  ma.push({ name: 'VWMA 20', vote: maVote(vwma) });
  // Ichimoku: the cloud lines as computed today (TradingView doesn't shift them forward here).
  const conv = lastOf(donchian(k, 9));
  const base = lastOf(donchian(k, 26));
  const leadA = ok(conv, base) ? (conv + base) / 2 : null;
  const leadB = lastOf(donchian(k, 52));
  ma.push({
    name: 'Ichimoku Cloud',
    vote: ok(conv, base, leadA, leadB)
      ? vote(leadA > leadB && base > leadA && conv > base && price > conv, leadA < leadB && base < leadA && conv < base && price < conv)
      : null,
  });

  // Up/down trend for Stochastic RSI and Bull Bear Power: price vs its 50-day EMA, as in
  // TradingView's open-source Technical Ratings script.
  const ema50 = lastOf(emaSeries(close, 50));
  const upTrend = ema50 != null && price > ema50;
  const downTrend = ema50 != null && price < ema50;

  const osc = [];
  const rsiS = rsiSeries(close, 14);
  const [r, r1] = [lastOf(rsiS), prevOf(rsiS)];
  osc.push({ name: 'RSI 14', vote: ok(r, r1) ? vote(r < 30 && r > r1, r > 70 && r < r1) : null });

  const stK = smaSeries(stochRaw(close, high, low, 14), 3);
  const stD = smaSeries(stK, 3);
  const [sk, sd] = [lastOf(stK), lastOf(stD)];
  osc.push({ name: 'Stochastic 14, 3, 3', vote: ok(sk, sd) ? vote(sk < 20 && sd < 20 && sk > sd, sk > 80 && sd > 80 && sk < sd) : null });

  const cciS = cciSeries(close, 20);
  const [c0, c1] = [lastOf(cciS), prevOf(cciS)];
  osc.push({ name: 'CCI 20', vote: ok(c0, c1) ? vote(c0 < -100 && c0 > c1, c0 > 100 && c0 < c1) : null });

  const d = dmi(k, 14, 14);
  const [adx, adx1, pdi, mdi] = [lastOf(d.adx), prevOf(d.adx), lastOf(d.plus), lastOf(d.minus)];
  // ADX must be rising for either vote (a strengthening trend), as in TradingView's script. Its help
  // page says "falling" for sell, but only "rising" reproduces TradingView's published ratings.
  osc.push({ name: 'ADX 14', vote: ok(adx, adx1, pdi, mdi) ? vote(pdi > mdi && adx > 20 && adx > adx1, pdi < mdi && adx > 20 && adx > adx1) : null });

  const hl2 = k.map(x => (x.h + x.l) / 2);
  const ao5 = smaSeries(hl2, 5);
  const ao34 = smaSeries(hl2, 34);
  const ao = ao5.map((f, i) => (f == null || ao34[i] == null ? null : f - ao34[i]));
  const [a0, a1, a2] = [lastOf(ao), prevOf(ao), ao[ao.length - 3]];
  osc.push({
    name: 'Awesome Oscillator',
    vote: ok(a0, a1, a2)
      ? vote((a0 > 0 && a1 <= 0) || (a0 > 0 && a1 > 0 && a0 > a1 && a2 > a1), (a0 < 0 && a1 >= 0) || (a0 < 0 && a1 < 0 && a0 < a1 && a2 < a1))
      : null,
  });

  const mom = close.map((v, i) => (i >= 10 ? v - close[i - 10] : null));
  const [m0, m1] = [lastOf(mom), prevOf(mom)];
  osc.push({ name: 'Momentum 10', vote: ok(m0, m1) ? vote(m0 > m1, m0 < m1) : null });

  const e12 = emaSeries(close, 12);
  const e26 = emaSeries(close, 26);
  const macdLine = close.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const signal = emaOf(macdLine, 9);
  const [ml, sg] = [lastOf(macdLine), lastOf(signal)];
  osc.push({ name: 'MACD 12, 26', vote: ok(ml, sg) ? vote(ml > sg, ml < sg) : null });

  const srK = smaSeries(stochRaw(rsiS, rsiS, rsiS, 14), 3);
  const srD = smaSeries(srK, 3);
  const [rk, rd] = [lastOf(srK), lastOf(srD)];
  osc.push({ name: 'Stochastic RSI 3, 3, 14, 14', vote: ok(rk, rd) ? vote(downTrend && rk < 20 && rd < 20 && rk > rd, upTrend && rk > 80 && rd > 80 && rk < rd) : null });

  const hi14 = highest(high, 14);
  const lo14 = lowest(low, 14);
  const wr = close.map((v, i) => (hi14[i] == null ? null : hi14[i] === lo14[i] ? 0 : (-100 * (hi14[i] - v)) / (hi14[i] - lo14[i])));
  const [w0, w1] = [lastOf(wr), prevOf(wr)];
  osc.push({ name: 'Williams %R 14', vote: ok(w0, w1) ? vote(w0 < -80 && w0 > w1, w0 > -20 && w0 < w1) : null });

  const e13 = emaSeries(close, 13);
  const bull = high.map((h, i) => (e13[i] == null ? null : h - e13[i]));
  const bear = low.map((l, i) => (e13[i] == null ? null : l - e13[i]));
  const [bu0, bu1, be0, be1] = [lastOf(bull), prevOf(bull), lastOf(bear), prevOf(bear)];
  osc.push({ name: 'Bull Bear Power', vote: ok(bu0, bu1, be0, be1) ? vote(upTrend && be0 < 0 && be0 > be1, downTrend && bu0 > 0 && bu0 < bu1) : null });

  const uo = ultimateOscillator(k);
  osc.push({ name: 'Ultimate Oscillator 7, 14, 28', vote: uo == null ? null : vote(uo > 70, uo < 30) });

  const maR = summarize(ma);
  const oscR = summarize(osc);
  const parts = [maR, oscR].filter(Boolean);
  if (!parts.length) return null;
  const value = parts.reduce((a, p) => a + p.value, 0) / parts.length;
  return { value, ...techLabel(value), ma: maR, osc: oscR };
}

/** EMA over a series that starts with nulls (e.g. the MACD line). */
function emaOf(values, n) {
  const start = values.findIndex(v => v != null);
  if (start < 0) return values.map(() => null);
  return [...new Array(start).fill(null), ...emaSeries(values.slice(start), n)];
}

/** Commodity Channel Index on the close, as Pine's ta.cci(close, n). */
function cciSeries(close, n) {
  const mean = smaSeries(close, n);
  return close.map((v, i) => {
    if (mean[i] == null) return null;
    let dev = 0;
    for (let j = i - n + 1; j <= i; j++) dev += Math.abs(close[j] - mean[i]);
    dev /= n;
    return dev === 0 ? 0 : (v - mean[i]) / (0.015 * dev);
  });
}

/** Ultimate Oscillator (7, 14, 28) for the latest candle. */
function ultimateOscillator(k) {
  if (k.length < 29) return null;
  const bp = [];
  const tr = [];
  for (let i = 1; i < k.length; i++) {
    const lo = Math.min(k[i].l, k[i - 1].c);
    const hi = Math.max(k[i].h, k[i - 1].c);
    bp.push(k[i].c - lo);
    tr.push(hi - lo);
  }
  const avg = n => {
    const b = bp.slice(-n).reduce((a, x) => a + x, 0);
    const t = tr.slice(-n).reduce((a, x) => a + x, 0);
    return t ? b / t : 0;
  };
  return (100 * (4 * avg(7) + 2 * avg(14) + avg(28))) / 7;
}

/* ---------- Morningstar star rating ---------- */

// Price ÷ fair value cut-offs per uncertainty level, from Morningstar's methodology (Exhibit 4):
// at or below `five` = 5 stars, at or below `four` = 4, below `two` = 3, below `one` = 2, else 1.
export const STAR_CUTOFFS = {
  Low: { five: 0.8, four: 0.95, two: 1.05, one: 1.25 },
  Medium: { five: 0.7, four: 0.9, two: 1.1, one: 1.35 },
  High: { five: 0.6, four: 0.85, two: 1.15, one: 1.55 },
  'Very high': { five: 0.5, four: 0.8, two: 1.25, one: 1.75 },
  Extreme: { five: 0.25, four: 0.5, two: 2.0, one: 4.0 },
};

// Morningstar's wording for each star level.
export const STAR_LABELS = { 5: 'Undervalued', 4: 'Somewhat undervalued', 3: 'Fairly valued', 2: 'Somewhat overvalued', 1: 'Overvalued' };

/**
 * Uncertainty level from the last year's annualised volatility of daily returns. Morningstar starts
 * from this same measure, then its analysts adjust it; it doesn't publish the cut-offs, so these
 * are ours (they put e.g. Coca-Cola at Low, Apple at Medium and Tesla at Very high).
 */
export function uncertaintyFromVolatility(vol) {
  if (vol == null || !Number.isFinite(vol)) return null;
  if (vol < 25) return 'Low';
  if (vol < 35) return 'Medium';
  if (vol < 50) return 'High';
  if (vol < 80) return 'Very high';
  return 'Extreme';
}

/** Annualised volatility (%) of daily returns over the last `days` candles. */
export function annualVolatility(candles, days = 252) {
  const c = candles.slice(-(days + 1)).map(x => x.c);
  if (c.length < 30) return null;
  const r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

/** Morningstar star rating: { stars, label, priceToFair, uncertainty, buyBelow } or null without a fair value. */
export function starRating(price, fairValue, uncertainty) {
  const cut = STAR_CUTOFFS[uncertainty];
  if (!(price > 0) || !(fairValue > 0) || !cut) return null;
  const ratio = price / fairValue;
  const stars = ratio <= cut.five ? 5 : ratio <= cut.four ? 4 : ratio < cut.two ? 3 : ratio < cut.one ? 2 : 1;
  return { stars, label: STAR_LABELS[stars], priceToFair: ratio, uncertainty, buyBelow: fairValue * cut.four };
}

/* ---------- Piotroski F-Score ---------- */

/**
 * The nine F-Score tests from two fiscal years of figures (`cur`, `prev`), each with netIncome,
 * operatingCashFlow, assetsBegin (total assets at the start of the year), assetsEnd, longTermDebt,
 * assetsCurrent, liabilitiesCurrent, shares, revenue and grossProfit. A test is null when its
 * figures aren't reported (e.g. banks have no current ratio or gross margin).
 * Returns { score, available, tests: [{ name, pass }], label } or null.
 */
export function piotroski(cur, prev) {
  if (!cur || !prev) return null;
  const roa = y => (ok(y.netIncome, y.assetsBegin) && y.assetsBegin > 0 ? y.netIncome / y.assetsBegin : null);
  const cfo = y => (ok(y.operatingCashFlow, y.assetsBegin) && y.assetsBegin > 0 ? y.operatingCashFlow / y.assetsBegin : null);
  // Long-term debt ÷ average total assets; no long-term debt reported counts as none.
  const lever = y => (ok(y.assetsBegin, y.assetsEnd) ? (y.longTermDebt ?? 0) / ((y.assetsBegin + y.assetsEnd) / 2) : null);
  const liquid = y => (ok(y.assetsCurrent, y.liabilitiesCurrent) && y.liabilitiesCurrent > 0 ? y.assetsCurrent / y.liabilitiesCurrent : null);
  const margin = y => (ok(y.grossProfit, y.revenue) && y.revenue > 0 ? y.grossProfit / y.revenue : null);
  const turn = y => (ok(y.revenue, y.assetsBegin) && y.assetsBegin > 0 ? y.revenue / y.assetsBegin : null);
  const test = (name, a, b, fn) => ({ name, pass: ok(a) && (b === undefined || ok(b)) ? fn(a, b) : null });

  const tests = [
    test('Positive return on assets', roa(cur), undefined, a => a > 0),
    test('Positive operating cash flow', cfo(cur), undefined, a => a > 0),
    test('Return on assets improved', roa(cur), roa(prev), (a, b) => a > b),
    test('Cash flow above net income', cfo(cur), roa(cur), (a, b) => a > b),
    // Leverage fell (or there's no long-term debt in either year).
    test('Long-term debt ratio fell', lever(cur), lever(prev), (a, b) => a < b || (a === 0 && b === 0)),
    test('Current ratio improved', liquid(cur), liquid(prev), (a, b) => a > b),
    test('No new shares issued', cur.shares, prev.shares, (a, b) => a <= b),
    test('Gross margin improved', margin(cur), margin(prev), (a, b) => a > b),
    test('Asset turnover improved', turn(cur), turn(prev), (a, b) => a > b),
  ];
  const have = tests.filter(t => t.pass != null);
  if (have.length < 5) return null;
  const score = have.filter(t => t.pass).length;
  // 8–9 strong, 0–2 weak, as usually read (Piotroski's paper bought 8–9 and shorted 0–1).
  const label = score >= 8 ? 'Strong' : score <= 2 ? 'Weak' : 'Average';
  return { score, available: have.length, tests, label };
}
