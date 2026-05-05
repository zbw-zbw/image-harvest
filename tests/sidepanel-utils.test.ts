// Unit tests for the pure-function helpers in sidepanel/utils.ts.
//
// What this file pins:
//   - formatBytes / getAspectRatioCategory / getSizeCategory thresholds
//   - truncateUrl preserves hostname when possible
//   - generateId / getFilenameFromUrl / getExtFromUrl edge cases
//   - debounce / throttle timer semantics (vi.useFakeTimers)
//   - generateFilename: free-tier forced template vs pro-tier custom template,
//     plus the variable-substitution contract that downstream filename
//     sanitization relies on.
//
// What this file deliberately skips:
//   - fetchImageMeta (HEAD request — exercise via e2e network mock)
//   - loadSettings (chrome.storage — already covered by storage.test.ts)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  getAspectRatioCategory,
  getSizeCategory,
  truncateUrl,
  generateId,
  generateFilename,
  getFilenameFromUrl,
  getExtFromUrl,
  debounce,
  throttle,
} from '../sidepanel/utils';
import { state, store } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  store.reset();
  vi.useRealTimers();
});

describe('formatBytes', () => {
  it('returns "0 B" for null / undefined / 0', () => {
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats with one decimal across B / KB / MB / GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });
});

describe('getAspectRatioCategory', () => {
  it('returns null for missing dimensions', () => {
    expect(getAspectRatioCategory(0, 100)).toBeNull();
    expect(getAspectRatioCategory(100, 0)).toBeNull();
  });

  it('classifies square / landscape / portrait / panorama by ratio bands', () => {
    // square: 0.9 ≤ r ≤ 1.1
    expect(getAspectRatioCategory(100, 100)).toBe('square');
    expect(getAspectRatioCategory(105, 100)).toBe('square');
    // landscape: 1.1 < r ≤ 2.5
    expect(getAspectRatioCategory(200, 100)).toBe('landscape');
    expect(getAspectRatioCategory(250, 100)).toBe('landscape');
    // portrait: 0.4 ≤ r < 0.9
    expect(getAspectRatioCategory(50, 100)).toBe('portrait');
    expect(getAspectRatioCategory(80, 100)).toBe('portrait');
    // panorama: r > 2.5
    expect(getAspectRatioCategory(300, 100)).toBe('panorama');
  });

  it('returns null for ratios outside every band (extreme portrait < 0.4)', () => {
    expect(getAspectRatioCategory(30, 100)).toBeNull();
  });
});

describe('getSizeCategory', () => {
  it('returns "Unknown" for missing dimensions', () => {
    expect(getSizeCategory(undefined, 100)).toBe('Unknown');
    expect(getSizeCategory(100, undefined)).toBe('Unknown');
    expect(getSizeCategory(0, 0)).toBe('Unknown');
  });

  it('uses max(w, h) to bucket into the four size bands', () => {
    expect(getSizeCategory(50, 80)).toBe('Small (< 100px)');
    expect(getSizeCategory(99, 50)).toBe('Small (< 100px)');
    expect(getSizeCategory(100, 50)).toBe('Medium (100-500px)');
    expect(getSizeCategory(499, 200)).toBe('Medium (100-500px)');
    expect(getSizeCategory(500, 100)).toBe('Large (500-1000px)');
    expect(getSizeCategory(999, 999)).toBe('Large (500-1000px)');
    expect(getSizeCategory(1000, 100)).toBe('XL (> 1000px)');
    expect(getSizeCategory(50, 1500)).toBe('XL (> 1000px)');
  });
});

describe('truncateUrl', () => {
  it('returns "" for empty input', () => {
    expect(truncateUrl('', 50)).toBe('');
  });

  it('returns the URL unchanged when shorter than the limit', () => {
    expect(truncateUrl('https://x.com/a', 50)).toBe('https://x.com/a');
  });

  it('keeps the hostname intact when truncating a long path', () => {
    const url = 'https://example.com/very/long/path/to/an/image.png';
    const out = truncateUrl(url, 30);
    // Hostname must survive — users rely on it to recognize sources.
    expect(out.startsWith('example.com')).toBe(true);
    expect(out.endsWith('...')).toBe(true);
  });

  it('falls back to a raw substring when the URL is unparseable', () => {
    const garbage = 'not a real url with lots of text and stuff';
    expect(truncateUrl(garbage, 10)).toBe('not a real...');
  });
});

