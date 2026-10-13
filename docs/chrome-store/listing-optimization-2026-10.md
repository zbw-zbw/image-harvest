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

- 截图 1（首图 = 点击率大头）：展示「扫描完成 + DownloadNudgeBar」状态——v1.2.2 的
  核心新体验「N images ready to download」一句话讲清产品价值。
- 截图 2-3：Deep Scan 滚动进度 + 过滤/分组面板。
- 截图 4-5：AI 标注 / Collections / Eagle 导出（专业人群锚点）。
- 更新时机：素材攒到下个版本提审一起换（避免单独触发审核）。

## 预期与度量

- 度量口径：CWS Dashboard 周报「搜索展示 → 点击率 → 安装率」三项，贴入前后各取 2 周对比。
- 预期：长描述关键词补丁提升搜索相关性（展示量）；首图更新提升点击→安装（这是更大的杠杆）。
