"use strict";

// Shared controller for popup.html and sidebar.html. It owns view state and
// delegates parsing, storage, rate validation, and DOM row rendering to modules.
import { CURRENCIES, MIN_VISIBLE_CURRENCIES, getCurrency } from "./modules/catalog.js";
import {
  convertValue,
  formatValue,
  getCurrencySearchRank,
  isValidRate,
  parseAmount,
  valueForClipboard,
  valueForInput
} from "./modules/converter.js";
import {
  appendCalculatorToken,
  displayExpression,
  formatCalculatorNumber,
  numberForExpression,
  tryEvaluateExpression
} from "./modules/calculator.js";
import { addHistoryEntry, createHistoryEntry, normalizeHistory, removeHistoryEntry } from "./modules/history.js";
import { createI18n } from "./modules/i18n.js";
import {
  SHORTCUT_ACTIONS,
  createDefaultShortcuts,
  formatShortcut,
  shortcutFromKeyboardEvent,
  toBrowserShortcut
} from "./modules/shortcuts.js";
import {
  getCacheCondition,
  getTableAge,
  fetchFreshTable,
  isCurrencyRateAvailable,
  sanitizeCachedTable,
  shouldRevalidate
} from "./modules/rates.js";
import {
  CONFIG_KEY,
  HISTORY_KEY,
  RATES_CACHE_KEY,
  extensionApi,
  loadConfig,
  loadHistory,
  loadRatesCache,
  normalizeConfig,
  saveConfig,
  saveHistory,
  saveRatesCache,
  subscribeStorage
} from "./modules/storage.js";
import { CurrencyListView, createCopyIcon, createCurrencyIcon, setCopyState } from "./modules/ui.js";

const tabConverter = document.getElementById("tab-converter");
const tabCalculator = document.getElementById("tab-calculator");
const amountEl = document.getElementById("amount");
const baseEl = document.getElementById("base");
const swapButton = document.getElementById("btn-swap");
const targetEl = document.getElementById("target");
const primaryResultEl = document.getElementById("primary-result");
const primaryResultValueEl = document.getElementById("primary-result-value");
const primaryResultNoteEl = document.getElementById("primary-result-note");
const btnFavoritePair = document.getElementById("btn-favorite-pair");
const favoritePairsListEl = document.getElementById("favorite-pairs-list");
const favoritePairsEmptyEl = document.getElementById("favorite-pairs-empty");
const searchEl = document.getElementById("currency-search");
const clearSearchButton = document.getElementById("btn-clear-search");
const listEl = document.getElementById("list");
const statusTextEl = document.getElementById("status-text");
const btnRetry = document.getElementById("btn-retry");

const viewConverter = document.getElementById("view-converter");
const viewCalculator = document.getElementById("view-calculator");
const viewHistory = document.getElementById("view-history");
const viewSettings = document.getElementById("view-settings");
const btnHistory = document.getElementById("btn-history");
const btnHistoryBack = document.getElementById("btn-history-back");
const btnClearHistory = document.getElementById("btn-clear-history");
const historyListEl = document.getElementById("history-list");
const btnSettings = document.getElementById("btn-settings");
const btnBack = document.getElementById("btn-back");
const settingsListEl = document.getElementById("settings-list");
const settingsNoticeEl = document.getElementById("settings-notice");
const showIconsEl = document.getElementById("show-icons");
const languageEl = document.getElementById("language-select");
const launchModeEl = document.getElementById("launch-mode-select");
const shortcutSettingsListEl = document.getElementById("shortcut-settings-list");
const btnClearShortcuts = document.getElementById("btn-clear-shortcuts");

const calculatorGrid = document.getElementById("calculator-grid");
const calcExpressionEl = document.getElementById("calc-expression");
const calcResultEl = document.getElementById("calc-result");

const currencyPicker = document.getElementById("currency-picker");
const currencyPickerClose = document.getElementById("currency-picker-close");
const currencyPickerTitle = document.getElementById("currency-picker-title");
const currencyPickerSearch = document.getElementById("currency-picker-search");
const currencyPickerList = document.getElementById("currency-picker-list");

let config = null;
let history = normalizeHistory(null);
let currentTable = null;
let refreshController = null;
let refreshSequence = 0;
let searchQuery = "";
let noticeTimer = null;
let lastRefreshFailed = false;
let configWriteQueue = Promise.resolve();
let historyWriteQueue = Promise.resolve();
let i18n = createI18n("auto", extensionApi);
let activeTool = "converter";
let pickerResults = [];
let pickerIndex = 0;
let currencyPickerMode = "base";
let calculatorExpression = "";
let calculatorJustEvaluated = false;
let calculatorHasError = false;
let pendingBackgroundCommand = null;

const RUN_COMMAND_MESSAGE = "converter:run-command";
const SURFACE_READY_MESSAGE = "converter:surface-ready";
const SHORTCUT_CAPTURE_MESSAGE = "converter:shortcut-capture";

const listView = new CurrencyListView(listEl, {
  i18n,
  onSelect: (currencyId) => selectTargetCurrency(currencyId),
  onFavorite: (currencyId) => toggleFavorite(currencyId),
  onCopy: async ({ text, currencyId, converted }) => {
    const copied = await copyText(text);
    if (copied && Number.isFinite(converted)) {
      const amount = parseAmount(amountEl.value, i18n.locale);
      if (Number.isFinite(amount) && amount >= 0) {
        void recordHistory({ from: config.base, to: currencyId, amount, result: converted });
      }
    }
    return copied;
  }
});

function setActiveView(activeView) {
  for (const view of [viewConverter, viewCalculator, viewHistory, viewSettings]) {
    view.classList.toggle("active", view === activeView);
  }
}

function setActiveTool(tool) {
  activeTool = tool === "calculator" ? "calculator" : "converter";
  tabConverter.classList.toggle("active", activeTool === "converter");
  tabCalculator.classList.toggle("active", activeTool === "calculator");
  tabConverter.setAttribute("aria-selected", String(activeTool === "converter"));
  tabCalculator.setAttribute("aria-selected", String(activeTool === "calculator"));
  setActiveView(activeTool === "calculator" ? viewCalculator : viewConverter);
  if (activeTool === "calculator") renderCalculator();
}

function getVisibleCurrencies() {
  return config.currencies
    .filter((item) => item.visible)
    .map((item) => getCurrency(item.id))
    .filter(Boolean);
}

function getVisibleIds() {
  return new Set(config.currencies.filter((item) => item.visible).map((item) => item.id));
}

function getFallbackTarget(base = config.base) {
  const visibleIds = getVisibleIds();
  return config.favoriteIds.find((id) => visibleIds.has(id) && id !== base)
    ?? config.currencies.find((item) => item.visible && item.id !== base)?.id
    ?? base;
}

