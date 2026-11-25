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

结论：该位置没有任何竞品放真实 UI 截图。整张侧栏截图在 275px 宽下（工具栏、
筛选行、缩略图、操作条）会退化成灰糊，只有大色块 + 大字号能存活。

**2026-11-25 二次修正：上一条只对「整张侧栏截图」成立。** 把侧栏按 600×800 贴在
右半边、左半边留给三行大字之后，275×175 下标题可读，缩略图里也能看出「勾选 +
底部 Download (5)」。所以首图定为「左文案 + 右侧真实面板」，不再用抽象网格——
纯色平涂 + 假九宫格在商店里读起来像模板，也没有回答「这是干什么的」。

### 已产出

- `assets/screenshots/hero-1280.png`（1280×800）：品牌绿渐变（`#2a8323` →
  `#7cc975`，两端都取自 `css/variables.css`）+ 左侧 69px 三行标题、副标与
  Free 徽标 + 右侧 `batch-select-1280.png` 的 600px 面板（缩至 564×752，圆角加
  投影，右/上/下各留 24px）。
- `assets/promo/small-new.png`（440×280）与 `assets/promo/top-new.png`（1400×560）：
  同一套渐变、字体与文案。top 版同样贴真实面板；small 版只有 440px，放面板会糊，
  因此只留图标 + 三行字。
- `scripts/make-cws-hero.py`：一次生成这三张；改文案后重跑，不必回到图形工具。
  渐变方向、暗角与噪点都在这里，三张图不会各自漂移。

### 真实截图流水线（2026-11-25 起）

此前的 13 张是手工拼的：左 640px 演示页 + 右 640px 侧栏，卡片元数据清一色
`SVG 400×300 505 B`、URL 是 `data:image/svg+xml,...`。两处破绽各自都能被
一眼看出来——真实 Chrome 侧栏只有 320–400px，五五开把所有元素撑大失真；
占位色块则说明演示页是假的。

现在每张都是「真跑一遍、真截两张、并排合成」：

| 文件                                                  | 作用                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/take-store-screenshots.mjs`                  | Playwright 加载 `VITE_E2E` 构建的扩展，逐 shot 操作后合成 1280×800 |
| `e2e/fixtures/store-demo.html`                        | 被截的演示页（虚构摄影手记「Field Notes」，9 张真实照片）          |
| `e2e/fixtures/store-demo-2.html`、`store-demo-3.html` | 同一站点的另两篇文章，供 multitab 截出三行不同标题                 |
| `e2e/fixtures/demo/article.css`                       | 三篇文章共用的排版 + 760px 两列断点                                |
| `scripts/prep-demo-photos.py`                         | 把源照片裁成 1.9–2.2:1 并压到 17–100 KB                            |

```bash
npm run build:e2e                       # 必须先有 dist/.e2e-build
node scripts/take-store-screenshots.mjs # 全部 shot
node scripts/take-store-screenshots.mjs --shot=batch-select --out=/tmp/x.png
```

几个关键点，改脚本时不要退回去：

- 侧栏 600px、演示页 680px（`--panel=` 可调），不是 640/640。为什么是 600：面板
  ≤540px 时 `@container panel` 会把所有 `.btn-label` 藏掉，底部只剩一排光秃秃的图标；
  600 是「Copy URLs (5) … Download (5)」六个文案都完整、整行不溢出的最小宽度。
  演示页剩下的 680px 用两列照片（`article.css` 的 760px 断点），三列会窄到认不出。
- 图片 URL 走 `--host-resolver-rules=MAP fieldnotes.test 127.0.0.1`，卡片上显示的是
  `http://fieldnotes.test/demo/vestfjorden.jpg`，不会露出 `127.0.0.1:54321`。
- 照片裁成 1.9–2.2:1，与 `.list-view .card-thumb` 的 2.2:1 对齐。缩略框以前是固定
  160px 高 + `object-fit: contain`，面板一宽就在照片两边各留 120px 白边，现在框跟着宽度
  走，照片基本填满。
- 收藏弹窗在 600px 面板下是两列。`.collection-grid` 的列宽从 260px 收到 250px：弹窗正文
  正好 520px，而 `2×260 + 10` 是 530，差 10px 就退成一列，90px 高的缩略图会飘在
  520px 卡片的正中间。
- 截图前要关掉三样东西：页面高亮遮罩（`rgba(0,0,0,.5)`）、首次使用引导条、toast。
- `ai-tags` 的标签由 `seedStorage` 预置：`VITE_E2E` 构建走不到真实 AI 接口，标签内容
  必须和照片对得上（fjord / cliffs / water），否则一眼假。
- `collection` 走真实收藏代码路径点 5 张，再打开收藏弹窗，列表里的计数由组件自己算。
- `popup` 是独立 600×600 表面。Playwright 无法让 popup 跟随文章 tab，脚本在
  init script 里包一层 `chrome.tabs.query`，把 active 查询重排到演示文章上，
  否则 popup 会锁在自己的扩展 tab 上显示 restricted 占位。
- `dedup` 的重复组是真的：演示站把两张照片以 `?w=600` 变体再出一遍，命中
  `detectSimilarImages()` 的 URL 归一化阶段。
- `multitab` 必须先按 tab id 删掉 harness 自己开的扩展 tab；`.tab-url` 已被
  `truncateUrl(…, 50)` 截断，用文本前缀判断会失败。
- `reverse-search` 用 `keepCursor` 保留悬停，否则鼠标移开会关掉引擎菜单。

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
| 2    | `batch-select-1280.png` | 批量选中 + Download (5)，价值最直观 |
| 3    | `filters-1280.png`      | 尺寸/类型/可见性筛选                |
| 4    | `collection-1280.png`   | 收藏与跨页复用                      |
| 5    | `ai-tags-1280.png`      | AI 标注，与竞品差异最大             |

不要放 `deepscan-1280.png`：它是 “Deep scanning…” 的进行中状态，截图里放 loading
会让产品显得慢。

`batch-select` / `filters` / `collection` / `ai-tags` 均已由新流水线重出（2026-11-25），
5 张可以一次全部替换，不再需要混用旧图。

### 官网 / README 的 demo 片段（hero.mp4 / hero.gif）

同一套面板、同一个演示页，由 `scripts/record-hero-video.mjs` 录制：面板是唯一活动的
一半（Chromium `recordVideo` 只录面板），页面半边是一张静帧，最后 `hstack` 拼成
1280×800。

```bash
npm run build:e2e
node scripts/record-hero-video.mjs           # 写 assets/demo 的 mp4 / gif / poster
```

片段走的是主线而不是单个手势：尺寸筛选 11→2→11、勾选三张、真实下载一个 ZIP（用 CDP
把浏览器下载目录指到临时目录，否则 `chrome.downloads` 会把文件写进真实 ~/Downloads）、
收藏两张并打开收藏夹。约 17s，比原来 7.9s 只演示「勾选三张」的那版长一倍多。

几个只在这条链路上才会踩的点：

- 三个卡片一屏放不下（600px 下每张约 330px），点击前要先把卡片 `scrollIntoView`，否则
  Playwright 的自动滚动会让假光标停在一个已经移位的坐标上。
- 假光标要单独注入（`#__record_cursor`），真实 hover 还需额外 `mouse.move`。
- 裁掉开头的 marker 用洋红闪屏 + ffmpeg 采样定位，不能用 `Date.now()`——screencast
  丢帧后时间戳对不上。
- 剪辑参数：24fps / crf 22 的 mp4 约 1.7 MB；GIF 10fps / 720px / 128 色约 1.7 MB（抖动
  比帧率更吃体积）。

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
