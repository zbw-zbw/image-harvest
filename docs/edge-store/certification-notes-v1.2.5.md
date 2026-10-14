# Edge Add-ons 认证说明（Notes for certification）— v1.2.5

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（约 1,750 字符，限额 2,000）。
> 与 v1.2.4 存底相比只改了 WHAT'S NEW 段（trial 价值 toast 复现路径）；trial/限额/遥测口径未变，均已对代码核验过。
> 官网侧的 invoice 并列 CTA 是 website 变更、不在扩展包内，刻意不写入测试路径——Edge 审核范围只测扩展。
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

WHAT'S NEW IN v1.2.5 (test path):

1. Trial value toast: when a trial user completes a batch ZIP download, the success toast now also shows the remaining trial days ("Downloaded N images · X trial days left"). To verify: open any page with images (e.g. a photo gallery), open the extension panel, select a few images, click the ZIP download button — the completion toast carries both the image count and the trial countdown. (Also fixed an internal analytics value mismatch in the upgrade modal — no visible behavior change for testers.)

TELEMETRY DISCLOSURE:
The extension sends anonymous, aggregate usage counters (event names and counts only — no URLs, no page content, no personal data) to our own endpoint to help us find bugs. This is ON by default and can be turned OFF at any time in Settings via the "Help improve Image Harvest" toggle.

No dependencies on other products. Privacy policy: https://image-harvest.kyriewen.cn/privacy
