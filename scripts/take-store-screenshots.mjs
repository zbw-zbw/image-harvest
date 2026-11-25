#!/usr/bin/env node
/**
 * Capture the store screenshots from the real extension running in Chromium.
 *
 * Every shot is two live pages composited side by side, exactly like a Chrome
 * window with the side panel docked:
 *
 *     ┌───────────────────────────────┬──────────────┐
 *     │ demo page  880 px             │ side panel   │
 *     │ (e2e/fixtures/store-demo.html)│ 400 px       │
 *     └───────────────────────────────┴──────────────┘
 *                        1280 × 800
 *
 * Why not mock the UI: the previous set was assembled by hand, which is why
 * the thumbnails were all identical `SVG 400x300 505 B` tiles and the split
 * was 640/640 (a real side panel is ~400 px, so everything looked oversized
 * and unconvincing).
 *
 * One shot (`popup`) is the browser-action surface instead: the article at full
 * width with the real 600×600 popup floating over it, the way Chrome draws it
 * under the toolbar icon.
 *
 * Requirements
 *   npm run build:e2e      # dist/ with the .e2e-build marker
 *   node scripts/take-store-screenshots.mjs --shot=batch-select
 *   node scripts/take-store-screenshots.mjs                # every shot
 *
 * Options
 *   --shot=<name>    capture one shot (repeatable); default: all
 *   --out=<path>     output file; only valid together with a single --shot
 *   --panel=<px>     side panel width (default 400); the demo page gets the rest
 *   --pro            run as a licensed Pro user (stubs VALIDATE_LICENSE)
 *   --raw-dir=<dir>  also write the uncropped page/panel halves there
 *   --headed         show the browser window while capturing
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_HOST, startFixtureServer } from './_demo-page-server.mjs';
import {
  dismissNudges,
  dismissPageHighlight,
  enablePro,
  scrollToTop as resetPanelScroll,
  waitForThumbnails,
  waitForToastsToClear,
} from './_panel-controls.mjs';

const REPO = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(REPO, 'dist');
const OUT_DIR = join(REPO, 'assets', 'screenshots');

const CANVAS_W = 1280;
const HEIGHT = 800;

// Both are mutable so --panel can shift the split; the page keeps the rest.
let PANEL_W = 400;
let PAGE_W = CANVAS_W - PANEL_W;

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------
const selectCards = async (panel, indexes) => {
  const cards = panel.locator('#image-grid .image-card');
  for (const i of indexes) {
    await cards.nth(i).locator('.card-checkbox').click();
  }
};

const openFilter = async (panel, label) => {
  const button = panel.locator('.filter-buttons .filter-btn', { hasText: label }).first();
  await button.click();
  await panel.waitForTimeout(250);
};

/**
 * AI tagging calls the real backend, which the VITE_E2E build cannot reach.
 * `loadAiTagsMap()` reads chrome.storage.local on every scan instead, so seeding
 * the cache is enough to render the tags exactly as a tagged session would.
 */
const AI_TAGS = {
  'http://fieldnotes.test/demo/vestfjorden.jpg': ['fjord', 'cliffs', 'water'],
  'http://fieldnotes.test/demo/mountain-road.jpg': ['road', 'hills', 'cloud'],
  'http://fieldnotes.test/demo/city-dusk.jpg': ['city', 'skyline', 'dusk'],
  'http://fieldnotes.test/demo/ridge-sunset.jpg': ['ridge', 'rock', 'sunset'],
  'http://fieldnotes.test/demo/waterfall.jpg': ['waterfall', 'forest', 'moss'],
  'http://fieldnotes.test/demo/sea-cliffs.jpg': ['sea', 'cliffs', 'overcast'],
};

