// content/auto-scroll.ts — stop-condition matrix + scroll restore + abort.
//
// Strategy: fully injected deps (no real window/document scroll APIs) with
// tiny limit overrides so every stop reason is reachable in milliseconds.
// scrollBy simulates the browser's clamping at the document end, which is
// what makes the bottom-detection branch reachable.

import { describe, expect, it, vi } from 'vitest';
import type { ImageItem } from '../shared/types';
import {
  DEEP_SCAN_LIMITS,
  abortDeepScan,
  createDefaultDeps,
  isDeepScanRunning,
  runDeepScan,
  type DeepScanDeps,
} from '../content/auto-scroll';

const FAST = { STEP_WAIT_MS: 40, MUTATION_QUIET_MS: 10 } as const;

function img(url: string): ImageItem {
  return { url } as unknown as ImageItem;
}

interface DepHarness {
  deps: DeepScanDeps;
  scrollY: () => number;
  fireMutation: (added: number) => void;
  restoreSpy: ReturnType<typeof vi.fn>;
  setDocHeight: (h: number) => void;
}

/**
 * Build a dep set with a simulated 1000px viewport. scrollBy clamps at
 * (docHeight - viewport) like a real browser; observeMutations captures the
 * callback so the test decides when lazy content "loads".
 */
function makeDeps(overrides: Partial<DeepScanDeps> = {}): DepHarness {
  let scrollY = 0;
  let docHeight = 3000;
  let mutationCb: ((added: number) => void) | null = null;
  const restoreSpy = vi.fn((y: number) => {
    scrollY = y;
  });

  const deps: DeepScanDeps = {
    extractImages: vi.fn(async () => [img('a'), img('b'), img('c')]),
    getGalleryLinks: vi.fn(() => ['https://example.com/g/1']),
    getScrollY: () => scrollY,
    getViewportHeight: () => 1000,
    getDocumentHeight: () => docHeight,
    scrollBy: (y: number) => {
      scrollY = Math.min(scrollY + y, Math.max(0, docHeight - 1000));
    },
    scrollToInstant: restoreSpy,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    observeMutations: (cb) => {
      mutationCb = cb;
      return () => {
        mutationCb = null;
      };
    },
    ...overrides,
  };

  return {
    deps,
    scrollY: () => scrollY,
    fireMutation: (added: number) => mutationCb?.(added),
    restoreSpy,
    setDocHeight: (h: number) => {
      docHeight = h;
    },
  };
}

