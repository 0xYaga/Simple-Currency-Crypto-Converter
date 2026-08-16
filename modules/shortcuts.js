// Shortcut bindings are stored as portable keyboard-code strings. The primary
// modifier maps to Ctrl on Windows/Linux and Cmd on macOS when matched at runtime.
export const SHORTCUT_ACTIONS = Object.freeze([
  { id: "converter", labelKey: "shortcutConverter" },
  { id: "calculator", labelKey: "shortcutCalculator" },
  { id: "currencyPicker", labelKey: "shortcutCurrency" },
  { id: "swap", labelKey: "shortcutSwap" },
  { id: "search", labelKey: "shortcutSearch" }
]);

const MODIFIER_CODES = new Set([
  "AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"
]);
const COMMAND_KEY_BY_CODE = Object.freeze({
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Comma: "Comma",
  Delete: "Delete",
  End: "End",
  Home: "Home",
  Insert: "Insert",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Period: "Period",
  Space: "Space"
});
const BINDING_PATTERN = /^primary(?:\+(?:shift|alt))?\+([A-Za-z][A-Za-z0-9]*)$/;

export function createDefaultShortcuts() {
  return Object.fromEntries(SHORTCUT_ACTIONS.map(({ id }) => [id, ""]));
}

export function normalizeShortcutBinding(value) {
  if (typeof value !== "string") return "";
  const parts = value.split("+");
  if (parts.length < 2 || parts[0] !== "primary") return "";

  const code = parts.at(-1);
  const modifiers = new Set(parts.slice(1, -1));
  if (modifiers.size !== parts.length - 2 || modifiers.size > 1 || [...modifiers].some((modifier) => modifier !== "shift" && modifier !== "alt")) {
    return "";
  }

  const normalized = ["primary", ...(modifiers.has("shift") ? ["shift"] : []), ...(modifiers.has("alt") ? ["alt"] : []), code].join("+");
  return BINDING_PATTERN.test(normalized) && Boolean(commandKeyForCode(code)) ? normalized : "";
}

export function normalizeShortcuts(raw) {
  const shortcuts = createDefaultShortcuts();
  const usedBindings = new Set();
  for (const { id } of SHORTCUT_ACTIONS) {
    const binding = normalizeShortcutBinding(raw?.[id]);
    if (!binding || usedBindings.has(binding)) continue;
    shortcuts[id] = binding;
    usedBindings.add(binding);
  }
  return shortcuts;
}

export function shortcutFromKeyboardEvent(event) {
  if (event?.isComposing || event?.repeat || !event?.code || MODIFIER_CODES.has(event.code)) return "";
  const hasExactlyOnePrimary = Boolean(event.ctrlKey) !== Boolean(event.metaKey);
  if (!hasExactlyOnePrimary) return "";
  return normalizeShortcutBinding([
    "primary",
    ...(event.shiftKey ? ["shift"] : []),
    ...(event.altKey ? ["alt"] : []),
    event.code
  ].join("+"));
}

export function shortcutMatchesEvent(binding, event) {
  const normalized = normalizeShortcutBinding(binding);
  return Boolean(normalized) && normalized === shortcutFromKeyboardEvent(event);
}

function commandKeyForCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  return COMMAND_KEY_BY_CODE[code] ?? "";
}

// Firefox commands use Ctrl as the portable primary modifier; Firefox maps it
// to Command on macOS. An empty value disables a registered command.
export function toBrowserShortcut(binding) {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return "";
  const parts = normalized.split("+");
  const code = parts.at(-1);
  const key = commandKeyForCode(code);
  if (!key) return "";
  return ["Ctrl", ...(parts.includes("shift") ? ["Shift"] : []), ...(parts.includes("alt") ? ["Alt"] : []), key].join("+");
}

function displayKey(code) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return ({
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    Comma: ",",
    Delete: "Delete",
    End: "End",
    Home: "Home",
    Insert: "Insert",
    PageDown: "Page Down",
    PageUp: "Page Up",
    Period: ".",
    Space: "Space"
  })[code] ?? code;
}

export function formatShortcut(binding, { primary = "Ctrl/Cmd", disabled = "Not set" } = {}) {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return disabled;
  const parts = normalized.split("+");
  return [
    primary,
    ...(parts.includes("shift") ? ["Shift"] : []),
    ...(parts.includes("alt") ? ["Alt"] : []),
    displayKey(parts.at(-1))
  ].join(" + ");
}