function ensureBaseAndTarget() {
  const visibleIds = getVisibleIds();
  if (!visibleIds.has(config.base)) config.base = config.currencies.find((item) => item.visible)?.id ?? "usd";
  if (!visibleIds.has(config.swapTarget) || config.swapTarget === config.base) {
    config.swapTarget = getFallbackTarget(config.base);
  }
}

function setStatus(text = "", { retry = false, tone = "", title = "" } = {}) {
  statusTextEl.textContent = text;
  statusTextEl.title = title || text;
  // Keep the complete source diagnostic available to assistive technology,
  // even when the compact visual status only shows a short summary.
  statusTextEl.setAttribute("aria-label", title || text);
  statusTextEl.classList.remove("warning", "danger", "success");
  if (tone) statusTextEl.classList.add(tone);
  btnRetry.hidden = !retry;
}

function setTableStatus(table, { updating = false, failed = false } = {}) {
  if (!table) {
    setStatus(failed ? i18n.t("ratesUnavailable") : "", { retry: failed, tone: failed ? "danger" : "" });
    return;
  }

  const age = getTableAge(table);
  const ageText = i18n.formatAge(age);
  const rateDate = i18n.formatDate(table.date);
  const hasConfirmedRateDate = Boolean(table.date);
  const condition = getCacheCondition(table);

  if (updating) {
    const prefix = condition === "very-stale"
      ? i18n.t("veryStaleCache")
      : condition === "stale"
        ? i18n.t("staleCache")
        : i18n.t("cache");
    setStatus(i18n.t("statusUpdating", {
      prefix,
      age: ageText,
      updating: i18n.t("updating")
    }), { tone: condition === "usable" ? "" : "warning" });
    return;
  }

  if (failed) {
    const offline = navigator.onLine === false;
    const prefix = offline ? i18n.t("offline") : i18n.t("updateFailed");
    const staleText = condition === "very-stale"
      ? ` · ${i18n.t("dataVeryOld")}`
      : condition === "stale"
        ? ` · ${i18n.t("dataStale")}`
        : "";
    setStatus(i18n.t("statusFailed", { prefix, stale: staleText, age: ageText }), {
      retry: true,
      tone: condition === "usable" ? "warning" : "danger"
    });
    return;
  }

  if (condition === "very-stale") {
    setStatus(hasConfirmedRateDate
      ? i18n.t("veryOldDataFrom", { date: rateDate, age: ageText })
      : i18n.t("veryOldDataUnknownDate", { age: ageText }), { retry: true, tone: "danger" });
  } else if (condition === "stale") {
    setStatus(hasConfirmedRateDate
      ? i18n.t("staleDataFrom", { date: rateDate, age: ageText })
      : i18n.t("staleDataUnknownDate", { age: ageText }), { retry: true, tone: "warning" });
  } else {
    const comparison = table.comparison;
    if (comparison?.status === "verified") {
      setStatus(i18n.t("ratesVerified", {
        sources: comparison.sourceCount || comparison.sources?.length || 2,
        matched: comparison.matched,
        compared: comparison.compared,
        age: ageText
      }), {
        tone: "success",
        title: i18n.t("verifiedRatesTitle", {
          count: comparison.compared,
          sources: comparison.sourceCount || comparison.sources?.length || 2
        })
      });
    } else if (comparison?.status === "warning") {
      const codes = (comparison.mismatches || []).map((item) => item.id.toUpperCase()).join(", ") || "—";
      setStatus(i18n.t("ratesMismatch", {
        count: comparison.blockedIds?.length || comparison.mismatchCount,
        age: ageText
      }), {
        tone: "warning",
        title: i18n.t("mismatchRatesTitle", {
          percent: (Number(comparison.maxDifference || 0) * 100).toFixed(1),
          codes
        })
      });
    } else {
      setStatus(i18n.t(hasConfirmedRateDate ? "rateSingleSource" : "rateSingleSourceUnknownDate", {
        source: table.source,
        age: ageText
      }), {
        tone: "warning",
        title: hasConfirmedRateDate
          ? i18n.t("rateFrom", { date: rateDate, source: table.source, age: ageText })
          : i18n.t("rateFromUnknownDate", { source: table.source, age: ageText })
      });
    }
  }
}

function updateBaseButton() {
  const currency = getCurrency(config.base);
  baseEl.textContent = currency ? currency.id.toUpperCase() : "—";
  const name = currency ? i18n.currencyName(currency) : config.base.toUpperCase();
  baseEl.title = `${i18n.t("chooseBaseCurrency")}: ${name}`;
  baseEl.setAttribute("aria-label", `${i18n.t("chooseBaseCurrency")}: ${name}`);
}

function updateSwapButton() {
  ensureBaseAndTarget();
  const label = i18n.t("swapAria", {
    from: config.base.toUpperCase(),
    to: config.swapTarget.toUpperCase()
  });
  swapButton.title = label;
  swapButton.setAttribute("aria-label", label);
  const amount = parseAmount(amountEl.value, i18n.locale);
  swapButton.disabled = !currentTable
    || !Number.isFinite(amount)
    || amount < 0
    || config.swapTarget === config.base
    || !isCurrencyRateAvailable(currentTable, config.base)
    || !isCurrencyRateAvailable(currentTable, config.swapTarget);
  updateFavoritePairButton();
}

function renderPrimaryResult() {
  const baseCurrency = getCurrency(config.base);
  const targetCurrency = getCurrency(config.swapTarget);
  const baseCode = config.base.toUpperCase();
  const targetCode = config.swapTarget.toUpperCase();
  const targetName = targetCurrency ? i18n.currencyName(targetCurrency) : targetCode;
  targetEl.textContent = targetCode;
  targetEl.title = `${i18n.t("chooseTargetCurrency")}: ${targetName}`;
  targetEl.setAttribute("aria-label", targetEl.title);
  primaryResultNoteEl.textContent = `${baseCode} → ${targetCode}`;

  const amount = parseAmount(amountEl.value, i18n.locale);
  const hasRate = currentTable
    && Number.isFinite(amount)
    && amount >= 0
    && isCurrencyRateAvailable(currentTable, config.base)
    && isCurrencyRateAvailable(currentTable, config.swapTarget);
  const converted = hasRate ? convertValue(amount, currentTable, config.base, config.swapTarget) : NaN;
  const available = Number.isFinite(converted) && Boolean(targetCurrency);
  primaryResultEl.classList.toggle("unavailable", !available);
  primaryResultValueEl.textContent = available
    ? formatValue(converted, targetCurrency, i18n.locale)
    : i18n.t(currentTable ? "unavailable" : "loading");
  const resultLabel = available
    ? `${i18n.t("result")}: ${primaryResultValueEl.textContent} ${targetCode}`
    : `${i18n.t("result")}: ${primaryResultValueEl.textContent}`;
  primaryResultEl.setAttribute("aria-label", resultLabel);

  if (!baseCurrency) primaryResultNoteEl.textContent = `— → ${targetCode}`;
}

