# Deep Scan (Auto-Scroll Extraction) — Design Spec

Date: 2026-09-21 · Target release: **v1.2.0** · Status: Approved by user

## 1. Background & Goal

Competitive gap: Download All Images / Fatkun programmatically scroll the page to
trigger lazy-loaded images before collecting; Image Harvest only scans the current
DOM (+ passive live monitoring). On long lazy-loading pages users perceive
"Image Harvest can't get all images" — the #1 parity gap vs free competitors.

Goal: a user-triggered **Deep Scan** that auto-scrolls the page, incrementally
collects newly loaded images, then runs the authoritative full extraction —
with free daily quota and Pro unlimited.

Approved decisions (from brainstorming):

- Trigger: **dedicated toolbar button** (not a default-on setting, not a prompt).
- Entitlement: **free daily quota (default 3/day, remotely configurable) + Pro unlimited**.
- Technical approach: **self-contained scroll controller in the content script** (Plan A).
- Scope: window/main scroll only; inner scrollable containers are out of scope for v1.
- PayPal account-side issues tracked separately, not part of this version.
- Edge Add-ons submission materials ship with this version (docs only).

## 2. UX Design

### 2.1 Trigger

- New SVG icon button "Deep Scan" in the toolbar next to the normal scan button
  (follows the v1.1.7 SVG icon system; no emoji).
- Disabled while any scan is in progress (`isFetching` guard, same as rescan).

### 2.2 Entitlement gate

- New daily-tracked quota feature `deepScan` in `shared/feature-quota.ts`.
- `FREE_LIMITS.MAX_DAILY_DEEP_SCAN = 3`; remote override key `maxDailyDeepScan`
  via the existing `feature_limits` remote config pipeline.
- Pro users bypass the check (`isProUser()`).
- Quota exhausted → existing ProUpgradeModal wall flow with `feature: 'deep_scan'`
  (WALL_COPY contextual copy, per-feature session frequency suppression, pricing
  page URL context carry-over). No new wall machinery.
- Quota is consumed **after a deep scan actually starts scrolling**
  (failed/cancelled-before-scroll attempts do not burn quota), matching the
  "0 new images = no charge" precedent from link resolve.

### 2.3 Progress & cancel

- Reuse the existing scan overlay (`state.scanProgress`): title "Deep scanning",
  shows discovered count as it grows (fed by the existing `IMAGES_DISCOVERED`
  pipeline), cancel button sets `state.scanAborted` (existing mechanism).
- Completion toast: "Found N images" plus "M new from deep scan" when M > 0.
- After finishing, the page is instantly scrolled back to the user's original
  scroll position.

## 3. Technical Design

### 3.1 New module: `content/auto-scroll.ts`

Exports `runDeepScan(options, callbacks): Promise<DeepScanResult>`.

Constants (single `DEEP_SCAN_LIMITS` object, all tunable in one place):

| Constant           | Default | Meaning                                                           |
| ------------------ | ------- | ----------------------------------------------------------------- |
| STEP_RATIO         | 0.9     | fraction of viewport height per scroll step                       |
| STEP_WAIT_MS       | 700     | max wait per step for lazy loads                                  |
| MUTATION_QUIET_MS  | 400     | MutationObserver quiet period that ends a step early              |
| MAX_STEPS          | 40      | hard cap on scroll steps                                          |
| MAX_DURATION_MS    | 45000   | hard cap on total duration                                        |
| MAX_NEW_IMAGES     | 500     | stop early on runaway infinite feeds                              |
| STALL_STEPS        | 3       | consecutive steps with zero new images → stop                     |
| HEIGHT_STALL_STEPS | 2       | consecutive steps without document-height growth at bottom → stop |

Loop:

1. Record `originalScrollY`; run an initial `extractImages()` pass (baseline).
2. `window.scrollBy(0, viewport * STEP_RATIO)`.
3. Wait until `STEP_WAIT_MS` elapses **or** mutations stay quiet for
   `MUTATION_QUIET_MS` (whichever first); live monitor's MutationObserver keeps
   pushing `IMAGES_DISCOVERED` increments during the whole run.
4. Stop when any of: bottom reached AND document height has not grown for
   HEIGHT_STALL_STEPS steps; STALL_STEPS consecutive zero-new-image steps;
   MAX_STEPS; MAX_DURATION_MS; MAX_NEW_IMAGES; aborted.
5. `window.scrollTo({ top: originalScrollY, behavior: 'instant' })`.
6. Run final authoritative `extractImages()` and return
   `{ images, galleryLinks, newCount, steps, durationMs, stopReason }`.

`stopReason` is one of: `'bottom'` (reached page end, height stable) ·
`'stalled'` (no new images for STALL_STEPS steps) · `'maxSteps'` ·
`'maxDuration'` · `'maxImages'` · `'aborted'`.

Interruption handling:

- Page navigation destroys the content script — panel side treats a failed /
  empty response as "aborted", keeps already-discovered images.
- Tab switch: panel side reuses the existing `currentTabId` guards in
  `fetchImages`/`rescanWithProgress` (results discarded for stale tabs).
- User cancel: `CANCEL_DEEP_SCAN` message flips an abort flag checked each step;
  the run stops at the next step boundary and still restores scroll position.

### 3.2 Message protocol

New entries in `MESSAGE_TYPES` (shared/constants.ts):

- `START_DEEP_SCAN` (panel → background → content): `{ tabId, searchAllFrames }`.
- `CANCEL_DEEP_SCAN` (panel → background → content).
- Deep scan reuses the existing `IMAGES_DISCOVERED` content → panel increments;
  no new incremental channel.

