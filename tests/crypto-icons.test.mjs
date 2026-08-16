import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CURRENCIES } from "../modules/catalog.js";

test("every listed cryptocurrency has a safe bundled SVG icon", async () => {
  const cryptoCurrencies = CURRENCIES.filter((currency) => currency.type === "crypto");
  assert.ok(cryptoCurrencies.length > 0);

  await Promise.all(cryptoCurrencies.map(async ({ id }) => {
    const svg = await readFile(new URL(`../icons/crypto/${id}.svg`, import.meta.url), "utf8");
    assert.match(svg, /^<svg\b/);
    assert.doesNotMatch(svg, /<(script|foreignObject)\b/i);
    assert.doesNotMatch(svg, /\son[a-z]+\s*=/i);
  }));
});
