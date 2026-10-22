import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTicker } from '../lib/live.js';
import { mergeCoin } from '../lib/rates.js';

const coins = () => ({
  BTC: { id: 'btc-bitcoin', symbol: 'BTC', usd: 80000, change24h: 1, priced: 0 },
  TON: { id: 'ton-toncoin', symbol: 'TON', usd: 2, change24h: 1, priced: 0 },
});

test('applies a Binance USDT ticker to the matching coin', () => {
  const c = coins();
  const updated = applyTicker({ s: 'BTCUSDT', c: '81000.5', o: '79000' }, s => c[s], 1234);
  assert.equal(updated, c.BTC);
  assert.equal(c.BTC.usd, 81000.5);
  assert.equal(c.BTC.change24h.toFixed(3), '2.532');
  assert.equal(c.BTC.priced, 1234);
  assert.equal(c.BTC.live, true);
});

test('ignores non-USDT pairs, unknown coins and colliding tickers', () => {
  const c = coins();
  assert.equal(applyTicker({ s: 'BTCEUR', c: '74000', o: '73000' }, s => c[s]), null);
  assert.equal(applyTicker({ s: 'XYZUSDT', c: '1', o: '1' }, s => c[s]), null);
  // A different "TON" on Binance at 5x our price is not our coin.
  assert.equal(applyTicker({ s: 'TONUSDT', c: '10', o: '10' }, s => c[s]), null);
  assert.equal(c.TON.usd, 2);
});

test('keeps a newer live price when slower CoinPaprika data arrives', () => {
  const target = { id: 'btc-bitcoin', usd: 81000, change24h: 2, priced: 2000, live: true, marketCap: 1 };
  mergeCoin(target, { id: 'btc-bitcoin', usd: 80000, change24h: 1, priced: 1000, marketCap: 5 });
  assert.equal(target.usd, 81000);
  assert.equal(target.marketCap, 5);
  mergeCoin(target, { id: 'btc-bitcoin', usd: 82000, change24h: 3, priced: 3000, marketCap: 6 });
  assert.equal(target.usd, 82000);
});
