# Image Harvest — 架构文档

<p align="right">
  <strong><a href="./ARCHITECTURE.md">English</a> | 简体中文</strong>
</p>

> 一份面向贡献者、代码审计者和好奇用户的架构深度解读 —— 帮助你在改动重要逻辑前，
> 准确理解 Image Harvest 究竟是怎么运行的。

---

## 目录

1. [项目概览](#1-项目概览)
2. [运行时环境](#2-运行时环境)
3. [整体数据流](#3-整体数据流)
4. [模块地图](#4-模块地图)
5. [`background/` —— Service Worker](#5-background--service-worker)
6. [`content/` —— 页面内抓取](#6-content--页面内抓取)
7. [`sidepanel/` —— UI 层](#7-sidepanel--ui-层)
8. [`pages/` —— HTML 入口](#8-pages--html-入口)
9. [`shared/` —— 单一真理来源](#9-shared--单一真理来源)
10. [IPC 协议参考](#10-ipc-协议参考)
11. [存储布局](#11-存储布局)
12. [状态机](#12-状态机)
13. [Pro / License 模型](#13-pro--license-模型)
14. [隐私与遥测管道](#14-隐私与遥测管道)
15. [国际化（i18n）](#15-国际化i18n)
16. [构建管道](#16-构建管道)
17. [性能预算](#17-性能预算)
18. [测试策略](#18-测试策略)
19. [发布管道](#19-发布管道)
20. [扩展项目](#20-扩展项目)
21. [术语表](#21-术语表)

---

## 1. 项目概览

Image Harvest 是一款 **Chrome Manifest V3 扩展**，能扫描任意网页中的图片，
让用户进行筛选、预览、批量下载，并通过 License Key 解锁一组面向高级用户的
"Pro" 功能。代码库的优化优先级如下：

1. **隐私优先** —— 图片抓取、感知哈希、色彩分析、格式转换全部在浏览器中
   完成。扩展自身仅向 `image-harvest.kyriewen.cn` 发起 License 校验、
   可选的匿名遥测，以及（用户主动触发的）反向图片搜索跳转请求。
2. **首屏延迟** —— 侧边栏每天会被打开很多次；主入口 chunk 在 CI 中通过
   `scripts/check-bundle-size.mjs` 强制限制为 50 kB gzip 以内。
3. **诚实的"已解压加载"可审计性** —— 每个源文件都是纯 TypeScript ESM，
   不含混淆的第三方块，不远程加载代码。审计者可以读到运行的每一行。

### 架构风格

扩展遵循**经典的 MV3 三进程模型**：

```
┌────────────────────────────┐    ┌────────────────────────────┐
│   侧边栏 / 弹窗             │    │   反向搜索页               │
│   (sidepanel/ + pages/)    │    │   (pages/reverse-search.*) │
│   ─ Preact + 原生 DOM      │    │                            │
└──────────────┬─────────────┘    └──────────────┬─────────────┘
               │  chrome.runtime.connect("image-snatcher-ui")
               │  chrome.runtime.sendMessage / onMessage
               ▼
┌──────────────────────────────────────────────────────────────┐
│              后台 Service Worker (background/)               │
│   ─ 消息路由器、内容脚本注入器、                             │
│     License 定时检查、多标签页编排                           │
└──────────────┬───────────────────────────────────────────────┘
               │  chrome.tabs.sendMessage / chrome.scripting.executeScript
               ▼
┌──────────────────────────────────────────────────────────────┐
│              内容脚本 (content/)                             │
│   ─ DOM / Shadow DOM / iframe 遍历，                         │
│     MutationObserver 实时监控，页面高亮                      │
└──────────────────────────────────────────────────────────────┘
```

`shared/` 是**类型、常量、存储辅助函数、遥测 SDK、License SDK、i18n 字典、
纯算法**（pHash、色彩提取、格式转换）的单一真理来源。它被三个运行时同时
导入；打包由 `@crxjs/vite-plugin` 处理，每个运行时只会包含一份。

### 本文档不涉及的内容

本文不重复用户视角的功能列表（参见 [`README.md`](../README.md)）、
隐私承诺（参见 [`PRIVACY.md`](./PRIVACY.md)）、安全策略
（参见 [`SECURITY.md`](../SECURITY.md)）或贡献者上手指南
（参见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)）。本文专注于**运行时形态、
IPC 协议、状态机和硬约束** —— 也就是你为了不破坏微妙契约、提交非平凡 PR
所必需的信息。

## 2. 运行时环境

扩展同时运行在**四个不同的 JavaScript 上下文**中。每个上下文 API 不同、
生命周期不同、存储作用域不同、调试器也不同。"我自己测试是好的"这类 bug，
最常见的原因就是没分清当前代码在哪个上下文。

| 运行环境 | 文件入口 | 生命周期 | 有 DOM？ | 能用 `chrome.tabs`？ | 存储作用域 |
|---|---|---|---|---|---|
| **Service Worker** | `background/index.ts` | Chrome 按需启动；约 30s 空闲后休眠 | ❌ | ✅ 完整 | `chrome.storage.{local,sync,session}` |
| **侧边栏（Side Panel）** | `pages/sidepanel.html` → `sidepanel/init.ts` | 面板打开期间常驻；切换标签页不销毁 | ✅ | ✅ 完整 | 与 SW 同一存储命名空间 |
| **弹窗（Popup）** | `pages/popup.html` → 同一 `init.ts`（带 mode flag） | 弹窗失焦的瞬间被销毁 | ✅ | ✅ 完整 | 与 SW 同一存储命名空间 |
| **内容脚本（Content Script）** | `content/main.ts` | 与页面共存；导航/刷新时销毁 | ✅（页面 DOM） | ❌（不能调用 `chrome.tabs.*`） | 仅 `chrome.storage.local` |
| **反向搜索页** | `pages/reverse-search.html` → `pages/reverse-search.ts` | 通过 `chrome.tabs.create` 在新标签页打开 | ✅ | ✅ | 与 SW 同 |

### 为什么侧边栏和弹窗共享 `init.ts`

用户可以随时在侧边栏模式和弹窗模式之间切换（参见
`background/display-mode.ts`）。两个 HTML 外壳（`sidepanel.html` 和
`popup.html`）通过 `vite-html-include` 插件复用同一份 body 标记，并加载
同一个 `sidepanel/init.ts` bundle。`init.ts` 通过
`window.location.pathname.endsWith('popup.html')` 读取 `state.isPopupMode`，
在启动时调整若干尺寸/行为参数。**一份 bundle，两个外壳。**

### 为什么不用 React / Vue / Svelte

最初 2024 年的原型是单 ~30 kB bundle 的原生 DOM + JSZip。当 Pro 功能
（收藏夹模态框、多标签页模态框、License 流程）需要真正的组件复用时，我们
选择了 **Preact** 而不是 React，原因是它的运行时只有 ~3 kB。`virtua`
（唯一的第三方组件依赖）硬编码导入了 `react`；我们在 `vite.config.ts` 中
将其别名到 `preact/compat`，最终 compat 层只占 ~6.6 kB。

**没有计划全量迁移到 React/Vue/Svelte**。`sidepanel/*.ts` 中的命令式遗留
代码会保留；新的模态框形态 UI 进入 `sidepanel/components/*.tsx`。共享状态
存放在 `sidepanel/state.ts` 的可变对象中；Preact 组件通过
`storeHook.ts` 适配器读取。

## 3. 整体数据流

最常见的交互 ——**"在一个有图片的页面上打开面板"**—— 数据流如下：

```
用户点击工具栏图标 / 按 Ctrl+Shift+S
        │
        ▼
Chrome 打开 pages/sidepanel.html （或弹窗模式下的 popup.html）
        │
        ▼
sidepanel/init.ts  ─ mount Preact 组件，缓存 DOM 引用，
                     加载设置，打开 chrome.runtime.connect("image-snatcher-ui")，
                     调用 loadCurrentTab()
        │
        ▼ （异步）
sidepanel/scan.ts  ─ chrome.runtime.sendMessage(GET_IMAGES, {tabId, …})
        │
        ▼
background/index.ts  ─ 消息路由器 → background/extractor.ts
        │
        ▼
background/extractor.ts ─ 确保内容脚本已注入
                          （由 background/injector.ts 处理 fallback）
        │
        ▼
chrome.tabs.sendMessage(tabId, {type: EXTRACT_IMAGES, …})
        │
        ▼
content/main.ts  ─ extractImages() 跑 14 个抓取阶段
                   （img / picture / background / svg / canvas / video poster /
                    input / object / embed / meta / link / css content /
                    lazy-load / shadow DOM / iframes）
        │
        ├──► sendDiscoveredImages([…])  （流式上报，每个阶段一批）
        │            │
        │            ▼
        │     IMAGES_DISCOVERED ─► background 广播 ─► sidepanel 渲染
        │                          （增量 UI 更新；用户能看到图片
        │                           被发现的同时即时出现）
        │
        └──► extractImages() resolve 时返回完整 ImageItem[]
                     │
                     ▼
              sidepanel/scan.ts 拿到最终列表，应用客户端去重、
              排序、分组 → renderImages()
        │
        ▼
content/monitor.ts  ─ MutationObserver 监听 DOM 变化
                      （Pro 功能；免费用户关闭）
                      ─ 新图片以 IMAGES_DISCOVERED 流式推送
```

新贡献者需要记住三件事：

- **抓取是流式的，不是"扫一次返一次"**。14 个阶段中每个阶段在发现 URL 时
  都会调用 `sendDiscoveredImages()`，所以面板是渐进式渲染。函数最终的返回
  值只是权威的去重列表。
- **后台是一个轻量的路由器**，不是状态持有者。需要跨多次消息存活的状态
  要么放在侧边栏的 `state.ts`，要么进入 `chrome.storage.{local,sync,session}`。
- **内容脚本不能调用 `chrome.tabs.*`**。任何需要读取标签页元信息、切换
  标签页、查询 frame 的操作都必须经后台 SW 中转。

### 反向数据流：下载

当用户点击"打包下载选中"时：

```
sidepanel/actions.ts ─ downloadSelectedAsZip()
        │
        ▼ 对每张选中的图片：
        │   ├─ 同源 / CORS 允许：在面板上下文里直接 fetch
        │   └─ 否则：chrome.runtime.sendMessage(FETCH_IMAGE_DATA, {url})
        │           │
        │           ▼
        │     background/reverse-search.ts ─ fetchImageData(url)
        │           ─ 后台 SW 拥有 host_permissions: <all_urls>
        │             所以能绕过页面 CSP / CORS 完成读取
        │           ─ 返回 base64 data URL 给面板
        │
        ▼
JSZip （首次需要时才被懒加载）打包归档
        │
        ▼
chrome.downloads.download({url: blobUrl, filename: …})
```

`actions.ts` 中的 `import('jszip')` 懒加载，是 `sidepanel/init.js` 能保持
在 50 kB 预算下的最大功臣 —— 86 kB gzip 的 JSZip 只在用户真正点击批量
下载按钮的那一刻才会发起请求。

## 4. 模块地图

每个有意义的目录及其职责的鸟瞰图。

```
image-harvest/
├── manifest.config.ts          ─ 类型安全的 MV3 manifest（被 @crxjs/vite-plugin 消费）
├── vite.config.ts              ─ 构建配置：crxjs + html-include + bundle visualizer
├── vite-html-include.ts        ─ 自定义插件：<!-- @include _shared-body.html --> 宏
├── tsconfig.json               ─ TS 配置（迁移期 allowJs:true, noImplicitAny:false）
├── playwright.config.ts        ─ Playwright workers:1, 有头 Chromium, dist/ 作为扩展
├── vitest.config.ts            ─ Vitest 2 + jsdom env 按测试文件 glob 切分
│
├── background/                 ─ Service Worker（一个 bundle: background/index.ts）
│   ├── index.ts                ─   消息路由器（~430 行，处理 ~30 种消息类型）
│   ├── extractor.ts            ─   getImagesFromTab + processMultiTabExtract
│   ├── injector.ts             ─   injectContentScript，含 4 级回退策略
│   ├── display-mode.ts         ─   侧边栏 ↔ 弹窗模式切换（action.setPopup, sidePanel.setOptions）
│   ├── license.ts              ─   基于 chrome.alarms 的 24h License 检查
│   ├── reverse-search.ts       ─   FETCH_IMAGE_DATA 代理 + REVERSE_SEARCH_UPLOAD 代理
│   └── utils.ts                ─   uiPorts Set, broadcastToPopup, getAccessibleTabId
│
├── content/                    ─ 页面内注入脚本（一个 bundle: content/main.ts）
│   ├── main.ts                 ─   消息处理器，14 阶段 extractImages() 入口
│   ├── state.ts                ─   模块级可变状态 + isExtensionContextValid()
│   ├── utils.ts                ─   parseSrcset, ensureImageLoaded, sendDiscoveredImages
│   ├── extract-advanced.ts     ─   阶段 5-12: SVG / canvas / video poster / input / object /
│   │                                embed / meta / link / css content / lazy-load
│   ├── shadow-iframe.ts        ─   阶段 13-14: Shadow DOM 遍历 + 同源 iframes
│   ├── monitor.ts              ─   MutationObserver 实时监控（Pro）
│   └── highlight.ts            ─   页面内图片高亮覆盖层（单张 + 批量）
│
├── sidepanel/                  ─ 侧边栏 + 弹窗 UI bundle（入口: sidepanel/init.ts）
│   ├── init.ts                 ─   IIFE 启动，1100+ 行：cacheElements + bindEvents +
│   │                                标签变化处理 + 扫描编排
│   ├── state.ts                ─   全局可变 `state` 对象 + DOM 引用缓存 `elements`
│   ├── ui.ts                   ─   Toast / 加载遮罩 / 过滤按钮标签 / 视图切换
│   ├── filter.ts               ─   applyFilters / sortImages / renderColorSwatches
│   ├── render.ts               ─   renderImages（委托给 virtua VList）
│   ├── scan.ts                 ─   showScanOverlay / fetchImages / silentRescan / 图像额外信息
│   ├── actions.ts              ─   选择、下载（单张/ZIP）、复制 URL、反向搜索
│   ├── settings.ts             ─   设置弹窗、主题、密度、快捷键、License UI 宿主
│   ├── message.ts              ─   handleMessage（来自 BG 广播）+ handleKeyDown
│   ├── pro-features.ts         ─   懒加载 Pro 模块分发器（collection, multitab, dedup）
│   ├── multitab.ts             ─   多标签页弹窗逻辑（Pro）
│   ├── license-ui.ts           ─   License 激活 / 注销弹窗
│   ├── dedup-ui.ts             ─   pHash 去重弹窗（Pro）
│   ├── collection-ui.ts        ─   收藏弹窗（Pro）
│   ├── utils.ts                ─   loadSettings, fetchImageMeta, generateFilename
│   └── components/             ─ Preact 组件（.tsx）
│       ├── mount.tsx           ─   Mount-point 替换逻辑，单一 mountPreactComponents()
│       ├── storeHook.ts        ─   useStore hook 衔接可变状态 → Preact rerender
│       ├── ImageGrid.tsx       ─   virtua 虚拟化网格
│       ├── ImageCard.tsx       ─   单张图片卡片（色块、徽章、悬停操作）
│       ├── *.tsx               ─   弹窗、徽章、横幅、指示器（共 22 个文件）
│
├── pages/                      ─ HTML 入口 + 对应 TS 控制器
│   ├── _shared-body.html       ─   两端共享的 <body> 标记
│   ├── sidepanel.html          ─   侧边栏外壳
│   ├── popup.html              ─   弹窗外壳
│   ├── popup.ts                ─   弹窗专属高度调整
│   ├── popup.css               ─   弹窗专属样式覆盖（侧边栏使用 css/*.css）
│   ├── reverse-search.html     ─   独立标签页，用于反向图片搜索上传
│   └── reverse-search.ts       ─   反向搜索页逻辑（通过 chrome.tabs.create 打开）
│
├── shared/                     ─ 纯净 / 跨运行时模块 —— 无 DOM、无 chrome.tabs
│   ├── types.ts                ─   ImageItem, AppSettings, FilterConfig, License*, Telemetry*
│   ├── constants.ts            ─   MESSAGE_TYPES, STORAGE_KEYS, LIMITS, FREE_LIMITS, PRICING…
│   ├── storage.ts              ─   设置/历史/缓存辅助函数，封装 chrome.storage.*
│   ├── utils.ts                ─   resolveUrl, getDomain, getFileFormat, deepMerge 等
│   ├── converter.ts            ─   PNG ↔ JPG ↔ WebP（Canvas）（Pro）
│   ├── naming.ts               ─   {index} {original} {date} … 文件名模板引擎（Pro）
│   ├── phash.ts                ─   64-bit 感知哈希（DCT），相似图去重用（Pro）
│   ├── color-extract.ts        ─   Median-cut 提取每张图前 5 主色调
│   ├── collection.ts           ─   IndexedDB 收藏库 CRUD（Pro 第 6+ 张时启用）
│   ├── license.ts              ─   activate / deactivate / isProUser，含 7 天离线宽限
│   ├── trial.ts                ─   一次性 7 天 Pro 试用哨兵
│   ├── telemetry.ts            ─   匿名 opt-in 事件 SDK
│   ├── telemetry-events.ts     ─   事件名白名单 + 每事件 prop schema
│   ├── ab-experiment.ts        ─   Pro 引导 A/B 桶分配
│   ├── paywall-state.ts        ─   付费墙展示状态机
│   ├── rating-prompt-state.ts  ─   "好评提示" 触发时机逻辑
│   └── i18n.ts                 ─   语言字典 + t() / detectLocale()
│
├── css/                        ─ 8 个样式表，全部走 CSS 变量
│   ├── variables.css           ─   --color-* / --space-* / --radius-* tokens
│   ├── base.css                ─   Reset、布局、排版
│   ├── cards.css               ─   图片网格 + 卡片样式
│   ├── modals.css              ─   弹窗外壳 + 各弹窗内容
│   ├── settings.css            ─   设置面板
│   ├── states.css              ─   加载 / 空态 / 受限页
│   ├── toolbar.css             ─   顶部工具栏（过滤、视图、排序）
│   └── license.css             ─   License 弹窗 + 状态徽章
│
├── _locales/                   ─ Chrome MV3 i18n 字典（5 种语言）
│   ├── en/messages.json        ─   英语（default_locale）
│   ├── zh_CN/messages.json     ─   简体中文
│   ├── zh_TW/messages.json     ─   繁體中文
│   ├── ja/messages.json        ─   日本語
│   └── es/messages.json        ─   Español
│
├── tests/                      ─ Vitest 单测套件（53 文件 / ~1,345 用例）
│   └── _helpers/               ─   chromeApiMock（installChromeMock）、chromeStorageMock、imageFixtures、preact-setup
│
├── e2e/                        ─ Playwright e2e（41 specs）
│   ├── _helpers/               ─   launchExtension
│   ├── fixtures/               ─   静态 HTML fixture（page-with-images.html）
│   ├── smoke.e2e.ts            ─   3 个用例的烟雾测试（每次提交都跑）
│   └── *.e2e.ts                ─   按功能划分的流程测试
│
├── scripts/                    ─ 工具脚本
│   ├── check-bundle-size.mjs   ─   gzip 预算强制（init.js ≤ 50 kB 等）
│   ├── zip-extension.mjs       ─   `npm run zip` 用的 Web Store 就绪 zip 构建器
│   └── icons/                  ─   generate-icons.html + sync-icons.sh
│
├── icons/                      ─ icon16/32/48/128.png（工具栏 + Chrome Web Store）
├── assets/                     ─ 营销截图、推广图
│
├── docs/                       ─ 公开文档（chrome-store/）+ 私有文档（被 .gitignore）
│   └── chrome-store/           ─   商店上架描述 + 简介
│
├── website/                    ─ Next.js 营销站子项目
│
└── .github/                    ─ CI/CD + 社区文件
    ├── workflows/ci.yml        ─   lint + typecheck + test + build + e2e
    ├── workflows/release.yml   ─   tag 触发 zip + GitHub Release
    ├── ISSUE_TEMPLATE/         ─   Bug / Feature / Question 模板
    └── FUNDING.yml             ─   赞助链接
```

**经验法则**：当你新增一个功能时，先问"这玩意儿需要 DOM 吗？需要
`chrome.tabs` 吗？两个都要？两个都不要？" 答案直接对应它属于哪个文件夹。

## 5. `background/` —— Service Worker

后台 SW 被刻意设计成**跨消息无状态**。它不持有任何业务数据 —— 所有持久化
状态都活在 `chrome.storage.*`、IndexedDB 或当前活跃的侧边栏 `state` 对象中。
SW 的三个职责是：**路由**、**注入**、**按 alarm 唤醒**。

### `index.ts` —— 消息路由器

消息路由器是单个 `chrome.runtime.onMessage.addListener`，根据
`message.type` 进行 switch 分发。每个处理器是 `async` 的，必须在每条
代码路径上调用 `sendResponse()` 恰好一次；listener 同步返回 `true` 以
保持响应通道在 `await` 之间不被关闭。

几个值得了解的防御性模式：

- **`safeSendResponse`** 包裹了 `sendResponse`，吞掉 Chrome 在调用方标签页
  在抓取过程中导航离开时抛出的"Attempted to use a closed channel"错误。
  没有这个包装，每次扫描期间的导航都会在控制台产生刺眼的红色错误。
- **`broadcastToPopup`** 遍历 `uiPorts: Set<chrome.runtime.Port>`，这是
  侧边栏和弹窗在启动时通过 `chrome.runtime.connect({name:
  'image-snatcher-ui'})` 打开的长连接 ports。这就是 `IMAGES_DISCOVERED`
  能不带 ack 仪式地推到面板的原理。
- **`getAccessibleTabId`** 是"不要让面板向已经导航到受限 URL 的标签页
  发消息"的唯一卡点（chrome:// 页、Web Store、view-source）。返回 `null`
  时调用方应静默 no-op。

### `injector.ts` —— 含回退的内容脚本注入

虽然 crxjs 在 `manifest.config.ts` 中静态声明了内容脚本，**静态声明只在
扩展安装/重新加载之后才打开的页面上生效**。在此之前就已打开的标签页没有
内容脚本，修复办法 —— `chrome.scripting.executeScript` —— 就是
`injector.ts` 包装并配上正确错误处理的逻辑。

注入流程是 4 级阶梯：

1. **PING 主 frame**。如果一个内容脚本能在 3 秒内回应，说明已经存在 ——
   返回成功。
2. **受限 URL 立即放弃**。返回友好的 `INJECTION_FAILED`，
   `message: 'Cannot access this page: browser internal or error pages
   are not supported'`。
3. **探测遗留全局变量**。`executeScript` 在页面 world 跑一个微小 `func`，
   检查 `typeof globalThis.isExtracting !== 'undefined'`。这能捕获脚本
   正在加载但尚未挂上消息 listener 的双重注入边界情况。
4. **注入打包后的脚本**，文件路径来自
   `chrome.runtime.getManifest().content_scripts[0].js`。带哈希的文件名
   （`assets/main.ts-loader-XXXXXXXX.js`）在运行时查表，永不硬编码。

如果 `allFrames: true`，`injectIntoAllFrames` 会通过
`chrome.webNavigation.getAllFrames` 枚举所有 frame，然后尝试注入到每个
非受限子 frame。

CSP 屏蔽的页面会返回 `CSP_BLOCKED` 代码，附带可执行的 `workaround`
字符串，侧边栏会原样在 toast 中展示。

### `extractor.ts` —— 单标签 + 多标签抓取

`getImagesFromTab(tabId, {searchAllFrames, liveMonitoring})` 是"扫描这个
标签页"的标准入口。它会：

1. 解析 tab（默认当前窗口的活跃 tab）。
2. 调用 `injectContentScript(tabId, {allFrames})`。
3. 向 frame 0 发送 `EXTRACT_IMAGES`，并在 `searchAllFrames` 时迭代每个子
   frame，按 URL 去重。
4. 根据 `liveMonitoring` 切换 `START_LIVE_MONITOR` / `STOP_LIVE_MONITOR`。

`processMultiTabExtract(tabIds[])` 是 **Pro 多标签页编排器**。它**串行**
跑（不是并行 —— Chrome 对每个标签页并发的 `scripting.executeScript` 有
限速，并行会导致不稳定），用 15 秒超时包裹每个标签页，并在每个标签页
完成后广播 `DOWNLOAD_PROGRESS`，让弹窗进度条能向前推进。

### `display-mode.ts` —— 侧边栏 vs 弹窗

模式切换比看起来要微妙。侧边栏模式设置
`action.setPopup({popup: ''})`（空字符串禁用弹窗）和
`sidePanel.setPanelBehavior({openPanelOnActionClick: true})`。弹窗模式
设置 `action.setPopup({popup: 'pages/popup.html'})` 和
`sidePanel.setOptions({enabled: false})`。

最棘手的部分是**按标签页状态**：`chrome.sidePanel.setOptions` 接受可选
`tabId`，所以面板可以按标签页启用/禁用。我们监听 `tabs.onActivated` 并
在每次切换时重新应用全局模式，否则一个最近被弹出的标签会永远保留它的
"side panel disabled" flag。

### `license.ts` —— 周期性重新校验

单个 `chrome.alarms.create('license-check', {periodInMinutes: 1440})`
调度每日一次的 License API 往返。处理器读取
`chrome.storage.local.licenseData`，调用 `validateLicenseRemote`，要么
更新 `lastVerified`（仍然有效），要么把 `status` 翻成 `'expired'`（如果
服务器这么说）。**网络失败不会改本地状态** —— 7 天离线宽限期（在
`shared/license.ts > isProUser` 中）会照顾真正的离线用户。

### `reverse-search.ts` —— 绕过页面 CORS 的代理 fetch

两个端点：

- **`FETCH_IMAGE_DATA`** —— 面板请求 SW 拉取一个图片 URL 并返回 base64
  data URL。这能工作是因为 SW 拥有 `host_permissions: ['<all_urls>']`，
  因此不受页面 CSP / CORS 约束。供 ZIP 下载跨域图片使用。
- **`REVERSE_SEARCH_UPLOAD`** —— 向搜索引擎的上传端点发起 multipart
  上传，返回跳转 URL，面板再用新标签页打开。

## 6. `content/` —— 页面内抓取

内容脚本运行在目标页面的**隔离世界**中 —— 它能看到页面所看到的同一份
DOM，但读不到页面的 JS 变量。这种隔离是扩展能安全对抗页面注入脚本的
原因；同时也意味着我们不能依赖页面定义的辅助函数，需要在内联样式不够
用时通过 `getComputedStyle` 获取。

### `main.ts` —— 14 阶段抓取流水线

`extractImages()` 严格按以下顺序跑 14 个阶段：

| # | 阶段 | 抓什么 |
|---|---|---|
| 1 | `<img>` 标签 | `src`、`srcset`、`currentSrc`、`data-src`/`data-original`/`data-lazy*` |
| 2 | 背景图 | 内联 `style="background-image:..."` 和计算样式 `getComputedStyle(el).backgroundImage` |
| 3 | `<picture>` / `<source>` | 每个 source 的 `srcset` 各分辨率候选 |
| 4 | 样式表规则 | 跨域样式表跳过（CORS）；同源通过 `CSSStyleSheet.cssRules` 遍历 |
| 5 | 内联 `<svg>` | 通过 `XMLSerializer` 序列化 → data URL |
| 6 | `<canvas>` | `toDataURL`（太小或 `SecurityError` 时跳过） |
| 7 | `<video poster>` | poster 属性，按图片处理 |
| 8 | `<input type="image">` | `src` 属性 |
| 9 | `<object>` / `<embed>` | 当 `type` 以 `image/` 开头 |
| 10 | `<link rel="icon"/"apple-touch-icon">` 和 `<meta property="og:image"/twitter:image*>` | 页面元数据图片（标记为不参与高亮） |
| 11 | CSS `content: url(...)` | `::before` / `::after` 伪元素图片 |
| 12 | 懒加载额外属性 | `data-bg`、`data-srcset`、picture-source 的 `data-src*` |
| 13 | Shadow DOM | `extractFromShadowDom` 走遍每个 open shadow root |
| 14 | iframe | 仅同源；跨域 iframe 静默跳过 |

阶段 14 之后，去重的 `images.values()` 数组会被按
`LIMITS.MAX_IMAGES_PER_SCAN`（1000）截断后返回。

**通过 `sendDiscoveredImages` 流式上报**：每个发现图片的阶段结束时，新
找到的数组也会通过
`chrome.runtime.sendMessage({type: IMAGES_DISCOVERED, images})` 推送。
面板立即渲染；这就是图片密集页面"扫描感觉很快"的关键。

### `state.ts` —— 模块级共享状态

一个小型可变包：

```ts
state = {
  isExtracting: false,
  seenUrls: new Set<string>(),       // 14 个阶段共享去重
  liveObserver: null,                // MutationObserver | null
  highlightedElements: new Map(),    // url → 包裹元素
  fabContainer: null,                // 旧 FAB（已废弃，保留 no-op 兼容）
}
```

**`isExtensionContextValid()`** 是文件中调用频次最高的辅助函数。在
`chrome://extensions` 中"重新加载"扩展后，已经注入的内容脚本会变成孤儿
—— 访问 `chrome.runtime.id` 时会抛错。每个公开入口都必须用这个守卫
保护，否则用户会在页面 DevTools 看到红色错误。

### `monitor.ts` —— MutationObserver 实时监控（Pro）

实时监控用 `{childList:true, subtree:true, attributes:true,
attributeFilter:['src','style','srcset']}` 观察 `document.body`（或
`document.documentElement` 兜底）。变更累积在缓冲区，按防抖定时器
（默认 500ms）刷新；每次刷新都对每个新增元素跑 `extractFromNode`，并对
任何新发现的 URL 触发 `IMAGES_DISCOVERED`。

**累积缓冲 vs 普通防抖**：普通防抖会丢弃前几次 mutation 批次。我们累积
处理，让防抖窗口内一连串插入都能被处理；防抖的只是**处理调用**，不是
数据。

**懒加载处理**：当 `extractFromNode` 发现一个 `naturalWidth === 0` 的
`<img>` 时，它会挂上一个 once 的 `load` listener，等实际加载后再次
extract —— 没有这个，那些先挂空 `<img>` 再设 `src` 的懒加载库（很常见）
只会传 `{naturalWidth:0, naturalHeight:0}` 给面板。

### `highlight.ts` —— 页面内图片高亮

当用户在面板里勾选一张卡片时，面板会向内容脚本发 `HIGHLIGHT_IMAGE`。
`findImageElement(url)` 跑一个 12 段的 URL→element 匹配器（`<img src>`、
`<img srcset>`、`<picture><source>`、CSS background、`::before` content、
link/meta、Shadow DOM 等），把找到的第一个匹配元素包在一个带彩色边框的
定位 overlay 中。`auto-scroll` 通过 `element.scrollIntoView({behavior:
'smooth', block:'center'})` 把它带入视野。

`HIGHLIGHT_IMAGES`（复数）是仅 Pro 的**批量**版本：在一次遍历中重用
`findImageElement` 处理 URL 列表里的每一项。

### `extract-advanced.ts` 与 `shadow-iframe.ts`

为保持 `main.ts` 可读而拆出来的纯辅助函数。每个导出函数都遵循同一个形态：

```ts
export async function extractXxxImages(images: Map<string, ImageItem>): Promise<void>
```

它们直接 mutate 共享的 `images` Map（而不是返回一个新数组），让按 URL
去重的契约只在唯一一个写入点强制执行。

## 7. `sidepanel/` —— UI 层

`sidepanel/` 是仓库中最大的目录（~250 kB 的 TypeScript + TSX）。它通过
同一个 `init.ts` 入口同时承载侧边栏和弹窗运行时。这个目录混合了**遗留
命令式模块**（最初 2024 版代码库）和**新的 Preact 组件**（当模态框形态
的 UI 用命令式实现起来太痛苦时引入的）。

### `init.ts` —— 启动编排器

一个超过 1100 行的 IIFE，在 `DOMContentLoaded` 时运行。启动序列为：

1. 通过 `window.location.pathname` 区分弹窗 vs 侧边栏。
2. `await detectLocale()` —— 阻塞直到 i18n 字典加载完成，让后续的 `t()`
   调用返回正确的语言。
3. 给遥测 envelope 注入元信息（version / locale / plan / A/B 桶）。
4. 每个安装恰好触发一次 `EXTENSION_FIRST_OPEN` 事件（由
   `chrome.storage.local._telemetry_first_open_at` 标记位守卫）。
5. 如果用户从未做过选择，弹出**隐私 opt-in 模态框**（由
   `_telemetry_opt_in_decided` 标记位守卫）。
6. `mountPreactComponents()` —— 在其他代码读取 DOM 引用之前，把每个
   模态框 / 指示器的挂载点替换好。
7. `cacheElements()` —— 填充 `elements: {[key]: HTMLElement}`，让命令式
   模块不必反复 `document.querySelector`。
8. `loadSettings()` → 应用主题 + 密度 + 实时监控指示器。
9. `bindEvents()` —— 接线每个遗留点击处理器。
10. 打开长连接 port：`chrome.runtime.connect({name:
    'image-snatcher-ui'})`。
11. 监听 `tabs.onActivated` + `tabs.onUpdated`（仅侧边栏 —— 弹窗失焦即销毁）。
12. `loadCurrentTab(false, true)` —— 启动首次扫描。

顺序很关键。把 6 移到 9 之后，绑定会指向陈旧的 DOM 节点；把 2 移到 5
之后，无论用户语言是什么，隐私模态框都会以英文渲染。

### `state.ts` —— 全局可变包

`state` 是这个模块导出的普通对象。突变是直接的（`state.foo = bar`）；
Preact 组件通过 `useStore(selector)`（在 `components/storeHook.ts` 中）
订阅一个微型的发布/订阅层。

最关键的字段：

| 字段 | 类型 | 重要性 |
|---|---|---|
| `currentTabId` | `number \| null` | 面板镜像的活跃标签页。受限页时为 null。 |
| `discoveredImages` | `ImageItem[]` | 权威的扫描结果（已去重）。 |
| `discoveredColors` | `string[]` | 跨所有图片聚合的主色调，用于色彩过滤的小色块。 |
| `selectedIds` | `Set<string>` | 选中的图片 id；驱动高亮 + 下载。 |
| `tabCache` | `Map<number, ImageItem[]>` | `chrome.storage.session` 每标签缓存的内存镜像（避免标签切换时往返）。 |
| `appSettings` | `AppSettings` | 最新持久化的设置（filter 配置单独放在 `filterConfig`）。 |
| `currentSortMode` | `SortMode` | `size-desc \| size-asc \| filesize-desc \| filesize-asc \| type \| natural` 之一。 |
| `lastRenderedFilteredIds` | `string[] \| null` | `applyFilters` 的短路缓存键；null 强制重渲。 |
| `proInfo` | `ProUserInfo` | 最新的 License 检查结果；驱动 Pro UI affordance。 |
| `scanProgress` | `{indeterminate, done, total}` | 驱动扫描遮罩的进度条。 |
| `*ModalState` | 各模态框形态 | Preact 组件读取；将 open 设为 true 触发渲染。 |

`elements` 是平行的兄弟字段：`cacheElements()` 填充的 `HTMLElement`
引用类型化缓存。从 `elements` 读取比重新 query DOM 快约 20×，且能避免
`mountPreactComponents()` 替换节点后的陈旧引用 bug。

### 命令式模块 vs Preact 组件

| 关注点 | 归属 | 示例 |
|---|---|---|
| 工具栏按钮、过滤芯片 | 命令式 `*.ts` + `bindEvents()` | `sidepanel/settings.ts > toggleFilterDropdown` |
| 图片网格渲染循环 | Preact `ImageGrid.tsx`（virtua） | 1000+ 卡片的虚拟化列表 |
| 模态框（设置、多标签、去重、收藏） | Preact `*Modal.tsx` | `SettingsModal.tsx`、`MultitabModal.tsx` 等 |
| Toast、徽章、指示器 | Preact `*.tsx` | `ToastContainer.tsx`、`LiveIndicator.tsx` |
| 隐私 / Pro 引导 | Preact `*Modal.tsx` | `PrivacyOptInModal.tsx`、`ProUpgradeModal.tsx` |

边界是"持有复杂内部状态的组件应当 Preact；其他都保持原生"。**不要**为
了一致性而把原生代码迁到 Preact —— bundle 预算是硬约束。

### 懒加载的 Pro 模块

`pro-features.ts` 是所有 Pro 功能入口的单一分发器。每个都用动态
`import()`：

```ts
export async function showCollectionModal(): Promise<void> {
  const { showCollectionModal: impl } = await import('./collection-ui');
  await impl();
}
```

这个模式让 `multitab.ts`、`dedup-ui.ts`、`collection-ui.ts`、
`license-ui.ts`（以及它们的依赖，包括 `shared/phash.ts` 和
`shared/collection.ts`）**都不会进入 `init.js` 初始 chunk**。用户付出
的代价是首次打开 Pro 模态框时的一次额外 fetch（永久缓存）—— 在快网下
通常 <50 ms。

### `scan.ts` —— 扫描状态机

负责扫描遮罩（带进度条和取消按钮的全屏"Scanning..."）和 `fetchImages`
编排。关键职责：

- **`showScanOverlay({title, indeterminate})`** —— 渲染遮罩；把
  `state.scanProgress.indeterminate` 设为 true，让 spinner 在第一个
  `IMAGES_DISCOVERED` 到达前一直转。
- **`updateScanProgress({done, total})`** —— 增量进度，用于单标签后扫
  额外信息（color、pHash）和多标签 `DOWNLOAD_PROGRESS` 广播。
- **`handleScanCancel()`** —— 设置 `state.scanAborted = true`，
  `clearTimeout` 任何挂起的防抖，并静默丢弃本次扫描后续的
  `IMAGES_DISCOVERED` 事件。
- **`fetchImages` / `silentRescan` / `rescanWithProgress`** —— 三个
  扫描触发器；区别仅在于是否显示遮罩、是否显示"From cache" toast。
- **`processImageExtras`** —— 后扫循环，按 `LIMITS.CONCURRENT_FETCHES =
  3` 并行度获取每张图的字节内容，跑色彩提取 + pHash，原地补丁卡片。

## 8. `pages/` —— HTML 入口

三个 HTML 文件成为 Vite 入口；其中一个（`_shared-body.html`）是局部模板，
通过自定义的 `vite-html-include` 插件被其他文件包含。

### `_shared-body.html` —— 共享标记

70+ kB 的局部模板，包含整个工具栏 / 过滤栏 / 图片网格的脚手架。
`sidepanel.html` 和 `popup.html` 都通过下面这行消费它：

```html
<!-- @include _shared-body.html -->
```

`vite-html-include.ts` 在 **crxjs 之前**运行，所以宏在 crxjs 的 HTML
分析器解析入口之前就被展开。如果没有这个顺序，crxjs 会把
`<!-- @include … -->` 当成普通注释，面板会渲染出空 body。

代价：任何标记修改都要审两次（一次为侧边栏布局，一次为弹窗布局），
因为两个外壳渲染同一份 DOM 但宽度差异极大。

### `sidepanel.html`

一个轻量外壳：

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../css/variables.css" />
    <link rel="stylesheet" href="../css/base.css" />
    <!-- … 其他 css/*.css … -->
  </head>
  <body>
    <!-- @include _shared-body.html -->
    <script type="module" src="../sidepanel/init.ts"></script>
  </body>
</html>
```

侧边栏在 Chrome 打开面板的瞬间启动（工具栏图标点击或 `Ctrl+Shift+S`）。
它能跨标签切换存活；`init.ts` 监听 `tabs.onActivated` 并对每次切换重新
跑 `loadCurrentTab`。

### `popup.html` + `popup.ts`

弹窗变体使用同一份 `_shared-body.html` 和同一个 `init.ts` 入口，外加
一个微小的 `popup.ts` 做：

1. 添加 `body.popup-mode` class，让 `popup.css` 覆盖样式（固定 620 × 600）。
2. 禁用标签切换 listener（弹窗失焦即销毁，无意义）。
3. 调整 `--scrollbar-gutter` 让模态框打开时右边缘不抖动。

`popup.css` 只在弹窗模式下打包（独立 Vite 入口）；侧边栏不需要为弹窗
专属样式付出体积代价。

### `reverse-search.html` + `reverse-search.ts`

一个独立的标签页，由侧边栏在用户右键图片选择"反向搜索"时通过
`chrome.tabs.create({url: 'pages/reverse-search.html?engine=google&imageUrl=…'})`
打开。该页面：

1. 从 query string 读取 `engine` 和 `imageUrl`。
2. 如果引擎接受 URL 直传（Google Lens / TinEye），用 `window.location`
   跳转到引擎预构造的 URL。
3. 如果引擎要求 multipart 上传（Baidu 旧 fallback），POST 到
   `REVERSE_SEARCH_UPLOAD` 并跳转到返回的 URL。

之所以存在这个页面，是因为 Manifest V3 禁止内容脚本通过
`chrome.tabs.update` 跳转到任意外部 URL —— 当目标希望某个特定的
Referer 头部时。通过扩展页中转，Referer 头会被设为扩展自身的 origin，
四个支持的引擎都把这视为合法。

## 9. `shared/` —— 单一真理来源

`shared/` 模块**禁止**导入 `background/`、`content/`、`sidepanel/`、
`pages/` 中的任何内容。依赖图严格单向：

```
   background ──┐
   content    ──┼──► shared
   sidepanel  ──┤
   pages      ──┘
```

正是这个限制让同一份代码可以在三个 MV3 运行时间共享而不重复打包。

### 逐模块说明

| 文件 | 公开 API | 备注 |
|---|---|---|
| `types.ts` | 所有 TS 接口（`ImageItem`、`AppSettings`、`LicenseData`、`Telemetry*`） | 无运行时代码。 |
| `constants.ts` | `MESSAGE_TYPES`、`STORAGE_KEYS`、`LIMITS`、`FREE_LIMITS`、`PRICING`、`LICENSE_*`、`TELEMETRY_*`、`SEARCH_ENGINES`、`NAMING_VARIABLES` | 每条接线格式消费者会读到的字面量。 |
| `storage.ts` | `getFilterConfig` / `saveFilterConfig` / `getDownloadHistory` / `addDownloadRecord` / `getAppSettings` / `saveAppSettings` / `getTabImageCache` / `saveTabImageCache` / `setDisplayMode` / … | 包装 `chrome.storage.{sync,local,session}`；防御性合并默认值。 |
| `utils.ts` | `resolveUrl`、`getDomain`、`getFileFormat`、`isDataUri`、`isImageDataUri`、`generateDataUriKey`、`extractBackgroundUrls`、`isGradient`、`isRestrictedUrl`、`deepMerge`、`generateId`… | 纯函数，无框架依赖。100% 测试覆盖。 |
| `converter.ts` | `convertImage(blob, target)` 返回 `{dataUrl, blob, format}` | Canvas API；`toBlob` 返回 null 时降级到 PNG。 |
| `naming.ts` | `applyNamingTemplate(template, vars)` | 替换 `{index}`、`{original}`、`{title}`、`{domain}`、`{width}`、`{height}`、`{format}`、`{date}`、`{timestamp}`、`{number}`。 |
| `phash.ts` | `computePhash(imageData)` 返回 64 字符二进制串；`hammingDistance(a, b)` | 纯 DCT 感知哈希，256×256 下 ~1 ms/图。 |
| `color-extract.ts` | `extractDominantColors(imageData, k=5)` 返回 `string[]`（`#RRGGBB`） | Median-cut 量化。 |
| `collection.ts` | `collectionInit / Add / Remove / Update / GetAll / GetById / Search / Export / Clear` | IndexedDB store `collections` in `ImageSnatcherDB` v1。 |
| `license.ts` | `activateLicense / deactivateLicense / isProUser / getLicenseInfo / validateLicenseRemote / getOrCreateInstanceId` | 与 `https://image-harvest.kyriewen.cn/api/license/*` 往返。 |
| `trial.ts` | `startTrial / isTrialEligible / isTrialActive / getTrialState / reportTrialExpiryIfNeeded` | 一次性 7 天 Pro 试用；本地哨兵在 `chrome.storage.local`。 |
| `telemetry.ts` | `setOptIn / isOptedIn / track / flushNow / setEnvelopeMeta / __resetForTests` | 仅匿名 SDK。**新增任何事件前请阅读这个文件。** |
| `telemetry-events.ts` | `EVENTS`（白名单）、`EVENT_PROP_SCHEMAS`（每事件允许的 prop key）、`sanitizeEventProps`、`isKnownEvent` | 唯一定义"什么可以被发送"的文件。 |
| `ab-experiment.ts` | `getProUpsellBucket()` 返回 `'A' \| 'B'` | 每安装稳定的桶；持久化。 |
| `paywall-state.ts` | `getPaywallState`、`recordPaywallEvent`、gating helpers | 根据用户历史决定付费墙是"软"（横幅）还是"硬"（模态框）。 |
| `rating-prompt-state.ts` | `shouldShowRatingPrompt`、`recordRatingPromptShown`、`recordRatingPromptDismissed` | "好评请求"触发逻辑 —— N 次成功下载 + 冷却。 |
| `i18n.ts` | `detectLocale`、`t(key, vars?)`、`getActiveLocale` | 从 `_locales/*/messages.json` 加载字典（由 `vite.config.ts > copyStaticAssetsPlugin` 镜像到 `dist/_locales/`）。 |

### 为什么遥测有自己的 install id

`shared/telemetry.ts` **不会**从 `shared/license.ts` 读取
`instanceId`，尽管两个文件都需要稳定的每安装标识符。这是刻意的：

- **测试隔离** —— `license.ts` 在模块加载时读 `chrome.storage.local`，
  这强迫每个遥测消费者（包括 node 下的单测）必须 mock `chrome.*`。在
  本地拥有这个 id 让 SDK 可以走可注入的 `StorageAdapter`。
- **隐私审计面积** —— 接线上的标识符是源字符串的 SHA-256 截断。具体哈
  希哪个原始字符串无关紧要；关键是隐私审计员能在一个文件内读到完整
  的身份流程。

## 10. IPC 协议参考

消息名的单一真理来源是 `shared/constants.ts > MESSAGE_TYPES`。每次跨
运行时调用都走 `chrome.runtime.sendMessage`（请求/响应）或长连接
`'image-snatcher-ui'` port 的 `port.postMessage`（广播）。下面的表格
记录了每条接线契约。

### 侧边栏 / 弹窗 → 后台（请求/响应）

| 消息 | 请求形态 | 响应形态 | 处理函数 |
|---|---|---|---|
| `GET_IMAGES` | `{tabId?, searchAllFrames?, liveMonitoring?}` | `{success, images: ImageItem[]}` | `extractor.getImagesFromTab` |
| `GET_HISTORY` | `{}` | `{success, history: DownloadRecord[]}` | `storage.getDownloadHistory` |
| `CLEAR_HISTORY` | `{}` | `{success}` | `storage.clearDownloadHistory` |
| `GET_FILTER_CONFIG` | `{}` | `{success, config: FilterConfig}` | `storage.getFilterConfig` |
| `SAVE_FILTER_CONFIG` | `{config: FilterConfig}` | `{success}` | `storage.saveFilterConfig` |
| `SET_DISPLAY_MODE` | `{useSidePanel: boolean}` | `{success}` | `display-mode.applyDisplayMode` |
| `MULTI_TAB_EXTRACT` | `{tabIds: number[]}` | `{success, images, tabCount}` | `extractor.processMultiTabExtract` |
| `FETCH_IMAGE_DATA` | `{url: string}` | `{success, dataUrl, contentType}` | `reverse-search.fetchImageData` |
| `REVERSE_SEARCH_UPLOAD` | `{engine, imageUrl}` | `{success, redirectUrl}` | `reverse-search.reverseSearchUpload` |
| `HIGHLIGHT_IMAGE` | `{tabId?, imageUrl}` | `{success, found}` | 代理到内容脚本 |
| `UNHIGHLIGHT_IMAGE` | `{tabId?, imageUrl}` | `{success}` | 代理到内容脚本 |
| `HIGHLIGHT_IMAGES` | `{tabId?, imageUrls: string[]}` | `{success}` | 代理到内容脚本 |
| `REMOVE_HIGHLIGHT` | `{tabId?}` | `{success}` | 代理到内容脚本 |
| `SIDE_PANEL_OPENED` | `{tabId}` | `{success}` | 加入 `sidePanelOpenedTabs` Set |
| `SIDE_PANEL_CLOSED` | `{tabId}` | `{success}` | 从 `sidePanelOpenedTabs` 移除 |
| `ACTIVATE_LICENSE` | `{licenseKey}` | `{success, plan, expiresAt, error?}` | `license.activateLicense` |
| `DEACTIVATE_LICENSE` | `{}` | `{success}` | `license.deactivateLicense` |
| `VALIDATE_LICENSE` | `{}` | `{success, status, plan, expiresAt}` | `license.validateLicense` |
| `GET_LICENSE_STATUS` | `{}` | `{success, info: ProUserInfo}` | `license.getLicenseInfo` |

### 后台 → 内容脚本

| 消息 | 请求形态 | 响应形态 | 处理函数 |
|---|---|---|---|
| `EXTRACT_IMAGES` | `{skipIframes?}` | `{success, images: ImageItem[]}` | `content/main.extractImages` |
| `START_LIVE_MONITOR` | `{config?: {debounceMs?}}` | `{success}` | `content/monitor.startLiveMonitoring` |
| `STOP_LIVE_MONITOR` | `{}` | `{success}` | `content/monitor.stopLiveMonitoring` |
| `HIGHLIGHT_IMAGE` | `{imageUrl}` | `{success, found}` | `content/highlight.addHighlight` |
| `UNHIGHLIGHT_IMAGE` | `{imageUrl}` | `{success}` | `content/highlight.removeSingleHighlight` |
| `HIGHLIGHT_IMAGES` | `{imageUrls: string[]}` | `{success}` | `content/highlight.syncHighlights` |
| `REMOVE_HIGHLIGHT` | `{}` | `{success}` | `content/highlight.removeAllHighlights` |
| `PING` | `{}` | `{type: PONG}` | 注入存活探针 |
| `TOGGLE_FAB` | `{}` | `{success}` | 已废弃，保留 no-op 兼容 |

### 内容脚本 → 后台（广播 / fire-and-forget）

| 消息 | 形态 | 行为 |
|---|---|---|
| `IMAGES_DISCOVERED` | `{type, images: ImageItem[]}` | 后台再广播给所有连接到 `image-snatcher-ui` port 的端（即每个打开的面板/弹窗）。 |
| `EXTRACTION_ERROR` | `{type, error, code?}` | 同上广播；面板以 toast 呈现。 |

### 后台 → 侧边栏 / 弹窗（通过 port 广播）

| 消息 | 形态 | 由谁触发 |
|---|---|---|
| `IMAGES_DISCOVERED` | `{images, fromTabId}` | 转发自内容脚本的发现事件 |
| `DOWNLOAD_PROGRESS` | `{completed, total, current, imageCount}` | `extractor.processMultiTabExtract` 每标签 |
| `DOWNLOAD_COMPLETE` | `{count}` | ZIP 下载完成 |
| `DOWNLOAD_ERROR` | `{error}` | `chrome.downloads.download` reject |
| `LICENSE_STATUS_CHANGED` | `{info: ProUserInfo}` | `license.ts > onAlarm` 改变状态后 |
| `MULTI_TAB_EXTRACT_COMPLETE` | `{images, tabCount}` | `extractor.processMultiTabExtract` 完成 |
| `MULTI_TAB_EXTRACT_ERROR` | `{error}` | 多标签编排失败 |
| `CLEAR_SELECTION` | `{type}` | 内容脚本告知面板清空选中（罕见） |

### 错误信封约定

后台返回的每条响应都遵循以下形态：

```ts
type Response<T> =
  | ({ success: true } & T)
  | { success: false; error: string; code?: ErrorCode; workaround?: string };
```

`ErrorCode` 是 `CSP_BLOCKED | TIMEOUT | CORS_DENIED | MEMORY_LIMIT |
NO_IMAGES | INJECTION_FAILED` 之一（`shared/constants.ts >
ERROR_CODES`）。侧边栏 UI 把每个 code 映射到 `_locales/*/messages.json`
中的友好消息；`workaround`（存在时）会在 toast 中原样呈现。

## 11. 存储布局

扩展跨 **4 个**独立存储区域持久化状态。理解哪个区域拥有哪个 key，
是理解跨 reload、跨设备同步、隐身模式行为的关键。

### `chrome.storage.sync`（跨设备同步，~100 kB 上限）

仅用于用户期望跟随自己跨机器的过滤偏好。

| Key | 形态 | 拥有者 |
|---|---|---|
| `filterConfig` | `FilterConfig` | `storage.{get,save}FilterConfig` |

### `chrome.storage.local`（每机器，~10 MB 上限）

绝大部分持久化状态。

| Key | 形态 | 拥有者 | 备注 |
|---|---|---|---|
| `appSettings` | `AppSettings` | `storage.{get,save}AppSettings` | 主题 / 密度 / 显示模式 / 实时监控 / 尺寸限制 |
| `downloadHistory` | `DownloadRecord[]` | `storage.{get,add,remove,clear}DownloadHistory` | 上限 `LIMITS.MAX_DOWNLOAD_HISTORY = 20` |
| `licenseData` | `LicenseData` | `license.{save,get,clear}LicenseData` | Pro 计划、过期时间、实例 id、最后校验 |
| `instanceId` | `string` | `license.getOrCreateInstanceId` | License 激活用的稳定每安装 id |
| `telemetryOptIn` | `boolean` | `telemetry.{is,set}OptIn` | 用户做出明确选择前默认 `true` |
| `telemetryQueue` | `TelemetryEvent[]` | telemetry SDK 内部 | 持久化的重试队列；上限 `TELEMETRY_MAX_QUEUE = 100` |
| `telemetryInstanceHash` | `string` | telemetry SDK 内部 | SHA-256 截断；永不上报原始值 |
| `telemetryInstanceId` | `string` | telemetry SDK 内部 | 哈希的来源；**永不发送** |
| `_telemetry_first_open_at` | `number` | `sidepanel/init.ts` | 首次成功启动的时间戳 —— 守卫 `EXTENSION_FIRST_OPEN` 事件 |
| `_telemetry_opt_in_decided` | `boolean` | `PrivacyOptInModal` | 用户首次选择后置 `true`；守卫弹窗 |
| `trialState` | `{startedAt, expiresAt}` | `shared/trial.ts` | 一次性 7 天 Pro 试用哨兵 |
| `proUpsellBucket` | `'A' \| 'B'` | `shared/ab-experiment.ts` | 每安装稳定 A/B 桶 |
| `paywallState` | `{lastShownAt, dismissals, ...}` | `shared/paywall-state.ts` | 软付费墙 vs 硬付费墙升级跟踪 |
| `ratingPromptState` | `{lastShownAt, dismissals, downloads}` | `shared/rating-prompt-state.ts` | "好评请求"冷却 |

### `chrome.storage.session`（内存中，浏览器重启清空）

用作"应当跨面板关闭/打开存活但不应跨浏览器重启存活"的状态的快速缓存。

| Key | 形态 | 拥有者 | 备注 |
|---|---|---|---|
| `sessionState` | `unknown` | `storage.{save,get,clear}SessionState` | 保留；当前核心代码未写入 |
| `tabImgCache_<tabId>` | `TabImageCacheEntry` | `storage.{save,get,clear}TabImageCache` | 每标签 `{url, timestamp, images: ImageItem[]}` |

### IndexedDB —— `ImageSnatcherDB`

| 数据库 | Store | Schema 版本 | 拥有者 |
|---|---|---|---|
| `ImageSnatcherDB` | `collections` | 1 | `shared/collection.ts` |

索引：`tags`（multiEntry）、`sourceUrl`、`createdAt`。记录是
`CollectionItem` 形态，包括 `Blob` 缩略图 + 完整图片字段。免费层在客户端
按 `FREE_LIMITS.MAX_COLLECTION_ITEMS = 5` 上限；Pro 无限（受浏览器磁盘
配额限制）。

### **永不**持久化的状态

- `state.discoveredImages`、`state.selectedIds`、`state.tabCache` ——
  仅侧边栏运行时；下次扫描重建。
- `state.scanProgress`、`state.*ModalState` —— UI 临时态。
- 后台 SW 中的 `uiPorts: Set<chrome.runtime.Port>` —— SW 每次唤醒重建。

## 12. 状态机

三个子系统维护着值得画图的非平凡状态机。

### 12.1 扫描生命周期（`sidepanel/scan.ts`）

```
                                  ┌────────────────────────┐
                                  │       IDLE             │
                                  │  （无遮罩）             │
                                  └──────────┬─────────────┘
                                             │ 用户打开面板 /
                                             │ 标签变化 / 手动 rescan
                                             ▼
                                  ┌────────────────────────┐
                                  │   SCANNING             │
            ┌─────────────────────│   {indeterminate:true} │
            │                     └──────────┬─────────────┘
            │                                │ 第一个 IMAGES_DISCOVERED 到达
            │                                ▼
            │                     ┌────────────────────────┐
            │  用户点击 Cancel    │   STREAMING            │
            ├─────────────────────│   {done, total}        │
            │                     │   增量渲染              │
            │                     └──────────┬─────────────┘
            │                                │ extractImages() resolve
            ▼                                ▼
   ┌───────────────────┐         ┌────────────────────────┐
   │   ABORTED         │         │  POST_SCAN_EXTRAS      │
   │   （静默丢弃后续  │         │  （fetch + pHash +     │
   │    事件）          │         │   color，3-并发）       │
   └─────────┬─────────┘         └──────────┬─────────────┘
             │                              │ 全部 extras 完成
             ▼                              ▼
   ┌───────────────────┐         ┌────────────────────────┐
   │      IDLE         │◄────────│        IDLE            │
   │  （遮罩隐藏）      │         │   渲染最终化            │
   └───────────────────┘         └────────────────────────┘
```

状态转换通过 `state.scanAborted`、
`state.scanProgress.{indeterminate,done,total}`、`state.isExtracting`
跟踪。

### 12.2 License 状态（`shared/license.ts > isProUser`）

```
                  ┌────────────────────────┐
                  │   无 licenseData       │
                  │   → isPro = false      │
                  └──────────┬─────────────┘
                             │ activateLicense() 成功
                             ▼
                  ┌────────────────────────┐
                  │   ACTIVE               │
                  │   lastVerified 在      │
                  │   24h 内？              │
                  └──────────┬─────────────┘
                             │ 过期（>24h）
                             ▼
                  ┌────────────────────────┐
              ┌───│   重新校验（网络）      │
              │   └──────────┬─────────────┘
              │              │
       网络   │              │ success = valid
       失败   │              ▼
              │   ┌────────────────────────┐
              │   │   ACTIVE（已续期）      │
              │   └────────────────────────┘
              │
              │              ┌────────────────────────┐
              │              │   GRACE PERIOD         │
              └─────────────►│   过期 + 离线          │
                             │   且距上次成功校验      │
                             │   <7 天                 │
                             │   → isPro = true       │
                             └──────────┬─────────────┘
                                        │ >7 天离线
                                        ▼
                             ┌────────────────────────┐
                             │   EXPIRED              │
                             │   → isPro = false      │
                             └────────────────────────┘
```

常量见 `shared/constants.ts`：`LICENSE_CHECK_INTERVAL = 24h`、
`LICENSE_GRACE_PERIOD = 7d`、`MAX_LICENSE_INSTANCES = 1`。

### 12.3 遥测队列（`shared/telemetry.ts`）

```
   track(name, props)
        │
        ▼
   isOptedIn() ?
        │ 否 → 静默返回
        │ 是
        ▼
   isKnownEvent(name) ?
        │ 否 → console.warn + 丢弃
        │ 是
        ▼
   sanitizeEventProps(name, props)
        │
        ▼
   queue.push({event, ts, props})
        │
        ├──► queue.length >= 20？ → flushNow()（高水位）
        │
        └──► scheduleFlush(5s)
                    │
                    ▼
              5s 窗口到达
                    │
                    ▼
              sendBatch(events)
                    │
                    ├── 200 OK    → drainRetryQueue()（同时刷出之前失败的）
                    │
                    └── 网络/5xx  → persistForRetry(events) → 上限 100
```

退出（`setOptIn(false)`）会立即：
1. 设置 `optInCache = false`。
2. 持久化到存储。
3. 丢弃内存队列。
4. 清除任何挂起的 `flushTimer`。
5. 移除持久化的重试队列。

之后每次 `track()` 都是同步 no-op，直到 `setOptIn(true)` 显式再次开启。

## 13. Pro / License 模型

Pro 体系有三层：**门控**、**激活**、**强制**。它们刻意解耦，这样网络
中断不会把已付费的用户锁在他们已经买单的功能之外。

### 门控：谁是 "Pro"？

`shared/license.ts > isProUser()` 是每个 UI 门控会调用的唯一函数。
它返回：

```ts
interface ProUserInfo {
  isPro: boolean;
  plan?: 'monthly' | 'yearly' | 'lifetime' | 'trial' | string | null;
  expiresAt?: number | null;
  status: 'active' | 'expired' | 'inactive';
}
```

该函数咨询 `chrome.storage.local.licenseData` 并应用 §12.2 的状态机：
一个数据已过期但尚未真正失效、且当前离线的用户，最长 7 天内仍解析为
`isPro: true`。

在 UI 中，每个 Pro 功能都遵循**同样的代码形态**：

```ts
const info = await isProUser();
if (!info.isPro) {
  showProUpgradeModal(/* feature key */);
  track(EVENTS.PRO_UPSELL_SHOWN, { feature: '...' });
  return;
}
// ...实际功能代码...
```

`shared/constants.ts` 中的 `FREE_LIMITS` 定义**软上限** —— 如
`MAX_ZIP_IMAGES: 30`（免费）vs Pro 无限。软上限刻意让用户先**体验**到
功能（"first wow"策略），再触发引导。

### 激活：把 key 变成 Pro

用户驱动流程（`sidepanel/license-ui.ts`）：

1. 用户把 license key 粘到激活输入框。
2. 面板向后台发送 `ACTIVATE_LICENSE`。
3. 后台调用 `license.activateLicense(key)`：
   - 规范化 key（`.trim().toUpperCase()`）。
   - `validateLicenseRemoteSafe(key)` —— POST 到 `…/api/license/verify`。
   - `activateLicenseRemote(key, instanceId)` —— POST 到
     `…/api/license/activate`，附上每安装的 `instanceId`（这样一个 key
     同一时刻只能在 `MAX_LICENSE_INSTANCES = 1` 台机器上跑）。
   - 成功后持久化 `LicenseData` 并广播 `LICENSE_STATUS_CHANGED`。
4. 遥测：`LICENSE_ACTIVATED` 触发并**立即 flush**（不等 5 秒 ——
   用户可能立刻关闭面板）。

### 强制：哪些被门控

| 免费 | Pro |
|---|---|
| ZIP 上限 = 每批 30 张 | 无限 |
| 批量复制 URL = 最多 20 | 无限 |
| 收藏夹 = 5 张 | 无限 |
| 分组模式 = `none` + `format` | 全 5 种（`none`、`domain`、`format`、`size`、`tab`） |
| 反向搜索 = Google + TinEye | + Baidu + Yandex |
| ❌ 颜色过滤（免费只能查看，不能按色筛选） | ✅ |
| ❌ 颜色复制 | ✅ |
| ❌ 高亮批量 | ✅ 批量 + 自动滚动 |
| ❌ 实时监控 | ✅ MutationObserver |
| ❌ 单卡删除 | ✅ |
| ❌ 格式转换 | ✅ PNG / JPG / WebP |
| ❌ 自定义命名模板 | ✅ 完整模板变量 |
| ❌ pHash 去重弹窗 | ✅ |
| ❌ 多标签抓取 | ✅ 跨标签 |
| ❌ 高级预览 | ✅ Lightbox + 元数据面板 |

### 试用

`shared/trial.ts` 提供一次性 7 天试用。试用哨兵存放在
`chrome.storage.local.trialState`；一旦消费就不能通过清本地 key 重置
（服务器侧的 `trials` 表也跟踪安装并拒绝再次消费）。

试用期内 `isProUser()` 返回 `{isPro: true, plan: 'trial'}`，envelope
的 `plan` 维度为 `'trial'` —— 这对漏斗分析很有用（`trial → paid` 是
最重要的需要监控的转化率）。

## 14. 隐私与遥测管道

> 用户视角的隐私承诺见 [`PRIVACY.md`](./PRIVACY.md)。本节记录**技术
> 实现**，让隐私审计员可以验证承诺。

### 硬契约

`shared/telemetry.ts` 受 4 条由代码强制的不变量约束：

1. **退出立即静默**。`setOptIn(false)` 同步丢弃内存队列、清除磁盘
   重试队列、取消挂起的 flush 定时器。之后每次 `track()` 都是 no-op，
   直到显式重新 opt-in。
2. **接线上零 PII**。接线的 envelope 仅包含：
   - `instanceIdHash` —— 每安装 id 的 SHA-256，截断为 16 个十六进制字符。
   - `version` —— 扩展版本（如 `"1.0.1"`）。
   - `lang` —— UI 语言（如 `"zh-CN"`）。
   - `plan` —— `"free" | "monthly" | "yearly" | "lifetime" | "trial"`。
   - `schemaVersion` —— 当前为 `1`。
   - `events: TelemetryEvent[]`。
   无 URL、无页面标题、无图片 URL/数据、无 IP（服务器侧国家查询后
   即丢弃）、无用户输入文本。
3. **白名单事件名**。`track(name, props)` 调用
   `isKnownEvent(name)` 对比 `shared/telemetry-events.ts` 的 `EVENTS`
   —— 未知名以 dev 控制台 warn 形式丢弃。每事件 prop schema
   （`EVENT_PROP_SCHEMAS`）把 props 净化为已知的原始值集合。
4. **资源使用有界**。队列上限 100 事件（`TELEMETRY_MAX_QUEUE`）；
   flush 窗口 5s（`TELEMETRY_FLUSH_INTERVAL_MS`）；高水位 20 事件
   （`TELEMETRY_BATCH_SIZE`）。永久服务器中断也无法填满
   `chrome.storage.local`。

### 有哪些事件

完整白名单在 `shared/telemetry-events.ts`。分类：

- **生命周期**：`EXTENSION_INSTALLED`、`EXTENSION_UPDATED`、
  `EXTENSION_FIRST_OPEN`。
- **扫描**：`SCAN_TRIGGERED`、`SCAN_COMPLETED`、`SCAN_CANCELLED`。
- **下载**：`DOWNLOAD_SINGLE`、`DOWNLOAD_BATCH`、`DOWNLOAD_FAILED`。
- **Pro 漏斗**：`PRO_UPSELL_SHOWN`、`PRO_UPSELL_CLICKED`、
  `LICENSE_ACTIVATED`、`LICENSE_DEACTIVATED`、`TRIAL_STARTED`。
- **设置**：`SETTINGS_CHANGED`、`DISPLAY_MODE_CHANGED`、
  `THEME_CHANGED`。
- **其他功能**：`REVERSE_SEARCH_TRIGGERED`、`COLLECTION_ADDED`、
  `MULTITAB_EXTRACT_TRIGGERED` 等。

每个事件的 prop schema 声明哪些 key 是被允许的（如
`{ feature: string, abBucket: 'A' | 'B' }`）。`sanitizeEventProps`
剔除任何不在 schema 中的字段。

### 为什么 install id 有它自己的 hash

`chrome.storage.local.telemetryInstanceId` 是一个随机 base-36 字符串。
首次发送时，`telemetry.ts` 计算 `SHA-256(instanceId).slice(0, 16)`
并缓存为 `telemetryInstanceHash`。**只有 hash 离开设备**。原始 id
永远不会被传输；如果用户清除扩展数据，两者都重新生成，从服务器视角
看就是一个新"用户"。

这是有意为之：即使数据库泄露，里面的标识符也无法在不解 SHA-256 的
情况下与某个 Chrome 安装相关联 —— 即便能解，`instanceId` 本身也只
是一个与身份无关联的随机字符串。

### A/B 实验

`shared/ab-experiment.ts` 在首次解析时分配一个稳定的 A/B 桶，持久化
到 `chrome.storage.local.proUpsellBucket`。桶被盖在 envelope 上
（`abBucket` 字段），并自动注入到任何 schema 声明 `abBucket` 为允许
prop 的事件中。这让漏斗能把每个转化事件 join 回用户所属的变体，无需
在每次 `track()` 调用里都散播 `bucket` 参数。

## 15. 国际化（i18n）

扩展支持 **5 种语言**：英语（`en`，默认）、简体中文（`zh_CN`）、
繁體中文（`zh_TW`）、日本語（`ja`）、Español（`es`）。

### 两个并行的 i18n 系统

这是新贡献者最常见的混淆点：

| 系统 | 谁用 | API | 字典 |
|---|---|---|---|
| **Chrome MV3 原生 i18n** | `manifest.config.ts`（扩展名 + 描述）、Chrome Web Store 上架页 | `__MSG_xxx__` 占位符 + `chrome.i18n.getMessage` | `_locales/<lang>/messages.json` |
| **自定义 in-bundle i18n** | 面板/弹窗内的所有 UI 字符串 | `shared/i18n.ts` 的 `t('key', vars?)` | 同一份 `_locales/<lang>/messages.json`（运行时通过 fetch 重载） |

我们对两个系统复用同一份 JSON 文件，让翻译工作只放一处。
`vite.config.ts > copyStaticAssetsPlugin` 把 `_locales/` 原样镜像到
`dist/`，所以构建后 Chrome 的 i18n 机制依然能看到它。

### `shared/i18n.ts` 流程

```
detectLocale()
  ├── 读 chrome.storage.local.userLocale（用户显式选择优先）
  ├── 兜底 chrome.i18n.getUILanguage()
  ├── 兜底 navigator.language
  └── 默认 'en'
       │
       ▼
loadCatalogue(activeLocale)
  ├── fetch('_locales/<locale>/messages.json')
  ├── 解析 + 缓存到 catalogueCache: Map<locale, messages>
  └── 失败时 fallback 到 'en' 字典
       │
       ▼
t('key', {var1: 'value'})
  ├── 读 catalogueCache.get(activeLocale)?.[key]?.message
  ├── 插值 `$var1$` → 'value'
  ├── 缺 key 时返回 key 字面量（明显失败）
  └── 缺 locale 时穿透到 'en'
```

### 添加一个新字符串

1. 把 key 加到 `_locales/en/messages.json`：
   ```json
   {
     "myNewLabel": {
       "message": "My label",
       "description": "Used in the foo modal header"
     }
   }
   ```
2. 把翻译加到其余 4 个语种的 `messages.json`。用 `description` 字段
   给翻译者上下文。
3. 在 TS/TSX 中用 `t('myNewLabel')`，仅 `manifest.config.ts` 中用
   `__MSG_myNewLabel__`。
4. `e2e/i18n-locale-switch.e2e.ts` 测试会确保 5 种 locale 都能渲染
   面板而无 missing-key 兜底。

### 添加一种新语言

新增第 6 种语言是个 4 步 PR：

1. `mkdir _locales/<new-lang>/`（如 `_locales/de/`）。
2. 复制 `_locales/en/messages.json` 并翻译每个值。
3. 在 `sidepanel/settings.ts` 的语言选择器中添加该 locale。
4. 在 `i18n-locale-switch.e2e.ts` 中加 e2e 检查。

locale 代码必须匹配 Chrome 的 locale 字符串 —— 见
[Chrome i18n locales](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales)。

## 16. 构建管道

构建系统是 **Vite 5 + `@crxjs/vite-plugin`**，加上几个本仓库专用的插件。
所有面向开发者的命令都集中在 `package.json` 的 `scripts` 中。

### 命令清单

| 命令 | 做什么 |
|---|---|
| `npm run dev` | Vite 开发服务器 + crxjs HMR；输出到 `dist/`。在 `chrome://extensions` 中加载 `dist/`。 |
| `npm run build` | TS typecheck → 生产构建到 `dist/` → `scripts/check-bundle-size.mjs` 体积预算守门。 |
| `npm run zip` | 跑 `build`，再用 `scripts/zip-extension.mjs` 把 `dist/` 打成 `image-harvest-v<version>.zip`。 |
| `npm run lint` | ESLint（flat config）+ Prettier check。 |
| `npm run lint:fix` | 同上但 `--fix`。 |
| `npm run typecheck` | `tsc --noEmit`，仅类型检查。 |
| `npm run test` | Vitest run（无 watch）。 |
| `npm run test:watch` | Vitest watch 模式。 |
| `npm run test:coverage` | Vitest + V8 覆盖率。 |
| `npm run e2e` | Playwright run（headed Chromium，workers=1）。 |
| `npm run e2e:smoke` | 仅跑 `e2e/smoke.e2e.ts` —— 在 `ci.yml` 里用做"快速烟雾"门。 |
| `npm run analyze` | 跑 build 并打开 rollup-plugin-visualizer 的 treemap。 |

### Vite 关键插件

`vite.config.ts` 里激活的插件（顺序很关键）：

1. **`htmlIncludePlugin()`**（自定义） —— 把 `<!-- @include xxx.html
   -->` 宏在传给 crxjs 之前展开。
2. **`crxjs({manifest})`** —— 消费 `manifest.config.ts`；为内容脚本 +
   service worker 处理 ESM-在-MV3 的接线。
3. **`copyStaticAssetsPlugin()`**（自定义） —— 把 `_locales/`、`icons/`
   原封镜像到 `dist/`。
4. **`preact()`** —— `@preact/preset-vite`；启用 JSX、`react`/`react-dom`
   到 `preact/compat` 的别名、HMR。
5. **`visualizer({open: process.env.ANALYZE === 'true'})`** —— rollup
   bundle 可视化器；只在 `npm run analyze` 时打开 treemap。

### 输出布局

成功构建后 `dist/` 形如：

```
dist/
├── manifest.json                   ← crxjs 从 manifest.config.ts 生成
├── service-worker-loader.js        ← crxjs 桥接 SW（小，加载实际 chunk）
├── assets/
│   ├── index.ts-loader-XXXXXXXX.js ← 后台 SW
│   ├── main.ts-loader-XXXXXXXX.js  ← 内容脚本
│   ├── init-XXXXXXXX.js            ← sidepanel 入口（≤ 50 kB gzip）
│   ├── reverse-search-XXXXXXXX.js  ← 反向搜索页
│   ├── popup-XXXXXXXX.js           ← 弹窗专属补丁
│   └── *.css                       ← 拆分的 CSS chunk
├── pages/
│   ├── sidepanel.html
│   ├── popup.html
│   └── reverse-search.html
├── _locales/<lang>/messages.json   ← 由 copyStaticAssetsPlugin 镜像
├── icons/icon{16,32,48,128}.png
└── ...其他懒加载 chunk
```

### `manifest.config.ts`

我们 **不** 手写 `manifest.json`。`manifest.config.ts` 导出一个类型化对象
（来自 `@crxjs/vite-plugin` 的 `defineManifest`），构建时被序列化成
`dist/manifest.json`。好处：

- TypeScript 自动补全每个 manifest key。
- `version` 从 `package.json` 拉取（**单一真理来源**）。
- 内容脚本入口被静态声明，crxjs 自动接线 ESM imports。
- 权限阵列里可以 inline 注释（`// "alarms" 给每日 license 检查`）。

### Bundle 体积守门

`scripts/check-bundle-size.mjs` 在每次 `npm run build` 后运行，对每个
受门控的 chunk 强制 gzip 上限。当前预算：

| Chunk | 上限 | 当前 |
|---|---|---|
| `assets/init-*.js`（侧边栏入口） | 50 kB | ~38 kB |
| `assets/main.ts-loader-*.js`（内容脚本） | 30 kB | ~14 kB |
| `assets/index.ts-loader-*.js`（后台 SW） | 30 kB | ~12 kB |

超出预算时 CI（`ci.yml > build`）失败并打印明细。守门是**故意苛刻**的
—— 想把 50 kB 抬到 60 kB 的 PR 必须在描述里说明原因。

## 17. 性能预算

性能预算是**契约**，而不是建议。每条预算在 CI 中机器执行；想抬高的 PR
必须改文档（这一节）+ `scripts/check-bundle-size.mjs` 阈值 + commit
message 写清原因。

### Bundle 体积（gzip，CI 强制）

| 守门项 | 预算 | 原因 |
|---|---|---|
| `init.js`（侧边栏入口） | **50 kB** | 用户每天打开侧边栏几十次；解析 + eval 时间直接体感为"打开延迟"。 |
| `main.ts-loader.js`（内容脚本） | **30 kB** | 注入到任何被扫描的页面；与页面 main thread 竞争；过大伤目标站点性能。 |
| `index.ts-loader.js`（后台 SW） | **30 kB** | SW 是 cold-started 的；越大冷启动越慢，影响第一次扫描延迟。 |

懒加载 chunk（`jszip`、`collection-ui`、`multitab`、`dedup-ui`、
`license-ui`、`pro-features` 中所有 Pro 模块）**没有**预算 —— 它们只在
用户主动触发对应功能时被取。

### 运行时延迟（人工测试）

| 场景 | 目标 | 测量方式 |
|---|---|---|
| 侧边栏冷启动 | < 250 ms 首屏 | `performance.mark` 在 `DOMContentLoaded` → `mountPreactComponents` 完成 |
| 标签切换 → 镜像扫描结果 | < 100 ms（缓存命中） | `loadCurrentTab` → 第一个 `renderImages` |
| 单标签扫描完成（中型页，~50 张图） | < 500 ms 到首屏渲染 | `SCAN_TRIGGERED` → 第一个 `IMAGES_DISCOVERED` 渲染 |
| pHash 计算（256×256） | < 5 ms / 图 | `phash.test.ts` 中带 benchmark |
| 颜色提取（5 色，256×256） | < 10 ms / 图 | `color-extract.test.ts` 带 benchmark |
| ZIP 打包 100 张图（~30 MB） | < 3 s | 手动 e2e |

### 内存

| 守门项 | 上限 | 拥有者 |
|---|---|---|
| 缩略图缓存 | `LIMITS.MAX_THUMBNAIL_MEMORY_MB = 50` MB | `sidepanel/scan.ts > processImageExtras` |
| ZIP 总大小 | `LIMITS.MAX_ZIP_SIZE_MB = 500` MB | `sidepanel/actions.ts > downloadSelectedAsZip` |
| 单次扫描图片上限 | `LIMITS.MAX_IMAGES_PER_SCAN = 1000` | `content/main.ts > extractImages` |
| 并发 fetch | `LIMITS.CONCURRENT_FETCHES = 3` | `sidepanel/scan.ts > processImageExtras` |
| 单次 fetch 超时 | `LIMITS.FETCH_TIMEOUT_MS = 10_000` | 同上 |

超过 1000 张的页面会被截断（带 toast 通知用户）—— 没有这个上限，扫描
某些图床站会触发 OOM。

## 18. 测试策略

两个独立的测试金字塔层，分别由两个不同的 runner 跑：

```
       ┌────────────────────────────────────────┐
       │           e2e（Playwright）             │
       │   41 个 spec / 真实 Chromium / 真实扩展  │
       └────────────────────────────────────────┘
       ┌────────────────────────────────────────┐
       │       单元 + 组件（Vitest 2）           │
       │  53 个文件 / ~1,345 用例 / 80%+ 行覆盖率 │
       └────────────────────────────────────────┘
```

### Vitest 层

**`vitest.config.ts`** 按 glob 切分环境：

- `tests/**/*.test.ts` —— Node 环境，用于纯逻辑（`shared/utils`、
  `shared/converter`、`shared/phash`、`shared/license`、`shared/telemetry`、
  `background/extractor`、`content/utils`）。
- `tests/**/*.tsx` —— jsdom 环境，用于 Preact 组件（`@testing-library/preact`
  + 自定义 `mountWithStore` helper）。

**关键 helpers**（`tests/_helpers/`）：

- `installChromeMock()` —— 装一个完整的 `chrome.*` mock（storage、
  runtime、tabs、scripting、alarms、downloads）。每个测试要求 mock
  时显式调用，全局没有默认 mock —— 这能强迫测试声明它们用到哪些 API。
- `mountWithStore(component, initialState)` —— 用注入的 store + mock
  的 i18n 装一个 Preact 组件。
- `fake-indexeddb` —— 通过 `npm:fake-indexeddb` 接线，让 `shared/collection`
  能 unit-test 而无需真实浏览器。

**遥测测试**（`tests/telemetry*.test.ts`）有自己的隔离规则：每个测试
最开始都调 `__resetForTests()` 清掉 SDK 的内存缓存。这是必须的，因为
SDK 在模块加载时就缓存了 opt-in 状态 + queue —— 不重置则跨测试串扰。

### Playwright 层

**`playwright.config.ts`** 跑 headed Chromium，`workers: 1`（MV3 扩展
没法可靠地并行加载）。每个测试通过 `_helpers/launchExtension.ts` 启动
一个干净的 user-data-dir，加载 `dist/` 作为已解压扩展。

**典型流程**（`e2e/smoke.e2e.ts`）：

```ts
import { test, expect } from './_helpers/launchExtension';

test('扫描静态页能找到所有 img 标签', async ({ context, page }) => {
  await page.goto('file://' + path.resolve(__dirname, 'fixtures/static-images.html'));
  const sidePanel = await openSidePanelOnFixture(context, page);
  await expect(sidePanel.locator('[data-testid="image-card"]')).toHaveCount(5);
});
```

**Fixtures**（`e2e/fixtures/`）是手写的 HTML 文件，覆盖
"棘手的真实世界形态"：Shadow DOM 嵌入、懒加载哨兵、CSS background-only
页、跨域 iframe、巨大的滚动列表。每个 spec 通过 `file://` URL 引用一个
fixture，确保 e2e 是离线 + 确定性的。

### 覆盖率门槛

CI 强制 V8 行覆盖率 **≥ 80%**（`ci.yml > test:coverage`）。当前实际值
约 84%。下降会让 CI red-x，但不会自动阻塞 merge —— 通常修复方式是：
要么在 PR 里加测试，要么在描述里证明这段代码无法/不必测（如：浏览器
仅 API 桥接代码）。

### 跑测试

```bash
# 单元 + 组件，watch
npm run test:watch

# 单元 + 组件，one-shot 加覆盖率
npm run test:coverage

# 端到端，全部
npm run e2e

# 端到端，只跑 smoke
npm run e2e:smoke

# 跑单个文件
npx vitest run tests/license.test.ts
npx playwright test e2e/multitab.e2e.ts --headed
```

## 19. 发布管道

发布**完全自动化**，触发条件是任何匹配 `v*.*.*` 的 git tag。

### 流程

```
本地：
  1. 编辑 package.json: "version": "1.2.3"
  2. 在 CHANGELOG.md 顶部加一节 "## [1.2.3] - YYYY-MM-DD"
  3. git commit -am "chore: release v1.2.3"
  4. git tag v1.2.3
  5. git push origin master --tags

GitHub Actions（.github/workflows/release.yml）：
  6. checkout @ tag
  7. setup Node 22 + npm ci
  8. npm run lint && npm run typecheck
  9. npm run test
  10. npm run build （隐含 check-bundle-size）
  11. npm run zip → image-harvest-v1.2.3.zip
  12. softprops/action-gh-release：
        - 抽取 CHANGELOG.md 中匹配的小节作为 release body
        - 上传 zip 作为 release asset
        - 用 tag 作为标题创建 GitHub Release
```

### Chrome Web Store

zip 仍需**手动**上传到 Chrome Web Store 开发者面板 —— Google 的 API 需要
OAuth tokens 而我们刻意没有把它们存到 CI secrets（被盗的 token 可以推任意
代码到所有用户那里）。流程：

1. 从 GitHub Release 下载 `image-harvest-v<version>.zip`。
2. 登录 [Chrome Web Store dev console](https://chrome.google.com/webstore/devconsole/)。
3. 上传 zip 到当前商品。
4. 复制 `docs/chrome-store/description.md` 的内容到商品描述输入框
   （如果文案变了）。
5. 提交审核 —— 通常 1-3 个工作日。

### 紧急回滚

如果发布到 Web Store 后才发现严重问题：

1. 在 Web Store 控制台 **Unpublish** 当前版本（即时 —— 已安装的不受影响）。
2. **删除有问题的 GitHub Release**（避免有人下载错的 zip）。
3. **不要**删除 git tag —— 留着以便事后复盘。
4. 在 hotfix 分支修复，发新 patch 版本（如 `v1.2.4`）。
5. 在新版 release 里 reference 被回滚的版本。

### 版本号语义

我们遵循语义化版本：

- **patch**（`1.0.0 → 1.0.1`）：bugfix、文档、依赖小升级。
- **minor**（`1.0.0 → 1.1.0`）：新功能、新 manifest 权限（如果是无害
  的）、新支持的 locale。
- **major**（`1.0.0 → 2.0.0`）：破坏性的设置 schema 变更（要求迁移）、
  破坏性的 manifest 权限（如新增 host permission，需要用户重新授权）、
  对 IndexedDB schema 的破坏性修改。

每次 minor/major bump 都必须在 `CHANGELOG.md` 中添加 **Migration** 小节。

## 20. 扩展项目

常见扩展任务的"How to..."食谱。每条都把抽象的"加新功能"翻译成具体的
"碰这些文件，用这些模式"。

### 加一种新的图片源

例：捕获 `<my-custom-element src="…">` 自定义元素。

1. 在 `content/main.ts` 的 14 阶段流水线**末尾**加阶段 15：
   ```ts
   // 阶段 15: 自定义元素
   document.querySelectorAll('my-custom-element[src]').forEach((el) => {
     const src = (el as HTMLElement).getAttribute('src');
     if (!src) return;
     addImage(images, src, /* metadata */);
   });
   sendDiscoveredImages(/* 该阶段新发现的 */);
   ```
2. 在 `e2e/fixtures/` 加一个 fixture HTML 包含该元素。
3. 在 `e2e/extract-custom-elements.e2e.ts` 加一个 spec 走该 fixture，
   断言侧边栏渲染出该图。
4. 不需要 manifest 改动 —— `<all_urls>` 已经覆盖任何页面。

### 加一条新的 IPC 消息

例：让侧边栏能问 SW 当前选中标签页的 favicon。

1. 在 `shared/constants.ts > MESSAGE_TYPES` 加常量：
   ```ts
   GET_TAB_FAVICON: 'GET_TAB_FAVICON' as const,
   ```
2. 在 `shared/types.ts` 加请求 / 响应类型：
   ```ts
   export interface GetTabFaviconRequest { tabId?: number }
   export interface GetTabFaviconResponse { success: boolean; faviconUrl?: string; error?: string }
   ```
3. 在 `background/index.ts > handleMessage` switch 里加 case：
   ```ts
   case MESSAGE_TYPES.GET_TAB_FAVICON: {
     const tab = await chrome.tabs.get(message.tabId ?? state.currentTabId);
     return safeSendResponse(sendResponse, { success: true, faviconUrl: tab.favIconUrl });
   }
   ```
4. 在 `tests/background-index.test.ts` 加单测，mock `chrome.tabs.get`。
5. 在 §10（IPC 协议参考）的请求/响应表里更新本文档。

### 加一个新的 Pro 功能

例：把所有图导出到 PDF。

1. 把功能逻辑作为新模块写进 `sidepanel/`：`pdf-export.ts`，导出
   `exportSelectedAsPdf()`。
2. 在 `sidepanel/pro-features.ts` 通过动态 `import()` 添加分发器项 ——
   保持懒加载：
   ```ts
   export async function showPdfExport(): Promise<void> {
     const info = await isProUser();
     if (!info.isPro) {
       showProUpgradeModal('pdfExport');
       track(EVENTS.PRO_UPSELL_SHOWN, { feature: 'pdfExport' });
       return;
     }
     const { exportSelectedAsPdf } = await import('./pdf-export');
     await exportSelectedAsPdf();
   }
   ```
3. 在 `sidepanel/init.ts > bindEvents()` 给触发 UI 绑定按钮处理器
   （或在已有的 `SettingsModal.tsx` 里加 menu 项）。
4. 把功能加到 §13 的免费 vs Pro 表格。
5. 翻译用到的字符串到 `_locales/<lang>/messages.json` 全部 5 个语种。
6. 加单测：`tests/pdf-export.test.ts`。

### 加一个新的 telemetry event

例：跟踪用户切换排序模式的频率。

1. 在 `shared/telemetry-events.ts` 给 `EVENTS` 加常量：
   ```ts
   SORT_MODE_CHANGED: 'sort_mode_changed' as const,
   ```
2. 在 `EVENT_PROP_SCHEMAS` 给同一个 key 声明 schema：
   ```ts
   [EVENTS.SORT_MODE_CHANGED]: {
     mode: ['size-desc', 'size-asc', 'filesize-desc', 'filesize-asc', 'type', 'natural'] as const,
   },
   ```
3. 在 `sidepanel/filter.ts > setSortMode` 调用：
   ```ts
   track(EVENTS.SORT_MODE_CHANGED, { mode: newMode });
   ```
4. 在 §14（隐私与遥测管道） "有哪些事件" 列表里加上文档。
5. 单测：在 `tests/telemetry.test.ts` 加用例确保新事件通过 `isKnownEvent`
   且 `sanitizeEventProps` 不会剔除 `mode` 字段。

### 加一种新语言

见 §15.3 —— 4 步 PR。

### 加 / 改一条性能预算

1. 编辑 `scripts/check-bundle-size.mjs` 顶部的预算 map。
2. 在本文档 §17 表格里更新数字。
3. 在 commit message 解释为什么变更（例："JSZip 升到 v4 增加 8 kB；
   把懒加载的 jszip chunk 预算从 90 kB 提到 100 kB"）。

## 21. 术语表

| 术语 | 定义 |
|---|---|
| **MV3** | Manifest V3 —— Chrome 扩展平台当前主版本。强制 service worker（取代持久后台页）、声明式 net request、移除 remote code 执行。 |
| **SW** | Service Worker。后台运行时；按需启动，约 30 秒空闲后被 Chrome 杀掉。**没有** DOM。 |
| **内容脚本（Content script）** | 注入到目标页 `document` 的隔离世界 JS。能见到页面 DOM；不能调 `chrome.tabs.*`。 |
| **侧边栏（Side Panel）** | Chrome 113+ 的扩展 UI 表面。和顶级 frame 持续共存；切换标签时不销毁。 |
| **弹窗（Popup）** | 旧式 MV2/MV3 工具栏附属 UI。失焦即销毁。 |
| **隔离世界（Isolated world）** | 内容脚本所在的 V8 context；和页面共享 DOM 但 JS 变量不可见。 |
| **Shadow DOM** | 像 `<video>` 这样的原生组件以及 web components 用到的 DOM 子树。需要专门遍历。 |
| **抓取（Extraction）** | 在页面里查找图片 URL 的 14 阶段流水线，由 `content/main.ts` 跑。 |
| **实时监控（Live Monitoring）** | 仅 Pro 功能。MutationObserver 在 DOM 变化时增量地把新图推到面板。 |
| **门控（Gating）** | "这个用户能用 Pro 功能吗？"的检查。每条都走 `isProUser()`。 |
| **激活（Activation）** | 把 license key 兑换成持久化的 `LicenseData`。 |
| **强制（Enforcement）** | 把 `isPro: false` 的用户挡在功能外（要么禁用按钮，要么弹付费墙）。 |
| **宽限期（Grace period）** | 7 天窗口，已知有效但当前离线的 license 仍解析为 `isPro: true`。 |
| **首日打开（First-day open）** | 安装后首次成功面板启动；恰好触发一次 `EXTENSION_FIRST_OPEN` 遥测事件。 |
| **opt-in 遥测** | 默认 **on**；用户可在隐私模态框 / 设置里关闭。**永不**收集 PII。 |
| **付费墙（Paywall）** | 用户尝试 Pro 功能时显示的 Pro 升级提示模态框。"软" = 横幅，"硬" = 阻塞模态框。 |
| **A/B 桶** | 每安装稳定的 `'A' \| 'B'`，自动盖到声明 `abBucket` schema 的 telemetry 事件上。 |
| **pHash** | 感知哈希。从图片中导出的 64-bit DCT-based 哈希；汉明距离衡量视觉相似度。 |
| **median-cut** | `shared/color-extract.ts` 用的颜色量化算法，提取每张图的前 N 主色。 |
| **virtua** | 用作 `ImageGrid.tsx` 虚拟滚动器的库；仅引入这一个 Preact-incompatible-by-default 的依赖（用 `preact/compat` 别名）。 |
| **crxjs** | `@crxjs/vite-plugin`。在 Vite 中处理 MV3 接线（manifest 解析、内容脚本 ESM、HMR）。 |
| **flat config** | ESLint 9 风格的配置（`eslint.config.ts`）；和老的 `.eslintrc.*` 替代。 |
| **CSP** | Content Security Policy。某些站点禁用 `unsafe-eval` 等，会阻断旧式注入；`background/injector.ts` 检测并友好降级。 |
| **CORS** | Cross-Origin Resource Sharing。免费用户的跨域 fetch 在面板上下文必败；后台 SW 用 `<all_urls>` host permission 代理它们。 |
| **`_locales/`** | Chrome MV3 i18n 字典目录。每个子目录一个 `messages.json`。 |
| **`__MSG_xxx__`** | Chrome 原生 i18n 占位符，仅在 manifest 字段里有效。 |
| **`t('key')`** | 我们的自定义 i18n 函数（`shared/i18n.ts`）；运行时 fetch + 解析同一份 JSON 字典，让 UI 能跟随 `userLocale` 设置实时切换。 |

---

> 需要新概念的术语解释？开 PR 加在这里。术语表对新贡献者非常有帮助。

---

> **最后更新**：本文档跟随 `master` 分支同步。当你修改了
> `manifest.config.ts`、`shared/constants.ts`，或 `background/` 中任何
> 消息路由文件时，请在同一个 PR 中同步更新本文相关章节。
