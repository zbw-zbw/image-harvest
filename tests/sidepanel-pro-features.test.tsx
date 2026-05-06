// Unit tests for the synchronous Pro APIs in sidepanel/pro-features.ts.
//
// What this file pins (the high-ROI subset):
//   - detectSimilarImages: the pHash + aspect-ratio similarity algorithm
//     that powers the "Dedup" toolbar button. Pro-tier core feature —
//     the grouping logic (HASH_THRESHOLD=0, ASPECT_RATIO_TOLERANCE=0.15,
//     "every existing member must match" gating) drives whether users
//     see the dedup affordance at all.
//   - renderColorBar / renderTransparentBar: HTML output + the free vs
//     pro tooltip wording that gates Pro upgrade prompts on hover.
//   - removeImageById: the in-memory removal pipeline including the
//     selectedImages Set re-allocation (a previous regression — the
//     selector subscriber for "Download (N)" went stale because the
//     Set was mutated in-place behind the Proxy).
//   - closeDedupModal / closeMultiTabModal: one-line state toggles, but
//     they are the ESC-key handlers' synchronous escape hatches and
//     deserve a guard against silent typos.
//
// Mocks:
//   - ./filter   → applyFilters is a no-op (we don't want a DOM render)
//   - ./ui       → showToast is a no-op (avoids the global toast container)
//   - ./multitab / ./dedup-ui / ./collection-ui are NOT loaded because
//     none of the tested functions reach them (they're lazy-loaded
//     behind the `show*Modal` shells which we do not exercise).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
}));

import {
  detectSimilarImages,
  renderColorBar,
  renderTransparentBar,
  removeImageById,
  closeDedupModal,
  closeMultiTabModal,
} from '../sidepanel/pro-features';
import { state, store, elements } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  store.reset();
  // jsdom resets between tests, but we still wipe explicit nodes we add.
  document.body.innerHTML = '';
  // Reset the elements ref the production code touches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (elements as any).btnDedup = null;
});

