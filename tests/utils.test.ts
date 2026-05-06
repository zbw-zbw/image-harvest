// Unit tests for shared/utils
// Covers pure functions only. DOM-dependent helpers (resolveUrl with default
// `window.location.href`) are exercised with explicit `base` arguments.

import { describe, it, expect, vi } from 'vitest';
import {
  generateId,
  resolveUrl,
  getFileFormat,
  getDomain,
  formatBytes,
  formatDimensions,
  isDataUri,
  isImageDataUri,
  getDataUriMimeType,
  getDataUriFormat,
  generateDataUriKey,
  estimateDataUriSize,
  extractBackgroundUrls,
  isGradient,
  getAspectRatio,
  debounce,
  throttle,
  generateFilename,
  EventEmitter,
  isRestrictedUrl,
  deepMerge,
} from '../shared/utils';

describe('generateId', () => {
  it('returns a deterministic-prefix id for the same URL within the same ms', () => {
    const id1 = generateId('https://example.com/a.png');
    const id2 = generateId('https://example.com/a.png');
    // hash portion equal; timestamp suffix may differ — assert prefix length
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(2);
    // hash prefix (everything except the trailing date.toString(36)) is stable
    const hashPrefix = (s: string): string => s.slice(0, s.length - Date.now().toString(36).length);
    expect(hashPrefix(id1)).toBe(hashPrefix(id2));
  });

  it('produces different ids for different URLs', () => {
    expect(generateId('a').slice(0, 4)).not.toBe(generateId('b').slice(0, 4));
  });
});

describe('resolveUrl', () => {
  it('resolves a relative path against the given base', () => {
    expect(resolveUrl('/foo.png', 'https://example.com/page')).toBe('https://example.com/foo.png');
  });

  it('returns the absolute URL untouched', () => {
    expect(resolveUrl('https://x.com/y.png', 'https://example.com')).toBe('https://x.com/y.png');
  });

  it('returns the original input on parse failure', () => {
    expect(resolveUrl('not a url', '')).toBe('not a url');
  });
});

