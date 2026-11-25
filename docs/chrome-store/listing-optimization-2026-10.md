# CWS Listing 优化方案（2026-10-13，审核等待期产出）

> 背景：v1.2.2 已提审，用户量周涨幅平平（周新增 110-180 平台期）。CWS 搜索是主要获客渠道，
> listing 是「搜索展示 → 点击 → 安装」的第一转化层。本方案基于关键词覆盖分析，不依赖发版的
> 部分可立即贴入，依赖 manifest 的部分攒到 v1.2.3。

## 现状盘点（2026-10-13 核对）

| 字段                        | 当前值                                                                                                                                       | 状态                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 标题（extName）             | `Image Harvest - Download Any Image from Any Webpage`（52 字符）                                                                             | ⚠️ 品类词偏弱                            |
| 短描述（extDesc）           | `Image downloader that finds every image on a page. Batch save as ZIP, multi-tab extract, AI tags, duplicate detection and more.`（131/132） | ✅ 上轮已优化，`image downloader` 已前置 |
| 长描述（description-en.md） | 首段缺 `extractor / bulk / scrape` 变体                                                                                                      | ✅ 本轮已补丁                            |

## 关键词结论

头部搜索词 → 覆盖情况：

- `image downloader` → 短描述首词 ✅、标题弱匹配（只有动词形式）
- `batch image downloader` / `bulk image downloader` → 短描述有 batch ✅；长描述本轮已补 bulk-saves ✅；标题缺
- `image extractor` → 长描述本轮已补 ✅
- `extract images from webpage` / `save images from website` → 长描述首段 every image on any webpage 语义覆盖 ✅
- `image scraper` / `scrape images` → 长描述本轮已补 `scrape or save images in bulk` ✅
- `image grabber` → 未覆盖（竞品常用词但偏垃圾词风，主动放弃）
- 平台长尾（reddit/instagram/pinterest/twitter downloader）→ 不适合放 store 描述（违规风险），已由官网 17 篇 SEO 文章承接 ✅

## 待执行（需要用户登录 CWS 后台）

1. **重贴 en 长描述**（description-en.md 已更新）——listing 变更会触发独立审核，
   建议与截图更新合并一次贴入，减少审核轮次。其余 14 语言文件本轮未动
   （关键词收益集中在 en；其他语言确认收益后再同步）。
2. ~~导出 CWS 后台搜索词数据~~ —— **2026-11-25 核实：这条不存在**。现行
   Developer Dashboard 的 Analytics 只有 `Installs & Uninstalls`、`Impressions`、
   `Weekly Users` 三页，没有 Search terms，Impressions 也不按来源拆分。
   替代证据源：官网 `Search Console → 查询` 能看到落到官网的搜索词（不包含
   直接搜商店后安装的人），只能当作方向性参考，不能用于验证上表。

## 攒到 v1.2.3 的（manifest 变更，须随版本发布）

- **标题改法**：`Image Harvest - Batch Image Downloader`（38 字符，CWS 显示名 45 字符内完整展示，
  `batch image downloader` 是比 `download any image` 更标准的品类搜索词）。
- 15 语言 extName 同步改法：zh_CN 保持「Image Harvest - 批量下载网页图片」（已精准）；
  ja → `Image Harvest - 画像一括ダウンローダー`；其余语言按同模式（品类词前置）。

## 截图建议（listing 视觉转化层）

**2026-11-25 修正：首图有一个此前被忽略的硬约束。**

CWS 搜索结果页（`/search/...`）每个结果项除图标、评分、短描述外，还会渲染首图的
**275×175 缩小版**。实测抓取 `image downloader` 头部竞品的该位置：

| 竞品                                        | 评分 | 275×175 位置放的是什么                                    |
| ------------------------------------------- | ---- | --------------------------------------------------------- |
| Imageye                                     | 4.8  | 纯渐变底 + 图标 + 「Imageeye / Image downloader」大字     |
| Image downloader - picture and photos saver | 4.8  | 纯蓝底 + 图标 + 「Image Downloader」大字 + 一排线性小图标 |
| Image Downloader (Featured)                 | 4.0  | 纯蓝底 + 一个下载图标                                     |

结论：该位置没有任何竞品放真实 UI 截图。侧栏截图在 275px 宽下（工具栏、筛选行、
缩略图、操作条）会退化成灰糊，只有大色块 + 大字号能存活。此前设想的「首图展示
扫描完成 + DownloadNudgeBar」在这个尺寸下不可读，仅对点进详情页的人有效。

### 已产出

- `assets/screenshots/hero-1280.png`（1280×800）：纯品牌绿 `#2a8323` 平涂 + 图标
  （白底圆角板，裁掉源图透明留白后居中）+ 84px 三行标题 + 抽象图片网格（完整
  落在 96px 安全边距内，无出血裁切）。
