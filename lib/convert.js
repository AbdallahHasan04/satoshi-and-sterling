import { MAX_DIGITS } from './config.js';

export const countDigits = text => (text.match(/\d/g) ?? []).length;

/**
 * Validates the amount field. Accepts digits with one "." or "," decimal separator.
 * Returns { empty: true }, { error }, or { value }.
 */
export function parseAmountInput(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { empty: true };
  if (!/^\d*[.,]?\d*$/.test(s) || !/\d/.test(s)) {
    return { error: 'That isn’t a number. Try something like 100 or 12.50.' };
  }
  if (countDigits(s) > MAX_DIGITS) return { error: `You can enter up to ${MAX_DIGITS} digits.` };
  return { value: Number(s.replace(',', '.')) };
}

/** fromUsd / toUsd are the USD value of one unit of each currency. */
export const convert = (amount, fromUsd, toUsd) => (amount * fromUsd) / toUsd;

/** Decimal places for a crypto amount: enough to show meaningful digits of small values. */
export function cryptoDecimals(value) {
  const a = Math.abs(value);
  if (a === 0) return 2;
  if (a >= 1000) return 4;
  if (a >= 1) return 6;
  return Math.min(12, Math.ceil(-Math.log10(a)) + 5);
}

/** Decimal places for an exchange rate ("1 USD = 0.0000118 BTC"). */
export function rateDecimals(value) {
  const a = Math.abs(value);
  if (a >= 100) return 2;
  if (a === 0 || a >= 1) return 4;
  return Math.min(12, Math.ceil(-Math.log10(a)) + 3);
}

function trimZeros(text) {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * Formats an amount in a currency item ({ kind, code }).
 * Fiat is always rounded to 2 decimals unless `decimals` is given; crypto uses cryptoDecimals.
 * `raw` returns a plain number string without symbols or grouping.
 */
export function formatAmount(value, cur, { raw = false, decimals, locale } = {}) {
  const isFiat = cur.kind === 'fiat';
  const d = decimals ?? (isFiat ? 2 : cryptoDecimals(value));
  if (raw) return isFiat && decimals == null ? value.toFixed(2) : trimZeros(value.toFixed(d));

  if (isFiat) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency', currency: cur.code, currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, d),
      }).format(value);
    } catch {
      // Unknown code for Intl: fall through to a plain number + code.
    }
  }
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: isFiat ? 2 : 0, maximumFractionDigits: d }).format(value);
  return `${number} ${cur.code}`;
}

export const formatRate = (value, cur, opts = {}) => formatAmount(value, cur, { ...opts, decimals: rateDecimals(value) });

/**
 * A converted value as text for the amount field (used by swap), trimmed to fit the digit limit.
 * Returns null when even the whole-number part has too many digits.
 */
export function amountInputFor(value, cur) {
  const raw = trimZeros(formatAmount(value, cur, { raw: true }));
  if (countDigits(raw) <= MAX_DIGITS) return raw;
  const wholeDigits = Math.trunc(value).toString().length;
  if (wholeDigits > MAX_DIGITS) return null;
  return trimZeros(value.toFixed(MAX_DIGITS - wholeDigits));
}

/** Combined 24h change (%) of a pair, given each side's own 24h change vs USD. */
export function pairChange24h(fromChange, toChange) {
  const f = 1 + (fromChange ?? 0) / 100;
  const t = 1 + (toChange ?? 0) / 100;
  return (f / t - 1) * 100;
}
