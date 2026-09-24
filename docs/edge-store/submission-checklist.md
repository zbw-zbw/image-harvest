# Microsoft Edge Add-ons 上架核对单（v1.2.0）

> 目标：把 Image Harvest 提交到 Microsoft Edge Add-ons（Partner Center）。
> 标注 **owner** 的条目需要人工在 Partner Center 网页操作，不在代码仓库内完成。

## 1. 账号与合规（owner）

- [x] 注册/登录 Partner Center 开发者账号：已有账号（2026-09-24 登录确认）
- [x] 加入 Edge Add-ons 计划：2026-09-24 完成（Individual 个人账户，通过 Account settings → Programs → Microsoft Edge → Get started 注册）
- [ ] 完成开发者身份验证（首次需要，审核 1–7 天）
- [ ] 保留扩展名称 "Image Harvest"

## 2. 提交包与兼容性

- [x] 复用 Chrome 同一构建产物：`image-harvest-v1.2.0.zip`（https://github.com/zbw-zbw/image-harvest/releases/tag/v1.2.0 或本地 `image-harvest-v1.2.0.zip`，两者一致）。**2026-09-24 更新：Edge 校验器拒绝含 `.vite/manifest.json` 的包（"More than one manifest.json file"），已重打 Edge-clean 包**（排除 `.vite/`，1,163,267 B，唯一 manifest、version 1.2.0、含死滚动区/重复字节修复）；打包脚本与 CI 均已固化排除（e71f232），Release 附件已同步替换。Chrome 上传同样建议用这个新包。MV3 包 Edge 直接兼容，无需改 manifest
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
- [x] 截图：13 张全家福已产出（`assets/screenshots/*-1280.png`，1280×800，面板 680px+演示页 600px 比例）；本次提交用 sidepanel + deepscan 两张，其余 11 张可随时在后台 Store listings 增补
- [x] 商店图标：`assets/promo/icon-300.png`（300×300 PNG，从 `icons/logo.png` 500×500 源导出）
- [x] 认证说明：选 Yes（Pro 功能有条件锁定），说明 7 天一键试用解锁路径 + 免费层限额明细 + 遥测披露（约 1500 字符）

## 4. 提交后跟进

- [x] 在下方「提交记录」表登记提交日期与认证状态（2026-09-24）
- [ ] 官网下载区追加 Edge CTA：复用 hero 区现有 CTA 模式（`src/messages/en.json` 的 `installButton` 文案结构 + chromewebstore 链接位），新增并列按钮 "Install for Edge"，href 先指向 `#edge-coming-soon`，上架通过后替换为正式商店 URL —— 走独立小 PR，**不阻塞** v1.2.0 插件提审
- [ ] 上架通过后：正式商店 URL 回填官网 CTA + README 徽章区 + 本文件状态改为「已上架」

## 提交记录

| 日期       | 版本  | 状态      | 备注                                                                                                                 |
| ---------- | ----- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 | 1.2.0 | In review | Store ID `0RDCKDQGR9XG`；CRX ID `ldcpblieinfbpgachbnnbaphkagfemaj`；官方审核期最长 7 个工作日；过审后 Store URL 可用 |

Edge 后台关键凭据（过审后回填官网/README 用）：

- Store ID: `0RDCKDQGR9XG`
- CRX ID: `ldcpblieinfbpgachbnnbaphkagfemaj`
- 正式商店 URL：过审后生成（`https://microsoftedge.microsoft.com/addons/detail/.../0RDCKDQGR9XG`）
