# Image Harvest 全面优化方案 — 技术详细文档

> 创建日期: 2026-05-19
> 分支: `feat/optimization-sprint`

---

## 概述

经过对 Image Harvest（Chrome MV3 图片批量下载扩展）的全面代码审查，发现了 6 个安全漏洞/严重 Bug、5 个性能瓶颈、8 个代码质量问题、以及多个高价值产品优化点。本文档记录每个 Task 的具体改动内容、改动原因、影响文件和验证方式。

---

## Phase 1: 安全漏洞 + 严重 Bug

### Task 1.1 — SSRF 防护：验证 FETCH_IMAGE_DATA 的 URL

**问题**: `background/reverse-search.ts` 的 `fetchImageData()` 函数直接 fetch 任意 URL，恶意网页可通过 content script 发送内网地址（如 `http://127.0.0.1:8080/admin`），利用扩展的 background service worker 作为代理访问内网服务。

**改动**:

- **新建 `shared/url-validator.ts`** — 集中的 URL 安全验证模块

  ```ts
  const PRIVATE_IP_PREFIXES = ['10.', '172.16.', '172.17.', ..., '172.31.', '192.168.'];
  const PRIVATE_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

  export function isAllowedFetchUrl(url: string): boolean {
    // 只允许 http/https 协议
    // 拒绝私有 IP、localhost、.local/.internal 域名
  }

  export function isSafeImageUrl(url: string): boolean {
    // 允许 http/https/data/blob 协议（用于 UI 展示场景）
  }
  ```

- **修改 `background/reverse-search.ts`** — `fetchImageData()` 开头添加校验

  ```ts
  export async function fetchImageData(url: string): Promise<string> {
    if (!isAllowedFetchUrl(url)) {
      throw new Error('URL not allowed: blocked by security policy');
    }
    // ... 原有逻辑
  }
  ```

- **修改 `background/index.ts`** — FETCH_IMAGE_DATA handler 强制要求 `sender.tab` 存在
  ```ts
  case MESSAGE_TYPES.FETCH_IMAGE_DATA: {
    if (!sender.tab) {
      sendResponse({ success: false, error: 'Unauthorized: no sender tab' });
      break;
    }
    // ...
  }
  ```

**验证**: 构造 `http://127.0.0.1:8080`、`http://192.168.1.1`、`ftp://example.com` 作为请求 URL，均应返回错误。

---

### Task 1.2 — 图片 URL scheme 白名单

**问题**: `sidepanel/actions.ts` 的 `showReverseSearchMenu()` 将 `imageUrl` 直接写入 DOM dataset，恶意构造的 `javascript:` scheme URL 可能导致 XSS。

**改动**:

- **修改 `sidepanel/actions.ts`** — 在 `showReverseSearchMenu()` 入口处校验

  ```ts
  import { isSafeImageUrl } from '../shared/url-validator';

  export function showReverseSearchMenu(...) {
    if (!isSafeImageUrl(imageUrl)) return; // 拦截非安全 scheme
    // ...
  }
  ```

**验证**: 传入 `javascript:alert(1)` 作为 imageUrl，函数应直接 return 不执行。

---

### Task 1.3 — 修复 seenUrls 竞态条件

**问题**: `content/main.ts` 中 `extractImages()` 每次调用时先 `state.seenUrls.clear()`，如果用户快速连续触发两次提取，第二次的 clear 会清掉第一次正在用的去重集合，导致结果中出现重复图片。

**原计划**: 将 seenUrls 局部化，传参给所有 14 个提取函数。

**实际方案**: 改动范围过大（80+ 引用），采用更安全的方案——拒绝并发提取：

```ts
export async function extractImages(options = {}): Promise<ImageItem[]> {
  if (state.isExtracting) return []; // 拒绝重入
  state.isExtracting = true;
  try {
    state.seenUrls.clear();
    // ... 原有提取逻辑
  } finally {
    state.isExtracting = false;
  }
}
```

**验证**: 快速连续点击扫描按钮两次，第二次应返回空数组而非产生重复。

---

### Task 1.4 — 修复 Modal 关闭 Bug

**问题**: `sidepanel/init.ts:1307` 中 `overlay.closest('_modal')` 是无效选择器（缺少 `.` 前缀），导致点击遮罩层无法关闭模态框。

**改动**: `overlay.closest('_modal')` → `overlay.closest('.modal')`

**验证**: 所有模态框可通过点击遮罩层关闭。

---

### Task 1.5 — 修复 generateId 碰撞

