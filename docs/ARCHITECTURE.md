# Image Harvest — Architecture

<p align="right">
  <strong>English | <a href="./ARCHITECTURE.zh-CN.md">简体中文</a></strong>
</p>

> A deep dive into how Image Harvest is built — for contributors who want to
> change something significant, reviewers auditing the privacy/Pro story,
> and curious users wondering what's actually running in their browser.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Runtime Surfaces](#2-runtime-surfaces)
3. [High-Level Data Flow](#3-high-level-data-flow)
4. [Module Map](#4-module-map)
5. [`background/` — Service Worker](#5-background--service-worker)
6. [`content/` — In-Page Extraction](#6-content--in-page-extraction)
7. [`sidepanel/` — UI Layer](#7-sidepanel--ui-layer)
8. [`pages/` — HTML Entry Points](#8-pages--html-entry-points)
9. [`shared/` — Single Source of Truth](#9-shared--single-source-of-truth)
10. [IPC Protocol Reference](#10-ipc-protocol-reference)
11. [Storage Layout](#11-storage-layout)
12. [State Machines](#12-state-machines)
13. [Pro / License Model](#13-pro--license-model)
14. [Privacy & Telemetry Pipeline](#14-privacy--telemetry-pipeline)
15. [Internationalization (i18n)](#15-internationalization-i18n)
16. [Build Pipeline](#16-build-pipeline)
17. [Performance Budgets](#17-performance-budgets)
18. [Testing Strategy](#18-testing-strategy)
19. [Release Pipeline](#19-release-pipeline)
20. [Extending the Project](#20-extending-the-project)
21. [Glossary](#21-glossary)

---

## 1. Overview

Image Harvest is a **Chrome Manifest V3 extension** that scans any web page for
images, lets the user filter / preview / batch-download them, and offers a
small set of "Pro" power-user features behind a license key. The codebase
optimizes for three things, in order:

1. **Privacy** — image extraction, hashing, color analysis, and format
   conversion happen entirely in-browser. The only network calls the
   extension makes by itself are to `image-harvest.kyriewen.cn` for
   license verification, optional anonymous telemetry, and (if the user
   triggers it) reverse-image search redirects.
2. **First-paint latency** — the side panel is opened many times per
   day; the main entry chunk has a hard 50 kB gzipped budget enforced by
   `scripts/check-bundle-size.mjs` in CI.
3. **Honest "load unpacked" hackability** — every source file is plain
   TypeScript ESM, no minified vendor blobs, no remote code loading. A
   reviewer can read every line that runs.

### Architectural style

The extension follows the **classic MV3 three-process model**:

```
┌────────────────────────────┐    ┌────────────────────────────┐
│   Side Panel / Popup       │    │   Reverse Search Page      │
│   (sidepanel/ + pages/)    │    │   (pages/reverse-search.*) │
│   ─ Preact + Vanilla DOM   │    │                            │
└──────────────┬─────────────┘    └──────────────┬─────────────┘
               │  chrome.runtime.connect("image-harvest-ui")
               │  chrome.runtime.sendMessage / onMessage
               ▼
┌──────────────────────────────────────────────────────────────┐
│              Background Service Worker (background/)         │
│   ─ Message router, content-script injector,                 │
│     license alarms, multi-tab orchestration                  │
└──────────────┬───────────────────────────────────────────────┘
               │  chrome.tabs.sendMessage / chrome.scripting.executeScript
               ▼
┌──────────────────────────────────────────────────────────────┐
│              Content Script (content/)                       │
│   ─ DOM / Shadow DOM / iframe traversal,                     │
│     MutationObserver live monitoring, page highlight         │
└──────────────────────────────────────────────────────────────┘
```

`shared/` is the single source of truth for **types, constants, storage
helpers, telemetry SDK, license SDK, i18n catalogue, and pure
algorithms** (pHash, color extraction, format conversion). It is imported
by all three runtimes; bundling is handled by `@crxjs/vite-plugin` so each
runtime gets exactly one copy.

### What this document is not

This document **does not** duplicate the user-facing feature list (see
[`README.md`](../README.md)), the privacy promise (see
[`PRIVACY.md`](./PRIVACY.md)), the security policy (see
[`SECURITY.md`](../SECURITY.md)), or the contributor onboarding
(see [`CONTRIBUTING.md`](../CONTRIBUTING.md)). It focuses on the **runtime
shape, IPC protocols, state machines, and hard constraints** — the
information you need to land non-trivial PRs without breaking subtle
contracts.

## 2. Runtime Surfaces

The extension runs simultaneously in **four distinct JavaScript contexts**.
Each has different APIs, different lifetimes, different storage scopes, and
different debuggers. Knowing which one you're in is the most common cause
of "but it works locally" bugs.

| Surface                 | File entry                                              | Lifetime                                                       | Has DOM?      | Sees `chrome.tabs`?              | Storage scope                         |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | ------------- | -------------------------------- | ------------------------------------- |
| **Service Worker**      | `background/index.ts`                                   | Spun up on demand by Chrome; goes dormant after ~30 s idle     | ❌            | ✅ Full                          | `chrome.storage.{local,sync,session}` |
| **Side Panel**          | `pages/sidepanel.html` → `sidepanel/init.ts`            | Persistent while the panel is open; survives tab switches      | ✅            | ✅ Full                          | Same storage namespace as SW          |
| **Popup**               | `pages/popup.html` → same `init.ts` (mode flag)         | Killed the moment the popup loses focus                        | ✅            | ✅ Full                          | Same storage namespace as SW          |
| **Content Script**      | `content/main.ts`                                       | Lives as long as the page lives; killed on navigation / reload | ✅ (page DOM) | ❌ (cannot call `chrome.tabs.*`) | `chrome.storage.local` only           |
| **Reverse Search Page** | `pages/reverse-search.html` → `pages/reverse-search.ts` | Opened in a new tab via `chrome.tabs.create`                   | ✅            | ✅                               | Same as SW                            |

### Why both Side Panel and Popup share `init.ts`

The user can switch between Side Panel mode and Popup mode at any time
(see `background/display-mode.ts`). The two HTML shells (`sidepanel.html`
and `popup.html`) include the same body markup via the
`vite-html-include` plugin and load the same `sidepanel/init.ts` bundle.
`init.ts` reads `state.isPopupMode` from
`window.location.pathname.endsWith('popup.html')` and adjusts a few
sizing / behavior knobs at boot. **One bundle, two shells.**

### Why no React / Vue / Svelte

The original 2024 prototype was vanilla DOM + JSZip in a single ~30 kB
bundle. When Pro features (collection modal, multi-tab modal, license
flows) needed real component composition, we adopted **Preact** rather
than React for the ~3 kB runtime. `virtua` (the only third-party
component dep) hard-imports from `react`; we alias it to `preact/compat`
in `vite.config.ts` so the compat-layer cost stays at ~6.6 kB.

There is **no full-app rewrite to React/Vue/Svelte planned**. The
imperative legacy code in `sidepanel/*.ts` stays; new modal-shaped UI
goes into `sidepanel/components/*.tsx`. Shared state lives in
`sidepanel/state.ts` as a plain mutable object; Preact components read
it via the small `storeHook.ts` adapter.

## 3. High-Level Data Flow

The most common interaction — **"open the panel on a page that has
images"** — flows like this:

```
User clicks toolbar icon  /  presses Ctrl+Shift+S
        │
        ▼
Chrome opens pages/sidepanel.html (or popup.html in popup mode)
        │
        ▼
sidepanel/init.ts  ─ mounts Preact components, caches DOM refs,
                     loads settings, opens chrome.runtime.connect("image-harvest-ui"),
                     calls loadCurrentTab()
        │
        ▼ (async)
sidepanel/scan.ts  ─ chrome.runtime.sendMessage(GET_IMAGES, {tabId, …})
        │
        ▼
background/index.ts  ─ message router → background/extractor.ts
        │
        ▼
background/extractor.ts ─ ensures content script is injected
                          (background/injector.ts handles fallback)
        │
        ▼
chrome.tabs.sendMessage(tabId, {type: EXTRACT_IMAGES, …})
        │
        ▼
content/main.ts  ─ extractImages() runs 14 extraction stages
                   (img / picture / background / svg / canvas / video poster /
                    input / object / embed / meta / link / css content /
                    lazy-load / shadow DOM / iframes)
        │
        ├──► sendDiscoveredImages([…])  (streamed, one batch per stage)
        │            │
        │            ▼
        │     IMAGES_DISCOVERED ─► background broadcasts ─► sidepanel renders
        │                          (incremental UI update; user sees images
        │                           appear as they're found)
        │
        └──► returns full ImageItem[] when extractImages() resolves
                     │
                     ▼
              sidepanel/scan.ts assembles the final list, applies
              client-side dedup, sort, group → renderImages()
        │
        ▼
content/monitor.ts  ─ MutationObserver watches for DOM changes
                      (Pro-gated; off for free users)
                      ─ new images stream as IMAGES_DISCOVERED
```

Three observations matter for new contributors:

- **Extraction is incremental, not "scan and return".** Each of the 14
  stages calls `sendDiscoveredImages()` as it discovers URLs, so the
  panel renders progressively. The final return value is just the
  authoritative dedup'd list.
- **The background is a thin router**, not a state holder. State that
  outlives a single message lives either in the side panel (`state.ts`)
  or in `chrome.storage.{local,sync,session}`.
- **Content scripts cannot call `chrome.tabs.*`.** Anything that needs to
  read tab metadata, switch tabs, or query frames must round-trip
  through the background SW.

### Reverse data flow: download

When the user clicks "Download selected as ZIP":

```
sidepanel/actions.ts ─ downloadSelectedAsZip()
        │
        ▼ for each selected image:
        │   ├─ if same-origin / CORS-ok: fetch directly in panel context
        │   └─ otherwise: chrome.runtime.sendMessage(FETCH_IMAGE_DATA, {url})
        │           │
        │           ▼
        │     background/reverse-search.ts ─ fetchImageData(url)
        │           ─ background SW has host_permissions: <all_urls>
        │             so it can bypass page CSP / CORS for reads
        │           ─ returns base64 data URL to the panel
        │
        ▼
JSZip (lazy-imported the first time it's needed) builds the archive
        │
        ▼
chrome.downloads.download({url: blobUrl, filename: …})
```

The lazy `import('jszip')` inside `actions.ts` is the single biggest
reason `sidepanel/init.js` stays under its 50 kB budget — the 86 kB
gzipped JSZip blob only ships the moment the user actually clicks a
batch-download button.

## 4. Module Map

A bird's-eye view of every meaningful directory and what it owns.

```
image-harvest/
├── manifest.config.ts          ─ Typed MV3 manifest (consumed by @crxjs/vite-plugin)
├── vite.config.ts              ─ Build config: crxjs + html-include + bundle visualizer
├── vite-html-include.ts        ─ Custom plugin: <!-- @include _shared-body.html --> macro
├── tsconfig.json               ─ TS config (allowJs:true, noImplicitAny:false during migration)
├── playwright.config.ts        ─ Playwright workers:1, headed Chromium, dist/ as extension
├── vitest.config.ts            ─ Vitest 2 + jsdom env split per test file glob
│
├── background/                 ─ Service Worker (one bundle: background/index.ts)
│   ├── index.ts                ─   Message router (~430 lines, handles ~30 message types)
│   ├── extractor.ts            ─   getImagesFromTab + processMultiTabExtract
│   ├── injector.ts             ─   injectContentScript with 4 fallback strategies
│   ├── display-mode.ts         ─   Side Panel ↔ Popup mode swap (action.setPopup, sidePanel.setOptions)
│   ├── license.ts              ─   chrome.alarms-based 24h license check
│   ├── reverse-search.ts       ─   FETCH_IMAGE_DATA proxy + REVERSE_SEARCH_UPLOAD proxy
│   └── utils.ts                ─   uiPorts Set, broadcastToPopup, getAccessibleTabId
│
├── content/                    ─ Page-injected scripts (one bundle: content/main.ts)
│   ├── main.ts                 ─   Message handler, 14-stage extractImages() entry
│   ├── state.ts                ─   Module-level mutable state + isExtensionContextValid()
│   ├── utils.ts                ─   parseSrcset, ensureImageLoaded, sendDiscoveredImages
│   ├── extract-advanced.ts     ─   Stages 5-12: SVG / canvas / video poster / input / object /
│   │                                embed / meta / link / css content / lazy-load
│   ├── shadow-iframe.ts        ─   Stage 13-14: Shadow DOM walk + same-origin iframes
│   ├── monitor.ts              ─   MutationObserver live monitoring (Pro)
│   └── highlight.ts            ─   In-page image highlight overlay (single + batch)
│
├── sidepanel/                  ─ Side Panel + Popup UI bundle (entry: sidepanel/init.ts)
│   ├── init.ts                 ─   IIFE entry, 1100+ lines: cacheElements + bindEvents +
│   │                                tab change handlers + scan orchestration boot
│   ├── state.ts                ─   The mutable global `state` object + DOM ref cache `elements`
│   ├── ui.ts                   ─   Toast / loading overlay / filter button labels / view toggle
│   ├── filter.ts               ─   applyFilters / sortImages / renderColorSwatches
│   ├── render.ts               ─   renderImages (delegates to virtua VList)
│   ├── scan.ts                 ─   showScanOverlay / fetchImages / silentRescan / image extras
│   ├── actions.ts              ─   Selection, download (single / ZIP), copy URL, reverse search
│   ├── settings.ts             ─   Settings modal, theme, density, hotkeys, license UI host
│   ├── message.ts              ─   handleMessage (broadcast from BG) + handleKeyDown
│   ├── pro-features.ts         ─   Lazy-loaded Pro module dispatchers (collection, multitab, dedup)
│   ├── multitab.ts             ─   Multi-tab modal logic (Pro)
│   ├── license-ui.ts           ─   License activation / deactivation modal
│   ├── dedup-ui.ts             ─   pHash dedup modal (Pro)
│   ├── collection-ui.ts        ─   Favorites modal (Pro)
│   ├── utils.ts                ─   loadSettings, fetchImageMeta, generateFilename
│   └── components/             ─ Preact components (.tsx)
│       ├── mount.tsx           ─   Mount-point swap logic, single mountPreactComponents()
│       ├── storeHook.ts        ─   useStore hook bridging mutable state → Preact rerender
│       ├── ImageGrid.tsx       ─   virtua-powered virtualized grid
│       ├── ImageCard.tsx       ─   Per-image card (color swatches, badges, hover actions)
│       ├── *.tsx               ─   Modals, badges, banners, indicators (22 files total)
│
├── pages/                      ─ HTML entry points + their TS controllers
│   ├── _shared-body.html       ─   The shared <body> markup included by both panel & popup
│   ├── sidepanel.html          ─   Side panel shell
│   ├── popup.html              ─   Popup shell
│   ├── popup.ts                ─   Popup-only height adjustment
│   ├── popup.css               ─   Popup-only style overrides (sidepanel uses css/*.css)
│   ├── reverse-search.html     ─   Standalone tab opened for image upload to search engines
│   └── reverse-search.ts       ─   Reverse-search page logic (called via chrome.tabs.create)
│
├── shared/                     ─ Pure / cross-runtime modules — no DOM, no chrome.tabs
│   ├── types.ts                ─   ImageItem, AppSettings, FilterConfig, License*, Telemetry*
│   ├── constants.ts            ─   MESSAGE_TYPES, STORAGE_KEYS, LIMITS, FREE_LIMITS, PRICING…
│   ├── storage.ts              ─   Settings/history/cache helpers wrapping chrome.storage.*
│   ├── utils.ts                ─   resolveUrl, getDomain, getFileFormat, deepMerge, etc.
│   ├── converter.ts            ─   PNG ↔ JPG ↔ WebP via Canvas (Pro)
│   ├── naming.ts               ─   {index} {original} {date} … filename template engine (Pro)
│   ├── phash.ts                ─   64-bit perceptual hash (DCT) for similar-image dedup (Pro)
│   ├── color-extract.ts        ─   Median-cut top-5 dominant colors per image
│   ├── collection.ts           ─   IndexedDB CRUD for the Favorites store (Pro tier 6+)
│   ├── license.ts              ─   activate / deactivate / isProUser with 7d offline grace
│   ├── trial.ts                ─   7-day Pro trial sentinel (one-shot per install)
│   ├── telemetry.ts            ─   Anonymous opt-in event SDK
│   ├── telemetry-events.ts     ─   The whitelist of event names + per-event prop schemas
│   ├── ab-experiment.ts        ─   Pro-upsell A/B bucket assignment
│   ├── paywall-state.ts        ─   Paywall display gating state machine
│   ├── rating-prompt-state.ts  ─   "Leave a review" prompt timing logic
│   └── i18n.ts                 ─   Locale catalogue + t() / detectLocale()
│
├── css/                        ─ 8 stylesheets, all themed via CSS variables
│   ├── variables.css           ─   --color-* / --space-* / --radius-* tokens
│   ├── base.css                ─   Reset, layout, typography
│   ├── cards.css               ─   Image grid + card styles
│   ├── modals.css              ─   Modal shell + each modal's content
│   ├── settings.css            ─   Settings panel
│   ├── states.css              ─   Loading / empty / restricted screens
│   ├── toolbar.css             ─   Top toolbar (filters, view modes, sort)
│   └── license.css             ─   License modal + status pill
│
├── _locales/                   ─ Chrome MV3 i18n catalogues (5 languages)
│   ├── en/messages.json        ─   English (default_locale)
│   ├── zh_CN/messages.json     ─   Simplified Chinese
│   ├── zh_TW/messages.json     ─   Traditional Chinese
│   ├── ja/messages.json        ─   Japanese
│   └── es/messages.json        ─   Spanish
│
├── tests/                      ─ Vitest unit suite (53 files / ~1,345 cases)
│   └── _helpers/               ─   chromeApiMock (installChromeMock), chromeStorageMock, imageFixtures, preact-setup
│
├── e2e/                        ─ Playwright e2e (41 specs)
│   ├── _helpers/               ─   launchExtension
│   ├── fixtures/               ─   Static HTML fixtures (page-with-images.html)
│   ├── smoke.e2e.ts            ─   3-case smoke (run on every commit)
│   └── *.e2e.ts                ─   Per-feature flows
│
├── scripts/                    ─ Tooling
│   ├── check-bundle-size.mjs   ─   gzip budget enforcement (init.js ≤ 50 kB, etc.)
│   ├── zip-extension.mjs       ─   Web-Store-ready zip builder for `npm run zip`
│   └── icons/                  ─   generate-icons.html + sync-icons.sh
│
├── icons/                      ─ icon16/32/48/128.png (toolbar + Chrome Web Store)
├── assets/                     ─ Marketing screenshots, promo tiles
│
├── docs/                       ─ Public docs (chrome-store/) + private docs (.gitignored)
│   └── chrome-store/           ─   Listing description + summary
│
│                              (Marketing site source lives in a separate private repo;
│                               deployed at image-harvest.kyriewen.cn)
│
└── .github/                    ─ CI/CD + community files
    ├── workflows/ci.yml        ─   lint + typecheck + test + build + e2e
    ├── workflows/release.yml   ─   Tag-triggered zip + GitHub Release
    ├── ISSUE_TEMPLATE/         ─   Bug / Feature / Question templates
    └── FUNDING.yml             ─   Sponsor links
```

**Rule of thumb**: when you add a new feature, ask "does this need DOM,
`chrome.tabs`, both, or neither?" The answer maps directly to which
folder the new file belongs in.

## 5. `background/` — Service Worker

The background SW is intentionally **stateless across messages**. It owns
no domain data — every piece of persistent state lives in
`chrome.storage.*`, IndexedDB, or the active side-panel `state` object.
The SW's three jobs are: **route**, **inject**, and **wake on alarm**.

### `index.ts` — message router

The message router is a single `chrome.runtime.onMessage.addListener`
that switch-dispatches on `message.type`. Every handler is `async` and
must call `sendResponse()` exactly once on every code path; the listener
returns `true` synchronously to keep the response channel open across the
`await`.

A few defensive patterns to know:

- **`safeSendResponse`** wraps `sendResponse` to swallow the
  "Attempted to use a closed channel" error that Chrome throws when the
  caller tab navigates away mid-extraction. Without this wrapper, every
  navigation during a scan produces a noisy red console error.
- **`broadcastToPopup`** iterates over `uiPorts: Set<chrome.runtime.Port>`,
  the long-lived ports the side panel and popup open at boot via
  `chrome.runtime.connect({name: 'image-harvest-ui'})`. This is how
  `IMAGES_DISCOVERED` reaches the panel without per-message ack
  ceremony.
- **`getAccessibleTabId`** is the single chokepoint for "do not let the
  panel send messages to a tab that has navigated to a restricted URL"
  (chrome:// pages, Web Store, view-source). Returns `null` and the
  caller is expected to silently no-op.

### `injector.ts` — content-script injection with fallbacks

Although crxjs declares the content script statically in
`manifest.config.ts`, **the static declaration only runs on pages that
load AFTER the extension was installed/reloaded**. Tabs that were
already open beforehand have no content script, and the fix —
`chrome.scripting.executeScript` — is what `injector.ts` wraps with the
right error handling.

The injection flow is a 4-step ladder:

1. **PING the main frame.** If a content script answers within 3 s, we
   already have one — return success.
2. **Bail on restricted URLs.** Return a friendly `INJECTION_FAILED`
   with `message: 'Cannot access this page: browser internal or error
pages are not supported'`.
3. **Probe for legacy globals.** `executeScript` runs a tiny `func` in
   the page world that checks `typeof globalThis.isExtracting !==
'undefined'`. This catches the double-injection edge case where the
   script is loading but hasn't yet attached its message listener.
4. **Inject the bundled script(s)** read from
   `chrome.runtime.getManifest().content_scripts[0].js`. The hashed
   filenames (`assets/main.ts-loader-XXXXXXXX.js`) are looked up at
   runtime so we never hardcode them.

If `allFrames: true`, `injectIntoAllFrames` enumerates frames via
`chrome.webNavigation.getAllFrames` and attempts injection into every
non-restricted sub-frame.

CSP-blocked pages return a `CSP_BLOCKED` code with a user-actionable
`workaround` string the side panel surfaces verbatim.

### `extractor.ts` — single-tab and multi-tab extraction

`getImagesFromTab(tabId, {searchAllFrames, liveMonitoring})` is the
canonical "scan this tab" entry. It:

1. Resolves the tab (defaults to the active tab in the current window).
2. Calls `injectContentScript(tabId, {allFrames})`.
3. Sends `EXTRACT_IMAGES` to frame 0 and (if `searchAllFrames`)
   iterates every sub-frame, deduplicating by URL.
4. Toggles `START_LIVE_MONITOR` / `STOP_LIVE_MONITOR` based on the
   `liveMonitoring` flag.

`processMultiTabExtract(tabIds[])` is the **Pro multi-tab orchestrator**.
It runs sequentially (not parallel — Chrome rate-limits concurrent
`scripting.executeScript` calls per tab and parallelism causes
flakiness), wraps each tab in a 15 s timeout, and broadcasts
`DOWNLOAD_PROGRESS` after every tab so the modal progress bar can
advance.

### `display-mode.ts` — Side Panel vs Popup

Switching between modes is more subtle than it looks. Side Panel mode
sets `action.setPopup({popup: ''})` (empty string disables the popup) and
`sidePanel.setPanelBehavior({openPanelOnActionClick: true})`. Popup mode
sets `action.setPopup({popup: 'pages/popup.html'})` and
`sidePanel.setOptions({enabled: false})`.

The trickiest part is **per-tab state**: `chrome.sidePanel.setOptions`
takes an optional `tabId` so the panel can be enabled/disabled per
tab. We listen on `tabs.onActivated` and re-apply the global mode on
every tab switch, otherwise a recently-popped tab would keep its
side-panel-disabled flag forever.

### `license.ts` — periodic re-verification

A single `chrome.alarms.create('license-check', {periodInMinutes: 1440})`
schedules a daily round-trip to the license API. The handler reads
`chrome.storage.local.licenseData`, calls `validateLicenseRemote`, and
either updates `lastVerified` (still active) or flips `status` to
`'expired'` if the server says so. Network failures **don't change local
state** — the 7-day offline grace period (in `shared/license.ts >
isProUser`) takes care of legitimate offline users.

### `reverse-search.ts` — proxy fetches that bypass page CORS

Two endpoints:

- **`FETCH_IMAGE_DATA`** — the panel asks the SW to fetch an image URL
  and return a base64 data URL. This works because the SW has
  `host_permissions: ['<all_urls>']` and is therefore not subject to
  the page's CSP / CORS. Used by ZIP download for cross-origin images.
- **`REVERSE_SEARCH_UPLOAD`** — multipart upload to the search engine's
  upload endpoint, returning the redirect URL the panel then opens in
  a new tab.

## 6. `content/` — In-Page Extraction

The content script runs in the **isolated world** of the target page —
it sees the same DOM the page sees but cannot read the page's JS
variables. This isolation is what makes the extension safe against
page-injected scripts; it also means we cannot rely on page-defined
helpers and must reach for `getComputedStyle` whenever inline styles
might be inadequate.

### `main.ts` — the 14-stage extraction pipeline

`extractImages()` runs 14 stages in this exact order:

| #   | Stage                                                                                  | What it catches                                                                              |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `<img>` tags                                                                           | `src`, `srcset`, `currentSrc`, `data-src`/`data-original`/`data-lazy*`                       |
| 2   | Background images                                                                      | Inline `style="background-image:..."` and computed `getComputedStyle(el).backgroundImage`    |
| 3   | `<picture>` / `<source>`                                                               | Per-source `srcset` resolutions                                                              |
| 4   | Stylesheet rules                                                                       | Cross-origin stylesheets are skipped (CORS); same-origin walked via `CSSStyleSheet.cssRules` |
| 5   | Inline `<svg>`                                                                         | Serialized via `XMLSerializer` → data URL                                                    |
| 6   | `<canvas>`                                                                             | `toDataURL` (skips if too small or `SecurityError`)                                          |
| 7   | `<video poster>`                                                                       | The poster attribute, treated as an image                                                    |
| 8   | `<input type="image">`                                                                 | The `src` attribute                                                                          |
| 9   | `<object>` / `<embed>`                                                                 | When `type` starts with `image/`                                                             |
| 10  | `<link rel="icon"/"apple-touch-icon">` and `<meta property="og:image"/twitter:image*>` | Page metadata images (skip-highlight tagged)                                                 |
| 11  | CSS `content: url(...)`                                                                | `::before` / `::after` pseudo-element images                                                 |
| 12  | Lazy-load extras                                                                       | `data-bg`, `data-srcset`, picture-source `data-src*`                                         |
| 13  | Shadow DOM                                                                             | `extractFromShadowDom` walks every open shadow root                                          |
| 14  | Iframes                                                                                | Same-origin only; cross-origin iframes are silently skipped                                  |

After stage 14 the deduplicated `images.values()` array is capped at
`LIMITS.MAX_IMAGES_PER_SCAN` (1000) and returned.

**Streaming via `sendDiscoveredImages`**: at the end of each stage that
discovers images, the array is also pushed via
`chrome.runtime.sendMessage({type: IMAGES_DISCOVERED, images})`. The
panel renders immediately; this is what makes scans feel instant on
image-heavy pages.

### `state.ts` — shared module state

A small module-level mutable bag:

```ts
state = {
  isExtracting: false,
  seenUrls: new Set<string>(), // dedup across all 14 stages
  liveObserver: null, // MutationObserver | null
  highlightedElements: new Map(), // url → wrapper element
  fabContainer: null, // legacy FAB (deprecated, kept for back-compat no-op)
};
```

**`isExtensionContextValid()`** is the most-called helper in the file.
After a "Reload extension" in `chrome://extensions`, content scripts
that were already injected become orphans — `chrome.runtime.id` throws
when accessed. Every public entry point must guard with this helper or
the user sees red errors in their page DevTools.

### `monitor.ts` — MutationObserver live monitoring (Pro)

Live monitoring observes `document.body` (or `document.documentElement`
fallback) with `{childList:true, subtree:true, attributes:true,
attributeFilter:['src','style','srcset']}`. Mutations are accumulated in
a buffer and flushed on a debounced timer (default 500 ms); each flush
calls `extractFromNode` on every added element and emits
`IMAGES_DISCOVERED` for any newly-found URLs.

**Buffering vs plain debounce**: a plain debounce would discard earlier
mutation batches. We accumulate so a burst of insertions during the
debounce window all get processed; only the **handler call** is
debounced, not the data.

**Lazy-load handling**: when `extractFromNode` finds an `<img>` whose
`naturalWidth === 0`, it attaches a one-shot `load` listener that
re-extracts on actual load — without this, lazyload libraries that
mount the `<img>` blank and set `src` later would only deliver
`{naturalWidth:0, naturalHeight:0}` to the panel.

### `highlight.ts` — in-page image highlighting

When the user checks a card in the panel, the panel sends
`HIGHLIGHT_IMAGE` to the content script. `findImageElement(url)` runs a
12-section URL→element matcher (`<img src>`, `<img srcset>`,
`<picture><source>`, CSS background, `::before` content, link/meta,
shadow DOM, etc.) and wraps the first match in a positioned overlay
with a colored border. `auto-scroll` brings it into view via
`element.scrollIntoView({behavior:'smooth', block:'center'})`.

`HIGHLIGHT_IMAGES` (plural) is the **batch** Pro-only equivalent:
re-uses `findImageElement` for every URL in a single pass.

### `extract-advanced.ts` & `shadow-iframe.ts`

Pure helpers split out of `main.ts` to keep that file readable. Each
exported function follows the same shape:

```ts
export async function extractXxxImages(images: Map<string, ImageItem>): Promise<void>;
```

They mutate the shared `images` Map directly (instead of returning a
fresh array) so the dedup-by-URL contract is enforced at the only
write site.

## 7. `sidepanel/` — UI Layer

`sidepanel/` is the largest folder in the repo (~250 kB of TypeScript +
TSX). It hosts both the Side Panel and Popup runtimes via the same
`init.ts` entry. The folder mixes **legacy imperative modules** (the
original 2024 codebase) with **new Preact components** (added when
modal-shaped UI got too painful to do imperatively).

### `init.ts` — the boot orchestrator

A single 1100+ line IIFE that runs on `DOMContentLoaded`. The boot
sequence is:

1. Detect popup vs side-panel via `window.location.pathname`.
2. `await detectLocale()` — block on i18n catalogue load so `t()` calls
   later in boot return the right language.
3. Seed telemetry envelope (version / locale / plan / A/B bucket).
4. Fire `EXTENSION_FIRST_OPEN` event exactly once per install (gated by
   `_telemetry_first_open_at` flag in `chrome.storage.local`).
5. Show the **privacy opt-in modal** if the user has never decided
   (gated by `_telemetry_opt_in_decided` flag).
6. `mountPreactComponents()` — swaps mount points for every modal /
   indicator before any other code reads DOM refs.
7. `cacheElements()` — populates `elements: {[key]: HTMLElement}` so
   imperative modules don't repeat `document.querySelector` calls.
8. `loadSettings()` → apply theme + density + live-monitor indicator.
9. `bindEvents()` — wires every legacy click handler.
10. Connect long-lived port: `chrome.runtime.connect({name:
'image-harvest-ui'})`.
11. Listen on `tabs.onActivated` + `tabs.onUpdated` (side panel only —
    popups die on focus loss).
12. `loadCurrentTab(false, true)` — kick off the first scan.

The order matters. Move step 6 below step 9 and bindings target stale
DOM nodes; move step 2 below step 5 and the privacy modal renders in
English regardless of user locale.

### `state.ts` — the global mutable bag

`state` is a plain object exported from this module. Mutations are
direct (`state.foo = bar`); Preact components observe via
`useStore(selector)` (in `components/storeHook.ts`) which subscribes to
a tiny pub/sub layer.

The most consequential fields:

| Field                     | Type                           | Why it matters                                                                                |
| ------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `currentTabId`            | `number \| null`               | Active tab the panel mirrors. Null on restricted pages.                                       |
| `discoveredImages`        | `ImageItem[]`                  | Authoritative scan result, post-dedup.                                                        |
| `discoveredColors`        | `string[]`                     | Aggregated dominant colors across all images for the color filter swatches.                   |
| `selectedIds`             | `Set<string>`                  | Selected image ids; drives highlight + download.                                              |
| `tabCache`                | `Map<number, ImageItem[]>`     | In-memory mirror of `chrome.storage.session` per-tab cache (avoids round-trip on tab switch). |
| `appSettings`             | `AppSettings`                  | Latest persisted settings (filters live separately in `filterConfig`).                        |
| `currentSortMode`         | `SortMode`                     | One of `size-desc \| size-asc \| filesize-desc \| filesize-asc \| type \| natural`.           |
| `lastRenderedFilteredIds` | `string[] \| null`             | Cache key for `applyFilters` short-circuit; null forces re-render.                            |
| `proInfo`                 | `ProUserInfo`                  | Latest license check; gates Pro UI affordances.                                               |
| `scanProgress`            | `{indeterminate, done, total}` | Drives the scan overlay's progress bar.                                                       |
| `*ModalState`             | Modal-specific shapes          | Preact components read this; setting it open=true triggers render.                            |

`elements` is the parallel sibling: a typed cache of `HTMLElement`
refs populated by `cacheElements()`. Reading from `elements` is ~20×
faster than re-querying the DOM and avoids stale-ref bugs after
`mountPreactComponents()` swaps nodes.

### Imperative modules vs Preact components

| Concern                                         | Belongs in                         | Example                                        |
| ----------------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Toolbar buttons, filter chips                   | Imperative `*.ts` + `bindEvents()` | `sidepanel/settings.ts > toggleFilterDropdown` |
| Image grid render loop                          | Preact `ImageGrid.tsx` (virtua)    | virtualized list of 1000+ cards                |
| Modals (settings, multi-tab, dedup, collection) | Preact `*Modal.tsx`                | `SettingsModal.tsx`, `MultitabModal.tsx`, etc. |
| Toasts, badges, indicators                      | Preact `*.tsx`                     | `ToastContainer.tsx`, `LiveIndicator.tsx`      |
| Privacy / Pro upsell                            | Preact `*Modal.tsx`                | `PrivacyOptInModal.tsx`, `ProUpgradeModal.tsx` |

The boundary is "components that own complex internal state should be
Preact; everything else stays vanilla". Don't migrate vanilla code to
Preact for the sake of consistency — bundle budget is a hard constraint.

### Lazy-loaded Pro modules

`pro-features.ts` is the single dispatcher for Pro feature entry
points. Each one uses dynamic `import()`:

```ts
export async function showCollectionModal(): Promise<void> {
  const { showCollectionModal: impl } = await import('./collection-ui');
  await impl();
}
```

This pattern keeps `multitab.ts`, `dedup-ui.ts`, `collection-ui.ts`,
`license-ui.ts` (and their dependencies, including `shared/phash.ts`
and `shared/collection.ts`) **out of the initial `init.js` chunk**.
The price the user pays is one extra fetch (cached forever) the first
time they open a Pro modal — typically <50 ms over a fast connection.

### `scan.ts` — the scan state machine

Owns the scan overlay (full-screen "Scanning…" spinner with progress
bar and Cancel button) and the `fetchImages` orchestration. Key
responsibilities:

- **`showScanOverlay({title, indeterminate})`** — render overlay; flips
  `state.scanProgress.indeterminate` to true so the spinner spins
  before the first `IMAGES_DISCOVERED` arrives.
- **`updateScanProgress({done, total})`** — incremental progress, used
  for both single-tab post-scan extras (color, pHash) and multi-tab
  `DOWNLOAD_PROGRESS` broadcasts.
- **`handleScanCancel()`** — sets `state.scanAborted = true`,
  `clearTimeout` on any pending debounces, and silently drops further
  `IMAGES_DISCOVERED` events for this scan.
- **`fetchImages` / `silentRescan` / `rescanWithProgress`** — the three
  scan triggers; differ only in whether they show the overlay and
  whether they show a "From cache" toast.
- **`processImageExtras`** — post-scan loop that fetches each image's
  byte content (with `LIMITS.CONCURRENT_FETCHES = 3` parallelism), runs
  color extraction + pHash, and patches the card in place.

## 8. `pages/` — HTML Entry Points

Three HTML files become Vite entry points; one (`_shared-body.html`) is
a partial that the others include via the custom `vite-html-include`
plugin.

### `_shared-body.html` — the shared markup

A 70+ kB partial containing the entire toolbar / filter bar / image
grid scaffold. Both `sidepanel.html` and `popup.html` consume it via:

```html
<!-- @include _shared-body.html -->
```

`vite-html-include.ts` runs **before crxjs** so the macro is expanded
before crxjs's HTML analyzer parses entry points. Without this ordering
crxjs would see `<!-- @include … -->` as a literal comment and the panel
would render an empty body.

The trade-off: any markup change must be reviewed twice (once for
sidepanel layout, once for popup layout), since both shells render the
same DOM but at very different widths.

### `sidepanel.html`

A thin shell:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../css/variables.css" />
    <link rel="stylesheet" href="../css/base.css" />
    <!-- … other css/*.css … -->
  </head>
  <body>
    <!-- @include _shared-body.html -->
    <script type="module" src="../sidepanel/init.ts"></script>
  </body>
</html>
```

Side Panel boots the moment Chrome opens the panel (toolbar icon click
or `Ctrl+Shift+S`). It survives tab switches; `init.ts` listens on
`tabs.onActivated` and re-runs `loadCurrentTab` per switch.

### `popup.html` + `popup.ts`

The popup variant uses the same `_shared-body.html` and the same
`init.ts` entry, plus a tiny `popup.ts` that:

1. Adds `body.popup-mode` for `popup.css` overrides (fixed 620 × 600).
2. Disables tab-switch listeners (popups die on focus loss anyway).
3. Adjusts `--scrollbar-gutter` so the right edge doesn't jitter when
   modals open.

`popup.css` only ships in popup mode (separate Vite entry); the side
panel pays nothing for popup-specific styles.

### `reverse-search.html` + `reverse-search.ts`

A standalone tab opened by the side panel via `chrome.tabs.create({url:
'pages/reverse-search.html?engine=google&imageUrl=…'})` when the user
right-clicks an image and picks "Reverse search". The page:

1. Reads `engine` and `imageUrl` from query string.
2. If the engine accepts a URL directly (Google Lens / TinEye),
   `window.location` redirects to the engine's prebuilt URL.
3. If the engine requires a multipart upload (legacy Baidu fallback),
   posts to `REVERSE_SEARCH_UPLOAD` and redirects to the returned URL.

This page exists only because Manifest V3 forbids redirecting from a
content script to an arbitrary external URL with `chrome.tabs.update`
when the destination requires referrer headers the engine wants to
trust. Routing through an extension page sets the referrer header to
the extension's own origin, which all four supported engines treat as
valid.

## 9. `shared/` — Single Source of Truth

`shared/` modules **must not** import anything from `background/`,
`content/`, `sidepanel/`, or `pages/`. The dependency graph is strictly
one-way:

```
   background ──┐
   content    ──┼──► shared
   sidepanel  ──┤
   pages      ──┘
```

This restriction is what allows the same code to ship to all three MV3
runtimes without bundle duplication.

### Module-by-module

| File                     | Public API                                                                                                                                                                                   | Notes                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`               | All TS interfaces (`ImageItem`, `AppSettings`, `LicenseData`, `Telemetry*`)                                                                                                                  | No runtime code.                                                                                                                           |
| `constants.ts`           | `MESSAGE_TYPES`, `STORAGE_KEYS`, `LIMITS`, `FREE_LIMITS`, `PRICING`, `LICENSE_*`, `TELEMETRY_*`, `SEARCH_ENGINES`, `NAMING_VARIABLES`                                                        | Every literal a wire-format consumer reads.                                                                                                |
| `storage.ts`             | `getFilterConfig` / `saveFilterConfig` / `getDownloadHistory` / `addDownloadRecord` / `getAppSettings` / `saveAppSettings` / `getTabImageCache` / `saveTabImageCache` / `setDisplayMode` / … | Wraps `chrome.storage.{sync,local,session}`; defensively merges with defaults.                                                             |
| `utils.ts`               | `resolveUrl`, `getDomain`, `getFileFormat`, `isDataUri`, `isImageDataUri`, `generateDataUriKey`, `extractBackgroundUrls`, `isGradient`, `isRestrictedUrl`, `deepMerge`, `generateId`, …      | Pure, framework-free. 100% test coverage.                                                                                                  |
| `converter.ts`           | `convertImage(blob, target)` returns `{dataUrl, blob, format}`                                                                                                                               | Canvas API; falls back to PNG when `toBlob` returns null.                                                                                  |
| `naming.ts`              | `applyNamingTemplate(template, vars)`                                                                                                                                                        | Replaces `{index}`, `{original}`, `{title}`, `{domain}`, `{width}`, `{height}`, `{format}`, `{date}`, `{timestamp}`, `{number}`.           |
| `phash.ts`               | `computePhash(imageData)` returns 64-char binary string; `hammingDistance(a, b)`                                                                                                             | Pure DCT-based perceptual hash, ~1 ms/image at 256×256.                                                                                    |
| `color-extract.ts`       | `extractDominantColors(imageData, k=5)` returns `string[]` of `#RRGGBB`                                                                                                                      | Median-cut quantization.                                                                                                                   |
| `collection.ts`          | `collectionInit / Add / Remove / Update / GetAll / GetById / Search / Export / Clear`                                                                                                        | IndexedDB store `collections` in `ImageSnatcherDB` v1.                                                                                     |
| `license.ts`             | `activateLicense / deactivateLicense / isProUser / getLicenseInfo / validateLicenseRemote / getOrCreateInstanceId`                                                                           | Rounds-trip to `https://image-harvest.kyriewen.cn/api/license/*`.                                                                          |
| `trial.ts`               | `startTrial / isTrialEligible / isTrialActive / getTrialState / reportTrialExpiryIfNeeded`                                                                                                   | One-shot 7-day Pro trial; sentinel in `chrome.storage.local`.                                                                              |
| `telemetry.ts`           | `setOptIn / isOptedIn / track / flushNow / setEnvelopeMeta / __resetForTests`                                                                                                                | Anonymous-only event SDK. **Read this file before adding any new event.**                                                                  |
| `telemetry-events.ts`    | `EVENTS` (the whitelist), `EVENT_PROP_SCHEMAS` (per-event allowed prop keys), `sanitizeEventProps`, `isKnownEvent`                                                                           | The only file that defines what may be sent.                                                                                               |
| `ab-experiment.ts`       | `getProUpsellBucket()` returns `'A' \| 'B'`                                                                                                                                                  | Stable per-install bucket; persisted.                                                                                                      |
| `paywall-state.ts`       | `getPaywallState`, `recordPaywallEvent`, gating helpers                                                                                                                                      | Determines whether the paywall is "soft" (banner) or "hard" (modal) based on user history.                                                 |
| `rating-prompt-state.ts` | `shouldShowRatingPrompt`, `recordRatingPromptShown`, `recordRatingPromptDismissed`                                                                                                           | "Leave a review" trigger logic — gated on N successful downloads + cooldown.                                                               |
| `i18n.ts`                | `detectLocale`, `t(key, vars?)`, `getActiveLocale`                                                                                                                                           | Loads catalogue from `_locales/*/messages.json` (mirrored into `dist/_locales/` by `vite.config.ts > copyStaticAssetsPlugin`).             |
| `referral.ts`            | `getReferralStatus`, `copyReferralLink`, `shareReferralLink`, `claimReferral`, `generateFingerprint`, `matchReferral`                                                                        | Referral/invite system — link sharing, fingerprint matching, reward claiming. Anti-self-referral guard built in. Added in v1.0.6.          |
| `remote-config.ts`       | `fetchRemoteConfig`, `getCachedConfig`, `syncRemoteConfig`                                                                                                                                   | Three-tier cache (memory → chrome.storage → network) with 1h TTL. 8s timeout. `globalThis.__remoteConfig` for sync reads. Added in v1.0.6. |
| `feature-quota.ts`       | `checkFeatureQuota`, `incrementFeatureUsage`, `getAllFeatureQuotas`                                                                                                                          | Monthly/daily soft quota system for Pro features. Replaces hard Pro gates. Auto-resets on period boundary. Added in v1.0.6.                |
| `eagle-free-quota.ts`    | _(empty placeholder)_                                                                                                                                                                        | Monthly Eagle quota removed in v1.0.6; file kept as placeholder. `export {}`.                                                              |

### Why telemetry has its own install id

`shared/telemetry.ts` does **not** read `instanceId` from
`shared/license.ts` even though both files want a stable
per-installation identifier. This is deliberate:

- **Test isolation** — `license.ts` reads `chrome.storage.local` at
  module load, which forces every telemetry consumer (including unit
  tests under node) to mock `chrome.*`. Owning the id locally means
  the SDK routes through a test-injectable `StorageAdapter`.
- **Privacy review surface area** — the on-the-wire identifier is a
  truncated SHA-256 of the source string. It doesn't matter which raw
  string is hashed; what matters is that a privacy auditor can read
  the entire identity flow inside one file.

## 10. IPC Protocol Reference

The single source of truth for message names is
`shared/constants.ts > MESSAGE_TYPES`. Every cross-runtime call goes
through `chrome.runtime.sendMessage` (request/response) or
`port.postMessage` over the long-lived `'image-harvest-ui'` port
(broadcast). The table below documents every wire contract.

### Side Panel / Popup → Background (request/response)

| Message                 | Request shape                                 | Response shape                         | Owner handler                        |
| ----------------------- | --------------------------------------------- | -------------------------------------- | ------------------------------------ |
| `GET_IMAGES`            | `{tabId?, searchAllFrames?, liveMonitoring?}` | `{success, images: ImageItem[]}`       | `extractor.getImagesFromTab`         |
| `GET_HISTORY`           | `{}`                                          | `{success, history: DownloadRecord[]}` | `storage.getDownloadHistory`         |
| `CLEAR_HISTORY`         | `{}`                                          | `{success}`                            | `storage.clearDownloadHistory`       |
| `GET_FILTER_CONFIG`     | `{}`                                          | `{success, config: FilterConfig}`      | `storage.getFilterConfig`            |
| `SAVE_FILTER_CONFIG`    | `{config: FilterConfig}`                      | `{success}`                            | `storage.saveFilterConfig`           |
| `SET_DISPLAY_MODE`      | `{useSidePanel: boolean}`                     | `{success}`                            | `display-mode.applyDisplayMode`      |
| `MULTI_TAB_EXTRACT`     | `{tabIds: number[]}`                          | `{success, images, tabCount}`          | `extractor.processMultiTabExtract`   |
| `FETCH_IMAGE_DATA`      | `{url: string}`                               | `{success, dataUrl, contentType}`      | `reverse-search.fetchImageData`      |
| `REVERSE_SEARCH_UPLOAD` | `{engine, imageUrl}`                          | `{success, redirectUrl}`               | `reverse-search.reverseSearchUpload` |
| `HIGHLIGHT_IMAGE`       | `{tabId?, imageUrl}`                          | `{success, found}`                     | proxied to content script            |
| `UNHIGHLIGHT_IMAGE`     | `{tabId?, imageUrl}`                          | `{success}`                            | proxied to content script            |
| `HIGHLIGHT_IMAGES`      | `{tabId?, imageUrls: string[]}`               | `{success}`                            | proxied to content script            |
| `REMOVE_HIGHLIGHT`      | `{tabId?}`                                    | `{success}`                            | proxied to content script            |
| `SIDE_PANEL_OPENED`     | `{tabId}`                                     | `{success}`                            | tracks in `sidePanelOpenedTabs` Set  |
| `SIDE_PANEL_CLOSED`     | `{tabId}`                                     | `{success}`                            | drops from `sidePanelOpenedTabs`     |
| `ACTIVATE_LICENSE`      | `{licenseKey}`                                | `{success, plan, expiresAt, error?}`   | `license.activateLicense`            |
| `DEACTIVATE_LICENSE`    | `{}`                                          | `{success}`                            | `license.deactivateLicense`          |
| `VALIDATE_LICENSE`      | `{}`                                          | `{success, status, plan, expiresAt}`   | `license.validateLicense`            |
| `GET_LICENSE_STATUS`    | `{}`                                          | `{success, info: ProUserInfo}`         | `license.getLicenseInfo`             |

### Background → Content Script

| Message              | Request shape              | Response shape                   | Owner handler                             |
| -------------------- | -------------------------- | -------------------------------- | ----------------------------------------- |
| `EXTRACT_IMAGES`     | `{skipIframes?}`           | `{success, images: ImageItem[]}` | `content/main.extractImages`              |
| `START_LIVE_MONITOR` | `{config?: {debounceMs?}}` | `{success}`                      | `content/monitor.startLiveMonitoring`     |
| `STOP_LIVE_MONITOR`  | `{}`                       | `{success}`                      | `content/monitor.stopLiveMonitoring`      |
| `HIGHLIGHT_IMAGE`    | `{imageUrl}`               | `{success, found}`               | `content/highlight.addHighlight`          |
| `UNHIGHLIGHT_IMAGE`  | `{imageUrl}`               | `{success}`                      | `content/highlight.removeSingleHighlight` |
| `HIGHLIGHT_IMAGES`   | `{imageUrls: string[]}`    | `{success}`                      | `content/highlight.syncHighlights`        |
| `REMOVE_HIGHLIGHT`   | `{}`                       | `{success}`                      | `content/highlight.removeAllHighlights`   |
| `PING`               | `{}`                       | `{type: PONG}`                   | injection liveness probe                  |
| `TOGGLE_FAB`         | `{}`                       | `{success}`                      | deprecated no-op (kept for back-compat)   |

### Content Script → Background (broadcast / fire-and-forget)

| Message             | Shape                         | Behavior                                                                                           |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `IMAGES_DISCOVERED` | `{type, images: ImageItem[]}` | Background re-broadcasts to every connected `image-harvest-ui` port (i.e. every open panel/popup). |
| `EXTRACTION_ERROR`  | `{type, error, code?}`        | Same broadcast; panel surfaces as a toast.                                                         |

### Background → Side Panel / Popup (broadcast over port)

| Message                      | Shape                                     | Triggered by                                                           |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `IMAGES_DISCOVERED`          | `{images, fromTabId}`                     | Re-broadcast of content script discovery events                        |
| `DOWNLOAD_PROGRESS`          | `{completed, total, current, imageCount}` | `extractor.processMultiTabExtract` per-tab                             |
| `DOWNLOAD_COMPLETE`          | `{count}`                                 | After ZIP download finalizes                                           |
| `DOWNLOAD_ERROR`             | `{error}`                                 | When `chrome.downloads.download` rejects                               |
| `LICENSE_STATUS_CHANGED`     | `{info: ProUserInfo}`                     | After `license.ts > onAlarm` flips status                              |
| `MULTI_TAB_EXTRACT_COMPLETE` | `{images, tabCount}`                      | `extractor.processMultiTabExtract` final                               |
| `MULTI_TAB_EXTRACT_ERROR`    | `{error}`                                 | Multi-tab orchestration failure                                        |
| `CLEAR_SELECTION`            | `{type}`                                  | Triggered when content script tells the panel to drop selection (rare) |

### Error envelope conventions

Every response from the background is shaped as:

```ts
type Response<T> =
  | ({ success: true } & T)
  | { success: false; error: string; code?: ErrorCode; workaround?: string };
```

`ErrorCode` is one of `CSP_BLOCKED | TIMEOUT | CORS_DENIED |
MEMORY_LIMIT | NO_IMAGES | INJECTION_FAILED` (`shared/constants.ts >
ERROR_CODES`). Side panel UI maps each code to a user-friendly message
in `_locales/*/messages.json`; `workaround` (when present) is shown
verbatim in the toast.

## 11. Storage Layout

The extension persists state across **four** separate storage areas.
Knowing which area owns which key is the key to understanding behavior
across reloads, sync, and incognito.

### `chrome.storage.sync` (cross-device, ~100 kB cap)

Used only for filter preferences that the user expects to follow them
across machines.

| Key            | Shape          | Owner                            |
| -------------- | -------------- | -------------------------------- |
| `filterConfig` | `FilterConfig` | `storage.{get,save}FilterConfig` |

### `chrome.storage.local` (per-machine, ~10 MB cap)

The bulk of persistent state.

| Key                         | Shape                                  | Owner                                           | Notes                                                                   |
| --------------------------- | -------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `appSettings`               | `AppSettings`                          | `storage.{get,save}AppSettings`                 | Theme / density / display mode / live-monitoring / size limits          |
| `downloadHistory`           | `DownloadRecord[]`                     | `storage.{get,add,remove,clear}DownloadHistory` | Capped at `LIMITS.MAX_DOWNLOAD_HISTORY = 20`                            |
| `licenseData`               | `LicenseData`                          | `license.{save,get,clear}LicenseData`           | Pro plan, expiry, instance id, last verified                            |
| `instanceId`                | `string`                               | `license.getOrCreateInstanceId`                 | Stable per-install id for license activation                            |
| `telemetryOptIn`            | `boolean`                              | `telemetry.{is,set}OptIn`                       | Defaults to `true` until user makes an explicit choice                  |
| `telemetryQueue`            | `TelemetryEvent[]`                     | internal to telemetry SDK                       | Persisted retry queue; capped at `TELEMETRY_MAX_QUEUE = 100`            |
| `telemetryInstanceHash`     | `string`                               | internal to telemetry SDK                       | SHA-256 truncated; never sent raw                                       |
| `telemetryInstanceId`       | `string`                               | internal to telemetry SDK                       | Source of the hash; **never sent**                                      |
| `_telemetry_first_open_at`  | `number`                               | `sidepanel/init.ts`                             | Timestamp of first successful boot — gates `EXTENSION_FIRST_OPEN` event |
| `_telemetry_opt_in_decided` | `boolean`                              | `PrivacyOptInModal`                             | Set to `true` on first user choice; gates the modal                     |
| `trialState`                | `{startedAt, expiresAt}`               | `shared/trial.ts`                               | One-shot 7-day Pro trial sentinel                                       |
| `proUpsellBucket`           | `'A' \| 'B'`                           | `shared/ab-experiment.ts`                       | Stable A/B bucket per install                                           |
| `paywallState`              | `{lastShownAt, dismissals, ...}`       | `shared/paywall-state.ts`                       | Soft vs hard paywall escalation tracking                                |
| `ratingPromptState`         | `{lastShownAt, dismissals, downloads}` | `shared/rating-prompt-state.ts`                 | "Leave a review" cooldown                                               |

### `chrome.storage.session` (in-memory, cleared on browser restart)

Used as a fast cache for state that should survive panel close/reopen
but not browser restart.

| Key                   | Shape                | Owner                                   | Notes                                           |
| --------------------- | -------------------- | --------------------------------------- | ----------------------------------------------- |
| `sessionState`        | `unknown`            | `storage.{save,get,clear}SessionState`  | Reserved; not currently written by core code    |
| `tabImgCache_<tabId>` | `TabImageCacheEntry` | `storage.{save,get,clear}TabImageCache` | Per-tab `{url, timestamp, images: ImageItem[]}` |

### IndexedDB — `ImageSnatcherDB`

| DB                | Store         | Schema v | Owner                  |
| ----------------- | ------------- | -------- | ---------------------- |
| `ImageSnatcherDB` | `collections` | 1        | `shared/collection.ts` |

Indexes: `tags` (multiEntry), `sourceUrl`, `createdAt`. Records are the
`CollectionItem` shape including `Blob` thumbnail + full image
fields. Free tier is capped at `FREE_LIMITS.MAX_COLLECTION_ITEMS = 5`
client-side; Pro is unlimited (subject to browser disk quota).

### State that is **never** persisted

- `state.discoveredImages`, `state.selectedIds`, `state.tabCache` —
  side-panel runtime only; rebuilt on next scan.
- `state.scanProgress`, `state.*ModalState` — UI ephemeral.
- The `uiPorts: Set<chrome.runtime.Port>` in the background SW —
  rebuilt every time the SW wakes.

## 12. State Machines

Three subsystems maintain non-trivial state machines worth diagramming.

### 12.1 Scan lifecycle (`sidepanel/scan.ts`)

```
                                  ┌────────────────────────┐
                                  │       IDLE             │
                                  │  (no overlay shown)    │
                                  └──────────┬─────────────┘
                                             │ user opens panel /
                                             │ tab change / manual rescan
                                             ▼
                                  ┌────────────────────────┐
                                  │   SCANNING             │
            ┌─────────────────────│   {indeterminate:true} │
            │                     └──────────┬─────────────┘
            │                                │ first IMAGES_DISCOVERED arrives
            │                                ▼
            │                     ┌────────────────────────┐
            │  user clicks Cancel │   STREAMING            │
            ├─────────────────────│   {done, total}        │
            │                     │   incremental render   │
            │                     └──────────┬─────────────┘
            │                                │ extractImages() resolves
            ▼                                ▼
   ┌───────────────────┐         ┌────────────────────────┐
   │   ABORTED         │         │  POST_SCAN_EXTRAS      │
   │   (silently drop  │         │  (fetch + pHash +      │
   │    further events)│         │   color, 3-parallel)   │
   └─────────┬─────────┘         └──────────┬─────────────┘
             │                              │ all extras done
             ▼                              ▼
   ┌───────────────────┐         ┌────────────────────────┐
   │      IDLE         │◄────────│        IDLE            │
   │  (overlay hidden) │         │   render finalized     │
   └───────────────────┘         └────────────────────────┘
```

State transitions are tracked via `state.scanAborted`,
`state.scanProgress.{indeterminate,done,total}`, and `state.isExtracting`.

### 12.2 License state (`shared/license.ts > isProUser`)

```
                  ┌────────────────────────┐
                  │   No licenseData       │
                  │   → isPro = false      │
                  └──────────┬─────────────┘
                             │ activateLicense() succeeds
                             ▼
                  ┌────────────────────────┐
                  │   ACTIVE               │
                  │   lastVerified within  │
                  │   24h?                 │
                  └──────────┬─────────────┘
                             │ stale (>24h)
                             ▼
                  ┌────────────────────────┐
              ┌───│   RE-VERIFY (network)  │
              │   └──────────┬─────────────┘
              │              │
       network│              │success=valid
       failed │              ▼
              │   ┌────────────────────────┐
              │   │   ACTIVE (renewed)     │
              │   └────────────────────────┘
              │
              │              ┌────────────────────────┐
              │              │   GRACE PERIOD         │
              └─────────────►│   stale + offline      │
                             │   AND <7d since last   │
                             │   successful verify    │
                             │   → isPro = true       │
                             └──────────┬─────────────┘
                                        │ >7d offline
                                        ▼
                             ┌────────────────────────┐
                             │   EXPIRED              │
                             │   → isPro = false      │
                             └────────────────────────┘
```

Constants live in `shared/constants.ts`:
`LICENSE_CHECK_INTERVAL = 24h`, `LICENSE_GRACE_PERIOD = 7d`,
`MAX_LICENSE_INSTANCES = 1`.

### 12.3 Telemetry queue (`shared/telemetry.ts`)

```
   track(name, props)
        │
        ▼
   isOptedIn() ?
        │ no  → silent return
        │ yes
        ▼
   isKnownEvent(name) ?
        │ no  → console.warn + drop
        │ yes
        ▼
   sanitizeEventProps(name, props)
        │
        ▼
   queue.push({event, ts, props})
        │
        ├──► queue.length >= 20 ? → flushNow() (high-water mark)
        │
        └──► scheduleFlush(5s)
                    │
                    ▼
              flush window elapses
                    │
                    ▼
              sendBatch(events)
                    │
                    ├── 200 OK    → drainRetryQueue() (also flushes any earlier failures)
                    │
                    └── network/5xx → persistForRetry(events) → cap at 100 events
```

Opt-out (`setOptIn(false)`) immediately:

1. Sets `optInCache = false`.
2. Persists to storage.
3. Drops the in-memory queue.
4. Clears any pending `flushTimer`.
5. Removes the persisted retry queue.

After this, every subsequent `track()` is a synchronous no-op until
`setOptIn(true)` is explicitly called again.

## 13. Pro / License Model

The Pro story has three layers: **gating**, **activation**, and
**enforcement**. They are deliberately decoupled so a network outage
can't lock a paying customer out of features they paid for.

### Gating: who is "Pro"?

`shared/license.ts > isProUser()` is the single function every UI
gate calls. It returns:

```ts
interface ProUserInfo {
  isPro: boolean;
  plan?: 'monthly' | 'yearly' | 'lifetime' | 'trial' | string | null;
  expiresAt?: number | null;
  status: 'active' | 'expired' | 'inactive';
}
```

The function consults `chrome.storage.local.licenseData` and applies
the state machine in §12.2: a user with stale-but-not-expired data
who's offline still resolves `isPro: true` for up to 7 days.

In the UI, every Pro feature follows the **same code shape**:

```ts
const info = await isProUser();
if (!info.isPro) {
  showProUpgradeModal(/* feature key */);
  track(EVENTS.PRO_UPSELL_SHOWN, { feature: '...' });
  return;
}
// ...actual feature code...
```

`FREE_LIMITS` in `shared/constants.ts` defines the **soft caps** —
e.g. `MAX_ZIP_IMAGES: 30` for Free vs unlimited for Pro. Soft caps
deliberately let the user _experience_ the feature first ("first wow"
strategy) before the upsell trips.

### Activation: turning a key into Pro

User-driven flow (`sidepanel/license-ui.ts`):

1. User pastes a license key into the activation field.
2. Panel sends `ACTIVATE_LICENSE` to background.
3. Background calls `license.activateLicense(key)`:
   - Normalizes key (`.trim().toUpperCase()`).
   - `validateLicenseRemoteSafe(key)` — POST to `…/api/license/verify`.
   - `activateLicenseRemote(key, instanceId)` — POST to `…/api/license/activate`
     with the per-install `instanceId` (so a key can only run on
     `MAX_LICENSE_INSTANCES = 1` machine simultaneously).
   - On success, persist `LicenseData` and broadcast
     `LICENSE_STATUS_CHANGED`.
4. Telemetry: `LICENSE_ACTIVATED` is fired and **immediately
   flushed** (don't wait 5 s — user might close the panel right after).

### Enforcement: what's gated

| Free                                                   | Pro                                               |
| ------------------------------------------------------ | ------------------------------------------------- |
| ZIP cap = 30 images / batch                            | Unlimited                                         |
| Batch URL copy = 20 max                                | Unlimited                                         |
| Collection cap = 5 favorites                           | Unlimited                                         |
| Group modes = `none` + `format`                        | All 5 (`none`, `domain`, `format`, `size`, `tab`) |
| Reverse search = Google + TinEye                       | + Baidu + Yandex                                  |
| ❌ Color filter (free can view, can't filter by color) | ✅                                                |
| ❌ Color copy                                          | ✅                                                |
| ❌ Highlight batch                                     | ✅ Batch + auto-scroll                            |
| ❌ Live monitoring                                     | ✅ MutationObserver                               |
| ❌ Image delete (per-card)                             | ✅                                                |
| ❌ Format conversion                                   | ✅ PNG / JPG / WebP                               |
| ❌ Custom naming template                              | ✅ Full template variables                        |
| ❌ pHash dedup modal                                   | ✅                                                |
| ❌ Multi-tab extract                                   | ✅ Cross-tab                                      |
| ❌ Advanced preview                                    | ✅ Lightbox + metadata panel                      |

### Trial

`shared/trial.ts` exposes a one-shot 7-day trial. The trial sentinel
lives in `chrome.storage.local.trialState`; once redeemed it cannot be
restarted by clearing the local key (the server-side `trials` table
also tracks the install and refuses re-redemption).

During trial, `isProUser()` returns `{isPro: true, plan: 'trial'}` and
the envelope `plan` dimension is `'trial'` — useful for funnel analysis
(`trial → paid` conversion is the single most important rate to
monitor).

## 14. Privacy & Telemetry Pipeline

> The user-facing privacy promise lives in [`PRIVACY.md`](./PRIVACY.md).
> This section documents the **technical implementation** so a privacy
> auditor can verify the promise.

### Hard contract

`shared/telemetry.ts` is constrained by four invariants enforced in code:

1. **Opt-out is immediately silent.** `setOptIn(false)` synchronously
   drops the in-memory queue, clears the on-disk retry queue, and
   cancels the pending flush timer. Every subsequent `track()` is a
   no-op until explicit re-opt-in.
2. **Zero PII on the wire.** The on-the-wire envelope contains only:
   - `instanceIdHash` — SHA-256 of the per-install id, truncated to 16 hex chars.
   - `version` — extension version (e.g. `"1.0.1"`).
   - `lang` — UI locale (e.g. `"zh-CN"`).
   - `plan` — `"free" | "monthly" | "yearly" | "lifetime" | "trial"`.
   - `schemaVersion` — currently `1`.
   - `events: TelemetryEvent[]`.
     No URLs, no page titles, no image URLs/data, no IP (server-side
     discards after country lookup), no user-typed text.
3. **Whitelist-only event names.** `track(name, props)` calls
   `isKnownEvent(name)` against `EVENTS` in
   `shared/telemetry-events.ts` — unknown names are dropped with a
   dev-console warn. Per-event prop schemas (`EVENT_PROP_SCHEMAS`)
   sanitize props down to a known set of primitive values.
4. **Bounded resource usage.** Queue capped at 100 events
   (`TELEMETRY_MAX_QUEUE`); flush window 5 s
   (`TELEMETRY_FLUSH_INTERVAL_MS`); high-water mark 20 events
   (`TELEMETRY_BATCH_SIZE`). A permanent server outage cannot fill
   `chrome.storage.local`.

### What events exist

The full whitelist is in `shared/telemetry-events.ts`. Categories:

- **Lifecycle**: `EXTENSION_INSTALLED`, `EXTENSION_UPDATED`,
  `EXTENSION_FIRST_OPEN`.
- **Scan**: `SCAN_TRIGGERED`, `SCAN_COMPLETED`, `SCAN_CANCELLED`.
- **Download**: `DOWNLOAD_SINGLE`, `DOWNLOAD_BATCH`,
  `DOWNLOAD_FAILED`.
- **Pro funnel**: `PRO_UPSELL_SHOWN`, `PRO_UPSELL_CLICKED`,
  `LICENSE_ACTIVATED`, `LICENSE_DEACTIVATED`, `TRIAL_STARTED`.
- **Settings**: `SETTINGS_CHANGED`, `DISPLAY_MODE_CHANGED`,
  `THEME_CHANGED`.
- **Other features**: `REVERSE_SEARCH_TRIGGERED`,
  `COLLECTION_ADDED`, `MULTITAB_EXTRACT_TRIGGERED`, etc.

Each event's prop schema declares which keys are allowed (e.g.
`{ feature: string, abBucket: 'A' | 'B' }`). `sanitizeEventProps`
strips anything not in the schema.

### Why the install id has its own hash

`telemetryInstanceId` in `chrome.storage.local` is a random base-36
string. On first send, `telemetry.ts` computes
`SHA-256(instanceId).slice(0, 16)` and caches it as
`telemetryInstanceHash`. Only the hash leaves the device. The raw id
is never transmitted; if the user clears extension data, both are
regenerated and become a new "user" from the server's perspective.

This design is intentional: even if the database leaked, no
identifier in it could be correlated back to a Chrome installation
without solving SHA-256 — and even then, `instanceId` itself is a
random string with no link to identity.

### A/B experiments

`shared/ab-experiment.ts` assigns a stable A/B bucket on first
resolve, persisted to `chrome.storage.local.proUpsellBucket`. The
bucket is stamped onto the envelope (`abBucket` field) and auto-injected
into any event whose schema declares `abBucket` as an allowed prop.
This lets the funnel join every conversion event back to the variant
the user was in, without sprinkling `bucket` arguments through every
`track()` call.

## 15. Internationalization (i18n)

The extension speaks **5 languages**: English (`en`, default),
Simplified Chinese (`zh_CN`), Traditional Chinese (`zh_TW`),
Japanese (`ja`), Spanish (`es`).

### Two parallel i18n systems

This is the most common confusion for new contributors:

| System                     | Used by                                                                       | API                                                   | Catalogue                                                             |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| **Chrome MV3 native i18n** | `manifest.config.ts` (extension name & description), Chrome Web Store listing | `__MSG_xxx__` placeholders + `chrome.i18n.getMessage` | `_locales/<lang>/messages.json`                                       |
| **Custom in-bundle i18n**  | All UI strings inside the panel/popup                                         | `t('key', vars?)` from `shared/i18n.ts`               | Same `_locales/<lang>/messages.json` (re-loaded at runtime via fetch) |

We re-use the same JSON file for both systems to keep translation
work in one place. `vite.config.ts > copyStaticAssetsPlugin` mirrors
`_locales/` into `dist/` verbatim so Chrome's i18n machinery still sees
it after the build.

### `shared/i18n.ts` flow

```
detectLocale()
  ├── reads chrome.storage.local.userLocale (explicit user choice wins)
  ├── falls back to chrome.i18n.getUILanguage()
  ├── falls back to navigator.language
  └── defaults to 'en'
       │
       ▼
loadCatalogue(activeLocale)
  ├── fetch('_locales/<locale>/messages.json')
  ├── parse + cache in catalogueCache: Map<locale, messages>
  └── on failure, fall back to 'en' catalogue
       │
       ▼
t('key', {var1: 'value'})
  ├── reads catalogueCache.get(activeLocale)?.[key]?.message
  ├── interpolates `$var1$` → 'value'
  ├── on missing key, returns the literal key (loud failure)
  └── on missing locale, falls through to 'en'
```

### Adding a new string

1. Add the key to `_locales/en/messages.json`:
   ```json
   {
     "myNewLabel": {
       "message": "My label",
       "description": "Used in the foo modal header"
     }
   }
   ```
2. Add translations to the other 4 locales' `messages.json`. Use the
   `description` field to give translators context.
3. Use `t('myNewLabel')` in TS/TSX, or `__MSG_myNewLabel__` in
   `manifest.config.ts` only.
4. The `e2e/i18n-locale-switch.e2e.ts` spec verifies that all 5
   locales render the panel without missing-key fallbacks.

### Adding a new language

Adding a 6th language is a 4-step PR:

1. `mkdir _locales/<new-lang>/` (e.g. `_locales/de/`).
2. Copy `_locales/en/messages.json` and translate every value.
3. Add the locale to the language picker in `sidepanel/settings.ts`.
4. Add an e2e check in `i18n-locale-switch.e2e.ts`.

The locale code must match Chrome's locale strings — see
[Chrome i18n locales](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales).

## 16. Build Pipeline

```
manifest.config.ts ──┐
                     │
shared/*  ──┐        │
content/* ──┤        │
background/*┤────────┼────► Vite + @crxjs/vite-plugin
sidepanel/*─┤        │       │
pages/*  ───┘        │       ├─► dist/
                     │       │   ├── manifest.json     (emitted from manifest.config.ts)
_locales/*  ─────────┘       │   ├── pages/*.html
                             │   ├── icons/*.png
                             │   ├── assets/*.js + *.css + *.png  (hashed)
                             │   └── _locales/*/messages.json  (mirrored verbatim)
                             │
                             ├─► (ANALYZE=1)  dist/stats.html  +  dist/stats.txt
                             │
                             └─► scripts/check-bundle-size.mjs
                                   └─ enforces gzip budgets, fails CI on overrun
```

### Plugin order matters

`vite.config.ts` registers plugins in this order:

1. `htmlIncludePlugin()` — expands `<!-- @include _shared-body.html -->`
   so crxjs's HTML analyzer sees the full body.
2. `crx({ manifest })` — owns content scripts, service worker loader,
   HTML entry analysis, manifest emission.
3. `copyStaticAssetsPlugin()` — mirrors `_locales/` into `dist/`.
4. (optional) `visualizer()` × 2 — only when `ANALYZE=1`; emits
   `stats.html` (treemap) and `stats.txt` (per-source byte breakdown).

### Preact-on-React aliasing

`virtua` (the only third-party Preact-incompatible dep) hard-imports
from `'react'`, `'react-dom'`, and `'react/jsx-runtime'`. The
`resolve.alias` map in `vite.config.ts` reroutes those to
`preact/compat` — only the ~6.6 kB subset of compat that virtua
actually touches ships.

### Bundle layout

After `npm run build`:

```
dist/
├── manifest.json
├── icons/                     ← icon16/32/48/128.png
├── _locales/                  ← 5 languages, mirrored from source
├── pages/
│   ├── popup.html
│   ├── sidepanel.html
│   └── reverse-search.html
└── assets/
    ├── init-XXXXXXXX.js          (~44 kB gzip — sidepanel main entry)
    ├── index.ts-loader-XX.js      ( ~6 kB gzip — background SW)
    ├── main.ts-loader-XX.js       ( ~8 kB gzip — content script)
    ├── popup-XXXXXXXX.js          ( ~2 kB gzip — popup-only delta)
    ├── reverse-search-XX.js       ( ~5 kB gzip — reverse-search page)
    ├── *.css                      (sidepanel + popup CSS bundles)
    └── (lazy chunks: collection-ui, multitab, dedup-ui, jszip, etc.)
```

`scripts/check-bundle-size.mjs` enforces three hard caps:

| Chunk                      | Budget     | Why                                 |
| -------------------------- | ---------- | ----------------------------------- |
| `init.js`                  | 50 kB gzip | Sidepanel first-paint critical path |
| `index.ts.js` (background) | 12 kB gzip | SW cold-start time                  |
| `main.ts.js` (content)     | 14 kB gzip | Per-page injection cost             |

Bumping a budget requires editing the file and citing the reason in
the commit. The CI pipeline fails any PR that goes over without the
intentional bump.

### Dev vs prod

| Command                 | What it does                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | `vite` dev server with HMR — writes `dist/` on every save. Reload the unpacked extension in `chrome://extensions/` to pick up changes; refresh the target page for content-script edits. |
| `npm run build`         | `vite build` → optimized `dist/`                                                                                                                                                         |
| `npm run build:analyze` | `ANALYZE=1 vite build` → also emits `dist/stats.{html,txt}`                                                                                                                              |
| `npm run preview`       | Serves the prod build for sanity-check                                                                                                                                                   |
| `npm run zip`           | Build + zip into `image-harvest-vX.Y.Z.zip` (Web Store ready)                                                                                                                            |

## 17. Performance Budgets

The extension is opened many times per day; latency budgets are taken
seriously. All numbers below are **observed on a 2022 M1 MacBook Air,
warm browser, 50 Mbps connection, default Chrome settings**.

### Boot latency

| Phase                                             | Budget       | Notes                                        |
| ------------------------------------------------- | ------------ | -------------------------------------------- |
| Side panel HTML parse + CSS apply                 | < 50 ms      | Pure HTML, no JS yet                         |
| `init.js` parse + execute                         | < 80 ms      | 44 kB gzip / ~165 kB raw                     |
| `await detectLocale()` (i18n catalogue load)      | < 30 ms      | One `fetch('_locales/<lang>/messages.json')` |
| `cacheElements()` + `bindEvents()` + first render | < 50 ms      | DOM-bound                                    |
| **Total visible-blank → first-paint**             | **< 200 ms** | User-perceived "open speed"                  |

### Scan latency

| Page complexity                    | Budget               | Notes                            |
| ---------------------------------- | -------------------- | -------------------------------- |
| Static page, ~20 images            | < 300 ms             | Stage 1-12 in `extractImages`    |
| Heavy SPA, ~200 images, Shadow DOM | < 1500 ms            | Adds stage 13 traversal cost     |
| Pinterest-class infinite scroll    | first batch < 500 ms | Live monitoring streams the rest |

The `IMAGES_DISCOVERED` streaming pattern is what keeps perceived
latency low — even when the full 1500 ms scan runs, the panel renders
the first cards within 200-300 ms.

### Memory budget

| Resource              | Budget     | Where enforced                     |
| --------------------- | ---------- | ---------------------------------- |
| Thumbnails per scan   | < 50 MB    | `LIMITS.MAX_THUMBNAIL_MEMORY_MB`   |
| Single ZIP archive    | < 500 MB   | `LIMITS.MAX_ZIP_SIZE_MB`           |
| Telemetry retry queue | 100 events | `TELEMETRY_MAX_QUEUE`              |
| Download history      | 20 records | `LIMITS.MAX_DOWNLOAD_HISTORY`      |
| Free-tier collection  | 5 items    | `FREE_LIMITS.MAX_COLLECTION_ITEMS` |

### Bundle size budget

See §16. Three hard caps with CI enforcement.

### Network budget

The extension is **offline-first by design**. Network calls happen only:

| Trigger                                        | Endpoint                                                  | Frequency                                           |
| ---------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| License activation                             | `POST /api/license/verify` + `POST /api/license/activate` | Once per activation                                 |
| Daily license check                            | `POST /api/license/verify`                                | Once / 24h via `chrome.alarms`                      |
| Telemetry batch                                | `POST /api/telemetry`                                     | Every 5s OR every 20 events (only if user opted in) |
| Cross-origin image fetch (during ZIP / extras) | The image's own URL                                       | On user action                                      |
| Reverse search redirect                        | The search engine's URL                                   | On user click                                       |

There is no background polling, no analytics SDK, no third-party SDK.
A user who never activates Pro and opts out of telemetry generates
**zero unsolicited network traffic** from the extension itself.

## 18. Testing Strategy

Two layers of automated tests, plus manual smoke testing on
image-heavy real sites before each release.

### Layer 1: Vitest unit suite (53 files / ~1,345 cases)

| Aspect        | Setting                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| Runner        | Vitest 2                                                                           |
| Env           | node + jsdom (per file glob: `*.test.tsx` → jsdom; `*.test.ts` → node)             |
| Scope         | `shared/`, `background/`, `content/`, `sidepanel/`, `pages/`, Preact components    |
| Coverage gate | All files Lines ≥ 80% (currently 80.00%)                                           |
| Run command   | `npm test` (CI), `npm run test:watch` (dev), `npm run test:coverage` (HTML report) |

#### Mocking conventions

- **`installChromeMock()`** — every test that touches `chrome.*` re-installs
  a fresh mock via this helper (see `tests/_helpers/`).
- **`fake-indexeddb`** for `shared/collection.ts`.
- **`vi.mock()` for sibling modules** — `tests/sidepanel-init.test.tsx`
  mocks 14 sibling modules to isolate the 1100-line IIFE.

#### jsdom limitations (deferred to e2e)

- **Layout never computes** — `offsetWidth` / `offsetHeight` /
  `getBoundingClientRect()` all return 0 unless manually defined via
  `Object.defineProperty`. Branches that depend on real layout (e.g.
  dropdown overflow repositioning) are e2e-only.
- **CSS shorthand serialization** — `style.flex = '0'` round-trips as
  `'0px'`. Assert intent (`toMatch(/...)`) instead of exact strings.

### Layer 2: Playwright e2e (41 specs)

| Aspect         | Setting                                                      |
| -------------- | ------------------------------------------------------------ |
| Runner         | Playwright 1.59                                              |
| Browser        | Headed Chromium via `launchPersistentContext`                |
| Workers        | 1 (MV3 SWs don't init reliably headless / concurrent)        |
| Extension load | Unpacked from `dist/` (you must `npm run build` first)       |
| Run command    | `npm run test:e2e` (full), `npm run test:e2e:ui` (UI runner) |
| CI             | `xvfb-run --auto-servernum npm run test:e2e`                 |

#### Deterministic state pattern

E2e tests opt into a "test mode" by injecting:

```ts
await page.addInitScript(() => {
  window.__IH_E2E__ = true;
});
```

When `init.ts` sees this flag, it exposes `window.__IH__ = { store,
applyFilters, loadMultitab, applyTheme, handleMessage }` so tests
can drive state directly:

```ts
await page.evaluate(() => window.__IH__.store.set({
  discoveredImages: [/* test fixtures */],
  selectedIds: new Set([...])
}));
```

This is **5-10× faster** than clicking through the UI to set up state
and avoids flaky waits on real network/DOM behavior.

#### Smoke tier vs full suite

- `npx playwright test e2e/smoke.e2e.ts` — 3 cases, ~5s. Run before
  every commit.
- `npm run test:e2e` — full 38 specs, ~3-4 minutes. Run before every
  release tag.

### What's deliberately not tested

- Color extraction visual quality (median-cut output) — visual
  regression would need a screenshot baseline; we test the function
  surface only.
- Network failure paths in the license API — server-side concern.
- Real Chrome Web Store install/update flow — manual smoke per
  release.

## 19. Release Pipeline

Releases are **tag-driven**. Pushing a `vX.Y.Z` tag triggers
`.github/workflows/release.yml` which runs the full gate
(`lint + typecheck + test + build`), zips `dist/`, and publishes a
GitHub Release with the zip attached.

### Maintainer flow

```
# 1. Bump version + commit + tag + push (one command)
npm run release:patch     # 1.0.1 → 1.0.2
npm run release:minor     # 1.0.x → 1.1.0
npm run release:major     # 1.x.y → 2.0.0

# 2. CI runs release.yml automatically:
#    - Verifies tag matches package.json version (sanity)
#    - npm ci --legacy-peer-deps
#    - npm run lint / typecheck / test / build
#    - zip dist/ into image-harvest-vX.Y.Z.zip
#    - Create GitHub Release with auto-generated notes

# 3. Manually upload the zip to Chrome Web Store dashboard
#    (Web Store API automation is intentionally not wired up — a human
#     review of the listing is the last sanity check before millions
#     of users get the update.)
```

### What gets versioned where

| Artifact                     | Source                                   | When updated          |
| ---------------------------- | ---------------------------------------- | --------------------- |
| `package.json` version       | `npm version`                            | Every release         |
| `manifest.config.ts` version | reads `package.json`                     | Automatic             |
| `dist/manifest.json` version | emitted by crxjs from manifest.config.ts | At build time         |
| GitHub Release tag           | `git tag vX.Y.Z`                         | `npm version` creates |
| `CHANGELOG.md`               | manually appended                        | Pre-release PR        |
| Chrome Web Store listing     | manual upload                            | Post-release          |

### CI matrix (ci.yml)

Five jobs run in parallel on every push/PR:

| Job         | What                                                         | Time     |
| ----------- | ------------------------------------------------------------ | -------- |
| `lint`      | ESLint + Prettier check                                      | ~20s     |
| `typecheck` | `tsc --noEmit`                                               | ~30s     |
| `test`      | Vitest + coverage upload                                     | ~60s     |
| `build`     | Vite build + bundle-size budget check + dist artifact upload | ~45s     |
| `e2e`       | Playwright (depends on `build`)                              | ~3-4 min |

`concurrency: cancel-in-progress: true` cancels obsolete runs when new
commits land on the same ref.

### What can break a release

The release workflow refuses to publish if:

1. The tag doesn't match `package.json` version (catches `git tag`
   typos).
2. Lint or typecheck fails.
3. Any unit test fails.
4. Bundle-size budget is exceeded.
5. The build itself fails for any reason.

Fix the cause locally, push a new commit, then re-tag (delete the bad
tag locally + remotely first if needed).

## 20. Extending the Project

Recipes for the most common types of contribution.

### Adding a new image source (e.g. `<svg use href>`)

1. Pick the right home: `content/extract-advanced.ts` (most likely)
   or `content/main.ts` (only if it's one of the top-level stages).
2. Implement `async function extractXxx(images: Map<string, ImageItem>): Promise<void>`
   that mutates the shared `images` Map.
3. Register the call in `content/main.ts > extractImages()` at the
   appropriate stage number.
4. Add a stage to `content/monitor.ts > extractFromNode` if the source
   should also be picked up by live monitoring.
5. Add a unit test under `tests/content-extract-advanced.test.tsx`
   with a jsdom DOM fixture.
6. Add an e2e fixture under `e2e/fixtures/` and a spec verifying a
   real Chrome scan picks it up.

### Adding a new download format (e.g. AVIF)

1. Add the format to `shared/types.ts > ConvertibleFormat`.
2. Implement the Canvas-based conversion in `shared/converter.ts`.
   Browser support gate via `HTMLCanvasElement.toBlob` MIME probe.
3. Add the option to the format dropdown in `sidepanel/settings.ts`.
4. Add unit tests for the new MIME path.
5. Update Pro features matrix in `README.md` and this file.

### Adding a Pro feature

1. **Gate it behind `isProUser()`** at the entry point. See `sidepanel/pro-features.ts`
   for the canonical pattern.
2. Track the upsell view: `track(EVENTS.PRO_UPSELL_SHOWN, { feature: 'your-key' })`.
3. Define a Free fallback if the feature has a meaningful "tasting"
   version (see "Sprint 3.5" in `CHANGELOG.md` — `MAX_COLLECTION_ITEMS:
5` is an example).
4. Lazy-load the implementation via dynamic `import()` from
   `pro-features.ts` so the initial bundle stays under budget.
5. Add the feature to the Free vs Pro table in `README.md` and §13.

### Adding a new telemetry event

1. Append to `EVENTS` in `shared/telemetry-events.ts` (the whitelist).
2. Define the prop schema in `EVENT_PROP_SCHEMAS` (allowed prop keys
   and their primitive types).
3. Call `track(EVENTS.YOUR_EVENT, { ... })` from the appropriate
   surface.
4. Add a test verifying the event is emitted with the right shape.
5. **Privacy review**: confirm none of the props could carry PII.
   Strings should be enums (e.g. `'pinterest' | 'unsplash' | 'other'`),
   not raw user input.

### Adding a new language

See §15 — 4-step PR.

### Migrating an imperative file to Preact

1. Identify a self-contained UI surface (a modal works best). Don't
   migrate "the toolbar" wholesale — that's a quagmire.
2. Create the Preact component under `sidepanel/components/`.
3. Replace the imperative DOM-mutating code with a render that reads
   from `useStore(s => s.yourFeatureState)`.
4. Add the mount point to `sidepanel/components/mount.tsx >
mountPreactComponents()`.
5. Update `sidepanel/state.ts` with the new state shape.
6. Update `init.ts` if the new component changes mount-order
   assumptions.
7. **Verify `init.js` gzip size hasn't blown the 50 kB budget.**

## 21. Glossary

| Term                      | Definition                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MV3**                   | Manifest V3 — the latest Chrome extension manifest standard. Banned dynamic `eval`, swapped persistent background pages for ephemeral service workers.                       |
| **Service Worker (SW)**   | The background context. Spun up on demand, killed after ~30s idle, has full `chrome.*` API access but no DOM.                                                                |
| **Content Script**        | The page-injected script. Runs in an isolated world (sees DOM but not page JS), cannot call `chrome.tabs.*`.                                                                 |
| **Side Panel**            | Chrome's persistent side-panel UI (Chrome 114+). Sticks around across tab switches.                                                                                          |
| **Popup**                 | The classic toolbar popup that dies on focus loss.                                                                                                                           |
| **`@crxjs/vite-plugin`**  | Vite plugin that handles MV3 quirks (manifest emission, content-script bundling, HMR). Currently on `2.0.0-beta.25`.                                                         |
| **`vite-html-include`**   | Custom local plugin that expands `<!-- @include foo.html -->` macros before crxjs sees the HTML.                                                                             |
| **`uiPorts`**             | The `Set<chrome.runtime.Port>` in the background SW that holds every connected side-panel/popup port for broadcast.                                                          |
| **Long-lived port**       | The persistent connection opened via `chrome.runtime.connect({name})` — used for broadcast (e.g. `IMAGES_DISCOVERED`).                                                       |
| **Restricted URL**        | A URL the extension cannot inject into: `chrome://`, `chrome-extension://` (other extensions), Web Store, view-source, etc. Detected by `shared/utils.ts > isRestrictedUrl`. |
| **`ImageItem`**           | The central data structure (see `shared/types.ts`). Carries id, URL, dimensions, format, source, optional pHash and dominant colors.                                         |
| **`isProUser()`**         | The single gate every Pro feature consults. Returns `{isPro, plan, expiresAt, status}`.                                                                                      |
| **Trial**                 | The one-shot 7-day full-Pro trial; not user-resettable.                                                                                                                      |
| **Soft paywall**          | A non-blocking banner that asks the user to upgrade.                                                                                                                         |
| **Hard paywall**          | A blocking modal that gates the next user action.                                                                                                                            |
| **First wow**             | The product principle of letting the user experience a Pro feature once before the upsell trips. See `FREE_LIMITS` design notes in `shared/constants.ts`.                    |
| **Live monitoring**       | Pro feature: `MutationObserver` watches `document.body` and streams newly-added images to the panel.                                                                         |
| **pHash**                 | Perceptual hash. 64-bit DCT-based fingerprint used for similar-image detection.                                                                                              |
| **Median Cut**            | The color-quantization algorithm used for dominant-color extraction.                                                                                                         |
| **`virtua`**              | Third-party Preact-incompatible (React-only) virtualized-list library, aliased to `preact/compat`.                                                                           |
| **`fake-indexeddb`**      | npm dev dep used in unit tests so `shared/collection.ts` works under jsdom.                                                                                                  |
| **`installChromeMock()`** | Test helper (`tests/_helpers/`) that resets `chrome.*` to a clean spy-able mock per test.                                                                                    |
| **`__IH_E2E__`**          | The sentinel `window` flag e2e tests set so `init.ts` exposes `window.__IH__` for direct state access.                                                                       |
| **Bucket**                | A/B experiment assignment (`'A'` or `'B'`) stamped on every applicable telemetry event.                                                                                      |

---

> **Last updated**: this document tracks `master`. When you change
> `manifest.config.ts`, `shared/constants.ts`, or any of the message-routing
> files in `background/`, please update the relevant section(s) here in
> the same PR.
