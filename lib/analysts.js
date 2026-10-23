// Wall Street analyst consensus from Yahoo Finance: the buy/hold/sell recommendation, price
// targets and earnings growth forecasts. Yahoo only serves these with its session cookie and a
// matching "crumb" token, which is fetched once and reused.
import * as store from './storage.js';
import { fetchJson } from './http.js';
import { API } from './config.js';

const TTL = 6 * 3600e3; // estimates change slowly
let crumb = null;

async function getCrumb(force = false) {
  if (crumb && !force) return crumb;
  // fc.yahoo.com answers 404 but sets the session cookie the crumb is tied to.
  await fetch(API.yahooCookie, { credentials: 'include', cache: 'no-store' }).catch(() => {});
  const res = await fetch(API.yahooCrumb, { credentials: 'include', cache: 'no-store' });
  const text = (await res.text()).trim();
  if (!res.ok || !text || text.startsWith('{') || text.length > 40) throw new Error('No Yahoo crumb');
  crumb = text;
  return crumb;
}

// Yahoo's labels for its 1 (strong buy) – 5 (sell) consensus scale.
const LABELS = { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell' };

/** Turns a quoteSummary result into our shape, or null when no analysts cover the stock. */
export function toAnalystView(r) {
  const fd = r?.financialData ?? {};
  const raw = v => v?.raw ?? null;
  const analysts = raw(fd.numberOfAnalystOpinions);
  const trend = r?.earningsTrend?.trend ?? [];
  const growth = period => {
    const g = raw(trend.find(t => t.period === period)?.growth);
    return g == null ? null : g * 100;
  };
  const counts = r?.recommendationTrend?.trend?.find(t => t.period === '0m');
  const view = {
    label: LABELS[fd.recommendationKey] ?? null,
    mean: raw(fd.recommendationMean),
    analysts,
    targetMean: raw(fd.targetMeanPrice),
    targetLow: raw(fd.targetLowPrice),
    targetHigh: raw(fd.targetHighPrice),
    // Expected earnings-per-share growth (%) for this fiscal year and next.
    growthThisYear: growth('0y'),
    growthNextYear: growth('+1y'),
    counts: counts ? [counts.strongBuy, counts.buy, counts.hold, counts.sell, counts.strongSell] : null,
  };
  return view.label || view.growthThisYear != null ? view : null;
}

/** Analyst consensus for a US stock (cached for 6 hours), or null when there's none. */
export async function getAnalystView(symbol) {
  const cache = await store.get('analysts', {});
  const hit = cache[symbol];
  if (hit && Date.now() - hit.fetched < TTL) return hit.data;

  const url = c => `${API.stockSummary}${encodeURIComponent(symbol)}?modules=financialData,earningsTrend,recommendationTrend&crumb=${encodeURIComponent(c)}`;
  // Funds and other tickers without analyst coverage answer 404.
  const load = async c => fetchJson(url(c), 15000, { credentials: 'include' }).catch(err => {
    if (/HTTP 404/.test(err.message)) return null;
    throw err;
  });
  let d;
  try {
    d = await load(await getCrumb());
  } catch {
    // The crumb expires with the cookie: get a new pair and try once more.
    d = await load(await getCrumb(true));
  }
  const data = toAnalystView(d?.quoteSummary?.result?.[0]);
  for (const [k, v] of Object.entries(cache)) if (Date.now() - v.fetched > 7 * 24 * 3600e3) delete cache[k];
  cache[symbol] = { data, fetched: Date.now() };
  await store.set('analysts', cache);
  return data;
}
