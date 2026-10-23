import { binanceCandles } from '../lib/candles.js';
import { technicals } from '../lib/indicators.js';
import { getOrderBook, analyzeOrderBook } from '../lib/walls.js';
import { technicalSections, orderBookSection, coinMarketSection, score, money } from '../lib/analysis.js';
import { technicalRating } from '../lib/ratings.js';
import { ratingsCard, HOW_COIN, sectionCard, depthChart, header, message } from './analysis-view.js';
import { ago, setStatus } from './assets.js';

/**
 * Crypto analysis tab: technical checks from Binance price history, live order-book buy/sell
 * walls (refreshed every 10 s) and market structure from CoinPaprika.
 */
export function createCryptoAnalysisTab(app, els) {
  const ca = () => app.state.canalysis; // { coin }
  let data = null;
  let loading = false;
  let token = 0;
  let matches = [];

  /* ---------- Search (the loaded coin list) ---------- */

  function showResults(list) {
    matches = list;
    els.results.hidden = !list.length;
    els.results.replaceChildren(...list.map(c => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = c.id;
      const b = document.createElement('b');
      b.textContent = c.symbol;
      const small = document.createElement('small');
      small.textContent = `${c.name} · #${c.rank}`;
      btn.append(b, small);
      li.append(btn);
      return li;
    }));
  }

  els.search.addEventListener('input', () => {
    const q = els.search.value.trim().toLowerCase();
    if (!q) return showResults([]);
    const list = app.coins?.list ?? [];
    const exact = list.filter(c => c.symbol.toLowerCase() === q);
    const rest = list.filter(c => c.symbol.toLowerCase() !== q && (c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
    showResults([...exact, ...rest].slice(0, 6));
  });
  els.search.addEventListener('keydown', e => {
    if (e.key === 'Enter' && matches[0]) analyse(matches[0].id);
  });
  els.results.addEventListener('click', e => {
    const btn = e.target.closest('[data-id]');
    if (btn) analyse(btn.dataset.id);
  });

  function analyse(id) {
    ca().coin = id;
    app.save();
    els.search.value = '';
    showResults([]);
    data = null;
    load();
  }

  /* ---------- Loading ---------- */

  // intradayTtl: how old the 5-minute candles may be (short for the 10-second live refresh).
  async function load({ intradayTtl = 30e3 } = {}) {
    const id = ca().coin;
    const coin = app.coinsById.get(id);
    if (!coin) return render();
    const t = ++token;
    loading = true;
    render();
    const [daily, intraday, book] = await Promise.allSettled([
      binanceCandles(coin.symbol, '1d', 365, 5 * 60e3),
      binanceCandles(coin.symbol, '5m', 288, intradayTtl),
      getOrderBook(coin.symbol),
    ]);
    if (t !== token) return;
    loading = false;
    // Binance tickers can belong to a different coin: only trust them if the price agrees.
    const agrees = candles => candles?.length && Math.abs(candles[candles.length - 1].c - coin.usd) / coin.usd < 0.15;
    const dailyOk = daily.status === 'fulfilled' && agrees(daily.value) && daily.value.length >= 30;
    const day = intraday.status === 'fulfilled' ? intraday.value : [];
    data = {
      // Live 24h change from the last 288 five-minute candles.
      change24h: dailyOk && day.length ? ((day[day.length - 1].c - day[0].o) / day[0].o) * 100 : null,
      id,
      onBinance: dailyOk,
      tech: dailyOk ? technicals(daily.value, day) : null,
      techRating: dailyOk ? technicalRating(daily.value) : null,
      book: dailyOk && book.status === 'fulfilled' ? analyzeOrderBook(book.value.bids, book.value.asks) : null,
      fetched: Date.now(),
      bookFetched: Date.now(),
    };
    render();
  }

  // Every 10 s: fresh price candles and order book (daily history comes from its cache).
  function fastRefresh() {
    if (!loading && data?.id === ca().coin && data.onBinance) load({ intradayTtl: 5e3 });
  }

  /* ---------- Rendering ---------- */

  function render() {
    const coin = app.coinsById.get(ca().coin);
    if (!coin) {
      els.body.replaceChildren(message(app.coins ? 'Search for a coin to analyse.' : 'Loading coins…', !app.coins));
      return status();
    }
    const fiat = app.displayFiat();
    const perUsd = fiat ? app.convertKeys(1, 'USD', fiat.key) ?? 1 : 1;
    const fmt = v => money(v * perUsd, fiat?.code ?? 'USD');
    const nodes = [header({
      title: coin.name,
      subtitle: `${coin.symbol} · rank #${coin.rank}`,
      price: fmt(data?.tech?.price ?? coin.usd),
      changePct: data?.id === coin.id && data.change24h != null ? data.change24h : coin.change24h,
      action: { label: 'Coin page ›', onClick: () => app.openCoin(coin.id) },
    })];
    if (!data || data.id !== coin.id) {
      nodes.push(message(`Analysing ${coin.symbol}…`, true));
      els.body.replaceChildren(...nodes);
      return status();
    }
    const sections = [
      ...(data.tech ? technicalSections(data.tech, { fmt, vwapLabel: 'VWAP (24h)' }) : []),
      orderBookSection(data.book, fmt),
      coinMarketSection(coin),
    ].filter(Boolean);
    nodes.push(ratingsCard({ tech: data.techRating, checks: score(sections), how: HOW_COIN }));
    for (const s of sections) {
      nodes.push(sectionCard(s));
      if (s.title === 'Order book walls' && data.book) nodes.push(depthChart(data.book, fmt));
    }
    if (!data.onBinance) nodes.push(message(`${coin.symbol} isn’t traded on Binance, so price checks and the order book aren’t available. Market data is still shown.`));
    els.body.replaceChildren(...nodes);
    status();
  }

  function status() {
    if (!data?.fetched) return setStatus(els.status, { text: loading ? 'Loading…' : '' });
    const age = Date.now() - (data.bookFetched ?? data.fetched);
    setStatus(els.status, { state: age < 30e3 ? 'live' : 'stale', text: data.onBinance ? `Live · prices and order book updated ${ago(age)}` : `Updated ${ago(age)}` });
  }

  async function refresh() {
    if (!app.coins) await app.loadData();
    if (!data || data.id !== ca().coin || Date.now() - data.fetched > 60e3) await load();
    else render();
  }

  return { render, status, refresh, fastRefresh, analyse };
}
