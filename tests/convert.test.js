import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountInput, convert, formatAmount, formatRate, cryptoDecimals, pairChange24h, amountInputFor } from '../lib/convert.js';

const USD = { kind: 'fiat', code: 'USD' };
const EUR = { kind: 'fiat', code: 'EUR' };
const BTC = { kind: 'crypto', code: 'BTC' };

test('accepts plain numbers and a decimal comma', () => {
  assert.deepEqual(parseAmountInput('100'), { value: 100 });
  assert.deepEqual(parseAmountInput('12.5'), { value: 12.5 });
  assert.deepEqual(parseAmountInput('12,5'), { value: 12.5 });
  assert.deepEqual(parseAmountInput('.5'), { value: 0.5 });
  assert.deepEqual(parseAmountInput('  '), { empty: true });
});

test('flags input that is not a number', () => {
  for (const bad of ['abc', '12a', '1.2.3', '-5', '1e5', '.', '$10']) {
    assert.ok(parseAmountInput(bad).error, `expected error for "${bad}"`);
  }
});

test('allows at most 9 digits', () => {
  assert.deepEqual(parseAmountInput('123456789'), { value: 123456789 });
  assert.deepEqual(parseAmountInput('1234.56789'), { value: 1234.56789 });
  assert.ok(parseAmountInput('1234567890').error);
});

test('converts through USD values', () => {
  // 1 EUR = 1.1 USD, 1 BTC = 80,000 USD
  assert.equal(convert(100, 1, 1.1).toFixed(4), '90.9091');
  assert.equal(convert(1, 80000, 1), 80000);
  assert.equal(convert(80000, 1, 80000), 1);
});

test('rounds fiat output to two decimals', () => {
  assert.equal(formatAmount(90.909090, EUR, { locale: 'en-US' }), '€90.91');
  assert.equal(formatAmount(1234567.891, USD, { locale: 'en-US' }), '$1,234,567.89');
  assert.equal(formatAmount(90.909090, EUR, { raw: true }), '90.91');
});

test('shows meaningful digits for small crypto amounts', () => {
  assert.equal(formatAmount(0.00118326, BTC, { locale: 'en-US' }), '0.00118326 BTC');
  assert.equal(formatAmount(2, BTC, { locale: 'en-US' }), '2 BTC');
  assert.equal(formatAmount(0.00118326, BTC, { raw: true }), '0.00118326');
  assert.ok(cryptoDecimals(0.000001) > 6);
});

test('formats rates with extra precision', () => {
  assert.equal(formatRate(0.8917, EUR, { locale: 'en-US' }), '€0.8917');
  assert.equal(formatRate(0.0000118, BTC, { locale: 'en-US' }), '0.0000118 BTC');
});

test('turns a result into a swap amount within 9 digits', () => {
  assert.equal(amountInputFor(89.0812, EUR), '89.08');
  assert.equal(amountInputFor(0.00118326, BTC), '0.00118326');
  assert.equal(amountInputFor(7538417.2513, EUR), '7538417.25');
  // 12,345,678.91 has 10 digits: drop decimals to fit.
  assert.equal(amountInputFor(12345678.91, EUR), '12345678.9');
  // Leading zeros count toward the 9 digits.
  assert.equal(amountInputFor(0.0000066330148, BTC), '0.00000663');
  assert.equal(amountInputFor(99.999, USD), '100');
  assert.equal(amountInputFor(1234567890.5, EUR), null);
  // The swapped amount must pass the input validator.
  for (const v of ['89.08', '0.00118326', '12345678.9', '0.00000663']) assert.ok(!parseAmountInput(v).error, v);
});

test('combines 24h changes of both sides', () => {
  assert.equal(pairChange24h(10, undefined).toFixed(2), '10.00');
  assert.equal(pairChange24h(10, 10).toFixed(2), '0.00');
  assert.equal(pairChange24h(undefined, 25).toFixed(2), '-20.00');
});
