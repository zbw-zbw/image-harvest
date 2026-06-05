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

vi.mock('virtua', () => ({ Virtualizer: vi.fn() }));
vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
}));
// The lazy-split chunks are mocked at module level. We assert the
// facade DELEGATES to them (the production contract) without loading
// the real heavyweight dependencies (JSZip, modal markup).
vi.mock('../sidepanel/multitab', () => ({
  showMultiTabModal: vi.fn(),
  startMultiTabExtract: vi.fn(() => Promise.resolve()),
  toggleMultitabSelectAll: vi.fn(),
}));
vi.mock('../sidepanel/dedup-ui', () => ({
  showDedupModal: vi.fn(),
  removeDuplicates: vi.fn(() => Promise.resolve()),
}));
vi.mock('../sidepanel/collection-ui', () => ({
  showCollectionModal: vi.fn(),
  exportCollection: vi.fn(() => Promise.resolve()),
}));
vi.mock('../shared/collection', () => ({
  collectionAdd: vi.fn(() => Promise.resolve()),
  collectionGetAll: vi.fn(() => Promise.resolve([])),
  collectionRemove: vi.fn(() => Promise.resolve()),
}));

import {
  detectSimilarImages,
  renderColorBar,
  renderTransparentBar,
  removeImageById,
  closeDedupModal,
  closeMultiTabModal,
  closeCollectionModal,
  copyColor,
  addToCollection,
  isImageInCollection,
  removeFromCollection,
  showMultiTabModal,
  startMultiTabExtract,
  toggleMultitabSelectAll,
  showCollectionModal,
  exportCollection,
  showDedupModal,
  removeDuplicates,
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

  it('does NOT group images with same phash but very different aspect ratios (different URLs)', () => {
    const phashA = 'a'.repeat(16);
    state.allImages = [
      makeImg({
        id: 'a',
        url: 'https://example.com/photo-a.jpg',
        phash: phashA,
        naturalWidth: 800,
        naturalHeight: 600,
      }), // 4:3
      makeImg({
        id: 'b',
        url: 'https://example.com/photo-b.jpg',
        phash: phashA,
        naturalWidth: 200,
        naturalHeight: 800,
      }), // 1:4 (tall)
    ];
    detectSimilarImages();
    // Aspect-ratio tolerance is 0.25 (25%); 4/3 vs 1/4 still fails the check.
    expect(state.similarGroups).toEqual([]);
  });

  it('does NOT group images with different phash even when ratios match (different URLs)', () => {
    state.allImages = [
      makeImg({
        id: 'a',
        url: 'https://example.com/photo-a.jpg',
        phash: 'a'.repeat(16),
        naturalWidth: 800,
        naturalHeight: 600,
      }),
      makeImg({
        id: 'b',
        url: 'https://example.com/photo-b.jpg',
        phash: 'b'.repeat(16),
        naturalWidth: 800,
        naturalHeight: 600,
      }),
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
      makeImg({ id: 'a', url: 'https://example.com/photo-a.jpg', phash: 'a'.repeat(16) }),
      makeImg({ id: 'b', url: 'https://example.com/photo-b.jpg', phash: 'b'.repeat(16) }), // unique
      makeImg({ id: 'c', url: 'https://example.com/photo-c.jpg', phash: 'a'.repeat(16) }), // pairs with 'a'
    ];
    detectSimilarImages();
    expect(state.similarGroups).toHaveLength(1);
    expect(state.similarGroups[0].map((i) => i.id).sort()).toEqual(['a', 'c']);
  });
});

