# 隐私政策

<p align="right">
  <strong><a href="./PRIVACY.md">English</a> | 简体中文</strong>
</p>

> **最后更新**：2025-11-12 · **版本**：1.0
>
> Image Harvest 建立在一个原则之上：**你的浏览数据归你所有，不归我们**。
> 本政策用通俗的语言和可验证的源码引用，说明扩展究竟接触哪些数据、
> 不接触哪些数据。

---

## 摘要（TL;DR）

- ✅ 图片识别、感知哈希、颜色提取、格式转换 **全部在你的浏览器中完成**。
- ✅ 遥测是 **匿名 + opt-in**（默认开启，可一键关闭）—— 首次打开会
  弹窗让你选择，之后随时可在设置中调整。
- ✅ 浏览历史、页面 URL、页面标题、图片 URL、图片内容、搜索关键词、
  你输入的文本，**永远不会**发送到我们的服务器。
- ✅ 扩展只与 **一个** 后端通信（`image-harvest.kyriewen.cn`）—— 仅用于
  license 校验和（可选的）匿名遥测批次。
- ❌ 我们 **不会** 出售、租借、共享或交易任何数据。
- ❌ 我们 **不使用** Google Analytics、Sentry、Hotjar、Facebook Pixel
  或任何其他第三方 SDK。

如果你想要技术证据，下文每条声明都对应到本仓库可阅读的源文件。

---

## 1. 关于我们

Image Harvest 是一个单人开源项目。下文有限遥测的数据控制者是：

- **维护者**：kyriewen（GitHub: `zbw-zbw`）
- **联系方式**：`coderkyriewen@gmail.com`
- **仓库**：<https://github.com/zbw-zbw/image-harvest>
- **官网**：<https://image-harvest.kyriewen.cn>

---

## 2. 永远留在你设备上的数据

以下数据 **永远不会离开你的电脑**：

| 类别 | 存储位置 | 源码参考 |
| --- | --- | --- |
| 页面上识别到的图片列表 | `state.discoveredImages`（内存）+ `chrome.storage.session.tabImgCache_<tabId>`（浏览器重启即清） | `sidepanel/state.ts`、`shared/storage.ts > saveTabImageCache` |
| 图片字节（用于缩略图、pHash、颜色） | 仅内存；面板关闭即释放 | `sidepanel/scan.ts > processImageExtras` |
| 下载历史（最近 20 条：文件名 + 时间戳 + 源 URL） | `chrome.storage.local.downloadHistory` | `shared/storage.ts > addDownloadRecord` |
| 过滤偏好（尺寸、类型、域名） | `chrome.storage.sync.filterConfig`（仅在你自己的 Chrome 安装间同步，由 Chrome 完成 —— 不经过我们） | `shared/storage.ts > saveFilterConfig` |
| 应用设置（主题、密度、显示模式、语言…） | `chrome.storage.local.appSettings` | `shared/storage.ts > saveAppSettings` |
| 收藏夹（已保存的图片） | IndexedDB `ImageSnatcherDB > collections` | `shared/collection.ts` |
| 浏览上下文（当前标签 URL、标题） | 仅内存；用于生成文件名；扫描结束即丢弃 | `sidepanel/scan.ts`、`sidepanel/utils.ts > generateFilename` |
| 反向搜索的图片 URL | 通过 query string 传给跳转页；扩展 **不** 记录或存储 | `pages/reverse-search.ts` |

卸载扩展时，Chrome 会自动删除上述全部内容。（你也可以在面板中
**设置 → 清除所有数据** 主动清理。）

---

## 3. 会离开你设备的数据 —— 仅限有原因

扩展只与 **两** 类远端端点通信，且范围都极其受限。

### 3.1 License 校验 —— `image-harvest.kyriewen.cn`

**触发时机：** 你点击 *激活* 输入 license key 时；你点击 *注销* 时；
以及每 24 小时一次的 `chrome.alarms` 后台检查（仅当你已存有 license）。

**发送：**

- License key（服务器需要校验）。
- 一个随机的每安装 `instanceId`（用于强制每台机器只能激活一个 key；
  与你本人 *无任何* 关联）。
- 扩展 fetch 的 HTTP `User-Agent`（Chrome 默认，未做定制）。

**接收：**

- `{ valid: boolean, plan, expiresAt, ... }` —— 仅此而已。

**源码：** `shared/license.ts > activateLicense / validateLicenseRemote / deactivateLicense`。

如果你 **从未** 激活过 Pro license，license 服务器 **永远不会** 被
联系。

### 3.2 匿名遥测 —— `image-harvest.kyriewen.cn/api/telemetry`

**触发时机：** 当且仅当你 opt-in。隐私 opt-in 弹窗会在首次打开时
出现，提供清晰的 **"拒绝"** 按钮。之后随时可在 **设置 → 隐私 →
匿名使用统计** 中切换。