function favoritePairKey(from, to) {
  return `${from}:${to}`;
}

function currentFavoritePair() {
  if (!config || !config.base || !config.swapTarget || config.base === config.swapTarget) return null;
  return { from: config.base, to: config.swapTarget };
}

function isFavoritePair(pair) {
  if (!pair || !config) return false;
  const key = favoritePairKey(pair.from, pair.to);
  return config.favoritePairs.some((item) => favoritePairKey(item.from, item.to) === key);
}

function updateFavoritePairButton() {
  const pair = currentFavoritePair();
  const from = pair?.from?.toUpperCase() ?? "—";
  const to = pair?.to?.toUpperCase() ?? "—";
  const active = isFavoritePair(pair);
  btnFavoritePair.textContent = active ? "★" : "☆";
  btnFavoritePair.classList.toggle("active", active);
  btnFavoritePair.title = i18n.t(active ? "removeFavoritePair" : "addFavoritePair", { from, to });
  btnFavoritePair.setAttribute(
    "aria-label",
    i18n.t(active ? "removeFavoritePairAria" : "addFavoritePairAria", { from, to })
  );
  btnFavoritePair.disabled = !pair;
}

function renderFavoritePairs() {
  favoritePairsListEl.replaceChildren();
  if (!config) {
    favoritePairsEmptyEl.hidden = true;
    return;
  }

  const current = currentFavoritePair();
  const fragment = document.createDocumentFragment();
  for (const pair of config.favoritePairs) {
    const fromCurrency = getCurrency(pair.from);
    const toCurrency = getCurrency(pair.to);
    if (!fromCurrency || !toCurrency) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "favorite-pair";
    wrapper.classList.toggle("active", pair.from === current?.from && pair.to === current?.to);

    const selectButton = document.createElement("button");
    selectButton.className = "favorite-pair-select";
    selectButton.type = "button";
    selectButton.textContent = `${pair.from.toUpperCase()} → ${pair.to.toUpperCase()}`;
    selectButton.title = i18n.t("selectFavoritePair", {
      from: i18n.currencyName(fromCurrency),
      to: i18n.currencyName(toCurrency)
    });
    selectButton.setAttribute("aria-label", selectButton.title);
    selectButton.addEventListener("click", () => selectFavoritePair(pair));

    const removeButton = document.createElement("button");
    removeButton.className = "favorite-pair-remove";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.title = i18n.t("removeFavoritePair", {
      from: pair.from.toUpperCase(),
      to: pair.to.toUpperCase()
    });
    removeButton.setAttribute(
      "aria-label",
      i18n.t("removeFavoritePairAria", { from: pair.from.toUpperCase(), to: pair.to.toUpperCase() })
    );
    removeButton.addEventListener("click", () => removeFavoritePair(pair));

    wrapper.append(selectButton, removeButton);
    fragment.appendChild(wrapper);
  }
  favoritePairsListEl.appendChild(fragment);
  favoritePairsEmptyEl.hidden = config.favoritePairs.length > 0;
  updateFavoritePairButton();
}

function selectFavoritePair(pair) {
  const fromItem = config.currencies.find((item) => item.id === pair.from);
  const toItem = config.currencies.find((item) => item.id === pair.to);
  if (!fromItem || !toItem || pair.from === pair.to) return;
  fromItem.visible = true;
  toItem.visible = true;
  config.base = pair.from;
  config.swapTarget = pair.to;
  ensureBaseAndTarget();
  updateBaseButton();
  updateSwapButton();
  syncListStructure();
  renderValues();
  renderFavoritePairs();
  void persistConfig();
  if (!lastRefreshFailed) setTableStatus(currentTable);
}

function toggleFavoritePair() {
  const pair = currentFavoritePair();
  if (!pair) return;
  const key = favoritePairKey(pair.from, pair.to);
  const exists = config.favoritePairs.some((item) => favoritePairKey(item.from, item.to) === key);
  config.favoritePairs = exists
    ? config.favoritePairs.filter((item) => favoritePairKey(item.from, item.to) !== key)
    : [...config.favoritePairs, pair];
  void persistConfig();
  renderFavoritePairs();
}

function removeFavoritePair(pair) {
  const key = favoritePairKey(pair.from, pair.to);
  config.favoritePairs = config.favoritePairs.filter((item) => favoritePairKey(item.from, item.to) !== key);
  void persistConfig();
  renderFavoritePairs();
}

function syncListStructure() {
  listView.syncStructure(getVisibleCurrencies(), config.favoriteIds);
}

function renderValues() {
  updateSwapButton();
  renderPrimaryResult();
  const amount = parseAmount(amountEl.value, i18n.locale);

  if (!Number.isFinite(amount) || amount < 0) {
    listView.showMessage(i18n.t("invalidAmount"));
    return;
  }
  if (!currentTable) {
    listView.showMessage(i18n.t("loading"), "loading");
    return;
  }
  if (!isCurrencyRateAvailable(currentTable, config.base)) {
    listView.showMessage(i18n.t("blockedBaseRate"), "error");
    return;
  }

  listView.update({
    amount,
    base: config.base,
    target: config.swapTarget,
    table: currentTable,
    showIcons: config.showIcons,
    searchQuery,
    favoriteIds: config.favoriteIds,
    blockedIds: currentTable.comparison?.blockedIds ?? []
  });
}

function persistConfig() {
  config = normalizeConfig(config);
  const snapshot = structuredClone(config);
  configWriteQueue = configWriteQueue
    .catch(() => undefined)
    .then(() => saveConfig(snapshot));
  return configWriteQueue;
}

function persistHistory() {
  history = normalizeHistory(history);
  const snapshot = structuredClone(history);
  historyWriteQueue = historyWriteQueue
    .catch(() => undefined)
    .then(() => saveHistory(snapshot));
  return historyWriteQueue;
}

function recordHistory({ from, to, amount, result }) {
  const entry = createHistoryEntry({
    from,
    to,
    amount,
    result,
    rateDate: currentTable?.date ?? ""
  });
  if (!entry) return Promise.resolve();
  history = addHistoryEntry(history, entry);
  renderHistory();
  return persistHistory();
}

