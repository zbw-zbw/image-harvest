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
- 三档定价不变（Monthly $2.99 / Yearly $19.99 / Lifetime $39.99），既有用户的许可证持续有效，无需重新激活
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

[1.0.2]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
[1.0.1]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
[1.0.0]: https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo
