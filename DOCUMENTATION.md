# Mini Crypto & Fiat Converter — Technical Documentation

## Purpose and scope

Mini Crypto & Fiat Converter is a local-first Firefox extension for converting fiat currencies, cryptocurrencies, and tokens. It also includes a standard calculator, local conversion history, favorite currencies and pairs, offline cache handling, and a Firefox sidebar mode.

The extension is an informational converter, not a trading or payment product. A displayed rate is only usable when it passes the validation and source-consensus policy described below.

## Requirements

- Firefox 140 or later.
- Node.js 20 or later and PowerShell to run the verification and packaging commands.
- No API keys, accounts, cloud synchronization, analytics, or remote code are required.

## Project map

| Path | Responsibility |
| --- | --- |
| `manifest.json` | Firefox MV3 declaration, least-privilege permissions, fixed allowed hosts, toolbar action, sidebar, and background script. |
| `background.js` | Firefox MV3 background script that restores the saved launch mode, handles toolbar clicks, and routes registered browser-wide shortcut commands. |
| `app.js` | Shared controller used by `popup.html` and `sidebar.html`; coordinates state, views, interaction, and persistence. |
| `modules/catalog.js` | Canonical currency catalog, stable lowercase IDs, defaults, and search aliases. |
| `modules/rates.js` | Fetching, input validation, normalized USD tables, consensus policy, cache sanitation, and freshness checks. |
| `modules/storage.js` | Versioned local storage and migrations for configuration, cache, and history. |
| `modules/converter.js` | Localized number parsing, conversion, formatting, and search ranking. |
| `modules/calculator.js` | Bounded arithmetic parser; it never evaluates expressions as JavaScript. |
| `modules/shortcuts.js` | Normalizes portable opt-in bindings and matches Ctrl/Cmd keyboard events without hard-coded action keys. |
| `modules/history.js` | Local-only, capped, deduplicated conversion history. |
| `modules/ui.js` | Accessible DOM construction for currency rows and copy actions. |
| `popup.html`, `sidebar.html`, `popup.css` | Popup/sidebar shells and shared visual design. |
| `tests/` | Node test suite for calculator, conversion, storage migrations, manifest scope, rate policy, UI structure, and launch mode. |
| `scripts/` | Syntax check and deterministic XPI build/verification scripts. |

## Runtime architecture

```text
Firefox toolbar action
        |
        v
background.js ---- saved launchMode ----> popup.html or sidebar.html
                                             |
                                             v
                                           app.js
             +---------------+---------------+---------------+
             |               |               |               |
             v               v               v               v
         rates.js        storage.js      ui.js        calculator.js
             |
             v
 Coinbase + Fawaz Currency API + CoinGecko
```

`popup.html` and `sidebar.html` load the same `app.js`. They therefore share conversion behavior, settings, favorites, history, source status, language, and cache. The only layout difference is the body mode class used by `popup.css`.

### Startup sequence

1. The Firefox MV3 background script reads the saved `launchMode` and configures the toolbar action.
2. The visible surface loads configuration, rate cache, and history in parallel.
3. A valid cache is rendered immediately.
4. A cache older than 15 minutes, or written by an older source-policy version, is refreshed in the background.
5. Updated settings and cached rates are propagated between the popup and sidebar through `browser.storage.onChanged`.

## Conversion model

Every usable table uses USD as its anchor. A rate is stored as **units of a currency per one USD**:

```text
converted amount = input amount × target rate / base rate
```

For example, if `eur = 0.90` and `btc = 0.00002`, the table says that one USD equals 0.90 EUR and 0.00002 BTC. Changing base or target currencies performs no network request.

Input parsing recognizes decimal and grouping separators using the active locale. Formatting uses `Intl.NumberFormat`; crypto values retain more precision than fiat values. The calculator has a separate token parser and is not connected to the rate engine.

## Rate sources and consensus policy

### Sources

| Source | Role | Date handling |
| --- | --- | --- |
| Coinbase | Primary current USD table for fiat and crypto. | No publication date is fabricated. The extension only records when the response was received. |
| Fawaz Currency API | Independent full-table verifier and fallback. The same data may be fetched through jsDelivr or Cloudflare for availability, but these mirrors still count as one Fawaz source. | Its published date is used only after strict validation. |
| CoinGecko | Independent crypto-only verifier. It returns USD per coin, which is inverted into the extension's normalized table. | No publication date is fabricated. |

All requests are fixed HTTPS GET requests with a seven-second timeout, no credentials, no referrer, and a 1.5 MB maximum response size. The requested URL contains no amount, selected currency, search query, history, or account data.

### Validation

Before use, every source response must be valid JSON, satisfy the response-size limit, contain positive finite values, and include the required known currencies for its role. A Fawaz date must be an ISO date, must not be far in the future, and must not be older than fourteen days.

### Comparison rule

When two or more quotes exist for one currency, the extension accepts a rate only if at least two independent sources agree within the relevant tolerance:

| Category | Maximum relative difference |
| --- | ---: |
| Fiat currency | 1.5% |
| Stablecoins: USDT, USDC, DAI | 1% |
| Other cryptocurrencies and tokens | 10% |

For crypto, a three-source response therefore uses a two-of-three consensus. If Coinbase is an outlier while Fawaz and CoinGecko agree, the matching verifier quote is used. If no pair agrees, the diagnostic quote remains in the cache but the currency ID is placed in `blockedIds`; it cannot be selected, copied, or used as a base or target until a later refresh confirms it.

If only one full source is reachable, the extension remains usable with an explicit single-source status. CoinGecko never becomes the sole whole-table fallback because it intentionally covers crypto only.

## Persistent local data

