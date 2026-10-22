import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, emaSeries, rsi, mfi, vwap, roc, pivots, reversalPoints, relativeVolume, macd } from '../lib/indicators.js';
import { ttm, latestInstant, dcfPerShare, analyzeFundamentals } from '../lib/fundamentals.js';
import { parseOptionSymbol, analyzeOptions, analyzeOrderBook } from '../lib/walls.js';
import { score } from '../lib/analysis.js';

const candle = (c, v = 100, spread = 1) => ({ t: 0, o: c, h: c + spread, l: c - spread, c, v });

test('moving averages', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([1, 2], 5), null);
  const e = emaSeries([1, 2, 3, 4, 5, 6], 3);
  assert.equal(e[2], 2); // seeded with the simple average
  assert.ok(e[5] > e[4]);
});

test('RSI is 100 for only gains, 0 for only losses, and in between otherwise', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(up), 100);
  assert.equal(rsi([...up].reverse()), 0);
  const wobble = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
  const r = rsi(wobble);
  assert.ok(r > 0 && r < 100);
});

test('MACD turns positive in an uptrend', () => {
  const up = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5 + (i > 60 ? (i - 60) * 2 : 0));
  assert.ok(macd(up).histogram > 0);
  assert.equal(macd(up.slice(0, 20)), null);
});

test('money flow index, VWAP, momentum and relative volume', () => {
  const rising = Array.from({ length: 20 }, (_, i) => candle(100 + i));
  assert.equal(mfi(rising), 100);
  // VWAP weights typical price by volume.
  assert.equal(vwap([{ h: 11, l: 9, c: 10, v: 100 }, { h: 21, l: 19, c: 20, v: 300 }]), 17.5);
  assert.equal(roc([100, 105, 110], 2), 10);
  const vols = [...Array.from({ length: 20 }, () => candle(100, 100)), candle(100, 250)];
  assert.equal(relativeVolume(vols), 2.5);
});

test('finds swing highs/lows and nearest support/resistance', () => {
  const closes = [10, 11, 12, 15, 12, 11, 10, 8, 10, 11, 12, 13, 12, 11, 10, 11, 12];
  const cs = closes.map(c => candle(c, 100, 0.5));
  const ps = pivots(cs, 2);
  assert.ok(ps.some(p => p.type === 'high' && p.price === 15.5));
  assert.ok(ps.some(p => p.type === 'low' && p.price === 7.5));
  const r = reversalPoints(cs, 2);
  assert.equal(r.resistance, 13.5);
  assert.equal(r.support, 9.5);
});

/* ---------- Fundamentals ---------- */

const f = (start, end, val, form = '10-Q') => ({ start, end, val, form, filed: end });

test('trailing twelve months = fiscal year + year-to-date − prior year-to-date', () => {
  const facts = [
    f('2023-09-25', '2024-09-28', 90, '10-K'),
    f('2024-09-29', '2025-06-28', 80),          // 9 months, prior year
    f('2024-09-29', '2025-09-27', 100, '10-K'), // fiscal year
    f('2025-09-28', '2026-06-27', 95),          // 9 months, this year
  ];
  const r = ttm(facts);
  assert.equal(r.value, 100 + 95 - 80);
  assert.equal(r.asOf, '2026-06-27');
  assert.equal(r.annual, 100);
  assert.equal(r.prevAnnual, 90);
  // Right after a fiscal year ends there is no year-to-date: TTM is the fiscal year.
  assert.equal(ttm(facts.slice(0, 3)).value, 100);
  assert.deepEqual(latestInstant([{ end: '2025-01-01', val: 1 }, { end: '2026-01-01', val: 2 }]), { value: 2, asOf: '2026-01-01' });
});

test('newly listed companies with no annual report are annualised from year-to-date', () => {
  const facts = [
    f('2025-01-01', '2025-06-30', 40),   // same half-year, last year (comparative in the 10-Q)
    f('2026-04-01', '2026-06-30', 35),   // latest quarter
    f('2026-01-01', '2026-06-30', 60),   // year-to-date
  ];
  const r = ttm(facts);
  assert.equal(Math.round(r.value), Math.round((60 * 365) / days('2026-01-01', '2026-06-30')));
  assert.equal(r.partialMonths, 6);
  assert.equal(r.annual, 60);
  assert.equal(r.prevAnnual, 40);       // growth compares the same six months
  assert.equal(ttm([f('2026-04-01', '2026-04-30', 5)]), null); // under ~3 months: too little to annualise
});

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

