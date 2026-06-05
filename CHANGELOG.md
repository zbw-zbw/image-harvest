# Changelog

All notable changes to **Image Harvest** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
═══════════════════════════════════════════════════════════════════════════════
HOW TO ADD A NEW RELEASE ENTRY
═══════════════════════════════════════════════════════════════════════════════

1. While developing, accumulate notes under the `## [Unreleased]` heading
   below, grouped by the standard Keep a Changelog sections:
     ### ✨ Added       — new features users can see
     ### 🔄 Changed     — changes in existing functionality
     ### ⚠️ Deprecated  — soon-to-be removed features
     ### 🗑️ Removed     — removed features
     ### 🐛 Fixed       — bug fixes
     ### 🔒 Security    — security-related fixes
     ### 🧪 Test Coverage Expansion — test-only changes (project convention)

2. When cutting a release (e.g. v1.0.2):

   a) Bump version in: package.json + manifest.config.ts + CHANGELOG below
   b) Replace `## [Unreleased]` with `## [1.0.2] — YYYY-MM-DD`
   c) Add a fresh `## [Unreleased]` heading at the top with empty subsections,
      so the next cycle has somewhere to write
   d) Update the comparison links at the bottom of this file (if/when added)
   e) Tag the commit:  git tag v1.0.2 && git push --tags
   f) Draft a GitHub Release (Releases → Draft new release → choose tag),
      paste the same changelog section as the release notes
   g) Trigger the Chrome Web Store upload workflow (or upload manually)

3. Audience reminder: end users read this file. Lead with WHAT changed and
   WHY they care, not implementation detail. Save deep technical notes for
   commit messages or PR descriptions.

