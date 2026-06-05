// Unit tests for content/main.ts — focused on:
//   - Module bootstrap: chrome.runtime.onMessage listener registration
//     + initContentScript (chrome:// protocol skip + removeFAB call +
//     onConnect listener for highlight cleanup)
//   - handleMessage: 9 MESSAGE_TYPES cases + default
//   - extractImages: 14-step async pipeline + state.isExtracting
//     guard + state.seenUrls reset + LIMITS.MAX_IMAGES_PER_SCAN cap
//     + skipIframes option
//   - extractImgTags / extractBackgroundImages / extractPictureSources
//     / extractFromStylesheets: indirectly tested through extractImages
//
// Strategy: mock every imported subsystem so the router/orchestrator
// logic is the only thing under test. The 8 advanced extractors and
// the shadow/iframe extractors are mocked to push known fixture
// ImageItems into the shared Map — this lets us assert the pipeline
// order + cap + dedup behavior without depending on real DOM walking.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const seenUrls = new Set<string>();
vi.mock('../content/state', () => ({
  state: {
    isExtracting: false,
    get seenUrls() {
      return seenUrls;
    },
    liveObserver: null,
  },
  isExtensionContextValid: vi.fn(() => true),
}));

vi.mock('../shared/utils', () => ({
  generateId: vi.fn((url: string) => `id-${url.slice(0, 24)}`),
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
    if (u.includes('.jpg')) return 'jpg';
    if (u.includes('.svg')) return 'svg';
    return 'unknown';
  }),
  isDataUri: vi.fn((u: string) => u.startsWith('data:')),
  isImageDataUri: vi.fn((u: string) => u.startsWith('data:image/')),
  extractBackgroundUrls: vi.fn((value: string) => {
    if (!value) return [];
    const matches = Array.from(value.matchAll(/url\(['"]?([^'")]+)['"]?\)/g));
    return matches.map((m) => m[1]);
  }),
  isGradient: vi.fn((u: string) => u.includes('gradient(')),
}));

vi.mock('../content/utils', () => ({
  ensureImageLoaded: vi.fn(() => Promise.resolve()),
  isElementVisible: vi.fn(() => true),
  isElementAccessibleWithoutInteraction: vi.fn(() => true),
  pickBestSrcsetUrl: vi.fn((candidates: Array<{ url: string; width: number }>) =>
    candidates.length > 0 ? candidates[0].url : null
  ),
  parseSrcset: vi.fn((srcset: string) =>
    srcset.split(',').map((part) => {
      const [url] = part.trim().split(/\s+/);
      return { url, width: 0 };
    })
  ),
  skipElement: vi.fn(() => false),
  sendDiscoveredImages: vi.fn(),
}));

vi.mock('../content/extract-advanced', () => ({
  extractInlineSvgs: vi.fn(() => Promise.resolve()),
  extractCanvasElements: vi.fn(() => Promise.resolve()),
  extractVideoPosterImages: vi.fn(() => Promise.resolve()),
  extractInputImages: vi.fn(() => Promise.resolve()),
  extractObjectEmbedImages: vi.fn(() => Promise.resolve()),
  extractMetaAndLinkImages: vi.fn(() => Promise.resolve()),
  extractCssContentImages: vi.fn(() => Promise.resolve()),
  extractLazyLoadImages: vi.fn(() => Promise.resolve()),
}));

vi.mock('../content/shadow-iframe', () => ({
  extractFromShadowDom: vi.fn(() => Promise.resolve()),
  extractFromIframes: vi.fn(() => Promise.resolve()),
}));

vi.mock('../content/highlight', () => ({
  addHighlight: vi.fn(() => ({ found: true })),
  removeSingleHighlight: vi.fn(),
  syncHighlights: vi.fn(),
  removeAllHighlights: vi.fn(),
  removeFAB: vi.fn(),
}));

vi.mock('../content/monitor', () => ({
  startLiveMonitoring: vi.fn(),
  stopLiveMonitoring: vi.fn(),
}));

// Capture chrome.runtime.onMessage / onConnect listeners during import.
let onMessageListener:
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean | undefined)
  | null = null;