async function seedStorage(context, extensionId, data) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/pages/sidepanel.html`);
  await page.evaluate((payload) => chrome.storage.local.set(payload), data);
  await page.close();
}

const SHOTS = {
  // Batch selection + the sticky action bar. The headline capability, and the
  // only state where the price of "select a few, download as one ZIP" is
  // readable at a glance.
  'batch-select': {
    run: async ({ panel }) => {
      await selectCards(panel, [0, 1, 2, 3, 5]);
      await panel.waitForTimeout(400);
    },
  },

  // Filters: proves the "41 images, keep the 12 you want" story.
  filters: {
    run: async ({ panel }) => {
      // Select first — clicking a card closes any open dropdown.
      await selectCards(panel, [1, 2, 4, 7]);
      await openFilter(panel, 'Size');
      await panel.mouse.move(0, 0);
    },
  },

  // AI tagging — the feature competitors do not have. Tags live in an overlay on
  // the thumbnail, so a few cards tagged reads better than one.
  'ai-tags': {
    pro: true,
    seed: ({ context, extensionId }) => seedStorage(context, extensionId, { aiTags: AI_TAGS }),
    run: async ({ panel }) => {
      await selectCards(panel, [0, 1, 2]);
      await panel.waitForTimeout(400);
      await panel.mouse.move(0, 0);
    },
  },

  // Collections (Pro) — the "keep a library across pages" story. Favourite a
  // few cards through the real code path, then open the collection modal so the
  // saved library is actually on screen.
  collection: {
    pro: true,
    run: async ({ panel }) => {
      const favs = panel.locator('#image-grid .image-card .btn-favorite');
      for (const i of [0, 1, 2, 3, 5]) await favs.nth(i).click();
      await panel.waitForTimeout(400);
      await panel.locator('#btn-collection').click();
      await panel.waitForFunction(
        () => document.querySelectorAll('#collection-body .collection-card').length > 0,
        undefined,
        { timeout: 15_000 }
      );
      await panel.waitForTimeout(600);
      await panel.mouse.move(0, 0);
    },
  },

  // Deep scan (Pro) — scrolls the page itself.
  deepscan: {
    pro: true,
    pageScroll: 'bottom',
    run: async ({ panel }) => {
      const scan = panel.locator('#btn-deep-scan, .btn-deep-scan').first();
      if (await scan.count()) {
        await scan.click();
        await panel.waitForTimeout(1500);
      }
      await panel.mouse.move(0, 0);
    },
  },

  // Nothing selected: the default state a user sees on first open.
  default: {
    file: 'sidepanel',
    run: async () => {},
  },

  // The browser-action popup. Its own surface, not the panel: 600×600 under
  // the toolbar icon, over the article it just scanned.
  popup: {
    kind: 'popup',
    file: 'popup',
    run: async () => {},
  },

  // Settings. Free tier on purpose: the quota table is the part worth reading
  // (5/mo AI tags, 5/mo colour copy, 3/day deep scan) and it only says
  // something to a user who has not paid yet.
  settings: {
    run: async ({ panel }) => {
      await panel.locator('#btn-settings').click();
      await panel.waitForSelector('#settings-modal:not(.hidden)', { timeout: 10_000 });
      await panel.waitForTimeout(500);
    },
  },

  // Grouping menu. The PRO badges on Domain / Size / Tab are the point: the
  // free option (Format) sits at the top, and the paid ones are visible before
  // the click, not behind an upgrade wall.
  grouping: {
    run: async ({ panel }) => {
      await panel.locator('#btn-group-toggle').click();
      await panel.waitForSelector('#filter-group:not(.hidden)', { timeout: 5_000 });
      await panel.waitForTimeout(300);
    },
  },

  // Duplicate detection. The article's print shop repeats two frames with a
  // `?w=` width param, which is the srcset-variant case the URL phase of
  // detectSimilarImages() exists for — so the groups below are real, not seeded.
  dedup: {
    pro: true,
    run: async ({ panel }) => {
      const link = panel.locator('.similar-inline-link:not(.disabled)');
      await link.waitFor({ timeout: 15_000 });
      await link.click();
      await panel.waitForSelector('#dedup-body .dedup-group', { timeout: 10_000 });
      await panel.waitForTimeout(600);
    },
  },

  // Multi-tab extract. Three articles of the same journal are open; the modal
  // is driven by chrome.tabs, so the titles are whatever the pages actually
  // say.
  multitab: {
    pro: true,
    extraPages: ['store-demo-2.html', 'store-demo-3.html'],
    run: async ({ panel }) => {
      await panel.locator('#btn-multitab').click();
      await panel.waitForSelector('#multitab-modal:not(.hidden)', { timeout: 10_000 });
      await panel.waitForFunction(
        () => document.querySelectorAll('#multitab-list .tab-item').length >= 2,
        undefined,
        { timeout: 10_000 }
      );
      // The harness opens the panel (and the install-time welcome page) as
      // tabs, so #multitab-list contains chrome-extension:// rows no real user
      // selects. Drop them by tab id, then tick the articles the way a user
      // would before pressing Start Extraction.
      await panel.evaluate(async () => {
        const tabs = await window.chrome.tabs.query({ currentWindow: true });
        const own = new Set(
          tabs
            .filter((tab) => (tab.url ?? '').startsWith('chrome-extension://'))
            .map((tab) => String(tab.id))
        );
        for (const row of document.querySelectorAll('#multitab-list .tab-item')) {
          if (own.has(row.getAttribute('data-tab-id') ?? '')) row.remove();
        }
      });
      const rows = panel.locator('#multitab-list .tab-item .tab-checkbox');
      for (let i = 0; i < 3; i += 1) await rows.nth(i).click();
      await panel.waitForTimeout(400);
    },
  },

  // Reverse image search. Free tier again, so the PRO rows on Yandex / Baidu
  // are visible; the cursor stays on the search icon to hold the menu open.
  'reverse-search': {
    keepCursor: true,
    run: async ({ panel }) => {
      await panel.locator('#image-grid .image-card .card-search-group').first().hover();
      await panel.waitForTimeout(450);
    },
  },

  // Upgrade sheet, free tier — what the paywall actually looks like at the
  // moment a quota runs out or "Upgrade to Pro" is clicked.
  upgrade: {
    run: async ({ panel }) => {
      await panel.locator('#btn-upgrade-pro').click();
      await panel.waitForSelector('#pro-upgrade-modal:not(.hidden)', { timeout: 10_000 });
      await panel.waitForTimeout(500);
    },
  },
};

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
async function launch(port, { headed }) {
  if (!existsSync(join(DIST, '.e2e-build'))) {
    throw new Error(
      `dist/ is missing the .e2e-build marker. Run \`npm run build:e2e\` first — ` +
        'a production build would write real telemetry and trial rows from this profile.'
    );
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'image-harvest-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    channel: 'chromium',
    // Store listings are English-only; without this the panel renders in
    // whatever the host machine is set to (zh-CN here).
    locale: 'en-US',
    viewport: { width: PAGE_W, height: HEIGHT },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--host-resolver-rules=MAP ${DEMO_HOST} 127.0.0.1:${port}`,
      '--lang=en-US',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId };
}

/** Both halves at the top of their scroll containers. */
async function scrollToTop(page, panel) {
  if (page) await page.evaluate(() => window.scrollTo(0, 0));
  await resetPanelScroll(panel);
}

/** Composite the two halves on a throwaway page — no image library needed. */
async function compose(context, pagePng, panelPng, outPath) {
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: PAGE_W + PANEL_W, height: HEIGHT });
  const asUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  await canvas.setContent(
    `<body style="margin:0;display:flex;width:${PAGE_W + PANEL_W}px;height:${HEIGHT}px;overflow:hidden">
       <img src="${asUrl(pagePng)}" style="width:${PAGE_W}px;height:${HEIGHT}px;display:block">
       <img src="${asUrl(panelPng)}" style="width:${PANEL_W}px;height:${HEIGHT}px;display:block;box-shadow:inset 1px 0 0 rgba(0,0,0,.22)">
     </body>`
  );
  await canvas.waitForFunction(() => [...document.images].every((i) => i.complete));
  await canvas.screenshot({ path: outPath });
  await canvas.close();
}

/** Same canvas, but the 600×600 popup floats over the article under a shadow. */
async function composePopup(context, pagePng, popupPng, outPath) {
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: CANVAS_W, height: HEIGHT });
  const asUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  await canvas.setContent(
    `<body style="margin:0;position:relative;width:${CANVAS_W}px;height:${HEIGHT}px;overflow:hidden">
       <img src="${asUrl(pagePng)}" style="position:absolute;inset:0;width:${CANVAS_W}px;height:${HEIGHT}px">
       <img src="${asUrl(popupPng)}" style="position:absolute;top:10px;right:12px;width:600px;height:600px;
         border-radius:10px;outline:1px solid rgba(0,0,0,.14);
         box-shadow:0 26px 60px rgba(0,0,0,.34),0 3px 10px rgba(0,0,0,.2)">
     </body>`
  );
  await canvas.waitForFunction(() => [...document.images].every((i) => i.complete));
  await canvas.screenshot({ path: outPath });
  await canvas.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { shots: [], out: null, panel: null, pro: false, rawDir: null, headed: false };
  for (const arg of argv) {
    if (arg.startsWith('--shot=')) opts.shots.push(arg.slice(7));
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else if (arg.startsWith('--panel=')) opts.panel = Number(arg.slice(8));
    else if (arg.startsWith('--raw-dir=')) opts.rawDir = arg.slice(10);
    else if (arg === '--pro') opts.pro = true;
    else if (arg === '--headed') opts.headed = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.out && opts.shots.length !== 1) {
    throw new Error('--out needs exactly one --shot');
  }
  if (opts.panel && (opts.panel < 320 || opts.panel > CANVAS_W - 480)) {
    throw new Error(`--panel must be between 320 and ${CANVAS_W - 480}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.panel) {
    PANEL_W = opts.panel;
    PAGE_W = CANVAS_W - PANEL_W;
  }
  const names = opts.shots.length ? opts.shots : Object.keys(SHOTS);
  for (const name of names) {
    if (!SHOTS[name])
      throw new Error(`Unknown shot "${name}". Known: ${Object.keys(SHOTS).join(', ')}`);
  }

  const server = await startFixtureServer();
  mkdirSync(OUT_DIR, { recursive: true });

  try {
    for (const name of names) {
      const shot = SHOTS[name];
      // Fresh profile per shot. The collection shot writes favourites to
      // IndexedDB and the ai-tags shot seeds chrome.storage; sharing one profile
      // leaked both into whatever was captured next.
      const { context, extensionId } = await launch(server.port, opts);
      try {
        await capture(name, shot, { context, extensionId, opts });
      } finally {
        await context.close();
      }
    }
  } finally {
    await server.close();
  }
}

