// Turns indicator and fundamental numbers into the checks shown on the analysis tabs.
// Each row: { label, hint, value, pass } where pass is true (✓), false (✗) or null (info / no data).
import { RULES } from './config.js';

const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(d)}%`);
const signedPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const check = (v, ok) => (v == null || !Number.isFinite(v) ? null : ok(v));

export function compactMoney(v, currency = 'USD') {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

export function money(v, currency = 'USD') {
  if (v == null || !Number.isFinite(v)) return '—';
  const digits = Math.abs(v) >= 1 ? 2 : Math.min(8, Math.ceil(-Math.log10(Math.abs(v))) + 3);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: digits }).format(v);
}

function rsiState(v) {
  if (v == null) return '';
  if (v < RULES.rsiOversold) return 'oversold';
  if (v > RULES.rsiOverbought) return 'overbought';
  return 'neutral';
}

/** Price, momentum and reversal checks (shared by stocks and crypto). */
export function technicalSections(t, { fmt = money, vwapLabel = 'VWAP (today)' } = {}) {
  const priceVsVwap = t.vwap ? ((t.price - t.vwap) / t.vwap) * 100 : null;
  const divergenceText = { bullish: 'Bullish: price lower, RSI higher', bearish: 'Bearish: price higher, RSI lower' };
  return [
    {
      title: 'Price & momentum',
      rows: [
        { label: vwapLabel, hint: 'good: price at or below', value: t.vwap ? `${fmt(t.vwap)} (${signedPct(priceVsVwap)})` : '—', pass: check(priceVsVwap, v => v <= 0) },
        { label: 'RSI (14)', hint: `good: below ${RULES.rsiOversold}`, value: t.rsi == null ? '—' : `${num(t.rsi, 1)} ${rsiState(t.rsi)}`, pass: check(t.rsi, v => v < RULES.rsiOversold) },
        { label: 'Money flow (MFI 14)', hint: 'below 20 oversold, above 80 overbought', value: t.mfi == null ? '—' : num(t.mfi, 1), pass: null },
        { label: 'Momentum', hint: 'good: MACD above its signal', value: `1M ${signedPct(t.momentum1m)} · 3M ${signedPct(t.momentum3m)}`, pass: t.macd ? t.macd.histogram > 0 : null },
        { label: 'Volume', hint: 'today vs 20-day average', value: t.relVolume == null ? '—' : `${num(t.relVolume, 2)}× normal`, pass: null },
        { label: '200-day average', hint: 'good: price above it', value: t.ma200 ? `${fmt(t.ma200)} · ${t.cross === 'golden' ? 'golden cross' : 'death cross'}` : '—', pass: check(t.ma200, v => t.price > v) },
        { label: '52-week range', hint: '0% = year low, 100% = year high', value: t.yearPosition == null ? '—' : `${num(t.yearPosition, 0)}% (${fmt(t.yearLow)} – ${fmt(t.yearHigh)})`, pass: null },
      ],
    },
    {
      title: 'Reversal points',
      note: 'Estimated from recent swing highs and lows.',
      rows: [
        { label: 'Support', hint: 'nearest swing low below', value: t.support ? `${fmt(t.support)} (${signedPct(((t.support - t.price) / t.price) * 100)})` : '—', pass: null },
        { label: 'Resistance', hint: 'nearest swing high above', value: t.resistance ? `${fmt(t.resistance)} (${signedPct(((t.resistance - t.price) / t.price) * 100)})` : '—', pass: null },
        { label: 'RSI divergence', hint: 'bullish = possible turn up', value: t.divergence ? divergenceText[t.divergence] : 'None', pass: t.divergence ? t.divergence === 'bullish' : null },
      ],
    },
  ];
}

/** Valuation, quality, health and dividend checks from company financials. */
export function fundamentalSections(f, price) {
  if (!f) return [];
  const safety = f.marginOfSafety;
  const zone = safety == null ? '' : safety >= RULES.safetyDeep ? ' · deep value' : safety >= RULES.safetyMin ? ' · buy zone' : '';
  return [
    {
      title: 'Valuation',
      rows: [
        { label: 'P/E', hint: `good: below ${RULES.peMax}`, value: f.pe == null ? 'n/a (no profit)' : num(f.pe, 1), pass: check(f.pe, v => v < RULES.peMax) },
        { label: 'PEG', hint: `good: below ${RULES.pegMax}`, value: f.peg == null ? 'n/a' : num(f.peg, 2), pass: check(f.peg, v => v < RULES.pegMax) },
        { label: 'NAV (book value/share)', hint: 'price ÷ book shown after', value: f.bookValuePerShare == null ? '—' : `${money(f.bookValuePerShare)} · P/B ${num(f.priceToBook, 1)}`, pass: null },
        {
          label: 'Fair value (DCF)',
          hint: f.fairValue == null
            ? 'needs positive free cash flow'
            : `${f.growthForecast ? `analysts’ growth ${f.growthForecast.map(g => signedPct(g)).join(', ')}` : `past growth ${signedPct(f.growthAssumption)}`}, ${num(f.discountRate, 1)}% discount rate`,
          value: f.fairValue == null ? 'n/a' : money(f.fairValue),
          pass: null,
        },
        {
          label: 'Margin of safety',
          hint: `good: ${RULES.safetyMin}–${RULES.safetyDeep}%+ below fair value`,
          value: safety == null ? 'n/a' : `${safety >= 0 ? `${num(safety, 0)}% below` : `${num(-safety, 0)}% above`} fair value${zone}`,
          pass: check(safety, v => v >= RULES.safetyMin),
        },
      ],
    },
    {
      title: 'Profitability & growth',
      rows: [
        { label: 'EPS growth', hint: `good: above ${RULES.epsGrowthMin}% a year`, value: signedPct(f.epsGrowth), pass: check(f.epsGrowth, v => v > RULES.epsGrowthMin) },
        { label: 'ROE', hint: `good: above ${RULES.roeMin}%`, value: f.negativeEquity ? 'n/a (negative equity)' : `${pct(f.roe)}${f.roeInflated ? ' · inflated by buybacks' : ''}`, pass: f.negativeEquity ? null : check(f.roe, v => v > RULES.roeMin) },
        { label: 'ROIC', hint: `good: above ${RULES.roicMin}%`, value: f.isFinancial ? 'n/a for banks' : pct(f.roic), pass: check(f.roic, v => v > RULES.roicMin) },
        { label: 'EBIT margin', hint: `good: above ${RULES.ebitMarginMin}%`, value: f.isFinancial ? 'n/a for banks' : pct(f.ebitMargin), pass: check(f.ebitMargin, v => v > RULES.ebitMarginMin) },
        { label: 'Revenue growth', hint: 'last fiscal year', value: signedPct(f.revenueGrowth), pass: check(f.revenueGrowth, v => v > 0) },
        { label: 'Free cash flow', hint: 'yield = FCF ÷ market value', value: f.fcf == null ? 'n/a' : `${compactMoney(f.fcf)} · yield ${pct(f.fcfYield)}`, pass: check(f.fcf, v => v > 0) },
      ],
    },
    {
      title: 'Financial health',
      rows: [
        { label: 'Debt / equity', hint: `good: below ${RULES.debtToEquityMax}`, value: f.isFinancial ? 'n/a for banks' : f.negativeEquity ? 'n/a (negative equity)' : num(f.debtToEquity, 2), pass: check(f.debtToEquity, v => v < RULES.debtToEquityMax) },
        { label: 'Current ratio', hint: `good: above ${RULES.currentRatioMin}`, value: num(f.currentRatio, 2), pass: check(f.currentRatio, v => v > RULES.currentRatioMin) },
        { label: 'Interest coverage', hint: `good: above ${RULES.interestCoverageMin}×`, value: f.interestCoverage == null ? '—' : `${num(f.interestCoverage, 1)}×`, pass: check(f.interestCoverage, v => v > RULES.interestCoverageMin) },
      ],
    },
    {
      title: 'Dividends',
      rows: [
        { label: 'Dividend yield', hint: 'last 12 months', value: f.dividendYield == null ? '—' : f.dividendYield === 0 ? 'None paid' : pct(f.dividendYield, 2), pass: null },
        { label: 'Payout ratio', hint: 'above 80% may be hard to sustain', value: f.dividendYield === 0 ? 'n/a (no dividend)' : f.payoutRatio == null ? '—' : pct(f.payoutRatio, 0), pass: f.payoutRatio == null ? null : f.payoutRatio <= 80 },
      ],
    },
  ];
}

/** Options-based walls for a stock. */
export function optionsSection(o, price) {
  if (!o) return null;
  const dist = s => signedPct(((s - price) / price) * 100);
  return {
    title: 'Options walls',
    note: 'From open option contracts expiring in the next ~45 days (Cboe, ~15 min delayed). Dealers hedging these positions tends to slow the price near the walls.',
    rows: [
      { label: 'Sell wall (call wall)', hint: 'most call contracts above', value: o.callWall ? `${money(o.callWall.strike)} (${dist(o.callWall.strike)}) · ${o.callWall.oi.toLocaleString()} contracts` : '—', pass: null },
      { label: 'Buy wall (put wall)', hint: 'most put contracts below', value: o.putWall ? `${money(o.putWall.strike)} (${dist(o.putWall.strike)}) · ${o.putWall.oi.toLocaleString()} contracts` : '—', pass: null },
      { label: 'Max pain', hint: `next expiry, ${new Date(o.maxPainExpiry).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`, value: o.maxPain ? `${money(o.maxPain)} (${dist(o.maxPain)})` : '—', pass: null },
      { label: 'Gamma flip', hint: 'below it, moves tend to speed up', value: o.gammaFlip ? `${money(o.gammaFlip)} (${dist(o.gammaFlip)})` : o.netGex >= 0 ? 'None nearby · moves damped' : 'None nearby · moves amplified', pass: null },
      { label: 'Put/call ratio', hint: 'above 1 = more bearish bets', value: num(o.putCallRatio, 2), pass: null },
    ],
  };
}

/** Order-book walls for a coin. */
export function orderBookSection(b, fmt = money) {
  if (!b) return null;
  const wall = w => `${fmt(w.price)} (${signedPct(w.distancePct, 2)}) · ${compactMoney(w.value)} · ${num(w.strength, 1)}×`;
  return {
    title: 'Order book walls',
    note: `Live from Binance, refreshed every 10 s. Visible book reaches ±${num(b.depthPct, 1)}%; a wall is a ${num(b.bucketPct, 2)}% price band holding at least 3× a typical band.`,
    rows: [
      ...(b.buyWalls.length ? b.buyWalls : [null]).map((w, i) => ({ label: i ? '' : 'Buy walls', hint: i ? '' : 'big resting buy orders', value: w ? wall(w) : 'None', pass: null })),
      ...(b.sellWalls.length ? b.sellWalls : [null]).map((w, i) => ({ label: i ? '' : 'Sell walls', hint: i ? '' : 'big resting sell orders', value: w ? wall(w) : 'None', pass: null })),
      { label: 'Buy vs sell pressure', hint: `share of orders within ±${num(b.balancePct, 1)}%`, value: b.bidShare == null ? '—' : `${num(b.bidShare, 0)}% buy · ${num(100 - b.bidShare, 0)}% sell`, pass: b.bidShare == null ? null : b.bidShare >= 50 },
      { label: 'Spread', hint: 'gap between best buy and sell', value: pct(b.spreadPct, 3), pass: null },
    ],
  };
}

/** Market structure for a coin. */
export function coinMarketSection(coin) {
  if (!coin) return null;
  const volRatio = coin.volume24h && coin.marketCap ? (coin.volume24h / coin.marketCap) * 100 : null;
  const fromAth = coin.ath ? ((coin.usd - coin.ath) / coin.ath) * 100 : null;
  const supply = coin.maxSupply > 0 && coin.circulatingSupply ? (coin.circulatingSupply / coin.maxSupply) * 100 : null;
  return {
    title: 'Market',
    rows: [
      { label: 'Rank', hint: 'by market value', value: `#${coin.rank}`, pass: null },
      { label: 'Market cap', hint: '', value: compactMoney(coin.marketCap), pass: null },
      { label: 'Liquidity', hint: 'good: 24h volume above 2% of market cap', value: volRatio == null ? '—' : `${pct(volRatio, 1)} of market cap`, pass: check(volRatio, v => v > 2) },
      { label: 'Supply issued', hint: 'circulating ÷ maximum', value: supply == null ? 'No fixed maximum' : pct(supply, 0), pass: null },
      { label: 'From all-time high', hint: '', value: signedPct(fromAth), pass: null },
    ],
  };
}

/** Score across all checks that have data. */
export function score(sections) {
  const rows = sections.filter(Boolean).flatMap(s => s.rows).filter(r => r.pass != null);
  return { passed: rows.filter(r => r.pass).length, total: rows.length };
}
