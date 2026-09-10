# Image Harvest 整体 UI 重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实已确认的设计（docs/superpowers/specs/2026-09-10-ui-redesign-design.md）：sidepanel 顶部 ~130px 见图（提示槽 26 + command bar 38 + 筛选行 34）、Pro 弹窗 IA 重排（CTA 常驻 + key 折叠）、解析 0 张不扣配额、filter_applied 埋点、全库 token 统一与 emoji 清零。

**Architecture:** Preact 组件层做结构性重排（NoticeStrip 合并三 banner、GalleryResolveBar 内联进 command bar、ProUpgradeModal 重排 Section），纯 CSS 层做 token 化（variables.css 扩展）。行为修复（配额守卫）与埋点独立成任务先行。id 契约与 e2e 类名全程保留。

**Tech Stack:** Preact + 纯 CSS（8 文件）+ vite + vitest（75 文件 1670 用例）+ Playwright e2e（124 用例）+ Chrome MV3。

**硬约束（每 Task 通用）：**

- id 契约：`#pro-upgrade-modal`、`#btn-pro-upgrade-close`、`#pro-modal-key-input`、`#btn-pro-modal-activate`、`#pro-modal-error`、`#link-pro-modal-get`、`#btn-pro-modal-trial`、`#btn-pro-modal-pricing`、`#pro-modal-trial-error`（license-ui.ts L252-265 getElementById 绑定）
- e2e 类名：`.gallery-resolve-bar-toggle`（含计数文案）、`.gallery-resolve-links li`、`#btn-gallery-resolve`、`.gallery-resolve-dot.is-resolved/is-failed`、`#gallery-resolve-bar`
- 遥测隐私契约：props 不得含 URL/自由文本；A/B 实验、trial 流程、license-ui.ts 绑定逻辑不动
- bundle 敏感：禁引 UI 库/图标库，SVG 全内联
- commit 遵循 ai-coding-metrics 协议（type + AI-Autonomy trailer + .specs/ai-coding-log.jsonl 双写）
- 当前分支直接工作（项目惯例），CWS 提审保持冻结

---

## 文件结构总览

| 动作   | 文件                                             | 职责                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| Create | `sidepanel/components/NoticeStrip.tsx`           | 26px 提示槽：trial-grace > soft-paywall > referral 三选一 |
| Create | `css/command-bar.css`                            | command bar + notice strip + resolve 内联段样式           |
| Create | `scripts/add-i18n-key.js`                        | 15 locale 批量加 key（JSON.parse→改→stringify）           |
| Create | `tests/notice-strip.test.tsx`                    | NoticeStrip 三分支 + 优先级 + 24h dismiss                 |
| Delete | `sidepanel/components/ReferralBanner.tsx`        | 逻辑收编进 NoticeStrip                                    |
| Delete | `sidepanel/components/SoftPaywallBanner.tsx`     | 同上                                                      |
| Delete | `sidepanel/components/TrialGraceBanner.tsx`      | 同上                                                      |
| Delete | `tests/trial-grace-banner.test.tsx`              | 断言迁移进 notice-strip.test.tsx                          |
| Modify | `sidepanel/components/GalleryResolveBar.tsx`     | 0 张守卫 + 内联段结构                                     |
| Modify | `sidepanel/components/ProUpgradeModal.tsx`       | IA 重排 + FEATURE_ICONS SVG 化 + 4 行精简                 |
| Modify | `sidepanel/components/mount.tsx`                 | 挂载调整                                                  |
| Modify | `pages/_shared-body.html`                        | 骨架重排（banner slot→notice slot、Row1+Row2 合并）       |
| Modify | `shared/telemetry-events.ts`                     | FILTER_APPLIED 事件                                       |
| Modify | `sidepanel/init.ts`                              | filter_applied 埋点插桩                                   |
| Modify | `css/variables.css`                              | token 扩展 + 对比度修复                                   |
| Modify | `css/modals.css`                                 | Pro 弹窗重排样式                                          |
| Modify | `css/toolbar.css`                                | 旧 toolbar 高度调整                                       |
| Modify | `tests/sidepanel-link-resolve-quota-ui.test.tsx` | 0 张守卫用例                                              |
| Modify | `tests/sidepanel-pro-upgrade-modal.test.tsx`     | 重排断言                                                  |
| Modify | `tests/soft-paywall.test.tsx`                    | render 目标换 NoticeStrip                                 |
| Modify | `e2e/gallery-resolve.e2e.ts`                     | 选择器微调（如需）                                        |

---

## Task 1: 解析 0 张不扣配额守卫 + i18n key（15 locale）

**Files:**

- Modify: `sidepanel/components/GalleryResolveBar.tsx:155-170`
- Modify: `_locales/*/messages.json`（15 个）
- Test: `tests/sidepanel-link-resolve-quota-ui.test.tsx`

- [ ] **Step 1.1: 写失败测试**（tests/sidepanel-link-resolve-quota-ui.test.tsx 末尾、`QuotaDisplay` describe 之前插入）

```tsx
describe('GalleryResolveBar — resolve adds nothing new (0-new guard)', () => {
  it('all originals already in list → info toast, quota NOT consumed', async () => {
    state.galleryLinks = [...LINKS];
    // Resolve "succeeds" but both originals are already in state.allImages —
    // the user gains nothing, so quota must not be burned.
    state.allImages = [
      { url: 'https://example.com/orig-1.png' },
      { url: 'https://example.com/orig-2.png' },
    ] as typeof state.allImages;
    const chromeRef = (
      globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }
    ).chrome;
    chromeRef.runtime.sendMessage.mockResolvedValue({
      success: true,
      images: [
        { url: 'https://example.com/orig-1.png', type: 'link-resolved' },
        { url: 'https://example.com/orig-2.png', type: 'link-resolved' },
      ],
      results: [
        { url: LINKS[0], status: 'resolved' },
        { url: LINKS[1], status: 'resolved' },
      ],
      resolved: 2,
      failed: 0,
    });

    const { container } = render(<GalleryResolveBar />);
    clickResolve(container);

    await waitFor(() =>
      expect(ui.showToast).toHaveBeenCalledWith('No new images found — nothing was added', 'info')
    );
    // Quota untouched: feature-quota storage never written (no increment).
    const setCalls = (chromeRef.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes('featureQuota')
    );
    expect(setCalls.length).toBe(0);
    // And NOT the success toast (which would mean the increment path ran).
    const calls = (ui.showToast as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([msg]) => String(msg).includes('Added'))).toBe(false);
  });
});
```

- [ ] **Step 1.2: 运行确认失败**

Run: `npx vitest run tests/sidepanel-link-resolve-quota-ui.test.tsx`
Expected: FAIL —新用例「No new images found」断言超时（现状走 success toast「Added 0 images · …」且扣配额）

- [ ] **Step 1.3: 写 i18n 批量脚本**（scripts/add-i18n-key.js）

