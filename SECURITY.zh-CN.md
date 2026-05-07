# 安全策略

<p align="right">
  <strong><a href="./SECURITY.md">English</a> | 简体中文</strong>
</p>

> Image Harvest 高度重视用户的安全。本策略说明如何上报漏洞、哪些版本
> 受支持，以及扩展所基于的安全模型。

---

## 受支持的版本

我们仅对 **Chrome Web Store 上发布的最新 `1.x` 版本** 提供安全修复。
不向更早的小版本回移修复 —— 老版本用户请升级到最新版。

| 版本 | 是否支持 |
| --- | --- |
| 1.x（最新） | ✅ 是 |
| 1.x（更早的小版本） | ❌ 否（请升级） |
| 0.x（预发布） | ❌ 否 |

> **如何查看版本号**：打开 `chrome://extensions`，找到 Image Harvest，
> 在扩展名下方查看版本。

---

## 上报漏洞

**请不要在 GitHub Issue 中公开提交安全漏洞。** 在修复发布前公开披露
会让所有现有用户暴露在风险中。

请改用**以下任一**渠道私下上报：

1. **电子邮件**（推荐）：`coderkyriewen@gmail.com`，主题前缀
   `[SECURITY]`。如需 PGP 公钥可按需索取。
2. **GitHub Security Advisory**：在
   <https://github.com/zbw-zbw/image-harvest/security/advisories/new>
   提交私有 advisory。

### 报告应包含的内容

一份高质量的报告应包含：

- **受影响的 Image Harvest 版本**。
- **受影响的组件**：`background/`、`content/`、`sidepanel/`、
  `pages/reverse-search.*`、`shared/license.ts`、`shared/telemetry.ts`、
  构建管道等。
- **复现步骤**，详细到我们能在干净的 Chrome profile 上复现。
- **影响**：攻击者能读什么、写什么、外泄什么、诱导用户做什么。
- **建议的修复方案**（可选但欢迎）。
- **你期望的署名方式**（真名、ID、"匿名"）。

### 你可以期待的响应

| 阶段 | 目标 SLA |
| --- | --- |
| 收到报告确认 | **3 个工作日** 内 |
| 初步定级 + 严重性评估 | **7 个工作日** 内 |
| 修复发布到 Chrome Web Store（高/严重） | 定级后 **30 天** 内 |
| 修复发布到 Chrome Web Store（中/低） | 下一个计划版本 |
| 公开披露 | 修复上线 **至少 7 天**（让自动更新生效）后 |

我们遵循**协调披露**：你将获得 [`CHANGELOG.md`](./CHANGELOG.md) 和
GitHub Security Advisory 中的署名（除非你要求匿名）。

---

## 安全模型

Image Harvest 是一款 **Chrome Manifest V3** 扩展，威胁模型由 MV3 允许的
能力，以及我们在此基础上**主动施加的额外限制**共同决定。

### 信任边界

```
┌──────────────────────────────────────────────────────────────────────┐
│  信任边界 1 —— 由 Chrome Web Store 签名的扩展包                       │
│  （用户信任他们通过 Web Store 安装的代码）                           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  信任边界 2 —— 隔离世界                                       │   │
│  │  （扩展 JS 无法读取页面 JS 变量；页面 JS 无法读取扩展 JS 变量；│   │
│  │   只共享 DOM）                                               │   │
│  │                                                              │   │
│  │   不可信：目标页 JS、页面控制的 DOM 字符串                    │   │
│  │   可信：  background/、content/、sidepanel/、pages/、         │   │
│  │           shared/ 中的扩展代码                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  范围外：Chrome 本身、用户操作系统、用户网络                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 权限说明

`manifest.config.ts` 中的每条权限都有明确文档化的理由。我们**不会**
"为了以防万一"申请权限。

| 权限 | 我们为什么需要它 |
| --- | --- |
| `activeTab` | 读取当前标签页的 URL/标题，并在用户主动打开面板时运行内容脚本。这是符合我们使用场景的最窄权限。 |
| `storage` | 持久化设置、过滤配置、license 数据、opt-in 标记、每标签页图片缓存。全部限定在扩展作用域内。 |
| `downloads` | 整个项目的核心 —— 把选中的图片和 ZIP 保存到用户机器。 |
| `scripting` | 把内容脚本注入到扩展加载之前就已经打开的标签页（manifest 中的静态条目只对扩展安装*之后*打开的标签页生效）。 |
| `tabs` | 多标签页抓取（Pro）需要枚举标签页。读取标签 URL/标题用于文件命名和历史记录。 |
| `sidePanel` | 在 Chrome 原生侧边栏区域打开面板 UI。 |
| `webNavigation` | 为 Pro 功能"跨所有 frame 搜索"枚举 frame。 |
| `alarms` | 调度每日 license 重新校验（`chrome.alarms` 是 MV3 中做周期性后台任务的唯一正确方式）。 |
| `host_permissions: <all_urls>` | 内容脚本必须能运行在用户选择扫描的任何页面上；后台 SW 必须能拉取页面会被 CORS 阻断的跨域图片字节。 |

### 内容安全策略（CSP）

扩展自身的 CSP 是 MV3 默认值，再加上明确的仅 `'self'` 的 `script-src`。
**我们不加载远程代码** —— 扩展页中禁止 `<script src="https://...">`。
所有 JavaScript 都来自被签名的扩展包内部，这意味着 Chrome Web Store
审核员能审到我们发出的每一个字节。

这也是为什么我们把 JSZip 作为 `npm` 依赖打包，而不是通过 CDN 加载。

### 扩展通过网络访问的端点

| 端点 | 用途 | 协议 | 触发方式 |
| --- | --- | --- | --- |
| `https://image-harvest.kyriewen.cn/api/license/*` | 激活 / 校验 / 注销 license | HTTPS | 用户激活或后台 SW 每日 alarm |
| `https://image-harvest.kyriewen.cn/api/telemetry` | 匿名 opt-in 遥测批次 | HTTPS | 遥测 SDK（仅当用户已 opt-in 时） |
| `https://www.google.com/searchbyimage`、`https://tineye.com/search`、`https://image.baidu.com/...`、`https://yandex.com/images/...` | 反向图片搜索跳转（图片 URL 通过 query string 传递；扩展自身不上传） | HTTPS 跳转，经由 `pages/reverse-search.html` | 用户点击"反向搜索" |
| 任意图片 URL | 拉取图片字节用于下载 / pHash / 颜色提取 | HTTPS / HTTP（取决于页面） | 用户触发扫描或下载 |

