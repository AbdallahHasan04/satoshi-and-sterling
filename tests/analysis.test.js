import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, emaSeries, rsi, mfi, vwap, roc, pivots, reversalPoints, relativeVolume, macd } from '../lib/indicators.js';
import { ttm, latestInstant, dcfPerShare, analyzeFundamentals, pastGrowth, costOfEquity, monthlyBeta, fiscalYears } from '../lib/fundamentals.js';
import { parseOptionSymbol, analyzeOptions, analyzeOrderBook } from '../lib/walls.js';
import { score } from '../lib/analysis.js';
import { toAnalystView } from '../lib/analysts.js';

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

test('DCF (Simply Wall St): growth closes 30% of its gap to the terminal rate each year', () => {
  // Two years by hand: 100 grows 10%, then 3 + 0.7 × (10 − 3) = 7.9%; terminal at 3%, discounted at 10%.
  const y1 = 110;
  const y2 = y1 * 1.079;
  const expected = y1 / 1.1 + y2 / 1.1 ** 2 + (y2 * 1.03) / 0.07 / 1.1 ** 2;
  const v = dcfPerShare({ fcf: 100, growthPct: 10, discountPct: 10, terminalPct: 3, shares: 1, years: 2 });
  assert.ok(Math.abs(v - expected) < 1e-9);
  // Their worked example's growth path: 14.77% → 11.16% → 8.63% with a 2.73% terminal rate.
  assert.equal((2.73 + 0.7 * (14.77 - 2.73)).toFixed(2), '11.16');
  assert.equal((2.73 + 0.7 * (11.158 - 2.73)).toFixed(2), '8.63');
  const base = { fcf: 100, terminalPct: 3, shares: 10 };
  assert.ok(dcfPerShare({ ...base, growthPct: 10, discountPct: 9 }) > dcfPerShare({ ...base, growthPct: 5, discountPct: 9 }));
  assert.ok(dcfPerShare({ ...base, growthPct: 5, discountPct: 11 }) < dcfPerShare({ ...base, growthPct: 5, discountPct: 9 }));
  assert.equal(dcfPerShare({ ...base, fcf: -5, growthPct: 5, discountPct: 9 }), null);
  assert.equal(dcfPerShare({ ...base, growthPct: 5, discountPct: 3 }), null); // discount must beat terminal growth
});

test('past growth as Simply Wall St measures it: line-of-best-fit slope ÷ average size', () => {
  assert.equal(pastGrowth([10, 20, 30, 40]), 40); // slope 10, average 25
  assert.equal(pastGrowth([40, 30, 20, 10]), -40);
  assert.equal(pastGrowth([10, 20]), null); // needs three years
});

test('cost of equity and beta', () => {
  assert.equal(costOfEquity({ riskFree: 4, beta: 1.5, erp: 4 }), 10);
  assert.equal(costOfEquity({ riskFree: 4, beta: 0.3, erp: 4 }), 4 + 0.8 * 4); // beta kept within 0.8–2
  assert.equal(costOfEquity({ riskFree: 4, beta: 3, erp: 4 }), 12);
  const month = i => Date.UTC(2021, i, 1);
  let s = 100;
  let x = 100;
  const index = [];
  const stock = [];
  for (let i = 0; i < 40; i++) {
    const r = Math.sin(i) * 0.04;
    x *= 1 + r;
    s *= 1 + 1.5 * r;
    index.push({ t: month(i), c: x });
    stock.push({ t: month(i), c: s });
  }
  assert.ok(Math.abs(monthlyBeta(stock, index) - 1.5) < 1e-9);
  assert.equal(monthlyBeta(stock.slice(0, 12), index), null); // under two years
});

