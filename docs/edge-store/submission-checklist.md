# Microsoft Edge Add-ons 上架核对单（v1.2.0）

> 目标：把 Image Harvest 提交到 Microsoft Edge Add-ons（Partner Center）。
> 标注 **owner** 的条目需要人工在 Partner Center 网页操作，不在代码仓库内完成。

## 1. 账号与合规（owner）

- [x] 注册/登录 Partner Center 开发者账号：https://partner.microsoft.com/dashboard/microsoftedge/ （已有账号；若 Edge 计划未开通，在 Partner Center 首次进入 Edge Add-ons 时会引导同意条款）
- [ ] 完成开发者身份验证（首次需要，审核 1–7 天）
- [ ] 保留扩展名称 "Image Harvest"

## 2. 提交包与兼容性

- [x] 复用 Chrome 同一构建产物：从 GitHub Release 下载 `image-harvest-v1.2.0.zip`（https://github.com/zbw-zbw/image-harvest/releases/tag/v1.2.0 — 2026-09-23 CI 重建，已含死滚动区/重复字节修复；本地 `npm run zip` 产物等效）。MV3 包 Edge 直接兼容，无需改 manifest
- [ ] Edge Stable 侧载冒烟（`edge://extensions` → 开发者模式 → 加载已解压的 `dist/`）：
  - [ ] 侧边栏打开、扫描 fixture 页出图
  - [ ] 工具栏出现 Deep scan 按钮且完整跑通一次深扫（`chrome.sidePanel` 在 Edge 111+ 受支持；若运行环境不支持，display-mode 已有 popup 兜底，按钮行为一致）
  - [ ] 右键菜单（反向搜图/发送到面板）正常
- [x] 隐私政策 URL 可公开访问（2026-09-24 实测 200 + 真实 Privacy Policy 内容）：https://image-harvest.kyriewen.cn/privacy

## 3. 商店列表（复用 CWS 资产）

- [ ] en-US 描述：粘贴 `docs/chrome-store/description/description-en.md` 全文
- [ ] zh-CN 描述：粘贴 `docs/chrome-store/description/description-zh_CN.md` 全文（先上两种主要语言，其余语言上架后按需增量）
- [ ] 短摘要（≤ 132 字符）：复用 `docs/chrome-store/summary.md` 的 en 文案（131/132 字符，已核）
- [ ] 分类：Productivity（与 CWS 一致）
- [x] 截图：`assets/screenshots/sidepanel-1280.png` + `assets/screenshots/deepscan-1280.png`（1280×800，Edge 规格双尺寸之一；2026-09-24 生成 — demo 页 fixture `e2e/fixtures/store-demo.html` + 临时 e2e spec（playwright runner 截图后即删），展示了列表视图与 v1.2.0 深扫 overlay 两种状态）
- [x] 商店图标：`assets/promo/icon-300.png`（300×300 PNG，从 `icons/logo.png` 500×500 源导出）

## 4. 提交后跟进

- [ ] 在下方「提交记录」表登记提交日期与认证状态
- [ ] 官网下载区追加 Edge CTA：复用 hero 区现有 CTA 模式（`src/messages/en.json` 的 `installButton` 文案结构 + chromewebstore 链接位），新增并列按钮 "Install for Edge"，href 先指向 `#edge-coming-soon`，上架通过后替换为正式商店 URL —— 走独立小 PR，**不阻塞** v1.2.0 插件提审
- [ ] 上架通过后：正式商店 URL 回填官网 CTA + README 徽章区 + 本文件状态改为「已上架」

## 提交记录

| 日期       | 版本  | 状态   | 备注 |
| ---------- | ----- | ------ | ---- |
| （待登记） | 1.2.0 | 未提交 |      |