```js
#!/usr/bin/env node
// Adds a single i18n key to every locale's messages.json.
// Usage: node scripts/add-i18n-key.js <key> <json-message-per-locale>
//   where <json-message-per-locale> is a JSON object {locale: "text"}.
// Keeps files deterministic: 2-space indent + trailing newline.
const fs = require('fs');
const path = require('path');

const [, , key, messagesJson] = process.argv;
if (!key || !messagesJson) {
  console.error('Usage: node scripts/add-i18n-key.js <key> \'<{"en":"...","zh_CN":"..."}>\'');
  process.exit(1);
}
const messages = JSON.parse(messagesJson);
const localesDir = path.join(__dirname, '..', '_locales');
for (const locale of fs.readdirSync(localesDir)) {
  const file = path.join(localesDir, locale, 'messages.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const text = messages[locale] ?? messages.en;
  data[key] = { message: text };
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`${locale}: ${key} = ${text}`);
}
```

- [ ] **Step 1.4: 执行加 key**（15 locale 一次）

Run:

```bash
node scripts/add-i18n-key.js toast_gallery_resolve_no_new '{"en":"No new images found — nothing was added","zh_CN":"未发现新图片，未添加任何内容","zh_TW":"未發現新圖片，未新增任何內容","ja":"新しい画像は見つかりませんでした。追加はありません","ko":"새 이미지가 없습니다. 추가되지 않았습니다","de":"Keine neuen Bilder gefunden — nichts hinzugefügt","fr":"Aucune nouvelle image trouvée — rien n'\''a été ajouté","es":"No se encontraron imágenes nuevas — no se añadió nada","it":"Nessuna nuova immagine trovata — nulla è stato aggiunto","pt":"Nenhuma imagem nova encontrada — nada foi adicionado","ru":"Новые изображения не найдены — ничего не добавлено","nl":"Geen nieuwe afbeeldingen gevonden — niets toegevoegd","ar":"لم يتم العثور على صور جديدة — لم يتم إضافة أي شيء","hi":"कोई नई इमेज नहीं मिली — कुछ भी जोड़ा नहीं गया","th":"ไม่พบรูปภาพใหม่ — ไม่ได้เพิ่มอะไรเลย"}'
```

Expected: 15 行 `locale: toast_gallery_resolve_no_new = …` 输出

- [ ] **Step 1.5: 实现守卫**（GalleryResolveBar.tsx，「全部失败」守卫 L156-163 之后、`void track(EVENTS.GALLERY_RESOLVE_COMPLETED…)` L165 之前插入）

```tsx
// v1.2 fix: a resolve that succeeded but added NOTHING new (every
// original was already in the list) must not burn the free monthly
// quota — to the user that's indistinguishable from a bug. Info
// toast, no increment, and bail before the quota path.
if (toAdd.length === 0) {
  void track(EVENTS.GALLERY_RESOLVE_COMPLETED, {
    resolved: response.resolved ?? 0,
    failed: response.failed ?? 0,
  });
  showToast(t('toast_gallery_resolve_no_new'), 'info');
  return;
}
```

- [ ] **Step 1.6: 运行确认通过**

Run: `npx vitest run tests/sidepanel-link-resolve-quota-ui.test.tsx`
Expected: PASS（原有 3 个 quota toast 用例 + 新 1 个全绿）

- [ ] **Step 1.7: grep e2e 文案变体**

Run: `grep -rn "gallery_resolve" e2e/ | grep -iv "selector\|class\|locator" | head -5`
Expected: 无 e2e 断言依赖「Added 0」类文案（若命中需同步更新该断言）

- [ ] **Step 1.8: Commit**

```bash
git add sidepanel/components/GalleryResolveBar.tsx _locales/ scripts/add-i18n-key.js tests/sidepanel-link-resolve-quota-ui.test.tsx
git commit  # fix: 解析成功但 0 新增时不扣免费配额（info toast + 15 locale i18n）
```

---

## Task 2: filter_applied 埋点

**Files:**

- Modify: `shared/telemetry-events.ts:114-126`（Filter events 组）+ `:224-226`（SCHEMAS）
- Modify: `sidepanel/init.ts`（筛选/sort/group 用户交互处）
- Test: `tests/sidepanel-init.test.tsx`

- [ ] **Step 2.1: 注册事件**（telemetry-events.ts，EVENTS 的 Filter events 组 `VISIBLE_FILTER_TOGGLED` 行后加）

```ts
  // v1.2: which filters users actually touch — data for the next-version
  // decision on whether the filter row earns its 34px.
  FILTER_APPLIED: 'filter_applied', // props: { filter: string } (size/type/layout/url/filesize/color/sort/group)
```

（SCHEMAS 里 `VISIBLE_FILTER_TOGGLED` 行后加）

```ts
  [EVENTS.FILTER_APPLIED]: ['filter'],
```

- [ ] **Step 2.2: 写失败测试**（tests/sidepanel-init.test.tsx 末尾追加；沿用该文件现有的 DOM mock 模式——实施时先读文件头部 mock 区确认 import 名）

```tsx
describe('filter_applied telemetry', () => {
  it('clicking a size filter option emits filter_applied {filter:"size"}', async () => {
    const { initSidepanel } = await import('../sidepanel/init');
    // 调用 initSidepanel 的公开入口（按文件实际导出名调整）
    const option = document.querySelector('[data-size-filter="large"]');
    option!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'size' });
  });
});
```

（若 sidepanel-init.test.tsx 的结构不适合直插，改为独立小文件 `tests/filter-telemetry.test.tsx`，mock `../shared/telemetry` 后 `import('../sidepanel/init')` 触发绑定再点击。）

- [ ] **Step 2.3: 运行确认失败**

Run: `npx vitest run tests/sidepanel-init.test.tsx`
Expected: FAIL — track 未被调用（埋点还没插）

- [ ] **Step 2.4: 插桩**（sidepanel/init.ts；原则：每处「用户主动改变筛选值」的 handler 顶部一行。定位点：`data-size-filter` forEach（L728 附近）、`data-group-filter`（L238/L833）、`data-sort-filter`（L857）、type checkbox、url input change、layout/filesize/color 同类 handler）

每个 handler 内插一行（示例 size）：

```ts
void track(EVENTS.FILTER_APPLIED, { filter: 'size' });
```

- filter 名清单：`size`、`type`、`layout`、`url`（change 事件非 input，避免逐键上报）、`filesize`、`color`、`sort`、`group`。**URL 关键词内容永不上报**（隐私契约）。
- 若 filter.ts 内已有统一入口（如 `setSizeFilter` 类 helper），优先在 helper 内插一行，避免 8 处重复。
- import 若缺则补：`import { track } from '../shared/telemetry'; import { EVENTS } from '../shared/telemetry-events';`（init.ts 已有的话复用）

- [ ] **Step 2.5: 运行确认通过 + telemetry 白名单回归**

Run: `npx vitest run tests/sidepanel-init.test.tsx tests/telemetry.test.ts`
Expected: PASS（FILTER_APPLIED 经 `Object.values(EVENTS)` 自动进白名单）

- [ ] **Step 2.6: Commit**

```bash
git add shared/telemetry-events.ts sidepanel/init.ts tests/
git commit  # feat: filter_applied 埋点（8 类筛选交互，不含 URL 内容）
```

---

## Task 3: CSS token 扩展 + 对比度修复

**Files:**

- Modify: `css/variables.css:10-50`（:root 加 token；:root[data-theme='dark'] 与 prefers-color-scheme 块同步）

