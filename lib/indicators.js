// Technical indicators on daily (or intraday) candles. Pure functions, no I/O.
// Candles: arrays of { t, o, h, l, c, v } sorted oldest → newest.

const last = arr => arr[arr.length - 1];

export function sma(values, n) {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

/** Exponential moving average series (same length as input, nulls until it has n values). */
export function emaSeries(values, n) {
  const k = 2 / (n + 1);
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI series (0–100), nulls for the first n values. */
export function rsiSeries(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export const rsi = (closes, n = 14) => last(rsiSeries(closes, n));

/** MACD (12/26/9): { macd, signal, histogram } for the latest candle. */
export function macd(closes, fast = 12, slow = 26, signalN = 9) {
  if (closes.length < slow + signalN) return null;
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null)).filter(v => v != null);
  const sig = emaSeries(line, signalN);
  const m = last(line);
  const g = last(sig);
  return { macd: m, signal: g, histogram: m - g };
}

/** Money Flow Index (volume-weighted RSI), 0–100. */
export function mfi(candles, n = 14) {
  if (candles.length <= n) return null;
  let pos = 0;
  let neg = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const tp = (candles[i].h + candles[i].l + candles[i].c) / 3;
    const prevTp = (candles[i - 1].h + candles[i - 1].l + candles[i - 1].c) / 3;
    const flow = tp * candles[i].v;
    if (tp > prevTp) pos += flow; else if (tp < prevTp) neg += flow;
  }
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

/** Volume-weighted average price of the given candles (e.g. today's 5-minute candles). */
export function vwap(candles) {
  let pv = 0;
  let vol = 0;
  for (const k of candles) {
    if (!(k.v > 0)) continue;
    pv += ((k.h + k.l + k.c) / 3) * k.v;
    vol += k.v;
  }
  return vol > 0 ? pv / vol : null;
}

/** % change over the last n periods. */
export function roc(closes, n) {
  if (closes.length <= n) return null;
  const then = closes[closes.length - 1 - n];
  return ((last(closes) - then) / then) * 100;
}

/** Latest volume relative to the average of the previous n (1.0 = normal). */
export function relativeVolume(candles, n = 20) {
  if (candles.length <= n) return null;
  const prev = candles.slice(-n - 1, -1).map(k => k.v);
  const avg = prev.reduce((a, b) => a + b, 0) / n;
  return avg > 0 ? last(candles).v / avg : null;
}

/** Where the price sits in its range of the given candles: 0 = low, 100 = high. */
export function rangePosition(candles) {
  const lo = Math.min(...candles.map(k => k.l));
  const hi = Math.max(...candles.map(k => k.h));
  return hi > lo ? ((last(candles).c - lo) / (hi - lo)) * 100 : null;
}

/** 50/200-day moving averages and whether the latest cross was golden (50 above 200) or death. */
export function movingAverages(closes) {
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  if (ma50 == null) return { ma50: null, ma200: null, cross: null };
  let cross = null;
  if (ma200 != null) cross = ma50 >= ma200 ? 'golden' : 'death';
  return { ma50, ma200, cross };
}

/**
 * Swing highs/lows ("pivots"): a candle whose high (low) is the highest (lowest) of the
 * `w` candles on each side. Returns [{ i, price, type: 'high' | 'low' }].
 */
export function pivots(candles, w = 5) {
  const out = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) out.push({ i, price: candles[i].h, type: 'high' });
    if (isLow) out.push({ i, price: candles[i].l, type: 'low' });
  }
  return out;
}

/**
 * Reversal points: nearest support (swing low below the price) and resistance (swing high
 * above it), plus RSI divergence between the last two swing lows/highs:
 * bullish = price made a lower low but RSI a higher low (selling is weakening), bearish = the reverse.
 */
export function reversalPoints(candles, w = 5) {
  const price = last(candles).c;
  const ps = pivots(candles, w);
  const lows = ps.filter(p => p.type === 'low');
  const highs = ps.filter(p => p.type === 'high');
  const support = lows.filter(p => p.price < price).sort((a, b) => b.price - a.price)[0]?.price ?? null;
  const resistance = highs.filter(p => p.price > price).sort((a, b) => a.price - b.price)[0]?.price ?? null;

  const r = rsiSeries(candles.map(k => k.c));
  let divergence = null;
  const [l1, l2] = lows.slice(-2);
  const [h1, h2] = highs.slice(-2);
  if (l1 && l2 && r[l1.i] != null && r[l2.i] != null && l2.price < l1.price && r[l2.i] > r[l1.i]) divergence = 'bullish';
  if (h1 && h2 && r[h1.i] != null && r[h2.i] != null && h2.price > h1.price && r[h2.i] < r[h1.i]) {
    // The more recent pattern wins if both appear.
    if (!divergence || h2.i > l2.i) divergence = 'bearish';
  }
  return { support, resistance, divergence };
}

/** All technical readings for a set of daily candles, plus optional intraday candles for VWAP. */
export function technicals(daily, intraday) {
  const closes = daily.map(k => k.c);
  const price = intraday?.length ? last(intraday).c : last(closes);
  return {
    price,
    vwap: intraday?.length ? vwap(intraday) : null,
    rsi: rsi(closes),
    mfi: mfi(daily),
    macd: macd(closes),
    momentum1m: roc(closes, 21),
    momentum3m: roc(closes, 63),
    relVolume: relativeVolume(daily),
    ...movingAverages(closes),
    yearPosition: rangePosition(daily.slice(-252)),
    yearLow: Math.min(...daily.slice(-252).map(k => k.l)),
    yearHigh: Math.max(...daily.slice(-252).map(k => k.h)),
    ...reversalPoints(daily.slice(-180)),
  };
}