function swapTo(targetId) {
  if (!targetId || targetId === config.base || !getVisibleIds().has(targetId)) return;
  const amount = parseAmount(amountEl.value, i18n.locale);
  if (!Number.isFinite(amount) || amount < 0 || !currentTable) {
    setStatus(i18n.t("waitForRates"), { tone: "warning" });
    return;
  }
  if (!isCurrencyRateAvailable(currentTable, config.base) || !isCurrencyRateAvailable(currentTable, targetId)) {
    setStatus(i18n.t("blockedRateAction"), { retry: true, tone: "danger" });
    return;
  }

  const converted = convertValue(amount, currentTable, config.base, targetId);
  if (!Number.isFinite(converted)) {
    setStatus(i18n.t("noRate"), { retry: true, tone: "danger" });
    return;
  }

  const previousBase = config.base;
  void recordHistory({ from: previousBase, to: targetId, amount, result: converted });
  config.base = targetId;
  config.swapTarget = previousBase;
  amountEl.value = valueForInput(converted);
  updateBaseButton();
  void persistConfig();
  renderValues();
  renderFavoritePairs();
  if (!lastRefreshFailed) setTableStatus(currentTable);
}

function setBaseWithoutConversion(newBase) {
  if (!newBase || newBase === config.base) return;
  const previousBase = config.base;
  config.base = newBase;
  if (config.swapTarget === newBase || !getVisibleIds().has(config.swapTarget)) config.swapTarget = previousBase;
  ensureBaseAndTarget();
  updateBaseButton();
  void persistConfig();
  renderValues();
  renderFavoritePairs();
  if (!lastRefreshFailed) setTableStatus(currentTable);
}

function selectTargetCurrency(targetId) {
  if (!targetId || targetId === config.base || !getVisibleIds().has(targetId)) return;
  if (!currentTable || !isCurrencyRateAvailable(currentTable, config.base) || !isCurrencyRateAvailable(currentTable, targetId)) {
    setStatus(i18n.t("waitForRates"), { tone: "warning" });
    return;
  }

  config.swapTarget = targetId;
  ensureBaseAndTarget();
  void persistConfig();
  renderValues();
  renderFavoritePairs();
  if (!lastRefreshFailed) setTableStatus(currentTable);
}

function getPickerResults(query = "") {
  const visibleIds = getVisibleIds();
  const favoriteIds = new Set(config.favoriteIds);
  const order = new Map(config.currencies.map((item, index) => [item.id, index]));
  const selectedId = currencyPickerMode === "target" ? config.swapTarget : config.base;
  return CURRENCIES
    .map((currency) => ({
      currency,
      rank: getCurrencySearchRank(currency, query, i18n.currencyName(currency)),
      available: isCurrencyRateAvailable(currentTable, currency.id),
      blocked: Boolean(currentTable
        && isValidRate(Number(currentTable.rates[currency.id]))
        && !isCurrencyRateAvailable(currentTable, currency.id)),
      visible: visibleIds.has(currency.id),
      favorite: favoriteIds.has(currency.id)
    }))
    .filter((item) => Number.isFinite(item.rank))
    .sort((left, right) => {
      if (left.currency.id === selectedId) return -1;
      if (right.currency.id === selectedId) return 1;
      return left.rank - right.rank
        || Number(right.available) - Number(left.available)
        || Number(right.favorite) - Number(left.favorite)
        || Number(right.visible) - Number(left.visible)
        || (order.get(left.currency.id) ?? 9999) - (order.get(right.currency.id) ?? 9999);
    })
    .slice(0, 100);
}

function isPickerItemSelectable(item) {
  return item?.available && !(currencyPickerMode === "target" && item.currency.id === config.base);
}

function renderCurrencyPicker() {
  const query = currencyPickerSearch.value;
  pickerResults = getPickerResults(query);
  pickerIndex = Math.min(Math.max(0, pickerIndex), Math.max(0, pickerResults.length - 1));
  if (!isPickerItemSelectable(pickerResults[pickerIndex])) {
    const firstSelectable = pickerResults.findIndex(isPickerItemSelectable);
    if (firstSelectable >= 0) pickerIndex = firstSelectable;
  }
  currencyPickerList.replaceChildren();
  currencyPickerTitle.textContent = i18n.t(currencyPickerMode === "target" ? "quickTargetCurrencySelect" : "quickCurrencySelect");

  if (pickerResults.length === 0) {
    const empty = document.createElement("div");
    empty.className = "message";
    empty.textContent = i18n.t("noResults");
    currencyPickerList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  pickerResults.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-item";
    button.setAttribute("role", "option");
    button.classList.toggle("active", index === pickerIndex);
    const selectedId = currencyPickerMode === "target" ? config.swapTarget : config.base;
    button.setAttribute("aria-selected", String(item.currency.id === selectedId));
    button.disabled = !isPickerItemSelectable(item);

    const code = document.createElement("span");
    code.className = "picker-code";
    code.textContent = item.currency.id.toUpperCase();

    const name = document.createElement("span");
    name.className = "picker-name";
    name.textContent = i18n.currencyName(item.currency);

    const badge = document.createElement("span");
    badge.className = "picker-badge";
    badge.textContent = item.currency.id === selectedId
      ? i18n.t("selected")
      : currencyPickerMode === "target" && item.currency.id === config.base
        ? i18n.t("baseLabel")
      : item.available
        ? (item.favorite ? "★" : "")
        : item.blocked
          ? i18n.t("rateBlocked")
          : i18n.t("unavailable");

    button.append(code, name, badge);
    button.addEventListener("mouseenter", () => {
      pickerIndex = index;
      updatePickerActiveItem();
    });
    button.addEventListener("click", () => selectPickerCurrency(item.currency.id));
    fragment.appendChild(button);
  });
  currencyPickerList.appendChild(fragment);
}

function updatePickerActiveItem({ scroll = false } = {}) {
  const buttons = [...currencyPickerList.querySelectorAll(".picker-item")];
  buttons.forEach((button, index) => button.classList.toggle("active", index === pickerIndex));
  if (scroll) buttons[pickerIndex]?.scrollIntoView({ block: "nearest" });
}

function openCurrencyPicker(mode = "base") {
  if (!config) return;
  setActiveTool("converter");
  currencyPickerMode = mode === "target" ? "target" : "base";
  currencyPicker.hidden = false;
  currencyPickerSearch.value = "";
  pickerIndex = 0;
  renderCurrencyPicker();
  requestAnimationFrame(() => currencyPickerSearch.focus());
}

function closeCurrencyPicker() {
  currencyPicker.hidden = true;
  (currencyPickerMode === "target" ? targetEl : baseEl).focus();
}

function selectPickerCurrency(currencyId) {
  const item = config.currencies.find((currency) => currency.id === currencyId);
  if (!item || !currentTable || !isCurrencyRateAvailable(currentTable, currencyId)) return;
  if (currencyPickerMode === "target") {
    selectTargetCurrency(currencyId);
    closeCurrencyPicker();
    return;
  }
  item.visible = true;
  const previousBase = config.base;
  config.base = currencyId;
  if (config.swapTarget === currencyId || !getVisibleIds().has(config.swapTarget)) {
    config.swapTarget = previousBase !== currencyId ? previousBase : getFallbackTarget(currencyId);
  }
  ensureBaseAndTarget();
  updateBaseButton();
  syncListStructure();
  renderValues();
  renderFavoritePairs();
  void persistConfig();
  closeCurrencyPicker();
}