Background (`background/extractor.ts` / `index.ts`): route START/CANCEL like the
existing EXTRACT_IMAGES routing; response shape mirrors GET_IMAGES
(`{ success, images, galleryLinks }` plus deep-scan stats).

### 3.3 Panel integration (`sidepanel/scan.ts` + `init.ts` + `pages/sidepanel.html`)

- `deepScan()` alongside `fetchImages`: same guards (`isFetching`, tab locking),
  same merge pipeline (preserveInjectedItems, scanDiscoveredImages merge, AI tag
  restore, tabCache save, `processImageExtras`), plus `newCount` diffing vs the
  pre-scan snapshot for the toast.
- Toolbar button wiring in `init.ts`; HTML in `pages/sidepanel.html`.
- **Popup mode**: the button is shown in popup mode as well (UI consistency).
  If the popup closes mid-scan (it closes on blur by platform design), the scan
  is abandoned: the content-side run is cancelled via the panel-context teardown
  and any late response is dropped. The completion toast simply never shows.
  Side panel mode is the primary surface and is unaffected.

### 3.4 Quota wiring

- `shared/feature-quota.ts`: add `'deepScan'` to `DailyFeature` + `DAILY_FEATURES`;
  extend the daily record init; add `case 'deepScan'` to `getLimit()` returning
  `limits.MAX_DAILY_DEEP_SCAN`.
- `shared/constants.ts`: `FREE_LIMITS.MAX_DAILY_DEEP_SCAN = 3` + remote mapping
  in `getFreeLimits()` (`remote.maxDailyDeepScan`).
- Daily quota display in settings quota list if one exists (verify during
  implementation; `getAllFeatureQuotas()` picks it up automatically).

### 3.5 Telemetry

New events in `shared/telemetry-events.ts` (+ prop whitelist):

- `deep_scan_triggered` — props: `[]` (mode already covered by scan_triggered).
- `deep_scan_completed` — props: `['count', 'newCount', 'steps', 'durationMs', 'stopReason']`.
- `deep_scan_cancelled` — props: `['steps', 'durationMs']`.
- Wall events reuse existing `pro_feature_blocked` / `pro_upsell_shown` with
  `feature: 'deep_scan'` (whitelist already supports `feature`).

**Backend first (v1.1.7 lesson)**: before the extension ships, update
`website/src/lib/telemetry-schema.ts` whitelists for the three new events and
add the `maxDailyDeepScan` key to the feature_limits schema/admin UI; deploy the
website, then release the extension.

### 3.6 i18n

New keys ×15 locales (button aria-label/title, overlay title, completion/cancel
toasts, wall copy for `deep_scan`, quota-exhausted copy). Verify with
`tests/i18n.test.ts` (the shell grep quick-check has false positives — the
Vitest parity test is the source of truth).

### 3.7 Store & docs surface

- CHANGELOG: new `## [1.2.0]` entry (user-facing wording).
- README/README.zh-CN: Features section + Free vs Pro table row
  (Deep scan: free 3/day, Pro unlimited).
- CWS 15-language descriptions: add deep-scan selling point; resubmitted with
  the version review (listing changes ride along, no separate review).
- Version bump: package.json + manifest.config.ts → 1.2.0 (minor: new feature).

## 4. Edge Add-ons materials (docs only)

Create `docs/edge-store/` with a submission checklist:

- Reuse CWS descriptions (start with en + zh_CN), existing screenshots and promo
  assets from `assets/` (note Edge tile size differences if any).
- Privacy policy URL, support URL, category selection.
- Manifest compatibility confirmations (MV3, no Chrome-only APIs in use —
  verify `chrome.sidePanel` support on Edge during checklist finalization).
- Website header/footer: add Edge Add-ons badge next to the CWS badge
  (implementation note; badge asset from Microsoft).
- Actual store submission is performed manually by the owner.

## 5. Testing plan

- Vitest unit:
  - auto-scroll stop conditions (each stop reason) with mocked scroll metrics /
    observer; scroll-position restore; abort mid-run.
  - quota: `deepScan` check/increment/daily reset; Pro bypass; wall trigger at 0.
  - message routing for START/CANCEL_DEEP_SCAN.
  - i18n parity (existing test picks up new keys).
- e2e (Playwright):
  - lazy-load fixture page → deep scan discovers more than initial scan.
  - free user at quota → wall modal with deep_scan copy; Pro → no wall.
  - cancel mid-scan keeps already-discovered images.
- Quality gates before release: `npm run typecheck && npm run lint && npm test`
  - e2e suite + `format:check` + bundle-size check (justify + bump budget if
    needed, per project convention).

## 6. Risks & mitigations

| Risk                                           | Mitigation                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Infinite-feed pages (Pinterest) scroll forever | MAX_STEPS / MAX_DURATION_MS / MAX_NEW_IMAGES caps + stall detection                          |
| Scrolling hijacks user's page view             | Restore original scroll position instantly on finish/abort; cancel button visible throughout |
| Bundle budget overflow                         | Track init/sidepanel sizes; justify + bump budget per convention                             |
| Backend schema lag strips new telemetry props  | Deploy website schema first (hard gate before extension release)                             |
| 15-locale copy drift                           | i18n parity Vitest as source of truth                                                        |

## 7. Out of scope (v1)

- Inner scrollable containers (div-scrolled galleries) — window scroll only.
- Scheduled/auto deep scan without user trigger.
- Video/media detection (separate roadmap item).
- PayPal funnel work (account-side, tracked separately).
