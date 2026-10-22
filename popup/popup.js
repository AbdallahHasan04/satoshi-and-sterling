import * as store from '../lib/storage.js';
import { getFiat, getCoins, usdPerUnit } from '../lib/rates.js';
import { getHistory, RANGES } from '../lib/history.js';
import { parseAmountInput, convert, formatAmount, formatRate, pairChange24h, countDigits, amountInputFor } from '../lib/convert.js';
import { buildCatalog, isCrypto, coinId, coinKey } from '../lib/currencies.js';
import { MAX_DIGITS, MAX_RECENTS, LIVE_REFRESH_MS, TTL } from '../lib/config.js';
import { getSettings, applyTheme } from '../lib/settings.js';
import { startLivePrices } from '../lib/live.js';
import { CurrencyPicker } from './picker.js';
import { drawChart, clearChart } from './chart.js';
import { setChangeBadge, ago } from './assets.js';
import { createCryptoTab } from './crypto-tab.js';
import { createStocksTab } from './stocks-tab.js';
import { createFavsTab } from './favs-tab.js';

const DEFAULT_STATE = {
  amount: '100',
  from: 'USD',
  to: 'EUR',
  tab: 'convert',   // 'convert' (Currencies) | 'crypto' | 'stocks' | 'favs'
  favorites: [],    // favourite rates as "FROM>TO" pair keys
  favCoins: [],     // CoinGecko ids
  favStocks: [],    // ticker symbols
  recents: [],
  range: '7d',
  chartOpen: true,
  // Crypto tab: open coin (null = list) and its converter.
  crypto: { coin: null, from: null, to: null, amount: '1', range: '7d' },
  // Stocks tab: open stock page (null = list) and its chart range.
  stocks: { symbol: null, range: '1d' },
};

const $ = sel => document.querySelector(sel);
const els = {
  amount: $('#amount'),
  amountWrap: $('#amount-wrap'),
  amountError: $('#amount-error'),
  result: $('#result'),
  rateLine: $('#rate-line'),
  change: $('#change'),
  status: $('#status'),
  chips: $('#chips'),
  fav: $('#fav'),
  copy: $('#copy'),
  swap: $('#swap'),
  banner: $('#banner'),
  bannerText: $('#banner-text'),
  bannerRetry: $('#banner-retry'),
  accessBanner: $('#access-banner'),
  accessGrant: $('#access-grant'),
  chart: $('#chart'),
  chartTip: $('#chart-tip'),
  chartMsg: $('#chart-msg'),
  chartChange: $('#chart-change'),
  chartBody: $('#chart-body'),
  chartToggle: $('#chart-toggle'),
};

const TABS = ['convert', 'crypto', 'stocks', 'favs'];

let state = { ...DEFAULT_STATE };
let settings;
let fiat = null;
let coins = null;
let catalog = buildCatalog(null, null);
let coinsById = new Map();
let offline = false;
let loadError = null;
let lastAccepted = '';
let flashMsg = null;
let flashTimer;
let lastResult = null;
let chartTimer;
let chartToken = 0;

const pairKey = (from, to) => `${from}>${to}`;
const splitPair = key => key.split('>');
const usd = key => usdPerUnit(key, fiat, coinsById);

function convertKeys(amount, from, to) {
  const a = usd(from);
  const b = usd(to);
  return a && b ? convert(amount, a, b) : null;
}

function save() {
  store.set('popupState', state);
}

/* ---------- Pickers ---------- */

const fromPicker = new CurrencyPicker($('#from-picker'), {
  label: 'From currency',
  onChange: key => (key === state.to ? setPair(key, state.from) : setPair(key, state.to)),
});
const toPicker = new CurrencyPicker($('#to-picker'), {
  label: 'To currency',
  onChange: key => (key === state.from ? setPair(state.to, key) : setPair(state.from, key)),
});
function setPair(from, to, { record = true } = {}) {
  state.from = from;
  state.to = to;
  fromPicker.setValue(from);
  toPicker.setValue(to);
  if (record) {
    state.recents = [pairKey(from, to), ...state.recents.filter(p => p !== pairKey(from, to))].slice(0, MAX_RECENTS);
  }
  save();
  update();
  scheduleChart();
}

