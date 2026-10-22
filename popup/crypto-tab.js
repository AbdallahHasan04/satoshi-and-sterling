import { formatRate, formatAmount, parseAmountInput, countDigits, amountInputFor } from '../lib/convert.js';
import { coinKey, coinId, isCrypto } from '../lib/currencies.js';
import { getHistory, RANGES } from '../lib/history.js';
import { refreshCoinPrices } from '../lib/rates.js';
import { MAX_DIGITS, TTL } from '../lib/config.js';
import { CurrencyPicker, iconNode } from './picker.js';
import { drawChart, clearChart } from './chart.js';
import { starButton, nameBlock, priceBlock, emptyRow, ago, setStatus, setChangeBadge, setLiveText } from './assets.js';

const PAGE = 100; // list rows rendered at a time; more load as you scroll
const RATE_TARGETS = ['USD', 'EUR', 'GBP', 'JPY', 'c:btc-bitcoin', 'c:eth-ethereum', 'c:usdt-tether'];

const timeFmt = {
  short: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  long: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
};

function compactMoney(value, code) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value)} ${code}`;
  }
}

/**
 * Crypto tab: a searchable list of the top ~2,000 coins (only established memecoins), and a detail page per coin
 * with its chart, stats, a converter (to any coin or currency) and exchange rates.
 */
export function createCryptoTab(app, els) {
  let query = '';
  let limit = PAGE;
  let groupsStamp = '';
  let lastResult = null;
  let flashMsg = null;
  let flashTimer;
  let chartTimer;
  let chartToken = 0;

  const cs = () => app.state.crypto; // { coin, from, to, amount, range }
  const item = key => app.catalog.byKey.get(key);

  /* ---------- Navigation ---------- */

  function openCoin(id) {
    Object.assign(cs(), { coin: id, from: coinKey(id), to: app.displayFiat()?.key ?? 'USD', amount: '1' });
    els.amount.value = '1';
    app.save();
    render();
    els.detail.scrollIntoView?.({ block: 'start' });
    refresh();
  }

  function closeCoin() {
    cs().coin = null;
    app.save();
    render();
  }

  /* ---------- List ---------- */

  els.search.addEventListener('input', () => {
    query = els.search.value.trim().toLowerCase();
    limit = PAGE;
    renderList();
    els.list.scrollTop = 0;
  });

  els.list.addEventListener('scroll', () => {
    if (els.list.scrollTop + els.list.clientHeight > els.list.scrollHeight - 200 && limit < matches().length) {
      limit += PAGE;
      renderList();
    }
  });

  els.list.addEventListener('click', e => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    if (e.target.closest('.star-btn')) app.toggleFav('favCoins', row.dataset.id);
    else openCoin(row.dataset.id);
  });

  function matches() {
    const list = app.coins?.list ?? [];
    if (!query) return list;
    const exact = [];
    const rest = [];
    for (const c of list) {
      const sym = c.symbol.toLowerCase();
      if (sym === query) exact.push(c);
      else if (sym.includes(query) || c.name.toLowerCase().includes(query)) rest.push(c);
    }
    return [...exact, ...rest];
  }

  function row(coin, fiatItem, fav) {
    const li = document.createElement('li');
    li.className = 'asset-row';
    li.dataset.id = coin.id;
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'asset-main';
    main.title = `${coin.name}: chart, converter and rates`;
    const rank = document.createElement('span');
    rank.className = 'asset-rank';
    rank.textContent = coin.rank;
    const price = app.convertKeys(1, coinKey(coin.id), fiatItem.key);
    main.append(
      rank,
      iconNode({ kind: 'crypto', code: coin.symbol, image: coin.image }),
      nameBlock(coin.symbol, coin.name),
      priceBlock(price == null ? '—' : formatRate(price, fiatItem), coin.change24h),
    );
    li.append(main, starButton(fav, coin.name));
    return li;
  }

  function renderList() {
    const fiatItem = app.displayFiat();
    els.unit.textContent = fiatItem ? `${fiatItem.code} · 24h` : '';
    if (app.coins?.list.length) els.search.placeholder = `Search ${app.coins.list.length.toLocaleString()} coins…`;
    if (!app.coins?.list.length || !fiatItem) {
      els.list.replaceChildren(emptyRow(app.loadError ? 'Couldn’t load prices.' : 'Loading coins…'));
      return;
    }
    const favs = new Set(app.state.favCoins);
    const found = matches();
    const rows = found.slice(0, limit).map(c => row(c, fiatItem, favs.has(c.id)));
    const top = els.list.scrollTop;
    els.list.replaceChildren(...(rows.length ? rows : [emptyRow(`No coins match “${els.search.value.trim()}”. Small or short-lived memecoins aren’t listed.`)]));
    els.list.scrollTop = top;
  }

  /* ---------- Detail: converter ---------- */

  const fromPicker = new CurrencyPicker(els.fromPicker, {
    label: 'Convert from',
    onChange: key => (key === cs().to ? setConv(key, cs().from) : setConv(key, cs().to)),
  });
  const toPicker = new CurrencyPicker(els.toPicker, {
    label: 'Convert to',
    onChange: key => (key === cs().from ? setConv(cs().to, key) : setConv(cs().from, key)),
  });

  function setConv(from, to) {
    cs().from = from;
    cs().to = to;
    app.save();
    renderConverter();
    refresh();
  }

  // Coins first (by market cap), then fiat currencies.
  function updatePickerGroups() {
    const stamp = `${app.coins?.fetched}|${app.catalog.groups.length}`;
    if (stamp === groupsStamp) return;
    groupsStamp = stamp;
    const coins = (app.coins?.list ?? []).map(c => item(coinKey(c.id))).filter(Boolean);
    const fiat = app.catalog.groups.find(g => g.label === 'Currencies')?.items ?? [];
    const groups = [{ label: 'Crypto', items: coins }, { label: 'Currencies', items: fiat }].filter(g => g.items.length);
    fromPicker.setGroups(groups);
    toPicker.setGroups(groups);
  }

  function setAmountError(message) {
    const msg = flashMsg ?? message;
    els.amountError.hidden = !msg;
    els.amountError.textContent = msg ?? '';
    els.amount.setAttribute('aria-invalid', String(!!msg));
    els.amount.classList.toggle('is-invalid', !!msg);
  }

  let lastAccepted = '1';
  els.amount.addEventListener('input', () => {
    const v = els.amount.value;
    if (countDigits(v) > MAX_DIGITS) {
      els.amount.value = lastAccepted;
      flashMsg = `You can enter up to ${MAX_DIGITS} digits.`;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashMsg = null; renderConverter(); }, 2500);
      renderConverter();
      return;
    }
    lastAccepted = cs().amount = v;
    app.save();
    renderConverter();
  });

  els.swap.addEventListener('click', () => {
    els.swap.classList.toggle('spin');
    const amount = lastResult ? amountInputFor(lastResult.value, lastResult.to) : null;
    if (amount != null) els.amount.value = lastAccepted = cs().amount = amount;
    setConv(cs().to, cs().from);
  });

  els.copy.addEventListener('click', () => {
    if (lastResult) app.copyText(formatAmount(lastResult.value, lastResult.to, { raw: app.settings.copyFormat === 'raw' }), els.copy);
  });

  function renderConverter() {
    updatePickerGroups();
    fromPicker.setValue(cs().from);
    toPicker.setValue(cs().to);
    if (document.activeElement !== els.amount) els.amount.value = lastAccepted = cs().amount;
    const parsed = parseAmountInput(els.amount.value);
    setAmountError(parsed.error);
    const to = item(cs().to);
    const value = to && parsed.value != null ? app.convertKeys(parsed.value, cs().from, cs().to) : null;
    lastResult = value == null ? null : { value, to };
    els.result.textContent = value == null ? '—' : formatAmount(value, to);
    els.copy.disabled = value == null;
  }

  /* ---------- Detail: rates, stats, chart ---------- */

  els.rates.addEventListener('click', e => {
    const li = e.target.closest('[data-key]');
    if (li) setConv(coinKey(cs().coin), li.dataset.key);
  });

  function renderRates(coin, fiatItem) {
    const key = coinKey(coin.id);
    const targets = [...new Set([fiatItem.key, ...RATE_TARGETS])].filter(k => k !== key && item(k)).slice(0, 6);
    els.ratesTitle.textContent = `1 ${coin.symbol} in`;
    const shown = [...els.rates.children].map(li => li.dataset.key);
    if (shown.join() === targets.join()) {
      for (const li of els.rates.children) {
        const rate = app.convertKeys(1, key, li.dataset.key);
        if (rate != null) setLiveText(li.querySelector('b'), formatRate(rate, item(li.dataset.key)), rate);
      }
      return;
    }
    els.rates.replaceChildren(...targets.map(k => {
      const target = item(k);
      const rate = app.convertKeys(1, key, k);
      const li = document.createElement('li');
      li.dataset.key = k;
      li.title = `Convert ${coin.symbol} to ${target.code}`;
      const code = document.createElement('span');
      code.textContent = target.code;
      const value = document.createElement('b');
      value.textContent = rate == null ? '—' : formatRate(rate, target);
      li.append(code, value);
      return li;
    }));
  }

  function renderStats(coin, fiatItem) {
    const perUsd = app.convertKeys(1, 'USD', fiatItem.key) ?? 1;
    const stats = [
      ['Market cap', coin.marketCap ? compactMoney(coin.marketCap * perUsd, fiatItem.code) : '—'],
      ['Volume 24h', coin.volume24h ? compactMoney(coin.volume24h * perUsd, fiatItem.code) : '—'],
      ['7 days', coin.change7d == null ? '—' : `${coin.change7d >= 0 ? '+' : ''}${coin.change7d.toFixed(2)}%`],
      ['All-time high', coin.ath ? formatRate(coin.ath * perUsd, fiatItem) : '—'],
    ];
    els.stats.replaceChildren(...stats.flatMap(([label, value]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      div.append(dt, dd);
      return [div];
    }));
  }

  for (const btn of els.ranges.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      cs().range = btn.dataset.range;
      app.save();
      renderRanges();
      scheduleChart();
    });
  }

  function renderRanges() {
    for (const btn of els.ranges.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.range === cs().range));
  }

  function chartMsg(text, loading = false) {
    clearChart(els.chart, els.chartTip);
    els.chartChange.hidden = true;
    els.chartMsg.hidden = false;
    els.chartMsg.classList.toggle('is-loading', loading);
    els.chartMsg.textContent = text;
  }

  function scheduleChart() {
    clearTimeout(chartTimer);
    chartTimer = setTimeout(loadChart, 250);
  }

  async function loadChart() {
    const token = ++chartToken;
    const { coin, range } = cs();
    const fiatItem = app.displayFiat();
    if (!coin || !fiatItem || !app.coinsById.has(coin)) return;
    chartMsg('', true);
    try {
      const hist = await getHistory(coinKey(coin), fiatItem.key, range, { fiat: app.fiat, coinsById: app.coinsById });
      if (token !== chartToken) return;
      if (!hist || hist.points.length < 2) return chartMsg('No price history for this coin yet.');
      els.chartMsg.hidden = true;
      const fmt = range === '1y' || range === '30d' ? timeFmt.long : timeFmt.short;
      const pct = drawChart(els.chart, els.chartTip, hist.points, {
        formatValue: v => formatRate(v, fiatItem),
        formatTime: t => fmt.format(t),
      });
      els.chartChange.hidden = false;
      setChangeBadge(els.chartChange, pct, RANGES[range].label);
      els.chartChange.title = hist.approx ? `Approximate: converted from USD at today’s ${fiatItem.code} rate` : '';
    } catch {
      if (token === chartToken) chartMsg('Couldn’t load the chart right now. Try again in a minute.');
    }
  }

  function renderDetail() {
    const coin = app.coinsById.get(cs().coin);
    const fiatItem = app.displayFiat();
    if (!coin || !fiatItem) {
      if (app.coins) return closeCoin(); // coin no longer listed
      return;
    }
    els.rank.textContent = `Rank #${coin.rank}`;
    els.icon.replaceChildren(iconNode({ kind: 'crypto', code: coin.symbol, image: coin.image }));
    els.name.textContent = coin.name;
    els.symbol.textContent = coin.symbol;
    const fav = app.state.favCoins.includes(coin.id);
    els.star.setAttribute('aria-pressed', String(fav));
    els.star.title = els.star.ariaLabel = fav ? `Remove ${coin.name} from favourites` : `Add ${coin.name} to favourites`;
    const price = app.convertKeys(1, coinKey(coin.id), fiatItem.key);
    setLiveText(els.price, price == null ? '—' : formatRate(price, fiatItem), price);
    els.change.hidden = coin.change24h == null;
    if (coin.change24h != null) setChangeBadge(els.change, coin.change24h, '24h');
    els.chartLabel.textContent = `${coin.symbol} / ${fiatItem.code}`;
    renderStats(coin, fiatItem);
    renderRanges();
    renderConverter();
    renderRates(coin, fiatItem);
  }

  els.back.addEventListener('click', closeCoin);
  els.star.addEventListener('click', () => app.toggleFav('favCoins', cs().coin));

  /* ---------- Live ticks ---------- */

  // Called about once a second while Binance prices stream in: update prices in place
  // (rebuilding rows every second would swallow clicks).
  function tick() {
    const fiatItem = app.displayFiat();
    if (!fiatItem) return;
    if (cs().coin) {
      const coin = app.coinsById.get(cs().coin);
      if (!coin) return;
      const price = app.convertKeys(1, coinKey(coin.id), fiatItem.key);
      if (price != null) setLiveText(els.price, formatRate(price, fiatItem), price);
      if (coin.change24h != null) setChangeBadge(els.change, coin.change24h, '24h');
      renderConverter();
      renderRates(coin, fiatItem);
    } else {
      for (const li of els.list.children) {
        const coin = app.coinsById.get(li.dataset.id);
        if (!coin) continue;
        const price = app.convertKeys(1, coinKey(coin.id), fiatItem.key);
        const b = li.querySelector('.asset-price b');
        if (b && price != null) setLiveText(b, formatRate(price, fiatItem), price);
        const change = li.querySelector('.asset-price .change, .asset-price span:last-child');
        if (change && coin.change24h != null) setChangeBadge(change, coin.change24h);
      }
    }
    status();
  }

  /* ---------- Tab interface ---------- */

  let chartFor = '';
  function render() {
    const detail = !!cs().coin;
    els.listView.hidden = detail;
    els.detail.hidden = !detail;
    if (detail) {
      renderDetail();
      // Reload the chart when the coin, range or display currency changes.
      const key = `${cs().coin}|${cs().range}|${app.displayFiat()?.key}|${app.coins ? 1 : 0}`;
      if (key !== chartFor && cs().coin) {
        chartFor = key;
        scheduleChart();
      }
    } else {
      chartFor = '';
      renderList();
    }
    status();
  }

  async function refresh() {
    if (!cs().coin) return app.loadData({ coinsMaxAge: TTL.coinsLive });
    if (!app.coins || Date.now() - app.coins.fetched > TTL.coins) await app.loadData();
    const ids = [cs().coin, ...[cs().from, cs().to].filter(isCrypto).map(coinId)];
    await refreshCoinPrices(app.coins, [...new Set(ids)].filter(id => app.coinsById.has(id)));
    if (cs().range === '24h') scheduleChart();
    render();
  }

  function status() {
    const coins = app.coins;
    if (!coins) return setStatus(els.status, { text: app.loadError ? '' : 'Loading…' });
    const count = `${coins.list.length.toLocaleString()} coins`;
    if (app.liveState === 'live' && Date.now() - app.lastLiveTick < 10e3) {
      return setStatus(els.status, { state: 'live', text: `Live · real-time prices · ${count}` });
    }
    const age = Date.now() - coins.fetched;
    const live = !app.offline && age < 3 * TTL.coinsLive;
    setStatus(els.status, { state: live ? 'live' : 'stale', text: `${live ? 'Live · ' : ''}${count} · updated ${ago(age)}` });
  }

  return { render, status, refresh, tick, openCoin };
}
