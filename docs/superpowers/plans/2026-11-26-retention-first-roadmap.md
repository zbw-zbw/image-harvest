# 收入增长实现计划（2026-11-26 → 12-24）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「2,520 个试用 → 3 个付费（0.12%）」拆成四个可独立验证的环节，用四周依次修复首日激活、付费触发、结账完成、商店分发，并在 12-10 用固定口径决定是否投入付费推广。

**Architecture:** 先修口径再修产品。所有改动以生产 Supabase 遥测为唯一事实源；每个 Task 自带"改动前基线 → 改动 → 验收指标"，禁止在没有基线的环节上动手。扩展侧改动按版本批次发布（当前仓库 1.2.14 尚未上传商店，`trial_badge` 建议随 1.2.14 一起审），官网侧改动随 push 即时生效。

**Tech Stack:** Chrome MV3 扩展（TypeScript / Vite / Preact / Vitest）、Next.js 16 官网（pnpm / Supabase / Creem + PayPal）、Telemetry（`telemetry_events` 表）。

**Spec:** 本文档 §基线证据 即规格。所有数字来自 2026-11-26 对生产库与 Creem Live API 的实跑，脚本见 §复现命令。

**Commit convention:** 每个 Task 结束提交一次（`feat:` / `fix:` / `test:` / `docs:` / `chore:`）。两个仓库分别提交，不混合。

**Workspace layout（两仓并列）：**

- 扩展仓：`image-harvest/`（下文未加前缀的路径均相对此仓）
- 官网仓：`image-harvest-backend/website/`（用 **pnpm**）

**进度（2026-11-26 更新）：**

| Task | 内容                      | 状态                                       |
| ---- | ------------------------- | ------------------------------------------ |
| 1    | 统一结账归因口径          | ✅ `d51abd9`                               |
| 2    | 首日激活                  | ⛔ 前提被证伪，不产出代码                  |
| 3    | SKU 结构（lifetime 主推） | ✅ 早于本计划已完成 `8127294`              |
| 4    | 同 tab 结账               | ✅ `64169eb`；税费确认待人工               |
| 5    | 到期 toolbar badge        | ✅ `463ff45` + 官网 `8b915cb`              |
| 6    | 商店分发                  | ⏳ 1.2.14 未上传（人工），评分回读从此起算 |
| 7    | 12-10 复核与 go/no-go     | ⏳ 等数据                                  |

> 代码可完成的部分到 Task 5 为止。Task 6/7 分别卡在“人工上传商店”与“时间窗口”，不应为了推进而提前宣布达标。

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

- Create: `scripts/pay-attribution.ts` — 统一 Creem + PayPal 的结账归因 ✅
- Modify: `src/lib/purchase.ts` — 结账改为同 tab 跳转 ✅
- Create: `tests/purchase-navigation.test.ts` — 锁住同 tab + PayPal marker ✅
- Modify: `src/lib/telemetry-schema.ts` — 新增 `trial_badge_shown` 白名单 ✅
- Modify: `src/components/pricing-cards.tsx` — lifetime 主 CTA（早于本计划已完成）
- Modify: `src/app/[locale]/pricing/page.tsx` / `src/messages/*.json` — 税费预告（已存在）

**Extension（`image-harvest/`）：**

- Create: `background/trial-badge.ts` — 到期 badge 的决策表与一次性点亮 ✅
- Modify: `background/index.ts` — SW 启动 + `VALIDATE_LICENSE` 两个入口 ✅
- Modify: `background/license.ts` — 24h alarm 同拍 reconcile ✅
- Modify: `shared/telemetry-events.ts` — `trial_badge_shown` + prop schema ✅
- Create: `tests/trial-badge.test.ts`（10 例）✅
- Modify: `CHANGELOG.md` — Unreleased 补用户可读说明 ✅
- 不做：`DownloadNudgeBar` / `ProUpgradeModal` / `shared/constants.ts` / `_locales/*`——实测前提不成立或已有实现，理由见 Task 2、Task 3

---

## Task 1：结账归因口径统一（已完成）

**Files:**