扩展**不会**做任何其他网络调用。没有分析 SDK、没有错误报告 SaaS、
没有字体 CDN、没有头像服务。

### License key 的处理

- key 仅存储在 `chrome.storage.local.licenseData`。
- key 通过 HTTPS 与匿名的每安装 `instanceId` 一起发送到校验 API。
- key **永不**写入日志、**永不**进入遥测事件、**永不**发送给第三方。
- 每个 key 同一时刻最多在一个安装上激活
  （`MAX_LICENSE_INSTANCES = 1`）；注销可释放槽位以供复用。

### 对恶意页面的防御

被扫描的页面**不**被信任。内容脚本：

- 仅通过标准浏览器 API 读取 DOM —— 永不 `eval`、永不 `new Function`、
  永不对攻击者控制的数据使用 `innerHTML`。
- 把每个 URL 都当作要枚举的字符串，而不是要执行的脚本。
- 把每个公开入口都用 `isExtensionContextValid()` 包裹，让 reload 攻击
  无法让页面崩溃。
- 即使页面试图伪造也无法调用 `chrome.tabs.*` —— 隔离世界根本不暴露
  这些 API。

反向搜索代理页（`pages/reverse-search.html`）在构造跳转 URL 之前会
净化 `imageUrl` query 参数。仅允许白名单引擎。

---

## 范围外

以下情况**不**被视为安全漏洞，如以此上报将被关闭：

- **DevTools 中的 self-XSS** —— 用户把攻击者代码粘贴到任何页面的开发者
  控制台是用户自己的选择。Chrome 自身已有警告。
- **被扫描页面自身的 bug** —— 我们呈现页面所暴露的内容；我们不对页面
  自己的 DOM 注入 bug 负责。
- **第三方反向搜索引擎的 bug** —— 我们跳转到它们的搜索；它们的结果页
  由它们自己负责安全。
- **针对用户的社会工程** —— 说服用户安装一个恶意的*其他*扩展不在我们
  控制范围内。
- **license API 的限速绕过** —— 这是软目标。坚定的攻击者要暴力破解 key
  是可以做到的；license 欺诈由服务器端处理，不由扩展处理。

---

## 加固承诺

我们承诺在每个发布版本中：

- ✅ **无远程代码执行**（无 `eval`、无 `new Function`、无
  `<script src="https://...">`）。
- ✅ **运行时无第三方 JS**，仅有打包的 npm 依赖（Preact、virtua、JSZip）。
- ✅ **所有持久化数据限定在扩展作用域** —— 不向 `Downloads` 目录之外
  的任何用户文件写入。
- ✅ **所有网络端点走 HTTPS**。
- ✅ **所有依赖通过 `package-lock.json` 锁定**，并在 CI 中通过
  `npm audit` 审计。
- ✅ **安全 advisory 在修复上线后 30 天内披露**。

---

## 历史 advisory

暂无。一旦发布，将出现在
[GitHub Security Advisories](https://github.com/zbw-zbw/image-harvest/security/advisories)
并在 [`CHANGELOG.md`](./CHANGELOG.md) 中链接。

---

## 还有疑问？

非安全相关问题请使用 [GitHub Discussions](https://github.com/zbw-zbw/image-harvest/discussions)
或 [`README.md`](./README.md) 中列出的渠道。**安全相关事项**仅请使用
上文 **上报漏洞** 中的渠道。
