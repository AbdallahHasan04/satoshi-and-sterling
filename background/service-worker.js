import * as store from '../lib/storage.js';
import { ext } from '../lib/ext.js';
import { getFiat, getCoins, refreshCoinPrices, usdPerUnit } from '../lib/rates.js';
import { buildCatalog, isCrypto, coinId } from '../lib/currencies.js';
import { parseSelection } from '../lib/parse.js';
import { convert, formatAmount, formatRate, countDigits } from '../lib/convert.js';
import { getSettings } from '../lib/settings.js';
import { MAX_DIGITS } from '../lib/config.js';

const MENU_ID = 'convert-selection';

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.create({ id: MENU_ID, title: 'Convert “%s”', contexts: ['selection'] });
});

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  convertSelection(info.selectionText ?? '', tab).catch(err => {
    console.error(err);
    notify(tab, { title: 'Conversion failed', detail: String(err.message ?? err), error: true });
  });
});

const shorten = text => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

async function convertSelection(text, tab) {
  const [fiat, coins, settings, state] = await Promise.all([
    getFiat().catch(() => null),
    getCoins().catch(() => null),
    getSettings(),
    store.get('popupState', {}),
  ]);
  if (!fiat) {
    return notify(tab, { title: 'No exchange rates', detail: 'Couldn’t load rates. Check your connection.', error: true });
  }

  const catalog = buildCatalog(fiat, coins);
  const parsed = parseSelection(text, catalog);
  if (!parsed) {
    return notify(tab, { title: 'No amount found', detail: `There’s no number in “${shorten(text)}”.`, error: true });
  }

  // No currency in the text: assume the last "From" currency used in the popup.
  let from = parsed.currency;
  const assumed = !from || !catalog.byKey.has(from);
  if (assumed) from = catalog.byKey.has(state.from) ? state.from : 'USD';

  let to = catalog.byKey.has(settings.homeCurrency) ? settings.homeCurrency : 'USD';
  if (to === from) to = state.to && state.to !== from && catalog.byKey.has(state.to) ? state.to : from === 'USD' ? 'EUR' : 'USD';

  const coinsById = new Map((coins?.list ?? []).map(c => [c.id, c]));
  const ids = [from, to].filter(isCrypto).map(coinId);
  if (ids.length) await refreshCoinPrices(coins, ids);

  const fromItem = catalog.byKey.get(from);
  const toItem = catalog.byKey.get(to);
  const a = usdPerUnit(from, fiat, coinsById);
  const b = usdPerUnit(to, fiat, coinsById);
  if (!a || !b) {
    return notify(tab, { title: 'Rate unavailable', detail: `No rate for ${fromItem.code} → ${toItem.code} right now.`, error: true });
  }

  const value = convert(parsed.amount, a, b);
  const result = formatAmount(value, toItem);

  // Opening the popup next shows the same conversion.
  const amountText = String(parsed.amount);
  if (countDigits(amountText) <= MAX_DIGITS && !amountText.includes('e')) {
    const crypto = [from, to].find(isCrypto);
    // Crypto conversions live on the Crypto tab; the Currencies tab is fiat only.
    await store.set('popupState', crypto
      ? { ...state, tab: 'crypto', crypto: { ...state.crypto, coin: coinId(crypto), from, to, amount: amountText } }
      : { ...state, amount: amountText, from, to, tab: 'convert' });
  }

  await notify(tab, {
    title: `${formatAmount(parsed.amount, fromItem)} = ${result}`,
    detail: assumed
      ? `No currency found in the selection, so ${fromItem.code} was assumed.`
      : `1 ${fromItem.code} = ${formatRate(convert(1, a, b), toItem)}`,
    copy: formatAmount(value, toItem, { raw: settings.copyFormat === 'raw' }),
  });
}

async function notify(tab, message) {
  try {
    await ext.scripting.executeScript({ target: { tabId: tab.id }, func: showToast, args: [message] });
  } catch {
    // Browser pages (brave://, chrome://, about:) and the add-on stores can't be scripted: open the popup instead.
    await ext.action.setBadgeBackgroundColor({ color: message.error ? '#c93030' : '#0b8f63' });
    await ext.action.setBadgeText({ text: message.error ? '!' : '1' });
    try { await ext.action.openPopup?.(); } catch { /* not allowed here: the badge tells the user to open it */ }
  }
}

// Injected into the page, so it must be self-contained.
function showToast({ title, detail, copy, error }) {
  const ID = 'satoshi-sterling-toast';
  document.getElementById(ID)?.remove();

  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const c = dark
    ? { bg: '#19211e', text: '#e6eeea', muted: '#93a39c', border: '#2d3934', accent: '#3ccf95', danger: '#f27b7b' }
    : { bg: '#ffffff', text: '#13201b', muted: '#5d6b66', border: '#dbe2df', accent: '#0b8f63', danger: '#c93030' };

  root.innerHTML = `
    <style>
      .t { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: ${c.text}; background: ${c.bg};
           border: 1px solid ${c.border}; border-left: 4px solid ${error ? c.danger : c.accent}; border-radius: 10px;
           box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 12px 14px; width: 300px; max-width: calc(100vw - 32px);
           box-sizing: border-box; animation: in .18s ease-out; }
      @keyframes in { from { opacity: 0; transform: translateY(-8px); } }
      .head { display: flex; align-items: center; gap: 8px; color: ${c.muted}; font-size: 12px; font-weight: 600; }
      .close { margin-left: auto; border: 0; background: none; color: ${c.muted}; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
      .title { margin-top: 4px; font-size: 17px; font-weight: 700; word-break: break-word; }
      .detail { margin-top: 2px; color: ${c.muted}; font-size: 12px; }
      .copy { margin-top: 10px; border: 1px solid ${c.border}; background: transparent; color: ${c.text}; border-radius: 6px;
              padding: 4px 10px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
      .copy:hover { border-color: ${c.accent}; color: ${c.accent}; }
    </style>
    <div class="t" role="status">
      <div class="head"><span>Satoshi &amp; Sterling</span><button class="close" aria-label="Close">×</button></div>
      <div class="title"></div>
      <div class="detail"></div>
    </div>`;
  root.querySelector('.title').textContent = title;
  root.querySelector('.detail').textContent = detail ?? '';
  if (copy) {
    const btn = document.createElement('button');
    btn.className = 'copy';
    btn.textContent = 'Copy result';
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copy); btn.textContent = 'Copied ✓'; } catch { btn.textContent = 'Copy failed'; }
    });
    root.querySelector('.t').append(btn);
  }

  let timer;
  const close = () => host.remove();
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, 8000); };
  root.querySelector('.close').addEventListener('click', close);
  host.addEventListener('mouseenter', () => clearTimeout(timer));
  host.addEventListener('mouseleave', arm);
  document.documentElement.append(host);
  arm();
}
