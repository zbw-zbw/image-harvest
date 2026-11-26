# 收入增长实现计划（2026-11-26 → 12-24）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「2,520 个试用 → 3 个付费（0.12%）」拆成四个可独立验证的环节，用四周依次修复首日激活、付费触发、结账完成、商店分发，并在 12-10 用固定口径决定是否投入付费推广。

**Architecture:** 先修口径再修产品。所有改动以生产 Supabase 遥测为唯一事实源；每个 Task 自带"改动前基线 → 改动 → 验收指标"，禁止在没有基线的环节上动手。扩展侧改动按版本批次发布（1.2.14 已提审、待结果，`trial_badge` 与 tag 后的预算修正承接 1.2.15），官网侧改动随 push 即时生效。

**Tech Stack:** Chrome MV3 扩展（TypeScript / Vite / Preact / Vitest）、Next.js 16 官网（pnpm / Supabase / Creem + PayPal）、Telemetry（`telemetry_events` 表）。

**Spec:** 本文档 §基线证据 即规格。所有数字来自 2026-11-26 对生产库与 Creem Live API 的实跑，脚本见 §复现命令。

**Commit convention:** 每个 Task 结束提交一次（`feat:` / `fix:` / `test:` / `docs:` / `chore:`）。两个仓库分别提交，不混合。

**Workspace layout（两仓并列）：**

- 扩展仓：`image-harvest/`（下文未加前缀的路径均相对此仓）
- 官网仓：`image-harvest-backend/website/`（用 **pnpm**）

**进度（2026-11-26 更新）：**

| Task | 内容                      | 状态                                         |
| ---- | ------------------------- | -------------------------------------------- |
| 1    | 统一结账归因口径          | ✅ `d51abd9`                                 |
| 2    | 首日激活                  | ⛔ 前提被证伪，不产出代码                    |
| 3    | SKU 结构（lifetime 主推） | ✅ 早于本计划已完成 `8127294`                |
| 4    | 同 tab 结账               | ✅ `64169eb`；税费确认待人工                 |
| 5    | 到期 toolbar badge        | ✅ `463ff45` + 官网 `8b915cb`                |
| 6    | 商店分发                  | ⏳ 1.2.14 已提审（人工），评分回读从过审日算 |
| 7    | 12-10 复核与 go/no-go     | ⏳ 等数据                                    |
| 8    | LLM 可见性（W5）          | ✅ 官网 `4009fbd`                            |
| 9-14 | 长期路线 W6-W12           | ⏳ Task 9 等过审；10/11 已证伪；13 已完成    |

> 代码可完成的部分到 Task 5 为止。Task 6/7 分别卡在“人工提审”与“时间窗口”，不应为了推进而提前宣布达标。
>
> **发版闸门：** 1.2.14 在审期间不提 1.2.15。CWS 同一 item 只允许一个待审提交，提新版必须先 Cancel review，审核从头计时（官方口径，每 publisher 每天最多取消 6 次）。1.2.14 出结果当天再决定 1.2.15 的内容；若结果是拒绝，则按拒因决定「原样重提 1.2.14」还是「修复并入 1.2.15」。

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

- [x] **Step 1: 核查公开页版本（已完成，结论：公开页仍是旧版，1.2.14 在审）**

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

**含义：1.2.14 已提审、尚未过审。** 公开页只反映线上版本，所以「显示 1.2.13」无法区分「未提交」和「在审」；以人工确认为准。所以：

- 两步式评分目前**零触达**，Step 2 的回读窗口从**过审日**起算，不是从 `v1.2.14` tag 起算；
- 本 Task 后续三步全部依赖这次审核结果，不在代码范围内；
- 对外**不得**宣称 1.2.14 已发布。

**1.2.15 的内容已经确定，但不现在提：** `trial_badge`（Task 5）落在 `v1.2.14` tag 之后；tag 之后还有 `e21bf66`（init 预算 135 → 136 kB，两步式评分需要）。两者都会随 1.2.15 发布。在 1.2.14 出结果之前**不动版本号**——提新版必须先 Cancel review，等于把已经排队的时间清零。

