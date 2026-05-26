// Unit tests for the pure filter predicates in sidepanel/filter.ts.
//
// Coverage:
//   - filterBySize: 'all' bypass + sizeMin/sizeMax inclusive bounds on max(w,h)
//   - filterByType: empty types[] bypass + lowercased format match
//   - filterByLayout: 'all' bypass + missing-dim bypass + aspect category match
//   - filterByUrl: empty keyword bypass + lowercased substring match
//   - filterByColor: null color bypass + missing img.colors → false +
//     RGB-distance threshold (60) gate
//   - colorDistance: euclidean distance in RGB space, hex parse contract
//   - filterBySettingsMinSize/MaxSize: enable* gate + width/height bounds,
//     undefined bound defaults (min→0, max→Infinity)
//   - clearCustomSizeInputs / applyCustomSizeInputs /
//     syncCustomSizeInputsFromSettings: the 4-input DOM <-> appSettings
//     round-trip used by the Settings modal.
//
// Skipped on purpose:
//   - applyFilters / sortImages / renderColorSwatches (DOM-dependent —
//     exercised by e2e).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the heavy neighbors so applyCustomSizeInputs() can call into
// updateFilterButtonLabels / applyFilters without dragging the entire
// render + actions chain into the test.
vi.mock('../sidepanel/actions', () => ({
  updateSelectionUI: vi.fn(),
}));
vi.mock('../sidepanel/render', () => ({
  renderImages: vi.fn(),
}));
vi.mock('../sidepanel/settings', () => ({
  closeAllFilterDropdowns: vi.fn(),
  showProUpgradeModal: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
}));

import {
  applyCustomSizeInputs,
  applyFilters,
  clearCustomSizeInputs,
  colorDistance,
  FILESIZE_PRESETS,
  filterByColor,
  filterByFileSize,
  filterByLayout,
  filterBySettingsMaxSize,
  filterBySettingsMinSize,
  filterBySize,
  filterByType,
  filterByUrl,
  renderColorSwatches,
  sortImages,
  syncCustomSizeInputsFromSettings,
} from '../sidepanel/filter';
import { state, store } from '../sidepanel/state';
import { updateFilterButtonLabels } from '../sidepanel/ui';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  store.reset();
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

describe('filterBySize', () => {
  it('passes everything when activeFilters.size === "all"', () => {
    state.activeFilters.size = 'all';
    state.activeFilters.sizeMin = 1000;
    state.activeFilters.sizeMax = 2000;
    expect(filterBySize(makeImg({ naturalWidth: 100, naturalHeight: 100 }))).toBe(true);
  });

  it('uses max(w, h) and inclusive bounds', () => {
    state.activeFilters.size = 'custom';
    state.activeFilters.sizeMin = 500;
    state.activeFilters.sizeMax = 1000;
    // max-dim = 800 → in range
    expect(filterBySize(makeImg({ naturalWidth: 800, naturalHeight: 100 }))).toBe(true);
    // max-dim = 500 → on the lower boundary, inclusive
    expect(filterBySize(makeImg({ naturalWidth: 500, naturalHeight: 200 }))).toBe(true);
    // max-dim = 1000 → on the upper boundary, inclusive
    expect(filterBySize(makeImg({ naturalWidth: 1000, naturalHeight: 200 }))).toBe(true);
    // max-dim = 499 → below
    expect(filterBySize(makeImg({ naturalWidth: 499, naturalHeight: 200 }))).toBe(false);
    // max-dim = 1001 → above
    expect(filterBySize(makeImg({ naturalWidth: 1001, naturalHeight: 200 }))).toBe(false);
  });

  it('falls back to displayWidth/Height when natural dims are missing', () => {
    state.activeFilters.size = 'custom';
    state.activeFilters.sizeMin = 100;
    state.activeFilters.sizeMax = 1000;
    const img = makeImg({
      naturalWidth: 0,
      naturalHeight: 0,
      displayWidth: 600,
      displayHeight: 400,
    });
    expect(filterBySize(img)).toBe(true);
  });
});

