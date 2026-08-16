import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(fileName) {
  return JSON.parse(await readFile(new URL(`../${fileName}`, import.meta.url), "utf8"));
}

test("the Firefox manifest requests only valid needed permissions", async () => {
  const [manifest, packageJson] = await Promise.all([readJson("manifest.json"), readJson("package.json")]);
  assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite"]);
  assert.ok(manifest.sidebar_action?.default_panel);
  assert.deepEqual(manifest.background?.scripts, ["background.js"]);
  assert.equal(manifest.background?.service_worker, undefined);
  assert.equal(manifest.action?.default_icon, "icons/converter.svg");
  assert.equal(manifest.sidebar_action?.default_icon, "icons/converter.svg");
  assert.equal(manifest.icons?.[16], "icons/converter.svg");
  assert.deepEqual(Object.keys(manifest.commands ?? {}).sort(), ["calculator", "converter", "currencyPicker", "search", "swap"]);
  assert.ok(Object.values(manifest.commands).every((command) => !command.suggested_key));
  assert.ok(manifest.host_permissions.includes("https://api.coingecko.com/api/v3/simple/price*"));
  assert.equal(manifest.version, packageJson.version);
});
