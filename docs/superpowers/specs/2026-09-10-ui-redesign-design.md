# Image Harvest 整体 UI 重设计 — 设计文档

- 日期：2026-09-10
- 状态：设计已确认（用户通过浏览器 mockup 逐项拍板）
- 基线：v1.1.6（commit 0d71596）；CWS 提审冻结中，本次重构完成后再提审
- 背景：用户反馈三个问题——① 解析原图 banner 丑（占位高、空、样式分散）；② 解析 0 张不该扣次数；③ 整体样式丑（含 Pro 弹窗）。用户明确要求**整体重新设计整个插件 UI**，而非局部修补。

## 1. 已确认决策

| 议题     | 决策                                                                                                | 确认方式                           |
| -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 视觉风格 | A 精致扁平为主体 + C 的密度纪律 + B 的一处 Pro 高光                                                 | 三风格对比页（浏览器）             |
| 布局结构 | B 合并方案 · **筛选行保留版**：提示槽 + command bar + 筛选行 + 网格，~130px 见第一张图（原 ~250px） | 布局对比页（浏览器）               |
| 筛选收纳 | 筛选行保留直接下拉、零额外点击；同步加使用埋点，下版本按数据决定去留                                | 用户质疑「多一步不好」后改保守方案 |
| Pro 弹窗 | A 重排信息架构：CTA hero 常驻 + key 输入折叠 + 列表精简                                             | 弹窗对比页（浏览器）               |

## 2. 设计 token 体系（variables.css 扩展）

| 类别   | 规范                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 间距   | 4 / 8 / 12 / 16 / 24（8pt 网格）                                                                                                              |
| 圆角   | chip/按钮 `--radius-md: 6px`、卡片 `--radius-lg: 8px`、弹窗 12px                                                                              |
| 分层   | 1px `var(--border-color)` 边框 + 背景色差；**去渐变去阴影**；唯一例外 = Pro CTA 品牌绿实心按钮（可带极轻投影 `0 1px 2px rgba(15,23,42,.06)`） |
| 色彩   | 品牌绿 `#60b557`（暗色 `#7cc975`）保留；语义色收敛进 token，组件内禁裸 hex                                                                    |
| 对比度 | 文字 ≥4.5:1；**修复现状**：`#94a3b8` 级灰字在白底仅 ~3.0:1，小标注统一加深一档（暗色主题同步核对）                                            |
| 字号   | 正文 12.5px、辅助 11px、标注 10px、弹窗标题 15-16px                                                                                           |
| 动效   | 150-200ms ease；`prefers-reduced-motion` 降级为瞬时                                                                                           |
| 图标   | 全库 emoji 图标清零（ReferralBanner 🎁、ProUpgradeModal FEATURE_ICONS 17 项），统一 Lucide 风格 stroke SVG，单色 `currentColor`               |

## 3. Sidepanel 布局（P0-a）

目标骨架（自上而下）：

```
提示槽 26px    合并 referral + 试用临期，同屏一条，可关闭
command bar 38px  FREE/PRO 徽标 · 图片计数 · 「🔗 3 · 解析」内联动作 · 刷新/视图/设置
筛选行 34px    现有 7 个筛选控件，交互不动，视觉按 token 收紧
图片网格       直接开始
```

### 3.1 提示槽（NoticeStrip）

- 合并现有 ReferralBanner + TrialGraceBanner/SoftPaywallBanner 的展示层为一个容器组件
- 优先级：试用临期 > referral（时间敏感 + 转化关联优先于增长位）
- 关闭语义：点 ✕ 后**当前这条** 24h 内不再显示（localStorage 记 per-type dismissed 时间戳），另一条可顶上
- Pro 用户整条隐藏；无任何提示时占位为 0

### 3.2 command bar

- 内容：ProStatusBadge（FREE/PRO）· 图片计数 · 解析内联动作 · 现有 toolbar 图标（刷新/视图/设置）
- 解析内联动作：GalleryResolveBar 的 UI 收编为 command bar 内一段——按钮形态「链接图标 + 链接数 + 解析」，**e2e 依赖的类名/id 全部保留**（`.gallery-resolve-bar-toggle` 含计数文案、`.gallery-resolve-links li`、`#btn-gallery-resolve`、`.gallery-resolve-dot.is-resolved/is-failed`），仅容器结构变（banner 三段式 → 内联段 + 锚定展开面板），e2e 预计只需少量选择器路径调整
- 链接数为 0 时整个内联段隐藏
- 展开的链接列表沿用现有 grid-template-rows 0fr↔1fr 折叠容器模式

### 3.3 筛选行

- DOM 与交互不动（用户明确要求保留直接下拉）
- CSS 按 token 收紧：间距、下拉高度、字号统一
- **新增埋点**：`filter_applied`（payload：filter 名，如 format/size/type；不记 URL 关键词内容，隐私安全），复用现有遥测管线