// Swaps the currencies and carries the result over as the new amount: 100 USD → €89.08 becomes 89.08 EUR → $100.00.
function swap() {
  els.swap.classList.toggle('spin');
  const amount = lastResult && state.tab === 'convert' ? amountInputFor(lastResult.value, lastResult.to) : null;
  if (amount != null) {
    els.amount.value = lastAccepted = state.amount = amount;
  }
  setPair(state.to, state.from);
}

/* ---------- Data ---------- */

function rebuildCatalog() {
  catalog = buildCatalog(fiat, coins);
  coinsById = new Map((coins?.list ?? []).map(c => [c.id, c]));
  const fiatGroups = catalog.groups.filter(g => g.label === 'Currencies');
  for (const p of [fromPicker, toPicker]) p.setGroups(fiatGroups);
  validateState();
  fromPicker.setValue(state.from);
  toPicker.setValue(state.to);
}

// The Currencies tab is fiat only: replace crypto or unknown currencies once rates have loaded.
function validateState() {
  const ok = key => !isCrypto(key) && (catalog.byKey.has(key) || !fiat);
  if (!ok(state.from)) state.from = 'USD';
  if (!ok(state.to) || state.to === state.from) state.to = state.from === 'EUR' ? 'USD' : 'EUR';
}

// Coins (a ~1.6 MB list) are only fetched when a tab needs them.
async function loadData({ force = false, coinsMaxAge, withCoins = state.tab !== 'convert' } = {}) {
  const [f, c] = await Promise.allSettled([
    getFiat({ force }),
    withCoins ? getCoins({ force, maxAge: coinsMaxAge }) : Promise.resolve(coins),
  ]);
  if (f.status === 'fulfilled') fiat = f.value;
  if (c.status === 'fulfilled' && c.value !== coins) {
    const previous = coinsById;
    coins = c.value;
    for (const coin of coins?.list ?? []) {
      const old = previous.get(coin.id);
      if (old?.priced > coin.priced) Object.assign(coin, { usd: old.usd, change24h: old.change24h, priced: old.priced, live: old.live });
    }
  }
  offline = f.status === 'rejected' || c.status === 'rejected' || !!fiat?.stale || !!coins?.stale;
  loadError = !fiat && !coins ? 'Couldn’t load exchange rates. Check your connection.' : null;
  rebuildCatalog();
  update();
  syncLive();
}

/* ---------- Real-time crypto prices ---------- */

let live = null;
let liveState = 'off';
let lastLiveTick = 0;
let tickTimer = null;
let lastLiveSave = 0;

const coinForSymbol = symbol => {
  const key = catalog.cryptoBySymbol.get(symbol);
  return key ? coinsById.get(coinId(key)) : undefined;
};

function onLiveTick() {
  lastLiveTick = Date.now();
  if (tickTimer) return;
  // Repaint at most once a second.
  tickTimer = setTimeout(() => {
    tickTimer = null;
    tabs[state.tab]?.tick?.();
    if (Date.now() - lastLiveSave > 30e3 && coins) {
      lastLiveSave = Date.now();
      store.set('coins', { list: coins.list, fetched: coins.fetched, source: coins.source });
    }
  }, 1000);
}

// The Binance stream only runs while a tab that shows crypto prices is open.
function syncLive() {
  const wanted = (state.tab === 'crypto' || state.tab === 'favs') && !!coins && !document.hidden;
  if (wanted && !live) {
    live = startLivePrices({ coinForSymbol, onTick: onLiveTick, onState: s => { liveState = s; } });
  } else if (!wanted && live) {
    live.stop();
    live = null;
    liveState = 'off';
  }
}

async function refreshLive() {
  if (!fiat || Date.now() - fiat.fetched > TTL.fiat) await loadData();
  update();
}

// Saved coins used CoinGecko ids before CoinPaprika; map them by symbol. Crypto pairs from the
// old converter become favourite coins, since the Currencies tab is now fiat only.
async function migrateCoins(oldCoins) {
  if (state.coinIds === 'paprika' || !coins) return;
  const oldSymbols = new Map(oldCoins?.source === 'paprika' ? [] : (oldCoins?.list ?? []).map(c => [c.id, c.symbol]));
  const mapKey = key => {
    if (!isCrypto(key)) return key;
    if (catalog.byKey.has(key)) return key;
    const symbol = oldSymbols.get(coinId(key));
    return symbol ? catalog.cryptoBySymbol.get(symbol) ?? null : null;
  };
  const favCoins = state.favCoins.map(id => mapKey(coinKey(id))).filter(Boolean).map(coinId);
  const favorites = [];
  for (const pair of state.favorites) {
    const keys = splitPair(pair);
    if (!keys.some(isCrypto)) favorites.push(pair);
    else for (const k of keys.map(mapKey)) if (k && isCrypto(k)) favCoins.push(coinId(k));
  }
  state.favorites = favorites;
  state.favCoins = [...new Set(favCoins)];
  state.recents = state.recents.filter(p => !splitPair(p).some(isCrypto));
  state.crypto = { ...DEFAULT_STATE.crypto };
  state.coinIds = 'paprika';
  await store.remove('history');
  save();
}

