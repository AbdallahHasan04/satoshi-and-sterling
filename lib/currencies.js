// Currency keys: fiat uses its ISO code ("EUR"), crypto uses "c:" + CoinGecko id ("c:bitcoin").
export const isCrypto = key => typeof key === 'string' && key.startsWith('c:');
export const coinId = key => key.slice(2);
export const coinKey = id => `c:${id}`;

export const ISO_CURRENCIES = new Set(Intl.supportedValuesOf?.('currency') ?? []);

const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });

export function fiatName(code) {
  try {
    const name = displayNames.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

export function fiatSymbol(code) {
  try {
    const parts = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
    return parts.find(p => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/**
 * Builds the picker groups and lookup tables from cached rate data.
 * Each group is sorted A→Z by code, as the spec asks.
 */
export function buildCatalog(fiat, coins) {
  const fiatItems = Object.keys(fiat?.rates ?? {})
    .map(code => ({ key: code, kind: 'fiat', code, name: fiatName(code), symbol: fiatSymbol(code) }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const coinList = coins?.list ?? [];
  const cryptoItems = coinList
    .map(coin => ({ key: coinKey(coin.id), kind: 'crypto', code: coin.symbol, name: coin.name, image: coin.image, coin }))
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));

  // coins.list is ordered by market cap, so the first coin to claim a symbol wins.
  const cryptoBySymbol = new Map();
  for (const coin of coinList) {
    if (!cryptoBySymbol.has(coin.symbol)) cryptoBySymbol.set(coin.symbol, coinKey(coin.id));
  }

  const groups = [];
  if (fiatItems.length) groups.push({ label: 'Currencies', items: fiatItems });
  if (cryptoItems.length) groups.push({ label: 'Crypto', items: cryptoItems });

  return {
    groups,
    byKey: new Map([...fiatItems, ...cryptoItems].map(i => [i.key, i])),
    cryptoBySymbol,
  };
}
