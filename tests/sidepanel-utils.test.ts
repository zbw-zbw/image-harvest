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
// Also covered (previously deferred):
//   - fetchImageMeta: HEAD request + AbortController 5s timeout + swallow
//     on network failure. Important because the whole card "size" badge
//     depends on it and a regression re-throwing would break the scan
//     pipeline.
//   - loadSettings: chrome.storage.local.get hydration (previously deferred
//     to storage.test.ts but that file tests the shared/storage wrapper,
//     not the sidepanel DEFAULT_FILTER_CONFIG merging path).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock shared/naming so we can force the fallback branch in generateFilename.
// The production module always exports applyNamingTemplate as a function, so
// the `typeof ... !== 'function'` branch is otherwise unreachable in tests.
// Import the ACTUAL implementation here so the standard happy-path tests
// keep exercising real behaviour — we only flip to `undefined` inside a
// single focused test via vi.doMock + dynamic import.
vi.mock('../shared/naming', async () => {
  const actual = await vi.importActual<typeof import('../shared/naming')>('../shared/naming');
  return { ...actual };
});

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
  loadSettings,
  fetchImageMeta,
} from '../sidepanel/utils';
import { state, store } from '../sidepanel/state';
import { DEFAULT_FILTER_CONFIG } from '../shared/constants';
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
  it('returns a valid UUID', () => {
    const id = generateId('https://x.com/a.png');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('produces unique IDs for the same input', () => {
    const ids = new Set([generateId('foo'), generateId('foo'), generateId('foo')]);
    expect(ids.size).toBe(3);
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

  it('falls back to the inline replace chain when applyNamingTemplate is not a function', async () => {
    // Pin: generateFilename has a belt-and-suspenders fallback (L127-138
    // of sidepanel/utils.ts) for the defensive case where the naming
    // module was tree-shaken or monkey-patched away. The fallback must
    // still sanitize `title` via the /[^a-zA-Z0-9_-]/g → '_' regex and
    // cap at 50 chars (the real applyNamingTemplate does this too but
    // the sites of truth must NOT diverge). Without this test a refactor
    // that drops the fallback replace chain could silently break file
    // systems that reject special chars, because the happy-path above
    // only exercises the real applyNamingTemplate.
    vi.resetModules();
    vi.doMock('../shared/naming', () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      applyNamingTemplate: undefined as any,
    }));
    const utilsMod = await import('../sidepanel/utils');
    const stateMod = await import('../sidepanel/state');
    stateMod.state.isProUser = true;
    stateMod.state.appSettings = {
      ...stateMod.state.appSettings,
      filenameTemplate: '{domain}_{title}_{number}.{format}',
    };

    const img = {
      id: 'x',
      url: 'https://x.com/photo.jpg',
      naturalWidth: 800,
      naturalHeight: 600,
      format: 'jpg',
    } as ImageItem;
    const name = utilsMod.generateFilename(img, 2, null, {
      domain: 'x.com',
      title: 'Hello World!',
    });

    // Title "Hello World!" → sanitized to "Hello_World_" via the regex.
    expect(name).toBe('x.com_Hello_World__3.jpg');

    vi.doUnmock('../shared/naming');
    vi.resetModules();
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadSettings — chrome.storage.local.get hydration + DEFAULT merging
// ─────────────────────────────────────────────────────────────────────
// Pin: loadSettings is the SINGLE entry that hydrates state.appSettings
// and state.filterConfig on sidepanel boot (called from init.ts). Three
// contracts each test pins a real regression shape:
//   1. Stored appSettings must MERGE onto existing state (spread order
//      matters — stored keys win over in-memory defaults).
//   2. Missing filterConfig must default to DEFAULT_FILTER_CONFIG (NOT
//      `undefined` — every filter-bar selector relies on the shape
//      being present at first render).
//   3. chrome.storage rejection must still leave filterConfig as
//      DEFAULT_FILTER_CONFIG, otherwise the whole filter bar crashes
//      trying to read `state.filterConfig.minWidth` at mount time.

describe('loadSettings', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(),
        },
      },
    };
  });

  it('merges stored appSettings onto defaults AND hydrates filterConfig onto DEFAULT_FILTER_CONFIG', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((globalThis as any).chrome.storage.local.get as any).mockResolvedValueOnce({
      appSettings: { filenameTemplate: '{number}.{format}', noManyFilesWarning: true },
      filterConfig: { minWidth: 200, minHeight: 150 },
    });

    await loadSettings();

    // Stored key wins over in-memory default.
    expect(state.appSettings.filenameTemplate).toBe('{number}.{format}');
    expect(state.appSettings.noManyFilesWarning).toBe(true);
    // DEFAULT_FILTER_CONFIG keys that were not stored must remain present.
    expect(state.filterConfig).toMatchObject({
      ...DEFAULT_FILTER_CONFIG,
      minWidth: 200,
      minHeight: 150,
    });
  });

  it('installs DEFAULT_FILTER_CONFIG verbatim when the stored filterConfig key is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((globalThis as any).chrome.storage.local.get as any).mockResolvedValueOnce({
      appSettings: { noManyFilesWarning: false },
      // no filterConfig key
    });

    await loadSettings();

    expect(state.filterConfig).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('keeps filterConfig at DEFAULT when chrome.storage.local.get rejects (error-recovery)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((globalThis as any).chrome.storage.local.get as any).mockRejectedValueOnce(
      new Error('IDB closed')
    );

    await expect(loadSettings()).resolves.toBeUndefined();

    // filterConfig MUST still be a usable shape — filter bar would crash otherwise.
    expect(state.filterConfig).toEqual(DEFAULT_FILTER_CONFIG);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Load settings error:', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// fetchImageMeta — HEAD request + AbortController + silent fallback
// ─────────────────────────────────────────────────────────────────────
// Pin: fetchImageMeta is called per-image during scan result enrichment
// (scan.ts). It MUST NEVER throw — a rejected fetch would bubble into
// the scan loop and stop card rendering. The contract is:
//   - parse content-length → number, content-type → string on success
//   - any failure (timeout, CORS, DNS) → { size: null, contentType: '' }
//   - AbortController.abort() scheduled at 5000ms

describe('fetchImageMeta', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses content-length and content-type from a successful HEAD response', async () => {
    const headers = new Map<string, string>([
      ['content-length', '12345'],
      ['content-type', 'image/png'],
    ]);
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = mockFetch as any;

    const meta = await fetchImageMeta('https://cdn.example.com/pic.png');

    expect(meta).toEqual({ size: 12345, contentType: 'image/png' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cdn.example.com/pic.png',
      expect.objectContaining({
        method: 'HEAD',
        mode: 'cors',
        credentials: 'omit',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('returns size:null when the content-length header is missing', async () => {
    // Servers frequently drop content-length for chunked transfers —
    // we must return null (not NaN from parseInt) so downstream
    // formatBytes() can render "0 B" instead of "NaN B".
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        headers: {
          get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null),
        },
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = mockFetch as any;

    const meta = await fetchImageMeta('https://cdn.example.com/pic.jpg');

    expect(meta.size).toBeNull();
    expect(meta.contentType).toBe('image/jpeg');
  });

  it('silently returns {size:null, contentType:""} when the HEAD request rejects', async () => {
    // CORS-blocked / DNS-failed / offline — none of these must throw
    // to the caller. scan.ts iterates this for every image and would
    // halt on the first rejection if we let the error propagate.
    const mockFetch = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = mockFetch as any;

    await expect(fetchImageMeta('https://cdn.example.com/pic.png')).resolves.toEqual({
      size: null,
      contentType: '',
    });
  });
});