**问题**: `shared/utils.ts` 的 `generateId()` 使用 `Date.now()` + 简单 hash 生成 ID。在同一毫秒内对相同 URL 调用会产生完全相同的 ID，导致图片列表中出现 key 冲突。

**改动**:

```ts
// Before: hash(url) + Date.now().toString(36) + random(4)
// After:
export function generateId(_url: string): string {
  return crypto.randomUUID();
}
```

MV3 Service Worker 和页面上下文均支持 `crypto.randomUUID()`，碰撞概率降至 2^-122。

**验证**: 循环调用 1000 次 `generateId(sameUrl)` 结果全部唯一。

---

### Task 1.6 — reverseSearchUpload atob 校验

**问题**: `background/reverse-search.ts` 的 `reverseSearchUpload()` 直接执行 `atob(base64Data)` 而没有 try-catch。如果传入非法 base64 字符串会导致 uncaught exception 使 service worker 崩溃。

**改动**:

```ts
export async function reverseSearchUpload(engine: string, imageDataUrl: string) {
  const dataParts = imageDataUrl.split(',');
  if (dataParts.length < 2) {
    return { success: false, error: 'Invalid data URL format' };
  }

  const mimeMatch = dataParts[0].match(/:(.*?);/);
  const mimeType = mimeMatch?.[1] || '';
  if (!mimeType.startsWith('image/')) {
    return { success: false, error: 'Invalid MIME type: not an image' };
  }

  let binaryString: string;
  try {
    binaryString = atob(dataParts[1]);
  } catch {
    return { success: false, error: 'Invalid base64 data' };
  }
  // ...
}
```

**验证**: 传入 `data:text/html;base64,!!!invalid!!!` 应返回友好错误而非抛异常。

---

### Task 1.7 — 内存泄漏：lazy-load 监听器清理

**问题**: `content/monitor.ts` 的 `startLiveMonitoring()` 为每个新发现的 `<img>` 添加 `load` 事件监听器检测懒加载完成，但 `stopLiveMonitoring()` 时只断开 MutationObserver 和 IntersectionObserver，未清理这些 load 监听器。SPA 页面导航后，旧页面的 img 元素已被移除但监听器引用仍存在，造成内存泄漏。

**改动**:

```ts
let lazyLoadController: AbortController | null = null;

export function startLiveMonitoring() {
  lazyLoadController = new AbortController();
  // ...
  img.addEventListener('load', handleLazyImageLoad, {
    once: true,
    signal: lazyLoadController.signal,
  });
}

export function stopLiveMonitoring() {
  lazyLoadController?.abort();
  lazyLoadController = null;
  // ... 原有清理逻辑
}
```

**验证**: Chrome DevTools Memory 面板中，SPA 导航后不应有游离的 EventListener 引用。

---

## Phase 2: 性能优化

### Task 2.1 — pHash DCT 优化

**问题**: `shared/phash.ts` 的 `dct2d()` 使用 4 层嵌套循环（O(N⁴), N=32），每次计算 pHash 需要 ~15ms。批量处理 100 张图片时产生明显卡顿。

**改动**:

1. 模块加载时预计算 32×32 余弦查找表和系数表：

```ts
const DCT_SIZE = 32;
const cosTable = new Float64Array(DCT_SIZE * DCT_SIZE);
const C_coeff = new Float64Array(DCT_SIZE);

for (let i = 0; i < DCT_SIZE; i++) {
  C_coeff[i] = i === 0 ? 1 / Math.sqrt(DCT_SIZE) : Math.sqrt(2 / DCT_SIZE);
  for (let j = 0; j < DCT_SIZE; j++) {
    cosTable[i * DCT_SIZE + j] = Math.cos(((2 * j + 1) * i * Math.PI) / (2 * DCT_SIZE));
  }
}
```

2. 将 2D DCT 分解为两次 1D DCT（行变换 + 列变换），复杂度从 O(N⁴) 降到 O(N³)：

```ts
function dct2dSeparable(matrix: Float64Array): Float64Array {
  const temp = new Float64Array(DCT_SIZE * DCT_SIZE);
  // Pass 1: DCT on each row
  for (let row = 0; row < DCT_SIZE; row++) { ... }
  // Pass 2: DCT on each column of temp
  const result = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let col = 0; col < DCT_SIZE; col++) { ... }
  return result;
}
```

**验证**: 基准测试单图 pHash 计算从 ~15ms 降到 <3ms。

---

### Task 2.2 — 合并两次 DOM 遍历