- [ ] **Step 3.1: 扩展 token**（variables.css `:root` 的 `--pro-badge-bg` 行后追加；dark 两个块同步加注释说明继承）

```css
/* ── v1.2 UI redesign tokens (docs/superpowers/specs/2026-09-10-ui-redesign-design.md §2) ── */
/* 8pt spacing scale — component paddings/gaps draw from here */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;
/* Text sizes (dense tool UI, not marketing) */
--font-body: 12.5px;
--font-aux: 11px;
--font-caption: 10px;
--font-modal-title: 15px;
/* Modal radius (buttons=--radius-md 6, cards=--radius-lg 8 already exist) */
--radius-modal: 12px;
/* Interaction timing: 150-200ms ease, reduced-motion handled globally */
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--duration-fast: 150ms;
--duration-base: 200ms;
/* The ONLY elevated surface in the redesign: the Pro CTA */
--cta-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
```

- [ ] **Step 3.2: 对比度修复**（白底 `--text-tertiary: #9ca3af` 约 2.8:1 → 加深到 #64748b ≈ 4.7:1；暗色块不动 #6b7280 → 暗底上同步核验）

```css
--text-tertiary: #64748b; /* was #9ca3af — 3.0:1 fails WCAG AA for caption text */
```

dark 两块同步：`--text-tertiary: #8b96a5;`（暗底 #1a1a1a 上 ≈ 5:1，原 #6b7280 约 3.4:1）

- [ ] **Step 3.3: 全局 reduced-motion**（variables.css 文件末尾追加）

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3.4: 验证构建 + Commit**

Run: `npm run build 2>&1 | tail -5`
Expected: build 通过，无 CSS 语法错误

```bash
git add css/variables.css
git commit  # feat: v1.2 设计 token（8pt 间距/字号/圆角/动效）+ 文字对比度 AA 修复
```

---

## Task 4: NoticeStrip 提示槽（合并三 banner）

**Files:**

- Create: `sidepanel/components/NoticeStrip.tsx`
- Create: `tests/notice-strip.test.tsx`
- Delete: `sidepanel/components/ReferralBanner.tsx`、`SoftPaywallBanner.tsx`、`TrialGraceBanner.tsx`
- Delete: `tests/trial-grace-banner.test.tsx`
- Modify: `pages/_shared-body.html:18-24`、`sidepanel/components/mount.tsx`、`tests/soft-paywall.test.tsx`

- [ ] **Step 4.1: 写失败测试**（tests/notice-strip.test.tsx，参照 soft-paywall.test.tsx 的 mock 模式）

```tsx
// NoticeStrip — the single 26px hint row consolidating the three legacy
// banners. Priority: trial-grace > soft-paywall > referral. One notice at
// a time; the ✕ dismisses THAT notice for 24h (per-type localStorage
// timestamp) and the next-priority notice may take its place.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

const mockShouldShowBanner = vi.fn();
const mockMarkShown = vi.fn();
const mockMarkDismissed = vi.fn();
const mockIsTrialEligible = vi.fn();
const mockCopyReferralLink = vi.fn();
const mockTrack = vi.fn();
const mockMaybeReportTrialGraceBanner = vi.fn();

vi.mock('../shared/paywall-state', () => ({
  shouldShowBanner: mockShouldShowBanner,
  markShown: mockMarkShown,
  markDismissed: mockMarkDismissed,
}));
vi.mock('../shared/trial', () => ({
  isTrialEligible: mockIsTrialEligible,
  maybeReportTrialGraceBanner: mockMaybeReportTrialGraceBanner,
}));
vi.mock('../shared/referral', () => ({ copyReferralLink: mockCopyReferralLink }));
vi.mock('../shared/telemetry', () => ({ track: mockTrack }));
vi.mock('../sidepanel/ui', () => ({ showToast: vi.fn() }));

import { NoticeStrip } from '../sidepanel/components/NoticeStrip';
import { state } from '../sidepanel/state';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.isProUser = false;
  state.inTrialGracePeriod = false;
  state.trialGraceDaysRemaining = 0;
  state.proUpgradeModalState = { open: false, errorText: '' };
  mockShouldShowBanner.mockResolvedValue(false);
  mockIsTrialEligible.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('NoticeStrip — priority & rendering', () => {
  it('renders nothing for Pro users even when every source is eligible', async () => {
    state.isProUser = true;
    state.inTrialGracePeriod = true;
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(mockShouldShowBanner).toHaveBeenCalled());
    expect(container.querySelector('.notice-strip')).toBeNull();
  });

  it('trial-grace wins over soft-paywall and referral', async () => {
    state.inTrialGracePeriod = true;
    state.trialGraceDaysRemaining = 2;
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--trial-grace')).toBeTruthy());
    expect(container.querySelector('.notice-strip--paywall')).toBeNull();
    expect(container.querySelector('.notice-strip--referral')).toBeNull();
  });

  it('soft-paywall shows when grace inactive but banner eligible', async () => {
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('#soft-paywall-banner')).toBeTruthy());
    expect(mockMarkShown).toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith('soft_paywall_shown');
  });

  it('referral is the fallback when neither grace nor paywall applies', async () => {
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--referral')).toBeTruthy());
  });
});

describe('NoticeStrip — 24h per-type dismiss', () => {
  it('✕ writes a per-type timestamp and the notice disappears immediately', async () => {
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('#btn-soft-paywall-close')).toBeTruthy());
    fireEvent.click(container.querySelector('#btn-soft-paywall-close')!);
    await waitFor(() => expect(container.querySelector('.notice-strip')).toBeNull());
    expect(localStorage.getItem('notice_dismissed_paywall')).toBeTruthy();
    expect(mockMarkDismissed).toHaveBeenCalled();
  });

  it('a dismissed notice stays hidden for 24h (timestamp in the future)', async () => {
    localStorage.setItem('notice_dismissed_paywall', String(Date.now() + 23 * 3600 * 1000));
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.notice-strip--paywall')).toBeNull();
  });

  it('an expired dismissal (older than 24h) lets the notice return', async () => {
    localStorage.setItem('notice_dismissed_paywall', String(Date.now() - 25 * 3600 * 1000));
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--paywall')).toBeTruthy());
  });
});

describe('NoticeStrip — CTAs keep their legacy ids & telemetry', () => {
  it('paywall try CTA keeps #btn-soft-paywall-try and opens the upgrade modal', async () => {
    mockShouldShowBanner.mockResolvedValue(true);
    mockIsTrialEligible.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('#btn-soft-paywall-try')).toBeTruthy());
    fireEvent.click(container.querySelector('#btn-soft-paywall-try')!);
    expect(state.proUpgradeModalState.open).toBe(true);
    expect(mockTrack).toHaveBeenCalledWith('soft_paywall_cta_clicked', {
      action: 'trial',
    });
  });

  it('referral copy CTA copies and toasts', async () => {
    mockCopyReferralLink.mockResolvedValue(undefined);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--referral')).toBeTruthy());
    fireEvent.click(container.querySelector('.notice-strip-cta')!);
    await waitFor(() => expect(mockCopyReferralLink).toHaveBeenCalled());
  });
});
```

- [ ] **Step 4.2: 运行确认失败**

Run: `npx vitest run tests/notice-strip.test.tsx`
Expected: FAIL — Cannot resolve '../sidepanel/components/NoticeStrip'

