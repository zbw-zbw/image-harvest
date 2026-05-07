## Description

<!-- A clear, concise description of what this PR does and *why*. -->

## Type of change

<!-- Check the one(s) that apply: -->

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] ♻️ Refactor (no functional changes, no API changes)
- [ ] ⚡ Performance improvement
- [ ] 🧪 Test (adding missing tests or correcting existing tests)
- [ ] 🔧 Build / tooling / CI

## Related issues

<!-- Link to any related GitHub issues or discussions. Use "Closes #123" to auto-close. -->

Closes #

## How has this been tested?

<!-- Describe the tests you ran to verify your changes. -->

- [ ] Existing unit tests pass (`npm test`)
- [ ] Existing e2e tests pass (`npm run e2e:smoke`)
- [ ] Lint + typecheck pass (`npm run lint && npm run typecheck`)
- [ ] Build succeeds and bundle budgets pass (`npm run build`)
- [ ] Manual testing in Chrome with `dist/` loaded as unpacked extension
- [ ] New unit tests added for changed logic
- [ ] New e2e specs added for user-facing changes

**Chrome version tested on**: <!-- e.g. 125.0.6422.76 -->

**Test pages used**: <!-- e.g. Pinterest, Unsplash, a Shadow DOM fixture -->

## Screenshots / GIF

<!-- If this is a UI change, include before/after screenshots or a short screen recording. -->

## Checklist

<!-- Go over all items and check. If something doesn't apply, check it and add "(N/A)". -->

- [ ] My code follows the project's [coding standards](./CONTRIBUTING.md#coding-standards)
- [ ] I have run `npm run lint:fix` and `npm run typecheck`
- [ ] I have added / updated tests as needed
- [ ] I have updated documentation as needed (README, ARCHITECTURE, CHANGELOG)
- [ ] I have updated `_locales/*/messages.json` for any new UI strings (all 5 languages)
- [ ] I have **not** added any new permissions to `manifest.config.ts` (or I justified it below)
- [ ] I have **not** added any remote code loading
- [ ] Bundle size budgets still pass (`npm run build` runs `check-bundle-size.mjs`)

## New permissions justification

<!-- If you added/changed permissions in manifest.config.ts, explain why here. Otherwise delete this section. -->

N/A

## Additional notes

<!-- Anything else reviewers should know? -->
