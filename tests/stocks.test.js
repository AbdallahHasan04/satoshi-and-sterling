import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQuote, marketSession } from '../lib/stocks.js';

const spark = {
  symbol: 'AAPL',
  response: [{
    meta: {
      symbol: 'AAPL', longName: 'Apple Inc.', instrumentType: 'EQUITY', fullExchangeName: 'NasdaqGS',
      regularMarketPrice: 343.99, regularMarketChangePercent: 1.323, previousClose: 339.5, chartPreviousClose: 320, regularMarketTime: 1792612801,
      currentTradingPeriod: { pre: { start: 100, end: 200 }, regular: { start: 200, end: 300 }, post: { start: 300, end: 400 } },
    },
    indicators: { quote: [{ close: [340, null, 342, 343.99] }] },
  }],
};

test('builds a quote from a spark result', () => {
  const q = toQuote(spark);
  assert.equal(q.symbol, 'AAPL');
  assert.equal(q.name, 'Apple Inc.');
  assert.equal(q.price, 343.99);
  assert.equal(q.changePct, 1.323);
  assert.equal(q.prevClose, 339.5); // yesterday's close
  assert.equal(toQuote({ response: [{ meta: { symbol: 'X' } }] }), null);
});

test('computes the change from the previous close when Yahoo omits it', () => {
  const copy = structuredClone(spark);
  delete copy.response[0].meta.regularMarketChangePercent;
  assert.equal(toQuote(copy).changePct.toFixed(3), '1.323');
});

test('works out the trading session', () => {
  const { period } = toQuote(spark);
  assert.deepEqual(marketSession(period, 150e3), { state: 'pre', at: 200e3 });
  assert.deepEqual(marketSession(period, 250e3), { state: 'open', at: 300e3 });
  assert.deepEqual(marketSession(period, 350e3), { state: 'post', at: null });
  assert.deepEqual(marketSession(period, 50e3), { state: 'closed', at: 200e3 });
  assert.equal(marketSession(null), null);
});
