// Deep scan (v1.2.0): auto-scroll the page to trigger lazy-loaded images.
//
// Self-contained controller. The only production wiring is main.ts calling
// runDeepScan with createDefaultDeps(extractImages, getGalleryLinks) — the
// two callbacks are injected to avoid a circular module dependency
// (main → auto-scroll → main). Live monitoring (started by the background
// BEFORE START_DEEP_SCAN) keeps pushing IMAGES_DISCOVERED increments to the
// panel for the whole run, so progress needs no channel of its own here.
//
// Stop reasons (spec §3.1): bottom | stalled | maxSteps | maxDuration |
// maxImages | aborted.

import type { ImageItem } from '../shared/types';

export const DEEP_SCAN_LIMITS = {
  /** Fraction of viewport height scrolled per step. */
  STEP_RATIO: 0.9,
  /** Max wait per step for lazy loads to fire. */
  STEP_WAIT_MS: 700,
  /** MutationObserver quiet period that ends a step early. */
  MUTATION_QUIET_MS: 400,
  /** Hard cap on scroll steps (infinite-feed protection). */
  MAX_STEPS: 40,
  /** Hard cap on total run duration. */
  MAX_DURATION_MS: 45_000,
  /** Stop early once this many new img/picture nodes were seen (runaway feeds). */
  MAX_NEW_IMAGES: 500,
  /** Consecutive steps with zero new images → stop as 'stalled'. */
  STALL_STEPS: 3,
  /** Consecutive steps at bottom without document-height growth → 'bottom'. */
  HEIGHT_STALL_STEPS: 2,
} as const;

export type DeepScanStopReason =
  | 'bottom'
  | 'stalled'
  | 'maxSteps'
  | 'maxDuration'
  | 'maxImages'
  | 'aborted';

export interface DeepScanResult {
  images: ImageItem[];
  galleryLinks: string[];
  /** Authoritative diff: final-pass count minus the baseline count. */
  newCount: number;
  steps: number;
  durationMs: number;
  stopReason: DeepScanStopReason;
}

export interface DeepScanDeps {
  /** One full extraction pass over the current DOM (injected by main.ts). */
  extractImages: () => Promise<ImageItem[]>;
  /** Read the link-stage gallery candidates (injected by main.ts). */
  getGalleryLinks: () => string[];
  getScrollY: () => number;
  getViewportHeight: () => number;
  getDocumentHeight: () => number;
  scrollBy: (y: number) => void;
  scrollToInstant: (y: number) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /**
   * Observe DOM mutations, invoking cb with the number of added img/picture
   * nodes per batch. Returns a stop function.
   */
  observeMutations: (cb: (addedImages: number) => void) => () => void;
}

/** Numeric limit bag matching DEEP_SCAN_LIMITS' keys (overrides widen literals). */
export type DeepScanLimits = Record<keyof typeof DEEP_SCAN_LIMITS, number>;

export interface DeepScanOptions {
  deps: DeepScanDeps;
  /** Test-only overrides; production uses DEEP_SCAN_LIMITS untouched. */
  limits?: Partial<DeepScanLimits>;
}