/* ---------- Site access ---------- */

// Brave/Chrome don't grant sites an extension update adds (e.g. Yahoo Finance for Stocks) to an
// unpacked extension. Detect that and let the user grant them with one click.
const requiredOrigins = () => globalThis.chrome?.runtime?.getManifest?.().host_permissions ?? [];

async function checkAccess() {
  if (!globalThis.chrome?.permissions) return;
  const ok = await chrome.permissions.contains({ origins: requiredOrigins() }).catch(() => true);
  els.accessBanner.hidden = ok;
}

async function grantAccess() {
  try {
    const granted = await chrome.permissions.request({ origins: requiredOrigins() });
    if (!granted) return;
    els.accessBanner.hidden = true;
    await loadData({ force: true });
    refreshActive();
  } catch {
    els.accessBanner.firstElementChild.textContent =
      'Brave wouldn’t ask for access from here. In brave://extensions, remove Satoshi & Sterling and click “Load unpacked” again.';
    els.accessGrant.hidden = true;
  }
}

/* ---------- Rendering ---------- */

function setAmountError(message) {
  const msg = flashMsg ?? message;
  const wasHidden = els.amountError.hidden;
  els.amountError.hidden = !msg;
  els.amountError.textContent = msg ?? '';
  els.amountWrap.classList.toggle('is-invalid', !!msg);
  els.amount.setAttribute('aria-invalid', String(!!msg));
  if (msg && wasHidden) {
    els.amountWrap.classList.remove('shake');
    void els.amountWrap.offsetWidth; // restart the animation
    els.amountWrap.classList.add('shake');
  }
}

function flashError(message) {
  flashMsg = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashMsg = null; update(); }, 2500);
  update();
}

function update() {
  if (state.tab === 'convert') {
    const parsed = parseAmountInput(els.amount.value);
    setAmountError(parsed.error);
    updateConvert(parsed);
    renderChips();
  } else {
    tabs[state.tab].render();
  }
  updateStatus();
  updateBanner();
}

function updateConvert(parsed) {
  const from = catalog.byKey.get(state.from);
  const to = catalog.byKey.get(state.to);
  const value = from && to && parsed.value != null ? convertKeys(parsed.value, state.from, state.to) : null;

  lastResult = value == null ? null : { value, to };
  els.result.textContent = value == null ? '—' : formatAmount(value, to);
  els.copy.disabled = value == null;

  const rate = from && to ? convertKeys(1, state.from, state.to) : null;
  els.rateLine.textContent = rate == null ? '' : `1 ${from.code} = ${formatRate(rate, to)}`;

  const showChange = rate != null && (from.kind === 'crypto' || to.kind === 'crypto');
  els.change.hidden = !showChange;
  if (showChange) setChangeBadge(els.change, pairChange24h(from.coin?.change24h, to.coin?.change24h), '24h');
}