describe('runDeepScan — stop conditions', () => {
  it('reaches the bottom with stable document height → stopReason "bottom" + restores scroll', async () => {
    const h = makeDeps(); // docHeight 3000, viewport 1000 → bottom at scrollY 2000
    const result = await runDeepScan({ deps: h.deps, limits: FAST });

    expect(result.stopReason).toBe('bottom');
    // 0→900→1800→2000 (bottomStreak 1) → still 2000 (bottomStreak 2) = 4 steps.
    expect(result.steps).toBe(4);
    // Scroll position restored to where the user was before the run.
    expect(h.restoreSpy).toHaveBeenCalledWith(0);
    expect(h.scrollY()).toBe(0);
    expect(result.images).toHaveLength(3);
    expect(result.galleryLinks).toEqual(['https://example.com/g/1']);
    expect(result.newCount).toBe(0); // final pass identical to baseline
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(isDeepScanRunning()).toBe(false);
  });

  it('no new content for STALL_STEPS consecutive steps → "stalled"', async () => {
    const h = makeDeps();
    // Ever-growing document prevents the bottom branch from firing.
    let hCounter = 3000;
    h.deps.getDocumentHeight = () => (hCounter += 1000);
    const result = await runDeepScan({
      deps: h.deps,
      limits: { ...FAST, STALL_STEPS: 2 },
    });

    expect(result.stopReason).toBe('stalled');
    expect(result.steps).toBe(2);
  });

  it('mutation batches beyond MAX_NEW_IMAGES → "maxImages"', async () => {
    const h = makeDeps();
    h.deps.observeMutations = (cb) => {
      // Each step's observer immediately reports a flood of new nodes.
      setTimeout(() => cb(100), 0);
      return () => {};
    };
    const result = await runDeepScan({
      deps: h.deps,
      limits: { ...FAST, MAX_NEW_IMAGES: 150 },
    });

    expect(result.stopReason).toBe('maxImages');
    expect(result.steps).toBe(2); // check happens at the TOP of step 3
  });

  it('hits MAX_STEPS on an endless feed → "maxSteps"', async () => {
    const h = makeDeps();
    let hCounter = 3000;
    h.deps.getDocumentHeight = () => (hCounter += 1000); // never bottom
    h.deps.observeMutations = (cb) => {
      setTimeout(() => cb(1), 0); // never stalled, below MAX_NEW_IMAGES
      return () => {};
    };
    const result = await runDeepScan({
      deps: h.deps,
      limits: { ...FAST, MAX_STEPS: 3 },
    });

    expect(result.stopReason).toBe('maxSteps');
    expect(result.steps).toBe(3);
  });

  it('exceeds MAX_DURATION_MS → "maxDuration" before any step runs', async () => {
    const h = makeDeps();
    let calls = 0;
    h.deps.now = () => (calls++ === 0 ? 0 : 99_999); // startedAt=0, everything else "later"
    const result = await runDeepScan({ deps: h.deps, limits: FAST });

    expect(result.stopReason).toBe('maxDuration');
    expect(result.steps).toBe(0);
  });

  it('abortDeepScan mid-run → "aborted", scroll restored, stats still returned', async () => {
    const h = makeDeps({
      // Slow steps so the abort lands during the first wait.
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    });
    const pending = runDeepScan({
      deps: h.deps,
      limits: { STEP_WAIT_MS: 5_000, MUTATION_QUIET_MS: 4_000 },
    });

    expect(isDeepScanRunning()).toBe(true);
    abortDeepScan();
    const result = await pending;

    expect(result.stopReason).toBe('aborted');
    expect(h.restoreSpy).toHaveBeenCalledWith(0);
    expect(result.steps).toBeGreaterThanOrEqual(0);
    expect(isDeepScanRunning()).toBe(false);
  });

  it('newCount is the authoritative final-minus-baseline diff', async () => {
    const finalSet = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(img);
    let pass = 0;
    const h = makeDeps({
      extractImages: vi.fn(async () => (pass++ === 0 ? [img('a'), img('b'), img('c')] : finalSet)),
    });
    const result = await runDeepScan({ deps: h.deps, limits: FAST });

    expect(result.newCount).toBe(5);
    expect(result.images).toEqual(finalSet);
  });
});

describe('runDeepScan — re-entry guard', () => {
  it('rejects a second run while one is active', async () => {
    const h = makeDeps();
    const first = runDeepScan({
      deps: h.deps,
      limits: { STEP_WAIT_MS: 200, MUTATION_QUIET_MS: 150 },
    });
    await expect(runDeepScan({ deps: makeDeps().deps, limits: FAST })).rejects.toThrow(
      'deep_scan_in_progress'
    );
    abortDeepScan();
    await first;
    expect(isDeepScanRunning()).toBe(false);
  });
});

describe('createDefaultDeps', () => {
  it('wires the two injected callbacks and returns callable DOM deps', () => {
    const extractImages = vi.fn(async () => [img('x')]);
    const getGalleryLinks = vi.fn(() => ['g']);
    const deps = createDefaultDeps(extractImages, getGalleryLinks);

    expect(deps.extractImages).toBe(extractImages);
    expect(deps.getGalleryLinks).toBe(getGalleryLinks);
    expect(typeof deps.getViewportHeight).toBe('function');
    expect(typeof deps.observeMutations).toBe('function');
  });
});
