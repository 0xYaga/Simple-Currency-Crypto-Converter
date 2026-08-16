# Mini Crypto & Fiat Converter 1.0.0

[Русская версия](README.ru.md)

A minimalist currency and cryptocurrency converter with a standard calculator for Firefox and compatible browsers.

Detailed technical documentation: [DOCUMENTATION.md](DOCUMENTATION.md).

## What is included in 1.0.0

- The current pair and converted total have a dedicated result area above the rate list. Click the result code to choose the target currency.
- Clicking a row in the list only selects the target currency; it does not change the entered amount, base currency, or history. The swap button remains the only action that exchanges the currencies while preserving the equivalent value.
- The selected target currency is highlighted, and an empty favorite-pairs area explains how to pin the current pair.
- Interactive controls have larger targets, secondary text has better contrast, and status, history, search, and settings views are easier to read. Shortcut settings no longer truncate action names in a narrow popup.
- The History and Favorite pairs landmarks are localized for screen readers; rate-source discrepancies are available to them through the rate-status message.

## Customizable keyboard shortcuts

- Shortcuts are fully configurable in Settings and are disabled by default. For each action, click the field and press `Ctrl/Cmd` plus a supported key. `Esc`, `Backspace`, or `Delete` clear an individual shortcut; **Clear all** resets all five. A shortcut cannot be assigned to more than one action.
- The former fixed `Ctrl/Cmd + 1`, `Ctrl/Cmd + 2`, `Ctrl/Cmd + K`, `Ctrl/Cmd + Shift + X`, and `/` shortcuts were removed, so they do not interfere with normal use unless the user enables a shortcut.
- The extension-button icon is a crisp, scalable SVG with larger exchange arrows. Firefox scales it for the toolbar, menus, and high-density screens.
- Settings migrate to schema v10. Existing settings are retained, while shortcuts start disabled for existing installations as well.

## Firefox compatibility

- Temporary loading in Firefox Developer Edition is supported: the background process uses Firefox MV3 `background.scripts` rather than unsupported `background.service_worker`.

## Launch mode

- Settings include a persistent choice of launch surface: a popup or the Firefox sidebar. Clicking the extension icon always opens the selected mode, including after a browser restart.
- A background handler changes the Firefox action mode without an extra permission and opens the sidebar directly from the user click.
- Settings migrate to schema v9; saved pairs, language, icon visibility, and other options are preserved.

## Crypto validation and favorite pairs

- Firefox Developer Edition no longer receives a warning for requesting the nonexistent `sidebarAction` permission. The sidebar is still declared through `sidebar_action` and works without an unnecessary permission.
- CoinGecko is used as an independent crypto validation source. When all three sources are available and Coinbase is an outlier, the matching validation pair is used. If no pair matches within the allowed range, conversion of that cryptocurrency is blocked.
- Favorite directed pairs are supported. Click the star under the amount to pin the current pair, for example `RUB → USDT`; clicking a saved pair selects it without converting the amount.
- Cryptocurrency icons are enabled by default. They use distinctive local color SVG badges and never load external images. They can still be disabled in Settings.
- Settings migrate to schema v8 and the cache to v7. The previous cache is displayed immediately, then revalidated in the background under the new policy.

## Rate-source validation and accessibility

- Rates are compared between two independent tables: Coinbase is the main live source, while Fawaz Exchange API validates rates and fills gaps for missing currencies.
- If sources differ beyond the allowed threshold, the extension blocks conversion of affected currencies until the next successful validation, displays a warning, and lists affected codes in a tooltip.
- Validation thresholds are 1.5% for fiat currencies, 1% for stablecoins, and 10% for other cryptocurrencies.
- With Coinbase alone, the extension displays the response time instead of inventing a rate publication date; when validated, it uses the confirmed Fawaz date.
- Independent checks cover the rate policy, migrations, calculator, and XPI build without external dependencies.
- Currency rows use separate native controls for selecting, favoriting, and copying. There are no nested interactive elements, so screen readers and keyboards work correctly.
- If one source is unavailable, the extension continues using the other and clearly reports that condition.
- Quickly choose the base currency by clicking its code.
- Search recognizes codes, localized names, and alternative queries such as `ruble`, `RUB`, `yuan`, `lira`, `bitcoin`, `ether`, and `ton`.
- TON appears in quick selection automatically when at least one source returns a valid rate.
- Shortcuts are available for tabs, quick currency selection, currency swapping, and search.
- A dedicated standard-calculator tab supports keyboard input, parentheses, percentages, square roots, squaring, sign changes, and safe expression parsing without `eval`.
- Settings migrate to schema v7 and the cache to v6; old data migrates automatically without a false Coinbase timestamp.

## Keyboard shortcuts

- All five shortcuts are disabled by default. They can be assigned to the converter, calculator, quick currency selection, currency swap, and search.
- Click a shortcut field and hold `Ctrl` (Windows/Linux) or `Cmd` (macOS) with the desired key. This avoids intercepting normal text, numbers, and calculator input.
- Once assigned, shortcuts work throughout Firefox: the extension opens the chosen launch mode and performs the action. Firefox will not let you assign a combination already used by the browser or another add-on.
- The calculator supports digits, `+`, `-`, `*`, `/`, parentheses, `%`, `Enter`, `Backspace`, `Delete`, and `Esc`.

## Main features

- More than 100 fiat currencies, cryptocurrencies, and tokens.
- One rate table relative to USD: changing the base currency or amount does not create additional network requests.
- Stale-while-revalidate: saved rates are shown immediately and stale cache updates in the background.
- Smart offline mode with cache age and stale-data warnings.
- Local history of the last 30 conversions.
- Russian, English, German, and Simplified Chinese interface languages.
- Search by currency code, name, and alternative names.
- Favorite currencies are pinned at the top.
- The target currency is selected separately; the swap button exchanges the current pair while preserving the equivalent amount.
- Numbers update without recreating the entire list on every keystroke.
- Code is split into local ES modules.
- Settings, history, and cache include versioning and automatic migrations.
- Every API response is validated for type, size, date, and numeric values.

## Privacy and security

The extension does not collect analytics, browsing history, entered amounts, search queries, calculator expressions, or settings. Conversion history, settings, and cache are stored only locally through `browser.storage.local`.

To retrieve rates, the extension makes only fixed HTTPS requests to four allowed hosts:

- `api.coinbase.com`;
- `api.coingecko.com` — USD crypto quotes only, for independent validation;
- `cdn.jsdelivr.net`;
- `latest.currency-api.pages.dev`.

URLs never include the entered amount, selected currency, search text, history, or other user data. There are no API keys, remote scripts, `eval`, `new Function`, `innerHTML` with network data, or remotely loaded executable code.

## Installation for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Choose `manifest.json` from the unpacked folder or a built `.xpi` file.

The minimum Firefox version is 140 because the extension declares that it does not collect data.

## Pre-release verification

Node.js 20+ and PowerShell are required. Run `npm run verify` to check syntax, run tests, build the XPI in `dist/`, and compare every archive file against the approved source set. Tests, scripts, `package.json`, and other development tools are excluded from the package.
