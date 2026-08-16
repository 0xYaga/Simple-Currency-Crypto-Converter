import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultShortcuts,
  formatShortcut,
  normalizeShortcuts,
  shortcutFromKeyboardEvent,
  shortcutMatchesEvent,
  toBrowserShortcut
} from "../modules/shortcuts.js";

function keyEvent(overrides = {}) {
  return {
    code: "KeyK",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    ...overrides
  };
}

test("shortcuts are disabled by default and duplicate saved bindings are removed", () => {
  assert.deepEqual(createDefaultShortcuts(), {
    converter: "",
    calculator: "",
    currencyPicker: "",
    swap: "",
    search: ""
  });

  assert.deepEqual(normalizeShortcuts({
    converter: "primary+KeyK",
    calculator: "primary+KeyK",
    currencyPicker: "Ctrl+KeyC",
    swap: "primary+shift+KeyX"
  }), {
    converter: "primary+KeyK",
    calculator: "",
    currencyPicker: "",
    swap: "primary+shift+KeyX",
    search: ""
  });
});

test("a binding uses Ctrl or Cmd as the portable primary modifier", () => {
  const ctrlEvent = keyEvent({ ctrlKey: true, shiftKey: true, code: "Digit1" });
  const cmdEvent = keyEvent({ metaKey: true, shiftKey: true, code: "Digit1" });
  assert.equal(shortcutFromKeyboardEvent(ctrlEvent), "primary+shift+Digit1");
  assert.equal(shortcutMatchesEvent("primary+shift+Digit1", cmdEvent), true);
  assert.equal(shortcutFromKeyboardEvent(keyEvent({ code: "KeyK" })), "");
  assert.equal(shortcutFromKeyboardEvent(keyEvent({ ctrlKey: true, metaKey: true })), "");
});

test("shortcut labels are readable while unassigned values stay explicit", () => {
  assert.equal(formatShortcut(""), "Not set");
  assert.equal(formatShortcut("primary+shift+Comma"), "Ctrl/Cmd + Shift + ,");
  assert.equal(toBrowserShortcut("primary+shift+Comma"), "Ctrl+Shift+Comma");
  assert.equal(toBrowserShortcut("primary+alt+KeyK"), "Ctrl+Alt+K");
});
