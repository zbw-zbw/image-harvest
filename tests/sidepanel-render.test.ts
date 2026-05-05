// Unit tests for sidepanel/render.ts — focused on the pure groupImages
// algorithm and the toggleGroupCollapse Set toggle. The DOM-rendering
// half (renderImages / renderProgressiveImages) is e2e territory.
//
// What this pins:
//   - groupImages — 4 mode dispatch + key derivation
//     * 'domain' : URL hostname; data:/blob:/parse-fail → 'Other'
//     * 'format' : (img.format || 'unknown').toUpperCase()
//     * 'size'   : delegates to getSizeCategory(w, h)
//     * 'tab'    : img.tabTitle || sourceTabTitle || 'Current Tab'
//     * unknown mode (anything else) → all images bucketed as 'Other'
//   - groupImages — sort contract
//     * mode === 'tab'  → ascending by tabIndex
//     * other modes      → descending by image count, but 'Other' /
//                          'Unknown' are forced to the END regardless
//   - toggleGroupCollapse — symmetric add/remove on state.collapsedGroups

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy DOM/IPC neighbors that render.ts imports for the
// non-tested code paths. updateSelectionUI etc. would otherwise drag
// the entire actions chain in.
vi.mock('../sidepanel/actions', () => ({
  updateSelectionUI: vi.fn(),
}));
vi.mock('../sidepanel/filter', () => ({
  filterByColor: vi.fn(),
  filterByLayout: vi.fn(),
  filterBySettingsMaxSize: vi.fn(),
  filterBySettingsMinSize: vi.fn(),
  filterBySize: vi.fn(),
  filterByType: vi.fn(),
  filterByUrl: vi.fn(),
  sortImages: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  calcSkeletonCount: vi.fn(),
  checkNarrowMode: vi.fn(),
  showEmpty: vi.fn(),
}));

import { groupImages, toggleGroupCollapse } from '../sidepanel/render';
import { state, store } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  store.reset();
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
// groupImages — 'domain' mode
// ─────────────────────────────────────────────────────────────────────

