import {
  ANCHOR_CURRENCY,
  CURRENCIES,
  DEFAULT_FAVORITES,
  MIN_VISIBLE_CURRENCIES,
  hasCurrency
} from "./catalog.js";
import { isValidRate } from "./converter.js";
import { normalizeLanguageSetting } from "./i18n.js";
import { HISTORY_SCHEMA_VERSION, normalizeHistory } from "./history.js";
import { RATES_CACHE_VERSION, sanitizeCachedTable } from "./rates.js";
import { createDefaultShortcuts, normalizeShortcuts } from "./shortcuts.js";

// Versioned local-storage schemas keep settings, the normalized rates table,
// and history independently migratable without sending any data off-device.
export const CONFIG_KEY = "converter_config_v10";
export const RATES_CACHE_KEY = "converter_rates_table_v7";
export const HISTORY_KEY = "converter_history_v1";
export const CONFIG_SCHEMA_VERSION = 10;

const LEGACY_CONFIG_KEYS = ["converter_config_v9", "converter_config_v8", "converter_config_v7", "converter_config_v6", "converter_config_v5", "converter_config_v4", "converter_config_v2", "converter_config"];
const LEGACY_CACHE_KEYS = ["converter_rates_table_v6", "converter_rates_table_v5", "converter_rates_table_v4", "converter_rates_table_v3", "converter_rates_cache_v2", "converter_rates_cache_v1"];

export const extensionApi = globalThis.browser ?? globalThis.chrome ?? null;

export function createDefaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    currencies: CURRENCIES.map((currency) => ({ id: currency.id, visible: currency.visible })),
    base: "btc",
    swapTarget: "usd",
    favoriteIds: [...DEFAULT_FAVORITES],
    favoritePairs: [],
    showIcons: true,
    launchMode: "popup",
    // All shortcuts are deliberately opt-in. Existing installs migrate to the
    // same disabled state instead of inheriting the former fixed bindings.
    shortcuts: createDefaultShortcuts(),
    language: "auto"
  };
}