test('DCF value rises with growth and falls with the discount rate', () => {
  const base = { fcf: 100, cash: 0, debt: 0, shares: 10 };
  const v = dcfPerShare({ ...base, growthPct: 5, discountPct: 10 });
  assert.ok(v > 0);
  assert.ok(dcfPerShare({ ...base, growthPct: 10, discountPct: 10 }) > v);
  assert.ok(dcfPerShare({ ...base, growthPct: 5, discountPct: 12 }) < v);
  assert.equal(dcfPerShare({ ...base, fcf: -5, growthPct: 5, discountPct: 10 }), null);
});

test('ratios from financial figures', () => {
  const fin = {
    revenue: { value: 1000, annual: 1000, prevAnnual: 900, annualHistory: [800, 900, 1000] },
    netIncome: { value: 100, annual: 100, prevAnnual: 80 },
    operatingIncome: { value: 150 },
    pretaxIncome: { value: 125 },
    incomeTax: { value: 25 },
    interestExpense: { value: 10 },
    operatingCashFlow: { value: 140 },
    capex: { value: 40 },
    dividends: { value: 30 },
    eps: { value: 10, annual: 10, prevAnnual: 8 },
    equity: { value: 500 },
    cash: { value: 50 },
    assetsCurrent: { value: 300 },
    liabilitiesCurrent: { value: 200 },
    debt: 250,
    shares: 10,
    isFinancial: false,
    asOf: '2026-06-30',
  };
  const a = analyzeFundamentals(fin, 150);
  assert.equal(a.pe, 15);                    // 150 / (100 / 10)
  assert.equal(a.epsGrowth, 25);             // 10 vs 8
  assert.equal(a.peg, 15 / 25);
  assert.equal(a.roe, 20);                   // 100 / 500
  assert.equal(a.debtToEquity, 0.5);
  assert.equal(a.ebitMargin, 15);
  assert.equal(a.roic, (150 * 0.8 / 700) * 100); // tax 20%, capital 250 + 500 − 50
  assert.equal(a.fcf, 100);
  assert.equal(a.currentRatio, 1.5);
  assert.equal(a.interestCoverage, 15);
  assert.equal(a.dividendYield, 2);          // 30 / 1500
  assert.equal(a.bookValuePerShare, 50);
  assert.ok(a.fairLow < a.fairBase && a.fairBase < a.fairHigh);
  assert.equal(analyzeFundamentals({ ...fin, isFinancial: true }, 150).fairLow, null); // no DCF for banks
  assert.equal(analyzeFundamentals({ ...fin, dividends: null }, 150).dividendYield, 0); // no payments filed = none paid
});

/* ---------- Walls ---------- */

test('parses option symbols', () => {
  const o = parseOptionSymbol('AAPL261023C00110000');
  assert.equal(o.type, 'C');
  assert.equal(o.strike, 110);
  assert.equal(new Date(o.expiry).toISOString().slice(0, 10), '2026-10-23');
  assert.equal(parseOptionSymbol('junk'), null);
});

test('finds call wall, put wall and max pain', () => {
  const now = Date.UTC(2026, 9, 20);
  const chain = [
    { option: 'XYZ261023C00110000', open_interest: 5000, gamma: 0.05 },
    { option: 'XYZ261023C00105000', open_interest: 1000, gamma: 0.08 },
    { option: 'XYZ261023P00090000', open_interest: 4000, gamma: 0.05 },
    { option: 'XYZ261023P00095000', open_interest: 800, gamma: 0.08 },
    { option: 'XYZ261023C00100000', open_interest: 300, gamma: 0.1 },
    { option: 'XYZ261023P00100000', open_interest: 300, gamma: 0.1 },
  ];
  const r = analyzeOptions(chain, 100, { now });
  assert.equal(r.callWall.strike, 110);
  assert.equal(r.putWall.strike, 90);
  assert.equal(r.maxPain, 100);
  assert.ok(r.putCallRatio > 0);
});

test('finds order book walls away from the touch', () => {
  // A level every 0.1 from 100 down to 90 (bids) and up to 110 (asks), with one big bid at 97.
  const bids = Array.from({ length: 100 }, (_, i) => { const p = 99.9 - i * 0.1; return [p.toFixed(2), Math.abs(p - 97) < 0.05 ? '500' : '1']; });
  const asks = Array.from({ length: 100 }, (_, i) => [(100.1 + i * 0.1).toFixed(2), '1']);
  const r = analyzeOrderBook(bids, asks);
  assert.equal(r.buyWalls.length, 1);
  assert.ok(Math.abs(r.buyWalls[0].price - 97) < 0.3);
  assert.equal(r.sellWalls.length, 0);
  // The wall is 3% away, outside the ±2% buy/sell balance window, so the balance stays even.
  assert.ok(Math.abs(r.bidShare - 50) < 2);
});

test('score counts only checks with data', () => {
  const s = score([{ rows: [{ pass: true }, { pass: false }, { pass: null }] }, null, { rows: [{ pass: true }] }]);
  assert.deepEqual(s, { passed: 2, total: 3 });
});
