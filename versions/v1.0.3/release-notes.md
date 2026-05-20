# Image Harvest v1.0.3 — Release Notes

**Release Date**: 2026-05-14
**Build**: `releases/image-harvest-v1.0.3.zip` (768 KB)

---

## Chrome Web Store — "What's New" (paste into Developer Dashboard)

```
🌍 15 Languages Now Supported
Added Korean, Portuguese, French, German, Italian, Russian, Dutch, Polish, Arabic, and Thai.

🐛 Critical Fixes
• Fixed: Side panel occasionally showing "Found 0 images" on open
• Fixed: Settings labels not updating when switching display language
• Fixed: Image highlights lost after download or multi-tab extraction

⚡ Performance
• ~30% faster image scanning on heavy pages (parallelized loading)
• Instant settings save (no more lag)

✨ UI Polish
• PRO badges right-aligned in all dropdowns
• Hotkey area shows pointer cursor + auto-refreshes after change
• Rating prompt dialog now properly centered
```

---

## Deployment Checklist

- [x] All 1388 tests passing
- [x] ESLint: 0 errors
- [x] Production build successful (858ms)
- [x] Version bumped in `package.json` → `1.0.3`
- [x] Manifest reads from `package.json` (auto-synced)
- [x] CHANGELOG.md updated
- [x] Git tag `v1.0.3` created
- [x] Release zip archived: `releases/image-harvest-v1.0.3.zip`

### Remaining Manual Steps

1. **Push to remote**:

   ```bash
   git push origin master --tags
   ```

2. **Upload to Chrome Web Store**:
   - Go to https://chrome.google.com/webstore/devconsole
   - Select "Image Harvest" → Package → Upload new package
   - Upload `releases/image-harvest-v1.0.3.zip`
   - Paste the "What's New" text above into the changelog field
   - Submit for review

3. **GitHub Release** (optional):
   - Go to Releases → Draft new release
   - Choose tag `v1.0.3`
   - Title: `v1.0.3 — 15 Languages, Rendering Fix, UX Polish`
   - Paste CHANGELOG section as release notes
   - Attach `image-harvest-v1.0.3.zip`

---

## Key Commits Since v1.0.2

| Hash    | Description                                                      |
| ------- | ---------------------------------------------------------------- |
| 7ad7333 | fix: useLayoutEffect in storeHook — prevent missed store updates |
| 835b60c | fix: clear selection/highlights after multi-tab extraction       |
| 185c8a4 | fix: skip highlighting images behind interactions                |
| fcd45dd | fix: highlight positioning for duplicate URLs                    |
| 6838e12 | fix: popup mode rendering                                        |
| 041b850 | fix: preserve selection after download                           |
| 3db5a21 | perf: parallelize ensureImageLoaded                              |
| ded768a | perf: optimize save settings speed                               |
| 9857e94 | feat: expand i18n to 15 languages                                |
| f153829 | chore(release): cut v1.0.3                                       |
