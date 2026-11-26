# 收入增长实现计划（2026-11-26 → 12-24）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「2,520 个试用 → 3 个付费（0.12%）」拆成四个可独立验证的环节，用四周依次修复首日激活、付费触发、结账完成、商店分发，并在 12-10 用固定口径决定是否投入付费推广。

**Architecture:** 先修口径再修产品。所有改动以生产 Supabase 遥测为唯一事实源；每个 Task 自带"改动前基线 → 改动 → 验收指标"，禁止在没有基线的环节上动手。扩展侧改动按版本批次发布（W2 末 v1.2.15、W4 末 v1.2.16），官网侧改动随 push 即时生效。

**Tech Stack:** Chrome MV3 扩展（TypeScript / Vite / Preact / Vitest）、Next.js 16 官网（pnpm / Supabase / Creem + PayPal）、Telemetry（`telemetry_events` 表）。

**Spec:** 本文档 §基线证据 即规格。所有数字来自 2026-11-26 对生产库与 Creem Live API 的实跑，脚本见 §复现命令。

**Commit convention:** 每个 Task 结束提交一次（`feat:` / `fix:` / `test:` / `docs:` / `chore:`）。两个仓库分别提交，不混合。

**Workspace layout（两仓并列）：**

- 扩展仓：`image-harvest/`（下文未加前缀的路径均相对此仓）
- 官网仓：`image-harvest-backend/website/`（用 **pnpm**）

---

## 基线证据（2026-11-26 实测）

| 环节                                      | 数字                                                                                                                                    | 来源                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 试用总数                                  | **2,520**，`converted_at` 非空 **3** → **0.12%**                                                                                        | `trials` 全表                     |
| 月度试用新增                              | 06: 290 → 07: 252 → 08: 320 → 09: 393 → 10: 561 → **11: 675**                                                                           | `trials.started_at`               |
| 活跃天数分布（10-01 起 1,009 个试用实例） | 1 天 **842 (83.4%)**、2-3 天 136、4-7 天 26、8+ 天 5；**均值 1.34 天**                                                                  | `telemetry_events`                |
| 试用实例漏斗（09-01 起 1,384 实例）       | 扫描过 918 (66.3%) → **下载过 408 (29.5%)** → 见过 Pro 弹窗 84 (6.1%) → 点过 CTA 22 (1.6%)                                              | 同上                              |
| 付费墙曝光                                | `pro_upsell_shown` 347 次 / `pro_feature_blocked` 188 次 / `soft_paywall_shown` **41** 次                                               | 同上                              |
| 到期触点触达                              | `trial_expired` **992** 次，但 `trial_ended_notice_shown` **3**、`trial_expiry_warning_shown` **2**、`trial_weekly_winback_shown` **6** | 同上                              |
| 结账创建                                  | `checkout_created` 52 条（Creem 18 / PayPal 34），可归因完成 **3** ≈ **5.8%**                                                           | `scripts/checkout-attribution.ts` |
| Creem 弃单拆解（近 90 天 17 条）          | 全部 `expired`；**13 条从未开始填卡**；2 条 `payment_failed`（GB，`amount=4999 → due=5999`，税 1000）                                   | Creem Live `GET /checkouts`       |
| 已付费客户                                | `licenses` 状态 active 共 **5**（lifetime 4 / monthly 1）                                                                               | `licenses`                        |
| 供应商归因字段                            | 106 条 license 里只有 **4** 条带 `creem_checkout_id` 或 `paypal_order_id`                                                               | `licenses`                        |
| 商店评分                                  | 893 users / **6 ratings** / 竞品 2M users / 16.8K ratings                                                                               | CWS 公开页                        |

### 结论 1：真正的断点不在结账

`checkout_created` 三个月共 52 次，即使把完成率从 6% 拉到 30%，三个月也只多出约 12 单。而**首日"扫到图但不下载"就损失 510 人/月**。资源必须先投在漏斗上段，否则是在给一个 52 单的池子做装修。

### 结论 2：这是一个"单次工具"，不是"订阅产品"

83.4% 的试用者只活跃一天，均值 1.34 天。5 个付费客户里 4 个买的是 lifetime。

