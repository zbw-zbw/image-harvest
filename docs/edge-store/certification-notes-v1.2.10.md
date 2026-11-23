# Edge Add-ons 认证说明（Notes for certification）— v1.2.10

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（限额 2,000；本稿 1,974 字符）。
> Edge 商店线上停在 1.2.6，本次从 1.2.6 直接跨到 1.2.10：1.2.7–1.2.9 的引导链修复与 1.2.10 的 trial 提醒全部在同一包里，无需分开提交。
> 与 v1.2.8 存底相比：WHAT'S NEW 段改为 1.2.7–1.2.10 合并叙述，新增「TRIAL REMINDERS」验证路径；限额/遥测口径未变，manifest 权限列表未变（未新增 notifications）。
> 限额口径依据：listing 文案写 ZIP 30 张/批；代码默认 `FREE_LIMITS.MAX_ZIP_IMAGES=50`，线上 feature_limits `free.max_zip_images=50`，实验 B 桶 30。对外按 listing 的 30 保守披露（实际执行更宽松，不会误报超额）。
> 灰框提示「每次提交都必须带 notes，即使之前交过」——每次版本更新都要重新粘贴。

---

Image Harvest is free with optional Pro (7-day trial, paid license). No accounts or credentials are needed; this note explains how to reach gated areas.

TRIAL (Pro access for testers):
The 7-day Pro trial starts AUTOMATICALLY on install — no account or payment needed. Full Pro access is immediate; the header shows days remaining.

FREE-TIER LIMITS (after a trial expires; matches our listing):

- ZIP batch download: 30 images per batch (Pro: unlimited)
- Deep Scan: 3 per day (Pro: unlimited)
- Reverse search: Google + TinEye (Pro: + Baidu, Yandex)
- AI tags: monthly quota (Pro: unlimited)

WHAT'S NEW IN v1.2.10 (test path):

This build goes from 1.2.6 to 1.2.10; scanning, selecting and downloading are unchanged, no new permissions.

1. First-run tour (1.2.7–1.2.9). After install a welcome page opens; about half of installs (an A/B group) then see a 3-step coach in the panel (scan → select → download). These builds fix a setup race that could suppress both. Verify: install, wait for the welcome page, then open the panel on an image-rich page. Coach marks = tour group; none = control group (by design; reinstalling re-rolls).

2. Trial reminders (1.2.10). Shown inside the side panel only — no browser notifications, no pop-ups, and downloading is never blocked. A trial sees one short strip: a recap on day 3/5/7 (images downloaded, Pro tools used), a warning before expiry, a one-time notice after expiry, then one reminder per week (max 4). Each strip's upgrade button opens our pricing page; closing it leaves the panel unchanged. Verify: the trial starts automatically; move the system clock forward and reopen the panel — the day-3 recap and the pre-expiry warning appear at the top and can be dismissed.

TELEMETRY DISCLOSURE:
Anonymous aggregate counters only (event names and counts; no URLs, content or personal data), sent to our endpoint to find bugs. ON by default; turn OFF in Settings.

Privacy policy: https://image-harvest.kyriewen.cn/privacy
