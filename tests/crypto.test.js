import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoinList, toCoin } from '../lib/rates.js';
import { divide } from '../lib/history.js';

const ticker = (id, symbol, rank, price, { cap = 1e9, since = '2020-01-01' } = {}) => ({
  id, symbol, name: id, rank, last_updated: '2026-10-22T12:00:00Z', first_data_at: `${since}T00:00:00Z`,
  quotes: { USD: { price, percent_change_24h: 1.5, percent_change_7d: -3, market_cap: cap, volume_24h: 1e7, ath_price: price * 2 } },
});
const NOW = Date.parse('2026-10-22T00:00:00Z');

test('maps a CoinPaprika ticker to a coin', () => {
  const c = toCoin(ticker('btc-bitcoin', 'BTC', 1, 80000));
  assert.equal(c.id, 'btc-bitcoin');
  assert.equal(c.usd, 80000);
  assert.equal(c.change24h, 1.5);
  assert.equal(c.ath, 160000);
  assert.equal(c.image, 'https://static.coinpaprika.com/coin/btc-bitcoin/logo.png');
});

test('builds the ranked list without unranked or unpriced coins', () => {
  const tickers = [
    ticker('eth-ethereum', 'ETH', 2, 2500),
    ticker('btc-bitcoin', 'BTC', 1, 80000),
    ticker('zero-price', 'ZP', 50, 0),
    ticker('unranked', 'UR', 0, 1),
    ticker('too-far', 'TF', 2500, 1),
  ];
  assert.deepEqual(buildCoinList(tickers, new Set(), NOW).map(c => c.id), ['btc-bitcoin', 'eth-ethereum']);
});

test('keeps established memecoins and drops small or short-lived ones', () => {
  const tickers = [
    ticker('doge-dogecoin', 'DOGE', 12, 0.2, { cap: 13.6e9, since: '2013-12-15' }),
    ticker('floki-floki', 'FLOKI', 176, 0.0001, { cap: 229e6, since: '2021-09-10' }),
    ticker('trump-official-trump', 'TRUMP', 135, 2, { cap: 418e6, since: '2025-01-18' }),   // too new
    ticker('fartcoin-fartcoin', 'FARTCOIN', 215, 0.1, { cap: 145e6, since: '2024-12-10' }), // too small and new
    ticker('babydoge-baby-doge-coin', 'BABYDOGE', 342, 1e-9, { cap: 59e6, since: '2021-07-02' }), // too small, untagged
    ticker('kata-katana-inu', 'KATA', 1435, 1e-4, { cap: 1.3e6, since: '2022-02-05' }), // untagged "Inu" coin
    ticker('link-chainlink', 'LINK', 15, 15, { cap: 10e9, since: '2017-09-20' }),
  ];
  const memeTags = new Set(['doge-dogecoin', 'floki-floki', 'trump-official-trump', 'fartcoin-fartcoin']);
  assert.deepEqual(buildCoinList(tickers, memeTags, NOW).map(c => c.id), ['doge-dogecoin', 'link-chainlink', 'floki-floki']);
});

test('divides two price series by nearest timestamp', () => {
  const btc = [[0, 80000], [100, 82000], [200, 84000]];
  const eth = [[5, 2000], [95, 2050], [210, 2100]];
  assert.deepEqual(divide(btc, eth), [[0, 40], [100, 40], [200, 40]]);
});
