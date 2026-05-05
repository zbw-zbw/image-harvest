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
