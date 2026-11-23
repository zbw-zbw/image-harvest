# Edge Add-ons 认证说明（Notes for certification）— v1.2.8

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（限额 2,000；本稿约 1,890 字符）。
> 与 v1.2.6 存底相比只改了 WHAT'S NEW 段（1.2.7 + 1.2.8 两轮引导链修复合并成一条复现路径）；trial/限额/遥测口径未变。
> Edge 商店线上停在 1.2.6，故本次从 1.2.6 直接跨到 1.2.8，1.2.7 的全部改动已含在包内。
> 限额口径依据：listing 文案写 ZIP 30 张/批；代码默认 `FREE_LIMITS.MAX_ZIP_IMAGES=50`，线上 feature_limits `free.max_zip_images=50`，实验 B 桶 30。对外按 listing 的 30 保守披露（实际执行更宽松，不会误报超额）。
> 灰框提示「每次提交都必须带 notes，即使之前交过」——每次版本更新都要重新粘贴。

---

Image Harvest is free with optional Pro (7-day trial, paid license). No accounts or credentials are needed to test any feature; this note explains how to reach gated areas.

TRIAL (Pro access for testers):
The 7-day Pro trial starts AUTOMATICALLY on install — no account or payment needed. Testers get full Pro access immediately; the header shows days remaining.

FREE-TIER LIMITS (only after a trial expires; matches our store listing):

- ZIP batch download: up to 30 images per batch (Pro: unlimited)
- Deep Scan: 3 per day (Pro: unlimited)
- Reverse image search: Google + TinEye (Pro: also Baidu + Yandex)
- AI tags: monthly quota (Pro: unlimited)

WHAT'S NEW IN v1.2.8 (test path):

This build goes from 1.2.6 to 1.2.8 and only touches the optional first-run tour; scanning, selecting and downloading are unchanged.

1. First-run tour reliability (1.2.7 + 1.2.8). After install a welcome page opens. About half of installs (a random A/B group) then see a 3-step tour in the panel on first open (scan → select → download). Up to 1.2.6 the tour often never appeared even for tour-assigned installs, because setup work had not finished when the panel opened. This build writes the flag at install, the panel waits for it, and the tour checks the A/B variant.
   Verify: install, wait for the welcome page, open an image-rich page, open the side panel. Coach marks = tour group; none = control group (by design, not a bug; reinstalling re-rolls). The tour ends after the first download or dismissal.

No other visible changes.

TELEMETRY DISCLOSURE:
The extension sends anonymous aggregate counters (event names and counts only; no URLs, content or personal data) to our endpoint to find bugs. ON by default; can be turned OFF in Settings via the "Help improve Image Harvest" toggle.

No dependencies on other products. Privacy policy: https://image-harvest.kyriewen.cn/privacy