- [ ] **Step 4.3: 实现 NoticeStrip.tsx**

```tsx
// NoticeStrip — the single 26px hint row at the top of the sidepanel (v1.2
// redesign). Consolidates three legacy banners into ONE always-26px slot:
//
//   priority 1: trial-grace  (post-expiry conversion window — time-boxed)
//   priority 2: soft-paywall (download-threshold upsell)
//   priority 3: referral     (share-to-earn growth)
//
// Only the highest-priority ELIGIBLE notice renders; the others wait.
// The ✕ dismisses THAT notice for 24h (per-type localStorage timestamp) —
// the next-priority notice may take the row on the next eligibility check.
// Pro users see nothing.
//
// Legacy DOM ids kept for tests & continuity:
//   #soft-paywall-banner, #btn-soft-paywall-try, #btn-soft-paywall-close.
// The old "Maybe later" button is gone — the ✕ is the dismissal path now.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { markDismissed, markShown, shouldShowBanner } from '../../shared/paywall-state';
import { isTrialEligible, maybeReportTrialGraceBanner } from '../../shared/trial';
import { state } from '../state';
import { showToast } from '../ui';
import { useStoreSelector } from './storeHook';

/** Which source currently owns the strip. */
type NoticeKind = 'trial-grace' | 'paywall' | 'referral';

const DISMISS_MS = 24 * 60 * 60 * 1000; // 24h
const dismissKey = (kind: NoticeKind) => `notice_dismissed_${kind.replace('-', '_')}`;

function isDismissed(kind: NoticeKind): boolean {
  try {
    const raw = localStorage.getItem(dismissKey(kind));
    if (!raw) return false;
    return Date.now() - parseInt(raw, 10) < DISMISS_MS;
  } catch {
    return false;
  }
}

/** 12px inline stroke icon — check-circle for grace, gift for referral. */
function StripIcon({ kind }: { kind: NoticeKind }) {
  if (kind === 'trial-grace') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (kind === 'paywall') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

export function NoticeStrip() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const inGrace = useStoreSelector((s) => s.inTrialGracePeriod);
  const daysLeft = useStoreSelector((s) => s.trialGraceDaysRemaining);
  useStoreSelector((s) => s.localeTick); // re-render on locale switch

  const [paywallEligible, setPaywallEligible] = useState(false);
  const [trialEligible, setTrialEligible] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Paywall eligibility is a one-shot async decision at panel-open time
  // (chrome.storage round-trips) — same contract as the legacy banner.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (state.isProUser) return;
      if (!(await shouldShowBanner())) return;
      const eligible = await isTrialEligible();
      if (cancelled) return;
      setTrialEligible(eligible);
      setPaywallEligible(true);
      await markShown();
      void track(EVENTS.SOFT_PAYWALL_SHOWN);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Grace impression telemetry (once/day/install throttle inside helper).
  useEffect(() => {
    if (!inGrace) return;
    void maybeReportTrialGraceBanner(daysLeft);
  }, [inGrace, daysLeft]);

  // Priority resolution — first eligible & un-dismissed notice wins.
  let kind: NoticeKind | null = null;
  if (!isPro) {
    if (inGrace && !isDismissed('trial-grace')) kind = 'trial-grace';
    else if (paywallEligible && !isDismissed('paywall')) kind = 'paywall';
    else if (!isDismissed('referral')) kind = 'referral';
  }

  const handleDismiss = useCallback(() => {
    if (!kind) return;
    try {
      localStorage.setItem(dismissKey(kind), String(Date.now()));
    } catch {
      /* non-fatal */
    }
    if (kind === 'paywall') {
      void markDismissed();
      void track(EVENTS.SOFT_PAYWALL_DISMISSED, { action: 'close' });
    }
    setHidden(true);
  }, [kind]);

  const handleGraceUpgrade = () => {
    void track(EVENTS.TRIAL_GRACE_CTA_CLICKED);
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  const handlePaywallTry = () => {
    void track(EVENTS.SOFT_PAYWALL_CTA_CLICKED, { action: 'trial' });
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  const handleReferralCopy = async () => {
    const { copyReferralLink } = await import('../../shared/referral');
    await copyReferralLink();
    showToast(t('referral_link_copied'), 'success');
  };

  if (!kind || hidden) return null;

  const ctaKey =
    kind === 'trial-grace'
      ? 'trial_grace_upgrade_btn'
      : kind === 'paywall'
        ? trialEligible
          ? 'paywall_banner_try_cta'
          : 'paywall_banner_upgrade_cta'
        : 'referral_banner_copy';
  const textKey =
    kind === 'trial-grace'
      ? 'trial_grace_message'
      : kind === 'paywall'
        ? 'paywall_banner_title'
        : 'referral_banner_text';

  return (
    <div
      class={`notice-strip notice-strip--${kind}${kind === 'paywall' ? '' : ''}`}
      id={kind === 'paywall' ? 'soft-paywall-banner' : undefined}
      role="region"
    >
      <StripIcon kind={kind} />
      <span class="notice-strip-text">
        {t(textKey, kind === 'trial-grace' ? { days: String(daysLeft) } : undefined)}
      </span>
      <button
        type="button"
        class="btn btn-primary btn-sm notice-strip-cta"
        id={kind === 'paywall' ? 'btn-soft-paywall-try' : undefined}
        onClick={
          kind === 'trial-grace'
            ? handleGraceUpgrade
            : kind === 'paywall'
              ? handlePaywallTry
              : () => void handleReferralCopy()
        }
      >
        {t(ctaKey)}
      </button>
      <button
        type="button"
        class="notice-strip-close icon-btn"
        id={kind === 'paywall' ? 'btn-soft-paywall-close' : undefined}
        title={t('common_dismiss')}
        aria-label={t('common_dismiss')}
        onClick={handleDismiss}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 4.4: 运行 NoticeStrip 测试至全绿**

Run: `npx vitest run tests/notice-strip.test.tsx`
Expected: PASS 8/8

- [ ] **Step 4.5: HTML 换 slot**（\_shared-body.html L18-24：两个旧 banner mount 换成一个）

```html
<div id="app">
  <!-- Notice strip (v1.2): the single 26px hint row consolidating
             trial-grace / soft-paywall / referral banners. The Preact
             component short-circuits to null when nothing is eligible. -->
  <div id="notice-strip-mount" data-preact-mount="notice-strip-mount"></div>
