#!/usr/bin/env node
/**
 * Record the website hero clip from the real extension.
 *
 * The GIF it replaces was a screen recording of someone's desktop: menu bar,
 * Chrome tab strip, Dock and the recorder's own floating toolbar all in frame,
 * 1280x720 cropped into a 1280x800 box, 300 dithered frames in 6.7 MB. This
 * records only the two surfaces that matter and composites them the same way
 * the store screenshots are composited:
 *
 *     ┌───────────────────────────────┬──────────────┐
 *     │ demo page  880 px (still)     │ side panel   │
 *     │                               │ 400 px (live)│
 *     └───────────────────────────────┴──────────────┘
 *                        1280 × 800
 *
 * Only the panel moves, so only the panel is recorded (Chromium records a page
 * at its real frame rate); the page half is a still. A synthetic cursor is
 * injected into the panel because Chromium's recorder does not capture one.
 *
 * Requirements
 *   npm run build:e2e
 *   node scripts/record-hero-video.mjs          # writes hero.mp4, hero.gif, poster
 *
 * The GIF is a downscaled copy for README embeds (GitHub will not play an mp4
 * inline); the site uses the mp4, which is a twentieth of the size.
 *
 * Options
 *   --out-dir=<dir>   where to write the outputs (default assets/demo)
 *   --headed          show the browser window while recording
 *   --keep-frames     keep the extracted PNG frames next to the output
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_HOST, startFixtureServer } from './_demo-page-server.mjs';
import {
  dismissNudges,
  dismissPageHighlight,
  scrollToTop,
  waitForThumbnails,
  waitForToastsToClear,
} from './_panel-controls.mjs';

const REPO = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(REPO, 'dist');

const PAGE_W = 880;
const PANEL_W = 400;
const HEIGHT = 800;

/** Idle beat between the marker flash and the first click. */
const IDLE_LEAD = 1_400;
/** The marker is sampled at this rate, independent of the screencast's. */
const MARKER_FPS = 50;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const opts = { outDir: join(REPO, 'assets', 'demo'), headed: false, keepFrames: false };
  for (const arg of argv) {
    if (arg.startsWith('--out-dir=')) opts.outDir = resolve(arg.slice(10));
    else if (arg === '--headed') opts.headed = true;
    else if (arg === '--keep-frames') opts.keepFrames = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

async function launch(port, { headed }) {
  if (!existsSync(join(DIST, '.e2e-build'))) {
    throw new Error('dist/ is missing the .e2e-build marker. Run `npm run build:e2e` first.');
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'image-harvest-hero-'));
  const videoDir = join(userDataDir, 'video');
  mkdirSync(videoDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    channel: 'chromium',
    locale: 'en-US',
    viewport: { width: PAGE_W, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: PANEL_W, height: HEIGHT } },
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
  return { context, videoDir, userDataDir, extensionId };
}

