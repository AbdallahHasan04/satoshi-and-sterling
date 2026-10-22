import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSelection, parseLocaleNumber } from '../lib/parse.js';
import { buildCatalog } from '../lib/currencies.js';

const catalog = buildCatalog(
  { rates: { USD: 1, EUR: 0.9, GBP: 0.8, JPY: 150, ALL: 90, CAD: 1.4 } },
  { list: [
    { id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin', usd: 80000 },
    { id: 'eth-ethereum', symbol: 'ETH', name: 'Ethereum', usd: 2500 },
  ] },
);

test('parses locale number formats', () => {
  assert.equal(parseLocaleNumber('1,234.56'), 1234.56);
  assert.equal(parseLocaleNumber('1.234,56'), 1234.56);
  assert.equal(parseLocaleNumber('1 234,56'), 1234.56);
  assert.equal(parseLocaleNumber('49,99'), 49.99);
  assert.equal(parseLocaleNumber('1,234'), 1234);
  assert.equal(parseLocaleNumber('1,234,567'), 1234567);
  assert.equal(parseLocaleNumber('12.5'), 12.5);
});

test('detects currency symbols around the number', () => {
  assert.deepEqual(parseSelection('$49.99', catalog), { amount: 49.99, currency: 'USD' });
  assert.deepEqual(parseSelection('€1.234,56', catalog), { amount: 1234.56, currency: 'EUR' });
  assert.deepEqual(parseSelection('49,99 €', catalog), { amount: 49.99, currency: 'EUR' });
  assert.deepEqual(parseSelection('Price: £20', catalog), { amount: 20, currency: 'GBP' });
  assert.deepEqual(parseSelection('C$15', catalog), { amount: 15, currency: 'CAD' });
  assert.deepEqual(parseSelection('Only ¥3,000!', catalog), { amount: 3000, currency: 'JPY' });
});

test('detects currency and crypto codes', () => {
  assert.deepEqual(parseSelection('100 USD', catalog), { amount: 100, currency: 'USD' });
  assert.deepEqual(parseSelection('100 eur', catalog), { amount: 100, currency: 'EUR' });
  assert.deepEqual(parseSelection('EUR 100', catalog), { amount: 100, currency: 'EUR' });
  assert.deepEqual(parseSelection('0.5 BTC', catalog), { amount: 0.5, currency: 'c:btc-bitcoin' });
  assert.deepEqual(parseSelection('2.5 eth.', catalog), { amount: 2.5, currency: 'c:eth-ethereum' });
  assert.deepEqual(parseSelection('₿0.1', catalog), { amount: 0.1, currency: 'c:btc-bitcoin' });
});

test('returns a null currency when none is present', () => {
  assert.deepEqual(parseSelection('costs 25 today', catalog), { amount: 25, currency: null });
  // Lowercase words before the number are not treated as codes ("all" is the Albanian lek).
  assert.deepEqual(parseSelection('all 5', catalog), { amount: 5, currency: null });
});

test('returns null without a number', () => {
  assert.equal(parseSelection('hello world', catalog), null);
  assert.equal(parseSelection('', catalog), null);
});