→ 用月度订阅做主力 SKU，和真实使用形态结构性错配：用户没有"每月都要用"的理由，自然也没有"续费"的理由（当前 renewals = 0）。**主力 SKU 必须换成 lifetime**，月付降为次要选项。

### 结论 3：所有"到期挽回"都长在打不开的门上

到期提示全部挂在 `sidepanel/init.ts:260`，只有用户主动打开面板才会评估。而 992 个到期里只有 3 个人打开过面板。**不是文案问题，是渠道问题**——面板内触点在 83% 单日用户面前等于不存在。

### 结论 4：结账与归因两个问题都要修，但归因先修

- Creem：17 条弃单中 13 条（76%）是"会话建了、卡一次没填"——跳转后的托管页在杀死意图，不是卡被拒。
- 2 条 `payment_failed` 是 GB 增值税在结账页凭空 +20%（$49.99 → $59.99），价格页没有预告。
- 归因层本身不可信：`licenses` 几乎不写供应商单号，官网事件与扩展事件用两套 instance id（`checkout_created` 走服务端 hash，`pricing_viewed` 走 web id）。任何"完成率"在修好这层之前都只能当量级参考。

### 因此本计划的重心

| 原计划             | 本计划               | 理由                       |
| ------------------ | -------------------- | -------------------------- |
| P0 结账 4.3% → 50% | **降到 W3**          | 绝对量只有 52 单/3 个月    |
| P0 试用三触点      | **改为工具栏 badge** | 面板内触点触达 0.3%        |
| P1 评分 6 → 30     | 保留 W4              | 影响商店自然流量，但慢变量 |
| —                  | **新增 P0 首日激活** | 55% 扫描者从未下载         |
| —                  | **新增 P0 SKU 结构** | 月付与 1.34 天使用形态错配 |

---

## File Structure Map

**Website（`image-harvest-backend/website/`）：**

- Create: `scripts/pay-attribution.ts` — 统一 Creem + PayPal 的结账归因，替代只看 Creem 的旧脚本
- Modify: `src/lib/purchase.ts` — 结账改为同 tab 跳转
- Modify: `src/components/pricing-cards.tsx` — lifetime 提为主 CTA，月付降级
- Modify: `src/app/[locale]/pricing/page.tsx` — 价格页加入税费说明与 SKU 排序
- Modify: `src/messages/en.json` / `src/messages/zh.json` — 新增税费与 SKU 文案
- Modify: `src/components/pro-purchase-button.tsx` — 透传 `plan` 到结账（若需要）

**Extension（`image-harvest/`）：**

- Modify: `sidepanel/init.ts` — 首扫后的一句话引导（激活）+ badge 清理
- Modify: `sidepanel/components/DownloadNudgeBar.tsx` — 提前到"扫到图但未下载"时出现
- Modify: `sidepanel/components/ProUpgradeModal.tsx` — CTA 顺序按 lifetime 优先
- Modify: `shared/constants.ts` — pricing URL 增加 `plan=lifetime` 默认
- Modify: `background/index.ts` — 到期后设置工具栏 badge（零新权限）
- Modify: `background/license.ts` — 暴露到期状态给 badge 判定
- Create: `background/trial-badge.ts` — badge 文案/配色与去重
- Modify: `_locales/*/messages.json`（15 个）— 新增 badge 与激活引导文案
- Test: `tests/trial-badge.test.ts`、`tests/download-nudge.test.tsx`

---

## Task 1：结账归因口径统一（立即执行）

**Files:**

- Create: `scripts/pay-attribution.ts`（官网仓）
- Read: `scripts/checkout-attribution.ts`（保留，作为 Creem 单供应商深挖工具）

**为什么先做：** 现在唯一的"完成率"来自一个只认 Creem 单号的脚本，把 34 条 PayPal 会话整体判为"不可查"。在修好这个口径之前，任何 A/B 都无法判断胜负。

- [ ] **Step 1: 写脚本骨架**