- Create: `scripts/pay-attribution.ts`（官网仓）
- Read: `scripts/checkout-attribution.ts`（保留，作为 Creem 单供应商深挖工具）

**为什么先做：** 现在唯一的"完成率"来自一个只认 Creem 单号的脚本，把 34 条 PayPal 会话整体判为"不可查"。在修好这个口径之前，任何 A/B 都无法判断胜负。

- [x] **Step 1: 写脚本骨架**

```ts
// scripts/pay-attribution.ts
// 统一 Creem + PayPal 的结账归因。与 checkout-attribution.ts 的分工：
// - checkout-attribution.ts：只处理 Creem，逐会话调 Creem API 拿失败节点（深挖用）
// - pay-attribution.ts：全供应商，只回答"建了几单、成了几单、卡在哪一段"（周度看板用）
//
// 用法：pnpm exec tsx scripts/pay-attribution.ts [minAgeHours]
```

结构固定为四段输出：`by-provider`、`by-plan`、`unmatched detail`、`attribution health`。

- [x] **Step 2: 实现三路 join**

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

- [x] **Step 3: 输出归因健康度**

脚本末尾必须打印这一行，任何后续决策都先看它：

```
attribution health: licenses with provider id 4/106 (3.8%) — below 50%, completion rates are a floor not a fact
```

阈值写死在脚本里（50%），低于阈值时退出码仍为 0，但会在末尾打印 `⚠` 前缀。

- [x] **Step 4: 跑通并记录基线**

Run: `cd image-harvest-backend/website && pnpm exec tsx scripts/pay-attribution.ts 24`

Actual（2026-11-26 实跑）：

```
checkout_created rows: 52 (distinct sessions 52, duplicates 0, rows without id 0)
licenses: 106

== Completion by provider ==
  creem       18 created /   1 completed (5.6%)
  paypal      34 created /   0 completed (0.0%)

== Completion by plan ==
  monthly     28 created /   1 completed (3.6%)
  lifetime    19 created /   0 completed (0.0%)
  yearly       5 created /   0 completed (0.0%)

⚠ attribution health: 4/106 licenses carry a provider id (3.8%) — below 50%, completion rates are a floor not a fact
```

**修正一条此前的判断：** PayPal 的 0.0% 不是「PayPal 拦住了所有人」，而是 `licenses.paypal_order_id` 几乎全为空——9 月确实产生了 2 张 lifetime 授权，但它们没有回写单号，所以 join 必然看不见。这坐实了 Task 1 的价值：**旧口径把「查不到」当成了「没成交」**。

- [x] **Step 5: 提交**

```bash
cd image-harvest-backend/website
git add scripts/pay-attribution.ts
git commit -m "feat(analytics): unify checkout attribution across creem and paypal"
```

**验收：** 脚本一条命令同时给出两个供应商的完成率与归因健康度；不打印任何邮箱、license key、原始 instance id。

**完成记录（2026-11-26）：** commit `d51abd9`；`pnpm typecheck` 与 `eslint scripts/pay-attribution.ts` 均干净。同时补交了早前漏提交的官网版本同步 `3e83356`（package.json 1.2.13 → 1.2.14）。

---

## Task 2：首日激活 —— 结论：现成方案已在跑，不产出代码

**状态：前提被证伪（2026-11-26）。** 原假设是「引导条没覆盖到没下载的人」，实测相反。

**实测：**

- 511 个「扫描过但从未下载」的试用实例中，**262 个（51.3%）见过引导条**——覆盖不是瓶颈。
- 见过引导条的实例中 142 个点了 CTA（25.9%）；**点过 CTA 的实例里 116 个（81.7%）后来真的下载了**——点击有效。
- 每张图卡本身已有独立下载按钮与格式菜单（`ImageCard.tsx`，`card_tooltip_download`）。
- 引导条 2026-10-13 已上线（`DownloadNudgeBar.tsx` 头注释）；三个月里「扫描者中下载占比」从 29% 只走到 29.5%。
- 按扫描结果分层：扫到 60+ 张的实例下载率 49%，扫到 6-20 张的只有 16%。