function handlePickerKeydown(event) {
  if (currencyPicker.hidden) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    closeCurrencyPicker();
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (pickerResults.length === 0) return true;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    let next = pickerIndex;
    for (let attempts = 0; attempts < pickerResults.length; attempts += 1) {
      next = (next + direction + pickerResults.length) % pickerResults.length;
      if (isPickerItemSelectable(pickerResults[next])) break;
    }
    pickerIndex = next;
    updatePickerActiveItem({ scroll: true });
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const selected = pickerResults[pickerIndex];
    if (isPickerItemSelectable(selected)) selectPickerCurrency(selected.currency.id);
    return true;
  }
  return false;
}

function getCalculatorEvaluation() {
  if (!calculatorExpression) return { ok: true, value: 0, error: "" };
  return tryEvaluateExpression(calculatorExpression);
}

function renderCalculator() {
  calcExpressionEl.textContent = displayExpression(calculatorExpression || "0");
  const evaluation = getCalculatorEvaluation();
  calcResultEl.classList.toggle("error", calculatorHasError);
  if (calculatorHasError) {
    calcResultEl.textContent = i18n.t("calculatorError");
  } else if (evaluation.ok) {
    calcResultEl.textContent = formatCalculatorNumber(evaluation.value, i18n.locale);
  } else {
    calcResultEl.textContent = "…";
  }
}

function calculatorApplyValue(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e100) {
    calculatorHasError = true;
    calculatorJustEvaluated = false;
    renderCalculator();
    return;
  }
  calculatorExpression = numberForExpression(value);
  calculatorJustEvaluated = true;
  calculatorHasError = false;
  renderCalculator();
}

function findLastTopLevelOperator(expression) {
  let depth = 0;
  for (let index = expression.length - 1; index >= 0; index -= 1) {
    const char = expression[index];
    if (char === ")") depth += 1;
    else if (char === "(") depth -= 1;
    else if (depth === 0 && "+-*/".includes(char)) {
      if (char === "-" && (index === 0 || "+-*/(".includes(expression[index - 1]))) continue;
      return index;
    }
  }
  return -1;
}

function applyCalculatorPercent() {
  const operatorIndex = findLastTopLevelOperator(calculatorExpression);
  if (operatorIndex < 0) {
    const evaluation = getCalculatorEvaluation();
    calculatorApplyValue(evaluation.ok ? evaluation.value / 100 : Number.NaN);
    return;
  }

  const leftExpression = calculatorExpression.slice(0, operatorIndex);
  const rightExpression = calculatorExpression.slice(operatorIndex + 1);
  const operator = calculatorExpression[operatorIndex];
  const left = tryEvaluateExpression(leftExpression);
  const right = tryEvaluateExpression(rightExpression);
  if (!left.ok || !right.ok) {
    calculatorHasError = true;
    renderCalculator();
    return;
  }
  const percentage = operator === "+" || operator === "-"
    ? left.value * right.value / 100
    : right.value / 100;
  calculatorExpression = `${leftExpression}${operator}${numberForExpression(percentage)}`;
  calculatorJustEvaluated = false;
  calculatorHasError = false;
  renderCalculator();
}

function toggleCalculatorSign() {
  const operatorIndex = findLastTopLevelOperator(calculatorExpression);
  if (operatorIndex < 0) {
    const evaluation = getCalculatorEvaluation();
    calculatorApplyValue(evaluation.ok ? -evaluation.value : Number.NaN);
    return;
  }
  const leftExpression = calculatorExpression.slice(0, operatorIndex + 1);
  const rightExpression = calculatorExpression.slice(operatorIndex + 1);
  const right = tryEvaluateExpression(rightExpression);
  if (!right.ok) {
    calculatorHasError = true;
    renderCalculator();
    return;
  }
  calculatorExpression = `${leftExpression}${numberForExpression(-right.value)}`;
  calculatorJustEvaluated = false;
  calculatorHasError = false;
  renderCalculator();
}

function handleCalculatorAction(action) {
  if (action === "clear") {
    calculatorExpression = "";
    calculatorJustEvaluated = false;
    calculatorHasError = false;
    renderCalculator();
    return;
  }
  if (action === "backspace") {
    calculatorExpression = calculatorJustEvaluated ? "" : calculatorExpression.slice(0, -1);
    calculatorJustEvaluated = false;
    calculatorHasError = false;
    renderCalculator();
    return;
  }
  if (action === "left-paren" || action === "right-paren") {
    handleCalculatorToken(action === "left-paren" ? "(" : ")");
    return;
  }

  const evaluation = getCalculatorEvaluation();
  if (!evaluation.ok) {
    calculatorHasError = true;
    renderCalculator();
    return;
  }

  if (action === "equals") calculatorApplyValue(evaluation.value);
  else if (action === "percent") applyCalculatorPercent();
  else if (action === "sign") toggleCalculatorSign();
  else if (action === "sqrt") calculatorApplyValue(evaluation.value >= 0 ? Math.sqrt(evaluation.value) : Number.NaN);
  else if (action === "square") calculatorApplyValue(evaluation.value * evaluation.value);
}

function handleCalculatorToken(token) {
  calculatorExpression = appendCalculatorToken(calculatorExpression, token, calculatorJustEvaluated);
  calculatorJustEvaluated = false;
  calculatorHasError = false;
  renderCalculator();
}

function handleCalculatorKeyboard(event) {
  if (activeTool !== "calculator" || !viewCalculator.classList.contains("active")) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    handleCalculatorToken(event.key);
    return true;
  }
  const tokenMap = { "+": "+", "-": "-", "*": "*", "/": "/", ".": ".", ",": ".", "(": "(", ")": ")" };
  if (tokenMap[event.key]) {
    event.preventDefault();
    handleCalculatorToken(tokenMap[event.key]);
    return true;
  }
  if (event.key === "Enter" || event.key === "=") {
    event.preventDefault();
    handleCalculatorAction("equals");
    return true;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    handleCalculatorAction("backspace");
    return true;
  }
  if (event.key === "Delete" || event.key === "Escape") {
    event.preventDefault();
    handleCalculatorAction("clear");
    return true;
  }
  if (event.key === "%") {
    event.preventDefault();
    handleCalculatorAction("percent");
    return true;
  }
  return false;
}

