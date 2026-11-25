# Edge Add-ons 认证说明（Notes for certification）— v1.2.13

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（限额 2,000；本稿 1,975 字符）。
> 本次 1.2.12 → 1.2.13：无新增权限、无新界面，只有两处「宽面板下布局仍在按 400px 计算」的修补。
> 若 Edge 线上仍为 1.2.10，本次包同时包含 1.2.11 / 1.2.12 的改动，notes 第 3 条已写明，避免审核员按旧版本对照。
> 与 v1.2.12 存底相比：WHAT'S NEW 换成两条可复现的拖宽面板路径；限额四项、遥测披露、试用路径未改。

---

Image Harvest is free with optional Pro (7-day trial, paid license). No accounts or credentials are needed; this note explains how to reach gated areas.

TRIAL (Pro access for testers):
The 7-day Pro trial starts AUTOMATICALLY on install — no account or payment needed. Full Pro access is immediate; the header shows days remaining.

FREE-TIER LIMITS (after a trial expires; matches our listing):

- ZIP batch download: 30 images per batch (Pro: unlimited)
- Deep Scan: 3 per day (Pro: unlimited)
- Reverse search: Google + TinEye (Pro: + Baidu, Yandex)
- AI tags: monthly quota (Pro: unlimited)

WHAT'S NEW IN v1.2.13 (test path):

No new permissions and no new screens; scanning, selecting and downloading behave as before. This build only makes two existing layouts use a wide side panel instead of assuming the default 400px.

1. List view thumbnails. In list view the thumbnail was a fixed 160px strip, so once the panel was dragged to about 600px every photo floated in roughly 120px of empty space on both sides. Thumbnails now follow the card width. Verify: open any article, drag the side panel to its maximum width, then switch Grid to List.

2. Collection grid. In the same wide panel the Collection modal dropped to a single 520px column, leaving a small thumbnail stranded in the middle. It now lays out two columns. Verify: at maximum panel width, open Collection from the toolbar, or save an image and open it there.

3. Also in this build: the 1.2.12 changes (the batch-download toast keeps the real count, and the Pro plan badges move to their own row on narrow panels) and 1.2.11 (the free caps match our listing — 30 images per ZIP batch and 5 saved images). None of it changes permissions or data handling.

TELEMETRY DISCLOSURE:
Anonymous aggregate counters only (event names and counts; no URLs, content or personal data), sent to our endpoint to find bugs. ON by default; turn OFF in Settings.

Privacy policy: https://image-harvest.kyriewen.cn/privacy
