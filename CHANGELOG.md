# Changelog

All notable changes to **Image Harvest** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### 🧪 Test Coverage Expansion

No production code changed in this entry — purely additive test hardening.

#### Added — Unit Tests (Vitest)

Final coverage push closes the last high-ROI gaps in the unit test suite. Total now stands at **35 test files / 847 cases** (all green) + tsc + eslint clean.

- `tests/sidepanel-init.test.tsx` (**NEW**, 11 cases) — the 1115-line `sidepanel/init.ts` IIFE has zero exports, so every function is private. Strategy: mock 14 sidepanel/\* + shared/\* dependencies, then drive the module via dynamic import + `DOMContentLoaded` dispatch and assert mock call orchestration. Pins: init() chain order (mountPreact → loadSettings → applyTheme/Density → bindEvents → applyProFeatureVisibility → initResizeObserver → showLoading → port connect), `chrome.runtime.connect({ name: 'image-snatcher-ui' })` long-lived port contract, `handleMessage` wired as the broadcast handler, `isPopupMode` detection (sidepanel.html ↔ popup.html decides whether tab listeners register), `__IH_E2E__` test hook production-safety guard + the 5 hook exposures (`store` / `applyFilters` / `loadMultitab` / `applyTheme` / `handleMessage`), `beforeunload` highlight cleanup + `SIDE_PANEL_CLOSED` notify-on-close (sidepanel mode only).
- `tests/pages-popup.test.tsx` (**NEW**, 15 cases) — pins the 111-line popup-mode bootstrap. `setupPopupMode` IIFE (popup-mode class on html+body / popup.css link injection / sidepanel.html early-return guard / `{once: true}` DOMContentLoaded body fallback). `DOMContentLoaded` listener (MutationObserver with pinned `{childList, subtree, attributes, attributeFilter: ['class','style']}` options / missing-#app early return / 3 setTimeout fallbacks at exact 200/600/1500 ms / window resize listener). `adjustImageGridHeight` driven via captured MutationObserver callback (style writes on visible grid / skip when `grid.hidden` / arithmetic verification with explicit `offsetHeight` stubs / 4-class skip predicates `.hidden` / `.modal` / `.toast-container` / `position: fixed|absolute` via stubbed `getComputedStyle` / `clientHeight=0` → 600-px default popup height fallback). jsdom CSS-shorthand serialization quirks worked around: `flex:none → '0 0 auto'`, `'0' → '0px'`.
- `tests/sidepanel-settings.test.tsx` (**+5 cases**) — `toggleFilterDropdown` simplified paths (non-existent dropdown id → no-op / hidden→visible open path / visible→hidden close path / mutual exclusion — opening one closes others / `color` filter type → `renderColorSwatches` dynamic prep). Layout-positioning branches (`wouldOverflowRight` / `wouldOverflowLeft`) are deliberately deferred to e2e — jsdom does not compute `getBoundingClientRect()` or `offsetWidth`.

#### Added — Unit Tests (Canvas/Image algorithmic paths)

Turns the prior "surface-area coverage" into real quality insurance for the three algorithmic files that were sitting at 11% / 18% / 37% line coverage despite having named test files. The gap was uniform: every existing test file had pinned the pure helpers (rgbToHex, hammingDistance, canConvert, getMimeType) but none covered the async + Image + Canvas main loops where the actual algorithms live.

Strategy: new `.test.tsx` files under jsdom, with test-scoped stubs for `globalThis.Image` (synchronous onload via `queueMicrotask`) + `HTMLCanvasElement.prototype.{getContext, toDataURL, toBlob}` + `URL.createObjectURL` / `revokeObjectURL`. Controlled RGBA bytes fed through `getImageData` make every internal branch reachable — **no `@napi-rs/canvas` dependency needed**.

- `tests/color-extract-image.test.tsx` (**NEW**, 11 cases) — 5 happy path (solid red → single hex, two-tone bounded by `colorCount`, `colorCount` param respected, data: URL skips `crossOrigin`, alias `extractColorsFromUrl === extractColors`) + 4 failure (Image onerror → `[]`, null context → `[]`, all pixels `a<128` → `[]` pinning the alpha guard, exception in onload try/catch → `[]` pinning the Promise-never-rejects contract) + 2 `sortByHue` indirect (chromatic+achromatic split reachable via mixed palette, single-color `hexColors<=1` early-return pinned).
- `tests/phash-image.test.tsx` (**NEW**, 9 cases) — 6 happy path (DC bit is always `'0'` pinning the `i===0` explicit `'0'` write, determinism, visually identical → hamming=0, different patterns → hamming>0 pinning dedup semantics, 64-char `[01]` regex, data: URL skips `crossOrigin`) + 3 failure (Image onerror / null context / getImageData throws → all resolve to `null`, never reject).
- `tests/converter-image.test.tsx` (**NEW**, 16 cases) — 5 `convertImageFormat` happy (png success, jpg keeps format as `'jpg'` not `'jpeg'` pinning — downstream uses format as file extension, uppercase → lowercased, custom `naturalWidth`/`Height` propagates, quality param threads through to **BOTH** `toDataURL` and `toBlob` pinning — inconsistent quality would silently cause size/quality drift) + 4 inner failure (Image onerror / null context / toBlob null / drawImage throws) + 3 `convertBlobFormat` happy (success, `URL.revokeObjectURL` fires on success no leak, quality threading) + 4 `convertBlobFormat` inner failure (each path MUST revoke the object URL pinning — forgotten revoke leaks memory across batch jobs).

#### Added — Unit Tests (shared/utils remaining branches)

- `tests/utils.test.ts` (**+6 cases**) — closes the last 5 uncovered lines in `shared/utils.ts` to hit 100% line coverage. Added: 3 MIME map leaf pins (`image/heic` / `image/heif` → `'heic'` aliasing / `image/apng` → `'png'` aliasing), 1 MIME map fall-through (unrecognized content-type like `application/octet-stream` must cascade to URL-extension extraction not early-return `'unknown'`), 2 `getFileFormat` catch-branch paths (invalid-URL-with-extension via `foo/bar.png` relative path → loose regex extracts `.png` / invalid-URL-no-extension → `'unknown'`), and 3 `getAspectRatio` threshold pins (portrait upper-bound `ratio=0.9` strictly `square` not `portrait` / portrait lower-bound `ratio=0.4` boundary / panorama lower-bound `ratio=2.501` strictly `panorama`). Any refactor nudging the 0.4 / 0.9 / 1.1 / 2.5 breakpoints would now surface immediately.

#### Changed — Test Infrastructure

- **NEW** `tests/_helpers/chromeApiMock.ts` (155 LoC) — extracted from inline duplicates in `sidepanel-init.test.tsx` + `sidepanel-settings.test.tsx`. Single canonical `installChromeMock(options?)` returns a typed `ChromeMock` struct (`runtime` + `tabs` + `storage` + `commands`). Optional `captureTabListeners` / `capturePortListeners` buckets let init-style tests fire `chrome.tabs.on{Activated,Updated,Removed}` handlers (and `port.onMessage` / `onDisconnect`) manually. Buckets are reset in-place on every install so one `const buckets = { ... }` can be safely shared across a describe via `beforeEach`. Explicitly NOT a replacement for `tests/_helpers/chromeStorageMock.ts` (different purpose — in-memory storage semantics for `shared/storage.ts` + `shared/license.ts` real-semantics tests; this one stubs with plain `vi.fn()` for sidepanel orchestration tests).
- Migrated `tests/sidepanel-init.test.tsx` + `tests/sidepanel-settings.test.tsx` to the shared helper, net **-55 LoC of duplication removed** across the two touched files.
- NOT migrated (intentionally): 7 `background-*` / `content-*` / `sidepanel-actions` test files inline bespoke single-API stubs (e.g. `chrome.tabs.sendMessage` only) whose shapes are too heterogeneous to unify without adding more conditionals than the current code.

#### Added — Unit Tests (sidepanel hotspots)

Follow-up sweep after `vitest.config.ts` `coverage.include` was widened from `shared/**` only to also include `background/** + content/** + sidepanel/** + pages/**`. The new denominator surfaced four low-coverage hotspots in business code that the prior shared-only denominator was hiding. This pass closes three of them; the fourth (`sidepanel/scan.ts`) is explicitly scoped to e2e — see below.

- `tests/sidepanel-filter.test.tsx` (renamed from `.ts` + **+13 cases**) — file renamed so jsdom environment routing (`environmentMatchGlobs: tests/**/*.test.tsx → jsdom`) makes `document` available; adding `vi.mock('../sidepanel/{actions,render,settings,ui}')` so the filter module can `import` its transitive DOM deps without pulling the real init IIFE. New cases pin the custom-size-input sub-module (`clearCustomSizeInputs` / `applyCustomSizeInputs` / `syncCustomSizeInputsFromSettings`, previously 0% covered): empty-input clear (2), apply with trimmed values + invalid-number sanitization + min/max bidirectional swap (7), and roundtrip sync from settings including the `min === 0` / `max === Infinity` sentinel handling (4). A regression forgetting the `Number.isFinite` guard would let `"abc"` leak into `state.filter.customSize.min` and silently filter out every image.
- `tests/sidepanel-ui.test.tsx` (**+16 cases**) — adds 4 describe blocks for the previously-out-of-scope mid-file functions:
  - **`applyViewMode` / `toggleViewMode`** (5 cases) — grid↔list class swap orchestration across `#image-grid` + every `.group-content` (pinned: per-group re-sync is required because collapsed groups are separate DOM subtrees and would render at the wrong width if only the top-level grid was toggled), `btn-view-toggle` title + icon visibility + label text round-trip, missing-DOM no-throw guard, `toggleViewMode` flip through the internal `userViewMode` state machine.
  - **`checkNarrowMode`** (5 cases) — reactive compact/list-mode toggle driven by `elements.imageGrid.clientWidth`. Stubbed via `Object.defineProperty(grid, 'clientWidth', ...)`. Pinned thresholds: wide (≥ 520px available → compact OFF + toggle visible), narrow (< 520px → compact ON + toggle **AND** `.toolbar-right` both hidden + forced list view), medium (can fit 2 cols but each < 310px → compact ON while toggle stays visible), and the `isNarrowMode` state-machine restoring `userViewMode` when widening back (without this, a user forced into list mode at a narrow size would be stuck there forever).
  - **`showConfirmDialog`** (4 cases) — Promise-returning modal contract: open=true + config + resolver stored (pinned: promise is **NOT** pre-resolved — a regression resolving synchronously inside the constructor would fire `.then` before the modal rendered), default `confirmText='Confirm'` / `cancelText='Cancel'` / `type='warning'` when omitted, stack-of-one policy (calling `showConfirmDialog` while one is already open resolves the prior dialog with `false` — rapid back-to-back actions must not leave stale pending promises that resolve with wrong values later), happy-path resolver → awaited promise smoke.
  - **`calcSkeletonCount`** (2 cases, topping up prior coverage) — list-view 1-row clamp, no-`#app` fall-through to defaults.
- `tests/pages-reverse-search.test.tsx` (**NEW**, 18 cases) — pins the 226-line `pages/reverse-search.ts` IIFE (0% → covered). The entire file is a single top-level `(async function () { ... })()` with no exports, so the strategy mirrors `pages-popup.test.tsx` + `sidepanel-init.test.tsx`: `vi.resetModules()` + dynamic `import('../pages/reverse-search')` per scenario, with `chrome.runtime.sendMessage` + `window.location.{search,href}` + `window.close` + `HTMLFormElement.prototype.submit` + a `DataTransfer` class stub all installed in `beforeEach`. Key cases:
  - **4 bootstrap guards** — missing `#status` → silent return (no crash), missing `engine` → "Missing search parameters" error, missing `imageUrl` → same error, close-tab anchor click calls `window.close()`.
  - **3 form-upload engine dispatches** (google / tineye / unknown) — pins the per-engine form-upload contract: google uses `encoded_image` field against `lens.google.com/v3/upload`, tineye uses `image` field against `tineye.com/search` — swapping these would cause silent upload ignores. Pinned: `enctype: multipart/form-data` + `method: post`. Unknown engine after successful fetch → `"Unknown search engine: bing"` error.
  - **5 background-bridge engine dispatches** (yandex / baidu) — REVERSE_SEARCH_UPLOAD round-trip: yandex success with `redirectUrl` → `window.location.href` set (pinned: redirect the tab rather than open a new one, since the intermediate tab becomes the results tab), yandex `{success:false}` → fallback to `yandex.com/images/search` (pinned: `.com` not `.ru` — the public URL-based endpoint), yandex throw → warn-only fallback (never re-throw), baidu success → `window.close()` (background already opened the results tab separately via `scripting.executeScript`), baidu fail → `graph.baidu.com/details` fallback.
  - **4 FETCH_IMAGE_DATA failure paths** — undefined response / `{success:false}` / `{success:true, dataUrl:undefined}` all correctly cascade into `fallbackUrlSearch` for known engines; unknown engine on fallback path → "Fallback search not available" error (not a runtime throw).
  - **2 top-level try/catch** — `sendMessage` rejection → `"Search failed: network down"` user-readable message, non-Error string throw → stringified via `String(error)` (pinning the `error instanceof Error ? .message : String(error)` fallback — legacy `throw "..."` code still renders a readable message).
  - **jsdom quirk worked around**: `HTMLInputElement.files` setter strictly requires a `FileList` instance, and a plain array from a custom `DataTransfer` stub throws `TypeError: Failed to set the 'files' property`. Fix: override `HTMLInputElement.prototype.files` getter/setter via `Object.defineProperty` to accept anything.

#### Added — Unit Tests (Stage-1 "0% file sweep" — 4 lazy-loaded UI modules)

Stage-1 of the 80%+ All-files-Lines push. Target: the four `sidepanel/*-ui.ts` files sitting at exactly **0% coverage** after the prior `coverage.include` widening exposed them. Together they total 971 production LoC of modal rendering, JSZip export pipelines, chrome.tabs favicon fallbacks, and multi-tab IPC orchestration — code that 90%+ of users touch weekly but that had never seen a single unit test. This sweep adds **+4 test files / +131 test cases**, lifts All-files Lines **65.10% → 72.73% (+7.63pp)**, and takes every target to ≥ 90% line coverage (three to 100%).

- `tests/sidepanel-dedup-ui.test.tsx` (**NEW**, 11 cases → 100% Lines) — `sidepanel/dedup-ui.ts` (116 LoC, previously 0%). Covers `showDedupModal` (5 cases: state flip + scrollTop reset / empty-groups empty-state / populated-groups render with 1-based group numbering pinned / click-to-toggle `.selected` event wiring / missing-`#dedup-body` defensive guard) and `removeDuplicates` (6 cases: non-Pro paywall guard pins NO state mutation before toast + Pro modal / empty-groups short-circuit toast / manual-selection precedence over keep-first default / keep-first-remove-rest default-behavior / confirm cancelled → full rollback of `allImages`/`selectedImages` / confirm accepted → `applyFilters` + `detectSimilarImages` + `closeDedupModal` + success toast orchestration). Pinned: manual-selection must override default keep-first — a regression reversing this precedence would delete the user's explicit clicks and keep everything else.

- `tests/sidepanel-license-ui.test.tsx` (**NEW**, 30 cases → 98.89% Lines) — `sidepanel/license-ui.ts` (246 LoC, previously 0%). Describe blocks: `formatDateYMD` (3: ISO / epoch-ms / single-digit zero-padding — a regression dropping `padStart` would leak "2026/5/6" and mis-sort chronologically), `maskLicenseKey` (4: null-safe / short ≤8 boundary / 9-char just-above-boundary / 16-char standard), `updateLicenseUI` (7: pre-mount no-crash / active + yearly + expiresAt → masked key + plan label + formatted expiry / lifetime → "Never expires" bypasses formatDateYMD / monthly + no expiresAt → empty text / unknown plan → raw string fallback via `planLabels[p] || p` / hasLicense=false → inactive section forced visible / sendMessage throws → same catch-block recovery), `activateLicenseFromInput` (6: whitespace-only input → error no sendMessage / success + `closeModalOnSuccess=false` → input cleared no modal close / success + `closeModalOnSuccess=true` → `closeProUpgradeModal` fires / `result.success=false` → error text threaded + input preserved / sendMessage throws → "Network error" fallback + button restored in `finally` / null errorEl no-crash for Pro Upgrade modal path), `bindLicenseKeyFormatter` (3: lowercase → uppercased + non-alphanumeric stripped + dash-every-4 chunking / 16-char cap drops overflow / partial input has no trailing dash), `bindLicenseModalEvents` (7: idempotent guard via module-level `licenseEventsBound` flag — `vi.resetModules()` per test to reset / Enter key triggers activate via `click()` / deactivate confirm cancelled → NO sendMessage / deactivate confirmed → DEACTIVATE_LICENSE message + toast + button restored / deactivate sendMessage throws → error toast + button restored / get-Pro link `preventDefault()` + `chrome.tabs.create(PRICING_PAGE_URL)` / Pro Upgrade modal Enter key parity). Pinned: the `finally`-block button restoration — without it, a thrown exception would leave the activate button stuck on "Activating..." indefinitely.

- `tests/sidepanel-collection-ui.test.tsx` (**NEW**, 25 cases → 100% Lines) — `sidepanel/collection-ui.ts` (257 LoC + JSZip export pipeline, previously 0%). Two describe clusters:
  - **`showCollectionModal` + `loadCollection`** (19 cases) — modal open + search-input oninput with trim / `elements.collectionBody` missing → early return NO getAll / empty + no-query → "No images in collection yet" / empty + query → "No matching images found" variant / search filter matrix (url/sourceTitle/sourceUrl/tags — tags via `.some()` not `.includes()`) / sort by `createdAt` DESC / card info bar (format UPPERCASED / `dims` / `formatBytes`) / format undefined → "UNKNOWN" fallback / 7 event bindings (remove → `removeFromCollection` + main-grid `.btn-favorite` sync + refresh / open → `openInNewTab` / copy success → clipboard + toast / copy failure → error toast NOT silently swallowed / download → `downloadSingle(imgObj, null)` / reverse-search → `showReverseSearchMenu` / img load → `.loaded` class on img + parent / img error → `display:none` + parent `.loaded` to stop skeleton shimmer) / `collectionGetAll` throws → "Failed to load collection" fallback HTML.
  - **`exportCollection`** (6 cases, JSZip-mocked) — empty collection → info toast + NO zip / happy path → per-item `fetch` + `folder.file(filename, blob)` + `zip.generateAsync({type:'blob'})` + `chrome.downloads.download({saveAs:false})` + `URL.revokeObjectURL` cleanup + success toast (pinned: revokeObjectURL MUST fire — forgotten revoke leaks blobs across batch exports) / per-item fetch failure → silently skipped NOT whole-job abort (user not stranded with 0-byte zip when one image is offline) / per-item `!resp.ok` → item skipped (guards against adding HTML error pages as images) / abort via `showProgress` callback before download → NO `chrome.downloads.download` even though some items already in zip folder + `hideProgress` still fires in `finally` / pre-progress `collectionGetAll` throw → error toast + `hideProgress` still fires (non-negotiable finally cleanup).

- `tests/sidepanel-multitab.test.tsx` (**NEW**, 46 cases → 90.45% Lines) — `sidepanel/multitab.ts` (352 LoC, previously 0%). Three describe groups matched to Chrome-API surface:
  - **Group A — pure / DOM-only** (16 cases across `getFallbackFaviconUrl` / `toggleTabCheckboxVisual` / `updateMultitabSelectAllState` / `toggleMultitabSelectAll` / `showMultiTabModal`). Pinned: the `checkedCount === totalCount && totalCount > 0` guard on select-all "all checked" branch — without the `>0` clause, an empty list would render "0 selected" with the check icon (vacuous truth). Also pinned: `toggleMultitabSelectAll` on empty list must NOT be a no-op accidentally triggered via `Array.every` returning true on empty.
  - **Group B — `chrome.tabs.query` + `chrome.scripting.executeScript` + 3-tier favicon fallback chain** (20 cases). `loadTabList` (10): early-return on missing list element / `isRestrictedUrl` filter / active tab floats to position 0 with `.tab-current` class + "Current" badge / missing `favIconUrl` → origin `/favicon.ico` fallback / empty title → "Untitled" / row click (outside checkbox) toggles checkbox + visual + select-all state / click INSIDE `.tab-checkbox` short-circuits via `closest()` guard / native checkbox `change` event triggers visual sync / `chrome.tabs.query` throws → "Failed to load tabs" fallback HTML / favicon `error` event triggers `resolveTabFaviconById` with tabId parsed from `dataset`. `resolveTabFavicons` (5): empty-batch short-circuit / resolve via `<link rel="icon">` via `executeScript` / `executeScript` throws (restricted tab) → Google favicon fallback / script returns null → same Google fallback / `tab.id == null` skipped. `resolveTabFaviconById` (2): resolved URL === previousSrc → skip set and fall through to Google (prevents broken-favicon infinite loop) / different URL → update src no Google call. `tryGoogleFaviconFallback` (3): s2 URL format with `sz=32` + encoded origin / `chrome.tabs.get` throws → `visibility:hidden` (final fallback MUST NEVER crash) / `tab.url` missing → silent early return preserving original src.
  - **Group C — `startMultiTabExtract`** (10 cases, chrome.runtime.sendMessage `MULTI_TAB_EXTRACT` pipeline). Happy path (pins the exact message type + URL-dedupe by `find(url===)` + `generateId` fallback for missing ids + `colors=undefined`/`phash=null` reset sentinels + group-mode pill sync to 'tab' + `state.currentGroupMode` + DOM select value sync + `applyFilters`/`closeMultiTabModal`/success-toast orchestration + `processImageExtras` fired when either enableSimilarDetection OR enableColorExtraction is not false). Dedupe skips existing-url (pre-existing item retained, not clobbered with reset colors/phash). Fallback `tabCount = tabIds.length` when response.tabCount missing. Both detection toggles explicitly `false` → skip `processImageExtras`. ONE toggle true (OR semantics). `response.success=false` → error toast threading `response.error` / NO state mutation / NO applyFilters or closeMultiTabModal / hideProgress still fires in finally. Missing `error` field → "Unknown error" fallback. sendMessage rejection (not aborted) → "Multi-tab extraction failed" toast. Abort via showProgress callback + sendMessage resolves success AFTER abort → state.allImages untouched via `if (aborted) return` guard BEFORE map+push (otherwise a stale response would silently land images in state minutes after the user clicked cancel). Abort + sendMessage throws → NO double "Extraction cancelled" + "Multi-tab extraction failed" toast (the `if (!aborted)` guard on the catch block pins this contradictory-UX scenario).

#### Added — Unit Tests (Stage-2 "low-hanging-fruit sweep" — 5 background/content hotspots)

Stage-2 of the 80%+ All-files-Lines push. Target: five files that cover the **service-worker + content-script boundary** and together gate every scan/extraction the user triggers. Four of them already had partial test files from prior sweeps but were sitting with large uncovered blocks (big switch-case branches, sub-frame handling, inject-with-fallback ladders); one (`background/extractor.ts`) had an entire exported function (`getImagesFromTab` — 122 LoC) with zero test coverage while its sibling `processMultiTabExtract` was already thoroughly pinned. This sweep adds **+47 test cases** across 5 existing files, lifts All-files Lines **72.73% → 75.48% (+2.75pp)** and `background/*` aggregate **77.53% → 90.94% (+13.41pp)**.

- `tests/background-index.test.ts` (**+11 cases**, 42 → 53, `background/index.ts` 77.53% → **94.76%**). Two focal areas:
  - **`SET_DISPLAY_MODE` switch (L194-269, the 76-line largest uncovered block in the router)** — 7 cases covering the popup↔side-panel mode-switch state machine. Switch TO side-panel (4): clears `action.setPopup` to empty string + enables `openPanelOnActionClick` / with `openSidePanel+tabId` opens panel + records tabId in `sidePanelOpenedTabs` bookkeeping / `sidePanel.open` throwing (no user gesture) swallowed and still succeeds / `saveAppSettings` throws → outer try/catch returns `{success:false,error}`. Switch TO popup (3): disables `openPanelOnActionClick` + restores `pages/popup.html` as popup path (pinned: popup-path restore MUST be LAST — between disable-behavior and setPopup, action-click would briefly no-op) / tracked tabs each get `setOptions({tabId,enabled:false})` + bookkeeping cleared / active tab NOT already tracked → ALSO disabled (catches `initDisplayMode` pre-bookkeeping case) / `chrome.tabs.query` throws → swallowed, still succeeds.
  - **4 `catch (error)` branches never previously triggered (L325-326, L340-341, L370-371 area)** — `ACTIVATE_LICENSE` throw → local try/catch returns `{success:false,error}` (no broadcast) / `DEACTIVATE_LICENSE` throw → same shape + NO broadcast (protecting the atomic "broadcast-then-respond" order from partial failure) / `MULTI_TAB_EXTRACT` throw → local try/catch keeps error detail flowing to the sidepanel instead of promoting to the outer `INJECTION_FAILED` code. Pinned: WITHOUT each inner try/catch, storage/license/IPC errors would bubble to the outer `handleMessage` catch and be misreported as `INJECTION_FAILED` — misleading the sidepanel into showing "scripting injection failed" toasts when the real cause is license server / storage quota / tab restrictions.
  - **Infra**: `chrome.sidePanel.setOptions/setPanelBehavior/open` and `chrome.action.setPopup` stubs upgraded from bare `vi.fn()` to `vi.fn(() => Promise.resolve())` so `await` against them no longer hangs the dispatch loop in the `SET_DISPLAY_MODE` cases.

- `tests/background-injector.test.ts` (**+9 cases**, 14 → 23, `background/injector.ts` 65.57% → **100% Lines**). Four new describe blocks attacking the 4 uncovered regions:
  - **Probe-stage deep paths (2)** — probe returns `{result:true}` → already-injected short-circuit waits for ping then returns success WITHOUT calling standard `executeScript({files})` (pinned: re-injecting would duplicate `onMessage` listeners and every user action would fire twice) / probe=true + post-probe PING rejects → swallowed by inner `catch { await sleep(500) }`, authoritative probe result wins (flaky PINGs must not demote a confirmed already-injected state to re-injection).
  - **Probe non-error-page reject fallthrough (1)** — only `"error page"` / `"showing error"` substrings short-circuit; all other probe failures (CSP, timeout, permission revoked) must fall through to `executeScript({files})` where the richer outer-catch matcher classifies them.
  - **`getContentScriptFiles()` manifest fallback (L44-45, 2 cases)** — `manifest.content_scripts = undefined` → falls back to hardcoded `['assets/main.ts-loader.js']` (won't include crxjs hash so injection 404s, but a predictable 404 name is easier to debug than `undefined` files) / empty array → same fallback.
  - **`tabs.get` inner catch (L76, 1 case)** — transient `"No tab with id"` rejection swallowed, falls through to standard injection where the real error surfaces.
  - **`injectIntoAllFrames` (L152-182, previously 0% covered — tested via `{allFrames: true}` since the function is not exported, 4 cases)** — PING-success + allFrames=true enumerates sub-frames and PINGs each while filtering main-frame (frameId=0) + restricted URLs / sub-frame PING rejects → falls through to `scripting.executeScript` on that frame (lazy-mounted iframes recovery) / sub-frame re-injection throws → `console.warn` + continues to next frame (one CSP-restricted iframe must NOT abort the entire scan) / `getAllFrames` returns null → early-return via `if (!frames) return` guard / `getAllFrames` throws → `console.warn` + `injectContentScript` still returns success (webNavigation permission hiccup must not fail top-level injection).

- `tests/background-extractor.test.ts` (**+18 cases**, 7 → 25, `background/extractor.ts` 39.64% → **96.44%**, the single biggest coverage lift this sweep). Six new describe blocks introducing full `getImagesFromTab` coverage (the 122-LoC exported function had **zero** dedicated tests while its sibling `processMultiTabExtract` was already pinned):
  - **`tabId` resolution (4)** — undefined tabId triggers `chrome.tabs.query({active:true,currentWindow:true})` (pinned: the active-tab filter; missing it would scan a random background tab — the #1 "scanned wrong page" bug shape) / active tab is `chrome://` → early restricted-URL throw BEFORE injection attempt (preserves readable error) / empty query list → "No active tab found" / active tab has no `id` → same "No active tab" error.
  - **Post-query restricted-URL guard (3)** — direct tabId + `chrome.tabs.get` returns `chrome://` → "Cannot access" throw (protects users passing tabId via keyboard shortcut) / `tabs.get` rejects with non-"Cannot access" error → swallowed, falls through to injection (injector's own retry logic handles transient glitches) / `tabs.get` rejects WITH "Cannot access" → re-thrown unchanged (substring-based conditional re-throw).
  - **Injection failure propagation (1)** — CSP-classified injection error → throws `Error` with `error.code` + `error.workaround` preserved from the `InjectionResult`. Pinned: WITHOUT preserving these fields, `handleMessage`'s outer catch can't emit `CSP_BLOCKED` — the sidepanel would lose its "Right-click and save manually" fallback UX for CSP-blocked pages.
  - **`searchAllFrames` sub-frame handling (4)** — `chrome.webNavigation.getAllFrames` + per-frame `EXTRACT_IMAGES` with `fromFrame=true` + `frameUrl` stamped (pinned: first-occurrence wins cross-frame dedupe via URL-keyed `Set`) / sub-frame `sendMessage` rejects → silently skipped, loop continues (one unreachable iframe must not kill the whole all-frames scan) / `getAllFrames` rejects → `console.warn` + main-frame images still returned (a regression re-throwing here would present "scan failed" even when main frame succeeded) / `getAllFrames` returns null → treated as `[]`.
  - **`liveMonitoring` message routing (3)** — default `liveMonitoring=true` → `START_LIVE_MONITOR` with `{config:{debounceMs:500}}` + `{frameId:0}` (pinned: the 500ms debounce — without it, SPA feeds like Twitter/Instagram would fire a scan on every DOM mutation) / `liveMonitoring=false` → `STOP_LIVE_MONITOR` (opposite branch; without the explicit STOP, content script keeps paying observer CPU cost) / live-monitor send rejects → silently swallowed, extraction result still returned (monitor setup is best-effort).
  - **`EXTRACT_IMAGES` response handling (1)** — response returns `undefined` (no `images` field) → `response?.images || []` nullish fallback prevents TypeError that would fail the extraction even though the content script returned cleanly (just empty).
  - **Test-infra upgrade**: the existing `chromeStub.tabs.sendMessage` implementation was a single flat mock; new sub-frame cases override it via `getMockImplementation() + custom impl` so per-frame `EXTRACT_IMAGES` calls can return distinct images without breaking PING short-circuit. Pinned cross-test: per-frame `EXTRACT_IMAGES` assertion MUST filter by message type — `injectIntoAllFrames` fires its own per-frame PINGs as part of its job (tested in `background-injector.test.ts`), so counting all-frameId sendMessage calls would double-count.

- `tests/content-main.test.tsx` (**+4 cases**, 40 → 44, `content/main.ts` 84.35% → **85.88%**). Four targeted narrow-branch cases:
  - `initContentScript` on `chrome-extension://` protocol → early-return guard prevents wiring the onConnect listener (pinned: without the guard, injecting into our own popup/reverse-search pages would double-wire port cleanup; every UI close would fire `removeAllHighlights` on a page that never had highlights). Uses `vi.resetModules()` + `Object.defineProperty(window, 'location')` to re-fire `initContentScript` under the alternate protocol.
  - `chrome.runtime.onConnect.addListener` throwing `"Extension context invalidated"` (stale content script after an extension auto-update) → silently swallowed by outer try/catch, `import` completes normally (without the catch, every auto-update would fill page console with confusing errors).
  - `extractFromStylesheets` OUTER try/catch (the inner try already covers cross-origin sheet access) → `document.styleSheets` getter itself throwing (iframe / restricted context) is logged via `console.warn` with the documented prefix while the pipeline continues. Pinned: failing this would reject `extractImages()` and surface a "scan failed" toast even though 99% of the pipeline succeeded.
  - `extractPictureSources` `seenUrls.has(resolvedUrl) continue` guard for `<source srcset="img.jpg 1x, img.jpg 2x">` (duplicate URL at different descriptors — valid markup for lazy-loaded placeholders). Without this guard a single source would produce two ImageItems with identical URLs — breaking downstream dedup-by-url checks.

- `tests/content-extract-advanced.test.tsx` (**+5 cases**, 67 → 72, `content/extract-advanced.ts` 86.74% → **95.28%**). Data-URI security + dedupe paths:
  - **Lazy-srcset data-uri branch (L437-456, 3 cases)** — data-uri image candidate via `data-srcset` → extracts as `type:'lazy'` + `sourceDomain = window.location.hostname` (fallback for URLs with no host) + `naturalWidth` preferred over `rect.width` when non-zero / non-image data-uri (`data:text/html`) REJECTED by `isImageDataUri` guard (defensive pin — a crafted page could otherwise smuggle HTML payloads into scan results) / duplicate data-uri across descriptors de-duped via `state.seenUrls`. Uses `vi.mocked(parseSrcset).mockImplementationOnce` to bypass the real `split(',')` which miss-splits on the internal `base64,` comma.
  - **CSS-content data-uri branch (L507-524, 2 cases)** — `::before content: url(data:image/png;base64,...)` → `type:'css-content'` + `generateDataUriKey` dedup + hostname sourceDomain + `rect.width/height` from `getBoundingClientRect` (pinned: pseudo-elements have no intrinsic size so naturalWidth path is deliberately skipped) / `::before` non-image data-uri → same `isImageDataUri` rejection (CSS content URI `<script>` smuggling blocked). Uses per-element `id`-based getComputedStyle mock to isolate the target div from body, preventing a phantom 0×0 body item from shadowing the real assertion.

#### Not Added — Deliberate e2e Deferral

- `sidepanel/scan.ts` (10.28% line coverage) — the head-of-file overlay state machine (`showScanOverlay` / `hideScanOverlay` / `updateScanProgress` / `handleScanCancel`) already has a full `tests/sidepanel-scan.test.tsx` (4 describe blocks / indeterminate-flag handoff + abort-with-images vs. abort-empty split pinned). The remaining 530+ uncovered lines (L92-622) are `silentRescan` / `rescanWithProgress` / `fetchImages` / `fetchImageDataUrl` / `processImageExtras` / `patchCardExtras` — all `chrome.runtime.sendMessage` long chains against the background service worker. Adding 200+ LoC of IPC mock scaffolding to reach them would be brittle and pin implementation details rather than behavior; the actual contract (scan → results render → dedup → download) is already covered by `e2e/smoke.e2e.ts` + `e2e/scan.e2e.ts` under a real Chrome. Explicitly out of unit-test scope.

#### Changed — Test Infrastructure (coverage include expansion)

- `vitest.config.ts` — `coverage.include` widened from `['shared/**/*.ts']` to `['shared/**/*.ts', 'background/**/*.ts', 'content/**/*.ts', 'sidepanel/**/*.ts', 'pages/**/*.ts']`. The prior shared-only denominator was hiding that popular user-code paths like `pages/reverse-search.ts` (0%) and `pages/popup.ts` (0% before unit tests landed) were completely unmeasured. `coverage.exclude` grew by **15 Preact component paths** + `**/types.ts` — these are pure render components (`SkeletonCard.tsx`, `ImageGrid.tsx`, etc.) with zero logic branches; attempting to cover them via unit test would require full Preact mount + snapshot infra which is already handled by `e2e/` visual smoke.
- `tests/sidepanel-filter.test.ts` → `tests/sidepanel-filter.test.tsx` via `git mv` — the `.ts → .tsx` rename routes the file through the jsdom environment via `environmentMatchGlobs`, making `document` available for the new custom-size-input DOM tests.

#### Changed — Documentation

- `CONTRIBUTING.md` — replaced the 3-line "Tests" paragraph with a complete two-layer testing guide: Vitest/Playwright scope matrix, current coverage stats, mocking conventions (`installChromeMock()` helper, `fake-indexeddb`, `vi.mock()` patterns), documented jsdom limits (no layout computation, CSS shorthand normalization, strict `HTMLInputElement.files` typing), Playwright deterministic-state pattern (`window.__IH_E2E__` + `window.__IH__.store`), smoke-tier vs full-suite guidance.

#### Chore

- `.gitignore` — added `/coverage/` (vitest v8 `test:coverage` output — local dev only, never committed).

#### Coverage Metrics (cumulative across the whole [Unreleased] section)

| Target                             | Before  | After      | Δ                                     |
| ---------------------------------- | ------- | ---------- | ------------------------------------- |
| All-files aggregate Lines          | _n/a_   | **75.48%** | new metric + 3 sweeps                 |
| `shared/*` aggregate line coverage | 66.95%  | **100%**   | +33.05pp                              |
| `shared/color-extract.ts`          | 11.04%  | **100%**   | +88.96pp                              |
| `shared/phash.ts`                  | 17.89%  | **100%**   | +82.11pp                              |
| `shared/converter.ts`              | 36.52%  | **100%**   | +63.48pp                              |
| `shared/utils.ts`                  | 97.85%  | **100%**   | +2.15pp                               |
| `content/state.ts`                 | partial | **100%**   | —                                     |
| `content/utils.ts`                 | partial | **100%**   | —                                     |
| `sidepanel/render.ts`              | partial | **100%**   | —                                     |
| `sidepanel/filter.ts`              | 37.26%  | **64.62%** | +27.36pp                              |
| `sidepanel/ui.ts`                  | 47.12%  | **67.67%** | +20.55pp                              |
| `pages/reverse-search.ts`          | **0%**  | **87.86%** | +87.86pp                              |
| `pages/popup.ts`                   | 0%      | **100%**   | +100pp                                |
| **`sidepanel/dedup-ui.ts`**        | **0%**  | **100%**   | +100pp (Stage-1)                      |
| **`sidepanel/license-ui.ts`**      | **0%**  | **98.89%** | +98.89pp (Stage-1)                    |
| **`sidepanel/collection-ui.ts`**   | **0%**  | **100%**   | +100pp (Stage-1)                      |
| **`sidepanel/multitab.ts`**        | **0%**  | **90.45%** | +90.45pp (Stage-1)                    |
| `sidepanel/*` aggregate Lines      | 46.11%  | **61.51%** | +15.40pp                              |
| **`background/index.ts`**          | 77.53%  | **94.76%** | +17.23pp (Stage-2)                    |
| **`background/injector.ts`**       | 65.57%  | **100%**   | +34.43pp (Stage-2)                    |
| **`background/extractor.ts`**      | 39.64%  | **96.44%** | +56.80pp (Stage-2)                    |
| **`content/extract-advanced.ts`**  | 86.74%  | **95.28%** | +8.54pp (Stage-2)                     |
| **`content/main.ts`**              | 84.35%  | **85.88%** | +1.53pp (Stage-2)                     |
| `background/*` aggregate Lines     | 77.53%  | **90.94%** | +13.41pp (Stage-2)                    |
| `content/*` aggregate Lines        | 79.24%  | **81.46%** | +2.22pp (Stage-2)                     |
| `sidepanel/scan.ts` (e2e-scoped)   | 10.28%  | 10.28%     | 0 (by design — see "Not Added" above) |
| Vitest test files                  | 35      | **44**     | +9                                    |
| Vitest test cases                  | 847     | **1,137**  | +290                                  |

#### Verified

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npx prettier --check` ✅ (7 format-fixed across Stage-1 + Stage-2 touched sets)
- `npm test` → **44 files / 1,137 cases** ✅
- `npm run test:coverage` → `All files` Lines **75.48%** ✅ (see hotspot table above)
- `npx playwright test e2e/smoke.e2e.ts` → **3/3** ✅ (5.7s)

---

## [1.0.1][1.0.1] - 2026-04-29

### 🎨 Polish & Discoverability Update

#### 🔄 Changed — Chrome Web Store Listing

- **Extension name** updated from `Image Harvest` to `Image Harvest - Download Any Image from Any Webpage` for better Chrome Web Store search discoverability and clearer value proposition at a glance
- **Small promo tile** (440×280) — added rounded corners for a softer, more modern visual presentation
- **Marquee promo tile** (1400×560) — added rounded corners to match the small promo tile, ensuring brand consistency across all Chrome Web Store visual assets

#### ✨ Added — Marketing Assets

- **YouTube product demo video** published globally — a complete walkthrough of Image Harvest's core capabilities: [Watch on YouTube](https://www.youtube.com/watch?v=o5KdX--l-yw&t=1s)
  - Covers: smart image extraction, multi-tab batch download, similar image detection, reverse image search, color extraction
  - Available worldwide for both English and international audiences

---

## [1.0.0][1.0.0] - 2026-04-26

### 🎉 Initial Release — Now Live on Chrome Web Store

🛒 [Install from Chrome Web Store](https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo) · 🌐 [Website](https://image-harvest.kyriewen.cn)

#### ✨ Added — Smart Image Extraction

- `<img>` tag extraction with `srcset` highest-resolution candidate selection
- CSS `background-image` extraction (inline styles + external stylesheets, via `getComputedStyle`)
- `<picture>` / `<source>` element support
- Same-origin iframe content extraction
- Shadow DOM recursive traversal
- Live monitoring via `MutationObserver` with debounce (Pro)
- URL-based deduplication (keeps the first occurrence, prefers larger size)
- Single-scan limit: 1000 images

#### 🖼️ Added — Image Display & Management

- Grid / List view toggle with 3 density presets (Compact 80px / Standard 120px / Comfortable 180px)
- Color palette extraction — top 5 dominant colors per image (Median Cut algorithm on 100×100 downscaled canvas)
- Perceptual hash (pHash) similar-image detection — 32×32 grayscale → DCT → 64-bit hash, Hamming distance ≤ 5 (Pro)

#### 🎛️ Added — Filtering, Sorting & Grouping

- Size filter: All / Small (<100px) / Medium / Large / XL / Custom range
- Format filter: JPG / PNG / WebP / SVG / GIF / BMP / ICO / AVIF / Other (multi-select)
- Layout filter: Square / Landscape / Portrait / Panorama
- URL keyword search with debounce
- Sorting: by size (asc/desc), format, or natural order
- Smart grouping: None / Domain / Format / Size Range / Tab (Pro for 5-mode set)

#### 📥 Added — Download & Export

- Single-image download (original or converted format)
- Batch ZIP download via JSZip with streaming blob assembly (free: up to 20 images / Pro: unlimited up to 1000)
- Format conversion: PNG ↔ JPG ↔ WebP via Canvas API (Pro)
- Custom naming templates: `{index}` / `{original}` / `{pageTitle}` / `{pageDomain}` / `{width}` / `{height}` / `{format}` / `{date}` / `{timestamp}` / `{year}` / `{month}` / `{day}` (Pro)
- Subfolder naming (default: `{domain}`)
- Download progress modal with progress bar
- Many-files warning (>100 images, configurable)
- Concurrency-controlled fetching (max 3 parallel) with 10s timeout
- Maximum ZIP size: 500MB

#### 🎯 Added — Page Highlight

- Single-image highlight on click (free)
- Batch highlight sync with auto-scroll to viewport (Pro)
- Position update on scroll/resize
- Highlight state synced with panel checkbox selection

#### ⭐ Added — Image Collections (Pro)

- IndexedDB storage (`ImageHarvestDB` / `collections` object store)
- Save image metadata: URL, thumbnail blob, tags, source, dimensions, colors, notes
- Browse, search, filter by tag
- Batch export collection as ZIP

#### 🔎 Added — Reverse Image Search

- Google Images (free)
- TinEye, Baidu, Yandex (Pro)

#### 🖥️ Added — Dual Display Mode

- Side Panel mode (default, always visible)
- Popup mode (620×600px)
- Switchable from settings, persisted across sessions

#### 🌗 Added — Theme & Layout

- System / Light / Dark theme (CSS variables, `prefers-color-scheme` aware)
- 3 layout densities (Compact / Standard / Comfortable)
- Responsive layout for narrow side-panel widths

#### 💎 Added — License System & Pricing

- Three Pro plans: Monthly ($2.99), Yearly ($19.99 / ~44% off), Lifetime ($39.99)
- License activation via remote API (`https://image-harvest.kyriewen.cn/api/license`)
- Local cache in `chrome.storage.local` with 24h periodic re-validation (via `chrome.alarms`)
- 7-day offline grace period
- Per-instance device binding (1 device per license)

#### 📑 Added — Multi-tab Extraction (Pro)

- Cross-tab batch image extraction from current window
- Results merged and grouped by tab

#### 🔒 Added — Privacy & Security

- 100% local processing — zero analytics, zero telemetry, zero remote code
- Background CORS proxy (`FETCH_IMAGE_DATA`) for pHash & color extraction only
- Minimal permission set: `activeTab`, `storage`, `downloads`, `scripting`, `tabs`, `sidePanel`, `webNavigation`, `alarms`

#### 🛠️ Tech Stack

- Chrome Extension Manifest V3
- Vanilla HTML / CSS / JS (no UI framework, intentional zero-dependency runtime)
- JSZip for ZIP packaging
- IndexedDB for collections storage
- Canvas API for pHash, color extraction, format conversion
- Marketing site built with Next.js (separate `website/` subproject, deployed at `image-harvest.kyriewen.cn`)

#### 📦 Project Structure

- Modular split: `background/` (8 modules), `content/` (5 modules), `sidepanel/` (11 modules), `pages/`, `css/` (8 stylesheets), `shared/` (9 modules with `.js` + `.mjs` dual builds)

---

[1.0.1]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
[1.0.0]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
