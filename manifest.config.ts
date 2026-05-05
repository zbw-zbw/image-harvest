// Typed MV3 manifest for @crxjs/vite-plugin.
//
// During migration this file contains a *minimal POC manifest* (Stage 0) so we
// can prove the new build pipeline works end-to-end before touching any of the
// legacy code. As each stage migrates a real entry point, we restore the
// corresponding field here:
//
//   Stage 1 (shared)     → no manifest change, only consumer imports
//   Stage 2 (background) → swap `background.service_worker`
//   Stage 3 (sidepanel)  → add `side_panel.default_path`
//   Stage 4 (popup)      → swap `action.default_popup`
//   Stage 5 (content)    → re-enable `content_scripts`
//
// Original manifest.json is preserved untouched on disk for reference and for
// the legacy `./scripts/build/build.sh` flow (see `npm run build:legacy`).

import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Image Harvest - Download Any Image from Any Webpage',
  version: pkg.version,
  description:
    'Batch download images. Multi-tab extract, similar detection, reverse image search, batch highlight, collections, color extract.',

  permissions: [
    'activeTab',
    'storage',
    'downloads',
    'scripting',
    'tabs',
    'sidePanel',
    'webNavigation',
    'alarms',
  ],

  host_permissions: ['<all_urls>'],

  action: {
    default_popup: 'pages/popup.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },

  // reverse-search.html is opened programmatically via chrome.tabs.create —
  // declare it as a web-accessible resource so it survives Vite's bundling.
  // (Already covered by the broader 'assets/*' rule below, but listing the
  // page explicitly here makes the dependency obvious.)

  side_panel: {
    default_path: 'pages/sidepanel.html',
  },

  background: {
    service_worker: 'background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['content/main.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },

  web_accessible_resources: [
    {
      resources: ['assets/*'],
      matches: ['<all_urls>'],
    },
  ],
});
