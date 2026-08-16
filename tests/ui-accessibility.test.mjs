import assert from "node:assert/strict";
import test from "node:test";
import { CurrencyListView } from "../modules/ui.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      },
      contains: (name) => this.classes.has(name)
    };
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  dispatch(type) { this.listeners.get(type)?.({}); }
}

test("currency rows use sibling native buttons instead of nested interactive controls", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName)
  };

  try {
    const selected = [];
    const favorites = [];
    const view = new CurrencyListView(new FakeElement("div"), {
      onSelect: (id) => selected.push(id),
      onFavorite: (id) => favorites.push(id),
      onCopy: async () => true,
      i18n: { locale: "en", t: (key) => key, currencyName: (currency) => currency.id }
    });
    const record = view.createRow({ id: "btc", type: "crypto", symbol: "BTC", flag: "" });

    assert.equal(record.row.getAttribute("role"), null);
    assert.equal(record.row.tabIndex, undefined);
    assert.deepEqual(record.row.children.map((element) => element.tagName), ["BUTTON", "BUTTON", "BUTTON"]);
    assert.equal(record.selectButton.children.some((element) => element.tagName === "BUTTON"), false);

    record.selectButton.dispatch("click");
    record.favoriteButton.dispatch("click");
    assert.deepEqual(selected, ["btc"]);
    assert.deepEqual(favorites, ["btc"]);

    view.currencies = [record.currency];
    view.rows.set("btc", record);
    view.update({
      amount: 1,
      base: "usd",
      target: "btc",
      table: { rates: { usd: 1, btc: 0.00002 } },
      showIcons: true,
      searchQuery: "",
      favoriteIds: [],
      blockedIds: []
    });

    assert.equal(record.row.classList.contains("selected-target"), true);
    assert.equal(record.selectButton.getAttribute("aria-label"), "selectTargetAria");
    assert.equal(record.selectButton.title, "selectTargetAria");
  } finally {
    globalThis.document = originalDocument;
  }
});