afterEach(() => {
  store.reset();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function makeImg(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'x',
    url: 'https://example.com/photo.jpg',
    naturalWidth: 800,
    naturalHeight: 600,
    format: 'jpg',
    ...overrides,
  } as ImageItem;
}

// ─────────────────────────────────────────────────────────────────────
// detectSimilarImages — pHash + aspect-ratio grouping
// ─────────────────────────────────────────────────────────────────────

describe('detectSimilarImages — algorithm', () => {
  it('is a no-op when fewer than 2 images carry a phash', () => {
    state.allImages = [makeImg({ id: 'a', phash: '0'.repeat(16) })];
    detectSimilarImages();
    expect(state.similarGroups).toEqual([]);
  });

  it('groups images with identical phash AND similar aspect ratio', () => {
    // HASH_THRESHOLD = 0 means EXACT phash match required.
    const phashA = 'a'.repeat(16);
    state.allImages = [
      makeImg({ id: 'a', phash: phashA, naturalWidth: 800, naturalHeight: 600 }),
      makeImg({ id: 'b', phash: phashA, naturalWidth: 400, naturalHeight: 300 }), // same 4:3 ratio
      makeImg({ id: 'c', phash: phashA, naturalWidth: 1200, naturalHeight: 900 }),
    ];
    detectSimilarImages();
    expect(state.similarGroups).toHaveLength(1);
    expect(state.similarGroups[0].map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('does NOT group images with same phash but very different aspect ratios', () => {
    const phashA = 'a'.repeat(16);
    state.allImages = [
      makeImg({ id: 'a', phash: phashA, naturalWidth: 800, naturalHeight: 600 }), // 4:3
      makeImg({ id: 'b', phash: phashA, naturalWidth: 200, naturalHeight: 800 }), // 1:4 (tall)
    ];
    detectSimilarImages();
    // Aspect-ratio tolerance is 0.15 (15%); 4/3 vs 1/4 fails the test.
    expect(state.similarGroups).toEqual([]);
  });

  it('does NOT group images with different phash even when ratios match', () => {
    state.allImages = [
      makeImg({ id: 'a', phash: 'a'.repeat(16), naturalWidth: 800, naturalHeight: 600 }),
      makeImg({ id: 'b', phash: 'b'.repeat(16), naturalWidth: 800, naturalHeight: 600 }),
    ];
    detectSimilarImages();
    expect(state.similarGroups).toEqual([]);
  });

  it('treats missing/zero dimensions as "ratio match wildcard" (returns true)', () => {
    // The areAspectRatiosSimilar helper bails out early when either
    // ratio is 0 — pin this contract because it lets newly-discovered
    // images (no naturalWidth/Height yet) still group with their twin.
    const phashA = 'a'.repeat(16);
    state.allImages = [
      makeImg({ id: 'a', phash: phashA, naturalWidth: 800, naturalHeight: 600 }),
      makeImg({
        id: 'b',
        phash: phashA,
        naturalWidth: 0,
        naturalHeight: 0,
        displayWidth: 0,
        displayHeight: 0,
      }),
    ];
    detectSimilarImages();
    expect(state.similarGroups).toHaveLength(1);
  });

  it('discards single-image groups (only emits groups of 2+)', () => {
    state.allImages = [
      makeImg({ id: 'a', phash: 'a'.repeat(16) }),
      makeImg({ id: 'b', phash: 'b'.repeat(16) }), // unique
      makeImg({ id: 'c', phash: 'a'.repeat(16) }), // pairs with 'a'
    ];
    detectSimilarImages();
    expect(state.similarGroups).toHaveLength(1);
    expect(state.similarGroups[0].map((i) => i.id).sort()).toEqual(['a', 'c']);
  });
});

describe('detectSimilarImages — UI side effects', () => {
  it('shows the Dedup button when groups exist AND enableSimilarDetection !== false', () => {
    const btn = document.createElement('button');
    btn.style.display = 'none';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (elements as any).btnDedup = btn;

    const phashA = 'a'.repeat(16);
    state.allImages = [makeImg({ id: 'a', phash: phashA }), makeImg({ id: 'b', phash: phashA })];
    detectSimilarImages();

    expect(btn.style.display).toBe('');
  });

  it('hides the Dedup button when enableSimilarDetection === false (even if groups exist)', () => {
    const btn = document.createElement('button');
    btn.style.display = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (elements as any).btnDedup = btn;
    state.appSettings = { ...state.appSettings, enableSimilarDetection: false };

    const phashA = 'a'.repeat(16);
    state.allImages = [makeImg({ id: 'a', phash: phashA }), makeImg({ id: 'b', phash: phashA })];
    detectSimilarImages();

    expect(btn.style.display).toBe('none');
  });

  it('toggles the dedup-info banner via the .hidden class', () => {
    const banner = document.createElement('div');
    banner.id = 'dedup-info';
    document.body.appendChild(banner);

    // No groups (algo runs but finds no duplicates) → hidden.
    // Use 2 images with DIFFERENT phash so withHash.length >= 2
    // (so the early-return guard is bypassed) but no group forms.
    state.allImages = [
      makeImg({ id: 'a', phash: 'a'.repeat(16) }),
      makeImg({ id: 'b', phash: 'b'.repeat(16) }),
    ];
    detectSimilarImages();
    expect(state.similarGroups).toEqual([]);
    expect(banner.classList.contains('hidden')).toBe(true);

    // Two duplicates → visible.
    const phashA = 'a'.repeat(16);
    state.allImages = [makeImg({ id: 'a', phash: phashA }), makeImg({ id: 'b', phash: phashA })];
    detectSimilarImages();
    expect(banner.classList.contains('hidden')).toBe(false);
  });

  it('early-returns BEFORE touching DOM when fewer than 2 images carry a phash (perf guard)', () => {
    // Pin the early-return contract: an empty/single-image dataset
    // skips the entire algorithm INCLUDING the banner toggle. A
    // refactor that "tidies up" by always running the toggle would
    // surface here.
    const banner = document.createElement('div');
    banner.id = 'dedup-info';
    document.body.appendChild(banner);
    state.allImages = []; // → withHash.length === 0
    detectSimilarImages();
    // Banner left untouched (neither added nor removed).
    expect(banner.classList.contains('hidden')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// renderColorBar / renderTransparentBar — Pro upsell tooltip gating
// ─────────────────────────────────────────────────────────────────────

describe('renderColorBar / renderTransparentBar', () => {
  it('returns the transparent bar when colors is empty / null / undefined', () => {
    expect(renderColorBar(null)).toBe(renderTransparentBar());
    expect(renderColorBar(undefined)).toBe(renderTransparentBar());
    expect(renderColorBar([])).toBe(renderTransparentBar());
  });

  it('renderTransparentBar emits the data-transparent marker for click handlers', () => {
    const html = renderTransparentBar();
    expect(html).toContain('data-transparent="true"');
    expect(html).toContain('card-color-bar-transparent');
  });

  it('emits one .card-color-bar per color with background-color set', () => {
    const html = renderColorBar(['#ff0000', '#00ff00']);
    expect(html).toContain('background:#ff0000');
    expect(html).toContain('background:#00ff00');
    expect(html).toContain('data-color="#ff0000"');
    expect(html).toContain('data-color="#00ff00"');
  });

  it('shows a "Click to copy" tooltip for Pro users', () => {
    state.isProUser = true;
    const html = renderColorBar(['#ff0000']);
    expect(html).toContain('title="Click to copy #ff0000"');
    expect(html).not.toContain('Upgrade to Pro');
  });

  it('shows the Pro upsell tooltip for free users', () => {
    state.isProUser = false;
    const html = renderColorBar(['#ff0000']);
    expect(html).toContain('title="Upgrade to Pro to copy colors"');
    expect(html).not.toContain('Click to copy');
  });
});

// ─────────────────────────────────────────────────────────────────────
// removeImageById — in-memory removal + Set re-allocation
// ─────────────────────────────────────────────────────────────────────

describe('removeImageById', () => {
  it('drops the image from state.allImages and re-runs filters + similar detection', async () => {
    state.allImages = [makeImg({ id: 'a' }), makeImg({ id: 'b' }), makeImg({ id: 'c' })];
    const filterMod = await import('../sidepanel/filter');

    removeImageById('b');

    expect(state.allImages.map((i) => i.id)).toEqual(['a', 'c']);
    // applyFilters is invoked because filter results may need re-eval.
    expect(filterMod.applyFilters).toHaveBeenCalledTimes(1);
  });

  it('reallocates selectedImages Set when removing a SELECTED image (selector-subscriber regression)', () => {
    state.allImages = [makeImg({ id: 'a' }), makeImg({ id: 'b' })];
    const sel = new Set(['a', 'b']);
    state.selectedImages = sel;
    const beforeRef = state.selectedImages;

    removeImageById('a');

    // New Set instance — the Proxy trap fires so selector
    // subscribers (e.g. "Download (N)" label) re-evaluate.
    expect(state.selectedImages).not.toBe(beforeRef);
    expect(Array.from(state.selectedImages)).toEqual(['b']);
  });

  it('does NOT reallocate selectedImages when removing an UN-selected image (perf)', () => {
    state.allImages = [makeImg({ id: 'a' }), makeImg({ id: 'b' })];
    state.selectedImages = new Set(['a']);
    const beforeRef = state.selectedImages;

    removeImageById('b'); // 'b' is not selected

    // Same reference — no churn for the common case.
    expect(state.selectedImages).toBe(beforeRef);
  });
});

// ─────────────────────────────────────────────────────────────────────
// close*Modal — synchronous ESC-key escape hatches
// ─────────────────────────────────────────────────────────────────────

describe('close*Modal — ESC handlers', () => {
  it('closeDedupModal flips dedupModalState.open to false', () => {
    state.dedupModalState = { open: true };
    closeDedupModal();
    expect(state.dedupModalState.open).toBe(false);
  });

  it('closeMultiTabModal flips multitabModalState.open to false', () => {
    state.multitabModalState = { open: true };
    closeMultiTabModal();
    expect(state.multitabModalState.open).toBe(false);
  });
});