**结论：不是发现不了，是不想存。** 剩下 74% 看过 CTA 也不点的人，缺的不是按钮，是「现在就该存」的理由。再加一条提示只会提高打扰率，不会提高下载率。

**因此本 Task 不产出代码。** 若要继续攻这一段，必须先有新假设（例如「用户只想存其中一张」或「存到一半卡在权限/压缩」），并用埋点或访谈验证，而不是先改 UI。

**保留的观察指标：** `download_single|download_batch` 占扫描实例比例（当前 44.4%）。任何后续实验都以此为分母。

---

## Task 3：SKU 结构 —— 已于 2026-11-24 完成

**状态：已完成，无需重做。**

- commit `8127294` `feat(pricing): recommend lifetime instead of yearly`。
- `pricing-cards.tsx` 的 `HERO_PLAN_ID = "lifetime"`，`pricing_default_plan_v1`（yearly vs monthly）已退役，理由写在源码注释里：月度订阅只贡献过 $3.99 且无续费。
- 买断与年付的「几个月回本」换算 `breakEvenMonths()` 已存在。
- 税费提示已存在：`src/messages/en.json:208` 的 `taxNotice`，渲染在 `src/app/[locale]/pricing/page.tsx:267`。

**唯一剩余动作是回读数据**（W4 结束）：新产生的付费中 lifetime 占比 ≥ 80%，价格页 → 结账点击率不低于改动前。不满足再调，不满足之前不再动文案。

---

## Task 4：结账 —— 同 tab 跳转（代码已完成，税费项待人工）

**Files:**

- Modify: `src/lib/purchase.ts`（已完成）
- Create: `tests/purchase-navigation.test.ts`（已完成）
- 只读：`src/components/checkout-rescue-card.tsx`（确认救援卡未受影响）

**基线：** 17 条 Creem 弃单中 13 条从未开始填卡；2 条因 GB 增值税 +20% 在支付环节失败。

- [x] **Step 1: 新开 tab 改成同 tab**

`window.open("", "_blank")` 的乐观占位是历史包袱（为绕过异步弹窗拦截）。同 tab 跳转不需要手势上下文，占位窗买不到任何东西，已删除。

实际落地时把「跳转」抽成可注入依赖，而不是直接在函数里写 `window.location`——否则 jsdom 下无法断言：

```ts
export type Navigator = (url: string) => void;

const hardNavigate: Navigator = (url) => window.location.assign(url);

export async function handlePurchase(
  planId: string,
  type: 'subscription' | 'one-time',
  locale?: string,
  navigate: Navigator = hardNavigate
): Promise<void>;
```

同时删除 `navigateToCheckout()`、`checkoutWindow?.close()`，以及 catch 里的收尾逻辑——现在没有打开的窗口需要清理。

- [x] **Step 2: 保住"回到价格页"的救援卡**

原计划写的是「改为 `pagehide` 写入、`pageshow` 读取」，实际**不需要**：

- marker 在 `navigate()` 之前就写进 `localStorage`，不依赖任何生命周期事件；
- `checkout-rescue-card.tsx` 的 `checkReturnVisit` 既挂在 `visibilitychange` 上，也在挂载时用 `requestAnimationFrame` 跑一次。同 tab 返回会重新挂载价格页，首次 rAF 就会读到 marker。

因此该步**未采用计划中的写法**，救援卡行为保持不变，由 Step 3 的 PayPal 用例覆盖（断言 marker 在跳转前写入）。

- [x] **Step 3: 写测试锁住行为**

`tests/purchase-navigation.test.ts`，`// @vitest-environment jsdom`，3 个用例：

| 用例         | 断言                                                                |
| ------------ | ------------------------------------------------------------------- |
| Creem 同 tab | `navigate` 收到 `checkoutUrl`；`window.open` 未被调用               |
| PayPal       | 跳转前写入 `PENDING_CHECKOUT_STORAGE_KEY`，且 `plan === "lifetime"` |
| 供应商报错   | `rejects.toThrow("boom")` 且 `navigate` 未被调用                    |

