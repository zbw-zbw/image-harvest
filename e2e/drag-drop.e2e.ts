// e2e: image cards are wired up as draggable elements via
// actions.setupDragAndDrop (called from ImageCard.useEffect on mount).
// On dragstart we stamp three things into DataTransfer so the drop
// target — typically an OS file manager or a browser window — can
// pick the image up:
//   - text/uri-list   → the canonical URL list mimetype
//   - text/plain      → fallback for targets that only read plain text
//   - effectAllowed='copy' → tells the OS this is a copy gesture
//
// Why this matters: this is the contract between Image Harvest and
// every external drop target. Regressions here silently break the
// "drag images out of the panel" power-user feature with no error
// message. We can't actually drag to an OS window from Playwright,
// but we can dispatch a synthetic dragstart and observe what the
// handler stamped into the event's dataTransfer.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type LaunchedExtension,
} from './_helpers/launchExtension';

let ext: LaunchedExtension;
let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
  await fixtureServer?.close();
});

test('image cards are draggable and stamp text/uri-list + text/plain on dragstart', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // setupDragAndDrop is invoked imperatively against the .card-thumb
  // div (ImageCard.tsx > thumbRef.current). It calls
  // setAttribute('draggable', 'true') and registers a dragstart
  // listener that stamps DataTransfer fields.
  const thumbHandle = await sidepanel.locator('#image-grid .image-card .card-thumb').first();
  await expect(thumbHandle).toHaveAttribute('draggable', 'true');

  // Capture the first card's URL so we know what to assert against.
  const firstUrl = await sidepanel.evaluate(() => {
    return document.querySelector<HTMLImageElement>('#image-grid .image-card img')?.src ?? '';
  });
  expect(firstUrl).toBeTruthy();

  // Synthetic DragEvent has a read-only dataTransfer.effectAllowed
  // outside a real user-gesture context (Chromium silently drops the
  // setter). To verify the handler's intent we install a spying proxy
  // that records every setData() call and every effectAllowed
  // assignment, then dispatch the dragstart and read the recorded log.
  const log = await sidepanel.evaluate(() => {
    const thumb = document.querySelector<HTMLElement>('#image-grid .image-card .card-thumb');
    if (!thumb) return null;
    const setDataCalls: Array<{ format: string; data: string }> = [];
    let effectAllowedAssigned: string | null = null;
    const spy = {
      setData(format: string, data: string) {
        setDataCalls.push({ format, data });
      },
      get effectAllowed() {
        return effectAllowedAssigned ?? 'uninitialized';
      },
      set effectAllowed(v: string) {
        effectAllowedAssigned = v;
      },
    };
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    // Replace the otherwise-read-only dataTransfer with our spy.
    Object.defineProperty(ev, 'dataTransfer', { value: spy, configurable: true });
    thumb.dispatchEvent(ev);
    return { setDataCalls, effectAllowedAssigned };
  });

  expect(log).not.toBeNull();
  expect(log!.setDataCalls).toEqual([
    { format: 'text/uri-list', data: firstUrl },
    { format: 'text/plain', data: firstUrl },
  ]);
  expect(log!.effectAllowedAssigned).toBe('copy');
});
