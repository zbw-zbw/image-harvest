# Image Harvest v1.0.1 — Release Notes

**Release Date**: 2026-04-29
**Build**: `releases/image-harvest-v1.0.1.zip` (2.9 MB)

---

## Chrome Web Store — "What's New"

```
🎨 Polish & Discoverability Update

• Extension name updated to "Image Harvest - Download Any Image from Any Webpage"
  for better Chrome Web Store search discoverability
• Small promo tile (440×280) — rounded corners for a modern look
• Marquee promo tile (1400×560) — rounded corners for brand consistency
• YouTube product demo video published: https://youtu.be/o5KdX--l-yw
```

---

## Highlights

### 🔄 Chrome Web Store Listing

- **Extension name** updated from `Image Harvest` to `Image Harvest - Download Any Image from Any Webpage` for better search discoverability and clearer value proposition at a glance.
- **Small promo tile** (440×280) — added rounded corners for a softer, more modern visual presentation.
- **Marquee promo tile** (1400×560) — added rounded corners to match the small promo tile, ensuring brand consistency across all Chrome Web Store visual assets.

### ✨ Marketing Assets

- **YouTube product demo video** published globally — a complete walkthrough of Image Harvest's core capabilities: [Watch on YouTube](https://www.youtube.com/watch?v=o5KdX--l-yw&t=1s)
  - Covers: smart image extraction, multi-tab batch download, similar image detection, reverse image search, color extraction.
  - Available worldwide for both English and international audiences.

---

## Key Commits (v1.0.0 → v1.0.1)

| Category | Description                                            |
| -------- | ------------------------------------------------------ |
| refactor | Migrate to TypeScript + Vite + @crxjs/vite-plugin      |
| feat     | ImageCard Preact migration + virtual list              |
| perf     | jszip lazy import, init.js gzip -40.5%                 |
| perf     | Lazy-load multitab/collection/dedup/license-ui modules |
| test     | Push all-files coverage to 80% (847 → 1,258 cases)     |
| test     | 27 Playwright e2e cases                                |
| fix      | Narrow sidebar responsive layout                       |
| feat     | Payment system migration: PayPal → Creem               |
