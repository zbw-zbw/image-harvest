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
//
// Skipped on purpose:
//   - applyFilters / sortImages / renderColorSwatches / applyCustomSizeInputs
//     (DOM-dependent — exercised by e2e)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  filterBySize,
  filterByType,
  filterByLayout,
  filterByUrl,
  filterByColor,
  colorDistance,
  filterBySettingsMinSize,
  filterBySettingsMaxSize,
} from '../sidepanel/filter';
import { state, store } from '../sidepanel/state';
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
  it('passes everything when enableMinSize is false', () => {
    state.appSettings = {
      ...state.appSettings,
      enableMinSize: false,
      minWidth: 1000,
      minHeight: 1000,
    };
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 50, naturalHeight: 50 }))).toBe(true);
  });

  it('requires both width AND height to meet their respective bounds', () => {
    state.appSettings = {
      ...state.appSettings,
      enableMinSize: true,
      minWidth: 100,
      minHeight: 100,
    };
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 200, naturalHeight: 200 }))).toBe(true);
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 100, naturalHeight: 100 }))).toBe(true); // inclusive
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 50, naturalHeight: 200 }))).toBe(false);
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 200, naturalHeight: 50 }))).toBe(false);
  });

  it('treats undefined minWidth/minHeight as 0 (effectively pass-through when enabled)', () => {
    state.appSettings = {
      ...state.appSettings,
      enableMinSize: true,
      minWidth: undefined as unknown as number,
      minHeight: undefined as unknown as number,
    };
    expect(filterBySettingsMinSize(makeImg({ naturalWidth: 1, naturalHeight: 1 }))).toBe(true);
  });
});

describe('filterBySettingsMaxSize', () => {
  it('passes everything when enableMaxSize is false', () => {
    state.appSettings = {
      ...state.appSettings,
      enableMaxSize: false,
      maxWidth: 100,
      maxHeight: 100,
    };
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 5000, naturalHeight: 5000 }))).toBe(
      true
    );
  });

  it('requires both width AND height to be within their respective bounds', () => {
    state.appSettings = {
      ...state.appSettings,
      enableMaxSize: true,
      maxWidth: 1000,
      maxHeight: 1000,
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

  it('treats undefined maxWidth/maxHeight as Infinity (effectively no upper bound when enabled)', () => {
    state.appSettings = {
      ...state.appSettings,
      enableMaxSize: true,
      maxWidth: undefined as unknown as number,
      maxHeight: undefined as unknown as number,
    };
    expect(filterBySettingsMaxSize(makeImg({ naturalWidth: 99999, naturalHeight: 99999 }))).toBe(
      true
    );
  });
});
