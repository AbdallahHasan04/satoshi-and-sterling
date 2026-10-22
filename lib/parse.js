// Parses selected page text like "$49.99", "€1.234,56", "100 USD" or "0.5 BTC".

// Longest symbols first so "US$" wins over "$".
const SYMBOLS = [
  ['US$', 'USD'], ['CA$', 'CAD'], ['AU$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'], ['MX$', 'MXN'],
  ['C$', 'CAD'], ['A$', 'AUD'], ['S$', 'SGD'], ['R$', 'BRL'], ['zł', 'PLN'],
  ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ['₩', 'KRW'], ['₽', 'RUB'],
  ['₺', 'TRY'], ['₴', 'UAH'], ['₪', 'ILS'], ['₱', 'PHP'], ['₦', 'NGN'], ['₫', 'VND'], ['฿', 'THB'],
  ['₿', 'c:btc-bitcoin'], ['Ξ', 'c:eth-ethereum'],
];

const NUMBER_RE = /\d+(?:[.,'   ]\d+)*/;

/** Turns "1,234.56", "1.234,56", "1 234,56" or "49,99" into a number. */
export function parseLocaleNumber(text) {
  const s = text.replace(/[\s'  ]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    // "1,234" and "1,234,567" are thousands; "49,99" is a decimal comma.
    const isThousands = parts.length > 2 || parts[1].length === 3;
    normalized = isThousands ? parts.join('') : parts.join('.');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    normalized = parts.length > 2 ? parts.join('') : s;
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// `side` is where the token sits relative to the number: a symbol must touch it
// ("Price:$" before, "€)" after).
function identify(token, catalog, side) {
  if (!token) return null;
  for (const [symbol, key] of SYMBOLS) {
    if (side === 'before' ? token.endsWith(symbol) : token.startsWith(symbol)) return key;
  }
  const cleaned = token.replace(/^[(\[{:"'“”]+|[)\]}:;"'“”!?.,]+$/g, '');
  const code = cleaned.toUpperCase();
  // Before the number only accept uppercase codes ("USD 5"), so words like "all 5" (ALL = lek) don't match.
  if (side === 'before' && cleaned !== code) return null;
  if (/^[A-Z0-9]{2,6}$/.test(code)) {
    if (catalog.byKey.get(code)?.kind === 'fiat') return code;
    if (catalog.cryptoBySymbol.has(code)) return catalog.cryptoBySymbol.get(code);
  }
  return null;
}

/**
 * Returns { amount, currency } where currency is a catalog key or null if none was found,
 * or null when the text contains no number.
 */
export function parseSelection(text, catalog) {
  const input = String(text ?? '').trim().slice(0, 200);
  const match = NUMBER_RE.exec(input);
  if (!match) return null;
  const amount = parseLocaleNumber(match[0].trim());
  if (amount == null) return null;

  const before = input.slice(0, match.index).trimEnd().match(/(\S+)$/)?.[1];
  const after = input.slice(match.index + match[0].length).trimStart().match(/^(\S+)/)?.[1];
  // Glued symbols such as "$49.99" end up in `before`; "49,99€" ends up in `after`.
  const currency = identify(before, catalog, 'before') ?? identify(after, catalog, 'after');
  return { amount, currency };
}