describe('filterByType', () => {
  it('passes everything when activeFilters.types is empty', () => {
    state.activeFilters.types = [];
    expect(filterByType(makeImg({ format: 'jpg' }))).toBe(true);
    expect(filterByType(makeImg({ format: 'gif' }))).toBe(true);
  });

  it('matches case-insensitively against the lowercased format', () => {
    state.activeFilters.types = ['png', 'webp'];
    expect(filterByType(makeImg({ format: 'PNG' }))).toBe(true);
    expect(filterByType(makeImg({ format: 'webp' }))).toBe(true);
    expect(filterByType(makeImg({ format: 'jpg' }))).toBe(false);
  });

  it('treats missing format as "unknown" — accepted only if "unknown" is selected', () => {
    state.activeFilters.types = ['unknown'];
    expect(filterByType(makeImg({ format: undefined }))).toBe(true);
    state.activeFilters.types = ['png'];
    expect(filterByType(makeImg({ format: undefined }))).toBe(false);
  });
});

describe('filterByLayout', () => {
  it('passes everything when activeFilters.layout === "all"', () => {
    state.activeFilters.layout = 'all';
    expect(filterByLayout(makeImg({ naturalWidth: 100, naturalHeight: 100 }))).toBe(true);
  });

  it('passes images without dimensions even when a layout filter is active (cannot classify)', () => {
    state.activeFilters.layout = 'square';
    expect(filterByLayout(makeImg({ naturalWidth: 0, naturalHeight: 0 }))).toBe(true);
  });

  it('matches the aspect-ratio category exactly', () => {
    state.activeFilters.layout = 'square';
    expect(filterByLayout(makeImg({ naturalWidth: 100, naturalHeight: 100 }))).toBe(true);
    expect(filterByLayout(makeImg({ naturalWidth: 200, naturalHeight: 100 }))).toBe(false);

    state.activeFilters.layout = 'landscape';
    expect(filterByLayout(makeImg({ naturalWidth: 200, naturalHeight: 100 }))).toBe(true);
    expect(filterByLayout(makeImg({ naturalWidth: 100, naturalHeight: 100 }))).toBe(false);
  });
});

describe('filterByUrl', () => {
  it('passes everything when urlKeyword is empty', () => {
    state.activeFilters.urlKeyword = '';
    expect(filterByUrl(makeImg())).toBe(true);
  });

  it('matches lowercased substrings (case-insensitive on the URL side)', () => {
    state.activeFilters.urlKeyword = 'photo';
    expect(filterByUrl(makeImg({ url: 'https://x.com/MyPhoto.jpg' }))).toBe(true);
    expect(filterByUrl(makeImg({ url: 'https://x.com/avatar.jpg' }))).toBe(false);
  });

  it('treats missing URL as no match (unless keyword is empty)', () => {
    state.activeFilters.urlKeyword = 'photo';
    expect(filterByUrl(makeImg({ url: '' }))).toBe(false);
  });
});

describe('filterByColor', () => {
  it('passes everything when activeFilters.color is null', () => {
    state.activeFilters.color = null;
    expect(filterByColor(makeImg())).toBe(true);
  });

  it('rejects images with no extracted colors when a color filter is active', () => {
    state.activeFilters.color = '#ff0000';
    expect(filterByColor(makeImg({ colors: undefined }))).toBe(false);
    expect(filterByColor(makeImg({ colors: [] }))).toBe(false);
  });

  it('accepts images that have ANY color within the 60-distance threshold', () => {
    state.activeFilters.color = '#ff0000';
    // Same color → distance 0
    expect(filterByColor(makeImg({ colors: ['#ff0000'] }))).toBe(true);
    // Close to red → distance ~17
    expect(filterByColor(makeImg({ colors: ['#ff1010'] }))).toBe(true);
    // Far from red (pure blue) → distance ~360
    expect(filterByColor(makeImg({ colors: ['#0000ff'] }))).toBe(false);
    // Multiple colors, only one needs to match
    expect(filterByColor(makeImg({ colors: ['#0000ff', '#ff0505'] }))).toBe(true);
  });
});

describe('colorDistance', () => {
  it('returns 0 for identical colors', () => {
    expect(colorDistance('#ff0000', '#ff0000')).toBe(0);
    expect(colorDistance('#000000', '#000000')).toBe(0);
  });

  it('computes euclidean distance in RGB space', () => {
    // Red (255,0,0) vs Green (0,255,0) → sqrt(255² + 255²) ≈ 360.6
    expect(colorDistance('#ff0000', '#00ff00')).toBeCloseTo(Math.sqrt(2) * 255, 1);
    // Black vs White → sqrt(3 * 255²) ≈ 441.7
    expect(colorDistance('#000000', '#ffffff')).toBeCloseTo(Math.sqrt(3) * 255, 1);
  });

  it('parses lowercase hex correctly (slice positions 1-7)', () => {
    // Mixed channel: #102030 = (16, 32, 48), #203040 = (32, 48, 64)
    // Per-channel diffs: (16, 16, 16) → sqrt(3 * 256) = 16√3
    expect(colorDistance('#102030', '#203040')).toBeCloseTo(16 * Math.sqrt(3), 2);
  });
});

