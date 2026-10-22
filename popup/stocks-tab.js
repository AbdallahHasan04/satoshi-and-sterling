import { getQuotes, searchStocks, marketSession, getStockChart, STOCK_RANGES } from '../lib/stocks.js';
import { INDICES, POPULAR_STOCKS } from '../lib/config.js';
import { drawChart, clearChart } from './chart.js';
import {
  changeBadge, setChangeBadge, starButton, nameBlock, priceBlock, tickerBadge, emptyRow, ago, setStatus, setLiveText,
} from './assets.js';

const usdFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const pointsFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const chartTimeFmt = {
  short: new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
  long: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
};

const unique = list => [...new Set(list)];
const isIndex = symbol => symbol.startsWith('^');
const indexName = symbol => INDICES.find(i => i.symbol === symbol)?.name;
// Indices are quoted in points, everything else in dollars.
const money = (symbol, value) => (isIndex(symbol) ? pointsFmt.format(value) : usdFmt.format(value));

function sessionText(session) {
  if (!session) return '';
  const at = session.at ? `${etFmt.format(session.at)} ET` : '';
  switch (session.state) {
    case 'open': return `Market open · closes ${at}`;
    case 'pre': return `Pre-market${at ? ` · opens ${at}` : ''}`;
    case 'post': return 'After hours · market closed';
    default: return `Market closed${at ? ` · opens ${at}` : ''}`;
  }
}

/**
 * Stocks tab: indices, market session, ticker search and a watchlist; clicking a stock (or index)
 * opens its page with a live price (every 10 s), chart ranges from 1D to 5Y and key stats.
 */
