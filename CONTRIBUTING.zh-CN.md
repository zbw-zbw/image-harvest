# 参与贡献 Image Harvest

<p align="right">
  <strong><a href="./CONTRIBUTING.md">English</a> | 简体中文</strong>
</p>

首先，感谢你抽出时间来贡献！🎉

Image Harvest 是一款隐私优先的 Chrome 扩展，用于批量识别并下载任意网页
中的图片。每一份贡献 —— 一个 bug 报告、一次拼写修正、一个新功能 ——
都在帮助这个项目变得更好。

## 目录

- [行为准则](#行为准则)
- [如何贡献？](#如何贡献)
- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [编码规范](#编码规范)
- [Pull Request 流程](#pull-request-流程)
- [我们不接受的内容](#我们不接受的内容)

## 行为准则

友善。尊重。假设善意。就这么简单。

详见 [`CODE_OF_CONDUCT.zh-CN.md`](./CODE_OF_CONDUCT.zh-CN.md)。

## 如何贡献？

### 🐛 报告 Bug

在提交 bug 报告之前：

1. 检查 [已有 issue](https://github.com/zbw-zbw/image-harvest/issues) 以避免重复
2. 确保你使用的是 Chrome Web Store 上的最新版本
3. 尝试在 Chrome **隐身窗口（禁用所有其他扩展）** 中复现问题

提交 bug 时，请使用 `Bug Report` issue 模板 —— 它会询问我们帮助你
所需的全部信息。

### 💡 提议功能

使用 `Feature Request` issue 模板。好的功能提议应包含：

- **你试图解决的问题**（不只是"加 X"）
- **你当前的变通方案**（如有）
- **为什么这个功能也会帮到其他用户**（不只是你自己）

### 📝 改进文档

文档 PR 永远受欢迎。包括：

- 修正拼写错误
- 改善 README
- 添加更清晰的代码注释
- 翻译 README（我们已有英文 + 简体中文；欢迎其他语言）

### 🔧 贡献代码

请参见下方 [开发环境搭建](#开发环境搭建)。

## 开发环境搭建

### 前置条件

- **Google Chrome 88+**（Manifest V3 支持）
- **Node.js 18+**（Vite 构建、lint 和测试需要）
- **Git**

### 安装开发依赖

```bash
npm install
```

这会安装 Vite + `@crxjs/vite-plugin`（构建）、TypeScript + `@types/chrome`（类型）和 Vitest（单元测试）。

### 日常命令

```bash
npm run dev               # Vite 开发服务器 + HMR —— 每次保存自动重建 dist/
npm run build             # 生产构建到 dist/
npm run preview           # 预览构建产物
npm run typecheck         # tsc --noEmit（仅类型检查）
npm run lint              # ESLint flat config
npm run lint:fix          # 自动修复可修复的问题
npm test                  # Vitest 单元测试
npm run test:watch        # 迭代测试时使用 watch 模式
npm run test:coverage     # V8 覆盖率报告，输出到 coverage/
npm run e2e               # Playwright 端到端测试（全量）
npm run e2e:smoke         # 仅烟雾测试（3 个用例，~5 秒）
```

### 本地运行扩展

```bash
# 1. 克隆并安装
git clone https://github.com/zbw-zbw/image-harvest.git
cd image-harvest
npm install

# 2. 构建（或用 `npm run dev` 启用 HMR）
npm run build

# 3. 在 Chrome 中加载扩展
# - 打开 chrome://extensions/
# - 启用右上角的"开发者模式"
# - 点击"加载已解压的扩展程序"
# - 选择 **dist/** 文件夹（不是仓库根目录）

# 4. 将扩展固定到工具栏以便使用
# 点击拼图图标 → 固定 Image Harvest

# 5. 打开任意图片丰富的网页，点击扩展图标
```

> **提示**：运行 `npm run dev` 会在你编辑时持续更新 `dist/`。保存后只需
> 在 `chrome://extensions/` 上点击 Image Harvest 卡片的 **重新加载** 按钮。
> 内容脚本的修改还需要刷新目标网页。

## 项目结构

```text
image-harvest/
├── manifest.config.ts         # 类型化 MV3 manifest（由 @crxjs/vite-plugin 消费）
├── vite.config.ts             # Vite + crxjs 配置
├── tsconfig.json              # TypeScript 配置（allowJs: true, noImplicitAny: false）
├── package.json
├── background/                # Service Worker 模块（ES modules）
│   ├── index.ts              # 入口：消息路由器
│   ├── extractor.ts          # 跨标签页编排
│   ├── injector.ts           # 内容脚本注入
│   ├── display-mode.ts       # 弹窗 / 侧边栏切换
│   ├── license.ts            # Pro License 校验
│   ├── reverse-search.ts     # Google/TinEye/Yandex 反向搜索
│   └── utils.ts
├── content/                   # 页面注入脚本（单一 bundle，ES modules）
│   ├── main.ts               # 入口：消息路由 + 14 阶段抓取
│   ├── state.ts              # 模块级共享状态
│   ├── utils.ts              # parseSrcset / sendDiscoveredImages / ...
│   ├── extract-advanced.ts   # CSS 背景、懒加载、SVG、canvas
│   ├── shadow-iframe.ts      # Shadow DOM + 同源 iframe
│   ├── monitor.ts            # MutationObserver 实时监控
│   └── highlight.ts          # 页面内图片高亮
├── sidepanel/                 # 侧边栏 UI 模块（~20 个 .ts/.tsx 文件）
├── pages/                     # popup.ts / popup.html / sidepanel.html / reverse-search.*
├── css/                       # 样式表（8 个文件，通过 CSS 变量实现主题）
├── shared/                    # 共享工具（跨运行时的单一真理来源）
│   ├── types.ts              # 共享接口（ImageItem、AppSettings 等）
│   ├── constants.ts          # 消息类型、枚举、默认值
│   ├── utils.ts              # 杂项辅助函数
│   ├── phash.ts              # 感知哈希
│   ├── color-extract.ts      # Median Cut 颜色提取
│   ├── converter.ts          # PNG ↔ JPG ↔ WebP 转换
│   ├── naming.ts             # 文件名模板引擎
│   ├── storage.ts            # chrome.storage 封装
│   ├── collection.ts         # IndexedDB 收藏库
│   ├── license.ts            # License 状态机
│   ├── telemetry.ts          # 匿名 opt-in 遥测 SDK
│   └── i18n.ts               # 国际化
├── tests/                     # Vitest *.test.ts → 单元测试
├── e2e/                       # Playwright *.e2e.ts → 端到端测试
├── assets/ + icons/           # 视觉资源
├── docs/chrome-store/         # Chrome Web Store 上架文案
└── scripts/                   # 工具脚本（体积检查、zip 构建、图标生成）
```

### 构建管道

扩展使用 **Vite + `@crxjs/vite-plugin`** 构建：

- `manifest.config.ts` 是类型化的 manifest 源（不再手动编辑 `manifest.json`）
- 所有源码都是 **TypeScript ES 模块**；`jszip` 通过 `import JSZip from 'jszip'` 从 npm 消费
- crxjs 负责：
  - 把内容脚本打包为每个入口一个 IIFE
  - 生成 Service Worker 加载器
  - 将生产 manifest 输出到 `dist/manifest.json`
- 输出到 `dist/` —— 在 Chrome 中通过"加载已解压的扩展程序"加载该文件夹

## 编码规范

### TypeScript

- **全面 TypeScript** —— `background/`、`content/`、`sidepanel/`、
  `shared/`、`pages/` 中不允许纯 `.js` 源文件
- **迁移期间 TS 严格性有意放宽**（`allowJs: true`、
  `noImplicitAny: false`）。函数参数和事件处理器在运行时契约是动态的
  地方可能使用 `any` 类型。可在后续 PR 中按模块逐步收紧。
- 使用 ES2020+ 特性：`async`/`await`、可选链（`?.`）、空值合并
  （`??`）、`const`/`let`（永不使用 `var`）。
- 显式命名：`numSuccessfulRequests` > `n`，`generateDateString` > `genYmdStr`。
- 在提交 PR 前运行 `npm run typecheck` 和 `npm run lint`。

### 测试

Image Harvest 有 **两层自动化测试**：

| 层   | Runner          | 环境                           | 范围                                                                           | 命令          |
| ---- | --------------- | ------------------------------ | ------------------------------------------------------------------------------ | ------------- |
| 单元 | Vitest 2        | node + jsdom                   | `shared/*`、`background/*`、`content/*`、`sidepanel/*`、`pages/*`、Preact 组件 | `npm test`    |
| E2E  | Playwright 1.59 | 有头 Chromium + 已解压 `dist/` | 用户交互流程（扫描 → 过滤 → 下载、Pro 门控等）                                 | `npm run e2e` |

**当前覆盖**：~46 个单测文件 / 1258 个用例 + 38 个 e2e spec，全部通过。

#### 单元测试（Vitest）

- 文件命名：`tests/<module>.test.ts` 用于 node 环境的 spec，
  `tests/<module>.test.tsx` 用于渲染 Preact 或操作 DOM 的 spec（jsdom 环境）。
- **测什么**：纯函数、响应式 store 突变、可通过无障碍树验证的渲染副作用、
  模块级 IIFE 启动编排。
- **Stub 什么**：
  - `chrome.*` API —— 每个需要 Chrome mock 的测试通过本地
    `installChromeMock()` 辅助函数重装。
  - `indexedDB` —— 使用 `fake-indexeddb`（已是 devDependency）。
  - 重型兄弟模块 —— 使用 `vi.mock('../sidepanel/xxx', () => ({ ... }))`
    隔离被测单元。
- 在提交 PR 前运行 `npm test`。迭代时用 `npm run test:watch`。
- 覆盖率报告：`npm run test:coverage` → `coverage/index.html`。

#### 端到端测试（Playwright）

- Spec 位于 `e2e/*.e2e.ts`；辅助函数位于 `e2e/_helpers/`。
- 扩展通过 `launchPersistentContext` 加载 `dist/`（**你必须先
  `npm run build`** —— e2e 不会自动重建）。
- 有头 Chromium + `workers: 1`（MV3 Service Worker 在无头模式下无法
  可靠启动）。CI 使用 `xvfb-run`。
- 烟雾测试层：`npx playwright test e2e/smoke.e2e.ts`（约 5 秒，3 个用例）
  —— 每次提交前跑一下；完整测试套件在发布前跑。
- 当你修改了 UI，请添加或扩展匹配的 e2e spec。

### CSS

- 使用 `css/variables.css` 中的 CSS 变量 —— **永不硬编码颜色值**
- 所有 UI 组件必须同时支持浅色和深色模式
- 布局必须适配侧边栏最小宽度（280px）到最大宽度（600px+）

### HTML / 标记

- 语义化 HTML（操作用 `<button>`，导航用 `<a>`）
- 所有交互元素必须有 `aria-label` 或无障碍文本
- 保持 `popup.html` 和 `sidepanel.html` 同步（共享样式和大部分标记）

### 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 仅文档变更
- `refactor:` 既不修 bug 也不加功能的代码变更
- `perf:` 性能优化
- `chore:` 构建/工具链变更

示例：

```text
feat(extractor): 添加对 <object type="image/svg+xml"> 的支持

一些遗留站点通过 <object> 标签嵌入 SVG。当 type 属性以 "image/" 开头时
将其视为 <img> 处理。
```

## Pull Request 流程

1. **Fork** 本仓库
2. **创建主题分支**：`git checkout -b feat/your-feature-name`
3. **进行修改**，遵循上述编码规范
4. **手动测试** —— 在干净的 Chrome profile 上用多个图片丰富的站点测试
   （如 Pinterest、Unsplash、带 CSS 背景的产品页）
5. **提交**，使用 conventional commit 消息
6. **推送**到你的 fork 并向 `master` 分支提交 PR
7. 在 PR 描述中包含：
   - 改了什么以及为什么
   - UI 变更请附截图或短 GIF
   - 你是如何测试的
8. 回复 review 意见；维护者批准后会合并

### 偏好小 PR

如果你计划一个大型重构或涉及多个文件的功能，请**先开 issue** 讨论方案。
这能为双方都节省时间。

## 我们不接受的内容

为保持项目的聚焦和价值观一致，以下内容将被拒绝：

- ❌ **添加分析、遥测或追踪** —— 隐私优先是核心承诺
- ❌ **远程代码加载** —— MV3 已禁止这样做，我们没有理由绕过
- ❌ **为任何免费功能添加必需的后端调用** —— 免费功能必须 100% 本地化
- ❌ **打包第三方 SDK** 却没有明确文档化的理由
- ❌ **向 `manifest.json` 添加新权限** 却没有充分的理由
- ❌ **删除中文 README** 或破坏双语对等
- ❌ **纯风格的代码格式化重排**，除非事先在 issue 中达成一致
- ❌ **AI 生成的 PR 且未经人工审查** —— 请实际阅读 AI 写的内容

## 联动发版（Coordinated Releases）

绝大多数贡献都是纯前端改动，可以独立合并 / 发版，放心提 PR。

少量功能依赖托管的后端服务（License 激活、Pro 试用、匿名遥测、反向图搜代理）。
这些功能调用的接口在 `shared/license.ts`、`shared/constants.ts` 中可以看到对应
的生产 URL。如果你的 PR 触及以下任一情形，请**先开 issue** 协调发布节奏：

- 任意 `/api/license/*`、`/api/trial/*`、`/api/telemetry` 接口的**请求 /
  响应字段结构**变化
- 新增或移除 Pro 功能开关
- 任何可能导致**旧版本扩展**对接线上后端时直接报错的改动（我们无法强制
  所有用户立刻升级）

原因：服务端是独立部署的，需要**先发后端，验证通过后**扩展才能依赖新的契约。
维护者会负责把两次发布串行排好（后端先发 → 验证 → 再发布新版扩展）。

Bug 修复、UI 调整、重构、测试、文档、翻译、以及任何**纯本地的功能**都
**不需要**这种协调，直接提 PR 即可。

## License

通过贡献，你同意你的贡献将在覆盖本项目的 [MIT License](./LICENSE) 下
进行授权。

---

有疑问？欢迎提 issue 或发邮件到 `support@kyriewen.cn`。

感谢你帮助 Image Harvest 变得更好！🌾
