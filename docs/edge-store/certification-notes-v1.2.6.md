# Edge Add-ons 认证说明（Notes for certification）— v1.2.6

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（限额 2,000）。
> 与 v1.2.5 存底相比只改了 WHAT'S NEW 段（onboarding 引导复现路径 + A/B 分组说明）；trial/限额/遥测口径未变。
> 灰框提示「每次提交都必须带 notes，即使之前交过」——每次版本更新都要重新粘贴。

---

Image Harvest is free to use with optional Pro upgrades (7-day trial, paid license). No accounts, no sign-up, and no credentials are required to test any feature — this note explains how to reach every gated area.

TRIAL (Pro access for testers):
The 7-day Pro trial starts AUTOMATICALLY on install — no action, account, or payment needed. Testers have full Pro access immediately after installation. The trial banner in the panel header shows days remaining.

FREE-TIER LIMITS (only apply after a trial expires; listed for completeness, matching our store listing):

- ZIP batch download: up to 30 images per batch (Pro: unlimited)
- Deep Scan: 3 per day (Pro: unlimited)
- Reverse image search: Google + TinEye (Pro: also Baidu + Yandex)
- AI tags: monthly quota (Pro: unlimited)

WHAT'S NEW IN v1.2.6 (test path):

1. Guided first-run tour — reliability fix: after install, the extension opens a welcome page. Roughly half of installs (a random A/B group) are then shown a 3-step guided tour in the side panel on its first open (scan → select → download). Previously, a race with the browser's background shutdown could keep the tour from ever appearing even for tour-assigned installs; this version arms it from the welcome page so it appears reliably. To verify: install the extension, wait for the welcome page, open any image-rich page, open the extension's side panel — if this install was assigned to the tour group, coach marks appear immediately. If you do not see them, the install was randomly assigned to the control group (no tour) — that is by design, not a bug; reinstalling re-rolls the assignment. No other visible changes in this version.

TELEMETRY DISCLOSURE:
The extension sends anonymous, aggregate usage counters (event names and counts only — no URLs, no page content, no personal data) to our own endpoint to help us find bugs. This is ON by default and can be turned OFF at any time in Settings via the "Help improve Image Harvest" toggle.

No dependencies on other products. Privacy policy: https://image-harvest.kyriewen.cn/privacy