export function createStocksTab(app, els) {
  let quotes = {};
  let ok = true;
  let lastFetch = 0;
  let results = null;      // search results, or null when not searching
  let searchFailed = false;
  let searchTimer;
  let searchToken = 0;
  let chartToken = 0;
  let chartFor = '';

  const ss = () => app.state.stocks; // { symbol, range }
  const listSymbols = () => (results ? results.map(r => r.symbol) : unique([...app.state.favStocks, ...POPULAR_STOCKS]));

  async function refresh({ force = false } = {}) {
    const symbols = ss().symbol ? [ss().symbol] : unique([...INDICES.map(i => i.symbol), ...listSymbols()]);
    const res = await getQuotes(symbols, force ? { maxAge: 0 } : undefined);
    quotes = { ...quotes, ...res.quotes };
    ok = res.ok;
    lastFetch = Date.now();
    render();
  }

  // Every 10 s on the stock page: price and stats, plus the intraday chart once a minute.
  async function fastRefresh() {
    if (!ss().symbol) return;
    await refresh({ force: true });
    if (ss().range === '1d') loadChart();
  }

  /* ---------- Navigation ---------- */

  function openStock(symbol) {
    ss().symbol = symbol;
    app.save();
    chartFor = '';
    render();
    refresh({ force: true });
  }

  function closeStock() {
    ss().symbol = null;
    app.save();
    render();
    refresh();
  }

  /* ---------- List ---------- */

  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.search.value.trim();
    if (!q) {
      searchToken++;
      results = null;
      searchFailed = false;
      render();
      refresh();
      return;
    }
    searchTimer = setTimeout(async () => {
      const token = ++searchToken;
      try {
        const found = await searchStocks(q);
        if (token !== searchToken) return;
        results = found;
        searchFailed = false;
      } catch {
        if (token !== searchToken) return;
        results = [];
        searchFailed = true;
      }
      render();
      if (results.length) refresh();
    }, 300);
  });

  els.list.addEventListener('click', e => {
    const row = e.target.closest('[data-symbol]');
    if (!row) return;
    if (e.target.closest('.star-btn')) app.toggleFav('favStocks', row.dataset.symbol);
    else openStock(row.dataset.symbol);
  });

  els.indices.addEventListener('click', e => {
    const card = e.target.closest('[data-symbol]');
    if (card) openStock(card.dataset.symbol);
  });

  function indexCard({ symbol, name }) {
    const q = quotes[symbol];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'index-card';
    card.dataset.symbol = symbol;
    card.title = `${name}: chart and stats`;
    const label = document.createElement('span');
    label.className = 'index-name';
    label.textContent = name;
    const value = document.createElement('b');
    value.textContent = q ? pointsFmt.format(q.price) : '—';
    card.append(label, value, changeBadge(q?.changePct));
    return card;
  }

  function row(symbol, fav) {
    const q = quotes[symbol];
    const name = q?.name ?? results?.find(r => r.symbol === symbol)?.name ?? '';
    const li = document.createElement('li');
    li.className = 'asset-row';
    li.dataset.symbol = symbol;
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'asset-main';
    main.title = `${name || symbol}: live price and chart`;
    main.append(
      tickerBadge(symbol),
      nameBlock(symbol, name),
      priceBlock(q ? usdFmt.format(q.price) : '—', q?.changePct),
    );
    li.append(main, starButton(fav, symbol));
    return li;
  }

  function renderList() {
    els.indices.replaceChildren(...INDICES.map(indexCard));
    const session = marketSession((quotes['^GSPC'] ?? Object.values(quotes)[0])?.period);
    els.market.textContent = sessionText(session);
    els.market.dataset.state = session?.state ?? '';

    const q = els.search.value.trim();
    if (results) els.title.textContent = searchFailed ? 'Search' : `Results for “${q}”`;
    else els.title.textContent = app.state.favStocks.length ? 'Your stocks & popular' : 'Popular US stocks';

    const favs = new Set(app.state.favStocks);
    let rows = listSymbols().map(s => row(s, favs.has(s)));
    if (results && !results.length) {
      rows = [emptyRow(searchFailed ? 'Search isn’t available right now. Try again in a moment.' : 'No US stocks or ETFs match that search.')];
    }
    const top = els.list.scrollTop;
    els.list.replaceChildren(...rows);
    els.list.scrollTop = top;
  }

  /* ---------- Stock page ---------- */

  els.back.addEventListener('click', closeStock);
  els.star.addEventListener('click', () => app.toggleFav('favStocks', ss().symbol));

  for (const btn of els.ranges.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      ss().range = btn.dataset.range;
      app.save();
      render();
    });
  }

  function chartMsg(text, loading = false) {
    clearChart(els.chart, els.chartTip);
    els.chartChange.hidden = true;
    els.chartMsg.hidden = false;
    els.chartMsg.classList.toggle('is-loading', loading);
    els.chartMsg.textContent = text;
  }

  async function loadChart() {
    const token = ++chartToken;
    const { symbol, range } = ss();
    if (!symbol) return;
    if (!els.chart.innerHTML) chartMsg('', true);
    try {
      const points = [...await getStockChart(symbol, range)]; // copy: we append the live price below
      if (token !== chartToken) return;
      if (points.length < 2) return chartMsg('No chart data for this range.');
      const q = quotes[symbol];
      // On 1D, measure from yesterday's close (the dashed line), like most finance apps.
      const baseline = range === '1d' ? q?.prevClose : undefined;
      if (range === '1d' && q?.price) points.push([q.time || Date.now(), q.price]);
      els.chartMsg.hidden = true;
      const fmt = range === '1d' || range === '5d' ? chartTimeFmt.short : chartTimeFmt.long;
      const pct = drawChart(els.chart, els.chartTip, points, {
        formatValue: v => money(symbol, v),
        formatTime: t => fmt.format(t),
        baseline,
      });
      els.chartChange.hidden = false;
      setChangeBadge(els.chartChange, pct, STOCK_RANGES[range].label);
    } catch {
      if (token === chartToken) chartMsg('Couldn’t load the chart right now. Try again in a minute.');
    }
  }

  function renderStats(symbol, q) {
    const range = (lo, hi) => (lo != null && hi != null ? `${money(symbol, lo)} – ${money(symbol, hi)}` : '—');
    const stats = [
      ['Previous close', q?.prevClose != null ? money(symbol, q.prevClose) : '—'],
      ['Day range', range(q?.dayLow, q?.dayHigh)],
      ['52-week range', range(q?.yearLow, q?.yearHigh)],
      ['Volume', q?.volume ? compactFmt.format(q.volume) : '—'],
    ];
    els.stats.replaceChildren(...stats.map(([label, value]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    }));
  }

  function renderDetail() {
    const { symbol, range } = ss();
    const q = quotes[symbol];
    const name = indexName(symbol) ?? q?.name ?? results?.find(r => r.symbol === symbol)?.name ?? symbol;
    els.exchange.textContent = q?.exchange ?? (isIndex(symbol) ? 'Index' : '');
    els.exchange.hidden = !els.exchange.textContent;
    els.icon.replaceChildren(tickerBadge(symbol));
    els.name.textContent = name;
    els.symbol.textContent = symbol;
    const fav = app.state.favStocks.includes(symbol);
    els.star.hidden = isIndex(symbol);
    els.star.setAttribute('aria-pressed', String(fav));
    els.star.title = els.star.ariaLabel = fav ? `Remove ${symbol} from favourites` : `Add ${symbol} to favourites`;
    setLiveText(els.price, q ? money(symbol, q.price) : '—', q?.price);
    els.change.hidden = q?.changePct == null;
    if (q?.changePct != null) setChangeBadge(els.change, q.changePct, 'today');
    const session = marketSession(q?.period);
    els.session.textContent = sessionText(session);
    els.session.dataset.state = session?.state ?? '';
    for (const btn of els.ranges.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.range === range));
    renderStats(symbol, q);

    const key = `${symbol}|${range}|${q ? 1 : 0}`;
    if (key !== chartFor) {
      chartFor = key;
      clearChart(els.chart, els.chartTip);
      loadChart();
    }
  }

  /* ---------- Tab interface ---------- */

  function render() {
    const detail = !!ss().symbol;
    els.listView.hidden = detail;
    els.detail.hidden = !detail;
    if (detail) renderDetail();
    else renderList();
    status();
  }

  function status() {
    const el = ss().symbol ? els.detailStatus : els.status;
    if (!lastFetch) return setStatus(el, { text: 'Loading quotes…' });
    if (!ok && !Object.keys(quotes).length) return setStatus(el, { state: 'stale', text: 'Couldn’t load stock quotes.' });
    const age = Date.now() - lastFetch;
    const live = ok && age < (ss().symbol ? 30e3 : 3 * 60e3);
    const what = ss().symbol ? 'refreshes every 10 s' : 'US markets';
    setStatus(el, { state: live ? 'live' : 'stale', text: `${live ? 'Live · ' : ''}${what} · updated ${ago(age)}` });
  }

  return { render, status, refresh, fastRefresh, openStock };
}
