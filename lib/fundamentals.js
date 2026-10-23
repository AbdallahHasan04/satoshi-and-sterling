// Company fundamentals from SEC EDGAR "company facts" (the XBRL data in 10-K/10-Q filings),
// plus a discounted-cash-flow fair value. Parsing and maths are pure; fetching is at the bottom.
import * as store from './storage.js';
import { fetchJson } from './http.js';
import { API, ERP } from './config.js';
import { yahooCandles } from './candles.js';
import { ext } from './ext.js';

const DAY = 864e5;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const FORMS = new Set(['10-K', '10-Q', '10-K/A', '10-Q/A', '20-F', '40-F']);

// Concept names companies use for the same line item, in order of preference.
const CONCEPTS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  operatingIncome: ['OperatingIncomeLoss'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  incomeTax: ['IncomeTaxExpenseBenefit'],
  interestExpense: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  dividends: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends', 'DividendsCommonStockCash', 'DividendsCommonStock'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  assetsCurrent: ['AssetsCurrent'],
  liabilitiesCurrent: ['LiabilitiesCurrent'],
  longTermDebt: ['LongTermDebt'],
  longTermDebtNoncurrent: ['LongTermDebtNoncurrent'],
  longTermDebtCurrent: ['LongTermDebtCurrent'],
  shortTermDebt: ['ShortTermBorrowings', 'CommercialPaper'],
  deposits: ['Deposits'],
  assets: ['Assets'],
  // Income before extraordinary items (Piotroski's ROA numerator), falling back to net income.
  incomeContinuing: ['IncomeLossFromContinuingOperations', 'NetIncomeLoss', 'ProfitLoss'],
  grossProfit: ['GrossProfit'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'],
};

function factsFor(gaap, name, unit) {
  const units = gaap[name]?.units;
  if (!units) return [];
  const list = units[unit] ?? units[Object.keys(units).find(u => u.startsWith(unit))] ?? [];
  // Keep one value per period: the latest filing (amendments and later reports restate).
  const byPeriod = new Map();
  for (const f of list) {
    if (!FORMS.has(f.form)) continue;
    const key = `${f.start ?? ''}|${f.end}`;
    const prev = byPeriod.get(key);
    if (!prev || (f.filed ?? '') >= (prev.filed ?? '')) byPeriod.set(key, f);
  }
  return [...byPeriod.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Trailing-twelve-month value of a flow item (revenue, income, cash flow):
 * latest fiscal year + this year's year-to-date − last year's matching year-to-date.
 * Also returns the two latest fiscal-year values for growth rates.
 */
export function ttm(facts) {
  const durations = facts.filter(f => f.start);
  const annual = durations.filter(f => { const d = days(f.start, f.end); return d >= 350 && d <= 380; });
  if (!annual.length) return annualizedYtd(durations);
  const fy = annual[annual.length - 1];
  const prevFy = annual.filter(f => Math.abs(days(f.end, fy.end) - 365) <= 20).pop() ?? null;
  const prev2Fy = prevFy ? annual.filter(f => Math.abs(days(f.end, prevFy.end) - 365) <= 20).pop() ?? null : null;
  const prev3Fy = prev2Fy ? annual.filter(f => Math.abs(days(f.end, prev2Fy.end) - 365) <= 20).pop() ?? null : null;

  // Year-to-date of the current fiscal year: starts the day after the fiscal year ended.
  const ytd = durations
    .filter(f => f.end > fy.end && Math.abs(days(fy.end, f.start) - 1) <= 7 && days(f.start, f.end) < 350)
    .pop();
  let value = fy.val;
  let asOf = fy.end;
  if (ytd) {
    const len = days(ytd.start, ytd.end);
    const prior = durations.find(f =>
      Math.abs(days(f.start, f.end) - len) <= 10 && Math.abs(days(f.end, ytd.end) - 365) <= 14);
    if (prior) {
      value = fy.val + ytd.val - prior.val;
      asOf = ytd.end;
    }
  }
  return {
    value,
    asOf,
    annual: fy.val,
    prevAnnual: prevFy?.val ?? null,
    annualHistory: [prev3Fy, prev2Fy, prevFy, fy].filter(Boolean).map(f => f.val),
  };
}

/**
 * For newly listed companies with no annual report yet: the latest year-to-date figure scaled to
 * a year, with growth measured against the same months a year earlier (10-Qs include both).
 */
function annualizedYtd(durations) {
  if (!durations.length) return null;
  const latestEnd = durations[durations.length - 1].end;
  const cur = durations.filter(f => f.end === latestEnd).sort((a, b) => days(b.start, b.end) - days(a.start, a.end))[0];
  const len = days(cur.start, cur.end);
  if (len < 80) return null;
  const prior = durations.find(f => Math.abs(days(f.start, f.end) - len) <= 10 && Math.abs(days(f.end, cur.end) - 365) <= 14);
  return {
    value: (cur.val * 365) / len,
    asOf: cur.end,
    annual: cur.val,
    prevAnnual: prior?.val ?? null,
    annualHistory: prior ? [prior.val, cur.val] : [cur.val],
    partialMonths: Math.round(len / 30.4),
  };
}

/** Latest balance-sheet (point-in-time) value. */
export function latestInstant(facts) {
  const instants = facts.filter(f => !f.start);
  const f = instants[instants.length - 1];
  return f ? { value: f.val, asOf: f.end } : null;
}

/** Picks the first concept that has data, preferring the one with the most recent period. */
function pick(gaap, names, unit, fn) {
  let best = null;
  for (const name of names) {
    const r = fn(factsFor(gaap, name, unit));
    if (r && (!best || r.asOf > best.asOf)) best = r;
  }
  return best;
}

/** Shares outstanding from the cover page (summed across share classes, e.g. GOOGL + GOOG). */
function sharesOutstanding(companyFacts) {
  const list = companyFacts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
  if (!list.length) {
    // Some filings (e.g. a first 10-Q after listing) lack the cover-page count: use the balance
    // sheet count, or the latest weighted-average diluted shares.
    const gaap = companyFacts?.facts?.['us-gaap'] ?? {};
    for (const name of ['CommonStockSharesOutstanding', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic']) {
      const facts = factsFor(gaap, name, 'shares');
      if (facts.length) return facts[facts.length - 1].val || null;
    }
    return null;
  }
  const latestEnd = list.reduce((m, f) => (f.end > m ? f.end : m), '');
  const sameDate = new Map();
  for (const f of list.filter(x => x.end === latestEnd)) sameDate.set(`${f.val}`, f.val); // dedupe repeats
  return [...sameDate.values()].reduce((a, b) => a + b, 0);
}

/**
 * The two latest fiscal years' figures for the Piotroski F-Score, from annual (10-K) data:
 * [current, previous], each { netIncome, operatingCashFlow, assetsBegin, assetsEnd, longTermDebt,
 * assetsCurrent, liabilitiesCurrent, shares, revenue, grossProfit }. Null without two 10-Ks.
 */
export function fiscalYears(gaap) {
  const near = (a, b, tol = 20) => Math.abs(days(a, b)) <= tol;
  const isYear = f => f.start && days(f.start, f.end) >= 350 && days(f.start, f.end) <= 380;
  const ends = [...new Set(CONCEPTS.netIncome.flatMap(n => factsFor(gaap, n, 'USD').filter(isYear).map(f => f.end)))].sort();
  const e0 = ends[ends.length - 1];
  const e1 = e0 && ends.filter(e => near(e, new Date(Date.parse(e0) - 365 * DAY).toISOString().slice(0, 10))).pop();
  if (!e0 || !e1) return null;
  const e2 = new Date(Date.parse(e1) - 365 * DAY).toISOString().slice(0, 10);

  const first = (names, unit, match) => {
    for (const n of names) {
      const f = factsFor(gaap, n, unit).filter(match).pop();
      if (f) return f.val;
    }
    return null;
  };
  const flow = (key, end, unit = 'USD') => first(CONCEPTS[key], unit, f => isYear(f) && near(f.end, end));
  const inst = (key, end) => first(CONCEPTS[key], 'USD', f => !f.start && near(f.end, end));
  const year = (end, begin) => {
    const revenue = flow('revenue', end);
    const cost = flow('costOfRevenue', end);
    return {
      netIncome: flow('incomeContinuing', end),
      operatingCashFlow: flow('operatingCashFlow', end),
      assetsBegin: inst('assets', begin),
      assetsEnd: inst('assets', end),
      longTermDebt: inst('longTermDebtNoncurrent', end) ?? inst('longTermDebt', end),
      assetsCurrent: inst('assetsCurrent', end),
      liabilitiesCurrent: inst('liabilitiesCurrent', end),
      shares: flow('dilutedShares', end, 'shares'),
      revenue,
      grossProfit: flow('grossProfit', end) ?? (revenue != null && cost != null ? revenue - cost : null),
    };
  };
  return [year(e0, e1), year(e1, e2)];
}

/** Raw financial figures (independent of the share price), extracted from company facts. */
export function extractFinancials(companyFacts) {
  const gaap = companyFacts?.facts?.['us-gaap'];
  if (!gaap) return null;
  // Ignore line items a company stopped reporting (e.g. a dividend label last used in 2014).
  const newest = ['NetIncomeLoss', 'StockholdersEquity', 'Assets']
    .flatMap(n => factsFor(gaap, n, 'USD').map(f => f.end)).sort().pop() ?? '';
  const fresh = r => (r && days(r.asOf, newest) <= 550 ? r : null);
  const flow = key => fresh(pick(gaap, CONCEPTS[key], 'USD', ttm));
  const inst = key => fresh(pick(gaap, CONCEPTS[key], 'USD', latestInstant));

  const equity = inst('equity');
  // Total debt: long-term debt (with its current portion) plus short-term borrowings.
  const ltd = inst('longTermDebt');
  const ltdParts = (inst('longTermDebtNoncurrent')?.value ?? 0) + (inst('longTermDebtCurrent')?.value ?? 0);
  const recent = r => r && equity && Math.abs(days(r.asOf, equity.asOf)) <= 100;
  const shortTerm = CONCEPTS.shortTermDebt.map(n => latestInstant(factsFor(gaap, n, 'USD'))).filter(recent);
  const debt = (recent(ltd) ? ltd.value : ltdParts) + shortTerm.reduce((s, r) => s + r.value, 0);

  return {
    name: companyFacts.entityName,
    revenue: flow('revenue'),
    netIncome: flow('netIncome'),
    operatingIncome: flow('operatingIncome'),
    pretaxIncome: flow('pretaxIncome'),
    incomeTax: flow('incomeTax'),
    interestExpense: flow('interestExpense'),
    operatingCashFlow: flow('operatingCashFlow'),
    capex: flow('capex'),
    dividends: flow('dividends'),
    eps: fresh(pick(gaap, CONCEPTS.eps, 'USD/shares', ttm)),
    equity,
    cash: inst('cash'),
    assetsCurrent: inst('assetsCurrent'),
    liabilitiesCurrent: inst('liabilitiesCurrent'),
    debt,
    shares: sharesOutstanding(companyFacts),
    years: fiscalYears(gaap),
    // Months of data behind annualized figures (newly listed companies), or null for a full year.
    partialMonths: flow('netIncome')?.partialMonths ?? flow('revenue')?.partialMonths ?? null,
    isFinancial: !!gaap.Deposits || (!gaap.OperatingIncomeLoss && !!gaap.InterestAndDividendIncomeOperating),
    asOf: [equity?.asOf, flow('netIncome')?.asOf].filter(Boolean).sort().pop() ?? null,
  };
}

const pct = (a, b) => (a != null && b ? (a / b) * 100 : null);
const growth = (now, then) => (now != null && then != null && then > 0 ? ((now / then) - 1) * 100 : null);

/**
 * Past growth rate (%) the way Simply Wall St measures it: the slope of a straight line fitted
 * through the yearly values, divided by the average of their absolute values. Needs 3+ years.
 */
export function pastGrowth(values) {
  if (!values || values.length < 3) return null;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const scale = values.reduce((a, b) => a + Math.abs(b), 0) / n;
  return scale ? ((num / den) / scale) * 100 : null;
}

/**
 * Simply Wall St's two-stage DCF (their published Company Analysis Model): 10 years of levered
 * free cash flow, then a Gordon-growth terminal value at `terminalPct` (the 10-year Treasury rate),
 * all discounted at the cost of equity `discountPct`. Growth follows the analysts' `forecast` (%
 * per year) where there is one, otherwise starts at `growthPct`; after that the rate closes 30% of
 * its gap to the terminal rate each year (as in their worked example).
 * Returns equity value per share, or null without positive free cash flow.
 */
export function dcfPerShare({ fcf, growthPct, forecast = [], discountPct, terminalPct, shares, years = 10 }) {
  if (!(fcf > 0) || !(shares > 0) || !(discountPct > terminalPct)) return null;
  const r = discountPct / 100;
  const tg = terminalPct / 100;
  let g = (forecast[0] ?? growthPct) / 100;
  let cf = fcf;
  let pv = 0;
  for (let year = 1; year <= years; year++) {
    if (year <= forecast.length) g = forecast[year - 1] / 100;
    else if (year > 1) g = tg + 0.7 * (g - tg);
    cf *= 1 + g;
    pv += cf / Math.pow(1 + r, year);
  }
  pv += (cf * (1 + tg)) / (r - tg) / Math.pow(1 + r, years);
  return pv / shares;
}

/** Cost of equity (%) by CAPM, as Simply Wall St: risk-free rate + beta (kept within 0.8–2) × equity risk premium. */
export const costOfEquity = ({ riskFree, beta, erp }) => riskFree + Math.min(2, Math.max(0.8, beta)) * erp;

/**
 * Price-dependent ratios, the DCF fair value and the margin of safety. `market` is
 * { riskFree, beta, erp } (percent, beta as a ratio) for the discount rate; without it there's no
 * fair value.
 */
export function analyzeFundamentals(fin, price, market = null, analyst = null) {
  if (!fin || !(price > 0)) return null;
  const shares = fin.shares;
  const marketCap = shares ? price * shares : null;
  const ni = fin.netIncome?.value;
  const opInc = fin.operatingIncome?.value;
  const rev = fin.revenue?.value;
  const equity = fin.equity?.value;
  const cash = fin.cash?.value ?? 0;
  // Banks' operating cash flow mixes in lending and deposits, so FCF and DCF don't apply.
  const fcf = fin.isFinancial ? null
    : fin.operatingCashFlow && fin.capex ? fin.operatingCashFlow.value - fin.capex.value : fin.operatingCashFlow?.value ?? null;

  const epsTtm = ni != null && shares ? ni / shares : fin.eps?.value ?? null;
  const pe = epsTtm > 0 ? price / epsTtm : null;
  const epsGrowth = growth(fin.eps?.annual, fin.eps?.prevAnnual) ?? growth(fin.netIncome?.annual, fin.netIncome?.prevAnnual);
  const peg = pe != null && epsGrowth > 0 ? pe / epsGrowth : null;

  const taxRate = fin.incomeTax?.value != null && fin.pretaxIncome?.value > 0
    ? Math.min(0.35, Math.max(0, fin.incomeTax.value / fin.pretaxIncome.value))
    : 0.21;
  const investedCapital = (fin.debt ?? 0) + (equity ?? 0) - cash;
  const roic = opInc != null && investedCapital > 0 && !fin.isFinancial ? ((opInc * (1 - taxRate)) / investedCapital) * 100 : null;

  // Fair value: Simply Wall St's DCF. Like them, use analysts' growth forecasts where there are
  // any (earnings-per-share growth for this year and next; only for profitable companies, as
  // growth from a loss means little), otherwise past free-cash-flow growth, or past revenue growth
  // when that history is too short. With none of these, growth starts at the terminal rate.
  const forecast = epsTtm > 0 ? [analyst?.growthThisYear, analyst?.growthNextYear].filter(v => v != null && Number.isFinite(v)) : [];
  const cfo = fin.operatingCashFlow?.annualHistory ?? [];
  const capex = fin.capex?.annualHistory ?? [];
  const n = Math.min(cfo.length, capex.length);
  const fcfHistory = n ? cfo.slice(-n).map((v, i) => v - capex.slice(-n)[i]) : [];
  const past = pastGrowth(fcfHistory) ?? pastGrowth(fin.revenue?.annualHistory);
  const growthPct = forecast[0] ?? past ?? market?.riskFree ?? null;
  const discountPct = market ? costOfEquity(market) : null;
  const fairValue = market && growthPct != null
    ? dcfPerShare({ fcf, growthPct, forecast, discountPct, terminalPct: market.riskFree, shares })
    : null;
  const marginOfSafety = fairValue > 0 ? ((fairValue - price) / fairValue) * 100 : null;

  return {
    marketCap,
    epsTtm,
    pe,
    peg,
    epsGrowth,
    roe: equity > 0 && ni != null ? (ni / equity) * 100 : null,
    // ROE far above normal usually means equity was shrunk by buybacks, not exceptional profit.
    roeInflated: equity > 0 && ni != null && (ni / equity) > 0.6,
    negativeEquity: equity != null && equity <= 0,
    roic,
    debtToEquity: equity > 0 && !fin.isFinancial ? fin.debt / equity : null,
    ebitMargin: fin.isFinancial ? null : pct(opInc, rev),
    revenueGrowth: growth(fin.revenue?.annual, fin.revenue?.prevAnnual),
    bookValuePerShare: equity != null && shares ? equity / shares : null,
    priceToBook: equity > 0 && shares ? price / (equity / shares) : null,
    fcf,
    fcfYield: fcf != null && marketCap ? (fcf / marketCap) * 100 : null,
    currentRatio: fin.assetsCurrent && fin.liabilitiesCurrent?.value > 0 ? fin.assetsCurrent.value / fin.liabilitiesCurrent.value : null,
    interestCoverage: opInc != null && fin.interestExpense?.value > 0 ? opInc / fin.interestExpense.value : null,
    // No dividend payments anywhere in the filings (e.g. Amazon, Tesla) means none are paid.
    dividendYield: fin.dividends?.value > 0 && marketCap ? (fin.dividends.value / marketCap) * 100
      : fin.dividends || fin.netIncome || fin.revenue ? 0 : null,
    payoutRatio: fin.dividends?.value > 0 && ni > 0 ? (fin.dividends.value / ni) * 100 : null,
    growthAssumption: fairValue ? growthPct : null,
    growthForecast: fairValue && forecast.length ? forecast : null, // analysts' yearly growth, if used
    discountRate: fairValue ? discountPct : null,
    fairValue,
    marginOfSafety,
    isFinancial: fin.isFinancial,
    partialMonths: fin.partialMonths,
    asOf: fin.asOf,
  };
}

/* ---------- Fetching ---------- */

let tickerMap = null;
// Bump when extractFinancials changes, so cached results from the old version are refetched.
const PARSER_VERSION = 3;

/** SEC company number (CIK) for a ticker, from the list bundled with the extension. */
export async function cikFor(symbol) {
  if (!tickerMap) {
    const url = ext?.runtime?.getURL ? ext.runtime.getURL('lib/sec-tickers.json') : new URL('./sec-tickers.json', import.meta.url).href;
    tickerMap = await (await fetch(url)).json();
  }
  return tickerMap[symbol.toUpperCase()] ?? tickerMap[symbol.toUpperCase().replace('-', '.')] ?? null;
}

/**
 * Beta from monthly returns (as Yahoo's "Beta (5Y Monthly)"): covariance of the stock's and the
 * index's monthly returns divided by the index's variance. Null with under 2 years of overlap.
 */
export function monthlyBeta(stock, index) {
  const month = t => new Date(t).toISOString().slice(0, 7);
  const idx = new Map(index.map(k => [month(k.t), k.c]));
  const pairs = stock.map(k => [k.c, idx.get(month(k.t))]).filter(([a, b]) => a > 0 && b > 0);
  const rs = [];
  for (let i = 1; i < pairs.length; i++) rs.push([pairs[i][0] / pairs[i - 1][0] - 1, pairs[i][1] / pairs[i - 1][1] - 1]);
  if (rs.length < 24) return null;
  const ms = rs.reduce((a, r) => a + r[0], 0) / rs.length;
  const mi = rs.reduce((a, r) => a + r[1], 0) / rs.length;
  const cov = rs.reduce((a, r) => a + (r[0] - ms) * (r[1] - mi), 0);
  const variance = rs.reduce((a, r) => a + (r[1] - mi) ** 2, 0);
  return variance ? cov / variance : null;
}

/**
 * Discount-rate inputs for the DCF, as Simply Wall St sets them: the risk-free rate is the 5-year
 * average of the 10-year Treasury yield, beta comes from 5 years of monthly returns against the
 * S&P 500 (1, the market's, with under 2 years of history), and the equity risk premium is
 * Damodaran's latest implied premium. { riskFree, beta, betaMeasured, erp }.
 */
export async function getMarketInputs(symbol) {
  const day = 24 * 3600e3;
  const [tnx, stock, index] = await Promise.all([
    yahooCandles('^TNX', '5y', '1mo', day),
    yahooCandles(symbol, '5y', '1mo', day),
    yahooCandles('^GSPC', '5y', '1mo', day),
  ]);
  if (!tnx.length) throw new Error('No Treasury yields');
  const riskFree = tnx.reduce((a, k) => a + k.c, 0) / tnx.length; // ^TNX is quoted in percent
  const measured = monthlyBeta(stock, index);
  return { riskFree, beta: measured ?? 1, betaMeasured: measured != null, erp: ERP.value };
}

/** Financial figures for a ticker (cached for a day), or null for funds, indices and non-filers. */
export async function getFinancials(symbol) {
  const cache = await store.get('financials', {});
  const hit = cache[symbol];
  if (hit && hit.v === PARSER_VERSION && Date.now() - hit.fetched < 24 * 3600e3) return hit.data;
  const cik = await cikFor(symbol);
  if (!cik) return null;
  const facts = await fetchJson(`${API.secFacts}${String(cik).padStart(10, '0')}.json`, 30000);
  const data = extractFinancials(facts);
  for (const [k, v] of Object.entries(cache)) if (Date.now() - v.fetched > 7 * 24 * 3600e3) delete cache[k];
  cache[symbol] = { data, fetched: Date.now(), v: PARSER_VERSION };
  await store.set('financials', cache);
  return data;
}
