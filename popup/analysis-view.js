// Shared rendering for the Stock analysis and Crypto analysis tabs.
import { compactMoney, money } from '../lib/analysis.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function scoreCard({ passed, total }) {
  const card = el('div', 'card an-score');
  const ratio = total ? passed / total : 0;
  const head = el('div', 'an-score-head');
  head.append(el('b', '', total ? `${passed} of ${total} checks pass` : 'No checks available'), el('span', 'an-score-pct', total ? `${Math.round(ratio * 100)}%` : ''));
  const bar = el('div', 'an-bar');
  const fill = el('span', ratio >= 0.6 ? 'is-good' : ratio >= 0.4 ? 'is-mid' : 'is-bad');
  fill.style.width = `${ratio * 100}%`;
  bar.append(fill);
  card.append(head, bar, el('p', 'an-disclaimer', 'For information only, not financial advice. Data can be delayed or incomplete.'));
  return card;
}

export function sectionCard({ title, note, rows }) {
  const card = el('div', 'card an-section');
  card.append(el('h3', 'an-title', title));
  for (const r of rows) {
    const row = el('div', 'an-row');
    const label = el('div', 'an-label');
    if (r.label) label.append(el('span', '', r.label));
    if (r.hint) label.append(el('small', '', r.hint));
    const value = el('div', 'an-value');
    value.append(el('span', '', r.value));
    const chip = el('span', `an-chip ${r.pass === true ? 'is-pass' : r.pass === false ? 'is-fail' : 'is-info'}`, r.pass === true ? '✓' : r.pass === false ? '✗' : '–');
    chip.title = r.pass === true ? 'Passes' : r.pass === false ? 'Does not pass' : 'For information';
    value.append(chip);
    row.append(label, value);
    card.append(row);
  }
  if (note) card.append(el('p', 'an-note', note));
  return card;
}

/** Open interest per strike: puts to the left, calls to the right, current price marked. */
export function optionsChart(options, price) {
  const bars = [...options.bars]
    .sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))
    .slice(0, 22)
    .sort((a, b) => b.strike - a.strike);
  const max = Math.max(1, ...bars.flatMap(b => [b.callOi, b.putOi]));
  const card = el('div', 'card an-section');
  card.append(el('h3', 'an-title', 'Open interest by strike'));
  const legend = el('div', 'an-legend');
  legend.append(el('span', 'is-put', 'Puts (buy side)'), el('span', 'is-call', 'Calls (sell side)'));
  card.append(legend);
  let priceMarked = false;
  for (const b of bars) {
    if (!priceMarked && b.strike < price) {
      card.append(el('div', 'oi-price', `Price ${money(price)}`));
      priceMarked = true;
    }
    const row = el('div', 'oi-row');
    const put = el('div', 'oi-side is-put');
    const putBar = el('span');
    putBar.style.width = `${(b.putOi / max) * 100}%`;
    put.append(putBar);
    const call = el('div', 'oi-side is-call');
    const callBar = el('span');
    callBar.style.width = `${(b.callOi / max) * 100}%`;
    call.append(callBar);
    if (b.strike === options.putWall?.strike) row.classList.add('is-put-wall');
    if (b.strike === options.callWall?.strike) row.classList.add('is-call-wall');
    row.title = `${money(b.strike)}: ${b.putOi.toLocaleString()} puts, ${b.callOi.toLocaleString()} calls`;
    row.append(put, el('span', 'oi-strike', money(b.strike).replace(/\.00$/, '')), call);
    card.append(row);
  }
  if (!priceMarked) card.append(el('div', 'oi-price', `Price ${money(price)}`));
  return card;
}

/** Order book depth by price band: sells above the price, buys below. */
export function depthChart(book, fmt = money) {
  const asks = book.askBuckets.slice(0, 10).reverse();
  const bids = book.bidBuckets.slice(0, 10);
  const max = Math.max(1, ...[...asks, ...bids].map(b => b.value));
  const walls = new Set([...book.buyWalls, ...book.sellWalls].map(w => w.price));
  const card = el('div', 'card an-section');
  card.append(el('h3', 'an-title', 'Order book depth'));
  const row = (b, side) => {
    const r = el('div', `ob-row is-${side}${walls.has(b.price) ? ' is-wall' : ''}`);
    const bar = el('span', 'ob-bar');
    bar.style.width = `${(b.value / max) * 100}%`;
    r.append(el('span', 'ob-price', fmt(b.price)), el('div', 'ob-track'), el('span', 'ob-value', compactMoney(b.value)));
    r.children[1].append(bar);
    return r;
  };
  for (const b of asks) card.append(row(b, 'ask'));
  card.append(el('div', 'oi-price', `Price ${fmt(book.mid)}`));
  for (const b of bids) card.append(row(b, 'bid'));
  return card;
}

export function header({ title, subtitle, price, changePct, action }) {
  const box = el('div', 'an-head');
  const left = el('div', 'an-head-text');
  left.append(el('b', '', title), el('small', '', subtitle));
  const right = el('div', 'an-head-price');
  right.append(el('b', '', price));
  if (changePct != null) {
    const up = changePct >= 0;
    right.append(el('span', `change ${up ? 'is-up' : 'is-down'}`, `${up ? '▲' : '▼'} ${Math.abs(changePct).toFixed(2)}%`));
  }
  box.append(left, right);
  if (action) {
    const btn = el('button', 'link-btn an-open', action.label);
    btn.type = 'button';
    btn.addEventListener('click', action.onClick);
    box.append(btn);
  }
  return box;
}

export const message = (text, loading = false) => el('p', `an-message${loading ? ' is-loading' : ''}`, text);