- `scripts/make-cws-hero.py`：改文案后重新出图，不必回到图形工具。

### 真实截图流水线（2026-11-25 起）

此前的 13 张是手工拼的：左 640px 演示页 + 右 640px 侧栏，卡片元数据清一色
`SVG 400×300 505 B`、URL 是 `data:image/svg+xml,...`。两处破绽各自都能被
一眼看出来——真实 Chrome 侧栏只有 320–400px，五五开把所有元素撑大失真；
占位色块则说明演示页是假的。

现在每张都是「真跑一遍、真截两张、并排合成」：

| 文件                                 | 作用                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| `scripts/take-store-screenshots.mjs` | Playwright 加载 `VITE_E2E` 构建的扩展，逐 shot 操作后合成 1280×800 |
| `e2e/fixtures/store-demo.html`       | 被截的演示页（虚构摄影手记「Field Notes」，9 张真实照片）          |
| `scripts/prep-demo-photos.py`        | 把源照片裁成 1.9–2.2:1 并压到 17–100 KB                            |

```bash
npm run build:e2e                       # 必须先有 dist/.e2e-build
node scripts/take-store-screenshots.mjs # 全部 shot
node scripts/take-store-screenshots.mjs --shot=batch-select --out=/tmp/x.png
```

几个关键点，改脚本时不要退回去：

- 侧栏 400px、演示页 880px（`--panel=` 可调），不是 640/640。
- 图片 URL 走 `--host-resolver-rules=MAP fieldnotes.test 127.0.0.1`，卡片上显示的是
  `http://fieldnotes.test/demo/vestfjorden.jpg`，不会露出 `127.0.0.1:54321`。
- 照片裁成 1.9–2.2:1：侧栏缩略框约 2.2:1 且用 `object-fit: contain`，方一点就会在
  两边留出大片白边。
- 截图前要关掉三样东西：页面高亮遮罩（`rgba(0,0,0,.5)`）、首次使用引导条、toast。
- `ai-tags` 走真实后端 AI 接口，`VITE_E2E` 构建下不可用，暂不产出；`collection`
  目前只截到收藏态，收藏弹窗还没有被打开。

### 上传位置与顺序（CWS 后台手动操作）

入口：`chrome.google.com/webstore/devconsole` → 选扩展 → 左侧 `Store listing` →
页面上半部 `Screenshots`。

**截图上限是 5 张**（官方原文 “at least 1 — and preferably the maximum allowed
5”），不是 14 张。操作要点：

1. 先把 `hero-1280.png` 拖进 Screenshots 区，它会排到最后。
2. 悬停缩略图出现控件，把它调到第 1 位。
3. 位置不够时先删最弱的一张再传（`settings` / `popup` / `upgrade` 信息密度最低，
   优先删）。
4. 保存后整页提审。

推荐组合（首图 + 4 张真实 UI）：

| 位次 | 文件                    | 说明                                |
| ---- | ----------------------- | ----------------------------------- |
| 1    | `hero-1280.png`         | 275×175 下唯一可读的位置            |
| 2    | `batch-select-1280.png` | 批量选中 + Download(11)，价值最直观 |
| 3    | `filters-1280.png`      | 尺寸/类型/可见性筛选                |
| 4    | `collection-1280.png`   | 收藏与跨页复用                      |
| 5    | `ai-tags-1280.png`      | AI 标注，与竞品差异最大             |

不要放 `deepscan-1280.png`：它是 “Deep scanning…” 的进行中状态，截图里放 loading
会让产品显得慢。

`batch-select` / `filters` 已由新流水线重出；`collection` / `ai-tags` 待补（见上一节
的两条限制），补完之前第 4、5 位沿用旧图。

### 度量（没有对照就没有结论）

能算的两段：

- `Impressions → Installs`（CWS 后台两张表相除）。
- 列表页浏览 → install（GA4 那个 developer property）。

拿不到的：具体搜索词、曝光来源拆分（搜索 / 推荐 / 类目 / 直接）。CWS 不提供。

样本现实：30 天列表页访客约 375 人，两周对照组只有 150-190 人量级。低于这个
量级的波动不足以判断成败，不要因为一周数字变化就再改第二次。

### 两项改动分开归因

- 长描述关键词补丁 → 影响的是**曝光量**（搜索相关性）。
- 首图 → 影响的是**曝光之后的点击**，以及详情页的安装转化。

两者不要在同一次提审里一起换，否则任何变化都归不了因。若只能合并提审，至少把
CWS 的 Impressions、GA4 的列表页浏览、以及 Installs 三列分开记录。
