import assert from "node:assert/strict";
import test from "node:test";

test("the toolbar action follows the saved launch mode", async () => {
  const previousBrowser = globalThis.browser;
  const popupCalls = [];
  let openedSidebar = 0;
  let actionClickListener = null;
  let storageChangeListener = null;

  globalThis.browser = {
    action: {
      setPopup: async ({ popup }) => { popupCalls.push(popup); },
      onClicked: { addListener: (listener) => { actionClickListener = listener; } }
    },
    sidebarAction: {
      open: () => { openedSidebar += 1; }
    },
    storage: {
      local: {
        get: async () => ({ converter_config_v9: { launchMode: "sidebar" } })
      },
      onChanged: { addListener: (listener) => { storageChangeListener = listener; } }
    },
    runtime: {
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} }
    }
  };

  try {
    await import(`../background.js?launch-mode-test=${Date.now()}`);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(popupCalls, [""]);

    actionClickListener();
    assert.equal(openedSidebar, 1);

    storageChangeListener({ converter_config_v10: { newValue: { launchMode: "popup" } } }, "local");
    await Promise.resolve();
    assert.deepEqual(popupCalls, ["", "popup.html"]);
  } finally {
    globalThis.browser = previousBrowser;
  }
});