function uniqueValidIds(values) {
  const result = [];
  const seen = new Set();
  if (!Array.isArray(values)) return result;
  for (const value of values) {
    const id = typeof value === "string" ? value.toLowerCase() : "";
    if (!hasCurrency(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeFavoritePairs(values) {
  if (!Array.isArray(values)) return [];
  const pairs = [];
  const seen = new Set();
  for (const value of values) {
    const from = typeof value?.from === "string" ? value.from.toLowerCase() : "";
    const to = typeof value?.to === "string" ? value.to.toLowerCase() : "";
    const key = `${from}:${to}`;
    if (!hasCurrency(from) || !hasCurrency(to) || from === to || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ from, to });
    if (pairs.length === 12) break;
  }
  return pairs;
}

function normalizeLaunchMode(value) {
  return value === "sidebar" ? "sidebar" : "popup";
}

export function normalizeConfig(raw) {
  const defaults = createDefaultConfig();
  const savedOrder = [];
  const seen = new Set();

  if (Array.isArray(raw?.currencies)) {
    for (const item of raw.currencies) {
      const id = typeof item?.id === "string" ? item.id.toLowerCase() : "";
      if (!hasCurrency(id) || seen.has(id)) continue;
      savedOrder.push({ id, visible: typeof item.visible === "boolean" ? item.visible : true });
      seen.add(id);
    }
  }

  for (const currency of CURRENCIES) {
    if (!seen.has(currency.id)) savedOrder.push({ id: currency.id, visible: currency.visible });
  }

  let visible = savedOrder.filter((item) => item.visible);
  if (visible.length < MIN_VISIBLE_CURRENCIES) {
    savedOrder.forEach((item, index) => {
      item.visible = index < MIN_VISIBLE_CURRENCIES;
    });
    visible = savedOrder.filter((item) => item.visible);
  }

  const visibleIds = new Set(visible.map((item) => item.id));
  const requestedBase = typeof raw?.base === "string" ? raw.base.toLowerCase() : defaults.base;
  const base = visibleIds.has(requestedBase) ? requestedBase : visible[0].id;

  const hasSavedFavorites = Array.isArray(raw?.favoriteIds);
  const favoriteIds = uniqueValidIds(hasSavedFavorites ? raw.favoriteIds : defaults.favoriteIds);
  const favoritePairs = normalizeFavoritePairs(raw?.favoritePairs);

  const requestedTarget = typeof raw?.swapTarget === "string" ? raw.swapTarget.toLowerCase() : defaults.swapTarget;
  const fallbackTarget = favoriteIds.find((id) => visibleIds.has(id) && id !== base)
    ?? visible.find((item) => item.id !== base)?.id
    ?? base;
  const swapTarget = visibleIds.has(requestedTarget) && requestedTarget !== base
    ? requestedTarget
    : fallbackTarget;

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    currencies: savedOrder,
    base,
    swapTarget,
    favoriteIds,
    favoritePairs,
    // v7 hid crypto glyphs by default. Migrate it as an opt-in visual fix;
    // later v8+ changes still preserve the user's explicit checkbox setting.
    showIcons: Number(raw?.schemaVersion) >= 8 && typeof raw?.showIcons === "boolean"
      ? raw.showIcons
      : defaults.showIcons,
    launchMode: normalizeLaunchMode(raw?.launchMode),
    shortcuts: normalizeShortcuts(raw?.shortcuts),
    language: normalizeLanguageSetting(raw?.language)
  };
}

async function storageGet(key) {
  if (extensionApi?.storage?.local) {
    try {
      const result = await extensionApi.storage.local.get(key);
      const storedValue = result?.[key];
      if (storedValue !== undefined && storedValue !== null) return storedValue;
    } catch (error) {
      console.warn("Storage read failed", error);
    }
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function storageSet(key, value) {
  if (extensionApi?.storage?.local) {
    try {
      await extensionApi.storage.local.set({ [key]: value });
      return;
    } catch (error) {
      console.warn("Storage write failed", error);
    }
  }

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Fallback storage write failed", error);
  }
}

async function storageRemove(keys) {
  if (extensionApi?.storage?.local) {
    try {
      await extensionApi.storage.local.remove(keys);
    } catch {
      // Migration cleanup is best effort.
    }
  }
  for (const key of keys) {
    try { localStorage.removeItem(key); } catch { /* ignored */ }
  }
}

export async function loadConfig() {
  let raw = await storageGet(CONFIG_KEY);
  if (!raw) {
    for (const legacyKey of LEGACY_CONFIG_KEYS) {
      raw = await storageGet(legacyKey);
      if (raw) break;
    }
  }

  const config = normalizeConfig(raw);
  await saveConfig(config);
  await storageRemove(LEGACY_CONFIG_KEYS);
  return config;
}

export async function saveConfig(config) {
  const normalized = normalizeConfig(config);
  await storageSet(CONFIG_KEY, normalized);
  return normalized;
}

function migrateLegacyEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.rates || typeof entry.rates !== "object") return null;
  // v5 assigned the device's current date to Coinbase responses even though the
  // provider had not supplied it. Preserve usable rates but migrate that date as
  // explicitly unknown instead of continuing to present it as a source date.
  const date = entry.schemaVersion === 5 ? "" : entry.date;

  if (String(entry.anchor || "").toLowerCase() === ANCHOR_CURRENCY) {
    return sanitizeCachedTable({
      schemaVersion: RATES_CACHE_VERSION,
      anchor: ANCHOR_CURRENCY,
      date,
      rates: entry.rates,
      source: entry.source || "cache migration",
      comparison: entry.comparison,
      savedAt: entry.savedAt
    });
  }

  const base = typeof entry.base === "string" ? entry.base.toLowerCase() : "";
  const usdRate = Number(entry.rates[ANCHOR_CURRENCY]);
  if (!base || !isValidRate(usdRate)) return null;

  const rates = { [ANCHOR_CURRENCY]: 1 };
  for (const currency of CURRENCIES) {
    const value = Number(entry.rates[currency.id]);
    if (isValidRate(value)) rates[currency.id] = value / usdRate;
  }

  return sanitizeCachedTable({
    schemaVersion: RATES_CACHE_VERSION,
    anchor: ANCHOR_CURRENCY,
    date,
    rates,
    source: entry.source || "cache migration",
    savedAt: entry.savedAt
  });
}

function migrateLegacyCache(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.entries && typeof raw.entries === "object") {
    const entries = Object.values(raw.entries)
      .filter((entry) => entry && Number.isFinite(entry.savedAt))
      .sort((a, b) => b.savedAt - a.savedAt);
    for (const entry of entries) {
      const migrated = migrateLegacyEntry(entry);
      if (migrated) return migrated;
    }
  }
  return migrateLegacyEntry(raw);
}

export async function loadRatesCache() {
  const current = sanitizeCachedTable(await storageGet(RATES_CACHE_KEY));
  if (current) return current;

  for (const legacyKey of LEGACY_CACHE_KEYS) {
    const migrated = migrateLegacyCache(await storageGet(legacyKey));
    if (migrated) {
      await saveRatesCache(migrated);
      await storageRemove(LEGACY_CACHE_KEYS);
      return migrated;
    }
  }
  return null;
}

export async function saveRatesCache(table) {
  const sanitized = sanitizeCachedTable(table);
  if (!sanitized) throw new Error("Attempted to save an invalid rates table");
  await storageSet(RATES_CACHE_KEY, sanitized);
  return sanitized;
}

export async function loadHistory() {
  const history = normalizeHistory(await storageGet(HISTORY_KEY));
  await saveHistory(history);
  return history;
}

export async function saveHistory(history) {
  const normalized = normalizeHistory(history);
  if (normalized.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw new Error("Invalid history schema");
  }
  await storageSet(HISTORY_KEY, normalized);
  return normalized;
}

export function subscribeStorage(listener) {
  if (!extensionApi?.storage?.onChanged?.addListener) return () => {};
  const callback = (changes, areaName) => {
    if (areaName === "local") listener(changes);
  };
  extensionApi.storage.onChanged.addListener(callback);
  return () => extensionApi.storage.onChanged.removeListener?.(callback);
}