**发送（每批）：**

```jsonc
{
  "instanceIdHash": "a1b2c3d4e5f60718",  // 随机本地字符串的 SHA-256，截断为 16 位十六进制
  "version": "1.0.1",                    // 扩展版本
  "lang": "zh-CN",                       // UI 语言
  "plan": "free",                        // "free" | "monthly" | "yearly" | "lifetime" | "trial"
  "schemaVersion": 1,
  "events": [
    { "event": "scan_completed", "ts": 1731401234567, "props": { "count": 42 } },
    { "event": "download_batch", "ts": 1731401241000, "props": { "count": 12, "asZip": true } }
    // ... 每批最多 20 个事件
  ]
}
```

**里面 *没有* 的内容：**

- ❌ 无你访问过的 URL、页面标题或域名。
- ❌ 无图片 URL、文件名或图片字节。
- ❌ 无搜索关键词、license key 或你输入的任何文本。
- ❌ 我们这边无 IP 地址（你的网络在每个 HTTPS 请求中都会发送 IP；我们
  在做完粗粒度国家归类后即丢弃，且国家信息也在落库前丢弃）。
- ❌ 无 cookie、无 `localStorage` 标识符、无第三方追踪像素。

**为什么需要收集：**

- 决定接下来开发哪个 Pro 功能（`PRO_UPSELL_SHOWN` /
  `PRO_UPSELL_CLICKED` 漏斗）。
- 检测崩溃（带有非 PII 错误码的 `SCAN_FAILED` 事件）。
- A/B 测试升级流程的不同变体（`abBucket` 字段）。
- 了解 5 种支持语言中实际被使用的是哪些。

**完整事件白名单** 在 `shared/telemetry-events.ts > EVENTS`。任何不在
该文件中的事件都会在 SDK 边界被丢弃 —— 即使是意外的也一样 —— 见
`shared/telemetry.ts > track`。

**资源限制** 确保它永远不会塞满你的磁盘：

- 队列上限 100 个事件。
- 每 5 秒 flush 一次，或 20 个事件累积时立即 flush。
- 持久化的重试队列在你 opt-out 时被清空。

### 3.3 反向图片搜索 —— 第三方引擎

**触发时机：** 你点击卡片上的"反向搜索"并选择一个引擎（Google Lens、
TinEye、Baidu、Yandex）时。

**我们做的：** 打开新标签页跳到该引擎的搜索 URL，把图片 URL 作为
query 参数传过去（如 `https://lens.google.com/uploadbyurl?url=…`）。
仅对 Baidu 兜底情况，扩展的后台会一次性 fetch 图片字节并 POST 到
Baidu 的上传端点 —— 与你在 Chrome 中右键图片选"以图搜图"是同样的方式。

**引擎看到的：** 引擎在常规搜索时看到的内容 —— 通常就是图片 URL 或
其字节。引擎有 **它们自己** 的隐私政策；我们在引擎选择器里给出了链接。

**我们 *自己的* 服务器收到的：** 什么都没有。反向搜索完全绕过我们的
后端。

### 3.4 你选择下载的图片字节

当你保存图片时，Chrome 的 `downloads.download()` 会拉取该 URL。某些
页面提供的图片要求 HTTPS（或阻断 CORS），所以扩展的后台 SW 会通过
自己的 `<all_urls>` 权限拉取字节，并以 Blob 交还给面板。**这些字节
永不离开你的机器** —— 它们从源站，经你的 Chrome，进到你的 `下载`
文件夹。我们什么都看不到。

---

## 4. 即使开启遥测也永不收集的内容

我们以书面 + 源码方式承诺，**永不**收集以下任一项：

- ❌ 浏览历史。
- ❌ 你扫描的页面 URL。
- ❌ 你扫描的页面标题。
- ❌ 图片 URL（连哈希都不做）。
- ❌ 图片字节或缩略图。
- ❌ 你输入的搜索关键词。
- ❌ 已下载文件的文件名。
- ❌ 邮箱、姓名、社交账号。
- ❌ 比"请求 IP 派生的粗粒度国家"更精确的地理位置；该国家信息在
  事件抵达数据库 *之前* 即被丢弃。
- ❌ 鼠标移动、滚动深度、停留时间、热力图。
- ❌ 我们设置的 cookie（我们一个都没设）。
- ❌ 跨站标识符、广告 ID、指纹。

如果你看到扩展发出与第 3 节不符的网络请求，那就是 bug —— 请通过
[`SECURITY.md`](../SECURITY.md) 提报。

---

## 5. 你的控制权

扩展接触的每一份数据，你都说了算。