describe('detectSimilarImages — UI side effects', () => {
  it('shows the Dedup button when groups exist (detection always enabled)', () => {
    const phashA = 'a'.repeat(16);
    state.allImages = [makeImg({ id: 'a', phash: phashA }), makeImg({ id: 'b', phash: phashA })];
    detectSimilarImages();

    // The Preact component now self-manages btnDedup visibility via
    // state.similarGroups — verify the grouping result instead.
    expect(state.similarGroups.length).toBeGreaterThan(0);
  });

  it('always computes groups (detection is always enabled)', () => {
    const phashA = 'a'.repeat(16);
    state.allImages = [makeImg({ id: 'a', phash: phashA }), makeImg({ id: 'b', phash: phashA })];
    detectSimilarImages();

    // detectSimilarImages is a pure grouping algorithm. Detection is
    // always enabled — no toggle to gate it.
    expect(state.similarGroups.length).toBeGreaterThan(0);
  });

  it('sets similarGroups correctly based on duplicate detection', () => {
    // No groups (algo runs but finds no duplicates).
    // Use 2 images with DIFFERENT phash AND different URLs so
    // neither URL-based nor pHash-based grouping fires.
    state.allImages = [
      makeImg({ id: 'a', url: 'https://example.com/photo-a.jpg', phash: 'a'.repeat(16) }),
      makeImg({ id: 'b', url: 'https://example.com/photo-b.jpg', phash: 'b'.repeat(16) }),
    ];
    detectSimilarImages();
    expect(state.similarGroups).toEqual([]);

    // Two duplicates → groups populated.
    const phashA = 'a'.repeat(16);
    state.allImages = [makeImg({ id: 'a', phash: phashA }), makeImg({ id: 'b', phash: phashA })];
    detectSimilarImages();
    expect(state.similarGroups.length).toBeGreaterThan(0);
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

  it('closeCollectionModal flips collectionModalState.open to false', () => {
    state.collectionModalState = { open: true };
    closeCollectionModal();
    expect(state.collectionModalState.open).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// copyColor — navigator.clipboard integration
// ─────────────────────────────────────────────────────────────────────
// Pin: on success we toast the copied hex (so users get positive
// feedback), on rejection we must NOT let the clipboard API's
// DOMException bubble up — it would unmount any open modal and
// surface a raw console error. The try/catch is the contract.

describe('copyColor', () => {
  // Helper: install a clipboard stub that survives whatever the previous
  // test file did to navigator.clipboard. sidepanel-collection-ui.test.tsx
  // uses Object.defineProperty(...) with writable:false (data-descriptor
  // default), which poisons plain assignment here under serial test runs.
  // Object.defineProperty + configurable:true unconditionally wins over
  // any prior descriptor, so this pattern is race-free across suite order.
  function installClipboardStub(writeText: () => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    });
  }

  afterEach(() => {
    // Hand the clipboard back to jsdom so later tests in this file
    // (and later test files in the suite) start from a clean slate.
    try {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    } catch {
      /* noop — see sibling comment in sidepanel-collection-ui.test.tsx */
    }
  });

  it('toasts success with the exact hex value after clipboard.writeText resolves', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    installClipboardStub(writeText);
    const uiMod = await import('../sidepanel/ui');

    await copyColor('#abcdef');

    expect(writeText).toHaveBeenCalledWith('#abcdef');
    expect(uiMod.showToast).toHaveBeenCalledWith('Color #abcdef copied', 'success');
  });

  it('toasts an error (instead of bubbling the DOMException) when clipboard rejects', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    installClipboardStub(writeText);
    const uiMod = await import('../sidepanel/ui');

    // Must not throw — the facade owns the catch.
    await expect(copyColor('#123456')).resolves.toBeUndefined();
    expect(uiMod.showToast).toHaveBeenCalledWith('Failed to copy color', 'error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Collection CRUD — addToCollection / isImageInCollection / removeFromCollection
// ─────────────────────────────────────────────────────────────────────
// Pin: addToCollection must read the ACTIVE tab's url/title (not the
// sidepanel's own URL). A regression dropping the chrome.tabs.query()
// call would tag every saved item with the extension URL, breaking
// the "Open source page" link in the collection modal.

describe('addToCollection', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn(() =>
          Promise.resolve([{ id: 42, url: 'https://example.com/gallery', title: 'Gallery Page' }])
        ),
      },
    };
  });

  it('persists the image PLUS the active page url/title + createdAt timestamp', async () => {
    state.isProUser = true;
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const collectionMod = await import('../shared/collection');
    const uiMod = await import('../sidepanel/ui');

    await addToCollection(
      makeImg({
        id: 'img-1',
        url: 'https://cdn.example.com/pic.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        format: 'jpg',
        estimatedSize: 12345,
        colors: ['#ff0000'],
      })
    );

    expect(collectionMod.collectionAdd).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(collectionMod.collectionAdd).mock.calls[0][0];
    expect(payload).toMatchObject({
      id: 'img-1',
      url: 'https://cdn.example.com/pic.jpg',
      width: 800,
      height: 600,
      format: 'jpg',
      fileSize: 12345,
      colors: ['#ff0000'],
      sourceUrl: 'https://example.com/gallery',
      sourceTitle: 'Gallery Page',
      tags: [],
      notes: '',
      createdAt: now,
    });
    expect(uiMod.showToast).toHaveBeenCalledWith('Added to collection', 'success');
  });

  it('falls back to img.tabUrl/tabTitle when chrome.tabs.query throws (multi-tab mode)', async () => {
    state.isProUser = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((globalThis as any).chrome.tabs.query as any).mockRejectedValueOnce(
      new Error('No access to tab')
    );
    const collectionMod = await import('../shared/collection');

    await addToCollection(
      makeImg({
        id: 'img-2',
        url: 'https://cdn.example.com/pic.jpg',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tabUrl: 'https://other-tab.example.com/page',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tabTitle: 'Other Tab',
      } as any)
    );

    const payload = vi.mocked(collectionMod.collectionAdd).mock.calls[0][0];
    expect(payload.sourceUrl).toBe('https://other-tab.example.com/page');
    expect(payload.sourceTitle).toBe('Other Tab');
  });

  it('falls back to empty strings when chrome.tabs.query returns [] (no active tab)', async () => {
    state.isProUser = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((globalThis as any).chrome.tabs.query as any).mockResolvedValueOnce([]);
    const collectionMod = await import('../shared/collection');

    await addToCollection(makeImg({ id: 'img-3', url: 'https://cdn.example.com/pic.jpg' }));

    const payload = vi.mocked(collectionMod.collectionAdd).mock.calls[0][0];
    expect(payload.sourceUrl).toBe('');
    expect(payload.sourceTitle).toBe('');
  });

  it('toasts an error AND swallows when collectionAdd rejects (no uncaught promise)', async () => {
    state.isProUser = true;
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionAdd).mockRejectedValueOnce(new Error('QuotaExceeded'));
    const uiMod = await import('../sidepanel/ui');

    await expect(addToCollection(makeImg({ id: 'img-4' }))).resolves.toBeUndefined();
    expect(uiMod.showToast).toHaveBeenCalledWith('Failed to add to collection', 'error');
  });
});

describe('isImageInCollection', () => {
  it('returns true when the url matches any item in the collection', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      { id: 'a', url: 'https://cdn.example.com/pic.jpg' },
      { id: 'b', url: 'https://cdn.example.com/other.png' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await expect(isImageInCollection('https://cdn.example.com/pic.jpg')).resolves.toBe(true);
  });

  it('returns false when no item has that url', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockResolvedValueOnce([
      { id: 'a', url: 'https://cdn.example.com/other.jpg' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await expect(isImageInCollection('https://cdn.example.com/missing.jpg')).resolves.toBe(false);
  });

  it('returns false when collectionGetAll rejects (never throws to caller)', async () => {
    // Pin: ImageCard.isCollectionHighlighted() calls this on every
    // render. If rejection propagated, the IndexedDB failure mode
    // would blank every card's favorite star.
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionGetAll).mockRejectedValueOnce(new Error('IDB closed'));

    await expect(isImageInCollection('https://cdn.example.com/pic.jpg')).resolves.toBe(false);
  });
});

describe('removeFromCollection', () => {
  it('delegates to collectionRemove(id) and toasts success', async () => {
    const collectionMod = await import('../shared/collection');
    const uiMod = await import('../sidepanel/ui');

    await removeFromCollection('img-xyz');

    expect(collectionMod.collectionRemove).toHaveBeenCalledWith('img-xyz');
    expect(uiMod.showToast).toHaveBeenCalledWith('Removed from collection', 'success');
  });

  it('toasts an error AND swallows when collectionRemove rejects', async () => {
    const collectionMod = await import('../shared/collection');
    vi.mocked(collectionMod.collectionRemove).mockRejectedValueOnce(new Error('Not found'));
    const uiMod = await import('../sidepanel/ui');

    await expect(removeFromCollection('missing')).resolves.toBeUndefined();
    expect(uiMod.showToast).toHaveBeenCalledWith('Failed to remove', 'error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Lazy loaders — delegation to split chunks
// ─────────────────────────────────────────────────────────────────────
// The synchronous facade (what the toolbar buttons import at module
// load time) must NOT reach into the implementation modules at
// definition time — they are gated behind `await import(...)` so the
// first paint doesn't pay for JSZip + modal markup. These tests pin
// the delegation contract: each facade call fires the mocked split
// chunk exactly once, with the arguments threaded unchanged.

describe('lazy loaders — dedup-ui / multitab / collection-ui delegation', () => {
  it('showDedupModal → ./dedup-ui.showDedupModal (no args)', async () => {
    const dedupMod = await import('../sidepanel/dedup-ui');
    await showDedupModal();
    expect(dedupMod.showDedupModal).toHaveBeenCalledTimes(1);
  });

  it('removeDuplicates → ./dedup-ui.removeDuplicates + returns its promise', async () => {
    const dedupMod = await import('../sidepanel/dedup-ui');
    vi.mocked(dedupMod.removeDuplicates).mockResolvedValueOnce(undefined);

    await expect(removeDuplicates()).resolves.toBeUndefined();
    expect(dedupMod.removeDuplicates).toHaveBeenCalledTimes(1);
  });

  it('showMultiTabModal → ./multitab.showMultiTabModal (no args)', async () => {
    const multitabMod = await import('../sidepanel/multitab');
    await showMultiTabModal();
    expect(multitabMod.showMultiTabModal).toHaveBeenCalledTimes(1);
  });

  it('startMultiTabExtract threads tabIds unchanged to ./multitab.startMultiTabExtract', async () => {
    const multitabMod = await import('../sidepanel/multitab');
    const tabIds = [11, 22, 33];

    await startMultiTabExtract(tabIds);

    expect(multitabMod.startMultiTabExtract).toHaveBeenCalledTimes(1);
    expect(multitabMod.startMultiTabExtract).toHaveBeenCalledWith(tabIds);
  });

  it('toggleMultitabSelectAll → ./multitab.toggleMultitabSelectAll (no args)', async () => {
    const multitabMod = await import('../sidepanel/multitab');
    await toggleMultitabSelectAll();
    expect(multitabMod.toggleMultitabSelectAll).toHaveBeenCalledTimes(1);
  });

  it('showCollectionModal → ./collection-ui.showCollectionModal (no args)', async () => {
    const collectionUiMod = await import('../sidepanel/collection-ui');
    await showCollectionModal();
    expect(collectionUiMod.showCollectionModal).toHaveBeenCalledTimes(1);
  });

  it('exportCollection → ./collection-ui.exportCollection + returns its promise', async () => {
    const collectionUiMod = await import('../sidepanel/collection-ui');
    vi.mocked(collectionUiMod.exportCollection).mockResolvedValueOnce(undefined);

    await expect(exportCollection()).resolves.toBeUndefined();
    expect(collectionUiMod.exportCollection).toHaveBeenCalledTimes(1);
  });
});
