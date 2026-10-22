import { formatRate, pairChange24h } from '../lib/convert.js';
import { coinKey, isCrypto, coinId } from '../lib/currencies.js';
import { refreshCoinPrices } from '../lib/rates.js';
import { getQuotes } from '../lib/stocks.js';
import { iconNode } from './picker.js';
import { changeBadge, setChangeBadge, removeButton, tickerBadge, emptyRow, ago, setStatus, setLiveText } from './assets.js';

const usdFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

// Favourites tab: three side-by-side columns for saved rates, coins and stocks.
export function createFavsTab(app, els) {
  let stockQuotes = {};
  let ok = true;
  let lastRefresh = 0;

  async function refresh() {
    const ids = new Set(app.state.favCoins);
    for (const pair of app.state.favorites) {
      for (const key of pair.split('>')) if (isCrypto(key)) ids.add(coinId(key));
    }
    const coinIds = [...ids].filter(id => app.coinsById.has(id));
    const [coinsOk, stocks] = await Promise.all([
      coinIds.length ? refreshCoinPrices(app.coins, coinIds) : true,
      app.state.favStocks.length ? getQuotes(app.state.favStocks) : { quotes: {}, ok: true },
    ]);
    stockQuotes = stocks.quotes;
    ok = coinsOk && stocks.ok;
    lastRefresh = Date.now();
    render();
  }

  els.panel.addEventListener('click', e => {
    const item = e.target.closest('[data-kind]');
    if (!item) return;
    const { kind, id } = item.dataset;
    const list = { rate: 'favorites', coin: 'favCoins', stock: 'favStocks' }[kind];
    if (e.target.closest('[data-remove]')) return app.toggleFav(list, id);
    if (kind === 'rate') app.openPair(...id.split('>'));
    if (kind === 'coin') app.openCoin(id);
    if (kind === 'stock') app.openStock(id);
  });

  function card(kind, id, { icon, title, value, change, label }) {
    const li = document.createElement('li');
    li.className = 'fav-item';
    li.dataset.kind = kind;
    li.dataset.id = id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-card';
    btn.title = label;
    const head = document.createElement('span');
    head.className = 'fav-card-head';
    const t = document.createElement('b');
    t.textContent = title;
    if (icon) head.append(icon);
    head.append(t);
    const v = document.createElement('span');
    v.className = 'fav-card-value';
    v.textContent = value;
    btn.append(head, v, changeBadge(change));
    li.append(btn, removeButton(title));
    return li;
  }

  function rateCards() {
    return app.state.favorites.map(pair => {
      const [from, to] = pair.split('>').map(k => app.catalog.byKey.get(k));
      if (!from || !to) return null;
      const rate = app.convertKeys(1, from.key, to.key);
      const hasCrypto = from.kind === 'crypto' || to.kind === 'crypto';
      return card('rate', pair, {
        title: `${from.code} → ${to.code}`,
        value: rate == null ? '—' : formatRate(rate, to),
        change: hasCrypto ? pairChange24h(from.coin?.change24h, to.coin?.change24h) : null,
        label: `1 ${from.name} in ${to.name}. Click to open in the converter.`,
      });
    }).filter(Boolean);
  }

  function coinCards() {
    const fiatItem = app.displayFiat();
    return app.state.favCoins.map(id => {
      const coin = app.coinsById.get(id);
      if (!coin || !fiatItem) return null;
      const price = app.convertKeys(1, coinKey(id), fiatItem.key);
      return card('coin', id, {
        icon: iconNode({ kind: 'crypto', code: coin.symbol, image: coin.image }),
        title: coin.symbol,
        value: price == null ? '—' : formatRate(price, fiatItem),
        change: coin.change24h,
        label: `${coin.name}: chart, converter and rates`,
      });
    }).filter(Boolean);
  }

  function stockCards() {
    return app.state.favStocks.map(symbol => {
      const q = stockQuotes[symbol];
      return card('stock', symbol, {
        icon: tickerBadge(symbol),
        title: symbol,
        value: q ? usdFmt.format(q.price) : '—',
        change: q?.changePct,
        label: `${q?.name ?? symbol}: live price and chart`,
      });
    });
  }

  function fill(list, cards, emptyText) {
    list.replaceChildren(...(cards.length ? cards : [emptyRow(emptyText, 'fav-empty')]));
  }

  function render() {
    fill(els.rates, rateCards(), 'Tap ☆ on a conversion in Currencies.');
    fill(els.crypto, coinCards(), 'Tap ☆ on a coin in Crypto.');
    fill(els.stocks, stockCards(), 'Tap ☆ on a stock in Stocks.');
    status();
  }

  // Live crypto ticks: update coin cards in place.
  function tick() {
    const fiatItem = app.displayFiat();
    if (!fiatItem) return;
    for (const li of els.crypto.querySelectorAll('[data-kind="coin"]')) {
      const coin = app.coinsById.get(li.dataset.id);
      if (!coin) continue;
      const price = app.convertKeys(1, coinKey(coin.id), fiatItem.key);
      if (price != null) setLiveText(li.querySelector('.fav-card-value'), formatRate(price, fiatItem), price);
      const change = li.querySelector('.fav-card > span:last-child');
      if (change && coin.change24h != null) setChangeBadge(change, coin.change24h);
    }
    lastRefresh = Date.now();
    status();
  }

  function status() {
    const total = app.state.favorites.length + app.state.favCoins.length + app.state.favStocks.length;
    if (!total) return setStatus(els.status, { text: '' });
    if (!lastRefresh) return setStatus(els.status, { text: 'Updating…' });
    const age = Date.now() - lastRefresh;
    const live = ok && !app.offline && age < 3 * 60e3;
    setStatus(els.status, { state: live ? 'live' : 'stale', text: `${live ? 'Live · ' : ''}updated ${ago(age)}` });
  }

  return { render, status, refresh, tick };
}