test('two fiscal years of figures from annual filings', () => {
  const dur = (start, end, val) => ({ start, end, val, form: '10-K', filed: '2026-02-01' });
  const inst = (end, val) => ({ end, val, form: '10-K', filed: '2026-02-01' });
  const usd = list => ({ units: { USD: list } });
  const gaap = {
    NetIncomeLoss: usd([dur('2024-01-01', '2024-12-31', 80), dur('2025-01-01', '2025-12-31', 100), dur('2025-10-01', '2025-12-31', 30)]),
    NetCashProvidedByUsedInOperatingActivities: usd([dur('2024-01-01', '2024-12-31', 90), dur('2025-01-01', '2025-12-31', 130)]),
    Assets: usd([inst('2023-12-31', 900), inst('2024-12-31', 1000), inst('2025-12-31', 1100)]),
    Revenues: usd([dur('2024-01-01', '2024-12-31', 800), dur('2025-01-01', '2025-12-31', 1000)]),
    CostOfRevenue: usd([dur('2024-01-01', '2024-12-31', 500), dur('2025-01-01', '2025-12-31', 600)]),
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [dur('2024-01-01', '2024-12-31', 50), dur('2025-01-01', '2025-12-31', 49)] } },
  };
  const [cur, prev] = fiscalYears(gaap);
  assert.deepEqual(
    [cur.netIncome, cur.operatingCashFlow, cur.assetsBegin, cur.assetsEnd, cur.revenue, cur.grossProfit, cur.shares],
    [100, 130, 1000, 1100, 1000, 400, 49],
  );
  assert.deepEqual([prev.netIncome, prev.assetsBegin, prev.grossProfit, prev.longTermDebt], [80, 900, 300, null]);
  assert.equal(fiscalYears({ NetIncomeLoss: usd([dur('2025-01-01', '2025-12-31', 1)]) }), null); // one year only
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
  assert.equal(a.fairValue, null); // no discount rate without market inputs
  const market = { riskFree: 4, beta: 1, erp: 4.2 };
  const withDcf = analyzeFundamentals(fin, 150, market);
  assert.equal(withDcf.discountRate, 8.2);
  assert.equal(withDcf.growthAssumption.toFixed(1), (100 / 900 * 100).toFixed(1)); // revenue 800 → 1000: slope 100 ÷ average 900
  assert.ok(withDcf.fairValue > 0);
  assert.equal(withDcf.marginOfSafety, ((withDcf.fairValue - 150) / withDcf.fairValue) * 100);
  assert.equal(analyzeFundamentals({ ...fin, isFinancial: true }, 150, market).fairValue, null); // no DCF for banks
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

test('analyst consensus from Yahoo’s quoteSummary', () => {
  const r = {
    financialData: {
      recommendationKey: 'strong_buy', recommendationMean: { raw: 1.33 }, numberOfAnalystOpinions: { raw: 53 },
      targetMeanPrice: { raw: 601.73 }, targetLowPrice: { raw: 500 }, targetHighPrice: { raw: 700 },
    },
    earningsTrend: { trend: [{ period: '0q', growth: { raw: 0.14 } }, { period: '0y', growth: { raw: 0.1436 } }, { period: '+1y', growth: { raw: 0.1995 } }] },
    recommendationTrend: { trend: [{ period: '0m', strongBuy: 20, buy: 25, hold: 7, sell: 1, strongSell: 0 }] },
  };
  const a = toAnalystView(r);
  assert.equal(a.label, 'Strong buy');
  assert.equal(a.mean, 1.33);
  assert.equal(a.analysts, 53);
  assert.equal(a.targetMean, 601.73);
  assert.equal(a.growthThisYear.toFixed(2), '14.36');
  assert.equal(a.growthNextYear.toFixed(2), '19.95');
  assert.deepEqual(a.counts, [20, 25, 7, 1, 0]);
  assert.equal(toAnalystView({ financialData: {} }), null);
});

test('DCF follows the analysts’ forecast years, then fades to the terminal rate', () => {
  // Forecast 20% then 10%; year 3 fades: 3 + 0.7 × (10 − 3) = 7.9%.
  const v = dcfPerShare({ fcf: 100, forecast: [20, 10], growthPct: 20, discountPct: 10, terminalPct: 3, shares: 1, years: 3 });
  const y1 = 120;
  const y2 = y1 * 1.1;
  const y3 = y2 * 1.079;
  const expected = y1 / 1.1 + y2 / 1.1 ** 2 + y3 / 1.1 ** 3 + (y3 * 1.03) / 0.07 / 1.1 ** 3;
  assert.ok(Math.abs(v - expected) < 1e-9);
});