- [ ] **Step 2: 两步式评分的转化回读（上传过审后 7 天）**

```bash
cd image-harvest-backend/website && pnpm exec tsx scripts/rating-funnel.ts
```

Expected: `sentiment=up` 占比与 `up → rate` 转化分开看。硬指标：`up → rate` ≥ 25%（旧路径直接问时 rate 只有 4%）。

- [ ] **Step 3: 标题/简介加入主搜索词（人工，商店后台）**

在 CWS 短描述里补 `batch` 与 `bulk`（当前 `batch image downloader` 排名 11，差一位进首屏）。不改标题，只改描述与截图首图文案。

- [x] **Step 4: 记录到快照文件（§5.4 已写，待过审后补回读）**

Modify: `marketing/snapshots/2026-11-25-pre-listing-refresh.md`，新增 §5.4「版本生效核查」+ §6 第 5 条待办。已记录 11-26 实测（1.2.13 / Nov 25 / 6 ratings）与“评分漏斗观察窗口从过审日算起”。

```bash
git add marketing/snapshots/2026-11-25-pre-listing-refresh.md
git commit -m "docs(marketing): record 1.2.14 rollout and rating funnel readback"
```

**验收：** 公开页版本号 = 1.2.14；评分从 6 涨到 ≥12（30 天自然增长 + 新流程）。

---

## Task 7：12-10 复核与推广 go/no-go

- [ ] **Step 1: 固定口径重跑四个脚本**

```bash
cd image-harvest-backend/website
pnpm exec tsx scripts/go-no-go.ts          # 三个可计数的门槛，分母写死在脚本里
pnpm exec tsx scripts/pay-attribution.ts 24 # 第四个门槛：结账完成率
pnpm exec tsx scripts/rating-funnel.ts
pnpm exec tsx scripts/funnel-baseline.ts
```

> `go-no-go.ts`（2026-11-26 新增）把三个门槛的分母固定下来，避免 12-10 当天手拼：
>
> - lifetime 占比 = **11-24 之后创建且带支付渠道单号**的 `licenses` 中 lifetime 数 / 总数（促销赠送不计）；全部 active 的 4/5 只作上下文，不作门槛
> - 试用付费转化 = `trials` 中 `converted_at` 非空的行数 / `trials` 全表行数
> - badge 触达 = `trial_badge_shown` 去重实例数 / `trial_expired` 去重实例数（两个事件在 `shared/trial.ts` 与 `background/trial-badge.ts` 各带一次性 sentinel，每实例最多一次，所以去重实例是正确的分子分母）
>
> 第四个门槛不重算：`pay-attribution.ts` 的供应商归因 join 写在 `main()` 内，没有导出函数，为了一个读数去重构一个已验证的脚本不划算，脚本里直接打印它的命令。
>
> **无数据一律 `UNTESTED`，不打 `0%`。** `trial_badge_shown` 只有 1.2.15 起才存在，读到 0 意味着这个构建还没到用户手里，不是「没人看到」。
>
> **lifetime 门槛的口径在 2026-11-26 修正过一次。** 原写法用全部 active 授权作分母，读到 4/5 = 80%
> PASS；但查 `licenses.created_at` 后发现这 5 单全部创建于 11-24 之前（最近一单是 11-12 的 monthly），
> 切换默认 SKU 之后新增付费为 **0**。这个 80% 描述的是旧 SKU 结构，不是用户在新默认下的选择，所以门槛改为只数切换后的新付费，
> 零单即 `UNTESTED`。

**11-26 预演读数（脚本实跑，不是 12-10 结论）：**

```
lifetime share of new paid  — (0/0)                 >= 80%       UNTESTED
trial -> paid (all-time)    0.12% (3/2524)          >= 0.40%     FAIL
trial badge reach           0.00% (0/960)           >= 60%       UNTESTED

context, not a gate: all-time active paid 80.00% (4/5) lifetime, but the gate above only counts
licenses created on/after 2026-11-24.
computed gates: 1/3 measured, 0 pass · plus the completion gate
```

- [ ] **Step 2: 只看四个数**

