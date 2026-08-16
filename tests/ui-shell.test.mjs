import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shells = ["popup.html", "sidebar.html"];

for (const shell of shells) {
  test(`${shell} exposes the current conversion result and localizes region labels`, async () => {
    const html = await readFile(new URL(`../${shell}`, import.meta.url), "utf8");

    assert.match(html, /id="primary-result"/);
    assert.match(html, /id="target"[^>]*data-i18n-aria-label="chooseTargetCurrency"/);
    assert.match(html, /id="primary-result-value"/);
    assert.match(html, /id="favorite-pairs-empty"/);
    assert.match(html, /id="favorite-pairs-list"[^>]*data-i18n-aria-label="favoritePairsAria"/);
    assert.match(html, /id="view-history"[^>]*data-i18n-aria-label="history"/);
    assert.match(html, /id="status-text"[^>]*role="status"/);
  });
}