function toggleFavorite(currencyId) {
  const favorites = new Set(config.favoriteIds);
  if (favorites.has(currencyId)) favorites.delete(currencyId);
  else favorites.add(currencyId);
  config.favoriteIds = [...favorites];
  void persistConfig();
  syncListStructure();
  renderValues();
  if (viewSettings.classList.contains("active")) renderSettings();
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Firefox can deny Clipboard API in hardened profiles.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.className = "copy-helper";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

async function refreshRates({ force = false } = {}) {
  if (!force && currentTable && !shouldRevalidate(currentTable)) {
    lastRefreshFailed = false;
    setTableStatus(currentTable);
    return;
  }

  const requestId = ++refreshSequence;
  refreshController?.abort();
  refreshController = new AbortController();
  const signal = refreshController.signal;

  if (currentTable) {
    setTableStatus(currentTable, { updating: true });
  } else {
    listView.showMessage(i18n.t("loading"), "loading");
    setStatus("");
  }

  try {
    const freshTable = await fetchFreshTable(signal);
    if (signal.aborted || requestId !== refreshSequence) return;
    currentTable = await saveRatesCache(freshTable);
    lastRefreshFailed = false;
    renderValues();
    if (!currencyPicker.hidden) renderCurrencyPicker();
    setTableStatus(currentTable);
  } catch (error) {
    if (signal.aborted || requestId !== refreshSequence) return;
    console.warn("Rate refresh failed", error);
    lastRefreshFailed = true;
    if (currentTable) {
      renderValues();
      setTableStatus(currentTable, { failed: true });
    } else {
      listView.showMessage(i18n.t("fetchFailed"), "error");
      setStatus(i18n.t("checkConnection"), { retry: true, tone: "danger" });
    }
  }
}

function showSettingsNotice(text) {
  settingsNoticeEl.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    settingsNoticeEl.textContent = "";
  }, 2400);
}

function renderShortcutSettings() {
  shortcutSettingsListEl.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const action of SHORTCUT_ACTIONS) {
    const label = i18n.t(action.labelKey);
    const row = document.createElement("div");
    row.className = "shortcut-setting-row";

    const labelEl = document.createElement("label");
    labelEl.className = "shortcut-setting-label";
    labelEl.htmlFor = `shortcut-${action.id}`;
    labelEl.textContent = label;

    const controls = document.createElement("div");
    controls.className = "shortcut-capture";
    const input = document.createElement("input");
    input.id = `shortcut-${action.id}`;
    input.className = "shortcut-input";
    input.type = "text";
    input.readOnly = true;
    input.value = formatShortcut(config.shortcuts[action.id], {
      primary: i18n.t("shortcutPrimary"),
      disabled: i18n.t("shortcutDisabled")
    });
    input.setAttribute("aria-label", i18n.t("shortcutInputAria", { action: label }));
    input.setAttribute("aria-describedby", "shortcut-settings-hint");
    input.addEventListener("focus", () => void setShortcutCapture(true));
    input.addEventListener("blur", () => void setShortcutCapture(false));
    input.addEventListener("keydown", (event) => void captureShortcut(action, event));

    const clearButton = document.createElement("button");
    clearButton.className = "shortcut-clear";
    clearButton.type = "button";
    clearButton.textContent = "×";
    clearButton.disabled = !config.shortcuts[action.id];
    clearButton.title = i18n.t("clearShortcut", { action: label });
    clearButton.setAttribute("aria-label", i18n.t("clearShortcut", { action: label }));
    clearButton.addEventListener("click", () => void clearShortcut(action.id));

    controls.append(input, clearButton);
    row.append(labelEl, controls);
    fragment.appendChild(row);
  }

  shortcutSettingsListEl.appendChild(fragment);
}

function setShortcutCapture(active) {
  return Promise.resolve(extensionApi?.runtime?.sendMessage?.({ type: SHORTCUT_CAPTURE_MESSAGE, active }))
    .catch(() => undefined);
}

async function updateBrowserShortcut(actionId, binding) {
  if (!extensionApi?.commands?.update) return true;
  try {
    await extensionApi.commands.update({ name: actionId, shortcut: toBrowserShortcut(binding) });
    return true;
  } catch (error) {
    console.warn("Could not update the browser shortcut", error);
    showSettingsNotice(i18n.t("shortcutUnavailable"));
    return false;
  }
}

async function syncBrowserShortcuts() {
  for (const { id } of SHORTCUT_ACTIONS) {
    await updateBrowserShortcut(id, config.shortcuts[id]);
  }
}

async function clearShortcut(actionId) {
  if (!config.shortcuts[actionId] || !await updateBrowserShortcut(actionId, "")) return;
  config.shortcuts[actionId] = "";
  await persistConfig();
  renderShortcutSettings();
}

async function clearAllShortcuts() {
  const next = createDefaultShortcuts();
  for (const { id } of SHORTCUT_ACTIONS) {
    if (!config.shortcuts[id]) continue;
    if (!await updateBrowserShortcut(id, "")) return;
  }
  config.shortcuts = next;
  await persistConfig();
  renderShortcutSettings();
}

async function captureShortcut(action, event) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();

  const clearsShortcut = ["Escape", "Backspace", "Delete"].includes(event.key)
    && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  if (clearsShortcut) {
    await clearShortcut(action.id);
    void setShortcutCapture(false);
    return;
  }

  const binding = shortcutFromKeyboardEvent(event);
  if (!binding) {
    const hasExactlyOnePrimary = Boolean(event.ctrlKey) !== Boolean(event.metaKey);
    showSettingsNotice(i18n.t(hasExactlyOnePrimary ? "shortcutUnsupported" : "shortcutRequiresPrimary"));
    return;
  }

  const displacedAction = SHORTCUT_ACTIONS.find((candidate) => (
    candidate.id !== action.id && config.shortcuts[candidate.id] === binding
  ));
  if (displacedAction && !await updateBrowserShortcut(displacedAction.id, "")) return;
  if (!await updateBrowserShortcut(action.id, binding)) {
    if (displacedAction) void updateBrowserShortcut(displacedAction.id, binding);
    return;
  }

  if (displacedAction) config.shortcuts[displacedAction.id] = "";
  config.shortcuts[action.id] = binding;
  await persistConfig();
  renderShortcutSettings();
  void setShortcutCapture(false);
  if (displacedAction) {
    showSettingsNotice(i18n.t("shortcutReassigned", {
      shortcut: formatShortcut(binding, { primary: i18n.t("shortcutPrimary") }),
      action: i18n.t(action.labelKey)
    }));
  }
}

function executeShortcutAction(actionId) {
  switch (actionId) {
    case "converter":
      setActiveTool("converter");
      break;
    case "calculator":
      setActiveTool("calculator");
      break;
    case "currencyPicker":
      setActiveTool("converter");
      openCurrencyPicker();
      break;
    case "swap":
      setActiveTool("converter");
      if (!swapButton.disabled) swapTo(config.swapTarget);
      break;
    case "search":
      setActiveTool("converter");
      searchEl.focus();
      break;
    default:
      return false;
  }
  return true;
}