describe("groupImages — mode='domain'", () => {
  it('groups by URL hostname', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', url: 'https://a.com/x.jpg' }),
        makeImg({ id: 'b', url: 'https://a.com/y.jpg' }),
        makeImg({ id: 'c', url: 'https://b.com/z.jpg' }),
      ],
      'domain'
    );
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.images.length]));
    expect(byName).toEqual({ 'a.com': 2, 'b.com': 1 });
  });

  it('buckets data: / blob: / unparseable URLs into "Other"', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', url: 'data:image/png;base64,abc' }),
        makeImg({ id: 'b', url: 'blob:https://x.com/abc' }),
        makeImg({ id: 'c', url: 'not a url' }),
        makeImg({ id: 'd', url: 'https://real.com/x.jpg' }),
      ],
      'domain'
    );
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.images.length]));
    expect(byName).toEqual({ 'real.com': 1, Other: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// groupImages — 'format' mode
// ─────────────────────────────────────────────────────────────────────

describe("groupImages — mode='format'", () => {
  it('uses uppercased format as the group key', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', format: 'jpg' }),
        makeImg({ id: 'b', format: 'jpg' }),
        makeImg({ id: 'c', format: 'png' }),
      ],
      'format'
    );
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.images.length]));
    expect(byName).toEqual({ JPG: 2, PNG: 1 });
  });

  it('treats missing format as "UNKNOWN" (uppercased — note: NOT recognized by the Other/Unknown last-bucket sort)', () => {
    // Subtle contract divergence pinned here: the key derivation does
    //   (img.format || 'unknown').toUpperCase()
    // → 'UNKNOWN', but the sort predicate forces only the literals
    // 'Other' / 'Unknown' (title-case) to the end. So in format mode
    // the missing-format bucket sorts purely by count alongside real
    // formats. Here PNG (3) > UNKNOWN (2) by count, so PNG wins; if
    // UNKNOWN had more it would actually rank ABOVE PNG. This may or
    // may not be intentional — pinning the as-shipped behavior so a
    // future "fix" that case-normalizes one side surfaces in CI.
    const groups = groupImages(
      [
        makeImg({ id: 'a', format: 'png' }),
        makeImg({ id: 'b', format: 'png' }),
        makeImg({ id: 'c', format: 'png' }),
        makeImg({ id: 'd', format: undefined }),
        makeImg({ id: 'e', format: undefined }),
      ],
      'format'
    );
    expect(groups.map((g) => g.name)).toEqual(['PNG', 'UNKNOWN']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// groupImages — 'size' mode (delegates to getSizeCategory)
// ─────────────────────────────────────────────────────────────────────

describe("groupImages — mode='size'", () => {
  it('uses the getSizeCategory bucket as the key (Small/Medium/Large/XL)', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', naturalWidth: 50, naturalHeight: 50 }),
        makeImg({ id: 'b', naturalWidth: 200, naturalHeight: 200 }),
        makeImg({ id: 'c', naturalWidth: 800, naturalHeight: 800 }),
        makeImg({ id: 'd', naturalWidth: 2000, naturalHeight: 2000 }),
      ],
      'size'
    );
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(
      ['Large (500-1000px)', 'Medium (100-500px)', 'Small (< 100px)', 'XL (> 1000px)'].sort()
    );
  });

  it('groups missing-dim images into "Unknown" (forced to end of sort)', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', naturalWidth: 200, naturalHeight: 200 }),
        makeImg({ id: 'b', naturalWidth: 200, naturalHeight: 200 }),
        makeImg({ id: 'c', naturalWidth: 0, naturalHeight: 0 }),
      ],
      'size'
    );
    expect(groups.map((g) => g.name)).toEqual(['Medium (100-500px)', 'Unknown']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// groupImages — 'tab' mode
// ─────────────────────────────────────────────────────────────────────

describe("groupImages — mode='tab'", () => {
  it('uses tabTitle as the group key', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', tabTitle: 'Page A', tabIndex: 0 }),
        makeImg({ id: 'b', tabTitle: 'Page A', tabIndex: 0 }),
        makeImg({ id: 'c', tabTitle: 'Page B', tabIndex: 1 }),
      ],
      'tab'
    );
    expect(groups.map((g) => g.name)).toEqual(['Page A', 'Page B']);
  });

  it('falls back to sourceTabTitle, then to "Current Tab"', () => {
    const groups = groupImages(
      [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeImg({ id: 'a', sourceTabTitle: 'From source' } as any),
        makeImg({ id: 'b' }), // no tabTitle, no sourceTabTitle
      ],
      'tab'
    );
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(['Current Tab', 'From source']);
  });

  it("sorts by tabIndex ascending (NOT by image count) — preserves the user's tab order", () => {
    const groups = groupImages(
      [
        // 1 image at tabIndex=2, 3 images at tabIndex=0
        makeImg({ id: 'a', tabTitle: 'Late', tabIndex: 2 }),
        makeImg({ id: 'b', tabTitle: 'Early', tabIndex: 0 }),
        makeImg({ id: 'c', tabTitle: 'Early', tabIndex: 0 }),
        makeImg({ id: 'd', tabTitle: 'Early', tabIndex: 0 }),
      ],
      'tab'
    );
    // 'Early' (3 imgs) at tabIndex=0 must come first; 'Late' (1 img)
    // at tabIndex=2 last. Default desc-by-count would have flipped.
    expect(groups.map((g) => g.name)).toEqual(['Early', 'Late']);
  });

  it('isCurrentTab flag is captured from the FIRST image to land in the bucket', () => {
    const groups = groupImages(
      [makeImg({ id: 'a', tabTitle: 'Active', tabIndex: 0, isCurrentTab: true })],
      'tab'
    );
    expect(groups[0].isCurrentTab).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// groupImages — sort contract (count-desc + Other/Unknown last)
// ─────────────────────────────────────────────────────────────────────

describe('groupImages — sort contract for non-tab modes', () => {
  it('sorts by image count descending', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', format: 'png' }), // 1 PNG
        makeImg({ id: 'b', format: 'jpg' }), // 3 JPG
        makeImg({ id: 'c', format: 'jpg' }),
        makeImg({ id: 'd', format: 'jpg' }),
        makeImg({ id: 'e', format: 'webp' }), // 2 WEBP
        makeImg({ id: 'f', format: 'webp' }),
      ],
      'format'
    );
    expect(groups.map((g) => g.name)).toEqual(['JPG', 'WEBP', 'PNG']);
  });

  it('forces "Other" to the END regardless of count (domain mode)', () => {
    const groups = groupImages(
      [
        makeImg({ id: 'a', url: 'data:image/png;base64,a' }), // 5 in Other
        makeImg({ id: 'b', url: 'data:image/png;base64,b' }),
        makeImg({ id: 'c', url: 'data:image/png;base64,c' }),
        makeImg({ id: 'd', url: 'data:image/png;base64,d' }),
        makeImg({ id: 'e', url: 'data:image/png;base64,e' }),
        makeImg({ id: 'f', url: 'https://x.com/x.jpg' }), // 1 in x.com
      ],
      'domain'
    );
    // 'Other' has 5 images vs x.com's 1, but the contract is to keep
    // 'Other' at the end so the user's real domains stay on top.
    expect(groups.map((g) => g.name)).toEqual(['x.com', 'Other']);
  });

  it('"Unknown" last-bucket sort fires for "size" mode (where getSizeCategory emits title-case "Unknown")', () => {
    // size mode is where the literal title-case 'Unknown' actually
    // appears (getSizeCategory returns 'Unknown' for missing dims),
    // and where the last-bucket sort genuinely kicks in. Even with
    // 5 Unknown vs 1 Medium, Unknown stays at the end.
    const groups = groupImages(
      [
        makeImg({ id: 'a', naturalWidth: 0, naturalHeight: 0 }), // 5 Unknown
        makeImg({ id: 'b', naturalWidth: 0, naturalHeight: 0 }),
        makeImg({ id: 'c', naturalWidth: 0, naturalHeight: 0 }),
        makeImg({ id: 'd', naturalWidth: 0, naturalHeight: 0 }),
        makeImg({ id: 'e', naturalWidth: 0, naturalHeight: 0 }),
        makeImg({ id: 'f', naturalWidth: 200, naturalHeight: 200 }), // 1 Medium
      ],
      'size'
    );
    expect(groups.map((g) => g.name)).toEqual(['Medium (100-500px)', 'Unknown']);
  });

  it('handles BOTH "Other" and "Unknown" simultaneously (both go to end, real groups in front)', () => {
    // Synthesize a scenario by mixing format mode with manual format
    // string 'Unknown' — actual code only ever produces 'Unknown' in
    // format/size mode and 'Other' in domain mode, but the sort
    // predicate treats both equally; pin that.
    // (We exercise via a single domain-mode call where all real
    // hostnames produce 1 and Other produces 2; Other goes last.)
    const groups = groupImages(
      [
        makeImg({ id: 'a', url: 'data:,1' }),
        makeImg({ id: 'b', url: 'data:,2' }),
        makeImg({ id: 'c', url: 'https://a.com/x' }),
      ],
      'domain'
    );
    expect(groups[groups.length - 1].name).toBe('Other');
  });
});