### 3.4 行为修复：解析 0 张不扣配额（P0-c）

GalleryResolveBar.tsx 解析回调中，「全部失败」守卫（`(resolved??0)===0 && (failed??0)>0`）之后、`incrementFeatureUsage` 之前，**新增守卫**：

```tsx
if (toAdd.length === 0) {
  showToast(t('toast_gallery_resolve_no_new'), 'info');
  return; // 不扣配额
}
```

- i18n 新 key `toast_gallery_resolve_no_new`（15 locale，node 脚本 JSON.parse→改→stringify(,2)+\n 批量模式）
- showToast 已支持 `'info'` 类型，无需扩展
- 改完 locale 后 grep e2e 断言是否引用相关文案变体

## 4. Pro 升级弹窗重排（P0-b）

新信息架构（自上而下）：

```
✕ 关闭（SVG）
headline（保留现有 A/B 实验变量 variantHeadline）
副文一句
主 CTA 区：trialEligible ? 「免费试用 7 天」(primary) : 「升级 Pro」(primary)
安抚微文案：无需信用卡 · 试用结束自动降回免费版
核心差异表 4 行（免费 vs Pro，SVG 勾/叉）
底部：details 折叠「已有许可证？输入激活码」 + 「查看价格」链接
```

要点：

- **主 CTA 常驻**：trialEligible=false 时 `#btn-pro-modal-pricing` 升为 primary 实心绿显示（现状整块条件渲染消失 → 弹窗无出口）
- **key 输入折叠**：`<details>` 默认收起，内部保留 `#pro-modal-key-input`、`#btn-pro-modal-activate`、`#pro-modal-error`（license-ui.ts getElementById 绑定不动）
- 比较列表 17 项 → 4 行核心差异（批量下载/图库解析/Eagle 导出/颜色提取；配额数字实施时读 feature_limits 真实值），完整权益入口 `#link-pro-modal-get` 指向定价页
- emoji 图标全换 SVG（FEATURE_ICONS 映射重写为 path）
- `#btn-pro-modal-trial`、`#pro-modal-trial-error` 等 id 全保留；trial 启动流程 handleStartTrial 逻辑不动

## 5. 其余表面（P1）— 一揽子原则，不逐个重设计

- 28 个组件中除 P0 涉及的外：统一刷 token（间距/圆角/边框/字号/语义色）+ 暗色主题同步核对
- 4 个页面（sidepanel/popup/welcome/reverse-search）按同一 token 刷新
- 状态屏（空/加载/错误）、设置弹窗、toast、下载进度等核对层级与间距

## 6. 测试与迁移安全网

- **id 契约保留清单**：`#pro-upgrade-modal`、`#btn-pro-upgrade-close`、`#pro-modal-key-input`、`#btn-pro-modal-activate`、`#pro-modal-error`、`#link-pro-modal-get`、`#btn-pro-modal-trial`、`#btn-pro-modal-pricing`、`#pro-modal-trial-error`
- **e2e**：布局类断言更新（预计 15-25 个）；行为断言（点击后状态）不变；gallery-resolve 相关选择器路径随新结构微调
- **vitest**：ProUpgradeModal 结构断言、配额 toast 断言（新增 0 张不扣配额用例）、GalleryResolveBar 结构快照更新
- background-index.test.ts 等动态导入坑沿用现有模式，不新增静态导入

## 7. 实施分期

- **P0**：sidepanel 布局重构 + Pro 弹窗重排 + 0 张守卫 + filter_applied 埋点 + 相关 e2e/vitest
- **P1**：其余组件/页面 token 刷新 + emoji 清零扫尾 + 暗色主题与对比度核对
- **P2（下版本）**：筛选去留数据决策；Pro 弹窗分步向导实验（可选）

## 8. 不做的事（YAGNI）

- 不做筛选收进浮层 chip（等 filter_applied 数据）
- 不做底部操作栏 + 全浮层筛选的激进分区（e2e 重写 40+ 超预算）
- 不动 A/B 实验、trial 流程、license-ui.ts 绑定逻辑
- 不引入 UI 框架/图标库依赖（bundle 敏感，SVG 内联）
- 不改 manifest 与后端

## 9. 验收标准

1. 免费用户图库页 ~130px 内见第一张图（提示槽 26 + command bar 38 + 筛选行 34 + 边距），明暗双主题一致
2. Pro 弹窗任何资格态都有可见 CTA；key 输入默认折叠
3. 解析成功 0 新增：显示 info toast、当月剩余配额不变（vitest 断言）
4. 全库 emoji 图标 grep 0 命中（ReferralBanner/ProUpgradeModal）
5. 文字对比度 ≥4.5:1（含暗色主题）
6. 全量门禁：vitest 全绿、eslint 0 errors、e2e 124/124（断言更新后）、build 通过、bundle 不超预算、format:check 通过