function renderSettings() {
  renderShortcutSettings();
  settingsListEl.replaceChildren();
  const fragment = document.createDocumentFragment();
  const favoriteSet = new Set(config.favoriteIds);

  config.currencies.forEach((item, index) => {
    const currency = getCurrency(item.id);
    if (!currency) return;
    const localizedName = i18n.currencyName(currency);

    const row = document.createElement("div");
    row.className = "setting-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.visible;
    checkbox.setAttribute("aria-label", i18n.t("showCurrency", { name: localizedName }));

    const favoriteButton = document.createElement("button");
    favoriteButton.className = "setting-favorite";
    favoriteButton.type = "button";
    const isFavorite = favoriteSet.has(currency.id);
    favoriteButton.textContent = isFavorite ? "★" : "☆";
    favoriteButton.classList.toggle("active", isFavorite);
    favoriteButton.title = i18n.t(isFavorite ? "removeFavorite" : "addFavorite");
    favoriteButton.setAttribute(
      "aria-label",
      i18n.t(isFavorite ? "removeFavoriteAria" : "addFavoriteAria", { name: localizedName })
    );

    const info = document.createElement("div");
    info.className = "setting-info";
    const icon = createCurrencyIcon(currency);
    icon.hidden = !config.showIcons;
    const code = document.createElement("span");
    code.textContent = currency.id.toUpperCase();
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = localizedName;
    info.append(icon, code, name);

    const upButton = document.createElement("button");
    upButton.className = "arrow-btn";
    upButton.type = "button";
    upButton.textContent = "↑";
    upButton.title = i18n.t("moveUp");
    upButton.setAttribute("aria-label", `${i18n.t("moveUp")}: ${localizedName}`);
    upButton.disabled = index === 0;

    const downButton = document.createElement("button");
    downButton.className = "arrow-btn";
    downButton.type = "button";
    downButton.textContent = "↓";
    downButton.title = i18n.t("moveDown");
    downButton.setAttribute("aria-label", `${i18n.t("moveDown")}: ${localizedName}`);
    downButton.disabled = index === config.currencies.length - 1;

    checkbox.addEventListener("change", () => {
      const visibleCount = config.currencies.filter((currencyItem) => currencyItem.visible).length;
      if (!checkbox.checked && visibleCount <= MIN_VISIBLE_CURRENCIES) {
        checkbox.checked = true;
        showSettingsNotice(i18n.t("minCurrencies"));
        return;
      }

      item.visible = checkbox.checked;
      ensureBaseAndTarget();
      void persistConfig();
      updateBaseButton();
      syncListStructure();
      renderValues();
      renderFavoritePairs();
    });

    favoriteButton.addEventListener("click", () => toggleFavorite(currency.id));
    upButton.addEventListener("click", () => moveCurrency(index, -1));
    downButton.addEventListener("click", () => moveCurrency(index, 1));

    row.append(checkbox, favoriteButton, info, upButton, downButton);
    fragment.appendChild(row);
  });

  settingsListEl.appendChild(fragment);
}

function moveCurrency(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= config.currencies.length) return;
  [config.currencies[index], config.currencies[targetIndex]] = [
    config.currencies[targetIndex],
    config.currencies[index]
  ];
  void persistConfig();
  renderSettings();
  updateBaseButton();
  syncListStructure();
  renderValues();
  renderFavoritePairs();
}

function renderHistory() {
  historyListEl.replaceChildren();
  btnClearHistory.disabled = history.items.length === 0;

  if (history.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "message";
    empty.textContent = i18n.t("emptyHistory");
    historyListEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of history.items) {
    const fromCurrency = getCurrency(entry.from);
    const toCurrency = getCurrency(entry.to);
    if (!fromCurrency || !toCurrency) continue;

    const row = document.createElement("div");
    row.className = "history-row";

    const main = document.createElement("div");
    main.className = "history-main";
    const pair = document.createElement("div");
    pair.className = "history-pair";
    pair.textContent = i18n.t("historyPair", {
      amount: formatValue(entry.amount, fromCurrency, i18n.locale),
      from: entry.from.toUpperCase(),
      result: formatValue(entry.result, toCurrency, i18n.locale),
      to: entry.to.toUpperCase()
    });
    pair.title = `${valueForClipboard(entry.amount)} ${entry.from.toUpperCase()} → ${valueForClipboard(entry.result)} ${entry.to.toUpperCase()}`;

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = i18n.formatDateTime(entry.timestamp);
    main.append(pair, time);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const restoreButton = document.createElement("button");
    restoreButton.className = "history-action";
    restoreButton.type = "button";
    restoreButton.textContent = "↩";
    restoreButton.title = i18n.t("restoreHistory");
    restoreButton.setAttribute("aria-label", i18n.t("restoreHistory"));
    restoreButton.addEventListener("click", () => restoreHistoryEntry(entry));

    const copyButton = document.createElement("button");
    copyButton.className = "history-action copy-btn";
    copyButton.type = "button";
    copyButton.appendChild(createCopyIcon());
    copyButton.title = i18n.t("copy");
    copyButton.setAttribute("aria-label", i18n.t("copyValue"));
    copyButton.addEventListener("click", async () => {
      const copied = await copyText(valueForClipboard(entry.result));
      setCopyState(copyButton, copied ? "success" : "error", i18n);
      setTimeout(() => setCopyState(copyButton, "idle", i18n), 900);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "history-action delete";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.title = i18n.t("deleteHistory");
    deleteButton.setAttribute("aria-label", i18n.t("deleteHistory"));
    deleteButton.addEventListener("click", () => {
      history = removeHistoryEntry(history, entry.id);
      renderHistory();
      void persistHistory();
    });

    actions.append(restoreButton, copyButton, deleteButton);
    row.append(main, actions);
    fragment.appendChild(row);
  }
  historyListEl.appendChild(fragment);
}

function restoreHistoryEntry(entry) {
  const fromItem = config.currencies.find((item) => item.id === entry.from);
  const toItem = config.currencies.find((item) => item.id === entry.to);
  if (!fromItem || !toItem) return;
  fromItem.visible = true;
  toItem.visible = true;
  config.base = entry.from;
  config.swapTarget = entry.to;
  amountEl.value = valueForInput(entry.amount);
  ensureBaseAndTarget();
  void persistConfig();
  updateBaseButton();
  syncListStructure();
  renderValues();
  renderFavoritePairs();
  if (!lastRefreshFailed) setTableStatus(currentTable);
  setActiveTool("converter");
}

function applyLanguage() {
  i18n = createI18n(config?.language ?? "auto", extensionApi);
  i18n.applyDocument();
  listView.setI18n(i18n);
  if (!config) return;

  languageEl.value = config.language;
  launchModeEl.value = config.launchMode;
  updateBaseButton();
  syncListStructure();
  renderValues();
  renderFavoritePairs();
  renderHistory();
  renderCalculator();
  if (!currencyPicker.hidden) renderCurrencyPicker();
  if (viewSettings.classList.contains("active")) renderSettings();
  if (currentTable) setTableStatus(currentTable, { failed: lastRefreshFailed });
}

function applyExternalConfig(raw) {
  const next = normalizeConfig(raw);
  if (JSON.stringify(next) === JSON.stringify(config)) return;
  const languageChanged = next.language !== config.language;
  config = next;
  showIconsEl.checked = config.showIcons;
  ensureBaseAndTarget();
  if (languageChanged) {
    applyLanguage();
    return;
  }
  languageEl.value = config.language;
  launchModeEl.value = config.launchMode;
  updateBaseButton();
  syncListStructure();
  renderValues();
  renderFavoritePairs();
  if (!currencyPicker.hidden) renderCurrencyPicker();
  if (viewSettings.classList.contains("active")) renderSettings();
}

function applyExternalCache(raw) {
  const next = sanitizeCachedTable(raw);
  if (!next || (currentTable && next.savedAt <= currentTable.savedAt)) return;
  currentTable = next;
  lastRefreshFailed = false;
  renderValues();
  if (!currencyPicker.hidden) renderCurrencyPicker();
  setTableStatus(currentTable);
}

function applyExternalHistory(raw) {
  const next = normalizeHistory(raw);
  if (JSON.stringify(next) === JSON.stringify(history)) return;
  history = next;
  renderHistory();
}

tabConverter.addEventListener("click", () => setActiveTool("converter"));
tabCalculator.addEventListener("click", () => setActiveTool("calculator"));

calculatorGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".calc-btn");
  if (!button) return;
  if (button.dataset.token) handleCalculatorToken(button.dataset.token);
  else if (button.dataset.action) handleCalculatorAction(button.dataset.action);
});

