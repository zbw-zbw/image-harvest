# Microsoft Edge Add-ons 上架核对单（v1.2.0 → 1.2.13）

> 状态：**已上架**。**Edge 线上 1.2.13**（2026-11-25 审核通过；商店接口实测 version 1.2.13、lastUpdate 2026-11-25 16:05）；**Chrome Web Store 1.2.13 待审核**（线上仍为 1.2.11，2026-11-25 18:30 实测）。CWS 这次是包 + 列表素材同一次提交，审过之后版本号和新图一起生效，不需要事后再传一遍。
> 提交队列：无。下一次发版从 1.2.14 起。
> ⚠ Edge 的**列表图不在包的审核范围里**（2026-11-25 18:37 实测）：包已过，但 `screenshots` 仍只有 1 张——手工拼的「Visual Moods」渐变色块页（`SVG 400×300 505 B`、`data:image/svg+xml`），`largePromotionImage` 还是 5 月版「Download Any Image from Any Webpage」。要单独提一次 Store listing 更新（5 张截图 + 两张 tile），审核范围与包无关。确认方式见文末。
> 正式 URL：https://microsoftedge.microsoft.com/addons/detail/image-harvest-download-/ldcpblieinfbpgachbnnbaphkagfemaj
> 目标：把 Image Harvest 提交到 Microsoft Edge Add-ons（Partner Center）。
> 标注 **owner** 的条目需要人工在 Partner Center 网页操作，不在代码仓库内完成。

## 1. 账号与合规（owner）

- [x] 注册/登录 Partner Center 开发者账号：已有账号（2026-09-24 登录确认）
- [x] 加入 Edge Add-ons 计划：2026-09-24 完成（Individual 个人账户，通过 Account settings → Programs → Microsoft Edge → Get started 注册）
- [ ] 完成开发者身份验证（首次需要，审核 1–7 天）
- [ ] 保留扩展名称 "Image Harvest"

## 2. 提交包与兼容性

- [x] 复用 Chrome 同一构建产物：`image-harvest-v1.2.0.zip`（https://github.com/zbw-zbw/image-harvest/releases/tag/v1.2.0 或本地 `image-harvest-v1.2.0.zip`，两者一致）。**2026-09-24 更新：Edge 校验器拒绝含 `.vite/manifest.json` 的包（"More than one manifest.json file"），已重打 Edge-clean 包**（排除 `.vite/`，1,163,267 B，唯一 manifest、version 1.2.0、含死滚动区/重复字节修复）；打包脚本与 CI 均已固化排除（e71f232），Release 附件已同步替换。Chrome 上传同样建议用这个新包。MV3 包 Edge 直接兼容，无需改 manifest
- [x] 1.2.13 包来自 tag `v1.2.13` 的 Release 产物，Edge-clean：`.github/workflows/release.yml:169` 与 `scripts/zip-extension.mjs:76` 打包时都带 `-x ".vite/*"`，包内只有一份 manifest.json
- [ ] Edge Stable 侧载冒烟（`edge://extensions` → 开发者模式 → 加载已解压的 `dist/`）：
  - [ ] 侧边栏打开、扫描 fixture 页出图
  - [ ] 工具栏出现 Deep scan 按钮且完整跑通一次深扫（`chrome.sidePanel` 在 Edge 111+ 受支持；若运行环境不支持，display-mode 已有 popup 兜底，按钮行为一致）
  - [ ] 右键菜单（反向搜图/发送到面板）正常
- [x] 隐私政策 URL 可公开访问（2026-09-24 实测 200 + 真实 Privacy Policy 内容）：https://image-harvest.kyriewen.cn/privacy

## 3. 商店列表（复用 CWS 资产）