| 指标              | 11-26 基线                                             | 12-10 门槛 | 未达标的处理                                   |
| ----------------- | ------------------------------------------------------ | ---------- | ---------------------------------------------- |
| lifetime 占新付费 | 0 单（11-24 起）→ 未测；全量 active 4/5 均为切换前购买 | ≥80%       | 检查 Task 3 是否随新版到达用户；未到达则先发版 |
| 试用付费转化      | 0.12%                                                  | ≥0.4%      | 检查 Task 3/4 是否上线；未上线则先上线再读     |
| 结账完成率        | 5.8%                                                   | ≥20%       | 回看 Creem 弃单拆解，找新的失败节点            |
| 到期 badge 触达   | —                                                      | ≥60%       | 检查 SW 唤醒时机，而非文案                     |

> 「扫描者中下载占比」（44.4%）已从门槛降为观察项：Task 2 证明覆盖不是瓶颈，这一段也没有对应改动，把它当门槛等于考核一个没人动过的数。

- [ ] **Step 3: 决策**

四个门槛里 ≥3 个达标 → 允许开始 X/Reddit 的 build in public（每周 2 条，只讲数据与实现细节，不投广告）。
<2 个达标 → 不推广，把 W5-W8 全部投在回访者减负与单次工具的商业化上。

> **恰好 2 个达标是计划未定义的灰区**（2026-11-26 发现）。原文只写了 ≥3 与 <2 两端，`go-no-go.ts` 会把这句话原样打出来。当天遇到 2 个时必须显式写下走哪一端并给出理由，不要四舍五入成 3。

**若 12-10 时 1.2.14 仍未过审：** 依赖新版才生效的三个指标（lifetime 占比、付费转化、badge 触达）全部视为「未测」，不参与计数。决策顺延到过审后 14 天，口径不变——不因为发版延期而调低门槛，也不拿旧版本的数据冒充新版本的结果。

---

## 长期路线（W5-W12，30-90 天）

四周计划解决的是「已经有人在用，但用得不够好」。这一段解决的是「用完第一次之后还会不会回来」。
方向不靠直觉定，先看数据。

### 判据：回访这件事在数据里长什么样

2026-09-01 起 1,103 个扫描实例（`scripts/scan-behavior.ts`，可复跑）：

| 观察             | 数字                                                                                         | 含义                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 扫描跨 2 天以上  | **260 / 1,103 = 23.6%**                                                                      | 回访真实存在，但只有约四分之一，撑不起「把产品改成项目管理工具」         |
| 只扫描过 1 次    | 279 (25.3%)                                                                                  | 四分之一连第二次扫描都没有，「再来一次」比「管理上次」更基础             |
| 每实例扫描数     | median **4** / p90 59 / max 17,142                                                           | 中位数 4 次但 76.4% 只有 1 天 → 重复劳动主要发生在**同一天内的多个网站** |
| 用过 collections | **29 个实例 = 2.6% 扫描者**，共 912 次添加                                                   | 「项目空间」是零验证需求，不能当地基                                     |
| 用过筛选         | 278 (25.2%)，其中内容筛选 264 (23.9%)                                                        | 筛选是少数人的动作，且设一次就一直在生效                                 |
| 跨天重设筛选     | **49 个实例 = 4.4%**，共 465 次                                                              | 「记住筛选」的可及人群只有 4.4%，撑不起 30 天实验                        |
| day 2+ 事件构成  | scan_triggered 37,036 / images_shown 25,794 / download_single 3,690 / download_batch **457** | 回访者做的是「重扫 + 拿单张」，不是「整理已有素材」（8:1）               |

三条结论，直接决定下面做什么、不做什么：

1. **不把 Collections 升级成项目空间。** 2.6% 意味着「项目」这个概念没有被接受，在它上面盖楼只会把另外 97% 的人推远。原本用来验证「跨会话连续性」的最低成本形态（面板顶部一条「上次扫描」）也已排除，理由见 Task 10。
2. **重复劳动的主战场是同日多站。** median 4 次扫描 vs 76.4% 单日，说明典型场景是「今天把 A/B/C 三个站都抓一遍」。这是工作流问题，不是存储问题。
3. **回访者的动作是重扫**（`download_single` 是 `download_batch` 的 8 倍）。任何「批量导出 / 素材库 / 团队共享」都排在「让重扫更快」之后。

