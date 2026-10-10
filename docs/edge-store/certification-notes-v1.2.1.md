# Edge Add-ons 认证说明（Notes for certification）— v1.2.1

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（约 1,750 字符，限额 2,000）。
> 事实口径均已对代码核验：trial 由 background/auto-trial.ts 在安装时自动激活；限额口径与已过审的商店 listing 一致；遥测为 opt-out（Settings 可关）。
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

WHAT'S NEW IN v1.2.1 (test path):
After a trial user completes a batch ZIP download of 50+ images, a non-blocking amber banner appears at the bottom of the panel: "Downloaded N images · X days left in your trial" with an upgrade button.
To reproduce: while the trial is active (it is, by default, right after install), open any image-heavy page (e.g. an Unsplash or Pexels search results page), open the extension panel, scan, select 50+ images, and click the ZIP download button. The banner appears when the download completes.

TELEMETRY DISCLOSURE:
The extension sends anonymous, aggregate usage counters (event names and counts only — no URLs, no page content, no personal data) to our own endpoint to help us find bugs. This is ON by default and can be turned OFF at any time in Settings via the "Help improve Image Harvest" toggle.

No dependencies on other products. Privacy policy: https://image-harvest.kyriewen.cn/privacy