currencyPickerClose.addEventListener("click", closeCurrencyPicker);
currencyPicker.addEventListener("click", (event) => {
  if (event.target === currencyPicker) closeCurrencyPicker();
});
currencyPickerSearch.addEventListener("input", () => {
  pickerIndex = 0;
  renderCurrencyPicker();
});

btnSettings.addEventListener("click", () => {
  setActiveView(viewSettings);
  renderSettings();
});

btnBack.addEventListener("click", () => setActiveTool("converter"));

btnHistory.addEventListener("click", () => {
  setActiveView(viewHistory);
  renderHistory();
});

btnHistoryBack.addEventListener("click", () => setActiveTool("converter"));

btnClearHistory.addEventListener("click", () => {
  if (history.items.length === 0 || !globalThis.confirm(i18n.t("clearHistoryConfirm"))) return;
  history = normalizeHistory(null);
  renderHistory();
  void persistHistory();
});

showIconsEl.addEventListener("change", () => {
  config.showIcons = showIconsEl.checked;
  void persistConfig();
  renderSettings();
  renderValues();
});

languageEl.addEventListener("change", () => {
  config.language = languageEl.value;
  void persistConfig();
  applyLanguage();
});

launchModeEl.addEventListener("change", () => {
  config.launchMode = launchModeEl.value === "sidebar" ? "sidebar" : "popup";
  void persistConfig();
});

btnClearShortcuts.addEventListener("click", () => {
  void clearAllShortcuts();
});

amountEl.addEventListener("input", renderValues);
baseEl.addEventListener("click", () => openCurrencyPicker());
targetEl.addEventListener("click", () => openCurrencyPicker("target"));
swapButton.addEventListener("click", () => swapTo(config.swapTarget));
btnFavoritePair.addEventListener("click", toggleFavoritePair);

searchEl.addEventListener("input", () => {
  searchQuery = searchEl.value;
  clearSearchButton.hidden = !searchQuery;
  renderValues();
});

clearSearchButton.addEventListener("click", () => {
  searchEl.value = "";
  searchQuery = "";
  clearSearchButton.hidden = true;
  searchEl.focus();
  renderValues();
});

btnRetry.addEventListener("click", () => void refreshRates({ force: true }));

window.addEventListener("online", () => {
  if (lastRefreshFailed || shouldRevalidate(currentTable)) void refreshRates({ force: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && shouldRevalidate(currentTable)) {
    void refreshRates();
  }
});

document.addEventListener("keydown", (event) => {
  if (handlePickerKeydown(event)) return;

  if (handleCalculatorKeyboard(event)) return;

  if (event.key === "Escape") {
    if (viewHistory.classList.contains("active") || viewSettings.classList.contains("active")) {
      setActiveTool("converter");
    } else if (searchQuery) {
      searchEl.value = "";
      searchQuery = "";
      clearSearchButton.hidden = true;
      renderValues();
    }
  }
});

subscribeStorage((changes) => {
  if (changes?.[CONFIG_KEY]?.newValue) applyExternalConfig(changes[CONFIG_KEY].newValue);
  if (changes?.[RATES_CACHE_KEY]?.newValue) applyExternalCache(changes[RATES_CACHE_KEY].newValue);
  if (changes?.[HISTORY_KEY]?.newValue) applyExternalHistory(changes[HISTORY_KEY].newValue);
});

extensionApi?.runtime?.onMessage?.addListener((message) => {
  if (message?.type !== RUN_COMMAND_MESSAGE) return undefined;
  if (SHORTCUT_ACTIONS.some(({ id }) => id === message.command)) {
    if (config) executeShortcutAction(message.command);
    else pendingBackgroundCommand = message.command;
  }
  return Promise.resolve({ handled: true });
});

async function initialize() {
  const [loadedConfig, cachedTable, loadedHistory] = await Promise.all([
    loadConfig(),
    loadRatesCache(),
    loadHistory()
  ]);
  config = loadedConfig;
  currentTable = cachedTable;
  history = loadedHistory;
  showIconsEl.checked = config.showIcons;
  languageEl.value = config.language;
  ensureBaseAndTarget();
  applyLanguage();
  setActiveTool("converter");
  renderSettings();
  await syncBrowserShortcuts();

  if (pendingBackgroundCommand) {
    executeShortcutAction(pendingBackgroundCommand);
    pendingBackgroundCommand = null;
  }
  try {
    const response = await extensionApi?.runtime?.sendMessage?.({ type: SURFACE_READY_MESSAGE });
    if (response?.command) executeShortcutAction(response.command);
  } catch {
    // The app can also run without a background context during local preview.
  }

  if (currentTable) {
    setTableStatus(currentTable, { updating: shouldRevalidate(currentTable) });
    if (shouldRevalidate(currentTable)) void refreshRates();
  } else {
    await refreshRates({ force: true });
  }
}

void initialize();
