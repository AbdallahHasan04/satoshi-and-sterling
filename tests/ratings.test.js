import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  techLabel, technicalRating, starRating, STAR_CUTOFFS, uncertaintyFromVolatility, annualVolatility, piotroski,
} from '../lib/ratings.js';

const candle = (c, i, spread = 1, v = 1000) => ({ t: i * 864e5, o: c, h: c + spread, l: c - spread, c, v });
const series = (n, f) => Array.from({ length: n }, (_, i) => candle(f(i), i));

test('TradingView bands: above 0.5 strong buy, above 0.1 buy, −0.1 to 0.1 neutral', () => {
  assert.equal(techLabel(0.51).label, 'Strong buy');
  assert.equal(techLabel(0.5).label, 'Buy');
  assert.equal(techLabel(0.11).label, 'Buy');
  assert.equal(techLabel(0.1).label, 'Neutral');
  assert.equal(techLabel(-0.1).label, 'Neutral');
  assert.equal(techLabel(-0.11).label, 'Sell');
  assert.equal(techLabel(-0.5).label, 'Sell');
  assert.equal(techLabel(-0.51).label, 'Strong sell');
});

test('every moving average votes buy in a steady uptrend and sell in a downtrend', () => {
  const up = technicalRating(series(300, i => 100 + i));
  assert.equal(up.ma.items.length, 15);
  // On a perfectly straight line the lag-free Hull MA sits on the price and Ichimoku's base line
  // trails span A, so those two are neutral; the other 13 vote buy.
  assert.equal(up.ma.sell, 0);
  assert.equal(up.ma.buy, 13);
  assert.deepEqual(up.ma.items.filter(i => i.vote === 0).map(i => i.name), ['Hull MA 9', 'Ichimoku Cloud']);
  assert.equal(up.osc.items.length, 11);
  // Oscillators look for overbought/oversold turns, so a steady trend leaves most of them neutral.
  assert.equal(up.label, 'Buy');

  const down = technicalRating(series(300, i => 400 - i));
  assert.equal(down.ma.buy, 0);
  assert.equal(down.ma.sell, 13);
  assert.equal(down.label, 'Sell');
});

test('indicators without enough history are left out, as TradingView does', () => {
  const r = technicalRating(series(60, i => 100 + i));
  const missing = r.ma.items.filter(i => i.vote == null).map(i => i.name);
  assert.deepEqual(missing, ['SMA 100', 'EMA 100', 'SMA 200', 'EMA 200']);
  assert.equal(r.ma.buy + r.ma.neutral + r.ma.sell, 11);
  assert.equal(technicalRating([]), null);
});

test('RSI votes buy only when below 30 and turning up', () => {
  // A long slide, then one small up day: RSI is deeply oversold and rising.
  const k = series(80, i => (i < 79 ? 200 - i * 1.5 : 200 - 78 * 1.5 + 0.5));
  const rsi = technicalRating(k).osc.items.find(i => i.name === 'RSI 14');
  assert.equal(rsi.vote, 1);
  const falling = technicalRating(series(80, i => 200 - i * 1.5)).osc.items.find(i => i.name === 'RSI 14');
  assert.equal(falling.vote, 0); // oversold but still falling: neutral
});

test('Morningstar star cut-offs follow the uncertainty level', () => {
  const at = (ratio, u) => starRating(ratio * 100, 100, u).stars;
  // Low uncertainty: 5★ ≤ 80%, 4★ ≤ 95%, 3★ < 105%, 2★ < 125%, else 1★.
  assert.deepEqual([0.8, 0.81, 0.95, 1, 1.05, 1.24, 1.25].map(r => at(r, 'Low')), [5, 4, 4, 3, 2, 2, 1]);
  // Very high uncertainty needs a much bigger discount for 5 stars.
  assert.equal(at(0.8, 'Very high'), 4);
  assert.equal(at(0.5, 'Very high'), 5);
  assert.equal(at(1.5, 'Very high'), 2);
  assert.equal(at(3, 'Extreme'), 2);
  assert.equal(starRating(100, 125, 'Medium').buyBelow, 125 * STAR_CUTOFFS.Medium.four);
  assert.equal(starRating(100, null, 'Low'), null);
  assert.equal(starRating(100, 100, null), null);
});

test('uncertainty from volatility', () => {
  assert.deepEqual([15, 30, 40, 60, 90].map(uncertaintyFromVolatility), ['Low', 'Medium', 'High', 'Very high', 'Extreme']);
  assert.equal(annualVolatility(series(100, () => 100)), 0);
  // Alternating ±1% days ≈ 1% daily volatility ≈ 15.9% a year.
  const wobble = series(253, i => 100 * (i % 2 ? 1.01 : 1));
  assert.ok(Math.abs(annualVolatility(wobble) - 15.9) < 0.5);
  assert.equal(annualVolatility(series(10, i => i + 1)), null);
});

const year = over => ({
  netIncome: 100, operatingCashFlow: 150, assetsBegin: 1000, assetsEnd: 1100, longTermDebt: 200,
  assetsCurrent: 400, liabilitiesCurrent: 200, shares: 50, revenue: 1000, grossProfit: 400, ...over,
});

test('Piotroski F-Score: nine tests, 8–9 strong, 0–2 weak', () => {
  const prev = year({});
  const better = year({ netIncome: 150, operatingCashFlow: 200, longTermDebt: 100, assetsCurrent: 500, shares: 49, grossProfit: 450, revenue: 1100 });
  const f = piotroski(better, prev);
  assert.equal(f.score, 9);
  assert.equal(f.available, 9);
  assert.equal(f.label, 'Strong');

  const worse = year({ netIncome: -50, operatingCashFlow: -80, longTermDebt: 400, assetsCurrent: 300, shares: 60, grossProfit: 300, revenue: 900 });
  const w = piotroski(worse, prev);
  assert.equal(w.score, 0);
  assert.equal(w.label, 'Weak');
  assert.equal(w.tests.find(t => t.name === 'Cash flow above net income').pass, false); // −80/1000 < −50/1000
});

test('F-Score skips tests whose figures aren’t reported', () => {
  const bank = o => year({ assetsCurrent: null, liabilitiesCurrent: null, grossProfit: null, ...o });
  const f = piotroski(bank({ netIncome: 120 }), bank({}));
  assert.equal(f.available, 7);
  assert.equal(f.tests.filter(t => t.pass == null).length, 2);
  // No long-term debt in either year counts as not having added any.
  assert.equal(piotroski(year({ longTermDebt: null }), year({ longTermDebt: null })).tests[4].pass, true);
  assert.equal(piotroski(year({}), null), null);
});