Everything below is stored with `browser.storage.local` and never synchronized or transmitted by the extension.

| Key | Schema | Contents |
| --- | ---: | --- |
| `converter_config_v10` | 10 | Currency visibility/order, base and swap target, favorite currency IDs, up to 12 favorite directed pairs, icon preference, launch mode, optional custom shortcuts, and language. |
| `converter_rates_table_v7` | 7 | Sanitized USD table, source names, source date when verified, comparison metadata, blocked IDs, and cache timestamp. |
| `converter_history_v1` | 1 | Up to 30 local conversion records. Consecutive near-identical entries within 30 seconds are coalesced. |

Older configuration and cache keys are migrated on first read and then removed on a best-effort basis. A pre-policy cache can be displayed immediately, but its older `policyVersion` triggers a background refresh before it is trusted as current data.

## Firefox launch mode

The setting **Open extension in** has two persisted values:

- `popup`: the browser action retains `popup.html` as its toolbar popup.
- `sidebar`: `background.js` sets the action popup to an empty value. Firefox then dispatches the toolbar click to `action.onClicked`, and the handler opens `sidebar.html` through `sidebarAction.open()` while the click is still a user gesture.

Firefox currently runs this code as an MV3 background script/event page through `background.scripts`, not `background.service_worker`. This design avoids an invalid `sidebarAction` permission. The sidebar is declared through the `sidebar_action` manifest key; no broad tab, history, or host permissions are needed for launch-mode switching.

## UI and accessibility

- Currency rows use three sibling native buttons: favorite, select-target, and copy. They are not nested inside a clickable row. Selecting a row only changes the target, never the input amount or conversion history; the dedicated swap control is the only action that exchanges the pair and preserves an equivalent amount.
- The current pair has a dedicated primary-result card. Its result-currency button opens the target picker, and the selected target remains visibly marked in the rate list.
- Rate status is a polite live region. It gives assistive technology the complete rate-source diagnostic even when the compact visual status uses a short summary.
- The five application shortcuts are declared as Firefox `commands` with no suggested keys, so all are disabled by default. A user can assign one `Ctrl/Cmd` binding per action in Settings: converter, calculator, quick currency picker, swap, or search. `Esc`, `Backspace`, and `Delete` clear a focused binding; duplicate bindings are reassigned instead of triggering two actions. The background script applies the saved binding with `commands.update()` and receives the command browser-wide. It opens the selected popup/sidebar surface only when needed, then routes the action to that surface. Firefox rejects reserved combinations and combinations already used by another add-on.
- The color toggle controls local fiat flags and crypto badges. Crypto badges are local text-and-CSS marks, not remotely loaded brand images.
- The toolbar, sidebar, and add-ons-manager icon use one packaged SVG with a tight viewBox and prominent swap arrows. Firefox scales it to the appropriate surface and display density.
- Favorite pairs are directional, such as `RUB → USDT`. Choosing one changes the base and target without converting the entered amount.
- Popup and sidebar share the same controls and storage state.

## Privacy and security boundaries

The extension declares only these permissions:

- `storage` for local settings, cache, and history.
- `clipboardWrite` for the explicit copy buttons.

It does not request browsing history, tabs, identity, downloads, notifications, native messaging, broad host access, or arbitrary web requests. The Content Security Policy permits scripts only from the packaged extension. There are no API keys, remote scripts, `eval`, `new Function`, or network-derived HTML insertion paths.

The calculator parses its own grammar. Rate payloads are parsed as JSON, validated, and inserted into the UI through DOM APIs and text content rather than HTML strings.

## Development and release workflow

Run the complete local gate before every release:

```powershell
npm run verify
```

It performs these steps:

1. Checks JavaScript syntax for every `.js` and `.mjs` source or test file outside `dist/` and `node_modules/`.
2. Runs the Node test suite.
3. Builds `dist/converter-v<manifest version>.xpi` from an explicit allowlist.
4. Reopens the XPI and verifies its exact file set and SHA-256 content against the approved source files.

Development-only files, test files, package metadata, and build tooling are deliberately excluded from the XPI. If a packaged source file is added, update both `scripts/build-xpi.ps1` and `scripts/verify-xpi.ps1` together.

## Manual Firefox smoke test

1. Open `about:debugging#/runtime/this-firefox` in Firefox Developer Edition.
2. Load `manifest.json` temporarily or select the generated XPI.
3. Confirm that the extension details show no permission warning for `sidebarAction`.
4. In Settings, select **Open extension in → Sidebar**, close the current surface, and click the toolbar icon. The sidebar should open.
5. Change the setting back to **Toolbar popup**, close the sidebar, and click the toolbar icon. The popup should open.
6. Select a different row and confirm that the target/result changes while the base and entered amount stay unchanged. Then use the dedicated swap button and confirm that it is the action that changes the pair and preserves an equivalent amount.
7. Add a favorite pair, reload the extension, and confirm that it remains available.
8. Confirm that crypto badges are visible by default and can still be disabled in Settings.
9. In Settings, confirm that every shortcut reads **Not set**. Assign `Ctrl/Cmd + Shift + K` to Search, close the extension, press the combination in Firefox, and confirm the chosen popup/sidebar opens with the search field focused. Reload and confirm it remains assigned. Clear it with `Esc` while its field is focused.

## Known limitations

- Quotes are indicative and should not be used as a trading, settlement, tax, or accounting authority.
- Source availability and rate limits are external dependencies. A single-source fallback is visibly marked, while a disagreement blocks the affected currency instead of guessing.
- CoinGecko validates crypto only; it is intentionally not used to fabricate a full fiat table.
- The extension does not schedule background rate polling. Rates refresh while a popup or sidebar is visible and according to cache freshness rules.