function renderChips() {
  const valid = p => splitPair(p).every(k => !isCrypto(k) && catalog.byKey.has(k));
  const favs = state.favorites.filter(valid);
  const current = pairKey(state.from, state.to);
  const recents = state.recents.filter(p => valid(p) && p !== current && !state.favorites.includes(p)).slice(0, 3);

  const chips = [...favs.map(p => [p, true]), ...recents.map(p => [p, false])].map(([p, fav]) => {
    const [from, to] = splitPair(p).map(k => catalog.byKey.get(k));
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${fav ? ' is-fav' : ''}${p === current ? ' is-current' : ''}`;
    chip.dataset.pair = p;
    chip.textContent = `${from.code} → ${to.code}`;
    chip.title = `${fav ? 'Favourite' : 'Recent'}: ${from.name} to ${to.name}`;
    return chip;
  });
  els.chips.replaceChildren(...chips);
  els.chips.hidden = !chips.length;

  const isFav = state.favorites.includes(current);
  els.fav.setAttribute('aria-pressed', String(isFav));
  els.fav.title = els.fav.ariaLabel = isFav ? 'Remove pair from favourites' : 'Add pair to favourites';
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function updateStatus() {
  if (state.tab !== 'convert') return tabs[state.tab].status();
  const el = els.status;
  const keys = [state.from, state.to];
  const cryptoItems = keys.map(k => catalog.byKey.get(k)).filter(i => i?.kind === 'crypto');

  if (!fiat && !coins) {
    el.className = 'status';
    el.textContent = loadError ? '' : 'Loading rates…';
    return;
  }
  if (cryptoItems.length) {
    const age = Date.now() - Math.min(...cryptoItems.map(i => i.coin.priced));
    const live = !offline && age < LIVE_REFRESH_MS * 3;
    el.className = `status ${live ? 'is-live' : 'is-stale'}`;
    el.textContent = live ? `Live · updated ${ago(age)}` : `Prices from ${ago(age)}`;
  } else if (fiat) {
    el.className = `status${offline ? ' is-stale' : ''}`;
    el.textContent = `Rates updated ${dateFmt.format(fiat.updated)}`;
  }
}

function updateBanner() {
  if (loadError) {
    els.banner.hidden = false;
    els.banner.classList.add('is-error');
    els.bannerText.textContent = loadError;
  } else if (offline) {
    els.banner.hidden = false;
    els.banner.classList.remove('is-error');
    els.bannerText.textContent = 'Can’t reach the rate servers. Showing saved rates.';
  } else {
    els.banner.hidden = true;
  }
}

/* ---------- Chart ---------- */

const timeFmt = {
  short: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }),
  long: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
};

function showChartMsg(text, { loading = false, retry = false } = {}) {
  clearChart(els.chart, els.chartTip);
  els.chartChange.hidden = true;
  els.chartMsg.hidden = false;
  els.chartMsg.classList.toggle('is-loading', loading);
  els.chartMsg.replaceChildren(document.createTextNode(text));
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn';
    btn.textContent = 'Try again';
    btn.addEventListener('click', loadChart);
    const wrap = document.createElement('div');
    wrap.append(document.createTextNode(text), document.createElement('br'), btn);
    els.chartMsg.replaceChildren(wrap);
  }
}

function renderChartControls() {
  els.chartToggle.setAttribute('aria-expanded', String(state.chartOpen));
  els.chartBody.hidden = !state.chartOpen;
  for (const btn of document.querySelectorAll('#panel-convert .ranges button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.range === state.range));
    btn.hidden = !state.chartOpen;
  }
  if (!state.chartOpen) els.chartChange.hidden = true;
}

function scheduleChart() {
  clearTimeout(chartTimer);
  renderChartControls();
  if (state.tab !== 'convert' || !state.chartOpen) return;
  chartTimer = setTimeout(loadChart, 300);
}

async function loadChart() {
  const token = ++chartToken;
  const { from, to, range } = state;
  const toItem = catalog.byKey.get(to);
  if (!catalog.byKey.get(from) || !toItem) return showChartMsg('Loading…', { loading: true });
  if (from === to) return showChartMsg('Pick two different currencies to see a chart.');

  showChartMsg('', { loading: true });
  try {
    const hist = await getHistory(from, to, range, { fiat });
    if (token !== chartToken) return;
    if (!hist || hist.points.length < 2) {
      return showChartMsg('No history available for this pair. Fiat history covers about 30 major currencies.');
    }
    els.chartMsg.hidden = true;
    const fmt = range === '1y' ? timeFmt.long : timeFmt.short;
    const pct = drawChart(els.chart, els.chartTip, hist.points, {
      formatValue: v => formatRate(v, toItem),
      formatTime: t => fmt.format(t),
    });
    els.chartChange.hidden = false;
    setChangeBadge(els.chartChange, pct, RANGES[range].label);
    els.chartChange.title = hist.approx ? 'Approximate: converted from USD at today’s rate' : '';
  } catch {
    if (token === chartToken) {
      showChartMsg('Couldn’t load the chart. The price API may be busy, so wait a minute.', { retry: true });
    }
  }
}

/* ---------- Copy ---------- */

const copyFormat = (value, item) => formatAmount(value, item, { raw: settings.copyFormat === 'raw' });

/* ---------- Tabs ---------- */

function setTab(tab) {
  if (!TABS.includes(tab)) tab = 'convert';
  state.tab = tab;
  for (const btn of document.querySelectorAll('[role="tab"]')) {
    const selected = btn.dataset.tab === tab;
    btn.setAttribute('aria-selected', String(selected));
    btn.tabIndex = selected ? 0 : -1;
  }
  for (const t of TABS) $(`#panel-${t}`).hidden = t !== tab;
  save();
  update();
  scheduleChart();
  refreshActive();
  syncLive();
}

// Refreshes whatever the open tab shows: on open, on tab switch and every 30 s.
async function refreshActive() {
  if (document.hidden) return;
  switch (state.tab) {
    case 'convert': return refreshLive();
    case 'crypto': return tabs.crypto.refresh();
    case 'stocks': return tabs.stocks.refresh();
    case 'favs': return tabs.favs.refresh();
  }
}

/* ---------- Favourites and the context shared with the other tabs ---------- */

function toggleFav(list, id) {
  state[list] = state[list].includes(id) ? state[list].filter(x => x !== id) : [...state[list], id];
  save();
  update();
}

// Fiat currency for showing crypto prices: the home currency from Settings, or USD.
function displayFiat() {
  const home = catalog.byKey.get(settings.homeCurrency);
  return home?.kind === 'fiat' ? home : catalog.byKey.get('USD');
}

function openPair(from, to) {
  if (from === to) to = from === 'USD' ? 'EUR' : 'USD';
  state.tab = 'convert';
  setPair(from, to);
  setTab('convert');
}

function openCoin(id) {
  setTab('crypto');
  tabs.crypto.openCoin(id);
}

function openStock(symbol) {
  setTab('stocks');
  tabs.stocks.openStock(symbol);
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('is-done');
    const label = btn.textContent;
    if (btn.classList.contains('link-btn')) btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.classList.remove('is-done'); if (btn.classList.contains('link-btn')) btn.textContent = label; }, 1200);
  } catch {
    flashError('Couldn’t access the clipboard.');
  }
}