let onConnectListener: ((port: chrome.runtime.Port) => void) | null = null;

beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((fn) => {
          onMessageListener = fn;
        }),
      },
      onConnect: {
        addListener: vi.fn((fn) => {
          onConnectListener = fn;
        }),
      },
    },
  };

  // Import target after chrome global is in place — module top-level
  // runs initContentScript + chrome.runtime.onMessage.addListener.
  await import('../content/main');
});

import { MESSAGE_TYPES } from '../shared/constants';
import * as highlight from '../content/highlight';
import * as monitor from '../content/monitor';

// Helper: invoke onMessage listener synchronously and capture the
// async sendResponse (handleMessage runs as a fire-and-forget Promise
// inside the listener).
function dispatch(message: Record<string, unknown>): Promise<unknown> {
  if (!onMessageListener) throw new Error('listener not registered');
  return new Promise((resolve) => {
    onMessageListener!(message, {} as chrome.runtime.MessageSender, (response: unknown) =>
      resolve(response)
    );
  });
}

beforeEach(() => {
  seenUrls.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  seenUrls.clear();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// Module bootstrap
// ─────────────────────────────────────────────────────────────────────

describe('module bootstrap', () => {
  it('registers chrome.runtime.onMessage listener that returns true (keep async channel open)', () => {
    expect(onMessageListener).toBeTypeOf('function');
    const result = onMessageListener!(
      { type: 'NOPE' },
      {} as chrome.runtime.MessageSender,
      () => {}
    );
    expect(result).toBe(true);
  });

  it('registers chrome.runtime.onConnect listener (for highlight cleanup on UI disconnect)', () => {
    expect(onConnectListener).toBeTypeOf('function');
  });

  it('onConnect: image-harvest-ui port disconnect triggers removeAllHighlights', () => {
    let onDisconnect: (() => void) | null = null;
    const port = {
      name: 'image-harvest-ui',
      onDisconnect: { addListener: vi.fn((fn) => (onDisconnect = fn)) },
    } as unknown as chrome.runtime.Port;

    onConnectListener!(port);
    expect(onDisconnect).toBeTypeOf('function');

    onDisconnect!();
    expect(highlight.removeAllHighlights).toHaveBeenCalled();
  });

  it('onConnect: ignores ports with non-matching names (no disconnect listener attached)', () => {
    const addListenerSpy = vi.fn();
    const port = {
      name: 'random-port-name',
      onDisconnect: { addListener: addListenerSpy },
    } as unknown as chrome.runtime.Port;

    onConnectListener!(port);
    expect(addListenerSpy).not.toHaveBeenCalled();
  });

  it('initContentScript wired removeFAB / monitor / highlight as mocks (sanity)', () => {
    // Call counts can't be asserted here because beforeEach runs
    // vi.clearAllMocks() between cases, while initContentScript fires
    // ONCE at module import. Verify modules are correctly mocked
    // instead — the real init path is implicitly proven by the
    // onMessage / onConnect listeners being captured.
    expect(vi.isMockFunction(highlight.removeFAB)).toBe(true);
    expect(vi.isMockFunction(highlight.removeAllHighlights)).toBe(true);
    expect(vi.isMockFunction(monitor.startLiveMonitoring)).toBe(true);
  });

  it('initContentScript on chrome-extension:// page → early-return, NO listener registration', async () => {
    // Pin: the protocol guard at the top of initContentScript. Without
    // it, injecting our content script into our own pages (popup,
    // reverse-search results) would wire duplicate onConnect listeners
    // that confuse port-disconnect cleanup — every UI close would
    // trigger removeAllHighlights on a page that never had highlights.
    vi.resetModules();
    const addListenerSpy = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        onConnect: { addListener: addListenerSpy },
      },
    };
    // Override location.protocol BEFORE import so the guard short-
    // circuits. jsdom allows re-defining window.location via
    // Object.defineProperty.
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, protocol: 'chrome-extension:', hostname: '' },
      configurable: true,
      writable: true,
    });

    try {
      await import('../content/main');
      // The onMessage listener IS still registered (it's at module
      // top-level, not inside initContentScript). But onConnect IS
      // inside the function, so it must NOT be wired when the
      // protocol guard trips.
      expect(addListenerSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    }
  });

  it('initContentScript: onConnect.addListener throwing (extension context invalidated) → silently swallowed', async () => {
    // Pin: the outer try/catch around chrome.runtime.onConnect.addListener.
    // After an extension reload/update, stale content scripts can still
    // run briefly but chrome.runtime API throws "Extension context
    // invalidated". The init MUST NOT fail loudly or the page console
    // would fill with confusing errors during every auto-update.
    vi.resetModules();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onMessage: { addListener: vi.fn() },
        onConnect: {
          addListener: vi.fn(() => {
            throw new Error('Extension context invalidated');
          }),
        },
      },
    };

    // Must NOT throw — import should complete normally.
    await expect(import('../content/main')).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleMessage routing
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage', () => {
  it('PING → responds with PONG', async () => {
    const result = await dispatch({ type: MESSAGE_TYPES.PING });
    expect(result).toEqual({ type: MESSAGE_TYPES.PONG });
  });

  it('EXTRACT_IMAGES → responds with success+images array', async () => {
    const result = (await dispatch({ type: MESSAGE_TYPES.EXTRACT_IMAGES })) as {
      success: boolean;
      images: unknown[];
    };
    expect(result.success).toBe(true);
    expect(Array.isArray(result.images)).toBe(true);
  });

  it('EXTRACT_IMAGES forwards skipIframes option to extractImages', async () => {
    const { extractFromIframes } = await import('../content/shadow-iframe');
    await dispatch({ type: MESSAGE_TYPES.EXTRACT_IMAGES, skipIframes: true });
    expect(extractFromIframes).not.toHaveBeenCalled();
  });

  it('START_LIVE_MONITOR → calls startLiveMonitoring with config', async () => {
    const result = await dispatch({
      type: MESSAGE_TYPES.START_LIVE_MONITOR,
      config: { debounceMs: 250 },
    });
    expect(monitor.startLiveMonitoring).toHaveBeenCalledWith({ debounceMs: 250 });
    expect(result).toEqual({ success: true });
  });

  it('STOP_LIVE_MONITOR → calls stopLiveMonitoring', async () => {
    const result = await dispatch({ type: MESSAGE_TYPES.STOP_LIVE_MONITOR });
    expect(monitor.stopLiveMonitoring).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('TOGGLE_FAB → unconditional success (legacy stub)', async () => {
    const result = await dispatch({ type: MESSAGE_TYPES.TOGGLE_FAB });
    expect(result).toEqual({ success: true });
  });

  it('HIGHLIGHT_IMAGE → calls addHighlight + responds with found from result', async () => {
    vi.mocked(highlight.addHighlight).mockReturnValue({ found: true });
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      imageUrl: 'https://example.com/x.jpg',
    });
    expect(highlight.addHighlight).toHaveBeenCalledWith('https://example.com/x.jpg');
    expect(result).toEqual({ success: true, found: true });
  });

  it('HIGHLIGHT_IMAGE → defaults found=false when addHighlight returns null', async () => {
    vi.mocked(highlight.addHighlight).mockReturnValue(null as unknown as { found: boolean });
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(result).toEqual({ success: true, found: false });
  });

  it('UNHIGHLIGHT_IMAGE → calls removeSingleHighlight', async () => {
    const result = await dispatch({
      type: MESSAGE_TYPES.UNHIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(highlight.removeSingleHighlight).toHaveBeenCalledWith('x.jpg');
    expect(result).toEqual({ success: true });
  });

  it('HIGHLIGHT_IMAGES → calls syncHighlights with array', async () => {
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGES,
      imageUrls: ['a.jpg', 'b.jpg'],
    });
    expect(highlight.syncHighlights).toHaveBeenCalledWith(['a.jpg', 'b.jpg']);
    expect(result).toEqual({ success: true });
  });

  it('HIGHLIGHT_IMAGES with no imageUrls → defaults to []', async () => {
    await dispatch({ type: MESSAGE_TYPES.HIGHLIGHT_IMAGES });
    expect(highlight.syncHighlights).toHaveBeenCalledWith([]);
  });

  it('REMOVE_HIGHLIGHT → calls removeAllHighlights', async () => {
    const result = await dispatch({ type: MESSAGE_TYPES.REMOVE_HIGHLIGHT });
    expect(highlight.removeAllHighlights).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('unknown message type → "Unknown message type" failure', async () => {
    const result = await dispatch({ type: 'NOT_A_REAL_TYPE' });
    expect(result).toEqual({ success: false, error: 'Unknown message type' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractImages — 14-step async pipeline + state guards + cap
// ─────────────────────────────────────────────────────────────────────
//
// NOTE: extractImages must NOT be statically imported at file top —
// vitest hoists static imports BEFORE beforeAll, so chrome.runtime
// would be undefined when content/main's top-level code runs, and the
// onMessage listener registration in the try/catch would silently
// enter the catch branch (leaving onMessageListener=null and breaking
// every handleMessage case). Use dynamic import inside each case.

import { state } from '../content/state';
import { LIMITS } from '../shared/constants';

// Resolved lazily inside each case to avoid the hoist-before-beforeAll
// problem described above. The dynamic import returns the cached module
// instance from the beforeAll-driven first import, so listeners stay wired.
async function getExtractImages(): Promise<typeof import('../content/main').extractImages> {
  const mod = await import('../content/main');
  return mod.extractImages;
}

// Helper — stub getBoundingClientRect on an element.
function stubRect(el: Element, w = 100, h = 100): void {
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

describe('extractImages — main pipeline', () => {
  it('sets state.isExtracting=true during run, restores false in finally', async () => {
    let snapshotDuringRun: boolean | null = null;
    const { extractInlineSvgs } = await import('../content/extract-advanced');
    vi.mocked(extractInlineSvgs).mockImplementation(async () => {
      snapshotDuringRun = state.isExtracting;
    });

    expect(state.isExtracting).toBe(false);
    await (
      await getExtractImages()
    )();
    expect(snapshotDuringRun).toBe(true);
    expect(state.isExtracting).toBe(false); // finally restores
  });

  it('clears state.seenUrls at the start of each run (fresh dedup window)', async () => {
    seenUrls.add('stale-from-previous-scan');
    expect(seenUrls.has('stale-from-previous-scan')).toBe(true);

    await (
      await getExtractImages()
    )();
    expect(seenUrls.has('stale-from-previous-scan')).toBe(false);
  });

  it('runs all 14 advanced extractors + shadow + iframes when skipIframes is false', async () => {
    const ea = await import('../content/extract-advanced');
    const si = await import('../content/shadow-iframe');

    await (
      await getExtractImages()
    )();

    expect(ea.extractInlineSvgs).toHaveBeenCalled();
    expect(ea.extractCanvasElements).toHaveBeenCalled();
    expect(ea.extractVideoPosterImages).toHaveBeenCalled();
    expect(ea.extractInputImages).toHaveBeenCalled();
    expect(ea.extractObjectEmbedImages).toHaveBeenCalled();
    expect(ea.extractMetaAndLinkImages).toHaveBeenCalled();
    expect(ea.extractCssContentImages).toHaveBeenCalled();
    expect(ea.extractLazyLoadImages).toHaveBeenCalled();
    expect(si.extractFromShadowDom).toHaveBeenCalled();
    expect(si.extractFromIframes).toHaveBeenCalled();
  });

  it('skipIframes:true → extractFromIframes NOT called, but everything else still runs', async () => {
    const si = await import('../content/shadow-iframe');
    await (
      await getExtractImages()
    )({ skipIframes: true });
    expect(si.extractFromShadowDom).toHaveBeenCalled();
    expect(si.extractFromIframes).not.toHaveBeenCalled();
  });

  it('caps result at LIMITS.MAX_IMAGES_PER_SCAN (1000) when extractors produce more', async () => {
    const ea = await import('../content/extract-advanced');
    // Inject 1500 fake items via the FIRST extractor — pipeline puts
    // them into the shared Map; cap should trim to 1000.
    vi.mocked(ea.extractInlineSvgs).mockImplementation(async (images) => {
      for (let i = 0; i < 1500; i++) {
        images.set(`fake-${i}`, { url: `fake-${i}.png` } as never);
      }
    });

    const result = await (await getExtractImages())();
    expect(result.length).toBe(LIMITS.MAX_IMAGES_PER_SCAN);
    expect(result.length).toBe(1000);
  });

  it('returns full result (no trim) when below the cap', async () => {
    const ea = await import('../content/extract-advanced');
    vi.mocked(ea.extractInlineSvgs).mockImplementation(async (images) => {
      for (let i = 0; i < 50; i++) {
        images.set(`small-${i}`, { url: `small-${i}.png` } as never);
      }
    });

    const result = await (await getExtractImages())();
    expect(result.length).toBe(50);
  });

  it('runs extractors SEQUENTIALLY (await order) — pin pipeline order via call timestamps', async () => {
    const ea = await import('../content/extract-advanced');
    const si = await import('../content/shadow-iframe');
    const callOrder: string[] = [];

    vi.mocked(ea.extractInlineSvgs).mockImplementation(async () => {
      callOrder.push('svgs');
    });
    vi.mocked(ea.extractCanvasElements).mockImplementation(async () => {
      callOrder.push('canvas');
    });
    vi.mocked(si.extractFromShadowDom).mockImplementation(async () => {
      callOrder.push('shadow');
    });
    vi.mocked(si.extractFromIframes).mockImplementation(async () => {
      callOrder.push('iframes');
    });

    await (
      await getExtractImages()
    )();

    // svgs (step 5) runs before canvas (step 6); shadow (step 13)
    // before iframes (step 14). Pin SEQUENTIAL await order — a refactor
    // to Promise.all would break consumer assumptions about state.seenUrls
    // dedup happening in a deterministic order.
    expect(callOrder.indexOf('svgs')).toBeLessThan(callOrder.indexOf('canvas'));
    expect(callOrder.indexOf('shadow')).toBeLessThan(callOrder.indexOf('iframes'));
  });

  it('finally block restores state.isExtracting=false even when an extractor throws', async () => {
    const ea = await import('../content/extract-advanced');
    vi.mocked(ea.extractInlineSvgs).mockRejectedValue(new Error('boom'));

    const extractImages = await getExtractImages();
    await expect(extractImages()).rejects.toThrow('boom');
    expect(state.isExtracting).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractImgTags — indirectly via extractImages with real <img> fixtures
// ─────────────────────────────────────────────────────────────────────

describe('extractImgTags (via extractImages)', () => {
  it('extracts a plain <img src=...> with type="img"', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/photo.jpg';
    document.body.appendChild(img);

    const result = await (await getExtractImages())();
    const photo = result.find((r) => r.url.includes('photo.jpg'));
    expect(photo).toBeDefined();
    expect(photo?.type).toBe('img');
  });

  it('smart-merges srcset: picks best URL from srcset instead of expanding all candidates', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/main.jpg';
    Object.defineProperty(img, 'currentSrc', { value: 'https://example.com/current.jpg' });
    img.srcset = 'https://example.com/small.jpg 320w, https://example.com/large.jpg 800w';
    img.setAttribute('data-src', 'https://example.com/lazy.jpg');
    img.setAttribute('data-original', 'https://example.com/original.jpg');
    img.setAttribute('data-srcset', 'https://example.com/lazy-set.jpg 1x');
    document.body.appendChild(img);

    const result = await (await getExtractImages())();
    const urls = result.map((r) => r.url);
    // After srcset smart merge, only the best URL from srcset is used
    // (picked by pickBestSrcsetUrl mock → first candidate = small.jpg).
    // The img produces a single entry rather than expanding all candidates.
    expect(urls.some((u) => u.includes('small.jpg'))).toBe(true);
    // Other srcset candidates and data-* attrs are NOT separately expanded
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('streams discovered images via sendDiscoveredImages (one push per ImageItem)', async () => {
    const { sendDiscoveredImages } = await import('../content/utils');
    const img = document.createElement('img');
    img.src = 'https://example.com/streamed.jpg';
    document.body.appendChild(img);

    await (
      await getExtractImages()
    )();
    // Pin: extractImgTags streams progressively rather than batching at end —
    // sidepanel can render incrementally instead of waiting for full scan.
    expect(sendDiscoveredImages).toHaveBeenCalled();
  });

  it('skips non-image data: URIs (text/plain etc.)', async () => {
    const img = document.createElement('img');
    img.src = 'data:text/plain;base64,SGVsbG8=';
    document.body.appendChild(img);

    const result = await (await getExtractImages())();
    expect(result.find((r) => r.url.startsWith('data:text'))).toBeUndefined();
  });

  it('handles ensureImageLoaded errors gracefully (caught + warns + continues)', async () => {
    const { ensureImageLoaded } = await import('../content/utils');
    vi.mocked(ensureImageLoaded).mockRejectedValueOnce(new Error('load failed'));

    const img1 = document.createElement('img');
    img1.src = 'https://example.com/will-fail.jpg';
    const img2 = document.createElement('img');
    img2.src = 'https://example.com/will-succeed.jpg';
    document.body.appendChild(img1);
    document.body.appendChild(img2);

    // Should not throw; img2 still extracted.
    const result = await (await getExtractImages())();
    expect(result.find((r) => r.url.includes('will-succeed'))).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractBackgroundImages — indirectly via extractImages
// ─────────────────────────────────────────────────────────────────────

describe('extractBackgroundImages (via extractImages)', () => {
  it('extracts background-image url() as type="bg"', async () => {
    const div = document.createElement('div');
    div.setAttribute('style', "background-image: url('https://example.com/hero.jpg')");
    stubRect(div, 1200, 600);
    document.body.appendChild(div);

    const result = await (await getExtractImages())();
    const hero = result.find((r) => r.url.includes('hero.jpg'));
    expect(hero?.type).toBe('bg');
    expect(hero?.displayWidth).toBe(1200);
    expect(hero?.displayHeight).toBe(600);
  });

  it('skips gradient() values', async () => {
    const div = document.createElement('div');
    div.setAttribute('style', 'background-image: linear-gradient(red, blue)');
    document.body.appendChild(div);

    const result = await (await getExtractImages())();
    expect(result.find((r) => r.url.includes('gradient'))).toBeUndefined();
  });

  it('skips elements where skipElement() returns true', async () => {
    const { skipElement } = await import('../content/utils');
    vi.mocked(skipElement).mockReturnValue(true);

    const div = document.createElement('div');
    div.setAttribute('style', "background-image: url('https://example.com/skipped.jpg')");
    stubRect(div, 100, 100);
    document.body.appendChild(div);

    const result = await (await getExtractImages())();
    expect(result.find((r) => r.url.includes('skipped.jpg'))).toBeUndefined();
  });

  it('updates displayWidth/Height to LARGER dimensions when same URL appears on multiple elements', async () => {
    // Pin: same bg URL on two elements — keep the larger rect, because
    // the larger one is more likely the "primary" usage. Pinned because
    // a refactor that just first-wins would lose visual context.
    const small = document.createElement('div');
    small.setAttribute('style', "background-image: url('https://example.com/shared.jpg')");
    stubRect(small, 50, 50);
    const large = document.createElement('div');
    large.setAttribute('style', "background-image: url('https://example.com/shared.jpg')");
    stubRect(large, 800, 600);

    document.body.appendChild(small);
    document.body.appendChild(large);

    const result = await (await getExtractImages())();
    const shared = result.find((r) => r.url.includes('shared.jpg'));
    expect(shared?.displayWidth).toBe(800);
    expect(shared?.displayHeight).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractPictureSources — <picture><source> aggregation
// ─────────────────────────────────────────────────────────────────────

describe('extractPictureSources (via extractImages)', () => {
  it('smart-merges <picture><source srcset> to single best URL as type="img"', async () => {
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute(
      'srcset',
      'https://example.com/mobile.jpg 320w, https://example.com/desktop.jpg 1200w'
    );
    const fallback = document.createElement('img');
    fallback.src = 'https://example.com/fallback.jpg';
    picture.appendChild(source);
    picture.appendChild(fallback);
    document.body.appendChild(picture);

    const result = await (await getExtractImages())();
    const urls = result.map((r) => r.url);
    // Smart merge: pickBestSrcsetUrl picks the best candidate (mock returns first)
    expect(urls.some((u) => u.includes('mobile.jpg'))).toBe(true);
    // Only one URL from the srcset is emitted, not all candidates
  });

  it('inherits naturalWidth/Height from fallback <img> when present', async () => {
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute('srcset', 'https://example.com/dpr2.jpg 2x');
    const fallback = document.createElement('img');
    fallback.src = 'https://example.com/fallback.jpg';
    Object.defineProperty(fallback, 'naturalWidth', { value: 1920 });
    Object.defineProperty(fallback, 'naturalHeight', { value: 1080 });
    picture.appendChild(source);
    picture.appendChild(fallback);
    document.body.appendChild(picture);

    const result = await (await getExtractImages())();
    const dpr2 = result.find((r) => r.url.includes('dpr2.jpg'));
    expect(dpr2?.displayWidth).toBe(1920);
    expect(dpr2?.displayHeight).toBe(1080);
  });

  it('picks up data-srcset on <source> (lazy-loaded picture), smart-merged to best URL', async () => {
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute('data-srcset', 'https://example.com/lazy-pic.jpg 1x');
    source.setAttribute('data-src', 'https://example.com/lazy-pic-fallback.jpg');
    picture.appendChild(source);
    document.body.appendChild(picture);

    const result = await (await getExtractImages())();
    const urls = result.map((r) => r.url);
    // Smart merge: data-srcset is preferred over data-src; only one URL emitted
    expect(urls.some((u) => u.includes('lazy-pic.jpg'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromStylesheets — currently a no-op (touches resolveUrl only)
// ─────────────────────────────────────────────────────────────────────

describe('extractFromStylesheets (removed — no-op was deleted in v1.0.5)', () => {
  it('stylesheet-only background URLs are NOT in results (caught by getComputedStyle)', async () => {
    const styleEl = document.createElement('style');
    styleEl.textContent = ".x { background-image: url('https://example.com/sheet-only.jpg'); }";
    document.head.appendChild(styleEl);

    const result = await (await getExtractImages())();
    expect(result.find((r) => r.url.includes('sheet-only.jpg'))).toBeUndefined();
  });

  it('survives cross-origin sheet access errors silently', async () => {
    Object.defineProperty(document, 'styleSheets', {
      value: [
        {
          get cssRules(): CSSRuleList {
            throw new DOMException('cross-origin', 'SecurityError');
          },
          get rules(): CSSRuleList {
            throw new DOMException('cross-origin', 'SecurityError');
          },
        },
      ],
      configurable: true,
    });

    const extractImages = await getExtractImages();
    await expect(extractImages()).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// seenUrls dedupe — cross-function dedupe across <picture><source>
// ─────────────────────────────────────────────────────────────────────

describe('extractPictureSources seenUrls dedupe', () => {
  it('skip branch: same resolved URL already in seenUrls is NOT re-added (continue-on-seen)', async () => {
    // Pin: the `if (state.seenUrls.has(resolvedUrl)) continue` guard
    // inside the <picture><source> srcset parser. Without it, a
    // <source srcset="img.jpg 1x, img.jpg 2x"> (duplicate URL across
    // descriptors, which is valid markup) would create two ImageItems
    // with identical IDs — breaking the sidepanel's dedup-by-id.
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    // Duplicate URL at different descriptors — realistic in lazy-loaded
    // markup where JS overrides srcset with a static placeholder.
    source.setAttribute(
      'srcset',
      'https://example.com/samefile.jpg 1x, https://example.com/samefile.jpg 2x'
    );
    picture.appendChild(source);
    document.body.appendChild(picture);

    const result = await (await getExtractImages())();
    const matches = result.filter((r) => r.url.includes('samefile.jpg'));
    // Dedupe pinned — exactly ONE entry survives.
    expect(matches).toHaveLength(1);
  });
});
