# Image Harvest v1.0.2 — Release Notes

**Release Date**: 2026-05-08
**Build**: `releases/image-harvest-v1.0.2.zip` (585 KB)

---

## Chrome Web Store — "What's New"

```
🌍 Internationalization, Trial & Productivity Update

• 5 languages: English, 简体中文, 繁體中文, 日本語, Español
• 7-day Pro trial for new users — all Pro features unlocked
• Batch copy URLs: select images → one-click copy all links
• Payment system migrated to Creem (better global coverage)
• Soft paywall: non-blocking upgrade prompts
• Anonymous telemetry (opt-in only, off by default)
• 10+ UI/UX bug fixes
• Test coverage pushed to 80% (1,258 unit + 27 e2e cases)
```

---

## Highlights

### 🌍 Internationalization (5 Languages)

- English (`en`), Simplified Chinese (`zh_CN`), Traditional Chinese (`zh_TW`), Japanese (`ja`), Spanish (`es`)
- All strings go through `chrome.i18n` + `_locales/<lang>/messages.json`
- Language auto-follows browser UI locale, no manual selection needed

### ✨ 7-Day Pro Trial + Soft Paywall + A/B + Rating Prompt

- **7-day full Pro trial** for new installs — auto-activates, all features unlocked
- **Soft paywall**: dismissible upgrade prompts on Pro feature tap (not blocking)
- **A/B experiment framework**: built-in lightweight bucketing for conversion optimization
- **In-app rating prompt**: triggers after positive usage signals (successful downloads, no errors)

### ✨ Batch Copy URLs

- Select any images → one-click copy all URLs to clipboard (newline-separated)
- Per-card "Copy link" context menu item
- Success toast shows exact count ("Copied 12 links")

### 🔁 Payment Migration: PayPal → Creem

- Better global payment coverage (China mainland, Southeast Asia)
- Pricing unchanged: Monthly $2.99 / Yearly $19.99 / Lifetime $29.99
- Existing licenses remain valid, no re-activation needed

### ✨ Anonymous Telemetry (Opt-in)

- Settings toggle "Anonymous usage stats" — **off by default**
- Reports only aggregate event counts (scan/download/dedup calls, error types)
- No image URLs, page URLs, or PII collected

### 🐛 UI/UX Fixes

- Narrow sidebar responsive layout (no toolbar overflow)
- Settings scroll fix (no longer hidden by footer buttons)
- Pro badge positioning preserved across all filter states
- Trial countdown loading flash eliminated
- Empty state layout no longer overflows in narrow panel
- Tab-switch flicker fixed
- Display-mode toggle always available
- Telemetry `chrome.storage.local.get` undefined crash guard

### 🧪 Test Coverage

| Metric               | Before | After      | Delta |
| -------------------- | ------ | ---------- | ----- |
| All files Lines      | ~60%   | **80.00%** | +20pp |
| Vitest test cases    | 847    | **1,258**  | +411  |
| Playwright e2e cases | 3      | **27**     | +24   |

---

## Key Commits (v1.0.1 → v1.0.2)

| Hash    | Description                                   |
| ------- | --------------------------------------------- |
| af4388c | chore(release): cut v1.0.2                    |
| 2008902 | fix(scripts): remove website/ path logic      |
| ae9868e | docs(readme): upgrade hero logo, add demo gif |