const app = {
  get state() { return state; },
  get settings() { return settings; },
  get catalog() { return catalog; },
  get fiat() { return fiat; },
  get coins() { return coins; },
  get coinsById() { return coinsById; },
  get offline() { return offline; },
  get loadError() { return loadError; },
  get liveState() { return liveState; },
  get lastLiveTick() { return lastLiveTick; },
  convertKeys,
  copyText,
  displayFiat,
  loadData,
  openCoin,
  openPair,
  openStock,
  save,
  setTab,
  toggleFav,
};

const tabs = {
  crypto: createCryptoTab(app, {
    listView: $('#crypto-list-view'), search: $('#crypto-search'), list: $('#crypto-list'), unit: $('#crypto-unit'),
    status: $('#crypto-status'), detail: $('#crypto-detail'), back: $('#cd-back'), rank: $('#cd-rank'), icon: $('#cd-icon'),
    name: $('#cd-name'), symbol: $('#cd-symbol'), star: $('#cd-star'), price: $('#cd-price'), change: $('#cd-change'),
    stats: $('#cd-stats'), chart: $('#cd-chart'), chartTip: $('#cd-chart-tip'), chartMsg: $('#cd-chart-msg'),
    chartChange: $('#cd-chart-change'), chartLabel: $('#cd-chart-label'), ranges: $('#cd-ranges'),
    amount: $('#cd-amount'), amountError: $('#cd-amount-error'), fromPicker: $('#cd-from-picker'), toPicker: $('#cd-to-picker'),
    swap: $('#cd-swap'), result: $('#cd-result'), copy: $('#cd-copy'), rates: $('#cd-rates'), ratesTitle: $('#cd-rates-title'),
  }),
  stocks: createStocksTab(app, {
    listView: $('#stocks-list-view'), indices: $('#indices'), market: $('#market-status'), search: $('#stock-search'),
    title: $('#stock-list-title'), list: $('#stock-list'), status: $('#stocks-status'),
    detail: $('#stock-detail'), back: $('#sd-back'), exchange: $('#sd-exchange'), icon: $('#sd-icon'), name: $('#sd-name'),
    symbol: $('#sd-symbol'), star: $('#sd-star'), price: $('#sd-price'), change: $('#sd-change'), session: $('#sd-session'),
    chart: $('#sd-chart'), chartTip: $('#sd-chart-tip'), chartMsg: $('#sd-chart-msg'), chartChange: $('#sd-chart-change'),
    ranges: $('#sd-ranges'), stats: $('#sd-stats'), detailStatus: $('#sd-status'),
  }),
  favs: createFavsTab(app, {
    panel: $('#panel-favs'), rates: $('#fav-rates'), crypto: $('#fav-crypto'), stocks: $('#fav-stocks'), status: $('#favs-status'),
  }),
};