- [x] en-US 描述：粘贴 `docs/chrome-store/description/description-en.md` 全文（2026-09-24 已提交）
- [ ] zh-CN 描述：其余 14 语言上架后按需增量（English listing 完整即可过审，其他语言为可选）
- [x] 短摘要（≤ 132 字符）：复用 `docs/chrome-store/summary.md` 的 en 文案（131/132 字符，已核）
- [x] 分类：Productivity（与 CWS 一致）
- [x] 搜索关键词：image downloader / download images / bulk image downloader / image grabber / download all images / image harvest（7 条上限用了 6 条，16/21 words）
- [x] 截图：全部由真实扩展重拍（`assets/screenshots/*-1280.png`，1280×800；680px 真实文章 + 600px 侧栏，不再五五开）；本次提交用 hero + batch-select + filters + collection + ai-tags 五张，顺序见 `docs/chrome-store/listing-optimization-2026-10.md`；另传两张促销图 `assets/promo/small-new.png`（440×280）与 `top-new.png`（1400×560）（2026-11-25 已替换首图与两张促销图）
- [x] 商店图标：`assets/promo/icon-300.png`（300×300 PNG，从 `icons/logo.png` 500×500 源导出）
- [x] 认证说明：选 Yes（Pro 功能有条件锁定），说明 7 天一键试用解锁路径 + 免费层限额明细 + 遥测披露。每次提交前按当版存底重新粘贴（当前为 `certification-notes-v1.2.13.md`，正文 1,975/2,000 字符）

## 4. 提交后跟进

- [x] 在下方「提交记录」表登记提交日期与认证状态（2026-09-24）
- [x] 官网下载区追加 Edge CTA：2026-10-08 过审后直接落地为 hero 区 freeNote 下的低调文本链接（`alsoOnEdge`，`src/components/hero-with-gif.tsx`），直链正式商店 URL，不与主 CTA 竞争；未走「并列按钮 + #edge-coming-soon 占位」方案（过审前无必要占位）
- [x] 上架通过后：正式商店 URL 回填官网 CTA + README 徽章区 + 本文件状态改为「已上架」（2026-10-08 完成：官网 hero CTA、README/README.zh-CN 徽章区 + 链接行 + 安装段 Option 2）

## 提交记录

| 日期       | 版本   | 状态      | 备注                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 | 1.2.0  | In review | Store ID `0RDCKDQGR9XG`；CRX ID `ldcpblieinfbpgachbnnbaphkagfemaj`；官方审核期最长 7 个工作日；过审后 Store URL 可用                                                                                                                                                                                                                                                                                                                                                       |
| 2026-10-08 | 1.2.0  | Approved  | 约 14 天过审（含十一假期）；正式 URL 按 CRX ID 路由（slug 段为规范 slug `image-harvest-download-`，与 Store ID 无关）；已回填官网 hero + README；商店页确认 15 语言、v1.2.0、Updated 2026-09-24、描述全文一致                                                                                                                                                                                                                                                              |
| 2026-10-10 | 1.2.1  | In review | 版本更新提交（trial value-moment banner）；认证说明存底 `docs/edge-store/certification-notes-v1.2.1.md`（每次提交都要重新粘贴 notes）；CWS 侧同日提交、同日过审                                                                                                                                                                                                                                                                                                            |
| 2026-10-14 | 1.2.4  | In review | 版本更新提交（深扫完成检测修复、ko/ja 全量本地化、安装时引导布防 A/B）；认证说明存底 `docs/edge-store/certification-notes-v1.2.4.md`；zip 为 GitHub Release CI 产物（已验证唯一 manifest、version 1.2.4）；CWS 侧同批待提交                                                                                                                                                                                                                                                |
| 2026-10-14 | 1.2.5  | In review | 版本更新提交（trial 价值 toast、pro_upsell CTR 遥测值域修复；官网 invoice CTA 不在包内不入 notes）；认证说明存底 `docs/edge-store/certification-notes-v1.2.5.md`；zip 为 GitHub Release CI 产物（tag v1.2.5，Release workflow success）；紧接 v1.2.4 提交——若 v1.2.4 先过审会直接跳到 v1.2.5                                                                                                                                                                               |
| 2026-10-26 | 1.2.6  | Approved  | 版本更新提交（onboarding arm 修复、welcome 页 A/B 分组说明）；认证说明存底 `docs/edge-store/certification-notes-v1.2.6.md`。本次提交当时未登记，2026-11-23 按商店事实回填：Edge 商店版本号实测已为 1.2.6，lastUpdate 2026-10-27                                                                                                                                                                                                                                            |
| 2026-11-23 | 1.2.8  | In review | 版本更新提交，从线上 1.2.6 直接跨到 1.2.8（1.2.7 全部改动已含在包内，无需补提 1.2.7）；内容为引导链两轮竞态修复（welcome 页即时写 flag + 面板等待 + coach 内做 A/B 判定）；认证说明存底 `docs/edge-store/certification-notes-v1.2.8.md`（notes 内已写明跨版本与 A/B 分组，避免审核员落对照组 误判）；zip 与 CWS 同一份 GitHub Release 产物（tag v1.2.8）                                                                                                                   |
| 2026-11-24 | 1.2.10 | Approved  | 版本更新包：trial 提醒链（day 3/5/7 价值回顾 + 临期警示 + 到期提示 + 每周回访，最多 4 次/7 天间隔，全部只在面板内渲染、不申请 notifications、不阻塞下载），顺带包含 1.2.9 的 welcome/tour 根因修复；若 1.2.8 仍在审核，直接从线上 1.2.6 跳到 1.2.10 即可（跨版本叙述已写进 notes）。认证说明存底 `docs/edge-store/certification-notes-v1.2.10.md`（正文 1,974 字符，限额 2,000）；manifest 权限列表未变。zip 用 tag `v1.2.10` 的 Release 产物（Edge-clean，排除 `.vite/`） |
| 2026-11-25 | 1.2.12 | 待提交    | 两条可见缺陷修复：批量 ZIP 完成提示的计数被 background 回声覆盖成 1；400px 面板下 Pro 对比卡徽章挤压描述。无新增权限。认证说明存底 `docs/edge-store/certification-notes-v1.2.12.md`（正文 1,904 字符）；若 Edge 线上仍为 1.2.10，本次同时带上 1.2.11 的额度统一与配额实验移除。zip 用 tag `v1.2.12` 的 Release 产物（Edge-clean）                                                                                                                                          |
| 2026-11-25 | 1.2.13 | Approved  | 两处「宽面板仍按 400px 计算」的布局修补：列表缩略图固定 160px（600px 面板下两边各空 ~120px）、Collection 弹窗退回单列。无新增权限、无新界面。认证说明存底 `docs/edge-store/certification-notes-v1.2.13.md`（正文 1,975 字符 / 限额 2,000）。zip 用 tag `v1.2.13` 的 Release 产物（Edge-clean），当日审核通过；接口实测 `version` = 1.2.13、`lastUpdateDate` = 2026-11-25 16:05（UTC+8）。列表素材未随之更新，见文末                                                        |

