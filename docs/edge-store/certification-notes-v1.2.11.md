# Edge Add-ons 认证说明（Notes for certification）— v1.2.11

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（限额 2,000；本稿 1,727 字符）。
> Edge 商店线上已是 1.2.10（2026-11-24 过审），本次 1.2.10 → 1.2.11：无新增权限、无 UI 改动，只有免费额度兜底与线上配置/listing 对齐，外加 9 月配额实验代码的移除。
> 与 v1.2.10 存底相比：WHAT'S NEW 段收成「1.2.11 一条 + 已上线内容一句话回顾」，因为 1.2.7–1.2.10 的引导链与 trial 提醒审核员在上一版已看过；限额四项与遥测披露未改。
> 限额口径勘误：v1.2.10 存底里写的「代码默认 `MAX_ZIP_IMAGES=50`、线上 `free.max_zip_images=50`」是错的——线上一直是 30 / 5，50 / 10 只在远程配置拉不到时生效。1.2.11 起代码默认、线上配置、listing 三者一致，均为 30 张/批、5 个收藏。
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

WHAT'S NEW IN v1.2.11 (test path):

No new permissions and no UI changes; scanning, selecting and downloading behave as in 1.2.10.

1. One source of truth for the free caps. When our settings endpoint was unreachable, a built-in fallback could briefly allow 50 images per batch and 10 favorites; it now matches the listing (30 / 5). The retired September experiment that capped a small group at 10 images per batch is also gone. Verify: with the trial expired, select 31 images and start a ZIP download — the same 30-image cap and upgrade prompt appear as in 1.2.10.

2. Already live since 1.2.10 (unchanged here): the first-run tour (welcome page opens after install; the 3-step coach appears in the panel for one A/B group only, and reinstalling re-rolls it), and trial reminders drawn only inside the side panel — no browser notifications, no pop-ups, downloading never blocked.

TELEMETRY DISCLOSURE:
Anonymous aggregate counters only (event names and counts; no URLs, content or personal data), sent to our endpoint to find bugs. ON by default; turn OFF in Settings.

Privacy policy: https://image-harvest.kyriewen.cn/privacy