</div>
```

- [ ] **Step 4.6: mount.tsx 换挂载**（删除 mountSoftPaywallBanner/mountTrialGraceBanner/mountReferralBanner 三个函数及其调用、三个组件 import；新增）

```tsx
function mountNoticeStrip(): void {
  const slot = document.getElementById('notice-strip-mount');
  if (!slot) return;
  renderSafe(<NoticeStrip />, slot, 'notice-strip-mount');
}
```

（mountPreactComponents 内三个旧调用替换为 `mountNoticeStrip();`；import 区删除 ReferralBanner/SoftPaywallBanner/TrialGraceBanner，加 NoticeStrip）

- [ ] **Step 4.7: 删除三个旧组件文件 + 迁移测试**

```bash
git rm sidepanel/components/ReferralBanner.tsx sidepanel/components/SoftPaywallBanner.tsx sidepanel/components/TrialGraceBanner.tsx tests/trial-grace-banner.test.tsx
```

- tests/soft-paywall.test.tsx：将 `import { SoftPaywallBanner } from '../sidepanel/components/SoftPaywallBanner'` 换为 `import { NoticeStrip } from '../sidepanel/components/NoticeStrip'`，render 调用同步替换；断言中 `.maybe later` 相关用例改为 ✕ 关闭路径（action:'close'）。实施时逐用例核对。
- grep 残留引用：

```bash
grep -rn "ReferralBanner\|SoftPaywallBanner\|TrialGraceBanner\|soft-paywall-banner-mount\|trial-grace-banner-mount\|referral-banner-mount" sidepanel/ tests/ pages/ e2e/ --include="*.ts" --include="*.tsx" --include="*.html"
```

Expected: 0 命中（或仅注释）

- [ ] **Step 4.8: 全量 vitest 回归**

Run: `npx vitest run 2>&1 | tail -8`
Expected: 全绿（含迁移后的 soft-paywall.test.tsx）

- [ ] **Step 4.9: Commit**

```bash
git add -A
git commit  # feat: NoticeStrip 26px 提示槽合并三 banner（优先级 + 24h per-type dismiss）
```

---

## Task 5: command bar 布局 + GalleryResolveBar 内联化

**Files:**

- Modify: `pages/_shared-body.html:25-313`（Row1+Row2 合并）、`:636-640`（resolve mount 挪位）、筛选行收编 sort/group
- Modify: `sidepanel/components/GalleryResolveBar.tsx`（DOM 结构内联段化）
- Modify: `sidepanel/components/mount.tsx:297-306`（mountGalleryResolveBar 不变，slot 在 HTML 里挪）
- Create: `css/command-bar.css`（新文件，vite.config 的 css 入口引用方式按 toolbar.css 现状追加——先查 sidepanel.html 的 link 清单）
- Modify: `css/toolbar.css`（旧两行的类高度收紧）
- Test: `e2e/gallery-resolve.e2e.ts`

- [ ] **Step 5.1: HTML 合并 Row1+Row2**（\_shared-body.html；把 `toolbar toolbar-actions`（L26-165）与 `toolbar toolbar-select-row`（L168-313）替换为单个 command bar；内容全保留、顺序 = pro-status → live → select-all → found-info（含 rescan）→ resolve slot → collection → multitab → settings）

```html
<!-- Command bar (v1.2): one 38px row merging the legacy action row
             (pro badge + icons) and the select/scan row. The gallery-resolve
             inline slot renders the deep-link resolve action here when a scan
             found candidates. -->
<div id="command-bar" class="toolbar command-bar">
  <div id="pro-status-area" class="pro-status-area">
    <!-- …原 L28-92 的 pro-status 内容原样保留（free/active 两态）… -->
  </div>
  <span
    id="live-indicator"
    class="live-indicator hidden"
    title="…"
    data-i18n-title="live_indicator_tooltip"
  >
    <span class="live-dot"></span>Live
  </span>
  <button
    id="btn-select-all"
    class="select-all-btn"
    title="Select all"
    data-i18n-title="toolbar_select_all"
  >
    <!-- …原 L174-189 select-all 内容原样… -->
  </button>
  <div class="toolbar-found-info">
    <!-- …原 L190-217 rescan + found-info + similar-inline 原样… -->
  </div>
  <!-- Gallery resolve inline slot (v1.2): was a standalone 48px bar
               below the filters; now renders inline in the command bar. -->
  <span id="gallery-resolve-bar-mount" data-preact-mount="gallery-resolve-bar-mount"></span>
  <span class="icon-btn-wrapper">
    <!-- …原 btn-collection… -->
  </span>
  <span class="icon-btn-wrapper">
    <!-- …原 btn-multitab + pro-badge… -->
  </span>
  <button id="btn-settings" class="icon-btn" …>
    <!-- …原 settings… -->
  </button>
</div>
```

（实施时用「原样保留」注释处的真实 HTML 填入——内容全部来自现有 L26-313，不改任何 id/data-i18n/aria。）

同时：**sort/group 两个 filter-btn + 两个 filter-dropdown + #group-mode hidden select** 从原 Row2 的 `filter-actions-right` 挪进 `toolbar-filters` 行的 `.filter-buttons` 尾部（visible-toggle 之前）；原 L640 的 `gallery-resolve-bar-mount` div 删除（已挪入 command bar）。

- [ ] **Step 5.2: GalleryResolveBar 组件结构内联化**（返回 JSX 改为紧凑段 + 绝对锚定面板；类名/id 全保留）

```tsx
return (
  <div
    id="gallery-resolve-bar"
    class="gallery-resolve-bar gallery-resolve-bar--inline"
    role="region"
  >
    <button
      type="button"
      class="gallery-resolve-bar-toggle"
      aria-expanded={expanded}
      aria-controls="gallery-resolve-collapse"
      title={t('gallery_resolve_toggle_title')}
      onClick={() => setExpanded(!expanded)}
    >
      <span class={`gallery-resolve-caret${expanded ? ' open' : ''}`}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </span>
      {t('gallery_resolve_bar_title', { count: galleryCount })}
    </button>
    <button
      id="btn-gallery-resolve"
      type="button"
      class="btn btn-primary btn-sm"
      disabled={isResolving}
      onClick={() => void handleResolveClick()}
    >
      {t('gallery_resolve_action')}
    </button>
    {/* The list drops down from the command bar — absolutely anchored to
          this inline segment so it overlays the filter row instead of
          pushing the grid down. Same 0fr↔1fr collapse animation, `inert`
          keeps collapsed links out of the tab order. */}
    <div
      id="gallery-resolve-collapse"
      class={`gallery-resolve-collapse${expanded ? ' open' : ''}`}
      inert={!expanded}
      aria-hidden={!expanded}
    >
      <ul class="gallery-resolve-links">
        {/* …shownLinks.map 原样保留（含 dot/is-resolved/is-failed/链接）… */}
        {/* …hiddenCount more 行原样… */}
      </ul>
    </div>
  </div>
);
```

（`.gallery-resolve-hint` 的 `<p>` 删除——文案并入 `gallery_resolve_toggle_title` 的 tooltip。）

- [ ] **Step 5.3: 新 CSS**（css/command-bar.css 全文）

```css
/* ============================================
   Command bar & notice strip (v1.2 redesign)
   — one 38px action row + one 26px hint row
   ============================================ */

/* Notice strip: 26px, single line, subtle background differentiation */
.notice-strip {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  min-height: 26px;
  padding: 0 var(--space-3, 12px);
  font-size: var(--font-aux, 11px);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.notice-strip svg {
  color: var(--primary-color);
  flex-shrink: 0;
}

.notice-strip-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice-strip-cta {
  flex-shrink: 0;
  height: 20px;
  padding: 0 var(--space-2, 8px);
  font-size: var(--font-caption, 10px);
  line-height: 1;
}

.notice-strip-close {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.notice-strip-close:hover {
  color: var(--text-primary);
}

/* Trial-grace variant: amber tint, time-boxed conversion window */
.notice-strip--trial-grace {
  color: var(--amber-text-dark, #665200);
  background: #fffbeb;
}
:root[data-theme='dark'] .notice-strip--trial-grace,
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) .notice-strip--trial-grace {
    background: rgba(251, 191, 36, 0.08);
  }
}

/* Command bar: single 38px row */
.command-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  min-height: 38px;
  padding: 0 var(--space-3, 12px);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-color);
  flex-shrink: 0;
  overflow: visible; /* the resolve dropdown anchors below */
  min-width: 0;
}

