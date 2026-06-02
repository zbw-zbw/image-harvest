# Image Harvest v1.0.5 — Release Notes

**Release Date**: 2026-06-02
**Build**: `npm run build` → `dist/`

---

## Chrome Web Store — "What's New" (paste into Developer Dashboard)

```
🤖 AI Image Tagging (NEW!)
Generate smart tags for any image using AI. Helps you find, organize, and filter images by content. Free users get a daily quota; Pro users enjoy unlimited tagging.

• Single-image tagging: click the AI tag button on any image card
• Batch tagging: select multiple images → tag them all at once
• Tag filtering: search and filter images by their AI-generated tags

🦅 Export to Eagle (NEW!)
Send images directly to Eagle with metadata, AI tags, and source URL. Batch export all selected images at once. Free: up to 5 images; Pro: unlimited.

⚡ Batch Operations (NEW!)
Select images → perform bulk actions instantly:
• Batch favorite (add to collection)
• Batch AI tag
• Batch delete

🐛 Bug Fixes
• Dropdown menus (reverse search & download format) now close immediately after clicking
• Switching to a reverse-image-search tab and back no longer resets scroll position
• Fixed rare loading state getting stuck permanently after reverse search
• Tab switching between extension pages no longer causes status counts to flash/re-animate
```

---

## Deployment Checklist

- [x] TypeScript: 0 errors (`npx tsc --noEmit`)
- [x] ESLint: 0 errors
- [x] Production build successful
- [x] Version: `1.0.5` in package.json (manifest auto-synced)
- [x] CHANGELOG.md updated
- [x] Git tag `v1.0.5` created
- [x] Uploaded to Chrome Web Store

### Manual Steps

1. **Build & upload**:

   ```bash
   npm run build
   cd dist && zip -r ../dist.zip . -x "*.map" && cd ..
   # Upload dist.zip to Chrome Web Store Developer Dashboard
   rm dist.zip
   ```

2. **Chrome Web Store**:
   - Go to https://chrome.google.com/webstore/devconsole
   - Select "Image Harvest" → Package → Upload new package
   - Paste the "What's New" text above into the changelog field
   - Submit for review

3. **GitHub Release** (optional):
   - Go to Releases → Draft new release
   - Choose tag `v1.0.5`
   - Title: `v1.0.5 — AI Image Tagging, Tab-Switch Bug Fixes`
   - Paste CHANGELOG section as release notes

---

## Key Changes Summary

### ✨ New Features

| Area             | Change                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| AI Image Tagging | Generate smart content-based tags for images using AI                        |
| Batch AI Tagging | Tag multiple selected images in one click                                    |
| AI Tag Filtering | Filter/search images by their AI-generated tags in the toolbar               |
| Export to Eagle  | One-click export images (with metadata, AI tags, source URL) to Eagle app    |
| Batch Operations | Batch favorite, batch AI tag, batch delete — bulk actions on selected images |

### 🐛 Bug Fixes

| Area                  | Fix                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Dropdown dismiss      | Search/download dropdown menus now close immediately on item click (was staying open)    |
| Reverse search return | Switching to reverse-search tab no longer clears image list or resets scroll position    |
| Loading stuck         | Fixed race condition where scanning extension page could hang grid in loading state      |
| Status count flash    | Switching between extension pages (welcome, reverse-search) no longer re-animates counts |
