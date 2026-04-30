# Image Harvest

<p align="center">
  <strong>English | <a href="./README.zh-CN.md">简体中文</a></strong>
</p>

<p align="center">
  <img src="icons/icon128.png" alt="Image Harvest" width="128" height="128">
</p>

<p align="center">
  <strong>Intelligently capture and batch download all images from any webpage.</strong>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo">
    <img src="https://img.shields.io/chrome-web-store/v/iecgnjidmogebokcfnejncgnelcepffo?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=4285F4" alt="Chrome Web Store">
  </a>
  <a href="https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo">
    <img src="https://img.shields.io/chrome-web-store/users/iecgnjidmogebokcfnejncgnelcepffo?label=users&color=4285F4" alt="Chrome Web Store users">
  </a>
  <a href="https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo">
    <img src="https://img.shields.io/chrome-web-store/rating/iecgnjidmogebokcfnejncgnelcepffo?label=rating&color=4285F4" alt="Chrome Web Store rating">
  </a>
  <a href="https://github.com/zbw-zbw/image-harvest/stargazers">
    <img src="https://img.shields.io/github/stars/zbw-zbw/image-harvest?style=flat&logo=github&color=yellow" alt="GitHub stars">
  </a>
  <a href="https://github.com/zbw-zbw/image-harvest/blob/master/LICENSE">
    <img src="https://img.shields.io/github/license/zbw-zbw/image-harvest?color=green" alt="License MIT">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-88%2B-brightgreen?logo=googlechrome&logoColor=white" alt="Chrome 88+">
  <img src="https://img.shields.io/badge/Privacy-First-success" alt="Privacy First">
  <img src="https://img.shields.io/badge/Zero-Tracking-success" alt="Zero Tracking">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo">
    <strong>🛒 Install from Chrome Web Store</strong>
  </a>
  &nbsp;·&nbsp;
  <a href="https://image-harvest.kyriewen.cn">
    <strong>🌐 Visit Website</strong>
  </a>
  &nbsp;·&nbsp;
  <a href="https://image-harvest.kyriewen.cn/pricing">
    <strong>💎 Pricing</strong>
  </a>
  &nbsp;·&nbsp;
  <a href="./docs/README.md">
    <strong>📖 Documentation</strong>
  </a>
</p>

---

## 📖 Documentation

