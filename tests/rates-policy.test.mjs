import assert from "node:assert/strict";
import test from "node:test";
import {
  RATES_CACHE_VERSION,
  fetchFreshTable,
  getCacheCondition,
  isCurrencyRateAvailable,
  sanitizeCachedTable,
  validateCoinbasePayload,
  validateCoinGeckoPayload,
  validateFawazPayload
} from "../modules/rates.js";

const today = new Date().toISOString().slice(0, 10);
const fawazRates = {
  eur: 0.9, btc: 0.00002, rub: 90, cad: 1.3, gbp: 0.8, jpy: 150,
  cny: 7, eth: 0.0003, usdt: 1, usdc: 1, dai: 1
};
const coinbaseRates = {
  EUR: "0.9", BTC: "0.00002", RUB: "90", CAD: "1.3", GBP: "0.8", JPY: "150",
  CNY: "7", ETH: "0.0003", USDT: "1", USDC: "1", DAI: "1"
};
const coinGeckoRates = {
  bitcoin: { usd: 50_000 },
  ethereum: { usd: 1 / fawazRates.eth },
  tether: { usd: 1 },
  "usd-coin": { usd: 1 },
  dai: { usd: 1 }
};

async function withMockedFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = originalFetch; }
}

function response(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

test("Coinbase does not receive a fabricated source date", () => {
  const fawaz = validateFawazPayload({ date: today, usd: fawazRates }, "Fawaz");
  const coinbase = validateCoinbasePayload({ data: { currency: "USD", rates: coinbaseRates } });
  const coinGecko = validateCoinGeckoPayload(coinGeckoRates);
  assert.equal(RATES_CACHE_VERSION, 7);
  assert.equal(fawaz.date, today);
  assert.equal(coinbase.date, "");
  assert.equal(coinGecko.date, "");
  assert.equal(coinGecko.rates.btc, 0.00002);
});

test("a dual-source table uses Fawaz's published date", async () => {
  await withMockedFetch(async (url) => response(String(url).includes("coinbase.com")
    ? { data: { currency: "USD", rates: coinbaseRates } }
    : { date: today, usd: fawazRates }), async () => {
    const table = await fetchFreshTable();
    assert.equal(table.date, today);
  });
});

test("a Coinbase-only table explicitly has an unknown publication date", async () => {
  await withMockedFetch(async (url) => {
    if (!String(url).includes("coinbase.com")) throw new Error("Fawaz offline");
    return response({ data: { currency: "USD", rates: coinbaseRates } });
  }, async () => {
    const table = await fetchFreshTable();
    assert.equal(table.date, "");
    assert.equal(getCacheCondition(table), "usable");
    assert.equal(getCacheCondition({ ...table, savedAt: Date.now() - 25 * 60 * 60 * 1000 }), "stale");
    assert.equal(sanitizeCachedTable(table)?.date, "");
  });
});

test("mismatched rates are blocked at each policy threshold", async () => {
  async function tableWith(overrides) {
    return withMockedFetch(async (url) => response(String(url).includes("coinbase.com")
      ? { data: { currency: "USD", rates: { ...coinbaseRates, ...overrides } } }
      : { date: today, usd: fawazRates }), () => fetchFreshTable());
  }

  assert.deepEqual((await tableWith({ BTC: "0.0000219" })).comparison.blockedIds, []);
  assert.deepEqual((await tableWith({ EUR: "0.9137" })).comparison.blockedIds, ["eur"]);
  assert.deepEqual((await tableWith({ USDT: "1.0102" })).comparison.blockedIds, ["usdt"]);

  const cryptoBlocked = await tableWith({ BTC: "0.0000222" });
  assert.deepEqual(cryptoBlocked.comparison.blockedIds, ["btc"]);
  assert.equal(isCurrencyRateAvailable(cryptoBlocked, "btc"), false);
  assert.equal(isCurrencyRateAvailable(cryptoBlocked, "usd"), true);
});

test("two agreeing verifiers override an outlying primary crypto quote", async () => {
  await withMockedFetch(async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes("coinbase.com")) {
      return response({ data: { currency: "USD", rates: { ...coinbaseRates, BTC: "0.000024" } } });
    }
    if (requestUrl.includes("coingecko.com")) return response(coinGeckoRates);
    return response({ date: today, usd: fawazRates });
  }, async () => {
    const table = await fetchFreshTable();
    assert.equal(table.comparison.sourceCount, 3);
    assert.equal(table.rates.btc, fawazRates.btc);
    assert.equal(isCurrencyRateAvailable(table, "btc"), true);
    assert.deepEqual(table.comparison.blockedIds, []);
  });
});

test("a crypto quote is blocked when no two sources reach consensus", async () => {
  await withMockedFetch(async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes("coinbase.com")) {
      return response({ data: { currency: "USD", rates: { ...coinbaseRates, BTC: "0.000024" } } });
    }
    if (requestUrl.includes("coingecko.com")) {
      return response({ ...coinGeckoRates, bitcoin: { usd: 1 / 0.00003 } });
    }
    return response({ date: today, usd: fawazRates });
  }, async () => {
    const table = await fetchFreshTable();
    assert.deepEqual(table.comparison.blockedIds, ["btc"]);
    assert.equal(isCurrencyRateAvailable(table, "btc"), false);
  });
});

test("an old warning cache remains blocked after sanitization", () => {
  const cached = sanitizeCachedTable({
    schemaVersion: 7,
    anchor: "usd",
    date: today,
    savedAt: Date.now(),
    source: "Coinbase + Fawaz",
    rates: { usd: 1, ...fawazRates },
    comparison: {
      status: "warning",
      sources: ["Coinbase", "Fawaz"],
      compared: 1,
      matched: 0,
      mismatchCount: 1,
      maxDifference: 0.1,
      mismatches: [{ id: "btc", difference: 0.1 }]
    }
  });
  assert.deepEqual(cached?.comparison.blockedIds, ["btc"]);
  assert.equal(isCurrencyRateAvailable(cached, "btc"), false);
});
