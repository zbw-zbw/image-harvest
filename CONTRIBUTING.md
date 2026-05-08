# Contributing to Image Harvest

First off, thanks for taking the time to contribute! 🎉

Image Harvest is a privacy-first Chrome extension for extracting and batch-downloading images from any webpage. Every contribution — a bug report, a typo fix, a new feature — helps make the project better for everyone.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)
- [What We Won't Accept](#what-we-wont-accept)

## Code of Conduct

Be kind. Be respectful. Assume good intent. That's it.

## How Can I Contribute?

### 🐛 Reporting Bugs

Before filing a bug report:

1. Check [existing issues](https://github.com/zbw-zbw/image-harvest/issues) to avoid duplicates
2. Make sure you're using the latest version from the Chrome Web Store
3. Try reproducing the issue in a Chrome **incognito window with all other extensions disabled**

When filing a bug, please use the `Bug Report` issue template — it asks for everything we need to help you.

### 💡 Suggesting Features

Use the `Feature Request` issue template. Good feature requests include:

- **The problem you're trying to solve** (not just "add X")
- **Your current workaround** (if any)
- **Why this feature would help other users too** (not only yourself)

### 📝 Improving Documentation

Documentation PRs are always welcome. This includes:

- Fixing typos
- Improving the README
- Adding clearer code comments
- Translating the README (we already have English + Simplified Chinese; other languages welcome)

### 🔧 Contributing Code

See [Development Setup](#development-setup) below.

## Development Setup

### Prerequisites

- **Google Chrome 88+** (Manifest V3 support)
- **Node.js 18+** (required for the Vite build, lint, and tests)
- **Git**

### Install dev dependencies

```bash
npm install
```

This installs Vite + `@crxjs/vite-plugin` (build), TypeScript + `@types/chrome` (types), and Vitest (unit tests).

### Daily commands

```bash
npm run dev               # Vite dev server with HMR — auto-rebuilds dist/ on every save
npm run build             # Production build into dist/
npm run preview           # Preview the built bundle
npm run typecheck         # tsc --noEmit (no emitted files, type-check only)
npm run lint              # ESLint flat config
npm run lint:fix          # Auto-fix what can be fixed
npm test                  # Vitest unit tests for shared/*.ts pure helpers
npm run test:watch        # Watch mode while iterating on tests
npm run test:coverage     # v8 coverage report under coverage/
```

### Run the Extension Locally

```bash
# 1. Clone & install
git clone https://github.com/zbw-zbw/image-harvest.git
cd image-harvest
npm install

# 2. Build (or `npm run dev` for HMR)
npm run build

# 3. Load the extension in Chrome
# - Open chrome://extensions/
# - Enable "Developer mode" (top-right toggle)
# - Click "Load unpacked"
# - Select the **dist/** folder (NOT the repo root)

# 4. Pin the extension to the toolbar for easier access
# Click the puzzle icon → pin Image Harvest

# 5. Open any image-rich webpage and click the extension icon
```

> **Tip:** Running `npm run dev` keeps `dist/` updated as you edit. After a save, just hit the **reload** button on the Image Harvest card in `chrome://extensions/`. For content-script changes you'll also need to refresh the target webpage.

### Run the Marketing Website Locally (optional)

```bash
cd website
npm install
npm run dev
# Visit http://localhost:3000
```

## Project Structure

```text
image-harvest/
├── manifest.config.ts         # Typed MV3 manifest (consumed by @crxjs/vite-plugin)
├── vite.config.ts             # Vite + crxjs config
├── tsconfig.json              # TypeScript config (allowJs: true, noImplicitAny: false)
├── package.json
├── background/                # Service-worker modules (ES modules)
│   ├── index.ts              # Entry point
│   ├── extractor.ts          # Cross-tab coordination
│   ├── injector.ts           # Content-script injection
│   ├── display-mode.ts       # Popup / Side Panel switch
│   ├── license.ts            # Pro license validation
│   ├── reverse-search.ts     # Google/TinEye/Yandex search
│   └── utils.ts
├── content/                   # Page-injected scripts (single bundle, ES modules)
│   ├── main.ts               # Entry: routing, primary extraction
│   ├── state.ts              # Module-level shared state
│   ├── utils.ts              # parseSrcset / sendDiscoveredImages / ...
│   ├── extract-advanced.ts   # CSS backgrounds, lazy loading, SVG, canvas
│   ├── shadow-iframe.ts      # Shadow DOM + same-origin iframes
│   ├── monitor.ts            # MutationObserver live tracking
│   └── highlight.ts          # On-page image highlighting
├── sidepanel/                 # Side Panel UI modules (11 .ts files)
├── pages/                     # popup.ts / popup.html / sidepanel.html / reverse-search.{ts,html}
├── css/                       # Stylesheets (8 files, themed via CSS vars)
├── shared/                    # Shared utilities (single TypeScript source of truth)
│   ├── types.ts              # Shared interfaces (ImageItem, AppSettings, ...)
│   ├── constants.ts          # Message types, enums, defaults
│   ├── utils.ts              # Misc helpers
│   ├── phash.ts              # Perceptual hash
│   ├── color-extract.ts      # Median Cut color extraction
│   ├── converter.ts          # PNG ↔ JPG ↔ WebP conversion
│   ├── naming.ts             # Filename template engine
│   ├── storage.ts            # chrome.storage wrappers
│   ├── collection.ts         # IndexedDB collections
│   └── license.ts            # License state machine
├── tests/                     # Vitest *.test.ts → shared/*.ts
├── assets/ + icons/           # Visual assets
├── docs/chrome-store/         # Chrome Web Store listing copy
├── website/                   # Next.js marketing site (separate subproject)
└── scripts/icons/             # Icon generation scripts
```

### Build Pipeline

The extension is built with **Vite + `@crxjs/vite-plugin`**:

- `manifest.config.ts` is the typed manifest source (no more `manifest.json` to hand-edit)
- All sources are **TypeScript ES modules**; `jszip` is consumed via `import JSZip from 'jszip'` from npm
- crxjs takes care of:
  - Bundling content scripts into a single IIFE per entry
  - Generating the service-worker loader
  - Emitting the production manifest into `dist/manifest.json`
- Output goes into `dist/` — that is the folder you load into Chrome via "Load unpacked"

There is **no longer a `.js` / `.mjs` dual-build dance** or a `sync-shared` script: every shared helper has exactly one source file (`shared/*.ts`).

## Coding Standards

### TypeScript

- **TypeScript everywhere** — no plain `.js` sources allowed in `background/`, `content/`, `sidepanel/`, `shared/`, `pages/`
- **TS strictness is intentionally relaxed during the migration** (`allowJs: true`, `noImplicitAny: false`). Function parameters and event handlers may be typed `any` where the runtime contract is dynamic. Tightening can happen module-by-module in follow-up PRs.
- Use ES2020+ features: `async`/`await`, optional chaining (`?.`), nullish coalescing (`??`), `const`/`let` (never `var`).
- Explicit naming: `numSuccessfulRequests` > `n`, `generateDateString` > `genYmdStr`.
- Run `npm run typecheck` and `npm run lint` before opening a PR.

### Tests

Image Harvest ships with **two layers of automated tests**:

| Layer | Runner          | Env                                | Scope                                                                                | Command            |
| ----- | --------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------ |
| Unit  | Vitest 2        | node + jsdom                       | `shared/*`, `background/*`, `content/*`, `sidepanel/*`, `pages/*`, Preact components | `npm test`         |
| E2E   | Playwright 1.59 | headed Chromium + unpacked `dist/` | User-facing flows (scan → filter → download, Pro gates, etc.)                        | `npm run test:e2e` |

**Current coverage**: 35 unit test files / 847 cases + 38 e2e specs, all green.

#### Unit tests (Vitest)

- File naming: `tests/<module>.test.ts` for node-environment specs, `tests/<module>.test.tsx` for anything that renders Preact or touches the DOM (jsdom env).
- **What to test**: pure functions, reactive store mutations, render-side effects you can verify via the a11y tree, module-level IIFE boot orchestration.
- **What to stub**:
  - `chrome.*` APIs — each test that needs Chrome mocks re-installs via a local `installChromeMock()` helper; see `tests/sidepanel-settings.test.tsx` for the canonical shape.
  - `indexedDB` — use `fake-indexeddb` (already a devDependency).
  - Heavy sibling modules — use `vi.mock('../sidepanel/xxx', () => ({ ... }))` at the top of the file to isolate the unit under test; see `tests/sidepanel-init.test.tsx` for the 14-module mock pattern used to isolate the 1115-line IIFE entry point.
- **jsdom limits (do NOT try to test around these)**:
  - Layout is not computed — `offsetWidth`, `offsetHeight`, `getBoundingClientRect()` all return `0` unless you `Object.defineProperty` them manually. Branches that depend on real layout (e.g. dropdown overflow repositioning in `toggleFilterDropdown`) are **deferred to e2e**.
  - CSS shorthand is serialized — `element.style.flex = 'none'` round-trips as `'0 0 auto'`, `'0'` as `'0px'`. Assert semantic intent (`toMatch(/...)` / `not.toBe('')`) instead of exact strings.
- Run `npm test` before opening a PR. Use `npm run test:watch` while iterating.
- Coverage report: `npm run test:coverage` → `coverage/index.html`.

#### E2E tests (Playwright)

- Specs live under `e2e/*.e2e.ts`; helpers under `e2e/_helpers/`.
- The extension is loaded via `launchPersistentContext` against `dist/` (**you must `npm run build` first** — e2e does not rebuild automatically).
- Headed Chromium + `workers: 1` (MV3 service workers don't boot reliably headless; parallel headed windows fight for the macOS display socket). CI uses `xvfb-run`.
- **Deterministic state pattern**: tests flip `window.__IH_E2E__ = true` via Playwright's `addInitScript`, which causes `sidepanel/init.ts` to expose `window.__IH__ = { store, applyFilters, loadMultitab, applyTheme, handleMessage }`. Prefer `__IH__.store.set(...)` over clicking through 4-deep dropdown menus.
- Smoke-only tier: `npx playwright test e2e/smoke.e2e.ts` (~5s, 3 cases) — run this before every commit; full suite before every release.
- When you land a UI change, add or extend a matching e2e spec; don't just rely on unit coverage for click-wiring.

### CSS

- Use CSS variables from `css/variables.css` — **never hardcode colors**
- All UI components must support both light and dark mode
- Layouts must adapt to Side Panel min-width (280px) and max-width (600px+)

### HTML / Markup

- Semantic HTML (`<button>` for actions, `<a>` for navigation)
- All interactive elements must have `aria-label` or accessible text
- Keep popup.html and sidepanel.html in sync (they share styles and most markup)

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` code change that neither fixes a bug nor adds a feature
- `perf:` performance improvement
- `chore:` build/tooling changes

Example:

```text
feat(extractor): add support for <object type="image/svg+xml">

Some legacy sites embed SVGs via <object> tags. Treat them like <img>
when the type attribute starts with "image/".
```

## Pull Request Process

1. **Fork** the repository
2. **Create a topic branch**: `git checkout -b feat/your-feature-name`
3. **Make your changes**, following the coding standards above
4. **Test manually** in a clean Chrome profile with several image-heavy sites (e.g., Pinterest, Unsplash, a product page with CSS backgrounds)
5. **Commit** with a conventional commit message
6. **Push** to your fork and open a PR against `master`
7. In the PR description, include:
   - What changed and why
   - Screenshots or short GIF for UI changes
   - How you tested it
8. Respond to review comments; the maintainer will merge once approved

### Small PRs are preferred

If you're planning a big refactor or a feature that touches many files, please **open an issue first** to discuss the approach. This saves both of us time.

## What We Won't Accept

To keep the project focused and its values consistent, the following will be rejected:

- ❌ **Adding analytics, telemetry, or tracking** — privacy-first is a core promise
- ❌ **Remote code loading** — MV3 already disallows this, and we have no reason to ever circumvent it
- ❌ **Adding a required backend call for any free feature** — free features must stay 100% local
- ❌ **Bundling third-party SDKs** without a clearly documented reason
- ❌ **Adding a new permission to `manifest.json`** without a strong justification
- ❌ **Removing the Chinese README** or breaking bilingual parity
- ❌ **Reformatting existing code style-only**, unless pre-agreed in an issue
- ❌ **AI-generated PRs with no human review** — please actually read what the AI wrote

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE) that covers the project.

---

Questions? Open an issue or email `support@kyriewen.cn`.

Thanks for helping make Image Harvest better! 🌾
