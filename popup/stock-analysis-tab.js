import { yahooCandles } from '../lib/candles.js';
import { technicals } from '../lib/indicators.js';
import { getFinancials, analyzeFundamentals, getMarketInputs } from '../lib/fundamentals.js';
import { getOptionChain, analyzeOptions } from '../lib/walls.js';
import { getAnalystView } from '../lib/analysts.js';
import { searchStocks, getQuotes } from '../lib/stocks.js';
import { technicalSections, fundamentalSections, optionsSection, score, money } from '../lib/analysis.js';
import { technicalRating, starRating, uncertaintyFromVolatility, annualVolatility, piotroski } from '../lib/ratings.js';
import { ratingsCard, HOW_STOCK, sectionCard, optionsChart, header, message } from './analysis-view.js';
import { ago, setStatus, extPrice } from './assets.js';

const isIndex = symbol => symbol.startsWith('^');

/**
 * Stock analysis tab: technical checks from Yahoo price history, fundamental checks and a DCF fair
 * value from SEC filings, and options-based buy/sell walls from Cboe.
 */
export function createStockAnalysisTab(app, els) {
  const sa = () => app.state.sanalysis; // { symbol }
  let data = null;
  let loading = false;
  let token = 0;
  let results = [];
  let resultsFor = ''; // the search text `results` belong to
  let searchTimer;
  let searchToken = 0;
  const names = new Map();

  /* ---------- Search ---------- */

  function showResults(list, query = '') {
    results = list;
    resultsFor = query;
    els.results.hidden = !list.length;
    els.results.replaceChildren(...list.map(r => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.symbol = r.symbol;
      const b = document.createElement('b');
      b.textContent = r.symbol;
      const small = document.createElement('small');
      small.textContent = r.name;
      btn.append(b, small);
      li.append(btn);
      return li;
    }));
  }

  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.search.value.trim();
    if (!q) { searchToken++; showResults([]); return; }
    searchTimer = setTimeout(async () => {
      const t = ++searchToken;
      try {
        const found = await searchStocks(q);
        if (t === searchToken) showResults(found.slice(0, 6), q);
      } catch {
        if (t === searchToken) showResults([]);
      }
    }, 300);
  });
  els.search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const text = els.search.value.trim();
    const q = text.toUpperCase();
    // Only use the results if they're for what's typed now (the search may still be running).
    if (results[0] && resultsFor === text) analyse(results[0].symbol, results[0].name);
    else if (/^[A-Z.^-]{1,10}$/.test(q)) analyse(q);
  });
  els.results.addEventListener('click', e => {
    const btn = e.target.closest('[data-symbol]');
    if (btn) analyse(btn.dataset.symbol, results.find(r => r.symbol === btn.dataset.symbol)?.name);
  });

  function analyse(symbol, name) {
    if (name) names.set(symbol, name);
    clearTimeout(searchTimer);
    searchToken++; // drop any search still in flight
    sa().symbol = symbol;
    app.save();
    els.search.value = '';
    showResults([]);
    data = null;
    load();
  }

  /* ---------- Loading ---------- */

  // intradayTtl: how old today's 5-minute prices may be (short for the 10-second live refresh).
  async function load({ intradayTtl = 30e3 } = {}) {
    const symbol = sa().symbol;
    const t = ++token;
    loading = true;
    render();
    const [daily, intraday, quote, fin, chain, mkt, analyst] = await Promise.allSettled([
      yahooCandles(symbol, '1y', '1d', 5 * 60e3),
      yahooCandles(symbol, '1d', '5m', intradayTtl),
      getQuotes([symbol], { maxAge: intradayTtl }), // for the pre-market / after-hours price
      isIndex(symbol) ? Promise.resolve(null) : getFinancials(symbol),
      isIndex(symbol) ? Promise.resolve(null) : getOptionChain(symbol),
      isIndex(symbol) ? Promise.resolve(null) : getMarketInputs(symbol), // DCF discount rate
      isIndex(symbol) ? Promise.resolve(null) : getAnalystView(symbol),
    ]);
    if (t !== token) return;
    loading = false;
    if (daily.status === 'rejected' || daily.value.length < 30) {
      data = { symbol, error: `Couldn’t load price history for ${symbol}. Check the ticker and try again.` };
      return render();
    }
    const tech = technicals(daily.value, intraday.status === 'fulfilled' ? intraday.value : []);
    const prevClose = daily.value.length > 1 ? daily.value[daily.value.length - 2].c : null;
    const finData = fin.status === 'fulfilled' ? fin.value : null;
    const analystView = analyst.status === 'fulfilled' ? analyst.value : undefined;
    const fund = finData ? analyzeFundamentals(finData, tech.price, mkt.status === 'fulfilled' ? mkt.value : null, analystView) : null;
    data = {
      symbol,
      tech,
      changePct: prevClose ? ((tech.price - prevClose) / prevClose) * 100 : null,
      ext: quote.status === 'fulfilled' ? quote.value.quotes[symbol]?.ext ?? null : null,
      fin: finData,
      fund,
      techRating: technicalRating(daily.value),
      analyst: analystView,
      stars: fund ? starRating(tech.price, fund.fairValue, uncertaintyFromVolatility(annualVolatility(daily.value))) : null,
      fscore: finData?.years ? piotroski(...finData.years) : null,
      finError: fin.status === 'rejected',
      // Missing site access (e.g. after an update added the source) shows a specific message.
      secBlocked: fin.status === 'rejected' && !(await app.hasAccess('https://data.sec.gov/*')),
      cboeBlocked: chain.status === 'rejected' && !(await app.hasAccess('https://cdn-api.cboe.com/*')),
      opts: chain.status === 'fulfilled' && chain.value ? analyzeOptions(chain.value.options, tech.price) : null,
      optsError: chain.status === 'rejected',
      fetched: Date.now(),
    };
    if (finData?.name) names.set(symbol, finData.name);
    render();
  }

  /* ---------- Rendering ---------- */

  function render() {
    const symbol = sa().symbol;
    if (!data || data.symbol !== symbol) {
      els.body.replaceChildren(message(loading ? `Analysing ${symbol}…` : 'Search for a US stock or ETF to analyse.', loading));
      return status();
    }
    if (data.error) {
      els.body.replaceChildren(message(data.error));
      return status();
    }
    const { tech, fund, opts } = data;
    const sections = [
      ...technicalSections(tech),
      ...fundamentalSections(fund, tech.price),
      optionsSection(opts, tech.price),
    ].filter(Boolean);

    const nodes = [
      header({
        title: names.get(symbol) ?? symbol,
        subtitle: symbol,
        price: money(tech.price),
        changePct: data.changePct,
        extra: data.ext && extPrice(data.ext, money(data.ext.price)),
        action: { label: 'Stock page ›', onClick: () => app.openStock(symbol) },
      }),
      ratingsCard({ tech: data.techRating, analyst: data.analyst, price: tech.price, stars: data.stars, bank: !!fund?.isFinancial, fscore: data.fscore, checks: score(sections), stock: !isIndex(symbol), how: HOW_STOCK }),
    ];
    for (const s of sections) {
      nodes.push(sectionCard(s));
      if (s.title === 'Options walls' && opts?.bars.length) nodes.push(optionsChart(opts, tech.price));
    }
    const notes = [];
    if (isIndex(symbol)) notes.push('Indices have no company financials or listed options, so only price checks are shown.');
    else if (data.secBlocked) notes.push('Company financials need access to the SEC’s website. Click Allow on the banner at the top of the popup.');
    else if (data.finError) notes.push('Couldn’t load company financials right now.');
    else if (!fund) notes.push('No SEC financials for this ticker (funds, ETFs and most non-US companies don’t file them), so only price checks are shown.');
    else notes.push(`Financials from SEC filings up to ${new Date(fund.asOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}. Fair value is a rough discounted-cash-flow estimate.`);
    if (fund?.partialMonths) notes.push(`Newly listed: no annual report yet, so yearly figures are annualised from the first ${fund.partialMonths} months and growth compares the same months a year earlier.`);
    if (!isIndex(symbol) && !opts) {
      if (data.cboeBlocked) notes.push('Options walls need access to Cboe’s website. Click Allow on the banner at the top of the popup.');
      else notes.push(data.optsError ? 'Couldn’t load options data right now.' : 'No listed options for this ticker.');
    }
    for (const n of notes) nodes.push(message(n));
    els.body.replaceChildren(...nodes);
    status();
  }

  function status() {
    if (loading && !data) return setStatus(els.status, { text: 'Loading…' });
    if (!data?.fetched) return setStatus(els.status, { text: '' });
    const age = Date.now() - data.fetched;
    setStatus(els.status, { state: age < 3 * 60e3 ? 'live' : 'stale', text: `Prices updated ${ago(age)} · options ~15 min delayed` });
  }

  async function refresh() {
    if (!data || data.symbol !== sa().symbol || Date.now() - data.fetched > 60e3) await load();
  }

  // Every 10 s: fresh intraday prices; financials and options come from their caches.
  function fastRefresh() {
    if (!loading && data?.symbol === sa().symbol && !data.error) load({ intradayTtl: 5e3 });
  }

  return { render, status, refresh, fastRefresh, analyse };
}
