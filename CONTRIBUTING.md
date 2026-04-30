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
- **Node.js 18+** (only required if you want to build the `website/` subproject; the extension itself uses no build step)
- **Git**

### Run the Extension Locally

```bash
# 1. Clone
git clone https://github.com/zbw-zbw/image-harvest.git
cd image-harvest

# 2. Load the extension in Chrome
# - Open chrome://extensions/
# - Enable "Developer mode" (top-right toggle)
# - Click "Load unpacked"
# - Select the repository root folder (the one containing manifest.json)

# 3. Pin the extension to the toolbar for easier access
# Click the puzzle icon → pin Image Harvest

# 4. Open any image-rich webpage and click the extension icon
```

### Run the Marketing Website Locally (optional)

```bash
cd website
npm install
npm run dev
# Visit http://localhost:3000
```

### Making Changes to the Extension

Because the extension is plain HTML/CSS/JS (no bundler), your workflow is:

1. Edit source files in `background/`, `content/`, `sidepanel/`, `pages/`, `shared/`, or `css/`
2. Go to `chrome://extensions/`
3. Click the **reload** button on the Image Harvest card
4. Re-open the extension to see your changes

For content scripts, you'll also need to refresh the target webpage after reloading the extension.

## Project Structure

```
image-harvest/
├── manifest.json              # MV3 extension manifest
├── background/                # Service worker modules
│   ├── index.js              # Entry point
│   ├── extractor.js          # Cross-tab coordination
│   ├── injector.js           # Content-script injection
│   ├── download.js           # ZIP packaging + download
│   ├── display-mode.js       # Popup / Side Panel switch
│   ├── license.js            # Pro license validation
│   ├── reverse-search.js     # Google/TinEye/Yandex search
│   └── utils.js
├── content/                   # Page-injected scripts
│   ├── main.js               # Entry: collect <img>, <picture>
│   ├── extract-advanced.js   # CSS backgrounds, lazy loading
│   ├── shadow-iframe.js      # Shadow DOM + same-origin iframes
│   ├── monitor.js            # MutationObserver live tracking
│   └── highlight.js          # On-page image highlighting
├── sidepanel/                 # Side Panel UI modules (11 modules)
├── pages/                     # popup.html / sidepanel.html
├── css/                       # Stylesheets (8 files, themed via CSS vars)
├── shared/                    # Shared utilities
│   ├── constants.js/.mjs     # Config & magic strings
│   ├── utils.js/.mjs         # Misc helpers
│   ├── phash.js/.mjs         # Perceptual hash
│   ├── color-extract.js/.mjs # Median Cut color extraction
│   ├── converter.js/.mjs     # PNG ↔ JPG ↔ WebP conversion
│   ├── naming.js/.mjs        # Filename template engine
│   ├── storage.js/.mjs       # chrome.storage wrappers
│   ├── collection.js/.mjs    # IndexedDB collections
│   └── license.js/.mjs       # License state machine
├── assets/ + icons/           # Visual assets
├── docs/chrome-store/         # Chrome Web Store listing copy
├── website/                   # Next.js marketing site (separate subproject)
└── scripts/                   # Icon generation & other build helpers
```

### Why `.js` + `.mjs` Dual Builds?

Chrome MV3 service workers are ES modules (`type: "module"` in manifest), but content scripts are classic scripts. The `shared/` directory provides both formats so a single source of logic can be consumed from both contexts.

When editing any `shared/*.js`, remember to update the matching `.mjs` file too (or write a helper that keeps them in sync).

## Coding Standards

### JavaScript

- **ES2020+ only**, use `const`/`let` (never `var`)
- Prefer `async`/`await` over `.then()` chains
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Explicit naming: `numSuccessfulRequests` > `n`, `generateDateString` > `genYmdStr`
- No ESLint config yet; follow the style of existing files

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

```
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

Questions? Open an issue or email `coderkyriewen@gmail.com`.

Thanks for helping make Image Harvest better! 🌾
