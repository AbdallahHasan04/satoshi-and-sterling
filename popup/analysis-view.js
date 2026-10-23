// Shared rendering for the Stock analysis and Crypto analysis tabs.
import { compactMoney, money } from '../lib/analysis.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** "How these ratings work" paragraphs. */
export const HOW_TECH = 'Technical rating: TradingView’s Technical Ratings, on daily prices. 15 moving averages (simple and exponential 10 to 200 days, Hull 9, VWMA 20, Ichimoku Cloud) and 11 oscillators (RSI, Stochastic, CCI, ADX, Awesome Oscillator, Momentum, MACD, Stochastic RSI, Williams %R, Bull Bear Power, Ultimate Oscillator) each vote buy (+1), neutral (0) or sell (−1). Each group is averaged, then the two groups: above +0.5 is Strong buy, +0.1 to +0.5 Buy, −0.1 to +0.1 Neutral, −0.5 to −0.1 Sell, below −0.5 Strong sell. It follows the trend, so it can change from day to day.';
export const HOW_STOCK = [
  HOW_TECH,
  'Analyst consensus: the average recommendation of the Wall Street analysts covering the stock, as Yahoo Finance reports it, from 1 (strong buy) to 5 (sell), with their average 12-month price target. This is what most “bullish” or “bearish” ratings elsewhere are.',
  'Valuation: Morningstar’s star rating compares the price with a fair value, and asks for a bigger discount the more uncertain the stock is. For example, 5 stars needs a price at 80% of fair value or less for a low-uncertainty stock, and 50% for a very-high-uncertainty one. Morningstar’s analysts set uncertainty by hand; here it comes from the last year’s price swings (volatility).',
  'The fair value is Simply Wall St’s published two-stage DCF: 10 years of free cash flow, then a terminal value. Like Simply Wall St, it grows at the analysts’ forecast where there is one (earnings growth for this year and next), otherwise at its past rate, then slows towards the 10-year Treasury rate. It’s discounted at the cost of equity: the 5-year average Treasury yield plus beta (from 5 years of monthly prices, kept within 0.8–2) times Damodaran’s equity risk premium.',
  'Financial strength: the Piotroski F-Score, nine pass/fail tests on the last two annual reports: profitability and earnings quality, debt and liquidity, new shares issued, and efficiency. 8–9 is strong, 0–2 weak.',
  'The four answer different questions, so they can disagree: the technical rating is about the recent trend, analysts look 12 months ahead, the star rating asks whether today’s price is backed by cash flow, and the F-Score whether the business is getting stronger. A company without positive free cash flow gets no fair value, so no star rating.',
];
export const HOW_COIN = [HOW_TECH, 'Coins have no earnings or annual reports, so there’s no valuation or financial-strength rating.'];

const signed = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

// Where each TradingView band's name sits on the −1…+1 scale.
const TECH_LABELS = [['Strong sell', -0.75], ['Sell', -0.3], ['Neutral', 0], ['Buy', 0.3], ['Strong buy', 0.75]];
const toneOf = (good, bad) => (good ? 'buy' : bad ? 'sell' : 'neutral');

function ratingPart(title, source) {
  const box = el('div', 'an-rating-part');
  const head = el('div', 'an-part-head');
  head.append(el('span', 'an-part-title', title), el('small', '', source));
  box.append(head);
  return box;
}

function techPart(tech) {
  const part = ratingPart('Technical rating', 'TradingView method · daily');
  part.dataset.tone = tech.tone;
  const head = el('div', 'an-rating-head');
  head.append(el('b', 'an-verdict', tech.label), el('span', 'an-rating-num', signed(tech.value)), el('span', 'an-rating-checks', 'scale −1 to +1'));

  const scale = el('div', 'an-scale');
  scale.setAttribute('role', 'img');
  scale.ariaLabel = `Technical rating ${signed(tech.value)} on a scale from −1 to +1: ${tech.label}`;
  const marker = el('span', 'an-scale-marker');
  marker.style.left = `${((tech.value + 1) / 2) * 100}%`;
  scale.append(marker);
  const labels = el('div', 'an-scale-labels');
  for (const [name, at] of TECH_LABELS) {
    const span = el('span', name === tech.label ? 'is-current' : '', name);
    span.style.left = `${((at + 1) / 2) * 100}%`;
    labels.append(span);
  }

  const groups = el('div', 'an-tech-groups');
  for (const [name, g] of [['Moving averages', tech.ma], ['Oscillators', tech.osc]]) {
    if (!g) continue;
    const label = el('span', 'an-group-name', name);
    label.title = g.items.filter(i => i.vote != null).map(i => `${i.name}: ${i.vote > 0 ? 'buy' : i.vote < 0 ? 'sell' : 'neutral'}`).join('\n');
    groups.append(label, el('b', `an-tone is-${g.tone}`, g.label), el('span', 'an-counts', `${g.buy} buy · ${g.neutral} neutral · ${g.sell} sell`));
  }
  part.append(head, scale, labels, groups);
  return part;
}

