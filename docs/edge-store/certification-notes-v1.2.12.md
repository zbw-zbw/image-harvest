# Edge Add-ons 认证说明（Notes for certification）— v1.2.12

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（限额 2,000；本稿 1,904 字符）。
> 本次 1.2.10 → 1.2.12：无新增权限、无新界面，两条都是可见缺陷修复（批量下载完成提示的计数、窄面板下 Pro 对比卡的排版）。
> 若 Edge 线上仍为 1.2.10，本次包同时包含 1.2.11 的免费额度统一与配额实验移除，notes 第 3 条已写明，避免审核员按旧版本对照。
> 与 v1.2.11 存底相比：WHAT'S NEW 换成两条可复现的修复路径，并补一句 1.2.11 的跨版本说明；限额四项与遥测披露未改。

---

Image Harvest is free with optional Pro (7-day trial, paid license). No accounts or credentials are needed; this note explains how to reach gated areas.

TRIAL (Pro access for testers):
The 7-day Pro trial starts AUTOMATICALLY on install — no account or payment needed. Full Pro access is immediate; the header shows days remaining.

FREE-TIER LIMITS (after a trial expires; matches our listing):

- ZIP batch download: 30 images per batch (Pro: unlimited)
- Deep Scan: 3 per day (Pro: unlimited)
- Reverse search: Google + TinEye (Pro: + Baidu, Yandex)
- AI tags: monthly quota (Pro: unlimited)

WHAT'S NEW IN v1.2.12 (test path):

No new permissions and no new screens; scanning, selecting and downloading behave as before.

1. Batch download toast count. When a ZIP finished, the panel could say "Downloaded 1" no matter how many images were selected, because the browser's own completion event was reported again after our count. It now keeps the real number. Verify: open any article, select 5 images, click Download, wait for the toast.

2. Pro comparison cards on a narrow panel. At the default 400px panel width the FREE / PRO badges left about 100px for each feature description, wrapping a one-line explanation into four lines. The badges now move to their own row. Verify: at default width open Settings, scroll to the Pro plan and click Upgrade to Pro.

3. Also in this build: the 1.2.11 changes (the free caps match our listing in every path — 30 images per ZIP batch and 5 favorites — and the retired September quota experiment is removed), plus store screenshots replaced with real captures. None of it changes permissions or data handling.

TELEMETRY DISCLOSURE:
Anonymous aggregate counters only (event names and counts; no URLs, content or personal data), sent to our endpoint to find bugs. ON by default; turn OFF in Settings.

Privacy policy: https://image-harvest.kyriewen.cn/privacy