/* ---------- Events ---------- */

function bindEvents() {
  els.amount.addEventListener('input', () => {
    const v = els.amount.value;
    if (countDigits(v) > MAX_DIGITS) {
      const caret = Math.max(0, els.amount.selectionStart - (v.length - lastAccepted.length));
      els.amount.value = lastAccepted;
      els.amount.setSelectionRange(caret, caret);
      flashError(`You can enter up to ${MAX_DIGITS} digits.`);
      return;
    }
    lastAccepted = v;
    state.amount = v;
    save();
    update();
  });

  els.swap.addEventListener('click', swap);
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key.toLowerCase() === 's' && state.tab === 'convert') { e.preventDefault(); swap(); }
  });

  els.copy.addEventListener('click', () => {
    if (lastResult) copyText(copyFormat(lastResult.value, lastResult.to), els.copy);
  });

  els.fav.addEventListener('click', () => {
    const p = pairKey(state.from, state.to);
    state.favorites = state.favorites.includes(p) ? state.favorites.filter(x => x !== p) : [...state.favorites, p];
    save();
    renderChips();
  });

  els.chips.addEventListener('click', e => {
    const chip = e.target.closest('[data-pair]');
    if (chip) setPair(...splitPair(chip.dataset.pair));
  });

  for (const btn of document.querySelectorAll('[role="tab"]')) {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const step = e.key === 'ArrowRight' ? 1 : TABS.length - 1;
        const next = TABS[(TABS.indexOf(state.tab) + step) % TABS.length];
        setTab(next);
        document.querySelector(`[data-tab="${next}"]`).focus();
      }
    });
  }

  els.chartToggle.addEventListener('click', () => {
    state.chartOpen = !state.chartOpen;
    save();
    scheduleChart();
  });
  for (const btn of document.querySelectorAll('#panel-convert .ranges button')) {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range;
      save();
      scheduleChart();
    });
  }

  els.bannerRetry.addEventListener('click', async () => {
    els.bannerText.textContent = 'Retrying…';
    await loadData({ force: true });
    scheduleChart();
  });

  els.accessGrant.addEventListener('click', grantAccess);

  $('#open-settings').addEventListener('click', () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open('../options/options.html');
  });
  // Open the in-extension support page (embedded Ko-fi panel) instead of leaving for ko-fi.com.
  $('#kofi').addEventListener('click', e => {
    if (!globalThis.chrome?.tabs?.create) return;
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('support/support.html') });
    window.close();
  });

  setInterval(refreshActive, LIVE_REFRESH_MS);
  // Faster refresh for pages that show a single live price (the stock page).
  setInterval(() => { if (!document.hidden) tabs[state.tab]?.fastRefresh?.(); }, 10e3);
  document.addEventListener('visibilitychange', syncLive);
  setInterval(updateStatus, 1000);
}

/* ---------- Start ---------- */

async function init() {
  settings = await getSettings();
  applyTheme(settings.theme);
  const saved = await store.get('popupState', {});
  state = {
    ...DEFAULT_STATE,
    ...saved,
    crypto: { ...DEFAULT_STATE.crypto, ...saved.crypto },
    stocks: { ...DEFAULT_STATE.stocks, ...saved.stocks },
  };
  delete state.multi; // the Multi tab was removed
  if (!TABS.includes(state.tab)) state.tab = 'convert';
  globalThis.chrome?.action?.setBadgeText?.({ text: '' });

  els.amount.value = lastAccepted = state.amount;
  // Render instantly from cache, then refresh from the network.
  fiat = await store.get('fiat');
  const cachedCoins = await store.get('coins');
  coins = cachedCoins?.source === 'paprika' ? cachedCoins : null;
  rebuildCatalog();
  bindEvents();
  setTab(state.tab);
  if (state.tab === 'convert') {
    els.amount.focus();
    els.amount.select();
  }

  checkAccess();
  const migrating = state.coinIds !== 'paprika';
  await loadData({ withCoins: migrating || state.tab !== 'convert' });
  if (migrating) await migrateCoins(cachedCoins);
  scheduleChart();
  refreshActive();
}

init();