describe('getFileFormat', () => {
  it('extracts extension from a normal URL', () => {
    expect(getFileFormat('https://example.com/a.png')).toBe('png');
    expect(getFileFormat('https://example.com/a.JPEG')).toBe('jpg');
    expect(getFileFormat('https://example.com/path/to/img.webp')).toBe('webp');
  });

  it('handles URLs with query strings and hashes', () => {
    expect(getFileFormat('https://example.com/img.png?v=1')).toBe('png');
    expect(getFileFormat('https://example.com/img.gif#frag')).toBe('gif');
  });

  it('prefers content-type over URL extension', () => {
    expect(getFileFormat('https://example.com/photo.bin', 'image/webp')).toBe('webp');
  });

  it('returns "unknown" for non-image-looking URLs without content-type', () => {
    expect(getFileFormat('https://example.com/page')).toBe('unknown');
  });

  it('extracts format from data URIs', () => {
    expect(getFileFormat('data:image/png;base64,abc')).toBe('png');
    expect(getFileFormat('data:image/svg+xml;utf8,<svg/>')).toBe('svg');
  });

  // ── MIME map coverage: heic / heif / apng ──
  // Pin: the uncommon content-type branches (shared/utils L103-105).
  // heic/heif are Apple's modern photo format — any regression that drops
  // them would silently mis-label every iOS photo as "unknown" and break
  // the filename template engine's {format} placeholder downstream.
  it('maps image/heic content-type to "heic"', () => {
    expect(getFileFormat('https://example.com/photo.bin', 'image/heic')).toBe('heic');
  });

  it('maps image/heif content-type to "heic" (HEIF shares the heic extension)', () => {
    // Pin: heif → 'heic' aliasing. The file extension is .heic even for
    // HEIF-encoded files per Apple's convention; collapsing both to 'heic'
    // keeps the downstream filename pipeline simple.
    expect(getFileFormat('https://example.com/photo.bin', 'image/heif')).toBe('heic');
  });

  it('maps image/apng content-type to "png" (APNG shares the png extension)', () => {
    // Pin: apng → 'png' aliasing — animated PNGs use the .png extension.
    // Without this the filename pipeline would emit a nonexistent .apng
    // file extension that most viewers don't register.
    expect(getFileFormat('https://example.com/anim.bin', 'image/apng')).toBe('png');
  });

  // ── MIME map fall-through (shared/utils L92) ──
  // Every existing content-type test hits the map and early-returns,
  // so the "map exhausted, no match" exit path (for-loop normal exit +
  // fall-through to URL-pattern extraction) was never covered.
  it('unknown content-type → falls through MIME map to URL-extension extraction', () => {
    // Pin: an unrecognized content-type (e.g. generic octet-stream) must
    // NOT cause a crash or a wrong mapping — the code should fall through
    // to the URL extension heuristic. If a refactor breaks the for-loop
    // exit (e.g. by moving `return 'unknown'` inside the if-contentType
    // block), this case would flip from 'png' → 'unknown'.
    expect(getFileFormat('https://example.com/photo.png', 'application/octet-stream')).toBe('png');
  });

  // ── URL parse failure catch-branch (shared/utils L103-105) ──
  // A bare relative path (no scheme) makes `new URL(url)` throw. The
  // catch branch then falls back to a loose regex match on the raw string.
  it('invalid URL with extension → catch branch returns the extension via loose regex', () => {
    // Pin: `foo/bar.png` is not a valid absolute URL (new URL() throws).
    // The catch block's fallback regex still extracts `.png`. Without
    // this branch, any content-script callsite that receives a
    // relative-path `src` (common on legacy sites) would silently get
    // back "unknown" and downstream filtering by format would drop it.
    expect(getFileFormat('foo/bar.png')).toBe('png');
  });

  it('invalid URL WITHOUT any extension → catch branch yields "unknown"', () => {
    // Pin the negative half of the same catch: if neither the URL parser
    // nor the loose regex finds an extension, the function must still
    // return 'unknown' rather than crashing or returning undefined.
    expect(getFileFormat('not-a-url-at-all')).toBe('unknown');
  });
});