// ---------------------------------------------------------------------------
// Synthetic cursor
// ---------------------------------------------------------------------------
const CURSOR_SVG = `
  <svg width="22" height="26" viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 2 L3 19 L7.6 14.9 L10.9 22.5 L14.2 21 L10.9 13.6 L17 13.2 Z"
          fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;

async function installCursor(panel) {
  await panel.evaluate((svg) => {
    if (document.getElementById('__record_cursor')) return;
    const el = document.createElement('div');
    el.id = '__record_cursor';
    el.innerHTML = svg;
    el.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:2147483647',
      'pointer-events:none',
      'will-change:transform',
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))',
      'transform:translate(-100px,-100px)',
    ].join(';');
    document.body.appendChild(el);
  }, CURSOR_SVG);
}

async function setCursor(panel, x, y) {
  await panel.evaluate(
    ([cx, cy]) => {
      const el = document.getElementById('__record_cursor');
      if (el) el.style.transform = `translate(${cx}px, ${cy}px)`;
    },
    [x, y]
  );
}

/** Ease the fake cursor to a point, then click the element for real. */
async function clickWithCursor(panel, locator, { ms = 480 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot click an element that is not visible');
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = await panel.evaluate(() => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
      document.getElementById('__record_cursor')?.style.transform ?? ''
    );
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
  });
  const steps = Math.max(3, Math.round(ms / 40));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await setCursor(panel, from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(ms / steps);
  }
  await locator.click();
}

// ---------------------------------------------------------------------------
// Trim marker
// ---------------------------------------------------------------------------
/**
 * Full-panel colour flash, cut out of the finished clip.
 *
 * A screencast's timestamps do not track wall clock — Chromium drops frames
 * while the panel loads, so a trim point calculated from Date.now() lands
 * anywhere from one to two seconds off. Flashing an unmistakable colour on the
 * first frame the clip should start at lets encode() measure the trim point
 * inside the video, where dropped frames cannot skew it.
 */
async function flashMarker(panel) {
  await panel.evaluate(async () => {
    const el = document.createElement('div');
    el.id = '__record_marker';
    el.style.cssText =
      'position:fixed;inset:0;background:#ff00ff;z-index:2147483646;pointer-events:none';
    document.body.appendChild(el);
    // Give the compositor a paint so the flash cannot be skipped entirely.
    await new Promise((paint) =>
      requestAnimationFrame(() => requestAnimationFrame(() => paint(null)))
    );
  });
  await sleep(150);
  await panel.evaluate(() => document.getElementById('__record_marker')?.remove());
}

/**
 * Seconds into the recording where the marker's flash ends. Sampled from the
 * bottom-right corner, which the marker covers and where no panel content is
 * that colour afterwards.
 */
function findMarkerEnd(videoPath) {
  const raw = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-vf',
      `fps=${MARKER_FPS},crop=8:8:384:784,scale=1:1`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  let inFlash = false;
  for (let index = 0; index * 3 + 2 < raw.length; index += 1) {
    const [r, g, b] = [raw[index * 3], raw[index * 3 + 1], raw[index * 3 + 2]];
    const magenta = r > 170 && g < 100 && b > 170;
    if (magenta) inFlash = true;
    else if (inFlash) return index / MARKER_FPS;
  }
  throw new Error('Trim marker not found in the recording — nothing to cut against');
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
async function record({ context, extensionId }) {
  const page = await context.newPage();
  await page.goto(`http://${DEMO_HOST}/store-demo.html`);
  await page.waitForLoadState('networkidle');
  await page.bringToFront();

  // The panel's screencast is anchored to the moment the browser context
  // started, not to this page's creation — see videoZero in main().
  const panel = await context.newPage();
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
  await scrollToTop(panel);
  await waitForThumbnails(panel);

  // The bringToFront() above arms a second scan, and that scan re-adds the
  // "N images ready to download" bar and a "Found 9 images" toast a beat
  // later. Clear both before the first frame we keep.
  await sleep(900);
  await dismissNudges(panel);
  await scrollToTop(panel);
  await waitForToastsToClear(panel);
  await installCursor(panel);
  // Park both cursors somewhere plausible and empty, so the opening frame has
  // no stray :hover outline on a card and the first click glides in from the
  // toolbar instead of flying out of the corner.
  await setCursor(panel, 300, 44);
  await panel.mouse.move(300, 44);
  await sleep(600);

  await flashMarker(panel);
  await sleep(IDLE_LEAD);

  const checkboxes = panel.locator('#image-grid .image-card .card-checkbox');
  for (const index of [0, 1, 2]) {
    await clickWithCursor(panel, checkboxes.nth(index));
    await sleep(300);
  }

  // The third checkbox scrolls the grid; bring the first card back so the
  // ticked thumbnails and the "(3)" bar share the frame.
  await panel.evaluate(() =>
    document.getElementById('image-grid')?.scrollTo({ top: 0, behavior: 'smooth' })
  );
  await sleep(700);
  // Selecting dims the demo page and scrolls it to the matching image. That is
  // a real feature, but the still half of the video wants the page's own hero.
  await dismissPageHighlight(page, PAGE_W);
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForThumbnails(panel);

  // Poster frame: the ticked cards and the "(3)" action bar, which is the
  // promise the clip is making. The batch itself finishes in a couple of
  // hundred milliseconds against local files, so there is nothing to watch —
  // and its completion toast miscounts multi-image batches today.
  await sleep(2_000);
  const posterPng = await panel.screenshot();
  const pagePng = await page.screenshot();

  // The video handle has to be taken before the page closes.
  const video = panel.video();
  await panel.close();
  await page.close();

  return { pagePng, posterPng, video };
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------
function run(command, args) {
  execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function encode({ videoPath, pagePngPath, outDir, offset }) {
  // Normalise the recorded panel to a constant 30 fps, then stack it beside the
  // still page half. Both inputs are forced to the same size and SAR so hstack
  // cannot refuse the inputs. The still is an infinite `-loop 1` input, so
  // hstack has to stop at the shortest side or ffmpeg never finishes writing —
  // that also makes the poster hold the last frame of the clip.
  run('ffmpeg', [
    '-y',
    '-loop',
    '1',
    '-i',
    pagePngPath,
    '-ss',
    offset.toFixed(2),
    '-i',
    videoPath,
    '-filter_complex',
    `[0:v]scale=${PAGE_W}:${HEIGHT},setsar=1[page];` +
      `[1:v]fps=30,scale=${PANEL_W}:${HEIGHT},setsar=1[panel];` +
      `[page][panel]hstack=inputs=2:shortest=1[out]`,
    '-map',
    '[out]',
    // Without this the hstacked pair inherits the fps the screencast hands
    // back and the file grows for motion nobody can see.
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    join(outDir, 'hero.mp4'),
  ]);

  // README-only copy. 12 fps and a 192-colour palette with ordered dithering
  // keeps a photographic clip near 2 MB instead of the 6.7 MB it replaces.
  run('ffmpeg', [
    '-y',
    '-i',
    join(outDir, 'hero.mp4'),
    '-vf',
    'fps=12,scale=720:-1:flags=lanczos,' +
      'split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];' +
      '[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop',
    '0',
    join(outDir, 'hero.gif'),
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });

  const server = await startFixtureServer();
  const workDir = mkdtempSync(join(tmpdir(), 'image-harvest-hero-frames-'));
  const { context, userDataDir, extensionId } = await launch(server.port, opts);
  let closed = false;

  try {
    const { pagePng, posterPng, video } = await record({ context, extensionId });
    if (!video) throw new Error('No video handle: recordVideo did not attach to the panel page');

    // Composites happen in a plain page: no image library, no extra process.
    const pagePngPath = join(workDir, 'page.png');
    writeFileSync(pagePngPath, pagePng);
    const canvas = await context.newPage();
    await canvas.setViewportSize({ width: PAGE_W + PANEL_W, height: HEIGHT });
    const asUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
    await canvas.setContent(
      `<body style="margin:0;display:flex;width:${PAGE_W + PANEL_W}px;height:${HEIGHT}px;overflow:hidden">
         <img src="${asUrl(pagePng)}" style="width:${PAGE_W}px;height:${HEIGHT}px;display:block">
         <img src="${asUrl(posterPng)}" style="width:${PANEL_W}px;height:${HEIGHT}px;display:block;box-shadow:inset 1px 0 0 rgba(0,0,0,.22)">
       </body>`
    );
    await canvas.waitForFunction(() => [...document.images].every((i) => i.complete));
    await canvas.screenshot({
      path: join(opts.outDir, 'hero-poster.jpg'),
      type: 'jpeg',
      quality: 88,
    });
    await canvas.close();
    await context.close();
    closed = true;

    const videoPath = await video.path();
    // Kept alongside the encode so a bad trim can be re-cut without re-recording.
    if (opts.keepFrames) copyFileSync(videoPath, join(opts.outDir, 'panel-raw.webm'));
    const offset = findMarkerEnd(videoPath);
    encode({
      videoPath,
      pagePngPath,
      outDir: opts.outDir,
      offset,
    });
    console.log(`hero.mp4        → ${join(opts.outDir, 'hero.mp4')}`);
    console.log(`                trimmed the first ${offset.toFixed(2)}s of setup`);
    console.log(`hero.gif        → ${join(opts.outDir, 'hero.gif')}`);
    console.log(`hero-poster.jpg → ${join(opts.outDir, 'hero-poster.jpg')}`);
  } finally {
    if (!closed) await context.close().catch(() => {});
    await server.close();
    rmSync(userDataDir, { recursive: true, force: true });
    if (!opts.keepFrames) rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