```ts
// scripts/pay-attribution.ts
// 统一 Creem + PayPal 的结账归因。与 checkout-attribution.ts 的分工：
// - checkout-attribution.ts：只处理 Creem，逐会话调 Creem API 拿失败节点（深挖用）
// - pay-attribution.ts：全供应商，只回答"建了几单、成了几单、卡在哪一段"（周度看板用）
//
// 用法：pnpm exec tsx scripts/pay-attribution.ts [minAgeHours]
```

结构固定为四段输出：`by-provider`、`by-plan`、`unmatched detail`、`attribution health`。

- [ ] **Step 2: 实现三路 join**

完成集必须同时取三个来源，缺一不可：

```ts
// 1) licenses 上的供应商单号
const completedIds = new Set<string>();
for (const l of licenses) {
  for (const id of [l.creem_checkout_id, l.paypal_order_id, l.paypal_subscription_id]) {
    if (id) completedIds.add(id);
  }
}
// 2) checkout_created 的 props.checkoutId（服务端哈希后的 instance）
// 3) 供应商前缀判定：Creem = ch_，PayPal = I-（订阅）或字母数字大写（订单）
```

PayPal 订单号不是 `I-` 前缀，`isCreemSession` 那套前缀判断必须显式改成按 `props.provider` 优先、前缀兜底。

- [ ] **Step 3: 输出归因健康度**

脚本末尾必须打印这一行，任何后续决策都先看它：

```
attribution health: licenses with provider id 4/106 (3.8%) — below 50%, completion rates are a floor not a fact
```

阈值写死在脚本里（50%），低于阈值时退出码仍为 0，但会在末尾打印 `⚠` 前缀。

- [ ] **Step 4: 跑通并记录基线**

Run: `cd image-harvest-backend/website && pnpm exec tsx scripts/pay-attribution.ts 24`

Expected（2026-11-26 实测应输出）：

```
creem:  18 created / 1 completed (5.6%)
paypal: 34 created / 2 completed (5.9%)
attribution health: licenses with provider id 4/106 (3.8%) ⚠
```

- [ ] **Step 5: 提交**

```bash
cd image-harvest-backend/website
git add scripts/pay-attribution.ts
git commit -m "feat(analytics): unify checkout attribution across creem and paypal"
```

**验收：** 脚本一条命令同时给出两个供应商的完成率与归因健康度；不打印任何邮箱、license key、原始 instance id。

---

## Task 2：首日激活 —— 让"扫到图"变成"存下图"

**Files:**

- Modify: `sidepanel/components/DownloadNudgeBar.tsx`
- Modify: `sidepanel/init.ts`
- Modify: `_locales/*/messages.json`（15 个）
- Test: `tests/download-nudge.test.tsx`

**基线：** 918 个试用实例扫描成功，只有 408 个下载过（44.4%）。缺口 510 人/月，是全站最大的绝对损失。

- [ ] **Step 1: 先量清楚 nudge 现在触达多少**

Run:

```bash
cd image-harvest-backend/website
pnpm exec tsx -e "
const {getSupabase}=await import('./src/lib/supabase.ts');
const sb=getSupabase();
for (const e of ['download_nudge_shown','download_nudge_cta_clicked','download_nudge_dismissed','images_shown','download_single']) {
  const {count}=await sb.from('telemetry_events').select('*',{count:'exact',head:true}).eq('event',e).gte('received_at','2026-09-01');
  console.log(e, count);
}"
```

Expected: 先拿到四个数字再改代码。若 `download_nudge_shown` 远小于 `images_shown`，说明触发条件太窄——这正是要修的点。

- [ ] **Step 2: 写失败测试（触发条件）**

```tsx
// tests/download-nudge.test.tsx
it('shows the nudge on the first scan that returned images but no download', async () => {
  state.images = Array.from({ length: 12 }, (_, i) => makeImage(i));
  state.downloadCount = 0;
  const { findByText } = render(<DownloadNudgeBar />);
  await findByText(/Save all|Click any image/i);
});
```

Run: `npm test -- tests/download-nudge.test.tsx`
Expected: FAIL（当前实现没有这条触发路径，或条件不满足）

- [ ] **Step 3: 把触发条件收敛成"有图、没下载、首次"**

