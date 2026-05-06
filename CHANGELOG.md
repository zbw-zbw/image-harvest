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

#### Changed — Documentation

- `CONTRIBUTING.md` — replaced the 3-line "Tests" paragraph with a complete two-layer testing guide: Vitest/Playwright scope matrix, current coverage stats, mocking conventions (`installChromeMock()` helper, `fake-indexeddb`, `vi.mock()` patterns), documented jsdom limits (no layout computation, CSS shorthand normalization), Playwright deterministic-state pattern (`window.__IH_E2E__` + `window.__IH__.store`), smoke-tier vs full-suite guidance.

#### Verified

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test` → 35 files / 847 cases ✅
- `npx playwright test e2e/smoke.e2e.ts` → 3/3 ✅ (5s)

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
