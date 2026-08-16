import assert from "node:assert/strict";
import test from "node:test";

test("a configured browser command opens the preferred surface and is delivered once it is ready", async () => {
  const popupCalls = [];
  let commandListener = null;
  let messageListener = null;
  const previousBrowser = globalThis.browser;

  globalThis.browser = {
    action: {
      setPopup: async () => {},
      openPopup: async () => { popupCalls.push("opened"); },
      onClicked: { addListener: () => {} }
    },
    commands: {
      onCommand: { addListener: (listener) => { commandListener = listener; } }
    },
    sidebarAction: { open: async () => {} },
    storage: {
      local: { get: async () => ({ converter_config_v10: { launchMode: "popup" } }) },
      onChanged: { addListener: () => {} }
    },
    runtime: {
      sendMessage: async () => { throw new Error("No extension surface is open"); },
      onMessage: { addListener: (listener) => { messageListener = listener; } },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} }
    }
  };

  try {
    await import(`../background.js?command-test=${Date.now()}`);
    await Promise.resolve();
    commandListener("search");
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(popupCalls, ["opened"]);

    const delivered = await messageListener({ type: "converter:surface-ready" });
    assert.deepEqual(delivered, { command: "search" });
    const consumed = await messageListener({ type: "converter:surface-ready" });
    assert.deepEqual(consumed, { command: null });

    await messageListener({ type: "converter:shortcut-capture", active: true });
    commandListener("calculator");
    await Promise.resolve();
    assert.deepEqual(popupCalls, ["opened"]);
  } finally {
    globalThis.browser = previousBrowser;
  }
});