/** Production dep factory — main.ts injects its own extraction pipeline. */
export function createDefaultDeps(
  extractImages: () => Promise<ImageItem[]>,
  getGalleryLinks: () => string[]
): DeepScanDeps {
  return {
    extractImages,
    getGalleryLinks,
    getScrollY: () => window.scrollY,
    getViewportHeight: () => window.innerHeight,
    getDocumentHeight: () => document.documentElement.scrollHeight,
    scrollBy: (y) => window.scrollBy(0, y),
    scrollToInstant: (y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    observeMutations: (cb) => {
      const observer = new MutationObserver((mutations) => {
        let added = 0;
        for (const m of mutations) {
          m.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const el = node as Element;
            if (el.tagName === 'IMG' || el.tagName === 'PICTURE') added += 1;
            added += el.querySelectorAll?.('img, picture').length ?? 0;
          });
        }
        if (added > 0) cb(added);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  };
}

// ── Run registry ─────────────────────────────────────────────────────
// One active run per content-script instance (main frame). abortDeepScan
// flips the flag; the loop checks it at every step boundary and at every
// 50ms poll inside waitForStep.
interface ActiveRun {
  aborted: boolean;
}
let activeRun: ActiveRun | null = null;

export function isDeepScanRunning(): boolean {
  return activeRun !== null;
}

/** Abort the active run; it still finishes its current step and returns stats. */
export function abortDeepScan(): void {
  if (activeRun) activeRun.aborted = true;
}

export async function runDeepScan(options: DeepScanOptions): Promise<DeepScanResult> {
  if (activeRun) {
    throw new Error('deep_scan_in_progress');
  }
  const run: ActiveRun = { aborted: false };
  activeRun = run;
  try {
    return await doRunDeepScan(options, run);
  } finally {
    if (activeRun === run) activeRun = null;
  }
}

/**
 * Wait out one scroll step: until STEP_WAIT_MS elapses OR mutations stay
 * quiet for MUTATION_QUIET_MS (spec §3.1 step 3) OR the run is aborted.
 * The quiet timer starts at step start, so a step with no lazy content
 * costs MUTATION_QUIET_MS, not the full STEP_WAIT_MS.
 */
async function waitForStep(
  deps: DeepScanDeps,
  limits: DeepScanLimits,
  run: ActiveRun,
  onMutation: (added: number) => void
): Promise<void> {
  const startedAt = deps.now();
  let lastMutationAt = startedAt;
  const stop = deps.observeMutations((added) => {
    lastMutationAt = deps.now();
    onMutation(added);
  });
  try {
    for (;;) {
      if (run.aborted) return;
      const now = deps.now();
      if (now - startedAt >= limits.STEP_WAIT_MS) return;
      if (now - lastMutationAt >= limits.MUTATION_QUIET_MS) return;
      await deps.sleep(50);
    }
  } finally {
    stop();
  }
}

async function doRunDeepScan(options: DeepScanOptions, run: ActiveRun): Promise<DeepScanResult> {
  const deps = options.deps;
  const limits: DeepScanLimits = { ...DEEP_SCAN_LIMITS, ...options.limits };
  const startedAt = deps.now();
  const originalScrollY = deps.getScrollY();

  // Baseline: what the plain scan already sees. The final pass diffs
  // against this for the authoritative newCount — the panel uses it for
  // the quota charge + toast, telemetry as the run's value metric.
  const baselineImages = await deps.extractImages();
  const baselineCount = baselineImages.length;

  let steps = 0;
  let zeroNewStreak = 0;
  let bottomStreak = 0;
  let mutationNewCount = 0; // approximate, from mutation batches
  let stopReason: DeepScanStopReason | null = null;

  try {
    while (!stopReason) {
      if (run.aborted) {
        stopReason = 'aborted';
        break;
      }
      if (steps >= limits.MAX_STEPS) {
        stopReason = 'maxSteps';
        break;
      }
      if (deps.now() - startedAt >= limits.MAX_DURATION_MS) {
        stopReason = 'maxDuration';
        break;
      }
      if (mutationNewCount >= limits.MAX_NEW_IMAGES) {
        stopReason = 'maxImages';
        break;
      }

      const heightBefore = deps.getDocumentHeight();
      const stepDelta = Math.max(1, Math.floor(deps.getViewportHeight() * limits.STEP_RATIO));

      let stepAdded = 0;
      deps.scrollBy(stepDelta);
      await waitForStep(deps, limits, run, (added) => {
        stepAdded += added;
      });
      steps += 1;
      mutationNewCount += stepAdded;

      if (stepAdded > 0) {
        zeroNewStreak = 0;
      } else {
        zeroNewStreak += 1;
      }

      const atBottom = deps.getScrollY() + deps.getViewportHeight() >= deps.getDocumentHeight() - 1;
      if (atBottom && deps.getDocumentHeight() <= heightBefore) {
        bottomStreak += 1;
      } else {
        bottomStreak = 0;
      }

      if (zeroNewStreak >= limits.STALL_STEPS && bottomStreak === 0) {
        // Only while NOT in the bottom zone: once the bottom branch starts
        // accumulating (bottomStreak > 0), the run belongs to 'bottom' — a
        // short page must not be misreported as 'stalled'.
        stopReason = 'stalled';
      } else if (bottomStreak >= limits.HEIGHT_STALL_STEPS) {
        stopReason = 'bottom';
      }
    }
  } finally {
    // Always restore the user's scroll position — even on abort or error.
    deps.scrollToInstant(originalScrollY);
  }

  // Final authoritative pass: everything lazy-loaded is now in the DOM.
  const finalImages = await deps.extractImages();
  const newCount = Math.max(0, finalImages.length - baselineCount);

  return {
    images: finalImages,
    galleryLinks: deps.getGalleryLinks(),
    newCount,
    steps,
    durationMs: deps.now() - startedAt,
    stopReason: stopReason ?? 'aborted',
  };
}