Run: `pnpm test`
Actual: **36 files / 281 tests 全绿**；`pnpm typecheck` 与 `eslint` 干净。

注：`openSpy` 需 `let openSpy: any` + 单行 `eslint-disable`，原因是 `vi.spyOn(window, "open")` 的重载推断不接受窄化的测试替身（沿用扩展仓 rating-prompt 测试的做法）。

- [ ] **Step 4: 在 Creem 后台确认税费展示方式（需人工，唯一未完成项）**

登录 Creem Dashboard → 产品价格设置，确认是否支持「价格含税」。若支持，改为含税定价，价格页文案同步改为 `Prices include taxes where applicable.`；若不支持，保留 Task 3 已有的「税费在结账时计算」预告（`taxNotice`）。

**此项无法由代码完成，做完在计划里打勾并记录结论。**

- [x] **Step 5: 提交**

**完成记录（2026-11-26）：** commit `64169eb` `fix(checkout): navigate in place instead of a placeholder tab`。

**验收（W4 结束读）：** 新产生的 Creem 会话中 `no_payment_attempt` 占比从 76% 降到 ≤50%；结账完成率从 5.8% 提到 ≥20%。

**已知风险：** 同 tab 跳转意味着用户在托管页点「返回」会结束结账流程（原来是关掉那个空白 tab）。缓解手段是救援卡（回到价格页即弹 `checkout_rescue`），但救援卡本身**不给折扣**，只给「继续结账」。若 W4 数据显示 `checkout_rescued` 触发变多但完成率没涨，说明折扣或邮件挽回才是下一步，而不是继续改跳转方式。

---

## Task 5：到期触达 —— 工具栏 badge（已完成）

**Files:**

- Create: `background/trial-badge.ts`（已完成）
- Create: `tests/trial-badge.test.ts`（已完成）
- Modify: `background/index.ts`、`background/license.ts`（已完成）
- Modify: `shared/telemetry-events.ts` + 官网 `src/lib/telemetry-schema.ts`（已完成，新增 `trial_badge_shown`）
- 不需要改：`_locales/*/messages.json`（badge 文本是 `!`，没有可翻译文案）

**基线：** 992 个到期里，面板内的到期提示只触达 3 个。badge 不需要新权限（manifest 已无 `notifications`），是唯一零成本、非侵入的回归通道。

- [x] **Step 1: 写失败测试**

`tests/trial-badge.test.ts`，10 个用例，先红后绿。覆盖两组契约：

- `decideTrialBadge` 纯函数矩阵：到期未亮 → `set`；已亮 → `noop`；试用中 → `noop`；已付费且亮过 → `clear`；已付费未亮 → `noop`。
- `refreshTrialBadge` 的 IO 行为：点亮时写 sentinel + 上报 `trial_badge_shown`；第二次调用不重复点亮；active trial 不碰 badge；升级 lifetime 后清空。

- [x] **Step 2: 实现幂等 badge**

```ts
export function decideTrialBadge(input: TrialBadgeInput): TrialBadgeAction {
  if (input.hasPaidLicense) return input.alreadyLit ? 'clear' : 'noop';
  if (!input.trialExpired || input.alreadyLit) return 'noop';
  return 'set';
}

export async function refreshTrialBadge(now = Date.now()): Promise<TrialBadgeAction>;
```

确定的三条规则：

| 状态                         | 动作                                              |
| ---------------------------- | ------------------------------------------------- |
| 试用到期 + 无付费 + 从未点亮 | `!`（背景 `#2a8323`）+ 写 `_trial_badge_shown_at` |
| 已点亮过（不论面板是否清过） | `noop`，不跟面板的清理抢                          |
| 已付费                       | 亮过则清空，未亮过则 `noop`                       |

**与计划的一处关键差异：** 原计划写「已付费或试用中 → 清空」。实际不能清——全局 badge 槽位同时被 `onInstalled` 的安装引导（`1`）占用，SW 启动时无条件清空会直接把安装引导抹掉。因此只有**本模块点亮过**的 badge 才会被清，其余分支一律 `noop`。