describe('filterBySettingsMinSize', () => {
  it('passes everything when customMinEnabled is false', () => {
    state.activeFilters = {
      ...state.activeFilters,
      customMinEnabled: false,
      customMinWidth: 1000,
      customMinHeight: 1000,
    };
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 50, naturalHeight: 50 }))).toBe(true);
  });

  it('requires both width AND height to meet their respective bounds', () => {
    state.activeFilters = {
      ...state.activeFilters,
      customMinEnabled: true,
      customMinWidth: 100,
      customMinHeight: 100,
    };
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 200, naturalHeight: 200 }))).toBe(true);
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 100, naturalHeight: 100 }))).toBe(true); // inclusive
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 50, naturalHeight: 200 }))).toBe(false);
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 200, naturalHeight: 50 }))).toBe(false);
  });

  it('treats undefined customMinWidth/customMinHeight as 0 (effectively pass-through when enabled)', () => {
    state.activeFilters = {
      ...state.activeFilters,
      customMinEnabled: true,
      customMinWidth: undefined as unknown as number,
      customMinHeight: undefined as unknown as number,
    };
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 1, naturalHeight: 1 }))).toBe(true);
  });
});

describe('filterBySettingsMaxSize', () => {
  it('passes everything when customMaxEnabled is false', () => {
    state.activeFilters = {
      ...state.activeFilters,
      customMaxEnabled: false,
      customMaxWidth: 100,
      customMaxHeight: 100,
    };
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 5000, naturalHeight: 5000 }))).toBe(
      true
    );
  });

  it('requires both width AND height to be within their respective bounds', () => {
    state.activeFilters = {
      ...state.activeFilters,
      customMaxEnabled: true,
      customMaxWidth: 1000,
      customMaxHeight: 1000,
    };
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 800, naturalHeight: 800 }))).toBe(true);
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 1000, naturalHeight: 1000 }))).toBe(
      true
    ); // inclusive
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 1500, naturalHeight: 800 }))).toBe(
      false
    );
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 800, naturalHeight: 1500 }))).toBe(
      false
    );
  });

  it('treats undefined customMaxWidth/customMaxHeight as Infinity (effectively no upper bound when enabled)', () => {
    state.activeFilters = {
      ...state.activeFilters,
      customMaxEnabled: true,
      customMaxWidth: undefined as unknown as number,
      customMaxHeight: undefined as unknown as number,
    };
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 99999, naturalHeight: 99999 }))).toBe(
      true
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// custom-size-inputs DOM round-trip
// ─────────────────────────────────────────────────────────────────────

function mountSizeInputs(): {
  minW: HTMLInputElement;
  minH: HTMLInputElement;
  maxW: HTMLInputElement;
  maxH: HTMLInputElement;
} {
  document.body.innerHTML = `
    <div id="app">
      <input id="filter-min-width" type="number" />
      <input id="filter-min-height" type="number" />
      <input id="filter-max-width" type="number" />
      <input id="filter-max-height" type="number" />
      <button data-size-filter="all" class="active"></button>
      <button data-size-filter="large" class="active"></button>
    </div>
  `;
  return {
    minW: document.getElementById('filter-min-width') as HTMLInputElement,
    minH: document.getElementById('filter-min-height') as HTMLInputElement,
    maxW: document.getElementById('filter-max-width') as HTMLInputElement,
    maxH: document.getElementById('filter-max-height') as HTMLInputElement,
  };
}

describe('clearCustomSizeInputs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wipes all 4 inputs to empty string when they exist', () => {
    const { minW, minH, maxW, maxH } = mountSizeInputs();
    minW.value = '100';
    minH.value = '200';
    maxW.value = '1000';
    maxH.value = '2000';
    clearCustomSizeInputs();
    expect(minW.value).toBe('');
    expect(minH.value).toBe('');
    expect(maxW.value).toBe('');
    expect(maxH.value).toBe('');
  });

  it('is a no-op when the inputs are absent (defensive null-check on every getElementById)', () => {
    // Pin: <Settings> modal is lazy-mounted; clearCustomSizeInputs is
    // called by settings-reset flows that may fire before the modal
    // ever opens. Any regression dropping the null guard would crash
    // the reset chain with "Cannot set properties of null".
    document.body.innerHTML = '';
    expect(() => clearCustomSizeInputs()).not.toThrow();
  });
});