.command-bar .pro-status-area {
  margin-right: auto; /* pushes everything else to the right */
}

.command-bar .select-all-btn {
  flex-shrink: 0;
}

.command-bar .toolbar-found-info {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  min-width: 0;
  flex-shrink: 1;
}

/* Gallery resolve inline segment: compact, sits in the command bar flow */
.gallery-resolve-bar--inline {
  position: relative; /* anchors the dropdown */
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  flex-shrink: 0;
}

.gallery-resolve-bar--inline .gallery-resolve-bar-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  font-size: var(--font-aux, 11px);
  color: var(--primary-color);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}

.gallery-resolve-bar--inline .gallery-resolve-caret {
  display: inline-flex;
  transition: transform var(--duration-fast, 150ms) var(--ease-out, ease);
}

.gallery-resolve-bar--inline .gallery-resolve-caret.open {
  transform: rotate(90deg);
}

/* Anchored dropdown: overlays the filter row instead of pushing the grid */
.gallery-resolve-bar--inline .gallery-resolve-collapse {
  position: absolute;
  top: calc(100% + 6px);
  left: -12px; /* align to the command bar's content box edge */
  width: max(280px, 100vw - 48px);
  max-width: calc(100vw - 48px);
  z-index: 40;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-base, 200ms) var(--ease-out, ease);
}

.gallery-resolve-bar--inline .gallery-resolve-collapse.open {
  grid-template-rows: 1fr;
}

.gallery-resolve-bar--inline .gallery-resolve-collapse > * {
  overflow: hidden;
  min-height: 0;
}

.gallery-resolve-links {
  margin: 0;
  padding: var(--space-2, 8px) 0;
  list-style: none;
}

.gallery-resolve-links li {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: 2px var(--space-3, 12px);
  font-size: var(--font-caption, 10px);
}