### W5-W6（12-11 → 12-24）：分发层

这一层不依赖扩展审核，可以立刻开工。

**Task 8：LLM 可见性（已完成 2026-11-26）**

理由：商店排名受用户量差 3 个数量级的结构性压制（`image downloader` 第 100 名），短期改不动；但 chatgpt.com 已经是官网第一大外部来源（106 次/月），LLM 引用不看 store ranking，看内容结构。

**Files：**

- Create: `public/llms.txt` ✅
- Create: `src/lib/compare-data.ts` ✅ — 3 家竞品的双语数据 + 品类工作流表
- Create: `src/app/[locale]/compare/page.tsx` ✅
- Create: `src/app/[locale]/compare/[slug]/page.tsx` ✅
- Modify: `src/app/sitemap.ts` ✅ — `/compare` + 3 个 slug
- Create: `tests/compare-data.test.ts` ✅（5 例）

- [x] **Step 1: 先立两条不臆造的规则**

写在 `compare-data.ts` 文件头，后续加页面时不会忘：

1. 竞品数字是 **2026-11-25 商店实抓的快照**，页面上必须带采集日期。评分会漂，过期数字比没有数字更糟。
2. 工作流表描述的是**品类的常见实现**，不写「某竞品做不到」——没有逐个审过对方的每个构建版本，断言别人的缺口就是猜。

商店链接一律用**搜索词**而不是猜 32 位 extension id：猜错是 404，搜索总能落地。

- [x] **Step 2: 页面用平铺 FAQ，不用折叠**

`FaqJsonLd` + `<h3>/<p>` 直接铺在 HTML 里。折叠面板里的答案在部分抓取路径中不计入，而这批页面的唯一目的就是被抓取和引用。

- [x] **Step 3: 验证（本地 3111 实跑）**

| 检查                                          | 结果                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `pnpm typecheck` / `eslint`                   | 干净                                                      |
| `pnpm test`                                   | **37 files / 286 tests**（新增 5 例）                     |
| `pnpm build`                                  | 成功，3 个 slug × en/zh 全部生成                          |
| `/compare`、3 个详情页、`/zh/compare/imageye` | 全部 200                                                  |
| `/llms.txt`、`/sitemap.xml`                   | 200，sitemap 含 3 个对比页 + hreflang                     |
| canonical / hreflang                          | `x-default` / `en` / `zh` 三组正确                        |
| JSON-LD                                       | `FAQPage` + `BreadcrumbList` + 全局 `SoftwareApplication` |

- [x] **Step 4: 提交**

官网仓 `4009fbd` `feat(seo): add comparison pages and llms.txt for assistant discovery`。

**判据（W6 末读）：** chatgpt.com referral 106 → ≥200/月；至少 1 个对比页被外部 LLM 抓取（Vercel 日志里的 referrer/UA）。**判据没到之前不加新的对比页**——先把这 3 个页面的引用跑出来，再决定要不要扩到 Fiktu 等第 4、5 家。

**Task 9：评分观察（零代码）**

两步式评分已随 1.2.14 提审。W5 只做过审后 7 天回读。

判据：`up → rate` ≥ 25%（旧路径 4%）。不达标就停在这一层，不往下加分发动作。

### W7-W10（12-25 → 01-21）：产品层，先验证再建

**Task 10：`scan_restored` 实验 —— ⛔ 前提被证伪（2026-11-26 核实）**

原设想：面板顶部显示「上次：example.com · 42 张 · 2 小时前 → 继续」，一次点击省掉重新输入。

三处前提不成立：

