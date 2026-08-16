import assert from "node:assert/strict";
import test from "node:test";

test("v5 cache migrates without treating a device date as Coinbase's source date", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const oldCache = {
    schemaVersion: 5,
    anchor: "usd",
    date: today,
    source: "Coinbase",
    savedAt: Date.now(),
    rates: { usd: 1, eur: 0.9, btc: 0.00002, rub: 90, cad: 1.3, gbp: 0.8, jpy: 150, cny: 7, eth: 0.0003, usdt: 1, usdc: 1, dai: 1 },
    comparison: { status: "single", sources: ["Coinbase"], compared: 0, matched: 0, mismatchCount: 0, maxDifference: 0, mismatches: [], blockedIds: [] }
  };
  const values = new Map([["converter_rates_table_v5", JSON.stringify(oldCache)]]);
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };

  try {
    const storage = await import(`../modules/storage.js?migration-test=${Date.now()}`);
    const migrated = await storage.loadRatesCache();
    assert.equal(migrated.date, "");
    assert.equal(JSON.parse(values.get("converter_rates_table_v7")).date, "");
    assert.equal(values.has("converter_rates_table_v5"), false);
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
});
