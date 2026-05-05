// Unit tests for content/extract-advanced.ts — focused on the two
// element-level extractors that produce ImageItems from non-<img>
// sources:
//
//   - extractInlineSvg: serialize SVG → base64 data URI, dedup,
//     ImageItem with type='svg' / format='svg'
//   - extractCanvasImage: canvas.toDataURL → length guard against
//     blank canvases, taint-catch (cross-origin), dedup, ImageItem
//     with type='canvas' / format='png'
//
// The 8 async DOM-walking exports (extractInlineSvgs / Canvas /
// VideoPoster / Input / ObjectEmbed / MetaAndLink / LazyLoad /
// CssContent) are e2e territory — they require constructing realistic
// DOM trees and rely on getComputedStyle for non-trivial decisions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock content/state so seenUrls can be inspected per-test.
const seenUrls = new Set<string>();
vi.mock('../content/state', () => ({
  state: {
    get seenUrls() {
      return seenUrls;
    },
    liveObserver: null,
  },
  isExtensionContextValid: vi.fn(() => true),
}));

// Mock shared/utils — generateId / generateDataUriKey just need to be
// deterministic and url-shaped so dedup works.
vi.mock('../shared/utils', () => ({
  generateId: vi.fn((url: string) => `id-${url.slice(0, 16)}`),
  // Use the FULL dataUri as the dedup key. Same input → same key
  // (dedup tests work), different inputs → different keys (no
  // accidental cross-case collisions). Slicing or hashing would
  // collide because jsdom's XMLSerializer + btoa produce outputs
  // with similar prefixes/suffixes for structurally-equivalent SVGs.
  generateDataUriKey: vi.fn((dataUri: string) => `key-${dataUri}`),
  resolveUrl: vi.fn((u: string) => u),
  getDomain: vi.fn((u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  }),
  getFileFormat: vi.fn(() => 'unknown'),
  isDataUri: vi.fn((u: string) => u.startsWith('data:')),
  isImageDataUri: vi.fn((u: string) => u.startsWith('data:image/')),
  extractBackgroundUrls: vi.fn(() => []),
  isGradient: vi.fn(() => false),
}));

vi.mock('../content/utils', () => ({
  skipElement: vi.fn(() => false),
  parseSrcset: vi.fn(() => []),
}));

import { extractInlineSvg, extractCanvasImage } from '../content/extract-advanced';

beforeEach(() => {
  document.body.innerHTML = '';
  seenUrls.clear();
  // window.location.hostname defaults to 'localhost' in jsdom; that's
  // fine for sourceDomain assertions.
});