`DownloadNudgeBar` 的显示条件改为三合一，不再依赖下载计数阈值：

```ts
const shouldShow = images.length > 0 && downloadCount === 0 && !dismissedThisSession;
```

- [ ] **Step 4: 文案只讲一个动作**

新增 i18n key（15 个 locale 同步，英文为准）：

```json
"nudge_first_save": { "message": "Click any image to save it — or save all $COUNT$ at once." }
```

不写功能列表、不写价格。这一步的目标是让人完成第一次保存，不是卖 Pro。

- [ ] **Step 5: 全量验证并提交**

Run: `npm test -- tests/download-nudge.test.tsx && npm run typecheck && npm run test:i18n`
Expected: 目标测试 PASS；i18n 23/23；typecheck 无输出。

```bash
git add sidepanel/components/DownloadNudgeBar.tsx sidepanel/init.ts _locales tests/download-nudge.test.tsx
git commit -m "feat(activation): prompt the first save on the first scan with results"
```

**验收（W2 结束读）：** `download_single|download_batch` 实例占比从 44.4%（占扫描者）提升到 ≥62%；`download_nudge_shown` 与 `images_shown` 的比值 ≥ 0.8。

---

## Task 3：SKU 结构 —— lifetime 提为主力，月付降级

**Files:**

- Modify: `src/components/pricing-cards.tsx`
- Modify: `src/app/[locale]/pricing/page.tsx`
- Modify: `src/messages/en.json`、`src/messages/zh.json`

**基线：** 5 个付费客户里 4 个买 lifetime；月付活跃 1 个，续费 0。使用形态均值 1.34 天。

- [ ] **Step 1: 调整卡片顺序与视觉权重**

lifetime 卡放在最左（移动端最上），`data-primary-checkout` 只保留在 lifetime 按钮上；monthly 改为 "or $3.99/month" 的次级样式。

- [ ] **Step 2: 改文案，把"买断"讲成对单次工具的正确答案**

```json
// src/messages/en.json → Pricing
"lifetimeBadge": { "message": "Most popular for one-off projects" },
"lifetimeSub": { "message": "Pay once. No renewal, no expiry." }
```

中文同步：「一次性买断，适合按项目使用，不续费、不过期。」

- [ ] **Step 3: 价格页加入税费预告（为 Task 4 铺路）**

在价格区下方加一行小字，两种语言：

```json
"taxNote": { "message": "Prices exclude VAT. Tax is calculated at checkout based on your country." }
```

- [ ] **Step 4: 验证并提交**

Run: `pnpm typecheck && pnpm lint`
Expected: 无输出/无错误。

```bash
git add src/components/pricing-cards.tsx src/app/[locale]/pricing/page.tsx src/messages/en.json src/messages/zh.json
git commit -m "feat(pricing): make lifetime the primary offer"
```

**验收（W4 结束读）：** 新产生的付费中 lifetime 占比 ≥ 80%；价格页 → 结账点击率不低于改动前。

---

## Task 4：结账 —— 同 tab 跳转 + 税费不再突袭

**Files:**

- Modify: `src/lib/purchase.ts`
- Modify: `src/app/[locale]/pricing/page.tsx`（承接 Task 3 的文案）

**基线：** 17 条 Creem 弃单中 13 条从未开始填卡；2 条因 GB 增值税 +20% 在支付环节失败。

- [ ] **Step 1: 新开 tab 改成同 tab**

`handlePurchase` 里 `window.open("", "_blank")` 的乐观占位是历史包袱（为绕过异步弹窗拦截）。同 tab 跳转不需要手势上下文，直接删掉：

```ts
// before: const checkoutWindow = window.open("", "_blank");
// after: 不开窗，拿到 URL 后 window.location.href = url
```

`navigateToCheckout` 简化为单一路径，同时删除 `checkoutWindow?.close()`。

- [ ] **Step 2: 保住"回到价格页"的体验**

同 tab 跳转会让返回键回到价格页，但 `PENDING_CHECKOUT_STORAGE_KEY` 的救援卡依赖"另一个 tab 失焦"。改为在 `pagehide` 时写入、在 `pageshow`（`event.persisted`）时读取，确保返回时救援卡仍能出现。