const DEMO_URL = `http://${DEMO_HOST}/store-demo.html`;

/** The docked side panel, 400 px of a 1280 px window. */
async function openPanel(context, extensionId) {
  const panel = await context.newPage();
  // sidepanel/init.ts only attaches window.__IH__ when this flag is set,
  // and the readiness check below needs it. Has nothing to do with Pro —
  // it just opens the test hooks.
  await panel.addInitScript(() => {
    window.__IH_E2E__ = true;
  });
  await panel.setViewportSize({ width: PANEL_W, height: HEIGHT });
  await panel.goto(`chrome-extension://${extensionId}/pages/sidepanel.html`);
  return panel;
}

/**
 * The browser-action popup, 600×600.
 *
 * Playwright can only open popup.html as a tab, and Chrome then reports that tab
 * as the active one — every scan would land on chrome-extension:// and the UI
 * would lock into the "restricted page" placeholder. Answer tab queries the way
 * Chrome does when the icon is actually clicked: the article under the popup is
 * still the selected tab.
 */
async function openPopup(context, extensionId) {
  const popup = await context.newPage();
  await popup.addInitScript((demoUrl) => {
    window.__IH_E2E__ = true;
    const tabs = window.chrome.tabs;
    const query = tabs.query.bind(tabs);
    const retarget = (list) => {
      const demo = list.find((tab) => tab.url === demoUrl);
      return demo ? [demo, ...list.filter((tab) => tab !== demo)] : list;
    };
    tabs.query = function (info, callback) {
      const wantsActive = Boolean(info && info.active);
      if (typeof callback === 'function') {
        return query(info, (list) => callback(wantsActive ? retarget(list) : list));
      }
      return query(info).then((list) => (wantsActive ? retarget(list) : list));
    };
  }, DEMO_URL);
  await popup.setViewportSize({ width: 600, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/pages/popup.html`);
  return popup;
}

async function capture(name, shot, { context, extensionId, opts }) {
  // Runs before the panel mounts: the first scan is what reads the seeded
  // cache, so it cannot happen after navigation.
  if (shot.seed) await shot.seed({ context, extensionId });

  const isPopup = shot.kind === 'popup';
  const page = await context.newPage();
  // The popup shot has no panel, so the article takes the whole canvas.
  if (isPopup) await page.setViewportSize({ width: CANVAS_W, height: HEIGHT });
  await page.goto(DEMO_URL);
  await page.waitForLoadState('networkidle');
  await page.bringToFront();

  // Extra articles stay open in the same window; the multi-tab modal reads them
  // through chrome.tabs exactly like real sibling tabs.
  if (shot.extraPages) {
    for (const extra of shot.extraPages) {
      const extraPage = await context.newPage();
      await extraPage.goto(`http://${DEMO_HOST}/${extra}`);
      await extraPage.waitForLoadState('networkidle');
    }
    await page.bringToFront();
  }

  const panel = isPopup
    ? await openPopup(context, extensionId)
    : await openPanel(context, extensionId);
  await page.bringToFront();

  await panel.waitForFunction(
    () => document.querySelectorAll('#image-grid .image-card').length > 0,
    undefined,
    { timeout: 30_000 }
  );
  await panel.waitForFunction(() => window.__IH__?.store.get('isInitialized') === true, undefined, {
    timeout: 15_000,
  });
  if (opts.pro || shot.pro) await enablePro(panel);

  await panel.evaluate(() => window.scrollTo(0, 0));
  // Dismiss first-run chrome before the shot runs: its close buttons are
  // clicks on the document, which would immediately close any dropdown the
  // shot opened.
  await dismissNudges(panel);
  await shot.run({ page, panel });
  // A rescan re-arms the "N images ready to download" bar.
  await dismissNudges(panel);
  await dismissPageHighlight(page, isPopup ? CANVAS_W : PAGE_W);
  // Deep scan lands at the end of the document; the frame is worth more when it
  // shows content the panel found below the fold instead of the same hero shot
  // every other screenshot already has.
  await scrollToTop(shot.pageScroll === 'bottom' ? null : page, panel);
  if (shot.pageScroll === 'bottom') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
  }
  await waitForToastsToClear(panel);
  // Hover-driven menus (the reverse-search dropdown) only stay open while the
  // cursor does; parking it in the corner would close them before the shot.
  if (!shot.keepCursor) await panel.mouse.move(0, 0);
  await panel.waitForTimeout(250);
  await waitForThumbnails(panel);

  const pagePng = await page.screenshot();
  const panelPng = await panel.screenshot();
  if (opts.rawDir) {
    mkdirSync(opts.rawDir, { recursive: true });
    writeFileSync(join(opts.rawDir, `${name}-page.png`), pagePng);
    writeFileSync(join(opts.rawDir, `${name}-panel.png`), panelPng);
  }

  const outPath = opts.out ?? join(OUT_DIR, `${shot.file ?? name}-1280.png`);
  mkdirSync(dirname(outPath), { recursive: true });
  if (isPopup) await composePopup(context, pagePng, panelPng, outPath);
  else await compose(context, pagePng, panelPng, outPath);
  console.log(`${name.padEnd(14)} → ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