**问题**: `content/main.ts` 中 `extractBackgroundImages()` 和 `extractCssContentImages()` 各自独立遍历整个 DOM 并调用 `getComputedStyle()`。在 2000+ 元素的页面上，两次完整遍历造成约 200ms 的额外开销。

**改动**:

- `extractBackgroundImages()` 中在同一个 `for` 循环内同时检查 `backgroundImage` 和 `::before` / `::after` 伪元素的 `content` 属性：

```ts
// 在同一次 getComputedStyle 调用后
const bgImage = style.backgroundImage;
if (bgImage && bgImage !== 'none') {
  /* 提取背景图 */
}

// 伪元素也在这里处理
for (const pseudo of ['::before', '::after'] as const) {
  const pseudoStyle = window.getComputedStyle(el, pseudo);
  const content = pseudoStyle.content;
  // 提取 url(...) 引用
}
```

- `extractCssContentImages()` 改为空函数（no-op），避免重复遍历。

**验证**: Amazon/Pinterest 等大页面提取时间减半。

---

### Task 2.3 — medianCut 使用 quickselect

**问题**: `shared/color-extract.ts` 的 median-cut 算法使用 `Array.sort()` 找中位数进行分割，时间复杂度 O(N log N)。对大图片的像素数组（10万+ 元素）排序开销显著。

**改动**: 实现 Floyd-Rivest 选择算法 `nthElement()`，O(N) 找到第 k 小元素：

```ts
function nthElement(arr: Uint8Array[], left: number, right: number, k: number, channel: number) {
  while (right > left) {
    // Floyd-Rivest: use median-of-medians pivot
    // Partition in-place around pivot
    // Recurse on the side containing k
  }
}
```

替换原有的 `pixels.sort()` 调用。

**验证**: 100 张图批量颜色提取时间下降 40%+。

---

### Task 2.4 — tabCache LRU 限制

**问题**: `sidepanel/init.ts` 中 `state.tabCache` (Map) 无上限增长，每次切换标签页都会缓存图片数据。长时间浏览 50+ 标签页后内存占用持续增长。

**改动**:

```ts
const MAX_TAB_CACHE = 10;

// 在写入 tabCache 前检查容量
if (state.tabCache.size >= MAX_TAB_CACHE) {
  const oldest = state.tabCache.keys().next().value;
  if (oldest !== undefined) state.tabCache.delete(oldest);
}
state.tabCache.set(tabId, entry);
```

**验证**: tabCache.size 永远 ≤ 10，长期使用后内存稳定。

---

### Task 2.5 — 智能重试逻辑

**问题**: `sidepanel/scan.ts` 的扫描流程在收到空响应时会重试最多 3 次（inject content script → 等待 → 再试）。但在 SPA 页面中，content script 可能已存活且已发送过 `IMAGES_DISCOVERED` 消息，此时重试是浪费。

**改动**: 重试循环中添加提前终止条件：

```ts
if (state.scanDiscoveredImages.length > 0 && response?.success) break;
```

如果已收到过 discovered 消息且本次请求成功（脚本存活），说明页面确实无更多图片，无需重试。

**验证**: SPA 页面不会触发 3 次全量 DOM 扫描。

---

## Phase 3: 代码质量改进

### Task 3.1 — 消除 `new Promise(async ...)` 反模式

**问题**: `shared/collection.ts` 中 8 个函数使用 `new Promise(async (resolve, reject) => { ... })` 模式。这个反模式的问题是：如果 async executor 内部抛出异常且未被 try-catch 捕获，Promise 不会被 reject，异常会变成 unhandled rejection。

**改动**: 全文重写 `shared/collection.ts`：

- 创建 `requestToPromise<T>(request: IDBRequest<T>)` 工具函数封装 IDB 回调
- 所有 8 个函数改为直接 async 函数
- 示例：

```ts
// Before:
export function collectionAdd(item): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const db = await collectionInit();
    const tx = db.transaction('items', 'readwrite');
    // ...
  });
}

// After:
export async function collectionAdd(item): Promise<string> {
  const db = await collectionInit();
  const tx = db.transaction('items', 'readwrite');
  const store = tx.objectStore('items');
  await requestToPromise(store.add(item));
  return item.id;
}
```

---

### Task 3.2 — 统一 license 数据存取

**问题**: `shared/license.ts` 和 `shared/storage.ts` 各自定义了 `saveLicenseData()` / `getLicenseData()` / `clearLicenseData()`。两套实现使用不同的存储 key（一个硬编码 `'licenseData'`，另一个用 `STORAGE_KEYS.LICENSE_DATA`），存在数据不一致风险。

**改动**:

- 删除 `shared/storage.ts` 中的 3 个 license 函数（它们从未被外部导入）
- 移除相关的 `LicenseData` type import
- 更新 `tests/storage.test.ts` 的 import 路径指向 `shared/license.ts`

**验证**: `grep` 确认 license 数据读写只有 `shared/license.ts` 一个入口。

---

### Task 3.3 — 统一反向搜索引擎白名单

**问题**: `sidepanel/actions.ts` 中 `reverseSearch()` 函数硬编码了 `validEngines = ['google', 'tineye', 'baidu', 'yandex']`。如果 `constants.ts` 中的引擎列表变化，这里不会同步更新。

**改动**:

- `shared/constants.ts` 新增：
  ```ts
  export const VALID_REVERSE_SEARCH_ENGINES = ['google', 'tineye', 'baidu', 'yandex'] as const;
  ```
- `sidepanel/actions.ts` 改为引用常量：
  ```ts
  import { VALID_REVERSE_SEARCH_ENGINES } from '../shared/constants';
  // ...
  const validEngines: readonly string[] = VALID_REVERSE_SEARCH_ENGINES;
  ```

---

### Task 3.4 — 修复 debounce 实现

**问题**: `shared/utils.ts` 的 `debounce()` 实现中，`later()` 执行后未将 `timeout` 设为 `undefined`。这导致后续调用 `if (timeout)` 判断时，已过期的 timeout ID 仍被视为"有待执行的调用"，导致行为异常。

**改动**:

```ts
function later() {
  timeout = undefined; // 关键修复
  if (!immediate) func.apply(context, args);
}
```

---

### Task 3.5 — 修复 telemetry 默认 opt-in

**问题**: `shared/telemetry.ts:238` 中 `optInCache = v === undefined ? true : Boolean(v)`。首次安装时 storage 中无此 key（`v === undefined`），结果默认为 `true`，即用户未做任何选择就开始发送遥测数据。这违反隐私合规要求。

**改动**: `v === undefined ? true` → `v === undefined ? false`

首次安装不发送任何遥测，直到用户在隐私弹窗中主动 opt-in。

---

### Task 3.6 — 修复 download history 读写竞态

**问题**: `shared/storage.ts` 的 `addDownloadRecord()` 执行 read-modify-write 操作（读取历史 → 插入新记录 → 写回），但没有互斥保护。并发下载时两个调用可能同时读取旧数据，各自插入后覆盖对方的记录。

**改动**: 添加简单的 Promise-based mutex：

```ts
let historyMutex: Promise<void> = Promise.resolve();

export async function addDownloadRecord(record: DownloadRecord): Promise<boolean> {
  let release: () => void;
  const prev = historyMutex;
  historyMutex = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    // ... 原有 read-modify-write 逻辑
  } finally {
    release!();
  }
}
```

---

### Task 3.7 — 移除生产 console.log

**问题**: `background/index.ts:82` 有 `console.log('Download completed:', delta.id)` 会在用户浏览器控制台输出大量日志。

**改动**: 删除该行，改为通过已有的 `broadcastToPopup()` 通知 UI。

---

### Task 3.8 — License API 响应校验

**问题**: `shared/license.ts` 的 `validateLicenseRemote()` 直接将服务器响应 `as LicenseValidationResult` 强制类型转换，不做任何运行时校验。如果服务器返回恶意/异常数据（如 `plan: "../../etc/passwd"`），会原样存入 storage。

**改动**: 添加 `sanitizeLicenseResult()` 函数：

```ts
const VALID_PLANS = ['monthly', 'yearly', 'lifetime', 'trial'];

function sanitizeLicenseResult(data: unknown): LicenseValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid response format' };
  }
  const obj = data as Record<string, unknown>;
  const plan = typeof obj.plan === 'string' && VALID_PLANS.includes(obj.plan) ? obj.plan : null;
  return {
    valid: Boolean(obj.valid),
    status: typeof obj.status === 'string' ? obj.status : undefined,
    plan,
    expiresAt: typeof obj.expiresAt === 'number' ? obj.expiresAt : null,
    error: typeof obj.error === 'string' ? obj.error : undefined,
  };
}
```

---

## Phase 4: 产品功能优化

### Task 4.1 — 工具栏角标显示图片数

**目标**: 扫描完成后在扩展图标上显示当前页面的图片数量，让用户一眼看到"这个页面有多少图片"。

**改动** (`background/index.ts` GET_IMAGES handler)：