1. **回到同一站点时，面板已经自动重扫。** `loadCurrentTab()` 在没有 tab 缓存时直接 `fetchImages(tabId)`（`sidepanel/tab-lifecycle.ts:205`）；`chrome.storage.session` 里按 `tabId` 存的图片缓存再挡一层。浏览器重启后回到同一站点会重扫，同一次会话内切回来会还原上次结果——「继续」没有独占的功能。
2. **能省下的其实只有筛选条件，而重设筛选的人只有 4.4%。** 09-01 起 1,104 个扫描实例：用过筛选 278（25.2%），用过内容筛选 264（23.9%）；其中在**首扫之后的日子**又重设过内容筛选的只有 **49 个（4.4%）**，共 465 次（`scripts/scan-behavior.ts` 的 `filter re-entry later`）。30 天窗口最多曝光十几个人，20% 点击率与噪音无法区分。
3. **筛选今天是全局且不随 tab 清空的**（`state.activeFilters`）。这既是用过的人不必反复设置的原因，也意味着改成「按站点记忆」会让「设一次、到处生效」的人每开一个新 tab 都要重设——方向可能是反的。

**结论：不做。** 判据表与 `scan_restored_shown` / `scan_restored_clicked` 两个埋点一并作废，不写快照、不加 storage key。

跨天 465 次重设集中在 49 个实例（人均 9.5 次），说明这 49 人确实在反复调；但那是访谈/回放的题，不是 30 天 A/B 的题。

**Task 11：同日多站工作流 —— 不立项**

- **每个 tab 的扫描结果本来就隔离。** 图片按 `tabId` 存在 `chrome.storage.session`（`shared/storage.ts` 的 `saveTabImageCache` / `getTabImageCache`），`state.tabCache` 在内存再挡一层；切 tab 不会串结果。原计划第一条「每个 tab 维护独立扫描会话」已完成，`scan_session_switched` 不必加。
- **筛选/排序是全局的，且不一定是缺陷**（见 Task 10 第 3 点）。「切 tab 保留各自的筛选」改的是语义，不是补缺失；没有「筛选串站」的证据前不动。

**结论：不立项。** 「同日多站」剩下的可测点只有「同一站点 10 分钟内的第二次扫描」（day 2+ 的 `scan_triggered` 37,037 次），等 W7 选题时再定。

> W7-W10 因此没有预置的产品改动。这不是空档：Task 7 的 12-10 决策会决定这一段投在回访者减负还是单次工具的商业化；在决策之前先写代码，等于用实现掩盖「还不知道做哪一个」。

**Task 12：Collections 裁决（W10 末）**

- 90 天内 `collection_added` 覆盖仍 < 5% 扫描者 → 从主导航降级，文案改「下载历史」
- 若 W7-W10 出现能证明跨会话需求的证据（当前没有）且 collections 同步上涨 → 重新评估，但仍不进 W5-W12

### W11-W12（01-22 → 02-04）：商业化层，只做表达

**Task 13：单次工具的表达统一（2026-11-26 完成，官网侧）**

不做定价 A/B：付费样本 5 个，任何价格实验都是噪音。

- ✅ 首页 Pro 卡（`src/app/[locale]/page.tsx`）改报 lifetime：`$99.99 → $49.99 one-time`，CTA 从 `monthly / subscription` 改为 `lifetime / one-time`。改前首页主 CTA 与定价页默认 SKU 相反。
- ✅ 定价页标题/描述/OG/subtitle 全部以「one-time, no subscription」开头（`pricing/page.tsx` + `messages/{en,zh}.json`）。`subtitle` 用 `{lifetimePrice}` 插值，跟随 `feature_limits` 的可配置价，不写死数字。
- ✅ 分享卡（`pricing/opengraph-image.tsx`）从 `Pro from $2.49/month` 改为 `Pro once $49.99`，highlights 把 lifetime 置顶。
- ✅ 竞品对比文（`blog/best-image-extractor-chrome`）的价格顺序改为 lifetime 优先。
- ✅ 对比页（Task 8）原文已是「lifetime 是默认，月/年是备选」，无需改。
- ✅ 代码路径核对：Creem 与 PayPal 都按 `planId=lifetime` / `type=one-time` 起结账，`purchase.ts` 据此走 PayPal 的 one-time 端点。
- ✅ 首页 Pro 卡补税费预告（`tComparison('proTaxNote')`）：CTA 改成直接起 lifetime 结账后，§基线证据里那条「GB $49.99 → $59.99」的价格差必须在首页就说清楚，不能只留在定价页。
- ✅ `scripts/funnel-baseline.ts` 新增 `Checkout plan split`：按 plan 打出 `checkout_started`，零值也打，这是当前唯一可读的 SKU 信号。
- ⏳ CWS 描述：1.2.14 在审期间不动商店侧，过审后再改。
- 未改 `TrialExpiredBanner` 的「annual plan is the cheapest way in」：那是到期挽回的刻意选择（年付折算月价最低），不属于本次口径统一。扩展侧 `TrialValueMomentBanner` 用同一个年付锚点（`$29.99/yr = $2.49/mo`），理由相同，且它在 1.2.14 在审包里，本轮不动。
- 扩展侧无 SKU 预设：`ProUpgradeModal` / `TrialGraceBanner` / `TrialValueMomentBanner` 全部调 `pricingPageUrl(trigger, feature, count)`，不带 plan，默认选中由定价页的 `HERO_PLAN_ID` 决定，已经一致。

