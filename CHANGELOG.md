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

#### Changed — Documentation

- `CONTRIBUTING.md` — replaced the 3-line "Tests" paragraph with a complete two-layer testing guide: Vitest/Playwright scope matrix, current coverage stats, mocking conventions (`installChromeMock()` helper, `fake-indexeddb`, `vi.mock()` patterns), documented jsdom limits (no layout computation, CSS shorthand normalization), Playwright deterministic-state pattern (`window.__IH_E2E__` + `window.__IH__.store`), smoke-tier vs full-suite guidance.

#### Chore

- `.gitignore` — added `/coverage/` (vitest v8 `test:coverage` output — local dev only, never committed).

#### Coverage Metrics (before → after)

| Target                             | Before | After    | Δ        |
| ---------------------------------- | ------ | -------- | -------- |
| `shared/*` aggregate line coverage | 66.95% | **100%** | +33.05pp |
| `shared/color-extract.ts`          | 11.04% | **100%** | +88.96pp |
| `shared/phash.ts`                  | 17.89% | **100%** | +82.11pp |
| `shared/converter.ts`              | 36.52% | **100%** | +63.48pp |
| `shared/utils.ts`                  | 97.85% | **100%** | +2.15pp  |
| Vitest test files                  | 35     | **39**   | +4       |
| Vitest test cases                  | 847    | **889**  | +42      |

#### Verified

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npx prettier --check` ✅
- `npm test` → **39 files / 889 cases** ✅
- `npm run test:coverage` → **`shared/*` all 6 files at 100% Lines** ✅
- `npx playwright test e2e/smoke.e2e.ts` → **3/3** ✅ (4.7s)

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