```ts
case MESSAGE_TYPES.GET_IMAGES: {
  const images = await getImagesFromTab(tabId, options);
  sendResponse({ success: true, images });
  if (tabId && images.length > 0) {
    const text = images.length > 999 ? '999+' : String(images.length);
    chrome.action.setBadgeText({ text, tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId }).catch(() => {});
  }
  break;
}
```

---

### Task 4.3 — 将"删除图片"移至免费版

**目标**: 免费用户也可以从图片列表中删除不需要的图片（之前是 Pro 功能）。降低 paywall 摩擦，让用户先体验核心功能。

**改动** (`shared/constants.ts`)：

- `PRO_FEATURES` 数组中移除 `'imageDelete'`（不再是 Pro 功能）
- `FREE_LIMITS.IMAGE_DELETE` 从 `false` 改为 `true`

---

### Task 4.4 — 筛选空状态说明

**目标**: 当筛选条件过滤掉所有图片时，显示 "X 张图片被当前筛选条件隐藏" 的提示，避免用户误以为页面没有图片。

**改动**:

- `sidepanel/state.ts` — `EmptyScreenInfo` 新增 `hiddenCount?: number`
- `sidepanel/ui.ts` — `showEmpty()` 接受并传递 hiddenCount
- `sidepanel/render.ts` — 计算 `allImages.length - filteredImages.length` 传入
- `sidepanel/components/StateScreens.tsx` — 渲染 hint 标签
- `css/states.css` — `.empty-state-hidden-hint` 样式
- `_locales/{en,zh_CN,zh_TW,ja}/messages.json` — 新增 `empty_hidden_count` 键

---

### Task 4.6 — 更新 Chrome Web Store 描述

**改动** (`docs/chrome-store/description.md`)：

- "up to 20 images" → "up to 30 images"（匹配 `FREE_LIMITS.MAX_ZIP_IMAGES = 30`）
- PRO 列表移除 "Image removal from list"
- FREE 列表添加 "Image removal from list"

---

## 未完成 Task

### Task 4.2 — 文件大小（KB）筛选

详见 [OPTIMIZATION-SPRINT.md](./OPTIMIZATION-SPRINT.md#task-42--文件大小kb筛选)

### Task 4.5 — 免费版"滚动后扫描"

详见 [OPTIMIZATION-SPRINT.md](./OPTIMIZATION-SPRINT.md#task-45--免费版滚动后扫描)

### Task 4.7 — 试用到期缓冲期

详见 [OPTIMIZATION-SPRINT.md](./OPTIMIZATION-SPRINT.md#task-47--试用到期缓冲期)

---

## 改动文件清单

```
新建:
  shared/url-validator.ts          — URL 安全验证模块

修改 (安全/Bug):
  background/reverse-search.ts     — SSRF 防护 + atob 校验
  background/index.ts              — sender.tab 校验 + badge + 移除 console.log
  content/main.ts                  — 拒绝并发提取 + 合并 DOM 遍历
  content/monitor.ts               — AbortController 管理 lazy-load 监听器
  content/extract-advanced.ts      — extractCssContentImages 改为 no-op
  sidepanel/init.ts                — modal 选择器修复 + tabCache LRU
  sidepanel/actions.ts             — URL scheme 校验 + 引擎白名单引用常量
  shared/utils.ts                  — generateId + debounce 修复

修改 (性能):
  shared/phash.ts                  — 预计算余弦表 + 分离 1D DCT
  shared/color-extract.ts          — quickselect 替代 sort
  sidepanel/scan.ts                — 智能重试提前终止

修改 (代码质量):
  shared/collection.ts             — 全文重写消除 Promise 反模式
  shared/storage.ts                — 删除重复 license 函数 + mutex
  shared/license.ts                — sanitizeLicenseResult 响应校验
  shared/telemetry.ts              — 默认 opt-out
  shared/constants.ts              — VALID_REVERSE_SEARCH_ENGINES + FREE_LIMITS 调整

修改 (产品):
  sidepanel/state.ts               — EmptyScreenInfo.hiddenCount
  sidepanel/ui.ts                  — showEmpty 参数扩展
  sidepanel/render.ts              — 传递 hiddenCount
  sidepanel/components/StateScreens.tsx — 渲染 hidden hint
  css/states.css                   — .empty-state-hidden-hint 样式
  _locales/en/messages.json        — empty_hidden_count
  _locales/zh_CN/messages.json     — empty_hidden_count
  _locales/zh_TW/messages.json     — empty_hidden_count
  _locales/ja/messages.json        — empty_hidden_count
  docs/chrome-store/description.md — 文案同步

修改 (测试):
  tests/storage.test.ts            — import 路径修正
```