describe('generateId', () => {
  it('returns an id with the "img_" prefix and two base36 segments', () => {
    const id = generateId('https://x.com/a.png');
    expect(id).toMatch(/^img_[a-z0-9]+_[a-z0-9]+$/);
  });

  it('produces a stable hash component for the same input within a single tick', () => {
    // Hash component is deterministic; only the timestamp segment varies.
    const ids = [generateId('foo'), generateId('foo')];
    const hashes = ids.map((id) => id.split('_')[1]);
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe('getFilenameFromUrl', () => {
  it('strips the extension and sanitizes URL-decoded special characters', () => {
    // Note: new URL().pathname percent-encodes spaces to %20, so the
    // sanitizer (/[^a-zA-Z0-9_-]/g → '_') turns 'My Photo!' into
    // 'My_20Photo_' rather than 'My_Photo_'. Pin this real behaviour
    // so a future refactor that decodes the pathname doesn't silently
    // change downstream filenames.
    expect(getFilenameFromUrl('https://x.com/path/My Photo!.jpg')).toBe('My_20Photo_');
  });

  it('keeps already-clean filenames as-is (extension stripped)', () => {
    expect(getFilenameFromUrl('https://x.com/path/photo.jpg')).toBe('photo');
    expect(getFilenameFromUrl('https://x.com/dir/sub/my-pic_v2.png')).toBe('my-pic_v2');
  });

  it('returns "image" for unparseable URLs', () => {
    expect(getFilenameFromUrl('not a url')).toBe('image');
  });

  it('returns "image" when the path ends with a slash (no real filename)', () => {
    expect(getFilenameFromUrl('https://x.com/dir/')).toBe('image');
  });

  it('caps the result at 50 characters', () => {
    const long = 'https://x.com/' + 'a'.repeat(200) + '.png';
    expect(getFilenameFromUrl(long).length).toBeLessThanOrEqual(50);
  });
});

describe('getExtFromUrl', () => {
  it('returns the lowercased extension for normal URLs', () => {
    expect(getExtFromUrl('https://x.com/a.PNG')).toBe('png');
    expect(getExtFromUrl('https://x.com/photo.jpeg')).toBe('jpeg');
  });

  it('returns null for URLs with no extension or unparseable input', () => {
    expect(getExtFromUrl('https://x.com/a')).toBeNull();
    expect(getExtFromUrl('not a url')).toBeNull();
  });
});

describe('debounce', () => {
  it('only fires the trailing call after `wait` ms of silence', () => {
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
  });
});

describe('throttle', () => {
  it('fires immediately the first time, then schedules a trailing call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    expect(fn).toHaveBeenCalledWith('a');
    throttled('b');
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    // Trailing call carries the LATEST args ('c'), not the second ('b').
    expect(fn).toHaveBeenLastCalledWith('c');
  });
});

describe('generateFilename', () => {
  function makeImg(overrides: Partial<ImageItem> = {}): ImageItem {
    return {
      id: 'x',
      url: 'https://x.com/photo.jpg',
      naturalWidth: 800,
      naturalHeight: 600,
      format: 'jpg',
      ...overrides,
    } as ImageItem;
  }

  it('forces the default template for free-tier users (ignores custom template)', () => {
    state.isProUser = false;
    state.appSettings = {
      ...state.appSettings,
      filenameTemplate: '{domain}_{title}_{number}.{format}',
    };

    const name = generateFilename(makeImg(), 0, null, {
      domain: 'x.com',
      title: 'A Page',
    });

    // Free tier MUST use the default 'img_{index}_{original}.{format}',
    // so the {domain}/{title} from the custom template should NOT appear.
    expect(name).toMatch(/^img_001_photo\.jpg$/);
  });

  it('honors the custom template for pro users', () => {
    state.isProUser = true;
    state.appSettings = {
      ...state.appSettings,
      filenameTemplate: '{domain}_{number}_{width}x{height}.{format}',
    };

    const name = generateFilename(makeImg(), 4, null, {
      domain: 'x.com',
      title: 'ignored',
    });

    expect(name).toBe('x.com_5_800x600.jpg');
  });

  it('prefers the explicit `format` arg over the image format', () => {
    state.isProUser = true;
    state.appSettings = {
      ...state.appSettings,
      filenameTemplate: '{original}.{format}',
    };
    const name = generateFilename(makeImg({ format: 'jpg' }), 0, 'webp', {
      domain: 'x.com',
      title: 't',
    });
    expect(name).toBe('photo.webp');
  });

  it('falls back to "unknown" / "untitled" when pageInfo is empty', () => {
    state.isProUser = true;
    state.appSettings = {
      ...state.appSettings,
      filenameTemplate: '{domain}_{title}.{format}',
    };
    const name = generateFilename(makeImg(), 0, null, {});
    expect(name).toBe('unknown_untitled.jpg');
  });
});