- [ ] **Step 3: 写测试锁住行为**

```ts
it('navigates the current tab instead of opening a popup', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, href: '', assign });
  await handlePurchase('lifetime', 'one-time', 'en');
  expect(assign).toHaveBeenCalledWith(expect.stringContaining('creem'));
});
```

Run: `pnpm test -- purchase`
Expected: 新增用例 PASS，旧有用例按新行为调整后 PASS。

- [ ] **Step 4: 在 Creem 后台确认税费展示方式（需人工）**

登录 Creem Dashboard → 产品价格设置，确认是否支持「价格含税」。若支持，改为含税定价，价格页文案同步改为 `Prices include VAT where applicable.`；若不支持，保留 Task 3 的"税费在结账时计算"预告。

**此项无法由代码完成，做完在计划里打勾并记录结论。**

- [ ] **Step 5: 提交**

```bash
git add src/lib/purchase.ts && git commit -m "fix(checkout): navigate in place and warn about tax before checkout"
```

**验收（W4 结束读）：** 新产生的 Creem 会话中 `no_payment_attempt` 占比从 76% 降到 ≤50%；结账完成率从 5.8% 提到 ≥20%。

---

## Task 5：到期触达 —— 用工具栏 badge 替代打不开的面板

**Files:**

- Create: `background/trial-badge.ts`
- Modify: `background/index.ts`
- Modify: `background/license.ts`
- Modify: `_locales/*/messages.json`（15 个）
- Test: `tests/trial-badge.test.ts`

**基线：** 992 个到期里，面板内的到期提示只触达 3 个。badge 不需要新权限（manifest 已无 `notifications`），是唯一零成本、非侵入的回归通道。

- [ ] **Step 1: 写失败测试**

```ts
// tests/trial-badge.test.ts
it('sets a badge once when the trial has expired and a paid license is absent', async () => {
  const setBadgeText = vi.fn().mockResolvedValue(undefined);
  globalThis.chrome = { action: { setBadgeText, setBadgeBackgroundColor: vi.fn() } } as any;
  await syncTrialBadge({ trialExpired: true, hasPaidLicense: false, alreadyShown: false });
  expect(setBadgeText).toHaveBeenCalledWith({ text: '!' });
});
```

Run: `npm test -- tests/trial-badge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现幂等 badge**

```ts
// background/trial-badge.ts
// 到期后点亮一次，打开面板即清除。用 storage 记录已提示，避免每次 SW 唤醒都写。
export async function syncTrialBadge(input: {
  trialExpired: boolean;
  hasPaidLicense: boolean;
  alreadyShown: boolean;
}): Promise<'set' | 'clear' | 'noop'> {
  /* ... */
}
```

规则只有三条：到期且未付费且未提示过 → `!`（背景 `#2a8323`）；已付费或试用中 → 清空；已提示过 → 不动。

- [ ] **Step 3: 接到 license 状态变化与 SW 启动两个入口**

`background/index.ts` 的 `onStartup` 与 license 校验回调里各调一次 `syncTrialBadge`；面板打开时（`sidepanel/init.ts` 已有的 `setBadgeText({text:''})`）顺带写入"已提示"。

- [ ] **Step 4: 提交**

```bash
git add background/trial-badge.ts background/index.ts background/license.ts tests/trial-badge.test.ts
git commit -m "feat(retention): surface trial expiry in the toolbar badge"
```

**验收（W4 结束读）：** 到期 cohort 中 badge 点亮人数 / 到期人数 ≥ 60%；点亮后 7 天内重新打开面板的比例 ≥ 25%。

---

## Task 6：商店分发 —— 评分与 1.2.14 生效核查

**Files:**

- Modify: `scripts/*`（不新增；复用 `marketing/snapshots/`）
- 只读：CWS 公开页、`rating_prompt_sentiment` 事件

- [ ] **Step 1: 核查公开页是否已切到 1.2.14**