describe('applyCustomSizeInputs', () => {
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    storageSet = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { set: storageSet } },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.clearAllMocks();
  });

  it('reads all 4 inputs into activeFilters + flips customMinEnabled/customMaxEnabled', () => {
    const { minW, minH, maxW, maxH } = mountSizeInputs();
    minW.value = '200';
    minH.value = '150';
    maxW.value = '2000';
    maxH.value = '1500';
    applyCustomSizeInputs();
    expect(state.activeFilters.customMinEnabled).toBe(true);
    expect(state.activeFilters.customMinWidth).toBe(200);
    expect(state.activeFilters.customMinHeight).toBe(150);
    expect(state.activeFilters.customMaxEnabled).toBe(true);
    expect(state.activeFilters.customMaxWidth).toBe(2000);
    expect(state.activeFilters.customMaxHeight).toBe(1500);
  });

  it('leaves customMinEnabled=false when all min inputs are empty/zero', () => {
    // Pin: "no min fields filled in" must not enable the min-size
    // filter. A regression here would silently filter out every image
    // with w<0 or h<0 (i.e. nothing).
    mountSizeInputs();
    applyCustomSizeInputs();
    expect(state.activeFilters.customMinEnabled).toBe(false);
    expect(state.activeFilters.customMaxEnabled).toBe(false);
  });

  it('falls back to 0 / Infinity for empty inputs (NaN guard via parseInt || 0)', () => {
    const { minW } = mountSizeInputs();
    minW.value = '100';
    // The 3 other inputs stay empty.
    applyCustomSizeInputs();
    expect(state.activeFilters.customMinWidth).toBe(100);
    expect(state.activeFilters.customMinHeight).toBe(0);
    expect(state.activeFilters.customMaxWidth).toBe(Infinity);
    expect(state.activeFilters.customMaxHeight).toBe(Infinity);
  });

  it('resets size preset to "all" + deactivates [data-size-filter] buttons when any custom value is entered', () => {
    // Pin: the mutual-exclusion contract between preset size buckets
    // and custom inputs. Leaving the preset "active" class on would
    // confuse the user (both presets and custom values highlighted).
    const { minW } = mountSizeInputs();
    state.activeFilters.size = 'large';
    state.activeFilters.sizeMin = 1000;
    state.activeFilters.sizeMax = 2000;
    minW.value = '300';
    applyCustomSizeInputs();
    expect(state.activeFilters.size).toBe('all');
    expect(state.activeFilters.sizeMin).toBe(0);
    expect(state.activeFilters.sizeMax).toBe(Infinity);
    expect(document.querySelectorAll('[data-size-filter].active')).toHaveLength(0);
  });

  it('leaves preset activeFilters untouched when NO custom values are entered', () => {
    // Pin the negative case of the mutual-exclusion: the empty-form
    // call path must NOT wipe the preset that was explicitly selected
    // (e.g. a pre-existing "large" bucket from a previous session).
    mountSizeInputs();
    state.activeFilters.size = 'large';
    state.activeFilters.sizeMin = 1000;
    state.activeFilters.sizeMax = 2000;
    document.querySelector('[data-size-filter="large"]')?.classList.add('active');
    applyCustomSizeInputs();
    expect(state.activeFilters.size).toBe('large');
    expect(state.activeFilters.sizeMin).toBe(1000);
    expect(state.activeFilters.sizeMax).toBe(2000);
  });

  it('calls updateFilterButtonLabels after applying custom size inputs', () => {
    const { minW } = mountSizeInputs();
    minW.value = '500';
    applyCustomSizeInputs();
    expect(updateFilterButtonLabels).toHaveBeenCalledTimes(1);
    // Source no longer persists to chrome.storage — only session-local
    // activeFilters are updated.
  });
});