| 你想要… | 在哪里操作 |
| --- | --- |
| 首次打开时拒绝遥测 | 在隐私弹窗中点 **拒绝** |
| 之后切换遥测开关 | **设置 → 隐私 → 匿名使用统计** |
| 删除单条下载历史 | **设置 → 下载历史 → 行右侧的回收站图标** |
| 清空所有下载历史 | **设置 → 下载历史 → 全部清除** |
| 清空所有收藏（Pro） | **收藏弹窗 → 全部清除** |
| 注销 license | **设置 → License → 注销**（释放槽位给另一台机器） |
| 清空扩展存储的 **一切** 内容 | 在 `chrome://extensions` 卸载（Chrome 会清除该扩展所有 `chrome.storage.*` 和 IndexedDB） |
| 查看到底存了什么 | DevTools → 应用 → 存储 → 扩展存储 |

---

## 6. 儿童隐私

Image Harvest 是面向开发者/设计师的通用工具。我们不刻意向 13 岁
（或当地法律规定的 16 岁）以下儿童营销。我们不收集任何能识别用户
（无论儿童或成人）的数据。

---

## 7. 数据保留

| 数据 | 保留期 |
| --- | --- |
| License 记录（服务器端） | license 有效期内 + 注销后 90 天，用于续费/退款支持 |
| 遥测事件（服务器端） | 30 天内聚合；原始事件 90 天内删除 |
| 你设备上的任何数据 | 直到你删除或卸载扩展 |

如果希望提前清除服务器端的 license 记录，请发邮件并附上 license 拥有
证明。

---

## 8. 跨境传输

我们的后端（`image-harvest.kyriewen.cn`）托管在阿里云中国大陆服务器。
如果你激活 Pro 或 opt-in 遥测，第 3 节描述的数据将经由中国大陆传输
和处理。在大多数司法管辖区，license key 和 `instanceId` 哈希不被视为
个人数据（它们标识的是一个安装，而非一个人），且遥测完全不含 PII。

---

## 9. 你的权利（GDPR / CCPA / 等）

即便我们几乎不收集个人数据，你仍享有适用法律赋予的权利。请向
`coderkyriewen@gmail.com` 发邮件，附上你的 `instanceIdHash`（在
**设置 → 隐私 → 诊断信息** 可见），即可申请：

- **访问** —— 与你的 hash 关联的遥测事件副本。
- **删除** —— 抹除我们服务器上与你的 hash 关联的任何数据。
- **更正** —— license 记录的更正。
- **反对** —— 停止处理（等同于退出遥测，你也可以一键自助完成）。

我们会在 **30 天** 内回复。

> 注：因为遥测批次 *不* 与真实身份关联，我们无法确认某个 hash 一定是
> 你的。hash 本身是我们唯一接受的证明。

---

## 10. 政策变更

变更本政策时，我们会：

1. 提升本文件顶部的 **最后更新** 日期和版本号。
2. 在 `CHANGELOG.md` 中按新版本添加条目，描述本次变更。
3. 对于 **重大** 变更（即扩展我们收集什么或如何使用的任何变更），
   会在下次面板打开时弹出提醒，并重新征求遥测同意。

我们 *永远不会* 在不提升 schema version 且不重新征求同意的情况下，
扩大 `shared/telemetry-events.ts` 的事件白名单。

---

## 11. 验证我们的声明

本项目开源。本文每条声明都对应到一个你可以阅读的文件：

| 声明 | 验证位置 |
| --- | --- |
| 遥测是 opt-in，关闭即静默 | `shared/telemetry.ts > setOptIn`、`track` |
| 事件白名单 | `shared/telemetry-events.ts > EVENTS` |
| 每事件的 prop 白名单 | `shared/telemetry-events.ts > EVENT_PROP_SCHEMAS`、`sanitizeEventProps` |
| 只有两个后端端点 | 全仓库 grep `kyriewen.cn` |
| 无第三方 SDK | `package.json` 依赖 —— Preact、virtua、JSZip，仅此而已 |
| License 服务器仅在用户主动操作时被联系 | `shared/license.ts`、`background/license.ts` |
| 图片字节永不离开你的机器 | `background/reverse-search.ts > fetchImageData`（我们把字节代理 *到* 面板，不是 *到* 服务器） |
| `instanceId` 在发送前被哈希 | `shared/telemetry.ts > getInstanceHash` |

隐私管道的架构叙述见
[`ARCHITECTURE.zh-CN.md § 14`](./ARCHITECTURE.zh-CN.md#14-隐私与遥测管道)。

---

## 还有疑问？

隐私问题：`coderkyriewen@gmail.com`，主题前缀 `[PRIVACY]`。

安全披露（流程不同）：见 [`SECURITY.zh-CN.md`](../SECURITY.zh-CN.md)。
