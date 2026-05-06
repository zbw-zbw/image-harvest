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
// deterministic and url-shaped so dedup works. The other helpers need
// realistic-enough implementations so the async DOM-walking extractors
// (extractInlineSvgs / VideoPosterImages / InputImages / ObjectEmbedImages
// / MetaAndLinkImages / LazyLoadImages / CssContentImages) can actually
// produce ImageItems instead of always early-returning.
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
  getFileFormat: vi.fn((u: string) => {
    if (!u) return 'unknown';
    if (u.includes('.png')) return 'png';
    if (u.includes('.jpg') || u.includes('.jpeg')) return 'jpg';
    if (u.includes('.svg')) return 'svg';
    if (u.includes('.gif')) return 'gif';
    if (u.includes('.webp')) return 'webp';
    if (u.includes('.ico')) return 'ico';
    return 'unknown';
  }),
  isDataUri: vi.fn((u: string) => u.startsWith('data:')),
  isImageDataUri: vi.fn((u: string) => u.startsWith('data:image/')),
  // Real-ish url() parser so background-image / css-content / data-bg
  // url() syntax all work end-to-end.
  extractBackgroundUrls: vi.fn((value: string) => {
    if (!value) return [];
    const matches = Array.from(value.matchAll(/url\(['"]?([^'")]+)['"]?\)/g));
    return matches.map((m) => m[1]);
  }),
  isGradient: vi.fn((u: string) => u.includes('gradient(')),
}));

