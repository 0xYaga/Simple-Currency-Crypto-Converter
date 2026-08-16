import { ANCHOR_CURRENCY, CURRENCIES } from "./catalog.js";
import { isValidRate } from "./converter.js";

export const RATES_CACHE_VERSION = 7;
export const RATE_POLICY_VERSION = 2;
export const FRESH_CACHE_MS = 15 * 60 * 1000;
export const STALE_CACHE_MS = 24 * 60 * 60 * 1000;
export const VERY_STALE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 7_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const MIN_KNOWN_RATES = 10;
const MAX_FUTURE_DATE_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_FRESH_SOURCE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_SOURCE_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const VERY_STALE_SOURCE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STORED_MISMATCHES = 12;
const FIAT_MISMATCH_TOLERANCE = 0.015;
const STABLECOIN_MISMATCH_TOLERANCE = 0.01;
const CRYPTO_MISMATCH_TOLERANCE = 0.10;

const FAWAZ_ENDPOINTS = Object.freeze([
  {
    name: "jsDelivr",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json"
  },
  {
    name: "Cloudflare",
    url: "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json"
  }
]);

const COINBASE_ENDPOINT = Object.freeze({
  name: "Coinbase",
  url: "https://api.coinbase.com/v2/exchange-rates?currency=USD"
});

// CoinGecko is deliberately used only as an independent crypto verifier. Its
// API returns USD per coin while this extension stores coins per USD, so each
// valid quote is inverted during validation.
const COINGECKO_IDS = Object.freeze({
  btc: "bitcoin",
  eth: "ethereum",
  usdt: "tether",
  usdc: "usd-coin",
  sol: "solana",
  ltc: "litecoin",
  trx: "tron",
  ton: "the-open-network",
  ada: "cardano",
  near: "near",
  okb: "okb",
  sui: "sui",
  xmr: "monero",
  dot: "polkadot",
  bnb: "binancecoin",
  xrp: "ripple",
  doge: "dogecoin",
  avax: "avalanche-2",
  link: "chainlink",
  atom: "cosmos",
  arb: "arbitrum",
  shib: "shiba-inu",
  dai: "dai",
  uni: "uniswap",
  bch: "bitcoin-cash",
  algo: "algorand",
  apt: "aptos",
  op: "optimism",
  fil: "filecoin",
  icp: "internet-computer",
  etc: "ethereum-classic",
  xlm: "stellar",
  xtz: "tezos",
  zec: "zcash",
  inj: "injective-protocol",
  imx: "immutable-x",
  ldo: "lido-dao",
  rune: "thorchain",
  aave: "aave",
  mkr: "maker",
  pepe: "pepe",
  hbar: "hedera-hashgraph",
  kas: "kaspa",
  stx: "blockstack",
  grt: "the-graph",
  mana: "decentraland",
  sand: "the-sandbox",
  gala: "gala",
  flow: "flow",
  eos: "eos",
  neo: "neo",
  dash: "dash",
  vet: "vechain",
  cro: "crypto-com-chain",
  rpl: "rocket-pool",
  twt: "trust-wallet-token",
  xch: "chia",
  paxg: "pax-gold",
  xaut: "tether-gold"
});

const COINGECKO_ENDPOINT = Object.freeze({
  name: "CoinGecko",
  url: `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(COINGECKO_IDS).join(",")}&vs_currencies=usd&precision=full`
});

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateDate(value, { rejectOld = false } = {}) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("API returned an invalid date");
  }

  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error("API returned an invalid date");
  if (timestamp > Date.now() + MAX_FUTURE_DATE_MS) throw new Error("Rate date is in the future");
  if (rejectOld && Date.now() - timestamp > MAX_FRESH_SOURCE_AGE_MS) {
    throw new Error("API returned an outdated rates table");
  }
  return value;
}

function sanitizeKnownRates(rawRates, { uppercaseKeys = false } = {}) {
  if (!isPlainObject(rawRates)) throw new Error("Response has no rates table");

  const rates = {};
  for (const currency of CURRENCIES) {
    const key = uppercaseKeys ? currency.id.toUpperCase() : currency.id;
    const value = Number(rawRates[key]);
    if (isValidRate(value)) rates[currency.id] = value;
  }
  rates[ANCHOR_CURRENCY] = 1;

  if (Object.keys(rates).length < MIN_KNOWN_RATES) {
    throw new Error("API returned too few known rates");
  }
  for (const required of ["usd", "eur", "btc"]) {
    if (!isValidRate(rates[required])) throw new Error(`Missing ${required.toUpperCase()} rate`);
  }
  return rates;
}

function createSourceTable({ date = "", rates, source }) {
  return {
    // An empty date explicitly means that the provider did not publish one.
    // It must never be replaced with the local device date.
    date: date ? validateDate(date, { rejectOld: true }) : "",
    rates,
    source,
    receivedAt: Date.now()
  };
}

