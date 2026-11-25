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
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(REPO, 'dist');
const FIXTURES = join(REPO, 'e2e', 'fixtures');
const OUT_DIR = join(REPO, 'assets', 'screenshots');

const CANVAS_W = 1280;
const HEIGHT = 800;

// Both are mutable so --panel can shift the split; the page keeps the rest.
let PANEL_W = 400;
let PAGE_W = CANVAS_W - PANEL_W;

// Images are requested as `demo/foo.jpg`, so the URL printed on every card
// would otherwise read `127.0.0.1:54321/demo/foo.jpg` — the loudest tell that
// the page is a fixture. Map a plain hostname onto the local fixture server
// instead; nothing leaves the machine.
const DEMO_HOST = 'fieldnotes.test';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Fixture server
// ---------------------------------------------------------------------------
function startFixtureServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer((req, res) => {
      if (!req.url || req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
      }
      const path = decodeURIComponent(req.url.split('?')[0]);
      const fullPath = join(FIXTURES, path);
      if (!fullPath.startsWith(FIXTURES)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      try {
        const body = readFileSync(fullPath);
        res.setHeader('Content-Type', MIME[extname(fullPath)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

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

  // Nothing selected: the default state a user sees on first open. Saved as
  // sidepanel-* because that is the name the READMEs and the listing use.
  default: {
    file: 'sidepanel',
    run: async () => {},
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

async function enablePro(panel) {
  await panel.waitForFunction(() => Boolean(window.__IH__), undefined, { timeout: 10_000 });
  await panel.evaluate(() => {
    const chromeApi = window.chrome;
    const original = chromeApi.runtime.sendMessage.bind(chromeApi.runtime);
    chromeApi.runtime.sendMessage = (request, ...rest) => {
      if (request && request.type === 'VALIDATE_LICENSE') {
        return Promise.resolve({ isPro: true, expiresAt: null });
      }
      return original(request, ...rest);
    };
    window.__IH__.store.set('isProUser', true);
  });
}

/** Wait until every on-screen thumbnail has decoded, so no shot catches a blank card. */
async function waitForThumbnails(panel) {
  await panel.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('#image-grid .card-thumb img')];
      const visible = imgs.filter((img) => {
        const box = img.getBoundingClientRect();
        return box.top < window.innerHeight && box.bottom > 0;
      });
      return visible.length > 0 && visible.every((img) => img.complete && img.naturalWidth > 0);
    },
    undefined,
    { timeout: 15_000 }
  );
}

/**
 * Selecting a card from the panel dims the page to 50% black and outlines the
 * matching image — the extension's "show me this one on the page" view. It is
 * the right behaviour in use, but in a still frame it just reads as a dimmed,
 * muddy screenshot, so a click exits it (which the UI supports) and keeps the
 * selection intact.
 */
async function dismissPageHighlight(page) {
  const dimmed = await page.evaluate(() =>
    Boolean(document.querySelector('.image-harvest-overlay'))
  );
  if (!dimmed) return;
  // Empty area to the right of the headline — no link, no image.
  await page.mouse.click(PAGE_W - 120, 110);
  await page.waitForTimeout(250);
}

/**
 * First-run chrome (referral banner, "N images ready to download" bar, the
 * 3-step coach mark) is designed to be dismissed on first use. Every real
 * screenshot of a working session has it out of the way already.
 */
async function dismissNudges(panel) {
  for (const selector of [
    '.referral-banner-close',
    '.download-nudge-close',
    '.onboarding-coach-close',
  ]) {
    const button = panel.locator(selector).first();
    if ((await button.count()) && (await button.isVisible())) {
      await button.click({ timeout: 2_000 }).catch(() => {});
      await panel.waitForTimeout(200);
    }
  }
}

/**
 * Reset both scroll positions. `#image-grid` is its own scroll container, so
 * window.scrollTo() alone leaves the grid wherever the last clicked card was —
 * which silently crops the first card's checkbox out of the frame.
 */
async function scrollToTop(page, panel) {
  if (page) await page.evaluate(() => window.scrollTo(0, 0));
  await panel.evaluate(() => {
    window.scrollTo(0, 0);
    document.getElementById('image-grid')?.scrollTo(0, 0);
  });
}

/** Toasts ("Found 9 images", "Downloaded 5 files") auto-fade; wait them out. */
async function waitForToastsToClear(panel) {
  await panel
    .waitForFunction(
      () => document.querySelectorAll('#toast-container .toast').length === 0,
      undefined,
      { timeout: 8_000 }
    )
    .catch(() => {});
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

async function capture(name, shot, { context, extensionId, opts }) {
  // Runs before the panel mounts: the first scan is what reads the seeded
  // cache, so it cannot happen after navigation.
  if (shot.seed) await shot.seed({ context, extensionId });

  const page = await context.newPage();
  await page.goto(`http://${DEMO_HOST}/store-demo.html`);
  await page.waitForLoadState('networkidle');
  await page.bringToFront();

  const panel = await context.newPage();
  // sidepanel/init.ts only attaches window.__IH__ when this flag is set,
  // and the readiness check below needs it. Has nothing to do with Pro —
  // it just opens the test hooks.
  await panel.addInitScript(() => {
    window.__IH_E2E__ = true;
  });
  await panel.setViewportSize({ width: PANEL_W, height: HEIGHT });
  await panel.goto(`chrome-extension://${extensionId}/pages/sidepanel.html`);
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
  await dismissPageHighlight(page);
  // Deep scan lands at the end of the document; the frame is worth more when it
  // shows content the panel found below the fold instead of the same hero shot
  // every other screenshot already has.
  await scrollToTop(shot.pageScroll === 'bottom' ? null : page, panel);
  if (shot.pageScroll === 'bottom') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
  }
  await waitForToastsToClear(panel);
  await panel.mouse.move(0, 0);
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
  await compose(context, pagePng, panelPng, outPath);
  console.log(`${name.padEnd(14)} → ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