vi.mock('../content/utils', () => ({
  skipElement: vi.fn(() => false),
  parseSrcset: vi.fn((srcset: string) =>
    srcset.split(',').map((part) => {
      const [url] = part.trim().split(/\s+/);
      return { url, width: 0 };
    })
  ),
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
  // Also clear <head> — the async extractors that run on link[rel=icon]
  // and meta[property=og:image] append fixtures to <head>, which would
  // otherwise leak across cases and inflate counts.
  document.head.innerHTML = '';
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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGElement;
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
    const item = extractInlineSvg(makeSvg(103, 97)) as { timestamp: number } | null;
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
    const fakeDataUri = 'data:image/png;base64,' + 'A'.repeat(200);
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
    const fakeDataUri = 'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(800, 600, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item?.displayWidth).toBe(800);
    expect(item?.displayHeight).toBe(600);
  });

  it('dedups via state.seenUrls — second call on the same canvas returns null', () => {
    const fakeDataUri = 'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(100, 100, fakeDataUri);

    expect(extractCanvasImage(canvas)).not.toBeNull();
    expect(extractCanvasImage(canvas)).toBeNull();
  });

  it('does NOT skip an exactly 2×2 canvas (boundary is < 2, not <= 2)', () => {
    const fakeDataUri = 'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(2, 2, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item).not.toBeNull();
    expect(item?.displayWidth).toBe(2);
    expect(item?.displayHeight).toBe(2);
  });

  it('uses window.location.hostname as sourceDomain', () => {
    const fakeDataUri = 'data:image/png;base64,' + 'A'.repeat(200);
    const canvas = makeCanvas(100, 100, fakeDataUri);

    const item = extractCanvasImage(canvas);
    expect(item?.sourceDomain).toBe(window.location.hostname);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Async DOM-walking extractors — page-level scanners that populate
// the shared `images` Map. Each delegates to either:
//   - the element-level helpers tested above (extractInlineSvg /
//     extractCanvasImage), or
//   - inline URL → ImageItem construction with the shared dedup logic.
// ─────────────────────────────────────────────────────────────────────

import {
  extractInlineSvgs,
  extractCanvasElements,
  extractVideoPosterImages,
  extractInputImages,
  extractObjectEmbedImages,
  extractMetaAndLinkImages,
  extractLazyLoadImages,
  extractCssContentImages,
} from '../content/extract-advanced';

// Helper — stub getBoundingClientRect (jsdom returns 0).
function stubElementRect(el: Element, w: number, h: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      width: w,
      height: h,
      top: 0,
      left: 0,
      right: w,
      bottom: h,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    configurable: true,
  });
}

// ─────────────────────────────────────────────────────────────────────
// extractInlineSvgs — page-wide <svg> scan with closest('img') skip
// ─────────────────────────────────────────────────────────────────────

describe('extractInlineSvgs', () => {
  it('finds top-level <svg> elements and writes ImageItems into the Map', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'hero-svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100');
    rect.setAttribute('height', '50');
    svg.appendChild(rect);
    stubElementRect(svg, 100, 50);
    document.body.appendChild(svg);

    const images = new Map();
    await extractInlineSvgs(images);
    expect(images.size).toBe(1);
    const [item] = Array.from(images.values());
    expect(item.type).toBe('svg');
  });

  it('skips <svg> nested inside an <img> (already handled by extractInlineSvg path)', async () => {
    // Pin: <img><svg/></img> is an unusual but valid construct (some
    // libraries inline SVG inside <img> via XHTML). The extractor
    // must skip these to avoid double-counting.
    const img = document.createElement('img');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stubElementRect(svg, 100, 100);
    img.appendChild(svg);
    document.body.appendChild(img);

    const images = new Map();
    await extractInlineSvgs(images);
    expect(images.size).toBe(0);
  });

  it('skips <svg> with rect.width < 2 (icon-skip threshold)', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stubElementRect(svg, 1, 100);
    document.body.appendChild(svg);

    const images = new Map();
    await extractInlineSvgs(images);
    expect(images.size).toBe(0);
  });

  it('skips <svg> when getBoundingClientRect throws (defensive try/catch)', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => {
        throw new Error('jsdom rect failure');
      },
      configurable: true,
    });
    document.body.appendChild(svg);

    const images = new Map();
    // Must NOT throw — defensive try/catch swallows the error.
    await expect(extractInlineSvgs(images)).resolves.toBeUndefined();
    expect(images.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractCanvasElements — page-wide <canvas> scan
// ─────────────────────────────────────────────────────────────────────

describe('extractCanvasElements', () => {
  it('finds all <canvas> elements and writes ImageItems into the Map', async () => {
    const c1 = document.createElement('canvas');
    c1.width = 100;
    c1.height = 100;
    const dataUri = 'data:image/png;base64,' + 'A'.repeat(200);
    vi.spyOn(c1, 'toDataURL').mockReturnValue(dataUri);
    document.body.appendChild(c1);

    const images = new Map();
    await extractCanvasElements(images);
    expect(images.size).toBe(1);
    const [item] = Array.from(images.values());
    expect(item.type).toBe('canvas');
  });

  it('skips canvases that extractCanvasImage rejects (tainted / blank)', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    vi.spyOn(canvas, 'toDataURL').mockImplementation(() => {
      throw new DOMException('Tainted', 'SecurityError');
    });
    document.body.appendChild(canvas);

    const images = new Map();
    await extractCanvasElements(images);
    expect(images.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractVideoPosterImages — video[poster] selector
// ─────────────────────────────────────────────────────────────────────

describe('extractVideoPosterImages', () => {
  it('extracts video[poster] as type="video-poster"', async () => {
    const v = document.createElement('video');
    v.poster = 'https://example.com/cover.jpg';
    document.body.appendChild(v);

    const images = new Map();
    await extractVideoPosterImages(images);
    expect(images.size).toBe(1);
    const [item] = Array.from(images.values());
    expect(item.type).toBe('video-poster');
    expect(item.format).toBe('jpg');
  });

  it('skips non-image data: URI poster', async () => {
    const v = document.createElement('video');
    v.poster = 'data:text/plain,hello';
    document.body.appendChild(v);

    const images = new Map();
    await extractVideoPosterImages(images);
    expect(images.size).toBe(0);
  });

  it('handles image data: URI poster with type="video-poster"', async () => {
    const v = document.createElement('video');
    v.poster = 'data:image/jpeg;base64,AAAA';
    document.body.appendChild(v);

    const images = new Map();
    await extractVideoPosterImages(images);
    expect(images.size).toBe(1);
    const [item] = Array.from(images.values());
    expect(item.url.startsWith('data:image/jpeg')).toBe(true);
  });

  it('dedups identical poster URLs across multiple videos', async () => {
    for (let i = 0; i < 3; i++) {
      const v = document.createElement('video');
      v.poster = 'https://example.com/shared.jpg';
      document.body.appendChild(v);
    }
    const images = new Map();
    await extractVideoPosterImages(images);
    expect(images.size).toBe(1);
  });

  it('selector `video[poster]` filters out videos with NO poster attribute', async () => {
    // Pin: a <video> without poster shouldn't even be queried — the
    // CSS selector itself enforces this. Confirm by mixing one with
    // and one without.
    const withPoster = document.createElement('video');
    withPoster.poster = 'https://example.com/has.jpg';
    const withoutPoster = document.createElement('video');
    document.body.appendChild(withPoster);
    document.body.appendChild(withoutPoster);

    const images = new Map();
    await extractVideoPosterImages(images);
    expect(images.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractInputImages — input[type="image"] selector
// ─────────────────────────────────────────────────────────────────────

describe('extractInputImages', () => {
  it('extracts input[type="image"] as type="input-image"', async () => {
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'https://example.com/submit.png';
    document.body.appendChild(input);

    const images = new Map();
    await extractInputImages(images);
    expect(images.size).toBe(1);
    const [item] = Array.from(images.values());
    expect(item.type).toBe('input-image');
  });

  it('selector ignores input[type="text"] etc.', async () => {
    const text = document.createElement('input');
    text.type = 'text';
    text.src = 'https://example.com/photo.jpg';
    document.body.appendChild(text);

    const images = new Map();
    await extractInputImages(images);
    expect(images.size).toBe(0);
  });

  it('skips input[type="image"] with empty src (prevents undefined ImageItem)', async () => {
    const input = document.createElement('input');
    input.type = 'image';
    document.body.appendChild(input);

    const images = new Map();
    await extractInputImages(images);
    expect(images.size).toBe(0);
  });

  it('handles data: URI src', async () => {
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'data:image/png;base64,AAAA';
    document.body.appendChild(input);

    const images = new Map();
    await extractInputImages(images);
    expect(images.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractObjectEmbedImages — <object> + <embed> with image type filter
// ─────────────────────────────────────────────────────────────────────

describe('extractObjectEmbedImages', () => {
  it('extracts <object type="image/png" data="..."> as type="object"', async () => {
    const obj = document.createElement('object');
    obj.type = 'image/png';
    obj.data = 'https://example.com/g.png';
    stubElementRect(obj, 200, 100);
    document.body.appendChild(obj);

    const images = new Map();
    await extractObjectEmbedImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('object');
    expect(items[0].displayWidth).toBe(200);
  });

  it('extracts <object> when type is missing but URL has image extension', async () => {
    // Pin: the type attribute is OPTIONAL; getFileFormat fallback is the
    // only way to detect images embedded as <object> without explicit type.
    const obj = document.createElement('object');
    obj.data = 'https://example.com/g.png';
    stubElementRect(obj, 50, 50);
    document.body.appendChild(obj);

    const images = new Map();
    await extractObjectEmbedImages(images);
    expect(images.size).toBe(1);
  });

  it('skips <object> with non-image type AND unknown extension (PDF etc.)', async () => {
    const obj = document.createElement('object');
    obj.type = 'application/pdf';
    obj.data = 'https://example.com/doc.pdf';
    document.body.appendChild(obj);

    const images = new Map();
    await extractObjectEmbedImages(images);
    expect(images.size).toBe(0);
  });

  it('extracts <embed type="image/jpeg"> as type="embed"', async () => {
    const embed = document.createElement('embed');
    embed.type = 'image/jpeg';
    embed.src = 'https://example.com/g.jpg';
    stubElementRect(embed, 300, 200);
    document.body.appendChild(embed);

    const images = new Map();
    await extractObjectEmbedImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('embed');
  });

  it('handles a mix of <object> and <embed> in the same scan', async () => {
    const obj = document.createElement('object');
    obj.type = 'image/png';
    obj.data = 'https://example.com/o.png';
    stubElementRect(obj, 100, 100);

    const embed = document.createElement('embed');
    embed.type = 'image/jpeg';
    embed.src = 'https://example.com/e.jpg';
    stubElementRect(embed, 100, 100);

    document.body.appendChild(obj);
    document.body.appendChild(embed);

    const images = new Map();
    await extractObjectEmbedImages(images);
    expect(images.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractMetaAndLinkImages — <link rel=icon> + <meta property=og:image>
// ─────────────────────────────────────────────────────────────────────

describe('extractMetaAndLinkImages', () => {
  it.each([
    'icon',
    'shortcut icon',
    'apple-touch-icon',
    'apple-touch-icon-precomposed',
    'mask-icon',
  ])('extracts <link rel="%s" href="..."> as type="link-icon"', async (rel) => {
    const link = document.createElement('link');
    link.setAttribute('rel', rel);
    link.href = `https://example.com/${rel.replace(/\s/g, '-')}.png`;
    document.head.appendChild(link);

    const images = new Map();
    await extractMetaAndLinkImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link-icon');
  });

  it('parses link[sizes="WxH"] into displayWidth/Height', async () => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('sizes', '32x32');
    link.href = 'https://example.com/favicon.ico';
    document.head.appendChild(link);

    const images = new Map();
    await extractMetaAndLinkImages(images);
    const [item] = Array.from(images.values());
    expect(item.displayWidth).toBe(32);
    expect(item.displayHeight).toBe(32);
  });

  it('treats link[sizes="any"] as 0×0 (vector icon — exact dimensions unknown)', async () => {
    // Pin: sizes='any' is the SVG/vector convention. Skipping the parse
    // is correct — assigning a fake dimension would mislead downstream
    // size-filter UI.
    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('sizes', 'any');
    link.href = 'https://example.com/icon.svg';
    document.head.appendChild(link);

    const images = new Map();
    await extractMetaAndLinkImages(images);
    const [item] = Array.from(images.values());
    expect(item.displayWidth).toBe(0);
    expect(item.displayHeight).toBe(0);
  });

  it('skips data: URI link href (favicons embedded as data URIs are noise)', async () => {
    // Pin: many sites embed a 1×1 pixel as data: URI favicon. Skipping
    // these prevents polluting the gallery with junk.
    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.href = 'data:image/png;base64,iVBORw0KGgo=';
    document.head.appendChild(link);

    const images = new Map();
    await extractMetaAndLinkImages(images);
    expect(images.size).toBe(0);
  });

  it.each([
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
  ])('extracts %s content as type="meta"', async (selector) => {
    const meta = document.createElement('meta');
    // Parse selector to get attr=value.
    const match = selector.match(/\[([^=]+)="([^"]+)"\]/);
    meta.setAttribute(match![1], match![2]);
    meta.setAttribute('content', `https://example.com/${match![2]}.jpg`);
    document.head.appendChild(meta);

    const images = new Map();
    await extractMetaAndLinkImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('meta');
  });

  it('meta with empty content is skipped', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:image');
    meta.setAttribute('content', '');
    document.head.appendChild(meta);

    const images = new Map();
    await extractMetaAndLinkImages(images);
    expect(images.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractLazyLoadImages — 11 single-URL data-* + 2 srcset-style attrs
// ─────────────────────────────────────────────────────────────────────

describe('extractLazyLoadImages', () => {
  it.each([
    'data-src',
    'data-original',
    'data-lazy',
    'data-lazy-src',
    'data-hi-res-src',
    'data-image',
    'data-full-src',
    'data-poster',
  ])('extracts an <img> with %s lazy-load attribute', async (attr) => {
    const img = document.createElement('img');
    img.setAttribute(attr, `https://example.com/${attr}.jpg`);
    document.body.appendChild(img);

    const images = new Map();
    await extractLazyLoadImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('lazy');
  });

  it('parses url() syntax in data-bg attribute', async () => {
    const div = document.createElement('div');
    div.setAttribute('data-bg', "url('https://example.com/bg.png')");
    stubElementRect(div, 200, 100);
    document.body.appendChild(div);

    const images = new Map();
    await extractLazyLoadImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://example.com/bg.png');
  });

  it('extracts data-srcset candidates via parseSrcset', async () => {
    const img = document.createElement('img');
    img.setAttribute(
      'data-srcset',
      'https://example.com/s.jpg 320w, https://example.com/l.jpg 800w'
    );
    document.body.appendChild(img);

    const images = new Map();
    await extractLazyLoadImages(images);
    expect(images.size).toBe(2);
  });

  it('skips non-bg/non-img elements with unknown-format value (defensive context check)', async () => {
    // Pin: <span data-src="not-an-image-url"> with no .jpg/.png hint
    // and not on an <img> is treated as junk. This prevents arbitrary
    // strings on random elements from polluting results.
    const span = document.createElement('span');
    span.setAttribute('data-src', 'arbitrary-non-image-string');
    document.body.appendChild(span);

    const images = new Map();
    await extractLazyLoadImages(images);
    expect(images.size).toBe(0);
  });

  it('ALLOWS the same value on a bg-named attribute even with unknown format (bg path is permissive)', async () => {
    // Pin: data-bg / data-background can be CSS shorthand or arbitrary
    // strings — the bg-context fallback bypasses the format check.
    const div = document.createElement('div');
    div.setAttribute('data-bg', 'arbitrary-non-image-string');
    stubElementRect(div, 100, 100);
    document.body.appendChild(div);

    const images = new Map();
    await extractLazyLoadImages(images);
    expect(images.size).toBe(1);
  });

  it('data-srcset with an image data-uri candidate → extracts as lazy via data-uri branch (uses generateDataUriKey)', async () => {
    // Pin: the lazy-load srcset parser has a separate data-uri branch
    // (L437-456) that bypasses resolveUrl + uses generateDataUriKey
    // for dedupe. Without the `isImageDataUri` guard, a `data:text/html`
    // URI embedded in a srcset would be added as a lazy image —
    // silently exfiltrating page HTML into the scan results.
    //
    // Implementation detail: real `parseSrcset` uses split(',') which
    // miss-splits `data:image/png;base64,ABC` at the internal comma.
    // To hit the data-uri branch cleanly we mock parseSrcset to yield
    // a pre-parsed candidate list — this is the same strategy the
    // source uses in production because callers never build srcsets
    // manually; the browser always produces a whitespace-only-
    // separated descriptor form.
    const { parseSrcset } = await import('../content/utils');
    vi.mocked(parseSrcset).mockImplementationOnce(() => [
      { url: 'data:image/png;base64,iVBORw0KGgoAAAA', width: 0 },
      { url: 'https://example.com/real.jpg', width: 2000 },
    ]);

    const img = document.createElement('img');
    img.setAttribute('data-srcset', 'placeholder-gets-mocked-away');
    stubElementRect(img, 100, 50);
    Object.defineProperty(img, 'naturalWidth', { value: 100 });
    Object.defineProperty(img, 'naturalHeight', { value: 50 });
    document.body.appendChild(img);

    const images = new Map();
    await extractLazyLoadImages(images);
    const items = Array.from(images.values());
    const dataItem = items.find((i) => i.url.startsWith('data:image/'));
    expect(dataItem).toBeDefined();
    // Pin: type is still 'lazy' (not 'data-uri' or 'svg') because the
    // data-uri came through the lazy-load attribute path — the type
    // reflects the DISCOVERY site, not the URL scheme.
    expect(dataItem!.type).toBe('lazy');
    // sourceDomain falls back to window.location.hostname for data-uris
    // (no `getDomain` call) — pinned because getDomain('data:...')
    // returns '' which would hide the item from domain-filter UI.
    expect(dataItem!.sourceDomain).toBe(window.location.hostname);
    // naturalWidth preferred over rect.width when non-zero.
    expect(dataItem!.displayWidth).toBe(100);
    expect(dataItem!.displayHeight).toBe(50);
  });

  it('data-srcset: non-image data-uri (data:text/html) is REJECTED by isImageDataUri guard', async () => {
    // Defensive pin: the exact check that stops text/html data-uris
    // from being exfiltrated. Without `isImageDataUri`, a malicious
    // site could smuggle scripts into the sidepanel via the extractor.
    const { parseSrcset } = await import('../content/utils');
    vi.mocked(parseSrcset).mockImplementationOnce(() => [
      { url: 'data:text/html;base64,PHNjcmlwdD4=', width: 0 },
    ]);

    const img = document.createElement('img');
    img.setAttribute('data-srcset', 'placeholder');
    document.body.appendChild(img);

    const images = new Map();
    await extractLazyLoadImages(images);
    expect(images.size).toBe(0);
  });

  it('data-srcset: duplicate data-uri across descriptors is de-duped via seenUrls', async () => {
    // Pin: the `state.seenUrls.has(dataKey)` guard inside the data-uri
    // branch. Without it, identical URIs at two descriptors would
    // create two items with the same url string but different ids —
    // breaking downstream dedup-by-url checks.
    const dataUri = 'data:image/png;base64,AAAA';
    const { parseSrcset } = await import('../content/utils');
    vi.mocked(parseSrcset).mockImplementationOnce(() => [
      { url: dataUri, width: 0 },
      { url: dataUri, width: 2000 },
    ]);

    const img = document.createElement('img');
    img.setAttribute('data-srcset', 'placeholder');
    document.body.appendChild(img);

    const images = new Map();
    await extractLazyLoadImages(images);
    expect(images.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractCssContentImages — ::before / ::after pseudo-elements
// ─────────────────────────────────────────────────────────────────────

describe('extractCssContentImages', () => {
  it('returns silently when no pseudo-content url() values exist', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const images = new Map();
    await extractCssContentImages(images);
    expect(images.size).toBe(0);
  });

  it('extracts url() from ::before content via getComputedStyle', async () => {
    // jsdom doesn't actually compute pseudo-element styles, so we stub
    // window.getComputedStyle to return content with a url() for the
    // ::before query and 'none' otherwise.
    const div = document.createElement('div');
    document.body.appendChild(div);

    const realGCS = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el: Element, pseudo?: string | null) => {
        if (pseudo === '::before') {
          return {
            content: 'url("https://example.com/before.png")',
          } as CSSStyleDeclaration;
        }
        if (pseudo === '::after') {
          return { content: 'none' } as CSSStyleDeclaration;
        }
        return realGCS(el);
      }
    );

    const images = new Map();
    await extractCssContentImages(images);
    const items = Array.from(images.values());
    expect(items.some((i) => i.type === 'css-content')).toBe(true);
  });

  it('skips elements that skipElement says to skip (delegation contract)', async () => {
    const { skipElement } = await import('../content/utils');
    vi.mocked(skipElement).mockReturnValue(true);

    const div = document.createElement('div');
    document.body.appendChild(div);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      content: 'url("https://example.com/skip-me.png")',
    } as CSSStyleDeclaration);

    const images = new Map();
    await extractCssContentImages(images);
    expect(images.size).toBe(0);
  });

  it('swallows getComputedStyle exceptions (defensive — some pseudos are inaccessible)', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('jsdom pseudo not implemented');
    });

    const images = new Map();
    await expect(extractCssContentImages(images)).resolves.toBeUndefined();
    expect(images.size).toBe(0);
  });

  it('::before content: url(data:image/png;base64,...) → type=css-content + data-uri dedup key', async () => {
    // Pin: the data-uri branch (L507-524) of extractCssContentImages.
    // This path uses generateDataUriKey for dedup, sourceDomain =
    // window.location.hostname fallback, and format from
    // getFileFormat(url). Without it, a ::before content: url(data:...)
    // would flow into the resolveUrl branch and silently fail because
    // resolveUrl treats the data-uri as an invalid relative path.
    const div = document.createElement('div');
    div.id = 'target-div';
    stubElementRect(div, 50, 50);
    document.body.appendChild(div);

    const realGCS = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el: Element, pseudo?: string | null) => {
        // Only the TARGET div gets the real content — body and
        // everything else gets 'none'. Without this per-element
        // isolation, the body element also receives a content: url()
        // but its rect is 0×0 (never stubbed), creating a phantom
        // item with displayWidth=0 that shadows the real test.
        if (pseudo === '::before' && (el as HTMLElement).id === 'target-div') {
          return {
            content: 'url("data:image/png;base64,iVBORw0KGgo")',
          } as CSSStyleDeclaration;
        }
        if (pseudo === '::before' || pseudo === '::after') {
          return { content: 'none' } as CSSStyleDeclaration;
        }
        return realGCS(el);
      }
    );

    const images = new Map();
    await extractCssContentImages(images);
    const items = Array.from(images.values());
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('css-content');
    expect(items[0].url.startsWith('data:image/png')).toBe(true);
    // Dimensions come from getBoundingClientRect (NOT naturalWidth —
    // pseudo-elements have no intrinsic size), stubbed at 50×50.
    expect(items[0].displayWidth).toBe(50);
    expect(items[0].displayHeight).toBe(50);
    // sourceDomain falls back to hostname (data-uri has no domain).
    expect(items[0].sourceDomain).toBe(window.location.hostname);
  });

  it('::before content: non-image data-uri rejected by isImageDataUri guard', async () => {
    // Pin: the same security guard as lazy-srcset. A crafted CSS
    // `content: url(data:text/html,<script>)` must NOT leak into
    // scan results even if a stylesheet wanted it to.
    const div = document.createElement('div');
    div.id = 'target-div';
    document.body.appendChild(div);

    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el: Element, pseudo?: string | null) => {
        if (pseudo === '::before' && (el as HTMLElement).id === 'target-div') {
          return {
            content: 'url("data:text/html;base64,PHNjcmlwdD4=")',
          } as CSSStyleDeclaration;
        }
        return { content: 'none' } as CSSStyleDeclaration;
      }
    );

    const images = new Map();
    await extractCssContentImages(images);
    expect(images.size).toBe(0);
  });
});