- 🛒 **[Chrome Store Assets](./docs/chrome-store/)** — Listing description & summary (public)
- 🌐 **Website** — [image-harvest.kyriewen.cn](https://image-harvest.kyriewen.cn)

> Product roadmap, marketing strategy, and platform-specific launch content are maintained in a separate private repository and not distributed with this open-source release.
> 
> 👉 **Documentation index:** [`docs/README.md`](./docs/README.md)

---

## ✨ Features

### 🔍 Smart Image Extraction

- **`<img>` tags** — including `srcset` high-resolution candidates (picks the highest resolution)
- **CSS `background-image`** — inline styles & external stylesheets
- **`<picture>` / `<source>` elements**
- **Same-origin iframe** content extraction
- **Shadow DOM** traversal
- **Live Monitoring** — real-time detection of newly added images via `MutationObserver` *(Pro)*

### 🖼️ Image Display & Management

- **Grid / List view** toggle with 3 density levels (Compact / Standard / Comfortable)
- **Color palette extraction** — displays top 5 dominant colors per image *(Median Cut algorithm)*
- **Perceptual hash (pHash)** based similar image detection *(Pro)*

### 🎛️ Powerful Filtering & Sorting

- **Size filter** — All / Small / Medium / Large / XL / Custom range
- **Format filter** — JPG / PNG / WebP / SVG / GIF / Other (multi-select)
- **Layout filter** — All / Square / Landscape / Portrait / Panorama
- **URL keyword search** — real-time with debounce
- **Smart grouping** — by Domain / Format / Size Range / Tab
- **Sorting** — by size (asc/desc), format, or natural order

### 📥 Download & Export

- **Single image download** — original or converted format
- **Batch ZIP download** — powered by JSZip
- **Format conversion** — PNG / JPG / WebP via Canvas API *(Pro)*
- **Custom naming templates** — `{index}`, `{original}`, `{pageTitle}`, `{pageDomain}`, `{width}`, `{height}`, `{format}`, `{date}` and more *(Pro)*
- **Download progress** modal with progress bar

### 🎯 Page Highlight

- Select images in the panel → corresponding images are highlighted on the page
- Auto-scroll to the highlighted image
- Synchronized with panel checkbox state

### ⭐ Image Collection *(Pro)*

- Save images to local IndexedDB with tags, notes, and metadata
- Browse, search, and filter your collection
- Batch export collected images as ZIP

### 🔎 Reverse Image Search

- **Google Images** (free)
- **TinEye / Baidu / Yandex** *(Pro)*

### 🖥️ Dual Display Mode

- **Side Panel** — always-visible alongside the webpage
- **Popup** — classic popup window (620×600px)
- Switch between modes anytime via settings

### 🌗 Theme & Appearance

- **System / Light / Dark** theme support
- Full CSS variable–based theming
- Responsive layout — adapts from side panel minimum to maximum width

---

## 📁 Project Structure

```
image-harvest/
├── manifest.config.ts         # Typed MV3 manifest (consumed by @crxjs/vite-plugin)
├── vite.config.ts             # Vite + crxjs config
├── tsconfig.json              # TypeScript config
├── package.json
├── README.md                  # English README (you are here)
├── README.zh-CN.md            # Chinese README
├── CHANGELOG.md               # Release history
├── docs/                      # Documentation
├── background/                # Service Worker (TypeScript ES modules)
│   ├── index.ts               # Main entry, message routing
│   ├── utils.ts
│   ├── license.ts             # License periodic check (alarms-based)
│   ├── display-mode.ts        # Side panel / popup mode switching
│   ├── injector.ts            # Content script injection
│   ├── extractor.ts           # Image extraction coordination
│   └── reverse-search.ts      # Reverse search proxy
├── content/                   # Content Scripts (single ESM bundle via crxjs)
│   ├── main.ts                # Message handling, primary extraction
│   ├── state.ts               # Module-level shared state
│   ├── utils.ts               # parseSrcset / sendDiscoveredImages / ...
│   ├── monitor.ts             # Live monitoring (MutationObserver)
│   ├── highlight.ts           # Page highlight overlay
│   ├── extract-advanced.ts    # Advanced extraction (stylesheet BG, SVG, canvas, ...)
│   └── shadow-iframe.ts       # Shadow DOM + iframe extraction
├── pages/                     # HTML pages & their TypeScript entries
│   ├── sidepanel.html
│   ├── popup.html
│   ├── popup.ts               # Popup mode detection & height adjustment
│   ├── popup.css              # Popup-specific style overrides
│   ├── reverse-search.html
│   └── reverse-search.ts      # Reverse search logic
├── css/                       # Shared stylesheets (themed via CSS variables)
├── sidepanel/                 # Side panel TypeScript modules (shared with popup)
│   ├── state.ts               # Global mutable state object & DOM refs
│   ├── utils.ts               # Utility functions, settings loader
│   ├── ui.ts                  # Common UI components
│   ├── filter.ts              # Filter & sort logic
│   ├── render.ts              # Image rendering & grouping
│   ├── scan.ts                # Scan overlay, image fetching
│   ├── actions.ts             # Select, highlight, download actions
│   ├── pro-features.ts        # Pro feature modules
│   ├── settings.ts            # Settings, hotkeys, license UI
│   ├── message.ts             # Message handling, keyboard shortcuts
│   └── init.ts                # Initialization entry, event bindings
├── shared/                    # Shared TypeScript modules (single source of truth)
│   ├── types.ts               # Shared interfaces (ImageItem, AppSettings, ...)
│   ├── constants.ts           # Message types, enums, defaults, pricing, license consts
│   ├── storage.ts             # Settings CRUD, display mode
│   ├── utils.ts               # Common utility functions
│   ├── converter.ts           # Image format conversion (Canvas API)
│   ├── naming.ts              # Naming template engine
│   ├── phash.ts               # Perceptual hash algorithm
│   ├── collection.ts          # Collection IndexedDB management
│   ├── color-extract.ts       # Color extraction (Median Cut)
│   └── license.ts             # License validation (remote API + local cache)
├── tests/                     # Vitest *.test.ts (pure helpers under shared/*.ts)
├── icons/                     # Extension icons (PNG, generated from SVG source)
├── assets/                    # Marketing assets
├── scripts/icons/             # Icon-generation scripts
└── website/                   # Marketing website (Next.js, deployed at image-harvest.kyriewen.cn)
```

### Build & Dev

```bash
npm install                    # one-time setup
npm run dev                    # Vite dev server with HMR (writes dist/ on every save)
npm run build                  # Production build to dist/
npm run typecheck              # tsc --noEmit
npm run lint                   # ESLint
npm test                       # Vitest unit tests
```

To install in Chrome: `chrome://extensions/` → Developer mode → **Load unpacked** → select the `dist/` folder.

---

## 📸 Screenshots

| Side Panel Mode | Popup Mode |
|:---:|:---:|
| ![Side Panel](assets/screenshots/sidepanel.png) | ![Popup](assets/screenshots/popup.png) |

> Screenshots may be added/updated post-launch. See `assets/screenshots/` for the latest assets.

---

## 🚀 Installation

### Option 1: Chrome Web Store (Recommended)

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install%20Image%20Harvest-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo)

1. Visit the [Chrome Web Store listing](https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo)
2. Click **Add to Chrome**
3. Pin the extension to your toolbar for quick access

> Enjoying Image Harvest? Please consider [leaving a review](https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo/reviews) — it helps a lot for a small solo project. 🙏

