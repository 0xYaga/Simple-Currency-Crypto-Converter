import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG_SCHEMA_VERSION, createDefaultConfig, normalizeConfig } from "../modules/storage.js";
import { createDefaultShortcuts } from "../modules/shortcuts.js";

test("the icon migration turns crypto badges on while later schemas preserve a user opt-out", () => {
  assert.equal(createDefaultConfig().showIcons, true);

  const migrated = normalizeConfig({
    schemaVersion: 7,
    showIcons: false,
    favoritePairs: [
      { from: "rub", to: "usdt" },
      { from: "RUB", to: "USDT" },
      { from: "btc", to: "btc" },
      { from: "missing", to: "usd" }
    ]
  });
  assert.equal(migrated.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(migrated.showIcons, true);
  assert.deepEqual(migrated.favoritePairs, [{ from: "rub", to: "usdt" }]);
  assert.equal(migrated.launchMode, "popup");
  assert.deepEqual(migrated.shortcuts, createDefaultShortcuts());

  const optedOut = normalizeConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    showIcons: false,
    launchMode: "sidebar",
    shortcuts: { converter: "primary+KeyC" }
  });
  assert.equal(optedOut.showIcons, false);
  assert.equal(optedOut.launchMode, "sidebar");
  assert.equal(optedOut.shortcuts.converter, "primary+KeyC");
});
