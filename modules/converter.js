import { getCurrencyAliases } from "./catalog.js";

// Rates are stored as units of the currency per one USD. Conversion therefore
// only needs one normalized table: amount * targetRate / baseRate.
export function parseAmount(value, locale = "en") {
  if (typeof value !== "string") return Number.NaN;
  let normalized = value.trim().replace(/[\s\u00a0'’]/g, "");
  if (!normalized) return Number.NaN;

  const commaIndex = normalized.lastIndexOf(",");
  const dotIndex = normalized.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.split(groupingSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(/,/g, ".");
  } else if (commaIndex >= 0) {
    const commaLooksGrouped = /^(?:[-+]?\d{1,3})(?:,\d{3})+$/.test(normalized);
    const commaDecimalLocale = locale.startsWith("ru") || locale.startsWith("de");
    normalized = commaLooksGrouped && !commaDecimalLocale
      ? normalized.replace(/,/g, "")
      : normalized.replace(/,/g, ".");
  } else if (dotIndex >= 0) {
    const dotLooksGrouped = /^(?:[-+]?\d{1,3})(?:\.\d{3})+$/.test(normalized);
    const dotGroupingLocale = locale.startsWith("ru") || locale.startsWith("de");
    if (dotLooksGrouped && dotGroupingLocale) normalized = normalized.replace(/\./g, "");
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : Number.NaN;
}

export function isValidRate(value) {
  return Number.isFinite(value) && value > 0 && value < 1e18;
}

export function convertValue(amount, table, base, target) {
  if (!Number.isFinite(amount) || !table?.rates) return Number.NaN;
  const baseRate = Number(table.rates[base]);
  const targetRate = Number(table.rates[target]);
  if (!isValidRate(baseRate) || !isValidRate(targetRate)) return Number.NaN;
  return amount * (targetRate / baseRate);
}

export function formatValue(value, currency, locale = "en") {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  const absolute = Math.abs(value);
  const isCrypto = currency?.type === "crypto";
  const options = isCrypto
    ? { maximumFractionDigits: absolute >= 1 ? 6 : 8, maximumSignificantDigits: 10 }
    : { maximumFractionDigits: absolute >= 1 ? 2 : 6, maximumSignificantDigits: 10 };

  return new Intl.NumberFormat(locale, options).format(value);
}

export function valueForInput(value) {
  if (!Number.isFinite(value)) return "";
  return Number(value.toPrecision(12)).toString();
}

export function valueForClipboard(value) {
  if (!Number.isFinite(value)) return "";
  return Number(value.toPrecision(14)).toString();
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[._/\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function currencySearchFields(currency, localizedName = "") {
  return [currency?.id, currency?.name, localizedName, ...getCurrencyAliases(currency?.id)]
    .filter(Boolean)
    .map(normalizeSearchText);
}

export function getCurrencySearchRank(currency, query, localizedName = "") {
  const normalized = normalizeSearchText(query);
  if (!normalized) return 10;
  const fields = currencySearchFields(currency, localizedName);
  const code = normalizeSearchText(currency?.id);
  if (code === normalized) return 0;
  if (fields.some((field) => field === normalized)) return 1;
  if (code.startsWith(normalized)) return 2;
  if (fields.some((field) => field.startsWith(normalized))) return 3;
  if (fields.some((field) => field.includes(normalized))) return 4;
  return Number.POSITIVE_INFINITY;
}

export function matchesCurrencySearch(currency, query, localizedName = "") {
  return Number.isFinite(getCurrencySearchRank(currency, query, localizedName));
}