### Option 2: From Source (Developer Mode)

1. **Clone the repository**

   ```bash
   git clone https://github.com/zbw-zbw/image-harvest.git
   ```

2. **Open Chrome Extensions page**

   Navigate to `chrome://extensions/`

3. **Enable Developer Mode**

   Toggle the "Developer mode" switch in the top-right corner

4. **Load the extension**

   Click "Load unpacked" and select the `image-harvest` project root directory

5. **Pin the extension**

   Click the puzzle icon in Chrome toolbar and pin "Image Harvest"

---

## 🎮 Usage

### Quick Start

1. Navigate to any webpage with images
2. Click the **Image Harvest** icon in the toolbar (or press `Ctrl+Shift+S` / `⌘+Shift+S`)
3. The extension will automatically scan and display all images found on the page
4. Use filters to narrow down results, select images, and download individually or in bulk

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` / `⌘+Shift+S` | Toggle Image Harvest |

---

## 💎 Free vs Pro

| Feature | Free | Pro |
|---------|------|-----|
| Smart image extraction | ✅ Full | ✅ Full |
| Filters (size / format / layout / URL) | ✅ Full | ✅ Full |
| Sorting & view modes | ✅ Full | ✅ Full |
| Single download | ✅ Full | ✅ Full |
| Side Panel / Popup modes | ✅ Full | ✅ Full |
| Batch ZIP download | ⚡ Up to 20 | ✅ Unlimited |
| Format conversion | ❌ | ✅ PNG / JPG / WebP |
| Custom naming templates | ⚡ Default only | ✅ Full template variables |
| Page highlight | ⚡ Single only | ✅ Batch + auto-scroll |
| Smart grouping | ⚡ None / Format | ✅ All 5 modes |
| Live monitoring | ❌ | ✅ Real-time |
| Similar image detection | ❌ | ✅ pHash-based |
| Image collection | ❌ | ✅ Full collection system |
| Multi-tab extraction | ❌ | ✅ Cross-tab |
| Reverse image search | ⚡ Google only | ✅ 4 engines |

---

## 💵 Pricing

Image Harvest is **free to use** with optional Pro plans for power users.

| Plan | Price | Billing | Best For |
|------|------:|---------|----------|
| **Free** | $0 | Forever | Casual users — covers 95% of everyday use cases |
| **Monthly** | $2.99 | per month | Trying out Pro features short-term |
| **Yearly** | $19.99 | per year (~44% off) | Regular users — best value for ongoing use |
| **Lifetime** | $39.99 | one-time | Pay once, use forever — no subscription |

> 💡 All Pro plans unlock the same features. View the full feature comparison on the [Pricing page](https://image-harvest.kyriewen.cn/pricing).

---

## 🛠️ Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Platform | Chrome Extension Manifest V3 | Latest extension standard |
| UI | Vanilla HTML/CSS/JS | Zero framework dependency, minimal bundle size |
| ZIP packaging | JSZip | Mature, supports blob streaming |
| Image extraction | DOM traversal + `getComputedStyle` | Accurate runtime background image detection |
| Perceptual hash | Canvas API + DCT | Pure frontend, no external dependencies |
| Color extraction | Canvas API + Median Cut | Pure frontend, extracts dominant colors |
| Format conversion | Canvas API (`toDataURL` / `toBlob`) | Supports PNG / JPG / WebP |
| Collection storage | IndexedDB | Supports large datasets and Blob storage |
| Settings storage | `chrome.storage.local` / `sync` | Persists user preferences |

---

## 🔒 Privacy & Security

- **No data collection** — the extension does not collect or transmit any user data
- **No URL tracking** — no analytics or telemetry
- **All processing is local** — image extraction, hashing, color analysis, and format conversion happen entirely in the browser

---

## 🌐 Website & Support

- **Official Website**: [image-harvest.kyriewen.cn](https://image-harvest.kyriewen.cn)
- **Pricing Page**: [image-harvest.kyriewen.cn/pricing](https://image-harvest.kyriewen.cn/pricing)
- **FAQ**: [image-harvest.kyriewen.cn/faq](https://image-harvest.kyriewen.cn/faq)
- **Support Email**: [coderkyriewen@gmail.com](mailto:coderkyriewen@gmail.com)
- **Bug Reports & Feature Requests**: [GitHub Issues](https://github.com/zbw-zbw/image-harvest/issues)
- **Leave a Review**: [Chrome Web Store Reviews](https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo/reviews)

### About the `website/` Subproject

The `website/` directory contains the marketing site for Image Harvest, built with [Next.js](https://nextjs.org). It hosts the landing page, pricing, FAQ, and license activation portal. See [website/README.md](./website/README.md) for development instructions.

---

## 📜 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full release history.

**Latest**: `v1.0.0` — 🎉 Initial public release on Chrome Web Store.

---

## 📝 License

MIT © [kyriewen](https://github.com/zbw-zbw)