.gallery-resolve-links a {
  color: var(--text-secondary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-resolve-links a:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

.gallery-resolve-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex-shrink: 0;
}

.gallery-resolve-dot.is-resolved {
  background: var(--success-color);
}

.gallery-resolve-dot.is-failed {
  background: var(--error-color);
}

.gallery-resolve-links-more {
  color: var(--text-tertiary);
}
```

（CSS 入口：查 sidepanel.html `<link>` 或 vite htmlInclude 的 css 列表，将 `css/command-bar.css` 按现有 toolbar.css 同样方式引入。实施时核对。）

- [ ] **Step 5.4: 旧 CSS 收紧**（css/toolbar.css：`.toolbar-actions`、`.toolbar-select-row` 相关规则合并语义由 `.command-bar` 接管；保留 `.toolbar-filters` 但高度统一 34px——`.toolbar-filters { min-height: 34px; }`，`.filter-btn` 的 padding/字号按 token 收紧：`padding: 4px 8px; font-size: 11px;`。具体行实施时按 toolbar.css 现有规则调整，不动 DOM 结构。）

- [ ] **Step 5.5: vitest 回归 + 组件测试**

Run: `npx vitest run tests/sidepanel-link-resolve-quota-ui.test.tsx tests/sidepanel-init.test.tsx tests/sidepanel-ui.test.tsx tests/sidepanel-render.test.tsx 2>&1 | tail -5`
Expected: PASS（GalleryResolveBar 的 DOM 断言若引用 `.gallery-resolve-hint` 需同步删除断言）

- [ ] **Step 5.6: e2e 更新 + 跑 gallery-resolve**

Run: `npx playwright test e2e/gallery-resolve.e2e.ts 2>&1 | tail -5`
Expected: PASS（类名全保留；若 `#gallery-resolve-bar` 位置断言失败，检查 mount slot 是否正确渲染进 command bar）
预期断言点微调：`.gallery-resolve-bar-toggle` 点击展开后 `.gallery-resolve-links` 可见性——绝对定位不改变 hidden 语义。

- [ ] **Step 5.7: 布局快检**

Run: `npm run build 2>&1 | tail -3`
Expected: 构建通过；人工核对 dist 里 sidepanel.html 含 `id="command-bar"` 与 `id="notice-strip-mount"`。

- [ ] **Step 5.8: Commit**

```bash
git add pages/_shared-body.html css/ sidepanel/components/ e2e/ tests/
git commit  # feat: command bar 38px 合并两行 + 解析内联段（~130px 见第一张图）
```

---

## Task 6: ProUpgradeModal 信息架构重排

**Files:**

- Modify: `sidepanel/components/ProUpgradeModal.tsx:186-303`（render 段重排）+ `:345-363`（FEATURE_ICONS SVG 化）+ `:305-557`（列表精简 4 行）
- Modify: `css/modals.css`（pro-upgrade 段重写）
- Modify: `tests/sidepanel-pro-upgrade-modal.test.tsx`
- Modify: `_locales/*/messages.json`（1 个新 key）

- [ ] **Step 6.1: 新 i18n key**

Run:

```bash
node scripts/add-i18n-key.js pro_key_fold_summary '{"en":"Already have a license? Enter activation code","zh_CN":"已有许可证？输入激活码","zh_TW":"已有授權授權碼？輸入啟用碼","ja":"すでにライセンスをお持ちですか？アクティベーションコードを入力","ko":"이미 라이선스가 있으신가요? 활성화 코드 입력","de":"Bereits eine Lizenz? Aktivierungscode eingeben","fr":"Déjà une licence ? Saisir le code d'\''activation","es":"¿Ya tienes una licencia? Introduce el código de activación","it":"Hai già una licenza? Inserisci il codice di attivazione","pt":"Já tem uma licença? Insira o código de ativação","ru":"Уже есть лицензия? Введите код активации","nl":"Al een licentie? Voer activatiecode in","ar":"لديك ترخيص بالفعل؟ أدخل رمز التنشيط","hi":"पहले से लाइसेंस है? एक्टिवेशन कोड दर्ज करें","th":"มีใบอนุญาตอยู่แล้ว? ป้อนรหัสการเปิดใช้งาน"}'
```

- [ ] **Step 6.2: 写失败测试**（sidepanel-pro-upgrade-modal.test.tsx 新增 describe；沿用该文件 openModal helper）

```tsx
describe('v1.2 IA redesign', () => {
  it('key input lives inside a collapsed <details> at the bottom', async () => {
    await openModal();
    const details = document.querySelector('.pro-key-fold');
    expect(details).toBeTruthy();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(details!.querySelector('#pro-modal-key-input')).toBeTruthy();
    expect(details!.querySelector('#btn-pro-modal-activate')).toBeTruthy();
    expect(details!.querySelector('#pro-modal-error')).toBeTruthy();
  });

  it('pricing CTA stays visible when trial NOT eligible and becomes primary', async () => {
    // isTrialEligible mock 返回 false（顶部 vi.mock 的 shared/trial）
    (
      vi.mocked(await import('../shared/trial')).isTrialEligible as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);
    await openModal();
    const pricing = document.querySelector('#btn-pro-modal-pricing');
    expect(pricing).toBeTruthy();
    expect(pricing!.className).toContain('btn-primary');
    // …and the trial CTA is absent
    expect(document.querySelector('#btn-pro-modal-trial')).toBeNull();
  });

  it('compare list shows exactly the 4 core rows (not 17)', async () => {
    await openModal();
    expect(document.querySelectorAll('.pro-fc-card').length).toBe(4);
  });

  it('no emoji icons remain in the feature list', async () => {
    await openModal();
    const icons = Array.from(document.querySelectorAll('.pro-fc-icon'));
    expect(icons.length).toBeGreaterThan(0);
    for (const el of icons) {
      expect(el.querySelector('svg')).toBeTruthy(); // SVG, not text emoji
    }
  });
});
```

- [ ] **Step 6.3: 运行确认失败**

Run: `npx vitest run tests/sidepanel-pro-upgrade-modal.test.tsx`
Expected: FAIL —`.pro-key-fold` 不存在、CTA 常驻断言失败（现状 trialEligible=false 整块消失）

- [ ] **Step 6.4: 重排组件 render**（ProUpgradeModal.tsx 的 modal-body 整段替换为）

```tsx
<div class="modal-body">
  {/* ── Hero CTA (always present — v1.2 fix: the modal previously
               lost its only CTA for trial-ineligible users) ─────────── */}
  <div class="pro-upgrade-cta-section">
    <div class="pro-upgrade-trial-header">
      <p class="pro-upgrade-sub">{t('pro_trial_desc')}</p>
    </div>
    <div class="pro-upgrade-cta-row">
      {trialEligible ? (
        <button
          id="btn-pro-modal-trial"
          type="button"
          class="btn btn-primary btn-cta"
          disabled={trialLoading}
          onClick={() => {
            void handleStartTrial(setTrialError, setTrialLoading);
          }}
        >
          {trialLoading ? t('pro_trial_starting') : t('pro_trial_start_cta')}
        </button>
      ) : (
        <button
          id="btn-pro-modal-pricing"
          type="button"
          class="btn btn-primary btn-cta"
          onClick={handlePricingClick}
        >
          {t('paywall_banner_upgrade_cta')}
        </button>
      )}
      {trialEligible && (
        <button
          id="btn-pro-modal-pricing"
          type="button"
          class="btn btn-cta btn-secondary"
          onClick={handlePricingClick}
        >
          {t('pro_pricing_cta')}
        </button>
      )}
    </div>
    <p class="pro-upgrade-assurance">
      {t('pro_trial_perk_no_card')} · {t('pro_trial_perk_cancel')}
    </p>
    <p id="pro-modal-trial-error" class={`license-error${trialError ? '' : ' hidden'}`}>
      {trialError}
    </p>
  </div>

  {/* ── Core comparison — 4 rows, full list lives on the pricing page ── */}
  <ProFeatureCompareList />

  {/* ── License key activation — folded to the bottom (v1.2: the
               input no longer occupies the above-the-fold area) ───────── */}
  <details class="pro-key-fold">
    <summary>{t('pro_key_fold_summary')}</summary>
    <div class="pro-upgrade-input-section">
      <div class="license-input-row">
        <input
          type="text"
          id="pro-modal-key-input"
          class="license-input"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          maxlength={19}
          spellcheck={false}
          autocomplete="off"
        />
        <button id="btn-pro-modal-activate" class="btn btn-primary btn-sm">
          {t('pro_activate')}
        </button>
      </div>
      <p id="pro-modal-error" class={`license-error${ms.errorText ? '' : ' hidden'}`}>
        {ms.errorText}
      </p>
      <p class="pro-upgrade-get-pro-hint">
        {t('pro_no_key_hint')}{' '}
        <a id="link-pro-modal-get" href="#" class="license-link" onClick={handlePricingClick}>
          {t('pro_get_pro_link')}
        </a>
      </p>
    </div>
  </details>
</div>
```

要点：headline（modal-header 的 h2 + variantHeadline）不动；emoji `🎁` badge 删除（pro_trial_badge 不再渲染或移进 summary——测试没引用，删除）；`#link-pro-modal-get` 在 details 内（license-ui.ts 只 getElementById，位置无关，折叠时仍可绑定）。

- [ ] **Step 6.5: FEATURE_ICONS 重写为 SVG + 列表精简 4 行**（FEATURE_ICONS 换为 4 项；ProFeatureCompareList 的 fallback 卡片从 10 张减到 4 张：批量下载 zipDownload、图库解析 linkResolve、Eagle 导出 eagleExport、颜色提取 colorCopy；remote copy 路径按 `featureOrder.filter` 只取这 4 个 key）

```tsx
// Lucide-style stroke icons for the 4 core comparison rows (v1.2: emoji
// icons are gone — single-color currentColor SVGs only).
const FEATURE_ICONS: Record<string, { icon: VNode; gradient: string }> = {
  zipDownload: {
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 8v13H3V8" />
        <path d="M1 3h22v5H1z" />
        <path d="M10 12h4" />
      </svg>
    ),
    gradient: 'gradient-blue',
  },
  linkResolve: {
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    gradient: 'gradient-green',
  },
  eagleExport: {
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    gradient: 'gradient-amber',
  },
  colorCopy: {
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="13.5" cy="6.5" r="2.5" />
        <circle cx="19" cy="13" r="2.5" />
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="10" cy="19" r="2.5" />
        <path d="M12 22a10 10 0 1 1 10-10c0 4-3 6-6 6h-2a2 2 0 0 0-2 2c0 1-.5 2-2 2z" opacity="0" />
      </svg>
    ),
    gradient: 'gradient-pink',
  },
};
```

（`FeatureCompareCard` 的 icon prop 类型从 `string` 改为 `VNode`；`import type { VNode } from 'preact'`。remote copy 路径：`const CORE_KEYS = ['zipDownload', 'linkResolve', 'eagleExport', 'colorCopy'];` → `featureOrder.filter(k => CORE_KEYS.includes(k))`，其中 linkResolve 的 label 用 `pro_feature_link_resolve_title` 既有 key（若无则用 t('feature_link_resolve')——实施时查 en messages.json 确认现成 key，缺失则用 add-i18n-key.js 补 `pro_feature_link_resolve_title`）。）

- [ ] **Step 6.6: CSS 重写**（css/modals.css 的 pro-upgrade 段；按文件内现有 pro-upgrade-\* 类名逐个更新——核心增量）

```css
/* v1.2: key activation folded at the bottom */
.pro-key-fold {
  margin-top: var(--space-3, 12px);
  border-top: 1px solid var(--border-color);
  padding-top: var(--space-2, 8px);
}

.pro-key-fold summary {
  font-size: var(--font-aux, 11px);
  color: var(--text-secondary);
  cursor: pointer;
  padding: var(--space-1, 4px) 0;
  list-style: none;
}

.pro-key-fold summary:hover {
  color: var(--text-primary);
}

.pro-key-fold .pro-upgrade-input-section {
  padding-top: var(--space-2, 8px);
}

/* The one elevated surface in the redesign: the hero CTA */
.pro-upgrade-cta-section .btn-cta.btn-primary {
  box-shadow: var(--cta-shadow, 0 1px 2px rgba(15, 23, 42, 0.06));
}

.pro-upgrade-assurance {
  margin: var(--space-1, 4px) 0 0;
  font-size: var(--font-caption, 10px);
  color: var(--text-tertiary);
  text-align: center;
}

.pro-upgrade-sub {
  font-size: var(--font-body, 12.5px);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2, 8px);
}
```

- [ ] **Step 6.7: 运行 modal 测试至全绿 + 修旧断言**

Run: `npx vitest run tests/sidepanel-pro-upgrade-modal.test.tsx 2>&1 | tail -10`
Expected: PASS；旧断言引用旧结构（如「Section 1 在顶部」「🎁 badge」）按新 IA 更新——逐条核对 413 行里的断言与 mock。

- [ ] **Step 6.8: 全量 vitest**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 全绿

- [ ] **Step 6.9: Commit**

```bash
git add sidepanel/components/ProUpgradeModal.tsx css/modals.css tests/ _locales/ scripts/
git commit  # feat: Pro 弹窗 IA 重排（CTA 常驻 + key 折叠 + 4 行对比 + SVG 图标）
```

---

## Task 7: P1 — token 统一刷新 + emoji 清零 + 暗色核对

**Files:** `css/*.css`（按规则批量）+ 全库 emoji 扫尾

- [ ] **Step 7.1: 硬编码值 token 化**（规则驱动的批量替换，每文件替换后跑 build 验证）

替换规则表（组件 CSS 内裸值 → token）：

| 旧模式                                    | 新值                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `padding: 10px` / `gap: 10px` 等非 8 倍数 | 就近取 8/12（`--space-2`/`--space-3`）           |
| `border-radius: 4px`（按钮/chip）         | `var(--radius-sm)` 保留，新组件用 `--radius-md`  |
| `border-radius: 16px`+ / `50%` 圆弹窗     | `var(--radius-modal)`（弹窗）/ 保留 50%（圆点）  |
| `box-shadow: …`（非 CTA/下拉浮层）        | 删除（1px 边框分层）；下拉/浮层保留功能性阴影    |
| `font-size: 9px` / `10px` 正文            | `var(--font-caption)` / `var(--font-aux)`        |
| 裸 hex 灰色（#9ca3af/#94a3b8 类）         | `var(--text-secondary)` / `var(--text-tertiary)` |
| `transition: all 0.3s`                    | `all var(--duration-base)`                       |

执行方式（每个 css 文件一轮）：

```bash
# 例：states.css——先看命中面
grep -n "box-shadow\|font-size: 9px\|font-size: 10px\|0\.3s\|#94a3b8\|#9ca3af" css/states.css | head -20
```

逐处按表替换（SearchReplace），完成后 `npm run build` 验证。8 个 css 文件按 base→cards→modals→license→settings→states→toolbar→variables 顺序过一遍。**不做与规则无关的重构**。

- [ ] **Step 7.2: emoji 清零验证**

Run:

```bash
grep -rn "🎁\|📦\|📋\|🗑️\|⭐\|📁\|🏷️\|✨\|🖥️\|🧹\|🔄\|📡\|🔍\|🦅\|🎨\|📝\|📊\|⚡\|✗\|✓" sidepanel/ pages/ shared/ --include="*.tsx" --include="*.ts" --include="*.html" | grep -v "^\s*//" | grep -v "polyline\|path d=\|test\|\.test\."
```

Expected: 0 命中（ReferralBanner/ProUpgradeModal 已在前面的 task 处理；若有残留——如 welcome.html 的营销位 emoji 文案——保留正文文案里的 emoji 只清「图标位」，逐处判断）

- [ ] **Step 7.3: 暗色对比度核对**

Run: `npm run build && echo "人工核对清单见下"`
核对清单（实施者用 DevTools 手动过一遍或写临时截图脚本）：

1. `.notice-strip--trial-grace` amber 文案在暗底
2. `--text-tertiary`（新 #8b96a5）在暗底 #1a1a1a
3. `.gallery-resolve-links a`（--text-secondary）暗底
4. pro-fc-free/pro-fc-pro badge 暗底
5. 筛选行 filter-btn 暗底
   （任何一处 <4.5:1 则调 token 值重跑）

- [ ] **Step 7.4: Commit**

```bash
git add css/ sidepanel/ pages/
git commit  # feat: P1 token 统一刷新（8 CSS 文件规则化 + emoji 图标清零 + 暗色核对）
```

---

## Task 8: 全量验证 + 视觉验收准备

- [ ] **Step 8.1: 全量 vitest**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 全绿（1670+ 用例含新增）

- [ ] **Step 8.2: eslint**

Run: `npm run lint 2>&1 | tail -5`
Expected: 0 errors（warnings 若为存量则不新增）

- [ ] **Step 8.3: e2e 全量**

Run: `npx playwright test 2>&1 | tail -10`
Expected: 124/124（断言更新后；若有失败逐个修复——布局类断言允许更新选择器，行为断言不得改动）

- [ ] **Step 8.4: build + bundle 预算**

Run: `npm run build 2>&1 | grep -i "size\|error" | head -10`
Expected: 构建通过；sidepanel bundle 不超现有预算（对比 v1.1.6 基线，SVG 内联增量 <2KB）

- [ ] **Step 8.5: format**

Run: `npm run format:check 2>&1 | tail -3`（或项目等价命令——查 package.json scripts）
Expected: 通过

- [ ] **Step 8.6: 视觉验收（用户环节）**

加载 dist 到 chrome://extensions（或项目 README 的加载流程），核对：

1. 免费用户图库页 ~130px 内见第一张图（明/暗两主题）
2. Pro 弹窗：无 trial 资格也有「升级 Pro」实心 CTA；key 输入默认折叠
3. 解析 0 张新增 → info toast、配额不变
4. 提示槽三态切换（grace/paywall/referral）+ ✕ 24h
5. 筛选/排序/分组/视图切换全部可用

- [ ] **Step 8.7: 收尾 commit（若有 fixup）**

```bash
git add -A && git commit  # chore: v1.2 UI 重构收尾（验证全绿）
```

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：§2 token→Task 3；§3.1 提示槽→Task 4；§3.2 command bar+内联→Task 5；§3.3 筛选行（交互不动+埋点）→Task 2+5；§3.4 守卫→Task 1；§4 弹窗→Task 6；§5 P1→Task 7；§6 安全网→各 Task TDD+Task 8；§9 验收→Task 8。无缺口。
2. **Placeholder**：Task 5.1 的「原样保留」注释指向现有 HTML 的明确行号区间（L26-313），非凭空引用；Task 5.4/7.1 为规则驱动批量操作（表 + grep 命令完备）。其余步骤代码完整。
3. **类型一致性**：NoticeStrip 的 `NoticeKind` 与 dismissKey 的 replace('-','\_') 匹配 `notice_dismissed_trial_grace/paywall/referral`；FeatureCompareCard icon prop string→VNode 在 Task 6.5 与调用点同步改；FILTER_APPLIED 在 EVENTS/SCHEMAS/调用三处一致。
