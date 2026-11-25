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
2. **导出 CWS 后台搜索词数据**（Dashboard → Store performance → Search terms），
   验证/修正上表假设——没有真实查询数据前，关键词布局是推断。

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
缩略图、操作条）会退化成灰糊，只有大色块 + 大字号能存活。此前「首图展示扫描完成

- DownloadNudgeBar」的方案在这个尺寸下不可读，仅对点进详情页的人有效。

### 已产出

- `assets/screenshots/hero-1280.png`（1280×800，115 KB）：品牌绿渐变 + 图标 +
  92px 三行标题「Batch download / every image / on a page.」+ 抽象图片网格
  （无窗口装饰、无控件、无假文字，不构成伪造 UI）。
- `scripts/make-cws-hero.py`：改文案后重新出图，不必回到图形工具。

### 上传顺序（需在 CWS 后台手动操作）

1. 首图改为 `hero-1280.png`。
2. 其余 13 张真实功能截图保持原顺序接在后面（详情页才看得到，是这个尺寸下的
   补充说明层）。
3. 时序：en 长描述若**尚未**重贴，先贴描述观察 2 周、再换首图；若已重贴，则现在
   只换首图。两项挤在同一天会让任何变化都归不了因。

### 度量（没有对照就没有结论）

- 口径：CWS Dashboard 的「搜索结果曝光 → 列表页浏览 → 安装」三段，取更换前后
  各 2 周。GA4 那个属性只能看到列表页浏览量与 install，看不到曝光，因此曝光→点击
  这一段只能在 CWS 后台读。
- 样本现实：30 天列表页访客约 375 人，两周对照组只有 150-190 人量级。低于这个
  量级的波动不足以判断成败，不要因为一周数字变化就再改第二次。

### 两项改动分开归因

- 长描述关键词补丁 → 影响的是**曝光量**（搜索相关性）。
- 首图 → 影响的是**曝光之后的点击**，以及详情页的安装转化。

两者不要在同一次提审里一起换，否则任何变化都归不了因。若只能合并提审，至少把
CWS Dashboard 的周报按「曝光 / 浏览 / 安装」三列拆开记录。