afterEach(() => {
  document.body.innerHTML = '';
  seenUrls.clear();
  // Use restoreAllMocks (not clearAllMocks) so vi.spyOn() impls are
  // reverted to the original prototype methods. Otherwise the spy
  // installed in the "catches XMLSerializer exception" case leaks
  // and forces all subsequent extractInlineSvg calls to throw.
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// extractInlineSvg
// ─────────────────────────────────────────────────────────────────────

describe('extractInlineSvg', () => {
  // jsdom's XMLSerializer always produces "<svg xmlns=...>...</svg>"
  // with no whitespace differentiation, so two empty SVGs serialize
  // identically and collide on dataKey. Tag each SVG with a unique
  // child + id so the serialized string differs across cases.
  let svgUniqueCounter = 0;
  function makeSvg(width: number, height: number): SVGElement {
    const svg = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ) as SVGElement;
    svg.setAttribute('id', `svg-${++svgUniqueCounter}-${width}x${height}`);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    svg.appendChild(rect);
    document.body.appendChild(svg);
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
    return svg;
  }

  it('returns null for tiny SVGs (< 2px width or height) — pin the icon-skip threshold', () => {
    expect(extractInlineSvg(makeSvg(1, 100))).toBeNull();
    expect(extractInlineSvg(makeSvg(100, 1))).toBeNull();
    expect(extractInlineSvg(makeSvg(0, 0))).toBeNull();
  });

  it('does NOT skip an exactly 2×2 SVG (boundary is < 2, not <= 2)', () => {
    const item = extractInlineSvg(makeSvg(2, 2));
    expect(item).not.toBeNull();
    expect(item?.displayWidth).toBe(2);
    expect(item?.displayHeight).toBe(2);
  });

  it('emits ImageItem with type="svg" / format="svg" + base64-encoded data URI', () => {
    const item = extractInlineSvg(makeSvg(100, 50));
    expect(item).not.toBeNull();
    expect(item?.type).toBe('svg');
    expect(item?.format).toBe('svg');
    expect(item?.url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(item?.displayWidth).toBe(100);
    expect(item?.displayHeight).toBe(50);
  });

  it('rounds non-integer dimensions for displayWidth / displayHeight', () => {
    const item = extractInlineSvg(makeSvg(100.4, 50.7));
    expect(item?.displayWidth).toBe(100);
    expect(item?.displayHeight).toBe(51);
  });

  it('dedups via state.seenUrls — second call on the SAME svg returns null', () => {
    const svg = makeSvg(100, 100);
    expect(extractInlineSvg(svg)).not.toBeNull();
    expect(extractInlineSvg(svg)).toBeNull(); // same dataKey → already seen
  });

  it('records the dataKey into state.seenUrls (not the raw data URI)', () => {
    extractInlineSvg(makeSvg(100, 100));
    // Our mocked generateDataUriKey returns 'key-...' — pin that the
    // SET key is the dedup key, not the full data URI.
    const keys = Array.from(seenUrls);
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith('key-')).toBe(true);
  });

  it('catches XMLSerializer / btoa exceptions and returns null gracefully', () => {
    const svg = makeSvg(100, 100);
    // Spy on XMLSerializer to throw.
    vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(() => {
      throw new Error('serialization failed');
    });
    expect(extractInlineSvg(svg)).toBeNull();
  });

  it('uses window.location.hostname as sourceDomain', () => {
    // Force-clear seenUrls in case earlier same-file cases mutated it
    // beyond what beforeEach reset (mock factory closure interaction).
    seenUrls.clear();
    const item = extractInlineSvg(makeSvg(101, 99));
    expect(item).not.toBeNull();
    expect(item?.sourceDomain).toBe(window.location.hostname);
  });

  it('sets timestamp to roughly Date.now() (within 5s of test execution)', () => {
    seenUrls.clear();
    const before = Date.now();
    const item = extractInlineSvg(makeSvg(103, 97)) as ({ timestamp: number } | null);
    const after = Date.now();
    expect(item).not.toBeNull();
    expect(item!.timestamp).toBeGreaterThanOrEqual(before);
    expect(item!.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractCanvasImage
// ─────────────────────────────────────────────────────────────────────

describe('extractCanvasImage', () => {
  function makeCanvas(width: number, height: number, dataUriOverride?: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    if (dataUriOverride !== undefined) {
      vi.spyOn(canvas, 'toDataURL').mockImplementation(() => dataUriOverride);
    }
    return canvas;
  }

  it('returns null for tiny canvases (< 2px width or height)', () => {
    expect(extractCanvasImage(makeCanvas(1, 100))).toBeNull();
    expect(extractCanvasImage(makeCanvas(100, 1))).toBeNull();
    expect(extractCanvasImage(makeCanvas(0, 0))).toBeNull();
  });

  it('returns null when toDataURL produces a short blank-canvas string (< 100 chars)', () => {
    // jsdom's default toDataURL returns 'data:,' for empty canvases.
    // Pin that the < 100 length guard catches it.
    const canvas = makeCanvas(100, 100, 'data:,');
    expect(extractCanvasImage(canvas)).toBeNull();
  });

  it('returns null on canvas-tainted exception (cross-origin draw → toDataURL throws)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    document.body.appendChild(canvas);
    vi.spyOn(canvas, 'toDataURL').mockImplementation(() => {
      throw new DOMException('Tainted canvas', 'SecurityError');
    });
    expect(extractCanvasImage(canvas)).toBeNull();
  });

  it('emits ImageItem with type="canvas" / format="png" + canvas-derived data URI', () => {
    // Stub a long-enough fake PNG data URI.
    const fakeDataUri =
      'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(150, 75, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item).not.toBeNull();
    expect(item?.type).toBe('canvas');
    expect(item?.format).toBe('png');
    expect(item?.url).toBe(fakeDataUri);
    expect(item?.displayWidth).toBe(150);
    expect(item?.displayHeight).toBe(75);
  });

  it('uses canvas.width/height directly (NOT rect — canvas backing store ≠ rendered size)', () => {
    // Pin the contract: we want the BACKING STORE dimensions because
    // that's what toDataURL captures, not the CSS-rendered size.
    const fakeDataUri =
      'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(800, 600, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item?.displayWidth).toBe(800);
    expect(item?.displayHeight).toBe(600);
  });

  it('dedups via state.seenUrls — second call on the same canvas returns null', () => {
    const fakeDataUri =
      'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(100, 100, fakeDataUri);

    expect(extractCanvasImage(canvas)).not.toBeNull();
    expect(extractCanvasImage(canvas)).toBeNull();
  });

  it('does NOT skip an exactly 2×2 canvas (boundary is < 2, not <= 2)', () => {
    const fakeDataUri =
      'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(2, 2, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item).not.toBeNull();
    expect(item?.displayWidth).toBe(2);
    expect(item?.displayHeight).toBe(2);
  });

  it('uses window.location.hostname as sourceDomain', () => {
    const fakeDataUri =
      'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(100, 100, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item?.sourceDomain).toBe(window.location.hostname);
  });
});
