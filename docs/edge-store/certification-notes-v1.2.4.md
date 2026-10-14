# Edge Add-ons 认证说明（Notes for certification）— v1.2.4

> 使用说明：Edge Partner Center → Submit your extension → "Does a tester need credentials…" 选 **Yes** → 把下面分隔线内全文粘贴进 Notes for certification（约 1,830 字符，限额 2,000）。
> 与 v1.2.1 存底相比只改了 WHAT'S NEW 段（深扫完成检测修复 + ko/ja 全量本地化）；trial/限额/遥测口径未变，均已对代码核验过。
> onboarding 安装时引导为 A/B 实验（约半数新安装可见），刻意不写入测试路径——避免审核员未分到实验桶时误判功能损坏。
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

WHAT'S NEW IN v1.2.4 (test path):

1. Deep Scan completion detection fixed: a fully-loaded long page could previously be misreported as "stalled". To verify: open a long, lazily-loading page (e.g. an infinite-scroll gallery), open the extension panel, click "Deep Scan" — the page auto-scrolls to its real bottom and the scan completes normally with the full image count (no stalled state).
2. Japanese and Korean are fully localized: switching the browser UI language to ja or ko shows the complete panel in that language (no leftover English strings).

TELEMETRY DISCLOSURE:
The extension sends anonymous, aggregate usage counters (event names and counts only — no URLs, no page content, no personal data) to our own endpoint to help us find bugs. This is ON by default and can be turned OFF at any time in Settings via the "Help improve Image Harvest" toggle.

No dependencies on other products. Privacy policy: https://image-harvest.kyriewen.cn/privacy