- [x] **Step 3: 接到三个入口**

| 入口               | 位置                                                       | 理由                                       |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------ |
| SW 启动            | `background/index.ts` `initLicenseAlarm()` 之后            | 冷启动/浏览器重启用，覆盖错过 alarm 的安装 |
| 24h license alarm  | `background/license.ts` `reportTrialExpiryIfNeeded()` 之后 | 与服务端校验同拍                           |
| `VALIDATE_LICENSE` | `background/index.ts` 消息处理                             | 到期当天首次被观察到的位置（面板问状态）   |

面板打开时不需要新增代码：`sidepanel/init.ts` 本来就无条件 `setBadgeText({ text: '' })`，sentinel 保证下一次 wake 不会重新点亮。

- [x] **Step 4: 提交**

**完成记录（2026-11-26）：**

- 扩展仓 `463ff45` `feat(retention): light a one-shot toolbar badge when the trial expires`。
- 官网仓 `8b915cb` `feat(telemetry): accept the trial badge reach event`（parity 测试 2/2 通过）。
- `npm test` **81 files / 1,854 tests 全绿**；`npm run typecheck` 与 eslint 干净；`npm run build` + `npm run size` 三项预算均通过（sidepanel 135.36/136 kB、background 10.00/12 kB、content 11.49/14 kB）。

**验收（W4 结束读）：** 到期 cohort 中 `trial_badge_shown` 人数 / `trial_expired` 人数 ≥ 60%；点亮后 7 天内重新打开面板的比例 ≥ 25%。

**已知风险：** 对 9 月之前就已到期、且一直留在免费档的老安装，下一次 SW 启动会补点一次 badge（sentinel 为空）。这是一次性补触达，不是循环打扰；但如果 W4 看到 `daysSinceExpiry` 集中在 30+ 的那一批占比过高，说明补触达拉高了分母，应该把「超过 30 天不再点亮」写成规则而不是继续累计。

---

## Task 6：商店分发 —— 评分与 1.2.14 生效核查

**Files:**

- Modify: `marketing/snapshots/2026-11-25-pre-listing-refresh.md`（官网仓）
- 只读：CWS 公开页、`rating_prompt_sentiment` 事件

- [x] **Step 1: 核查公开页版本（已完成，结论：未上线）**

```bash
/usr/bin/curl -sL -A "Mozilla/5.0 …Chrome/131" \
  "https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo?cb=$RANDOM" \
  | grep -o 'QDHp8e">Version</div><div>[^<]*'
```

注：裸 URL 会返回 301，必须 `-L`；Extension ID 是 `iecgnjidmogebokcfnejncgnelcepffo`（直接拼 slug 不生效）。

Actual（2026-11-26 15:30）：

```
Version   1.2.13
Updated   November 25, 2026
Ratings   6
```

**含义：1.2.14 还没提交。** 仓库今天 14:21 才打出 `v1.2.14`（两步式评分），`docs/edge-store/submission-checklist.md` 写明「提交队列：无，下一次发版从 1.2.14 起」。所以：

- 两步式评分目前**零触达**，Step 2 的 12-03 回读前提不成立；
- 本 Task 后续三步全部依赖一次人工上传 + 审核，不在代码范围内；
- 对外**不得**宣称 1.2.14 已发布。

**建议的发布组合：** 把本次的 `trial_badge`（Task 5）与两步式评分一起放进 1.2.14 一并上传——前者需要一次审核窗口才能到达用户，拖到 1.2.15 等于把到期挽回再往后推一个版本。版本号不需要再动（仓库已是 1.2.14，CHANGELOG 已记录）。

- [ ] **Step 2: 两步式评分的转化回读（上传过审后 7 天）**

```bash
cd image-harvest-backend/website && pnpm exec tsx scripts/rating-funnel.ts
```

Expected: `sentiment=up` 占比与 `up → rate` 转化分开看。硬指标：`up → rate` ≥ 25%（旧路径直接问时 rate 只有 4%）。

- [ ] **Step 3: 标题/简介加入主搜索词（人工，商店后台）**

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