describe('syncCustomSizeInputsFromSettings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('writes appSettings.minWidth/minHeight into inputs when enableMinSize is true', () => {
    const { minW, minH, maxW, maxH } = mountSizeInputs();
    state.appSettings = {
      ...state.appSettings,
      enableMinSize: true,
      minWidth: 300,
      minHeight: 400,
      enableMaxSize: false,
    };
    syncCustomSizeInputsFromSettings();
    expect(minW.value).toBe('300');
    expect(minH.value).toBe('400');
    // Pin: max inputs stay untouched when enableMaxSize is false.
    expect(maxW.value).toBe('');
    expect(maxH.value).toBe('');
  });

  it('skips min inputs when enableMinSize is false (mirror of the write gate)', () => {
    const { minW, minH } = mountSizeInputs();
    state.appSettings = {
      ...state.appSettings,
      enableMinSize: false,
      minWidth: 300,
      minHeight: 400,
    };
    syncCustomSizeInputsFromSettings();
    expect(minW.value).toBe('');
    expect(minH.value).toBe('');
  });

  it('writes max inputs only when bounded (< Infinity)', () => {
    // Pin: the < Infinity guard. Chrome.storage may round-trip an
    // `Infinity` through JSON.stringify which turns it into `null`, so
    // the caller can't rely on the type here. Writing "Infinity" into
    // an <input type="number"> would render as empty and surprise the
    // user; writing nothing leaves the placeholder visible.
    const { maxW, maxH } = mountSizeInputs();
    state.appSettings = {
      ...state.appSettings,
      enableMaxSize: true,
      maxWidth: 2000,
      maxHeight: Infinity,
    };
    syncCustomSizeInputsFromSettings();
    expect(maxW.value).toBe('2000');
    expect(maxH.value).toBe('');
  });

  it('is a no-op when the inputs are absent (defensive null guards)', () => {
    document.body.innerHTML = '';
    state.appSettings = {
      ...state.appSettings,
      enableMinSize: true,
      enableMaxSize: true,
      minWidth: 100,
      minHeight: 100,
      maxWidth: 500,
      maxHeight: 500,
    };
    expect(() => syncCustomSizeInputsFromSettings()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyFilters — AND chain + cache short-circuit + renderImages delegation
// ─────────────────────────────────────────────────────────────────────
// Pin: applyFilters is the single entry for every filter-bar change. Four
// contracts matter here:
//   1. AND-chain across 7 predicates (size/type/layout/url/color/min/max).
//      Any predicate returning false must exclude the image.
//   2. sortImages() MUST run after filtering (not before) so the displayed
//      order honors the active sort mode.
//   3. `lastRenderedFilteredIds` cache short-circuit skips renderImages()
//      when the filtered set is identical to the last render — BUT still
//      calls updateSelectionUI() because selection may have changed.
//   4. When the set changes, the cache key is updated AND renderImages()
//      is invoked exactly once (not twice from cache-miss + fallthrough).

describe('applyFilters', () => {
  beforeEach(() => {
    // The spies accumulate across the whole file (the global beforeEach
    // only calls store.reset()). Clear them so per-test assertions on
    // toHaveBeenCalledTimes(N) are reliable.
    vi.clearAllMocks();
  });

  it('retains only images that pass every predicate (AND semantics)', async () => {
    const render = await import('../sidepanel/render');
    state.allImages = [
      makeImg({ id: 'pass', naturalWidth: 800, naturalHeight: 600, format: 'jpg' }),
      makeImg({ id: 'fail-type', naturalWidth: 800, naturalHeight: 600, format: 'gif' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    state.activeFilters = {
      ...state.activeFilters,
      size: 'all',
      types: ['jpg'], // gif fails here
      layout: 'all',
      urlKeyword: '',
      color: null,
    };
    state.lastRenderedFilteredIds = null;

    applyFilters();

    expect(state.filteredImages.map((i) => i.id)).toEqual(['pass']);
    expect(render.renderImages).toHaveBeenCalledTimes(1);
  });

  it('SKIPS renderImages when the filtered id-list matches lastRenderedFilteredIds (cache hit)', async () => {
    const render = await import('../sidepanel/render');
    const actions = await import('../sidepanel/actions');
    state.allImages = [
      makeImg({ id: 'a', naturalWidth: 800, naturalHeight: 600, format: 'jpg' }),
      makeImg({ id: 'b', naturalWidth: 800, naturalHeight: 600, format: 'jpg' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    state.activeFilters = { ...state.activeFilters, size: 'all', types: [], layout: 'all' };
    // Pre-populate cache key matching what applyFilters will compute
    // (after sortImages rearranges; with equal pixels the order is preserved).
    state.lastRenderedFilteredIds = '2:a:b';

    applyFilters();

    // Cache hit — renderImages NOT called, but selection UI still refreshed.
    expect(render.renderImages).not.toHaveBeenCalled();
    expect(actions.updateSelectionUI).toHaveBeenCalledTimes(1);
  });

  it('updates lastRenderedFilteredIds + calls renderImages exactly once on cache miss', async () => {
    const render = await import('../sidepanel/render');
    const actions = await import('../sidepanel/actions');
    state.allImages = [
      makeImg({ id: 'a', naturalWidth: 800, naturalHeight: 600, format: 'jpg' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    state.activeFilters = { ...state.activeFilters, size: 'all', types: [], layout: 'all' };
    state.lastRenderedFilteredIds = 'stale-key';

    applyFilters();

    expect(state.lastRenderedFilteredIds).toBe('1:a:a');
    expect(render.renderImages).toHaveBeenCalledTimes(1);
    expect(actions.updateSelectionUI).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// sortImages — 6 sort modes + default fallthrough
// ─────────────────────────────────────────────────────────────────────
// Pin: sortImages mutates state.filteredImages in place (Array.sort).
// Every branch must be covered because a subtle bug here (e.g. swapping
// a-b → b-a) reverses the displayed order and is invisible in unit tests
// that only check count.

describe('sortImages', () => {
  // Use distinct pixel counts so ordering is unambiguous.
  // small: 100*100=10k, medium: 400*300=120k, large: 800*600=480k
  const small = () => makeImg({ id: 's', naturalWidth: 100, naturalHeight: 100 });
  const medium = () =>
    makeImg({
      id: 'm',
      naturalWidth: 400,
      naturalHeight: 300,
      format: 'png',
      estimatedSize: 5000,
    });
  const large = () =>
    makeImg({
      id: 'l',
      naturalWidth: 800,
      naturalHeight: 600,
      format: 'jpg',
      estimatedSize: 20000,
    });

  it('size-desc (default branch): largest pixels first', () => {
    state.currentSortMode = 'size-desc';
    state.filteredImages = [small(), large(), medium()];
    sortImages();
    expect(state.filteredImages.map((i) => i.id)).toEqual(['l', 'm', 's']);
  });

  it('size-asc: smallest pixels first', () => {
    state.currentSortMode = 'size-asc';
    state.filteredImages = [large(), small(), medium()];
    sortImages();
    expect(state.filteredImages.map((i) => i.id)).toEqual(['s', 'm', 'l']);
  });

  it('filesize-desc: largest estimatedSize first (missing estimatedSize treated as 0)', () => {
    state.currentSortMode = 'filesize-desc';
    state.filteredImages = [small(), large(), medium()];
    sortImages();
    // small has no estimatedSize → 0, ranks last.
    expect(state.filteredImages.map((i) => i.id)).toEqual(['l', 'm', 's']);
  });

  it('filesize-asc: smallest estimatedSize first', () => {
    state.currentSortMode = 'filesize-asc';
    state.filteredImages = [large(), small(), medium()];
    sortImages();
    expect(state.filteredImages.map((i) => i.id)).toEqual(['s', 'm', 'l']);
  });

  it('type: alphabetical by format via localeCompare (missing format treated as "")', () => {
    state.currentSortMode = 'type';
    // Explicitly override small to have NO format (makeImg defaults to 'jpg',
    // which would collide with `large` and make the test ambiguous).
    const noFormat = makeImg({
      id: 's',
      naturalWidth: 100,
      naturalHeight: 100,
      format: undefined,
    });
    state.filteredImages = [large() /* jpg */, medium() /* png */, noFormat /* '' */];
    sortImages();
    // '' < 'jpg' < 'png' in localeCompare → [s, l, m]
    expect(state.filteredImages.map((i) => i.id)).toEqual(['s', 'l', 'm']);
  });

  it('natural: returns 0 for every comparator → original input order preserved', () => {
    state.currentSortMode = 'natural';
    state.filteredImages = [medium(), small(), large()];
    sortImages();
    // V8 Array.sort is stable — natural means "leave it alone".
    expect(state.filteredImages.map((i) => i.id)).toEqual(['m', 's', 'l']);
  });

  it('unknown sort mode falls through to default (size-desc)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.currentSortMode = 'unknown-mode' as any;
    state.filteredImages = [small(), large()];
    sortImages();
    // Default branch behaves like size-desc.
    expect(state.filteredImages.map((i) => i.id)).toEqual(['l', 's']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// renderColorSwatches — color palette DOM + click wiring
// ─────────────────────────────────────────────────────────────────────
// Pin: renderColorSwatches drives the color filter palette in the Settings
// sheet. Three contracts:
//   1. Missing #color-swatches container → silent no-op (lazy-init path).
//   2. Empty colorMap (no images have .colors) → "No colors extracted yet"
//      placeholder HTML, not blank.
//   3. Free users clicking a swatch → PRO upgrade modal (conversion funnel),
//      state.activeFilters.color untouched. Pro users → toggle active
//      class + update state + applyFilters + closeAllFilterDropdowns.

describe('renderColorSwatches', () => {
  function mountContainer() {
    document.body.innerHTML = `
      <div id="color-swatches"></div>
      <div data-color-filter="all" class="active"></div>
    `;
    return document.getElementById('color-swatches')!;
  }

  it('is a silent no-op when #color-swatches is absent (lazy-init guard)', () => {
    document.body.innerHTML = '';
    expect(() => renderColorSwatches()).not.toThrow();
  });

  it('renders the "No colors extracted yet" placeholder when no image has .colors', () => {
    const container = mountContainer();
    state.allImages = [
      makeImg({ id: 'a', colors: undefined }),
      makeImg({ id: 'b', colors: [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    renderColorSwatches();
    expect(container.querySelector('.color-empty-hint')).not.toBeNull();
    expect(container.innerHTML).toContain('No colors extracted yet');
    expect(container.querySelectorAll('.color-swatch')).toHaveLength(0);
  });

  it('emits one .color-swatch per unique color, sorted by frequency DESC, capped at 30', () => {
    const container = mountContainer();
    // #ff0000 appears 3x, #00ff00 appears 2x, #0000ff appears 1x
    state.allImages = [
      makeImg({ id: 'a', colors: ['#FF0000', '#00FF00'] }),
      makeImg({ id: 'b', colors: ['#ff0000', '#0000ff'] }),
      makeImg({ id: 'c', colors: ['#ff0000', '#00ff00'] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    renderColorSwatches();

    const swatches = container.querySelectorAll<HTMLElement>('.color-swatch');
    expect(swatches).toHaveLength(3);
    // Hex lowercased + frequency order.
    expect(swatches[0].dataset.colorValue).toBe('#ff0000');
    expect(swatches[1].dataset.colorValue).toBe('#00ff00');
    expect(swatches[2].dataset.colorValue).toBe('#0000ff');
  });

  it('marks the currently selected color swatch with .active', () => {
    const container = mountContainer();
    state.activeFilters = { ...state.activeFilters, color: '#ff0000' };
    state.allImages = [
      makeImg({ id: 'a', colors: ['#ff0000', '#00ff00'] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    renderColorSwatches();

    const redSwatch = container.querySelector<HTMLElement>('[data-color-value="#ff0000"]')!;
    const greenSwatch = container.querySelector<HTMLElement>('[data-color-value="#00ff00"]')!;
    expect(redSwatch.classList.contains('active')).toBe(true);
    expect(greenSwatch.classList.contains('active')).toBe(false);
  });

  it('click by FREE user → Pro upgrade modal + activeFilters.color untouched', async () => {
    const settingsMod = await import('../sidepanel/settings');
    const uiMod = await import('../sidepanel/ui');
    const container = mountContainer();
    state.isProUser = false;
    state.activeFilters = { ...state.activeFilters, color: null };
    state.allImages = [
      makeImg({ id: 'a', colors: ['#ff0000'] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    renderColorSwatches();

    container.querySelector<HTMLElement>('.color-swatch')!.click();

    // Pro upsell fired; filter state NOT mutated (pin: conversion funnel).
    expect(uiMod.showToast).toHaveBeenCalledWith(expect.stringContaining('Pro feature'), 'warning');
    expect(settingsMod.showProUpgradeModal).toHaveBeenCalledTimes(1);
    expect(state.activeFilters.color).toBeNull();
  });

  it('click by PRO user → activates swatch + updates state + triggers applyFilters pipeline', async () => {
    const renderMod = await import('../sidepanel/render');
    const settingsMod = await import('../sidepanel/settings');
    const container = mountContainer();
    state.isProUser = true;
    state.activeFilters = {
      ...state.activeFilters,
      color: null,
      size: 'all',
      types: [],
      layout: 'all',
    };
    state.allImages = [
      makeImg({ id: 'a', colors: ['#ff0000'] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    state.lastRenderedFilteredIds = null;
    renderColorSwatches();

    container.querySelector<HTMLElement>('.color-swatch')!.click();

    expect(state.activeFilters.color).toBe('#ff0000');
    expect(
      container.querySelector<HTMLElement>('.color-swatch')!.classList.contains('active')
    ).toBe(true);
    // "All Colors" option deselected.
    expect(
      document.querySelector<HTMLElement>('[data-color-filter="all"]')!.classList.contains('active')
    ).toBe(false);
    expect(updateFilterButtonLabels).toHaveBeenCalled();
    expect(renderMod.renderImages).toHaveBeenCalled();
    expect(settingsMod.closeAllFilterDropdowns).toHaveBeenCalled();
  });

  it('PRO user clicking the ACTIVE swatch deselects (color → null)', async () => {
    const container = mountContainer();
    state.isProUser = true;
    state.activeFilters = { ...state.activeFilters, color: '#ff0000' };
    state.allImages = [
      makeImg({ id: 'a', colors: ['#ff0000'] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    renderColorSwatches();

    // The swatch is pre-rendered with .active; clicking it again should
    // flip the state back to `null` via the "deselect" branch.
    const swatch = container.querySelector<HTMLElement>('.color-swatch')!;
    swatch.click();

    expect(state.activeFilters.color).toBeNull();
    expect(swatch.classList.contains('active')).toBe(false);
    // "All Colors" option re-activated via the toggle('active', !color).
    expect(
      document.querySelector<HTMLElement>('[data-color-filter="all"]')!.classList.contains('active')
    ).toBe(true);
  });
});

describe('filterByFileSize', () => {
  it('passes everything when fileSizeEnabled is false', () => {
    state.activeFilters.fileSizeEnabled = false;
    state.activeFilters.minFileSizeKB = 100;
    state.activeFilters.maxFileSizeKB = 500;
    expect(filterByFileSize(makeImg({ estimatedSize: 10 }))).toBe(true);
  });

  it('filters out images below minFileSizeKB', () => {
    state.activeFilters.fileSizeEnabled = true;
    state.activeFilters.minFileSizeKB = 100;
    state.activeFilters.maxFileSizeKB = Infinity;
    // 50 KB = 51200 bytes → below 100 KB threshold
    expect(filterByFileSize(makeImg({ estimatedSize: 51200 }))).toBe(false);
  });

  it('filters out images above maxFileSizeKB', () => {
    state.activeFilters.fileSizeEnabled = true;
    state.activeFilters.minFileSizeKB = 0;
    state.activeFilters.maxFileSizeKB = 200;
    // 300 KB = 307200 bytes → above 200 KB threshold
    expect(filterByFileSize(makeImg({ estimatedSize: 307200 }))).toBe(false);
  });

  it('passes images within range', () => {
    state.activeFilters.fileSizeEnabled = true;
    state.activeFilters.minFileSizeKB = 50;
    state.activeFilters.maxFileSizeKB = 200;
    // 100 KB = 102400 bytes → within range
    expect(filterByFileSize(makeImg({ estimatedSize: 102400 }))).toBe(true);
  });

  it('treats undefined estimatedSize as 0 bytes', () => {
    state.activeFilters.fileSizeEnabled = true;
    state.activeFilters.minFileSizeKB = 10;
    state.activeFilters.maxFileSizeKB = Infinity;
    expect(filterByFileSize(makeImg({ estimatedSize: undefined }))).toBe(false);
  });

  it('preset tiny filters correctly (0-50 KB)', () => {
    state.activeFilters.fileSizeEnabled = true;
    state.activeFilters.fileSizePreset = 'tiny';
    state.activeFilters.minFileSizeKB = FILESIZE_PRESETS.tiny.min;
    state.activeFilters.maxFileSizeKB = FILESIZE_PRESETS.tiny.max;
    // 30 KB = 30720 bytes → within tiny range
    expect(filterByFileSize(makeImg({ estimatedSize: 30720 }))).toBe(true);
    // 60 KB = 61440 bytes → above tiny range
    expect(filterByFileSize(makeImg({ estimatedSize: 61440 }))).toBe(false);
  });
});