```bash
curl -s "https://chromewebstore.google.com/detail/image-harvest/<id>?cb=$RANDOM" | grep -o "Version[^<]*" | head -3
```

Expected: 出现 `1.2.14`。若仍是 `1.2.13` 且 `Updated` 未变，说明审核未通过或未上线，**不得**对外宣称已发布。

- [ ] **Step 2: 两步式评分的转化回读（12-03 之后）**

```bash
cd image-harvest-backend/website && pnpm exec tsx scripts/rating-funnel.ts
```

Expected: `sentiment=up` 占比与 `up → rate` 转化分开看。硬指标：`up → rate` ≥ 25%（旧路径直接问时 rate 只有 4%）。

- [ ] **Step 3: 标题/简介加入主搜索词**

在 CWS 短描述里补 `batch` 与 `bulk`（当前 `batch image downloader` 排名 11，差一位进首屏）。不改标题，只改描述与截图首图文案。

- [ ] **Step 4: 记录到快照文件**

Modify: `marketing/snapshots/2026-11-25-pre-listing-refresh.md`，新增 §5.4「1.2.14 生效与评分回读」。

```bash
git add marketing/snapshots/2026-11-25-pre-listing-refresh.md
git commit -m "docs(marketing): record 1.2.14 rollout and rating funnel readback"
```

**验收：** 公开页版本号 = 1.2.14；评分从 6 涨到 ≥12（30 天自然增长 + 新流程）。

---

## Task 7：12-10 复核与推广 go/no-go

- [ ] **Step 1: 固定口径重跑三个脚本**

```bash
cd image-harvest-backend/website
pnpm exec tsx scripts/pay-attribution.ts 24
pnpm exec tsx scripts/rating-funnel.ts
pnpm exec tsx scripts/funnel-baseline.ts
```

- [ ] **Step 2: 只看四个数**

| 指标             | 11-26 基线 | 12-10 门槛 | 未达标的处理                               |
| ---------------- | ---------- | ---------- | ------------------------------------------ |
| 扫描者中下载占比 | 44.4%      | ≥62%       | 回退 Task 2 的触发条件继续迭代，不加新功能 |
| 试用付费转化     | 0.12%      | ≥0.4%      | 检查 Task 3/4 是否上线；未上线则先上线再读 |
| 结账完成率       | 5.8%       | ≥20%       | 回看 Creem 弃单拆解，找新的失败节点        |
| 到期 badge 触达  | —          | ≥60%       | 检查 SW 唤醒时机，而非文案                 |

- [ ] **Step 3: 决策**

四个门槛里 ≥3 个达标 → 允许开始 X/Reddit 的 build in public（每周 2 条，只讲数据与实现细节，不投广告）。
<2 个达标 → 不推广，把 W5-W8 全部投在首日激活与单次工具的商业化上。

---

## 长期三层（不在四周内执行，只登记方向）

1. **产品层：把"一次性抓图"变成"可回访的项目空间"。** 现有 Collections 是唯一带"项目"语义的功能，但目前只是一次会话内的分组。让它跨会话存在、带"上次之后新增"提示，才有机会把 1.34 天抬到 3 天以上。这是唯一能同时改善留存和转化率的方向。
2. **分发层：商店评分 + AI 搜索。** chatgpt.com 目前是官网第一大外部来源（106 次/月），超过任何社媒。与其在 X 上冷启动，不如保证站内内容能被 LLM 引用（结构化的对比页、FAQ、llms.txt）。
3. **商业化层：单次工具就该按单次卖。** lifetime 为主、月付为辅。若未来出现真实的高频用户，再补团队版（多席位 + 共享 collections），而不是把月付硬塞给所有人。

---

## 复现命令（本文档所有数字）

```bash
# 试用与付费基数
cd image-harvest-backend/website
pnpm exec tsx scripts/pay-attribution.ts 24
pnpm exec tsx scripts/checkout-attribution.ts 24   # Creem 逐单失败节点
pnpm exec tsx scripts/funnel-baseline.ts
pnpm exec tsx scripts/rating-funnel.ts
```

订阅/试用表的聚合查询脚本不入库（一次性分析），结论已固化在 §基线证据。
