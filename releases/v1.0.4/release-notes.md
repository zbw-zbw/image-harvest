# Image Harvest v1.0.4 — Release Notes

**Release Date**: 2026-05-25
**Tests**: 1400 passing (53 files)
**Build**: `releases/image-harvest-v1.0.4.zip`

---

## Chrome Web Store — "What's New" (paste into Developer Dashboard)

```
🔗 File Size Now Shows for Cross-Origin Images
Background proxy bypasses CORS to retrieve file metadata — no more blank sizes on CDN images.

🐛 Tab-Switch Stability (7 fixes)
• Eliminated grid flash when switching cached tabs
• Auto-reconnect to background SW after idle disconnect
• Proper handling of restricted pages (chrome://, edge://)
• Filter conditions now apply to dedup/similar modals

🎨 UI Refresh
• Pro modal redesigned with gradient icon cards
• Dark mode colors unified via CSS variables
• Skeleton cards fill viewport correctly on first open
• Delete button now free for all users

🌍 i18n Completion
• ~100 new translation keys across all 15 languages
• All remaining hardcoded English strings replaced

⚡ Architecture & Performance
• Tab lifecycle logic extracted into dedicated module
• IndexedDB collection code simplified (async/await)
• URL security validator prevents SSRF attacks
• Live monitor memory leak fixed (seenUrls cap + AbortController cleanup)
```

---

## Deployment Checklist

- [x] All 1400 tests passing (53 files)
- [x] TypeScript: 0 errors (`npx tsc --noEmit`)
- [x] ESLint: 0 errors
- [x] Production build successful
- [x] Version: `1.0.4` in package.json (manifest auto-synced)
- [x] CHANGELOG.md updated
- [x] Git tag `v1.0.4` created
- [x] Release zip archived: `releases/image-harvest-v1.0.4.zip`

### Manual Steps

1. **Build & archive**:

   ```bash
   npx vite build
   cd dist && zip -r ../releases/image-harvest-v1.0.4.zip . && cd ..
   ```

2. **Upload to Chrome Web Store**:
   - Go to https://chrome.google.com/webstore/devconsole
   - Select "Image Harvest" → Package → Upload new package
   - Upload `releases/image-harvest-v1.0.4.zip`
   - Paste the "What's New" text above into the changelog field
   - Submit for review

3. **GitHub Release** (optional):
   - Go to Releases → Draft new release
   - Choose tag `v1.0.4`
   - Title: `v1.0.4 — CORS File-Size Proxy, Tab-Switch Stability, i18n Completion`
   - Paste CHANGELOG section as release notes
   - Attach zip

---

## Key Changes Summary

### Features

| Area              | Change                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| File size display | Background SW HEAD proxy bypasses CORS; base64 fallback from dataUrl    |
| Live monitor      | seenUrls cleared on start + capped at max size; AbortController cleanup |
| CSS extraction    | Restored `extractCssContentImages`; merged into background-image pass   |
| Security          | `isAllowedFetchUrl()` blocks private IPs/localhost on all fetch proxies |
| Extraction        | Re-entry guard prevents duplicate concurrent extractions                |

### Bug Fixes (Tab-Switch — 7 fixes)

| Commit  | Fix                                                        |
| ------- | ---------------------------------------------------------- |
| 27feb69 | Eliminate grid flash on cached tab switch                  |
| b4a914b | Deep-copy cached arrays to prevent cross-tab mutation      |
| 26289e7 | Verify tab URL before revealing cached images              |
| 237daea | Guard loadCurrentTab against stale resumption              |
| 6b9da71 | Prevent flash of stale cards on cached switch              |
| e5b8f5b | Skip fast-path + preemptive grid hide for restricted pages |
| 16080dc | Reconnect to background SW on idle disconnect              |

### Bug Fixes (Other)

| Commit  | Fix                                             |
| ------- | ----------------------------------------------- |
| d59433a | Filter dedup modal by active filter conditions  |
| e3234f5 | Filter similar-image count by active conditions |
| b79ab73 | Grid visibility after filter change + rescan    |
| 86b5f88 | Empty state restore + restricted hero styling   |
| 4f511ce | Skeleton cards fill full viewport on first open |
| e847414 | Restored extractCssContentImages (was disabled) |
| 103e775 | Delete button Pro gate removal                  |

### UI/UX

- Pro modal: gradient icon cards, reordered sections, improved spacing
- Dark mode: consolidated CSS variables
- Empty state: top-aligned, no re-entry animation
- Skeleton count: viewport-aware calculation

### Architecture

- `sidepanel/tab-lifecycle.ts` — extracted from 1500-line `init.ts`
- `shared/collection.ts` — async/await refactor (–60 lines)
- `shared/url-validator.ts` — new SSRF prevention module
- `content/monitor.ts` — AbortController + seenUrls cap
