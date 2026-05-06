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
| All-files aggregate Lines          | _n/a_   | **65.10%** | new metric + hotspot sweep            |
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
| `sidepanel/scan.ts` (e2e-scoped)   | 10.28%  | 10.28%     | 0 (by design — see "Not Added" above) |
| Vitest test files                  | 35      | **40**     | +5                                    |
| Vitest test cases                  | 847     | **978**    | +131                                  |

#### Verified

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npx prettier --check` ✅ (3 format-fixed in the touched set)
- `npm test` → **40 files / 978 cases** ✅
- `npm run test:coverage` → `All files` Lines **65.10%** ✅ (see hotspot table above)
- `npx playwright test e2e/smoke.e2e.ts` → **3/3** ✅ (8.7s)

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