export function validateFawazPayload(payload, source) {
  if (!isPlainObject(payload)) throw new Error("API returned a non-object value");
  return createSourceTable({
    date: payload.date,
    rates: sanitizeKnownRates(payload[ANCHOR_CURRENCY]),
    source
  });
}

export function validateCoinbasePayload(payload) {
  if (!isPlainObject(payload) || !isPlainObject(payload.data)) {
    throw new Error("Coinbase returned an invalid object");
  }
  if (String(payload.data.currency || "").toUpperCase() !== "USD") {
    throw new Error("Coinbase returned the wrong base currency");
  }
  return createSourceTable({
    rates: sanitizeKnownRates(payload.data.rates, { uppercaseKeys: true }),
    source: COINBASE_ENDPOINT.name
  });
}

export function validateCoinGeckoPayload(payload) {
  if (!isPlainObject(payload)) throw new Error("CoinGecko returned a non-object value");

  const rates = {};
  for (const currency of CURRENCIES) {
    if (currency.type !== "crypto") continue;
    const providerId = COINGECKO_IDS[currency.id];
    const usdPrice = Number(payload[providerId]?.usd);
    if (isValidRate(usdPrice)) rates[currency.id] = 1 / usdPrice;
  }

  for (const required of ["btc", "eth"]) {
    if (!isValidRate(rates[required])) throw new Error(`CoinGecko is missing ${required.toUpperCase()}`);
  }
  return createSourceTable({ rates, source: COINGECKO_ENDPOINT.name });
}

function fetchWithTimeout(url, outerSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromOuter = () => controller.abort();

  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", abortFromOuter, { once: true });
  }

  return fetch(url, {
    method: "GET",
    signal: controller.signal,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" }
  }).finally(() => {
    clearTimeout(timeoutId);
    outerSignal?.removeEventListener("abort", abortFromOuter);
  });
}

async function readJsonSafely(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("API response is too large");
  }

  const text = await response.text();
  if (text.length === 0 || text.length > MAX_RESPONSE_BYTES) {
    throw new Error("API response is empty or too large");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("API returned malformed JSON");
  }
}

async function fetchJson(endpoint, signal) {
  const response = await fetchWithTimeout(endpoint.url, signal);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readJsonSafely(response);
}