describe('getDomain', () => {
  it('returns hostname for valid URLs', () => {
    expect(getDomain('https://www.example.com/path')).toBe('www.example.com');
  });

  it('returns empty string for invalid URLs', () => {
    expect(getDomain('not a url')).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats 0 specially', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('uses appropriate unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024 * 5)).toBe('5 MB');
  });

  it('respects decimals parameter', () => {
    expect(formatBytes(1536, 2)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatDimensions', () => {
  it('joins dimensions with × character', () => {
    expect(formatDimensions(800, 600)).toBe('800×600');
  });
});

describe('data URI helpers', () => {
  it('isDataUri identifies data URIs', () => {
    expect(isDataUri('data:image/png;base64,abc')).toBe(true);
    expect(isDataUri('https://example.com/x.png')).toBe(false);
    expect(isDataUri('')).toBeFalsy();
    expect(isDataUri(null)).toBeFalsy();
  });

  it('isImageDataUri only matches image data URIs', () => {
    expect(isImageDataUri('data:image/png;base64,abc')).toBe(true);
    expect(isImageDataUri('data:text/plain;base64,abc')).toBe(false);
    expect(isImageDataUri('https://example.com/x.png')).toBe(false);
  });

  it('getDataUriMimeType extracts the MIME', () => {
    expect(getDataUriMimeType('data:image/png;base64,abc')).toBe('image/png');
    expect(getDataUriMimeType('data:image/svg+xml,<svg/>')).toBe('image/svg+xml');
    expect(getDataUriMimeType('not-a-data-uri')).toBe('');
  });

  it('getDataUriFormat maps known MIME types', () => {
    expect(getDataUriFormat('data:image/jpeg;base64,abc')).toBe('jpg');
    expect(getDataUriFormat('data:image/svg+xml,<svg/>')).toBe('svg');
    expect(getDataUriFormat('data:image/heif;base64,abc')).toBe('heic');
    expect(getDataUriFormat('data:image/unknown;base64,abc')).toBe('unknown');
  });

  it('generateDataUriKey returns stable key for the same input', () => {
    const u = 'data:image/png;base64,' + 'A'.repeat(500);
    expect(generateDataUriKey(u)).toBe(generateDataUriKey(u));
  });

  it('estimateDataUriSize handles base64 and raw payloads', () => {
    expect(estimateDataUriSize('data:image/png;base64,QUJDRA==')).toBe(4);
    expect(estimateDataUriSize('data:text/plain,hello')).toBe(5);
    expect(estimateDataUriSize('data:image/png;base64')).toBe(0);
  });
});

describe('extractBackgroundUrls', () => {
  it('extracts a single url()', () => {
    expect(extractBackgroundUrls('url("https://x.com/a.png")')).toEqual(['https://x.com/a.png']);
  });

  it('extracts multiple urls()', () => {
    expect(extractBackgroundUrls("url('a.png'), url(b.jpg)")).toEqual(['a.png', 'b.jpg']);
  });

  it('handles "none" and empty input', () => {
    expect(extractBackgroundUrls('none')).toEqual([]);
    expect(extractBackgroundUrls('')).toEqual([]);
    expect(extractBackgroundUrls(null)).toEqual([]);
  });
});

describe('isGradient', () => {
  it('detects all gradient types', () => {
    expect(isGradient('linear-gradient(red, blue)')).toBe(true);
    expect(isGradient('radial-gradient(circle, red, blue)')).toBe(true);
    expect(isGradient('conic-gradient(red, blue)')).toBe(true);
    expect(isGradient('https://example.com/x.png')).toBe(false);
  });
});

describe('getAspectRatio', () => {
  it('classifies square / landscape / portrait / panorama', () => {
    expect(getAspectRatio(100, 100)).toBe('square');
    expect(getAspectRatio(200, 100)).toBe('landscape');
    expect(getAspectRatio(100, 200)).toBe('portrait');
    expect(getAspectRatio(1000, 100)).toBe('panorama');
  });

  // ── Threshold pinning (shared/utils L216-217) ──
  // The 0.4 / 0.9 / 1.1 / 2.5 breakpoints are a product decision — any
  // refactor that nudges them would quietly re-bucket every filtered
  // image. Pin exact boundary behavior so regressions surface immediately.
  it('portrait upper-bound: ratio=0.899 is "portrait", ratio=0.9 is "square"', () => {
    // Pin the 0.9 strict-less-than / inclusive-greater-than boundary.
    expect(getAspectRatio(899, 1000)).toBe('portrait');
    expect(getAspectRatio(900, 1000)).toBe('square');
  });

  it('portrait lower-bound: ratio=0.4 is "portrait", ratio=0.399 is null', () => {
    // Pin: ratio < 0.4 falls through all branches and returns null
    // (very-tall-skinny sliver images aren't a meaningful aspect bucket).
    expect(getAspectRatio(400, 1000)).toBe('portrait');
    expect(getAspectRatio(399, 1000)).toBeNull();
  });

  it('panorama lower-bound: ratio=2.5 is "landscape", ratio=2.501 is "panorama"', () => {
    // Pin: ratio > 2.5 (strict), ratio <= 2.5 stays "landscape". A
    // regression flipping to >= 2.5 would silently re-label every
    // 2.5:1 cinematic crop as "panorama".
    expect(getAspectRatio(2500, 1000)).toBe('landscape');
    expect(getAspectRatio(2501, 1000)).toBe('panorama');
  });

  it('returns null for invalid dimensions', () => {
    expect(getAspectRatio(0, 100)).toBeNull();
    expect(getAspectRatio(100, 0)).toBeNull();
  });
});

describe('debounce', () => {
  it('only fires after the wait period with no further calls', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('a');
    debounced('b');
    debounced('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
    vi.useRealTimers();
  });
});

describe('throttle', () => {
  it('fires at most once per limit window', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    throttled('b');
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(100);
    throttled('d');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('generateFilename', () => {
  it('uses provided format and 1-based padded index', () => {
    const name = generateFilename('https://x.com/a.png', 0, 'webp');
    expect(name).toMatch(/^image_\d{8}_001\.webp$/);
  });

  it('infers format from URL when not given', () => {
    const name = generateFilename('https://x.com/photo.gif', 4);
    expect(name).toMatch(/^image_\d{8}_005\.gif$/);
  });
});

describe('EventEmitter', () => {
  it('subscribes, emits, and unsubscribes', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    const off = ee.on('hi', fn);
    ee.emit('hi', 1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
    off();
    ee.emit('hi', 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('once fires only once', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.once('x', fn);
    ee.emit('x');
    ee.emit('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isRestrictedUrl', () => {
  it('returns true for chrome:// and similar', () => {
    expect(isRestrictedUrl('chrome://settings')).toBe(true);
    expect(isRestrictedUrl('chrome-extension://abc')).toBe(true);
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('view-source:https://x.com')).toBe(true);
    expect(isRestrictedUrl('data:image/png;base64,abc')).toBe(true);
    expect(isRestrictedUrl('blob:https://x.com/abc')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
  });

  it('returns false for normal http(s) URLs', () => {
    expect(isRestrictedUrl('https://example.com')).toBe(false);
    expect(isRestrictedUrl('http://example.com/page')).toBe(false);
  });

  it('treats falsy values as restricted', () => {
    expect(isRestrictedUrl('')).toBe(true);
    expect(isRestrictedUrl(null)).toBe(true);
    expect(isRestrictedUrl(undefined)).toBe(true);
  });
});

describe('deepMerge', () => {
  it('merges nested objects without mutating the source', () => {
    const a = { x: 1, nested: { p: 1, q: 2 } };
    // Cast away strict structural matching: deepMerge intentionally allows
    // a partial override that introduces new keys (`r`) while replacing
    // existing ones (`q`).
    const b = { y: 2, nested: { q: 99, r: 3 } } as unknown as Partial<typeof a>;
    const result = deepMerge(a, b);
    expect(result).toEqual({ x: 1, y: 2, nested: { p: 1, q: 99, r: 3 } });
    // sources not mutated
    expect(a.nested).toEqual({ p: 1, q: 2 });
  });

  it('replaces arrays rather than merging', () => {
    expect(deepMerge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
  });
});

// ── Gap-fill round (extra coverage for previously-missed branches) ──────────

describe('generateFilename — extension fallback', () => {
  it('falls back to "unknown" extension when neither format nor URL extension is available', () => {
    // shared/utils L250-255: ext = format || getFileFormat(url).
    // getFileFormat returns "unknown" for URLs without an image
    // extension AND no content-type — the resulting filename ends
    // with ".unknown", documenting an edge case downloaders should
    // probably guard against.
    const name = generateFilename('https://x.com/page', 0);
    expect(name).toMatch(/^image_\d{8}_001\.unknown$/);
  });

  it('preserves zero-based index padding for index >= 99', () => {
    expect(generateFilename('https://x.com/a.png', 99, 'png')).toMatch(/_100\.png$/);
    expect(generateFilename('https://x.com/a.png', 998, 'png')).toMatch(/_999\.png$/);
  });

  it('does not zero-pad beyond 3 digits for 4+ digit indices', () => {
    expect(generateFilename('https://x.com/a.png', 9999, 'png')).toMatch(/_10000\.png$/);
  });
});

describe('isImageDataUri — extra MIME variants', () => {
  it('accepts SVG, AVIF, HEIF, BMP, ICO data URIs (all "image/*" prefixed)', () => {
    expect(isImageDataUri('data:image/svg+xml;utf8,<svg/>')).toBe(true);
    expect(isImageDataUri('data:image/avif;base64,abc')).toBe(true);
    expect(isImageDataUri('data:image/heif;base64,abc')).toBe(true);
    expect(isImageDataUri('data:image/bmp;base64,abc')).toBe(true);
    expect(isImageDataUri('data:image/x-icon;base64,abc')).toBe(true);
    expect(isImageDataUri('data:image/vnd.microsoft.icon;base64,abc')).toBe(true);
  });

  it('is case-insensitive on the IMAGE/ prefix (but the data: scheme itself is strict-lowercase)', () => {
    // shared/utils L131: isDataUri uses startsWith('data:') — the
    // `data:` scheme matcher is strict-lowercase. The `image/` part
    // however goes through a /^data:image\//i regex, so the MIME
    // half is genuinely case-insensitive.
    expect(isImageDataUri('data:IMAGE/PNG;base64,abc')).toBe(true);
    expect(isImageDataUri('data:Image/Png;base64,abc')).toBe(true);
    // Capitalized scheme is rejected — pin the contract so a future
    // refactor that makes the scheme matcher loose surfaces here.
    expect(isImageDataUri('Data:image/png;base64,abc')).toBe(false);
  });

  it('rejects non-image data URIs with similar prefixes', () => {
    expect(isImageDataUri('data:text/html,<img/>')).toBe(false);
    expect(isImageDataUri('data:application/octet-stream;base64,abc')).toBe(false);
    // No "image/" prefix even though the URL contains "image"
    expect(isImageDataUri('data:text/plain,image/png')).toBe(false);
  });
});

describe('getDataUriFormat — extra MIME variants', () => {
  it('maps SVG, AVIF, BMP, ICO, TIFF correctly', () => {
    expect(getDataUriFormat('data:image/svg+xml;utf8,<svg/>')).toBe('svg');
    expect(getDataUriFormat('data:image/bmp;base64,abc')).toBe('bmp');
    expect(getDataUriFormat('data:image/avif;base64,abc')).toBe('avif');
    expect(getDataUriFormat('data:image/tiff;base64,abc')).toBe('tiff');
    expect(getDataUriFormat('data:image/x-icon;base64,abc')).toBe('ico');
    expect(getDataUriFormat('data:image/vnd.microsoft.icon;base64,abc')).toBe('ico');
  });

  it('treats apng as png (animated PNG shares the decoder)', () => {
    expect(getDataUriFormat('data:image/apng;base64,abc')).toBe('png');
  });
});

describe('extractBackgroundUrls — quote and whitespace variants', () => {
  it('handles double-quoted, single-quoted, and unquoted url() forms in one value', () => {
    // shared/utils L188-200: regex /url\(['"]?([^'")]+)['"]?\)/g.
    const css = 'url("a.png"), url(\'b.jpg\'), url(c.gif)';
    expect(extractBackgroundUrls(css)).toEqual(['a.png', 'b.jpg', 'c.gif']);
  });

  it('extracts http(s) urls with query strings + fragments untouched', () => {
    const css = "url('https://cdn.example.com/x.png?v=1#frag')";
    expect(extractBackgroundUrls(css)).toEqual(['https://cdn.example.com/x.png?v=1#frag']);
  });

  it('strips data: URIs out of url() containers same as any other URL', () => {
    const css = 'url(data:image/png;base64,iVBORw0)';
    expect(extractBackgroundUrls(css)).toEqual(['data:image/png;base64,iVBORw0']);
  });

  it('returns an empty array for the literal string "none" (CSS keyword)', () => {
    expect(extractBackgroundUrls('none')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input (still falsy-after-trim is not a guard, just no matches)', () => {
    // shared/utils L189: only !cssValue || cssValue === 'none' bail
    // out — pure whitespace would fall through to the regex and just
    // return [] because there's no url() to match.
    expect(extractBackgroundUrls('   ')).toEqual([]);
  });

  it('coexists with linear-gradient — extracts only the url() portion', () => {
    const css = 'linear-gradient(red, blue), url("hero.png")';
    expect(extractBackgroundUrls(css)).toEqual(['hero.png']);
  });
});
