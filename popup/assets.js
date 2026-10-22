// Small DOM builders shared by the Crypto, Stocks and Favourites tabs.
export const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function setChangeBadge(node, pct, suffix = '') {
  const up = pct >= 0;
  node.className = `change ${up ? 'is-up' : 'is-down'}`;
  node.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%${suffix ? ` ${suffix}` : ''}`;
}

export function changeBadge(pct, suffix) {
  const node = el('span');
  if (pct == null || !Number.isFinite(pct)) return node;
  setChangeBadge(node, pct, suffix);
  return node;
}

export function starButton(pressed, name) {
  const btn = el('button', 'icon-btn star-btn');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', String(pressed));
  btn.title = btn.ariaLabel = pressed ? `Remove ${name} from favourites` : `Add ${name} to favourites`;
  btn.innerHTML = ICONS.star;
  return btn;
}

export function removeButton(name) {
  const btn = el('button', 'fav-remove');
  btn.type = 'button';
  btn.dataset.remove = '';
  btn.title = btn.ariaLabel = `Remove ${name} from favourites`;
  btn.innerHTML = ICONS.remove;
  return btn;
}

export function nameBlock(code, name) {
  const wrap = el('span', 'asset-name');
  wrap.append(el('b', '', code), el('small', '', name));
  return wrap;
}

export function priceBlock(price, pct) {
  const wrap = el('span', 'asset-price');
  wrap.append(el('b', '', price), changeBadge(pct));
  return wrap;
}

export function tickerBadge(symbol) {
  return el('span', 'cur-icon ticker-badge', symbol.replace(/^\^/, '').slice(0, 1));
}

/**
 * Sets a price's text in place and flashes it green/red when `value` moved since last time,
 * so live updates are visible without rebuilding (and losing clicks on) the row.
 */
export function setLiveText(node, text, value) {
  const prev = node._value;
  node._value = value;
  if (node.textContent === text) return;
  node.textContent = text;
  if (prev == null || value == null || value === prev) return;
  node.classList.remove('flash-up', 'flash-down');
  void node.offsetWidth; // restart the animation
  node.classList.add(value > prev ? 'flash-up' : 'flash-down');
}

export function emptyRow(text, className = 'list-empty') {
  return el('li', className, text);
}

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** state: 'live' (pulsing dot), 'stale' (warning dot) or '' (plain text). */
export function setStatus(node, { state = '', text = '' }) {
  node.className = `status${state ? ` is-${state}` : ''}`;
  node.textContent = text;
}