async function fetchFawazTable(signal) {
  const errors = [];
  for (const endpoint of FAWAZ_ENDPOINTS) {
    try {
      return validateFawazPayload(await fetchJson(endpoint, signal), endpoint.name);
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${endpoint.name}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function fetchCoinbaseTable(signal) {
  return validateCoinbasePayload(await fetchJson(COINBASE_ENDPOINT, signal));
}

async function fetchCoinGeckoTable(signal) {
  return validateCoinGeckoPayload(await fetchJson(COINGECKO_ENDPOINT, signal));
}

function relativeDifference(left, right) {
  const denominator = (Math.abs(left) + Math.abs(right)) / 2;
  return denominator > 0 ? Math.abs(left - right) / denominator : Number.POSITIVE_INFINITY;
}

function toleranceFor(currency) {
  if (currency.type === "fiat") return FIAT_MISMATCH_TOLERANCE;
  if (["usdt", "usdc", "dai"].includes(currency.id)) return STABLECOIN_MISMATCH_TOLERANCE;
  return CRYPTO_MISMATCH_TOLERANCE;
}

function selectPreferredQuote(quotes) {
  return quotes.find((quote) => quote.source === COINBASE_ENDPOINT.name)
    ?? quotes.find((quote) => quote.source === "jsDelivr" || quote.source === "Cloudflare")
    ?? quotes[0];
}

function findConsensus(quotes, currency) {
  const tolerance = toleranceFor(currency);
  let best = [];
  for (const quote of quotes) {
    const cluster = quotes.filter((candidate) => relativeDifference(quote.value, candidate.value) <= tolerance);
    const includesCoinbase = cluster.some((candidate) => candidate.source === COINBASE_ENDPOINT.name);
    const bestIncludesCoinbase = best.some((candidate) => candidate.source === COINBASE_ENDPOINT.name);
    if (cluster.length > best.length || cluster.length === best.length && includesCoinbase && !bestIncludesCoinbase) {
      best = cluster;
    }
  }
  return best.length >= 2 ? best : null;
}

// A rate with several quotes is usable only when at least two independent
// sources agree within the category-specific tolerance. If Coinbase is the
// outlier and the two verifiers agree, their consensus is used instead.
function compareAndMerge(sourceTables) {
  const rates = {};
  const mismatches = [];
  const blockedIds = [];
  let compared = 0;
  let matched = 0;
  let maxDifference = 0;

  for (const currency of CURRENCIES) {
    const quotes = sourceTables
      .map((sourceTable) => ({ source: sourceTable.source, value: Number(sourceTable.rates[currency.id]) }))
      .filter((quote) => isValidRate(quote.value));
    if (quotes.length === 0) continue;

    if (quotes.length === 1) {
      rates[currency.id] = quotes[0].value;
      continue;
    }

    compared += 1;
    for (let left = 0; left < quotes.length; left += 1) {
      for (let right = left + 1; right < quotes.length; right += 1) {
        maxDifference = Math.max(maxDifference, relativeDifference(quotes[left].value, quotes[right].value));
      }
    }

    const consensus = findConsensus(quotes, currency);
    if (consensus) {
      matched += 1;
      rates[currency.id] = selectPreferredQuote(consensus).value;
      continue;
    }

    const diagnosticQuote = selectPreferredQuote(quotes);
    rates[currency.id] = diagnosticQuote.value;
    blockedIds.push(currency.id);
    if (mismatches.length < MAX_STORED_MISMATCHES) {
      const closestDifference = Math.min(...quotes
        .filter((quote) => quote !== diagnosticQuote)
        .map((quote) => relativeDifference(diagnosticQuote.value, quote.value)));
      mismatches.push({ id: currency.id, difference: closestDifference });
    }
  }
  rates[ANCHOR_CURRENCY] = 1;

  return {
    rates,
    comparison: {
      status: blockedIds.length === 0 ? "verified" : "warning",
      sources: sourceTables.map((sourceTable) => sourceTable.source),
      sourceCount: sourceTables.length,
      policyVersion: RATE_POLICY_VERSION,
      compared,
      matched,
      mismatchCount: blockedIds.length,
      maxDifference,
      mismatches,
      blockedIds,
      checkedAt: Date.now()
    }
  };
}

function singleSourceTable(sourceTable) {
  return {
    schemaVersion: RATES_CACHE_VERSION,
    anchor: ANCHOR_CURRENCY,
    date: sourceTable.date,
    rates: sourceTable.rates,
    source: sourceTable.source,
    comparison: {
      status: "single",
      sources: [sourceTable.source],
      sourceCount: 1,
      policyVersion: RATE_POLICY_VERSION,
      compared: 0,
      matched: 0,
      mismatchCount: 0,
      maxDifference: 0,
      mismatches: [],
      blockedIds: [],
      checkedAt: Date.now()
    },
    savedAt: Date.now()
  };
}

function errorMessage(result) {
  return result.status === "rejected" && result.reason instanceof Error ? result.reason.message : "error";
}

export async function fetchFreshTable(signal) {
  const [fawazResult, coinbaseResult, coinGeckoResult] = await Promise.allSettled([
    fetchFawazTable(signal),
    fetchCoinbaseTable(signal),
    fetchCoinGeckoTable(signal)
  ]);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const fawaz = fawazResult.status === "fulfilled" ? fawazResult.value : null;
  const coinbase = coinbaseResult.status === "fulfilled" ? coinbaseResult.value : null;
  const coinGecko = coinGeckoResult.status === "fulfilled" ? coinGeckoResult.value : null;

  // CoinGecko deliberately carries crypto quotes only; it cannot safely serve
  // as the sole currency table when both full sources are unavailable.
  if (!fawaz && !coinbase) {
    throw new Error([
      `Fawaz: ${errorMessage(fawazResult)}`,
      `Coinbase: ${errorMessage(coinbaseResult)}`,
      `CoinGecko: ${errorMessage(coinGeckoResult)}`
    ].join("; "));
  }

  const sourceTables = [coinbase, fawaz, coinGecko].filter(Boolean);
  if (sourceTables.length === 1) return singleSourceTable(sourceTables[0]);

  const merged = compareAndMerge(sourceTables);
  return {
    schemaVersion: RATES_CACHE_VERSION,
    anchor: ANCHOR_CURRENCY,
    // Fawaz publishes the only verifiable source date. Coinbase and CoinGecko
    // provide fresh quotes but no publication date in these responses.
    date: fawaz?.date ?? "",
    rates: merged.rates,
    source: sourceTables.map((sourceTable) => sourceTable.source).join(" + "),
    comparison: merged.comparison,
    savedAt: Date.now()
  };
}

function sanitizeComparison(raw, fallbackSource) {
  if (!isPlainObject(raw)) {
    return {
      status: "single",
      sources: [fallbackSource],
      sourceCount: 1,
      policyVersion: 1,
      compared: 0,
      matched: 0,
      mismatchCount: 0,
      maxDifference: 0,
      mismatches: [],
      blockedIds: [],
      checkedAt: Date.now()
    };
  }

  const status = ["verified", "warning", "single"].includes(raw.status) ? raw.status : "single";
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((item) => typeof item === "string" && item.length <= 40).slice(0, 3)
    : [fallbackSource];
  const sourceCount = Number.isInteger(raw.sourceCount) && raw.sourceCount >= 1 && raw.sourceCount <= 3
    ? raw.sourceCount
    : Math.max(1, sources.length);
  const policyVersion = raw.policyVersion === RATE_POLICY_VERSION ? RATE_POLICY_VERSION : 1;
  const compared = Number.isInteger(raw.compared) && raw.compared >= 0 ? raw.compared : 0;
  const matched = Number.isInteger(raw.matched) && raw.matched >= 0 ? Math.min(raw.matched, compared) : 0;
  const mismatchCount = Number.isInteger(raw.mismatchCount) && raw.mismatchCount >= 0
    ? raw.mismatchCount
    : Math.max(0, compared - matched);
  const maxDifference = Number.isFinite(raw.maxDifference) && raw.maxDifference >= 0
    ? Math.min(raw.maxDifference, 100)
    : 0;
  const mismatches = Array.isArray(raw.mismatches)
    ? raw.mismatches
      .filter((item) => typeof item?.id === "string" && Number.isFinite(item?.difference) && item.difference >= 0)
      .slice(0, MAX_STORED_MISMATCHES)
      .map((item) => ({ id: item.id.toLowerCase(), difference: item.difference }))
    : [];
  // v5 and v6 caches written before the blocking policy have no blockedIds
  // field. Their mismatch list is still enough to keep unsafe cached quotes
  // unavailable until the next refresh.
  const rawBlockedIds = Array.isArray(raw.blockedIds) ? raw.blockedIds : mismatches.map((item) => item.id);
  const knownCurrencyIds = new Set(CURRENCIES.map((currency) => currency.id));
  const blockedIds = [...new Set(rawBlockedIds
    .filter((id) => typeof id === "string")
    .map((id) => id.toLowerCase())
    .filter((id) => knownCurrencyIds.has(id)))]
    .slice(0, CURRENCIES.length);
  const checkedAt = Number.isFinite(raw.checkedAt) && raw.checkedAt > 0 ? raw.checkedAt : Date.now();
  return {
    status: blockedIds.length > 0 ? "warning" : status,
    sources: sources.length ? sources : [fallbackSource],
    sourceCount,
    policyVersion,
    compared,
    matched,
    mismatchCount: Math.max(mismatchCount, blockedIds.length),
    maxDifference,
    mismatches,
    blockedIds,
    checkedAt
  };
}

export function isCurrencyRateAvailable(table, currencyId) {
  const id = typeof currencyId === "string" ? currencyId.toLowerCase() : "";
  if (!id || !isValidRate(Number(table?.rates?.[id]))) return false;
  return !table?.comparison?.blockedIds?.includes(id);
}

export function sanitizeCachedTable(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== RATES_CACHE_VERSION) return null;
  if (raw.anchor !== ANCHOR_CURRENCY) return null;
  if (!Number.isFinite(raw.savedAt) || raw.savedAt <= 0 || raw.savedAt > Date.now() + 60_000) return null;

  try {
    const date = raw.date === "" ? "" : validateDate(raw.date);
    const rates = sanitizeKnownRates(raw.rates);
    const source = typeof raw.source === "string" && raw.source.length <= 100 ? raw.source : "cache";
    return {
      schemaVersion: RATES_CACHE_VERSION,
      anchor: ANCHOR_CURRENCY,
      date,
      rates,
      source,
      comparison: sanitizeComparison(raw.comparison, source),
      savedAt: raw.savedAt
    };
  } catch {
    return null;
  }
}

export function getTableAge(table) {
  return table && Number.isFinite(table.savedAt) ? Math.max(0, Date.now() - table.savedAt) : Number.POSITIVE_INFINITY;
}

export function shouldRevalidate(table) {
  return !table
    || table.comparison?.policyVersion !== RATE_POLICY_VERSION
    || getTableAge(table) >= FRESH_CACHE_MS;
}

function getSourceDateAge(table) {
  if (!table?.date) return null;
  const timestamp = Date.parse(`${table.date}T23:59:59Z`);
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null;
}

export function getCacheCondition(table) {
  const cacheAge = getTableAge(table);
  const sourceAge = getSourceDateAge(table);
  if (cacheAge >= VERY_STALE_CACHE_MS || sourceAge !== null && sourceAge >= VERY_STALE_SOURCE_AGE_MS) return "very-stale";
  if (cacheAge >= STALE_CACHE_MS || sourceAge !== null && sourceAge >= STALE_SOURCE_AGE_MS) return "stale";
  return "usable";
}
