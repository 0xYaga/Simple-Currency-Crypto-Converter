import { convertValue, formatValue, matchesCurrencySearch, valueForClipboard } from "./converter.js";

// DOM-only list view. Rows use sibling native buttons so selection, favorites,
// and copying remain keyboard-accessible without nested interactive controls.
export function createCurrencyIcon(currency) {
  const icon = document.createElement("span");
  icon.className = `currency-icon ${currency.type}`;
  if (currency.type === "crypto") {
    icon.classList.add(`currency-${currency.id}`);
    const image = document.createElement("img");
    image.className = "currency-icon-image";
    image.setAttribute("src", `icons/crypto/${currency.id}.svg`);
    image.setAttribute("alt", "");
    icon.append(image);
  } else {
    icon.textContent = currency.flag;
  }
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function createCopyIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z");
  svg.appendChild(path);
  return svg;
}

export function setCopyState(button, state, i18n) {
  button.classList.remove("success", "error");
  button.replaceChildren();
  if (state === "success") {
    button.classList.add("success");
    button.textContent = "✓";
    button.setAttribute("aria-label", i18n.t("copied"));
  } else if (state === "error") {
    button.classList.add("error");
    button.textContent = "!";
    button.setAttribute("aria-label", i18n.t("copyFailed"));
  } else {
    button.appendChild(createCopyIcon());
    button.setAttribute("aria-label", i18n.t("copyValue"));
  }
}

export class CurrencyListView {
  constructor(listElement, { onSelect, onFavorite, onCopy, i18n }) {
    this.listElement = listElement;
    this.onSelect = onSelect;
    this.onFavorite = onFavorite;
    this.onCopy = onCopy;
    this.i18n = i18n;
    this.rows = new Map();
    this.currencies = [];
    this.emptyMessage = document.createElement("div");
    this.emptyMessage.className = "message";
    this.emptyMessage.hidden = true;
  }

  setI18n(i18n) {
    this.i18n = i18n;
    for (const record of this.rows.values()) setCopyState(record.copyButton, "idle", i18n);
  }

  createRow(currency) {
    const row = document.createElement("div");
    row.className = "row";

    const favoriteButton = document.createElement("button");
    favoriteButton.className = "favorite-btn";
    favoriteButton.type = "button";

    const icon = createCurrencyIcon(currency);
    const code = document.createElement("span");
    code.className = "code-text";
    code.textContent = currency.id.toUpperCase();

    const rowInfo = document.createElement("div");
    rowInfo.className = "row-info";
    rowInfo.append(icon, code);

    const value = document.createElement("span");
    value.className = "value";

    const selectButton = document.createElement("button");
    selectButton.className = "row-select";
    selectButton.type = "button";

    const copyButton = document.createElement("button");
    copyButton.className = "copy-btn";
    copyButton.type = "button";
    setCopyState(copyButton, "idle", this.i18n);

    const valueBlock = document.createElement("div");
    valueBlock.className = "value-block";
    valueBlock.append(value);
    selectButton.append(rowInfo, valueBlock);
    row.append(favoriteButton, selectButton, copyButton);

    selectButton.addEventListener("click", () => this.onSelect(currency.id));

    favoriteButton.addEventListener("click", () => this.onFavorite(currency.id));

    copyButton.addEventListener("click", async () => {
      const rawValue = copyButton.dataset.value || "";
      const converted = Number(copyButton.dataset.number);
      const copied = rawValue
        ? await this.onCopy({ text: rawValue, currencyId: currency.id, converted })
        : false;
      setCopyState(copyButton, copied ? "success" : "error", this.i18n);
      setTimeout(() => setCopyState(copyButton, "idle", this.i18n), 900);
    });

    return { row, selectButton, icon, favoriteButton, value, copyButton, currency };
  }

  syncStructure(currencies, favoriteIds) {
    this.currencies = [...currencies];
    const desiredIds = new Set(currencies.map((currency) => currency.id));
    for (const [id, record] of this.rows) {
      if (!desiredIds.has(id)) {
        record.row.remove();
        this.rows.delete(id);
      }
    }

    for (const currency of currencies) {
      if (!this.rows.has(currency.id)) this.rows.set(currency.id, this.createRow(currency));
    }

    const favoriteSet = new Set(favoriteIds);
    const position = new Map(currencies.map((currency, index) => [currency.id, index]));
    const ordered = [...currencies].sort((a, b) => {
      const favoriteDelta = Number(favoriteSet.has(b.id)) - Number(favoriteSet.has(a.id));
      return favoriteDelta || position.get(a.id) - position.get(b.id);
    });

    const fragment = document.createDocumentFragment();
    for (const currency of ordered) fragment.appendChild(this.rows.get(currency.id).row);
    fragment.appendChild(this.emptyMessage);
    this.listElement.replaceChildren(fragment);
  }

  update({ amount, base, target, table, showIcons, searchQuery, favoriteIds, blockedIds = [] }) {
    this.emptyMessage.className = "message";
    this.emptyMessage.textContent = this.i18n.t("noResults");
    const favoriteSet = new Set(favoriteIds);
    const blockedSet = new Set(blockedIds);
    const baseBlocked = blockedSet.has(base);
    let shown = 0;

    for (const currency of this.currencies) {
      const record = this.rows.get(currency.id);
      if (!record) continue;
      const converted = convertValue(amount, table, base, currency.id);
      const localizedName = this.i18n.currencyName(currency);
      const blocked = baseBlocked || blockedSet.has(currency.id);
      const shouldShow = currency.id !== base
        && matchesCurrencySearch(currency, searchQuery, localizedName)
        && (blocked || Number.isFinite(converted));

      record.row.hidden = !shouldShow;
      if (!shouldShow) continue;
      shown += 1;

      const isFavorite = favoriteSet.has(currency.id);
      record.icon.hidden = !showIcons;
      record.row.classList.toggle("rate-blocked", blocked);
      record.row.classList.toggle("selected-target", currency.id === target);
      record.selectButton.disabled = blocked;
      record.value.textContent = blocked
        ? this.i18n.t("rateBlocked")
        : formatValue(converted, currency, this.i18n.locale);
      record.value.title = blocked ? this.i18n.t("blockedRateAction") : valueForClipboard(converted);
      record.copyButton.hidden = blocked;
      record.copyButton.dataset.value = blocked ? "" : valueForClipboard(converted);
      record.copyButton.dataset.number = blocked ? "" : String(converted);
      record.favoriteButton.textContent = isFavorite ? "★" : "☆";
      record.favoriteButton.classList.toggle("active", isFavorite);
      record.favoriteButton.title = this.i18n.t(isFavorite ? "removeFavorite" : "addFavorite");
      record.favoriteButton.setAttribute(
        "aria-label",
        this.i18n.t(isFavorite ? "removeFavoriteAria" : "addFavoriteAria", { name: localizedName })
      );
      const selectTargetLabel = this.i18n.t("selectTargetAria", { to: currency.id.toUpperCase() });
      record.selectButton.setAttribute("aria-label", selectTargetLabel);
      record.selectButton.title = selectTargetLabel;
    }

    this.emptyMessage.hidden = shown > 0;
    this.listElement.setAttribute("aria-busy", "false");
  }

  showMessage(text, type = "") {
    for (const record of this.rows.values()) record.row.hidden = true;
    this.emptyMessage.className = `message ${type}`.trim();
    this.emptyMessage.textContent = text;
    this.emptyMessage.hidden = false;
    this.listElement.setAttribute("aria-busy", type === "loading" ? "true" : "false");
  }
}