**判据（2026-11-26 修正口径）：**

原句写的 `pricing_viewed → checkout_created` 跨两套 instance id：官网事件用 web id，`checkout_created` 用服务端 hash，这个比率算不出来。同源可读的是 `pricing_viewed → checkout_started`，两者都在 `PricingPageTracker` / `PurchaseButton` 里用同一个 web id。

**改前基线（30 天）：** `pricing_viewed` 60 → `checkout_started` 8 次 / 7 个实例（12%）；**8 次全部是 `monthly`，`lifetime` 0 次**，且 8 次都发生在 11-24 之前——那时 lifetime 还不是默认 SKU。11-24（默认 lifetime）起 15 次浏览、0 次结账。

**因此判据只看二值信号：** 上线 30 天后 `lifetime` 的 `checkout_started` 是否 > 0。日流量约 5 次定价页浏览，比率在这个样本上没有意义；「lifetime 从 0 变成非 0」才证明首页那张卡真的把一次性付费卖出去了。若 30 天仍为 0，问题在 offer 本身（价格/定位），不在文案，不再继续改页面文字。

**Task 14：团队版触发条件（只登记，不实现）**

前置 = 单实例扫描数 > 100 的账号 ≥ 20 个。当前 max 17,142 是极少数，先看分布再谈。

### 2027 Q1 之后才考虑

| 方向                                | 前置条件                                     |
| ----------------------------------- | -------------------------------------------- |
| Collections 2.0（跨会话项目空间）   | 跨天重设筛选 > 10% 扫描者，且 Task 12 未降级 |
| 团队版（多席位 + 共享 collections） | 高频账号（>100 次扫描）≥ 20                  |
| 定价实验                            | 月付费 ≥ 30 单                               |

### 不做清单

| 方向                       | 为什么不做                                                     |
| -------------------------- | -------------------------------------------------------------- |
| Collections 升级成项目空间 | 2.6% 使用率，需求未验证                                        |
| 素材云存储 / 跨设备同步    | 需要账号体系 + 存储成本；day 2+ 事件里没有任何「找旧素材」信号 |
| 团队协作                   | 付费客户 5 个全是个人，零团队信号                              |
| 月度订阅促销               | 83.4% 的试用只活跃 1 天且 renewals = 0，促销只会拉高退款       |
| 商店关键词堆砌             | 核心词第 100 名是用户量差距导致的，改标题/描述解决不了排名     |

---

## 复现命令（本文档所有数字）

```bash
# 试用与付费基数
cd image-harvest-backend/website
pnpm exec tsx scripts/pay-attribution.ts 24
pnpm exec tsx scripts/checkout-attribution.ts 24   # Creem 逐单失败节点
pnpm exec tsx scripts/funnel-baseline.ts
pnpm exec tsx scripts/rating-funnel.ts

# 长期判断：跨天回访、collections 使用率、day 2+ 事件构成
pnpm exec tsx scripts/scan-behavior.ts
```

订阅/试用表的其余聚合查询不入库（一次性分析），结论已固化在 §基线证据。