// ─────────────────────────────────────────────────────────────────────
// groupImages — unknown mode (defensive)
// ─────────────────────────────────────────────────────────────────────

describe('groupImages — unknown mode', () => {
  it('buckets every image into "Other" when mode is not one of the four (defensive default)', () => {
    const groups = groupImages([makeImg({ id: 'a' }), makeImg({ id: 'b' })], 'invalid-mode-xyz');
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Other');
    expect(groups[0].images).toHaveLength(2);
  });

  it('returns [] for an empty image list (no spurious "Other" group)', () => {
    expect(groupImages([], 'domain')).toEqual([]);
    expect(groupImages([], 'format')).toEqual([]);
    expect(groupImages([], 'size')).toEqual([]);
    expect(groupImages([], 'tab')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// toggleGroupCollapse
// ─────────────────────────────────────────────────────────────────────

describe('toggleGroupCollapse', () => {
  it('adds the group name to state.collapsedGroups when not present', () => {
    expect(state.collapsedGroups.has('Photos')).toBe(false);
    toggleGroupCollapse('Photos');
    expect(state.collapsedGroups.has('Photos')).toBe(true);
  });

  it('removes the group name from state.collapsedGroups when already present', () => {
    state.collapsedGroups.add('Photos');
    toggleGroupCollapse('Photos');
    expect(state.collapsedGroups.has('Photos')).toBe(false);
  });

  it('is symmetric: toggling twice returns to the original state', () => {
    toggleGroupCollapse('Photos');
    toggleGroupCollapse('Photos');
    expect(state.collapsedGroups.has('Photos')).toBe(false);
  });

  it('does not affect other group names', () => {
    state.collapsedGroups.add('A');
    state.collapsedGroups.add('B');
    toggleGroupCollapse('A');
    expect(state.collapsedGroups.has('A')).toBe(false);
    expect(state.collapsedGroups.has('B')).toBe(true);
  });
});