4. Quick template to copy when starting a new release block:

       ## [X.Y.Z] — YYYY-MM-DD

       ### ✨ Added
       - Short user-facing description.

       ### 🔄 Changed
       - Short user-facing description.

       ### 🐛 Fixed
       - Short user-facing description (link issue # if applicable).

═══════════════════════════════════════════════════════════════════════════════
-->

---

## [Unreleased]

---

## [1.0.6] — 2026-06-05

### ✨ Added

- **Referral & Invite System**: Share your unique invite link with friends. When they install Image Harvest, both you and your friend earn bonus trial days. Includes a new in-panel `ReferralBanner` for free users and a dedicated invite landing page on the website.
- **Remote Feature Configuration**: Feature limits (free quotas, Pro caps) are now fetched from the server and cached locally, allowing real-time adjustments without releasing a new extension version. Three-tier cache: memory → chrome.storage → network with 1-hour TTL.
- **Quota Display Panel**: New `QuotaDisplay` component in settings shows a clear Free vs Pro comparison table, grouped into Core Pro / AI / Batch Ops / Storage categories. Free users see remaining quota; Pro users see used/total.
- **Visibility Filter**: New "Show visible only" toggle filters out images that are off-screen or hidden behind overlays. Uses real-time `IntersectionObserver` + `getComputedStyle` checks in the content script.
- **Color Extraction now free**: Color palette extraction is no longer a Pro-only feature — all users can see dominant colors for every image.
- **Image MIME detection from bytes**: `detectImageMimeFromBytes` inspects file magic bytes (PNG/JPEG/GIF/WebP/BMP/ICO/SVG) for reliable format identification, replacing extension-based guessing.

### 🔄 Changed

- **Pro features → soft quota model**: Instead of hard-blocking free users, Pro features now use a monthly/daily quota system (`feature-quota.ts`). Free users get a limited number of uses per month; Pro users get unlimited access. Affected features: multi-tab extraction, dedup detection, format conversion, live monitor, batch highlight.
- **AI quota from daily to monthly**: Free AI tagging quota changed from per-day to per-month, giving users more flexibility in how they use their allowance.
- **srcset handling**: `extractImgTags` now picks the single highest-resolution URL from `srcset` instead of listing every candidate — significantly reduces duplicate entries.
- **Pricing updated**: Monthly $3.99 / Yearly $29.99 / Lifetime $49.99 (previously $2.99/$19.99/$29.99).
- **ProUpgradeModal redesign**: Rewritten upgrade modal with improved UX — clearer feature comparison, better visual hierarchy, and smoother animations (241 lines of changes).
- **Content script refactor**: `content/main.ts` restructured for better maintainability (+275 lines), with new utility functions extracted to `content/utils.ts`.
- **Init flow optimization**: `sidepanel/init.ts` expanded (+188 lines) with improved startup sequence, remote config sync, and referral matching on first install.
- **Settings improvements**: Enhanced settings panel with new options and better organization (+132 lines).

### 🎨 UI/UX

- **License page restyled**: Completely new license activation/management CSS (+308 lines) with modern card layout.
- **Toolbar refinements**: Updated toolbar styling (+81 lines) with better spacing and icon alignment.
- **Cards & grid polish**: Minor visual improvements to image card rendering and grid layout.

### 🐛 Fixed

- **Highlight overlay positioning**: Improved accuracy of highlight overlays for images in complex layouts (scrollable containers, CSS transforms).
- **Highlight click dismiss**: Overlay click handler rewritten to use document-level capture with `pointer-events: none` on overlays, fixing issues where clicks wouldn't register on overlaid content.

### 🌍 i18n

- **290+ new translation keys per language**: All 15 language files updated with comprehensive translations for referral system, quota display, visibility filter, updated Pro features, and revised upgrade modal content.

### 🧪 Test Coverage

- **11 test files updated**: Tests synchronized with quota model changes, visibility filter, referral system, and pricing updates.

### ⚠️ Known Issues

- **4 debug `console.log` statements** remain in `background/license.ts:19`, `background/reverse-search.ts:245,252`, `background/index.ts:204` — should be cleaned before final submission.
- **`TEST_MATCH_REFERRAL` message handler** in `background/index.ts` lacks a production environment guard — consider wrapping in `__DEV__` check.

---

## [1.0.5] — 2026-06-02

### ✨ Added

- **AI Image Tagging**: Generate smart tags for images using AI — helps you find and organize images by content. Free users get a daily quota; Pro users enjoy unlimited tagging.
- **Batch AI Tagging**: Tag multiple selected images at once with a single click.
- **AI Tag Filtering**: Filter images by AI-generated tags in the search/filter toolbar.
- **Export to Eagle**: One-click export images (with metadata, tags, and source URL) to Eagle — the popular design asset management app. Supports batch export of selected images. Free users can export up to 5 images; Pro users enjoy unlimited exports.
- **Batch Operations Toolbar**: New batch action buttons appear when images are selected — batch favorite (add to collection), batch AI tag, and batch delete. Streamlines bulk workflows without opening menus.

### 🐛 Fixed

- **Dropdown menus stay open after clicking**: The reverse-image-search and download-format dropdown menus now dismiss immediately after clicking a button or menu item, instead of staying open until the cursor leaves.
- **Image list re-renders after reverse search**: Switching to the reverse-search tab and back no longer causes the image list to re-render (which reset the scroll position to the top).
- **Loading state stuck after reverse search**: Fixed a race condition where scanning the transient reverse-search extension page could leave the image grid permanently stuck in a loading state.
- **Status counts flash on tab switch**: Switching between the extension's built-in pages (welcome, reverse-search) and normal tabs no longer triggers a re-render of the "Found N images (N similar)" counter with a fade-in animation.

---

## [1.0.4] — 2026-05-25

### 🚀 Optimization Sprint — Stability, Performance & Architecture

This release focuses heavily on **tab-switch reliability**, **CORS bypass for file metadata**, **code architecture improvements**, and **Pro modal UX redesign**. It also completes remaining i18n gaps, fixes multiple extraction edge cases, and adds security hardening.

### ✨ Added

- **Background proxy for image file size (CORS bypass)**: New `FETCH_IMAGE_META` message type lets the sidepanel request HEAD metadata through the background service worker when direct CORS HEAD fails. A third-tier fallback computes size from the base64 `dataUrl` payload. Result: file sizes now display correctly for cross-origin images (e.g. CDN-hosted assets) that previously showed blank.
- **Tab lifecycle module**: Extracted all tab management logic from the monolithic `init.ts` (1500+ lines) into a dedicated `sidepanel/tab-lifecycle.ts` module for improved maintainability and reduced bug surface.
- **Live monitor `seenUrls` auto-clear**: `startLiveMonitoring` now clears the dedup set on each invocation and caps growth at `SEEN_URLS_MAX_SIZE`, preventing unbounded memory growth on long-lived SPA pages.
- **Lazy-load listener cleanup via AbortController**: Live monitor now uses an `AbortController` to batch-remove all lazy-image `load` event listeners on `stopLiveMonitoring`, preventing leaks.
- **CSS content image extraction restored**: Re-enabled `extractCssContentImages` (was accidentally disabled) and integrated `::before`/`::after` CSS content URL extraction into the main background-image pass for better coverage.
- **URL validator security hardening**: New `shared/url-validator.ts` module with `isAllowedFetchUrl()` blocks private IPs, localhost, `.local`/`.internal` hostnames — applied to `FETCH_IMAGE_DATA` and `FETCH_IMAGE_META` to prevent SSRF.
- **Extraction re-entry guard**: `extractImages()` now returns early if already running, preventing duplicate concurrent extractions.
- **Pro upgrade modal i18n keys**: Added `pro_feature_*` description keys for all 15 supported languages.
- **Telemetry opt-in default changed to `true`**: Anonymous telemetry is now opt-in by default (was `false`).

### 🎨 UI/UX

- **Pro upgrade modal redesign**: Features displayed as cards with colored gradient icons; sections reordered (activation → trial → features → pricing); improved spacing and Pro-specific feature descriptions.
- **Dark mode CSS variable consolidation**: Migrated 8+ hardcoded color values (`#e53e3e`, `#5a3e00`, etc.) into `css/variables.css` theme tokens for consistent dark-mode contrast.
- **Empty state layout**: Top-aligned with no re-entry animation for a cleaner, less distracting feel.
- **Skeleton card viewport-aware count**: Uses `800px` default height with `ResizeObserver` recalculation so skeleton placeholders fill the full viewport on first panel open.
- **Filter bar responsive**: Toolbar filter area now adapts to narrow panel widths without overflow.
- **Restricted-page hero styling**: Tab-switch to `chrome://` or other restricted pages now shows a proper hero state instead of broken rendering.

### 🐛 Fixed

- **Tab-switch grid flash (multiple root causes)**:
  - Deep-copy cached arrays on tab restore to prevent cross-tab mutation.
  - Verify tab URL before revealing cached images.
  - Preemptive grid hide before async data load.
  - Guard `loadCurrentTab` against stale tab-switch resumption.
  - Prevent flash of stale cards on cached tab switch.
- **Background SW reconnection on idle disconnect**: Side panel now auto-reconnects to the background service worker after Chrome suspends it (idle > 30s), keeping tab-switch and messaging alive.
- **Filter conditions apply to dedup/similar modals**: The duplicate detection modal image list and the similar-image badge count now respect currently active filter settings.
- **Grid visibility after filter change**: Fixed issue where changing filters then rescanning could leave the image grid invisible.
- **Tab-switch to restricted page**: Switching to a `chrome://`, `edge://`, or other restricted-scheme tab no longer causes rendering errors; the fast-path is skipped and a preemptive grid hide prevents stale content.
- **Empty state restore on tab-switch**: Returning to an empty tab now correctly re-displays the empty-state hero instead of a blank panel.
- **Delete button Pro gate removed**: Image deletion is now free for all users as intended (removed incorrect Pro guard that was accidentally left in).
- **Force rescan on panel open**: Opening the side panel now always triggers a fresh scan to ensure images are up-to-date.
- **Skeleton cards fill viewport on first open**: No longer shows an incorrect count based on a hardcoded assumption; uses actual viewport height.
- **`extractCssContentImages` disabled by accident**: Restored the function call and changed the default opt-in flag from `false` to `true`.

### ⚡ Performance

- **Collection (IndexedDB) refactor**: Replaced nested `new Promise(async ...)` anti-patterns with clean `async/await` + a shared `requestToPromise` helper. Reduces code by ~60 lines and eliminates a class of silent swallowed errors.
- **`shared/storage.ts` simplification**: Flattened callback-style storage access into direct `await chrome.storage.local.get/set` calls.
- **`shared/phash.ts` cleanup**: Simplified internal buffer handling.
- **`shared/color-extract.ts` optimization**: Improved color quantization path.
- **Sidepanel bundle size check**: Updated the bundle size threshold in `check-bundle-size.mjs`.

### 🔒 Security

- **SSRF prevention on `FETCH_IMAGE_DATA`**: Added `isAllowedFetchUrl()` validation before the background service worker fetches arbitrary URLs, blocking private networks, loopback, and internal hostnames.
- **Same check on new `FETCH_IMAGE_META`**: HEAD proxy also validates URLs before issuing requests.

### 🌍 i18n

- **Complete locale coverage**: Replaced all remaining hardcoded English strings in sidepanel components (`filter.ts`, `settings.ts`, `ui.ts`, `dedup-ui.ts`, `collection-ui.ts`, `message.ts`, `scan.ts`, `init.ts`) with `t()` calls.
- **New i18n keys**: Added ~100 new message keys across all 15 locale files for filter labels, toast messages, modal content, Pro feature descriptions, and error messages.
- **Locale file formatting**: Reformatted all 15 `messages.json` files for consistency.

### 🔄 Changed

- **`prettier.config.ts` → `prettier.config.mjs`**: Renamed config file to ESM extension for broader tooling compatibility.
- **`versions/` → `releases/`**: Reorganized release archive directory structure (subdirectory per version).
- **`content/main.ts` re-entry guard**: `extractImages` now returns `[]` immediately if already running instead of allowing parallel extractions.
- **State additions**: Added `TIMING` constants object and `SEEN_URLS_MAX_SIZE` to `shared/constants.ts`.
- **`shared/types.ts`**: Added new field to support Pro feature description rendering.

### 🧪 Test Coverage

- **1400 tests** across 53 test files (up from 1388 in v1.0.3).
- Updated `imageCard.test.tsx` to reflect delete-button Pro gate removal.
- Updated `sidepanel-dedup-ui`, `sidepanel-message`, `sidepanel-render`, `sidepanel-filter` test files for new i18n and filter behaviors.
- Added new filter test cases for dedup-modal filtering and similar-count filtering.
- Added trial test cases for network-error and persistence-failure scenarios.

## [1.0.3] — 2026-05-14

### 🌍 Expanded Language Support

- **15 languages now supported**: Added Korean, Portuguese, French, German, Italian, Russian, Dutch, Polish, Arabic, and Thai — bringing the total from 5 to 15. Every string in the UI, error messages, and settings is fully translated.

### 🐛 Fixed

- **Side panel image list not rendering on open**: Fixed a race condition where opening the side panel (especially after switching from popup mode) would show "Found 0 images" even though images were cached. Root cause: store subscriptions registered too late to catch synchronous state mutations during initialization.
- **Settings language switch not updating all labels**: Changing the display language now immediately refreshes the modal title, license plan badge ("Lifetime"), expiry text ("Never expires"), and hotkey button label without needing to close and reopen Settings.
- **Rating prompt modal not centered**: The "Rate Image Harvest" dialog now appears centered in the viewport, consistent with all other modals.
- **Hotkey display not updating after change**: The shortcut key shown in Settings now auto-refreshes when you return from `chrome://extensions/shortcuts`; added `cursor: pointer` on the hotkey row to indicate it's clickable.
- **Image highlights lost after download**: Selection state and page highlights are now preserved after downloading images.
- **Multi-tab extraction clearing selection**: Selection and highlights no longer disappear after completing a multi-tab extraction.
- **Highlight positioning for duplicate URLs**: Fixed incorrect highlight overlay placement when the same image URL appears multiple times on a page.
- **Images behind interaction layers skipped**: Highlight now correctly skips images hidden behind modals/overlays that require user interaction.
- **Popup mode rendering glitches**: Fixed popup-only rendering issues and removed stale dynamic CSS injection.
- **Size filter X button default state**: The clear button in size filter inputs now shows the correct initial state.
- **Tab-switch flicker**: Eliminated a visible flash when switching between tabs with cached image data.

### ⚡ Performance

- **Faster image loading**: Parallelized `ensureImageLoaded` calls, reducing scan-to-render latency by ~30% on image-heavy pages.
- **Faster settings save**: Optimized settings persistence to avoid redundant writes; UI feedback is now instant.

### 🔄 Changed

- **PRO badge alignment in dropdowns**: All PRO badges in download format, group-by, and settings dropdowns are now right-aligned for visual consistency.

### 🧪 Test Coverage

- Added 14 dedicated test cases for the store→component rendering pipeline (`storeHook.test.tsx`, `imageGrid.test.tsx`) to prevent future regressions in the image list main flow.

---

## [1.0.2][1.0.2] - 2026-05-08

### 🌍 Internationalization, Trial & Productivity Update

继 1.0.1 的 Chrome Web Store 上架优化之后，本次发版聚焦三件事：**让全球用户都能用母语使用插件**、**降低 Pro 功能的尝鲜门槛**、**把高频复制场景做成一等公民**。同时附带一次大规模的测试加固（不影响生产代码），整体 All-files Lines 覆盖率推到 80%。

#### ✨ Added — 多语言支持（i18n，5 种语言）

- **新增 5 种语言 UI**：英语 (`en`)、简体中文 (`zh_CN`)、繁体中文 (`zh_TW`)、日语 (`ja`)、西班牙语 (`es`)
- 全部文案走 `chrome.i18n` + `_locales/<lang>/messages.json` 标准方案，覆盖侧边栏、弹窗、设置页、收藏夹、反向搜图页、所有 toast / 模态框 / 按钮 / 表单
- 文案 key 统一改为下划线命名规范（`scan_button` 而非 `scanButton`），便于翻译协作和后续机器翻译流水线
- 语言跟随浏览器 UI 语言自动切换，无需用户手动选择
- 新增 e2e 用例 `e2e/i18n-locale-switch.e2e.ts` 锁定多语言切换契约

#### ✨ Added — 7 天 Pro 试用 + 软付费墙 + A/B + 评分提示（变现优化套件）

- **7 天 Pro 全功能试用**：新装用户自动激活试用，期间所有 Pro 功能（多 Tab 提取、相似图检测、批量高亮、收藏夹、格式转换、命名模板、TinEye/Baidu/Yandex 反搜等）全部解锁
  - 试用状态在 `chrome.storage.local` 持久化，跨设备隔离
  - 试用进度条在侧边栏顶部展示剩余天数
  - 试用到期前 1 天弹出温和提醒，过期后自动降级为免费版
  - 新模块：`shared/trial.ts`（试用状态机）、`tests/trial.test.ts`（单元测试）
- **软付费墙（Soft Paywall）**：Pro 功能点击触发可关闭的升级提示，非强制拦截，保留"先体验再付费"的流畅感
  - 新模块：`shared/paywall-state.ts`（出现频次去抖 + 用户偏好记忆）
- **A/B 实验框架**：内建轻量级 A/B 分桶能力，用于持续优化付费转化文案
- **应用内评分提示**：满足正向使用条件后（多次成功下载且无报错）触发一次性的 Chrome Web Store 评分引导
  - 新模块：`shared/rating-prompt-state.ts`（基于行为信号的触发逻辑 + 7 日冷却）

#### ✨ Added — 批量复制图片链接（高频场景一等公民）

- **批量复制 URL**：选中任意张图片后一键将所有 URL 复制到剪贴板（换行分隔），适配文档/聊天/SEO 调研等高频粘贴场景
- 单图卡片右键菜单也新增"复制链接"项，与批量入口语义一致
- 复制成功 toast 显示具体复制条数（"已复制 12 个链接"），失败时给出明确的剪贴板权限提示
- 新增 e2e 用例 `e2e/copy-url.e2e.ts` + `e2e/batch-copy-url.e2e.ts` 双重锁定

#### 🔁 Changed — 支付系统迁移：PayPal → Creem

- **支付通道从 PayPal 切换到 Creem**：更稳定的全球收款 + 更友好的中国大陆/东南亚地区支持 + 更短的到账周期
- 三档定价不变（Monthly $2.99 / Yearly $19.99 / Lifetime $29.99），既有用户的许可证持续有效，无需重新激活
- 客服邮箱从个人 Gmail 改为品牌邮箱（用于 Creem 商户认证）
- 内部新增促销许可证批量生成脚本（仅维护方使用）

#### ✨ Added — 匿名遥测（Telemetry，默认关闭，需用户主动 opt-in）

- 在设置页新增"匿名使用统计"开关，**默认关闭**，开启后才会上报
- 上报内容仅限聚合事件计数（如 scan/download/dedup 调用次数、错误类型枚举），**不包含**任何图片 URL、页面 URL、个人身份信息
- 配套后台 admin dashboard（独立私有仓库）用于产品决策，公开仓库不含任何后台代码
- 新模块：`shared/telemetry.ts` + `shared/telemetry-events.ts`

#### 🐛 Fixed — UI / UX 细节修复

- **窄边栏响应式布局**：极窄宽度下工具栏不再溢出，按钮按优先级渐进折叠
- **设置页滚动**：设置面板内容超长时正确滚动，不再被底部按钮遮挡
- **Pro 徽章定位**：Pro 标记在所有过滤按钮 active 态下都正确保留，不会因状态切换消失
- **试用倒计时加载态**：试用剩余天数加载期间不再短暂闪烁 "0 天"
- **空状态布局**：扫描无结果页面在窄边栏下不再溢出
- **标签页切换闪烁**：跨标签页切换时图片网格不再短暂白屏
- **"显示模式"开关恒可用**：Side Panel ↔ Popup 切换在任何状态下都可用，不再被首次扫描前的初始化阻塞
- **Telemetry 兜底**：`chrome.storage.local.get` 在某些 Chrome 版本上返回 `undefined` 时的崩溃保护

#### 🧪 Added — Test Coverage Expansion（不改动生产代码）

> 详细的测试覆盖率说明见私有仓库 `image-harvest-backend/docs/release/v1.0.2/test-coverage-details.md`。

本次附带一次大规模的测试加固（三阶段 Stage-1/2/3 + E2E），整体提升如下：

| 指标                 | Before | After      | Delta |
| -------------------- | ------ | ---------- | ----- |
| All files Lines      | ~60%   | **80.00%** | +20pp |
| Branch               | —      | **87.26%** | —     |
| Functions            | —      | **88.54%** | —     |
| Vitest test files    | 35     | **46**     | +11   |
| Vitest test cases    | 847    | **1,258**  | +411  |
| Playwright e2e cases | 3      | **27**     | +24   |

**Stage-1**（0% 文件扫荡）：4 个 sidepanel UI 模块从 0% → 90%+，+131 cases
**Stage-2**（background/content 热点）：5 个文件，+47 cases，background 聚合 77% → 91%
**Stage-3**（冲刺 80% 地板线）：6 个文件，+90 cases，sidepanel 多个模块达到 100%
**E2E**：3 个新 Playwright spec 文件，+24 cases，覆盖 scan/init/actions 的 IPC 边界

#### ✅ Verified

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npx prettier --check` ✅
- `npm test` → **46 files / 1,258 cases** ✅
- `npm run test:coverage` → `All files` Lines **80.00%** ✅
- `npx playwright test` → **27 cases** ✅

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
- Batch ZIP download via JSZip with streaming blob assembly (free: up to 30 images / Pro: unlimited up to 1000)
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

- Three Pro plans: Monthly ($2.99), Yearly ($19.99 / ~44% off), Lifetime ($29.99)
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

[1.0.2]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
[1.0.1]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
[1.0.0]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
