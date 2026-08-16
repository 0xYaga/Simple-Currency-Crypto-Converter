import { hasCurrency } from "./catalog.js";

// Conversion history is local-only, bounded, and normalized on every read and
// write so malformed or duplicate persisted entries cannot reach the UI.
export const HISTORY_SCHEMA_VERSION = 1;
export const MAX_HISTORY_ITEMS = 30;

function validNumber(value) {
  return Number.isFinite(value) && value >= 0 && value < 1e100;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const from = typeof raw.from === "string" ? raw.from.toLowerCase() : "";
  const to = typeof raw.to === "string" ? raw.to.toLowerCase() : "";
  const amount = Number(raw.amount);
  const result = Number(raw.result);
  const timestamp = Number(raw.timestamp);
  if (!hasCurrency(from) || !hasCurrency(to) || from === to) return null;
  if (!validNumber(amount) || !validNumber(result)) return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 86_400_000) return null;

  return {
    id: typeof raw.id === "string" && raw.id.length <= 80 ? raw.id : `${timestamp}-${from}-${to}`,
    from,
    to,
    amount,
    result,
    timestamp,
    rateDate: typeof raw.rateDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.rateDate) ? raw.rateDate : ""
  };
}

export function normalizeHistory(raw) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const seen = new Set();
  const items = [];

  for (const rawEntry of source) {
    const entry = normalizeEntry(rawEntry);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push(entry);
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    items: items.slice(0, MAX_HISTORY_ITEMS)
  };
}

function nearlyEqual(a, b) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-12;
}

export function createHistoryEntry({ from, to, amount, result, rateDate = "" }) {
  const timestamp = Date.now();
  return normalizeEntry({
    id: globalThis.crypto?.randomUUID?.() ?? `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
    from,
    to,
    amount,
    result,
    timestamp,
    rateDate
  });
}

export function addHistoryEntry(history, entry) {
  const normalized = normalizeHistory(history);
  const safeEntry = normalizeEntry(entry);
  if (!safeEntry) return normalized;

  const first = normalized.items[0];
  if (first
      && first.from === safeEntry.from
      && first.to === safeEntry.to
      && nearlyEqual(first.amount, safeEntry.amount)
      && nearlyEqual(first.result, safeEntry.result)
      && safeEntry.timestamp - first.timestamp < 30_000) {
    normalized.items[0] = safeEntry;
  } else {
    normalized.items.unshift(safeEntry);
  }

  return normalizeHistory(normalized);
}

export function removeHistoryEntry(history, id) {
  const normalized = normalizeHistory(history);
  normalized.items = normalized.items.filter((entry) => entry.id !== id);
  return normalized;
}
