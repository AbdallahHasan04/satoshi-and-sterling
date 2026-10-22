import * as store from './storage.js';
import { fetchJson } from './http.js';
import { API, TTL, MAX_COINS, ESTABLISHED_MEME } from './config.js';
import { ISO_CURRENCIES, isCrypto, coinId } from './currencies.js';

// Cached shapes:
//   fiat:  { rates: { EUR: 0.89, ... } (units per 1 USD), updated, fetched, source, stale? }
//   coins: { list: [{ id, symbol, name, rank, image, usd, change24h, change7d, marketCap, volume24h, ath, priced }],
//            fetched, source: 'paprika', stale? }   ids are CoinPaprika ids, e.g. "btc-bitcoin"

async function fetchFiat() {
  try {
    const d = await fetchJson(API.fiat);
    if (d.result !== 'success') throw new Error('ExchangeRate-API returned an error');
    return { rates: d.rates, updated: d.time_last_update_unix * 1000, fetched: Date.now(), source: 'ExchangeRate-API' };
  } catch {
    const d = await fetchJson(API.fiatFallback);
    const rates = { USD: 1 };
    for (const [k, v] of Object.entries(d.usd)) {
      const code = k.toUpperCase();
      if (ISO_CURRENCIES.has(code) && v > 0) rates[code] = v;
    }
    return { rates, updated: Date.parse(d.date), fetched: Date.now(), source: 'currency-api' };
  }
}

export async function getFiat({ force = false } = {}) {
  const cached = await store.get('fiat');
  if (!force && cached && Date.now() - cached.fetched < TTL.fiat) return cached;
  try {
    const fresh = await fetchFiat();
    await store.set('fiat', fresh);
    return fresh;
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

/** Our coin shape from a CoinPaprika ticker. */
export function toCoin(t) {
  const q = t.quotes?.USD ?? {};
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    rank: t.rank,
    image: `${API.coinLogo}/${t.id}/logo.png`,
    usd: q.price,
    change24h: q.percent_change_24h ?? null,
    change7d: q.percent_change_7d ?? null,
    marketCap: q.market_cap ?? null,
    volume24h: q.volume_24h ?? null,
    ath: q.ath_price ?? null,
    circulatingSupply: t.circulating_supply ?? t.total_supply ?? null, // the tickers list only has total supply
    maxSupply: t.max_supply ?? null,
    priced: Date.parse(t.last_updated) || Date.now(),
  };
}

/**
 * Copies fresh CoinPaprika data onto a coin, but keeps its price if a live (Binance) price is newer.
 */
export function mergeCoin(target, fresh) {
  const keepPrice = target.priced > fresh.priced;
  const { usd, change24h, priced, live } = target;
  Object.assign(target, fresh);
  if (keepPrice) Object.assign(target, { usd, change24h, priced, live });
  return target;
}

/** Ids of coins CoinPaprika tags as memecoins (cached for a day; empty if unavailable). */
async function getMemeIds() {
  const cached = await store.get('memeIds');
  if (cached && Date.now() - cached.fetched < TTL.memeTags) return new Set(cached.ids);
  try {
    const tags = await fetchJson(API.coinTags, 20000);
    const ids = [...new Set(tags.filter(t => /meme/i.test(t.id)).flatMap(t => t.coins ?? []))];
    await store.set('memeIds', { ids, fetched: Date.now() });
    return new Set(ids);
  } catch {
    return new Set(cached?.ids ?? []);
  }
}

// Meme families CoinPaprika doesn't always tag (e.g. "Baby Doge Coin").
const MEME_NAME = /doge|shib|pepe|floki|bonk|wojak|meme|\binu\b/i;

const isMeme = (t, memeIds) => memeIds.has(t.id) || MEME_NAME.test(t.name) || MEME_NAME.test(t.symbol);

/** A memecoin that has proven itself: large market cap and trading for years (e.g. Dogecoin). */
export function isEstablished(t, now = Date.now()) {
  const since = Date.parse(t.first_data_at);
  const years = (now - since) / (365.25 * 864e5);
  return (t.quotes?.USD?.market_cap ?? 0) >= ESTABLISHED_MEME.minMarketCap && years >= ESTABLISHED_MEME.minYears;
}

/** Ranked coins from CoinPaprika tickers, without short-lived or small memecoins. */
export function buildCoinList(tickers, memeIds, now = Date.now()) {
  return tickers
    .filter(t => t.rank > 0 && t.rank <= MAX_COINS && t.quotes?.USD?.price > 0)
    .filter(t => !isMeme(t, memeIds) || isEstablished(t, now))
    .sort((a, b) => a.rank - b.rank)
    .map(toCoin);
}

export async function getCoins({ force = false, maxAge = TTL.coins } = {}) {
  const cached = await store.get('coins');
  const fresh = cached?.source === 'paprika' && Date.now() - cached.fetched < maxAge;
  if (!force && fresh) return cached;
  try {
    const [tickers, memeIds] = await Promise.all([fetchJson(API.coins, 20000), getMemeIds()]);
    const result = { list: buildCoinList(tickers, memeIds), fetched: Date.now(), source: 'paprika' };
    await store.set('coins', result);
    return result;
  } catch (err) {
    if (cached?.source === 'paprika') return { ...cached, stale: true };
    throw err;
  }
}

/**
 * Refreshes the given coins in place from their individual tickers (live updates).
 * Returns false if no source could be reached.
 */
export async function refreshCoinPrices(coins, ids) {
  if (!coins || !ids.length) return true;
  const wanted = coins.list.filter(c => ids.includes(c.id));
  const results = await Promise.allSettled(wanted.map(c => fetchJson(`${API.coinTicker}/${encodeURIComponent(c.id)}?quotes=USD`)));
  let failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.quotes?.USD?.price > 0) mergeCoin(wanted[i], toCoin(r.value));
    else failed.push(wanted[i]);
  });
  if (failed.length) {
    // CoinPaprika unreachable: use the daily fallback, matched by symbol.
    try {
      const d = await fetchJson(API.fiatFallback);
      const date = Date.parse(d.date);
      for (const c of failed) {
        const perUsd = d.usd[c.symbol.toLowerCase()];
        if (perUsd > 0 && date > c.priced) {
          c.usd = 1 / perUsd;
          c.priced = date;
        }
      }
      failed = [];
    } catch {
      // keep cached prices
    }
  }
  await store.set('coins', { list: coins.list, fetched: coins.fetched, source: coins.source });
  return !failed.length;
}

/** USD value of one unit of the currency, or null if unknown. */
export function usdPerUnit(key, fiat, coinsById) {
  if (isCrypto(key)) return coinsById.get(coinId(key))?.usd ?? null;
  const rate = fiat?.rates?.[key];
  return rate > 0 ? 1 / rate : null;
}