Edge 后台关键凭据（过审后回填官网/README 用）：

- Store ID: `0RDCKDQGR9XG`
- CRX ID: `ldcpblieinfbpgachbnnbaphkagfemaj`
- 正式商店 URL：`https://microsoftedge.microsoft.com/addons/detail/image-harvest-download-/ldcpblieinfbpgachbnnbaphkagfemaj`（2026-10-08 过审生成；注意 storefront 按 CRX ID 路由，用 Store ID 拼 URL 会 404）

## 列表素材上线核实（不必登录后台）

两个商店都有可直接读的接口，核对“线上到底是什么”比看后台状态可靠：

- **Edge 包版本 + 素材**：`https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/ldcpblieinfbpgachbnnbaphkagfemaj`。
  返回 JSON，看 `version`、`lastUpdateDate`（epoch 秒）、`screenshots[]`、`largePromotionImage.uri`。
  2026-11-25 18:37 实测：`version` 1.2.13；`screenshots` 只有 1 项，且仍是旧图。
- **CWS 包版本**：`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120&acceptformat=crx2,crx3&x=id%3Diecgnjidmogebokcfnejncgnelcepffo%26uc`。
  返回的就是当前分发的 CRX；跳过 CRX3 头（`12 + header_len`）后当 zip 打开，读 `manifest.json` 的 `version`，这是浏览器真实拿到的版本。
  2026-11-25 18:37 实测：1.2.11。
- **CWS 图片是否已切**：详情页轮播数。现在是 6 项（1 视频 + 5 截图）；待审核期间一定还是旧图，审过后再核。注意第一格是视频，搜索结果的 275×175 很可能取视频海报而不是新首图——通过后要么删视频，要么把它挪到最后。

判断新图是否真的上线的唯一可靠办法：取商店返回的图片字节，和仓库里的 `assets/screenshots/hero-1280.png` / `assets/promo/top-new.png` 做对比，尺寸一致且缩到 8×8 后逐格均色差 < 10 才算命中。文件名不同、数量相同都不能证明已替换。