const pctText = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`;
const COUNT_NAMES = ['strong buy', 'buy', 'hold', 'sell', 'strong sell'];

function analystPart(a, price) {
  const part = ratingPart('Analyst consensus', 'Wall Street analysts · Yahoo Finance');
  if (!a?.label) {
    part.append(el('p', 'an-part-note', a === undefined ? 'Couldn’t load analyst estimates right now.' : 'No analysts cover this stock.'));
    return part;
  }
  part.dataset.tone = /buy/i.test(a.label) ? 'buy' : /sell|under/i.test(a.label) ? 'sell' : 'neutral';
  const head = el('div', 'an-rating-head');
  head.append(
    el('b', 'an-verdict', a.label),
    el('span', 'an-rating-num', a.mean == null ? '' : a.mean.toFixed(2)),
    el('span', 'an-rating-checks', `1 strong buy – 5 sell${a.analysts ? ` · ${a.analysts} analysts` : ''}`),
  );
  part.append(head);
  const total = a.counts?.reduce((x, y) => x + y, 0);
  if (total) {
    const bar = el('div', 'an-dist');
    bar.setAttribute('role', 'img');
    bar.ariaLabel = a.counts.map((c, i) => `${c} ${COUNT_NAMES[i]}`).join(', ');
    a.counts.forEach((c, i) => {
      if (!c) return;
      const seg = el('span', `is-${i}`, String(c));
      seg.style.flexGrow = c;
      seg.title = `${c} ${COUNT_NAMES[i]}`;
      bar.append(seg);
    });
    part.append(bar);
  }
  if (a.targetMean) {
    const range = a.targetLow && a.targetHigh ? ` · range ${money(a.targetLow)} – ${money(a.targetHigh)}` : '';
    part.append(el('p', 'an-part-note', `Average price target ${money(a.targetMean)} (${pctText(((a.targetMean - price) / price) * 100)} from here)${range}`));
  }
  return part;
}

function valuationPart(stars, bank) {
  const part = ratingPart('Valuation', 'Morningstar star method');
  if (!stars) {
    part.append(el('p', 'an-part-note', bank
      ? 'Not rated: a bank’s cash flow mixes in lending and deposits, so the DCF fair value doesn’t apply.'
      : 'Not rated: it needs a fair value, and the DCF needs positive free cash flow.'));
    return part;
  }
  const line = el('div', 'an-stars-line');
  const starText = el('span', 'an-stars', '★'.repeat(stars.stars) + '☆'.repeat(5 - stars.stars));
  starText.ariaLabel = `${stars.stars} out of 5 stars`;
  line.append(starText, el('b', `an-tone is-${toneOf(stars.stars >= 4, stars.stars <= 2)}`, stars.label));
  part.append(line, el('p', 'an-part-note', `Price is ${stars.priceToFair.toFixed(2)}× fair value · ${stars.uncertainty} uncertainty · 4 stars at or below ${money(stars.buyBelow)}`));
  return part;
}

function strengthPart(fscore) {
  const part = ratingPart('Financial strength', 'Piotroski F-Score');
  if (!fscore) {
    part.append(el('p', 'an-part-note', 'Not rated: it needs two annual reports (10-K) filed with the SEC.'));
    return part;
  }
  const line = el('div', 'an-stars-line');
  line.append(
    el('span', 'an-rating-num', `${fscore.score} / ${fscore.available}`),
    el('b', `an-tone is-${toneOf(fscore.label === 'Strong', fscore.label === 'Weak')}`, fscore.label),
  );
  const list = el('details', 'an-how');
  list.append(el('summary', '', 'The nine tests'));
  const ul = el('ul', 'an-tests');
  for (const t of fscore.tests) {
    ul.append(el('li', t.pass === true ? 'is-pass' : t.pass === false ? 'is-fail' : 'is-info', `${t.pass === true ? '✓' : t.pass === false ? '✗' : '–'} ${t.name}${t.pass == null ? ' (not reported)' : ''}`));
  }
  list.append(ul);
  part.append(line, list);
  return part;
}

/**
 * The published ratings: TradingView's technical rating (with its moving-average and oscillator
 * halves) and, for stocks, the analyst consensus, Morningstar's star rating and the Piotroski
 * F-Score. `analyst` is undefined when it couldn't be loaded, null when there's none. `how` is a
 * list of paragraphs explaining them.
 */
export function ratingsCard({ tech, analyst, price, stars, bank = false, fscore, checks, stock = false, how = [] }) {
  const card = el('div', 'card an-rating');
  if (tech) card.append(techPart(tech));
  else card.append(el('p', 'an-part-note', 'No technical rating: not enough price history.'));
  if (stock) card.append(analystPart(analyst, price), valuationPart(stars, bank), strengthPart(fscore));
  if (checks?.total) card.append(el('p', 'an-part-note an-checks', `Checklist below: ${checks.passed} of ${checks.total} checks pass.`));
  if (how.length) {
    const details = el('details', 'an-how');
    details.append(el('summary', '', 'How these ratings work'), ...how.map(t => el('p', '', t)));
    card.append(details);
  }
  card.append(el('p', 'an-disclaimer', 'For information only, not financial advice. Data can be delayed or incomplete.'));
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

export function header({ title, subtitle, price, changePct, extra, action }) {
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
  // Bottom row: the page link on the left, the extended-hours price on the right, so the name
  // keeps its full width above.
  if (action || extra) {
    const foot = el('div', 'an-head-foot');
    if (action) {
      const btn = el('button', 'link-btn an-open', action.label);
      btn.type = 'button';
      btn.addEventListener('click', action.onClick);
      foot.append(btn);
    }
    if (extra) foot.append(extra);
    box.append(foot);
  }
  return box;
}

export const message = (text, loading = false) => el('p', `an-message${loading ? ' is-loading' : ''}`, text);
