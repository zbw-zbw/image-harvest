# v1.0.4 Release Notes

**Release Date**: 2026-05-19

---

## Bug Fixes

- **File Size filter button**: Fixed ▾ icon disappearing on initial render (caused by `data-i18n` overwriting button text)
- **generateId test**: Updated test to match `crypto.randomUUID()` behavior (introduced in v1.0.3 Task 1.5)

## New Features

### File Size (KB) Filter Presets

Added preset file size ranges to the File Size filter dropdown, matching the UX of the pixel-size filter:

| Preset      | Range         |
| ----------- | ------------- |
| All Sizes   | No filter     |
| Tiny        | < 50 KB       |
| Small       | 50 - 200 KB   |
| Medium      | 200 - 500 KB  |
| Large       | 500 KB - 2 MB |
| Extra Large | > 2 MB        |

Custom min/max KB inputs remain available below the presets.

### Trial Grace Period (3 days)

Trial users now get a 3-day grace period after expiry:

- Pro features remain functional during grace period
- A warning banner displays with days remaining and "Upgrade Now" CTA
- After 3 days, standard expiry behavior applies

## Tests Added

- `filterByFileSize`: 6 test cases covering disabled state, boundary conditions, undefined size, and preset ranges
- `isInTrialGracePeriod`: 5 test cases covering no license, non-trial plans, active trials, within grace, and past grace

## i18n

- 6 new file size preset keys in all 4 locales (en, zh_CN, zh_TW, ja)
- 2 trial grace period keys in all 4 locales

## Directory Restructuring

Moved docs, patches, and release artifacts into `versions/` directory organized by version number.

---

## Files Changed

```
package.json                          — version bump 1.0.3 → 1.0.4
pages/_shared-body.html               — filesize presets HTML + bug fix
sidepanel/state.ts                    — fileSizePreset field
sidepanel/filter.ts                   — FILESIZE_PRESETS map + applyFileSizePreset()
sidepanel/ui.ts                       — preset label in button
sidepanel/init.ts                     — preset click handlers + reset logic
_locales/{en,zh_CN,zh_TW,ja}/messages.json — 6 new keys each
tests/sidepanel-filter.test.tsx       — filterByFileSize test suite
tests/trial.test.ts                   — isInTrialGracePeriod test suite
tests/utils.test.ts                   — updated generateId test
```
