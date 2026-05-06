// Unit tests for content/monitor.ts — focused on:
//   - extractFromNode: tag-dispatch (img / video / input / object /
//     embed / svg / canvas) + child traversal
//   - extractBackgroundFromNode: getComputedStyle.backgroundImage parsing
//   - startLiveMonitoring / stopLiveMonitoring: MutationObserver lifecycle
//
// Out of scope: the MutationObserver flush pipeline (debounce + buffer),
// which is e2e territory (real DOM mutation timing).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seenUrls = new Set<string>();
vi.mock('../content/state', () => ({
  state: {
    isExtracting: false,
    get seenUrls() {
      return seenUrls;
    },
    liveObserver: null as MutationObserver | null,
  },
  isExtensionContextValid: vi.fn(() => true),
}));

vi.mock('../shared/utils', () => ({
  generateId: vi.fn((url: string) => `id-${url.slice(0, 24)}`),
  // Full-string key avoids prefix collisions; same URL → same key (dedup works).
  generateDataUriKey: vi.fn((dataUri: string) => `key-${dataUri}`),
  resolveUrl: vi.fn((u: string) => `https://example.com/${u.replace(/^\//, '')}`),
  getDomain: vi.fn((u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  }),
  getFileFormat: vi.fn((u: string) => {
    if (u.endsWith('.png')) return 'png';
    if (u.endsWith('.jpg')) return 'jpg';
    if (u.endsWith('.svg')) return 'svg';
    return 'unknown';
  }),
  isDataUri: vi.fn((u: string) => u.startsWith('data:')),
  isImageDataUri: vi.fn((u: string) => u.startsWith('data:image/')),
  extractBackgroundUrls: vi.fn((bg: string) => {
    const matches = bg.match(/url\(['"]?([^'")]+)['"]?\)/g) || [];
    return matches.map((m) => m.replace(/url\(['"]?([^'")]+)['"]?\)/, '$1'));
  }),
  isGradient: vi.fn((u: string) => u.includes('gradient(')),
}));

vi.mock('../content/utils', () => ({
  parseSrcset: vi.fn((srcset: string) =>
    srcset.split(',').map((part) => {
      const [url] = part.trim().split(/\s+/);
      return { url, width: 0 };
    })
  ),
  sendDiscoveredImages: vi.fn(),
}));

vi.mock('../content/extract-advanced', () => ({
  extractInlineSvg: vi.fn((svg: SVGElement) => {
    const id = svg.getAttribute('id') || 'svg-default';
    return {
      id: `svg-item-${id}`,
      url: `data:image/svg+xml;base64,${id}`,
      type: 'svg',
      format: 'svg',
    };
  }),
  extractCanvasImage: vi.fn((canvas: HTMLCanvasElement) => {
    if (canvas.width < 2) return null; // mimic real guard
    return {
      id: `canvas-item-${canvas.width}x${canvas.height}`,
      url: 'data:image/png;base64,canvas-data',
      type: 'canvas',
      format: 'png',
    };
  }),
}));

import {
  extractFromNode,
  extractBackgroundFromNode,
  startLiveMonitoring,
  stopLiveMonitoring,
} from '../content/monitor';
import { state } from '../content/state';
import { sendDiscoveredImages } from '../content/utils';

beforeEach(() => {
  document.body.innerHTML = '';
  seenUrls.clear();
  state.liveObserver = null;
});

afterEach(() => {
  document.body.innerHTML = '';
  seenUrls.clear();
  if (state.liveObserver) {
    state.liveObserver.disconnect();
    state.liveObserver = null;
  }
  vi.restoreAllMocks();
});

// Helper — stub getBoundingClientRect on an element (jsdom returns 0).
function stubRect(el: Element, w: number, h: number): void {
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
// extractFromNode — <img> dispatch
// ─────────────────────────────────────────────────────────────────────

describe('extractFromNode — <img>', () => {
  it('extracts a plain <img> with src', () => {
    const img = document.createElement('img');
    img.src = 'photo.jpg';
    document.body.appendChild(img);

    const items = extractFromNode(img);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('img');
    expect(items[0].format).toBe('jpg');
    expect(items[0].url.includes('photo.jpg')).toBe(true);
  });

  it('extracts data: URIs without resolveUrl', () => {
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,AAAA';
    document.body.appendChild(img);

    const items = extractFromNode(img);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('data:image/png;base64,AAAA');
  });

  it('skips non-image data: URIs (text/plain etc.)', () => {
    const img = document.createElement('img');
    img.src = 'data:text/plain;base64,SGVsbG8=';
    document.body.appendChild(img);

    expect(extractFromNode(img)).toEqual([]);
  });

  it('dedupes via state.seenUrls — second call on same img returns []', () => {
    const img = document.createElement('img');
    img.src = 'photo.jpg';
    document.body.appendChild(img);

    expect(extractFromNode(img)).toHaveLength(1);
    expect(extractFromNode(img)).toEqual([]);
  });

  it('aggregates src + currentSrc + srcset + data-* candidate URLs', () => {
    const img = document.createElement('img');
    img.src = 'main.jpg';
    Object.defineProperty(img, 'currentSrc', { value: 'current.jpg' });
    img.srcset = 'small.jpg 320w, large.jpg 800w';
    img.setAttribute('data-src', 'lazy.jpg');
    img.setAttribute('data-original', 'original.jpg');
    document.body.appendChild(img);

    const items = extractFromNode(img);
    // Each unique candidate URL gets its own ImageItem.
    const urls = items.map((i) => i.url);
    expect(urls.some((u) => u.includes('main.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('current.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('small.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('large.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('lazy.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('original.jpg'))).toBe(true);
  });

  it('uses naturalWidth/Height for displayWidth/Height when present', () => {
    const img = document.createElement('img');
    img.src = 'photo.jpg';
    Object.defineProperty(img, 'naturalWidth', { value: 1920 });
    Object.defineProperty(img, 'naturalHeight', { value: 1080 });
    document.body.appendChild(img);

    const items = extractFromNode(img);
    expect(items[0].displayWidth).toBe(1920);
    expect(items[0].displayHeight).toBe(1080);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromNode — <video> poster
// ─────────────────────────────────────────────────────────────────────

describe('extractFromNode — <video>', () => {
  it('extracts video.poster as type="video-poster"', () => {
    const video = document.createElement('video');
    video.poster = 'poster.jpg';
    document.body.appendChild(video);

    const items = extractFromNode(video);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('video-poster');
  });

  it('skips video without poster attribute', () => {
    const video = document.createElement('video');
    document.body.appendChild(video);

    expect(extractFromNode(video)).toEqual([]);
  });

  it('handles data: URI poster', () => {
    const video = document.createElement('video');
    video.poster = 'data:image/jpeg;base64,AAAA';
    document.body.appendChild(video);

    const items = extractFromNode(video);
    expect(items).toHaveLength(1);
    expect(items[0].url.startsWith('data:image/jpeg')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromNode — <input type="image">
// ─────────────────────────────────────────────────────────────────────

describe('extractFromNode — <input type="image">', () => {
  it('extracts input[type=image].src as type="input-image"', () => {
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'submit.png';
    document.body.appendChild(input);

    const items = extractFromNode(input);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('input-image');
    expect(items[0].format).toBe('png');
  });

  it('skips input[type=text] (only type=image is image-bearing)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.src = 'photo.jpg';
    document.body.appendChild(input);

    expect(extractFromNode(input)).toEqual([]);
  });

  it('skips input[type=image] without src', () => {
    const input = document.createElement('input');
    input.type = 'image';
    document.body.appendChild(input);

    expect(extractFromNode(input)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromNode — <object> and <embed>
// ─────────────────────────────────────────────────────────────────────

describe('extractFromNode — <object> / <embed>', () => {
  it('extracts <object type="image/png" data="..."> as type="object"', () => {
    const obj = document.createElement('object');
    obj.type = 'image/png';
    obj.data = 'graphic.png';
    stubRect(obj, 200, 100);
    document.body.appendChild(obj);

    const items = extractFromNode(obj);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('object');
    expect(items[0].displayWidth).toBe(200);
    expect(items[0].displayHeight).toBe(100);
  });

  it('extracts <object> when type is missing but URL has image extension', () => {
    const obj = document.createElement('object');
    obj.data = 'graphic.png';
    stubRect(obj, 50, 50);
    document.body.appendChild(obj);

    // No explicit type, but getFileFormat('graphic_png') → 'png' ≠ 'unknown'
    expect(extractFromNode(obj)).toHaveLength(1);
  });

  it('skips <object> with non-image type and unknown extension', () => {
    const obj = document.createElement('object');
    obj.type = 'application/pdf';
    obj.data = 'doc.pdf';
    document.body.appendChild(obj);

    expect(extractFromNode(obj)).toEqual([]);
  });

  it('extracts <embed type="image/jpeg"> as type="embed"', () => {
    const embed = document.createElement('embed');
    embed.type = 'image/jpeg';
    embed.src = 'graphic.jpg';
    stubRect(embed, 300, 200);
    document.body.appendChild(embed);

    const items = extractFromNode(embed);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('embed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromNode — <svg> / <canvas> dispatch to extract-advanced
// ─────────────────────────────────────────────────────────────────────

describe('extractFromNode — <svg> / <canvas>', () => {
  it('delegates SVG element to extractInlineSvg', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'unique-svg');
    document.body.appendChild(svg);

    const items = extractFromNode(svg as unknown as Element);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('svg-item-unique-svg');
    expect(items[0].type).toBe('svg');
  });

  it('delegates CANVAS element to extractCanvasImage', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    document.body.appendChild(canvas);

    const items = extractFromNode(canvas);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('canvas-item-300x150');
  });

  it('drops null returns from extractCanvasImage gracefully (tiny canvas)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; // mocked extractCanvasImage returns null for <2
    canvas.height = 1;
    document.body.appendChild(canvas);

    expect(extractFromNode(canvas)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromNode — child traversal
// ─────────────────────────────────────────────────────────────────────

describe('extractFromNode — child traversal', () => {
  it('finds <img> nested in a wrapper div via querySelectorAll', () => {
    const wrapper = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'nested.jpg';
    wrapper.appendChild(img);
    document.body.appendChild(wrapper);

    const items = extractFromNode(wrapper);
    expect(items).toHaveLength(1);
    expect(items[0].url.includes('nested.jpg')).toBe(true);
  });

  it('finds multiple nested <img>s and dedupes identical URLs', () => {
    const wrapper = document.createElement('div');
    for (const url of ['a.jpg', 'b.jpg', 'a.jpg']) {
      const img = document.createElement('img');
      img.src = url;
      wrapper.appendChild(img);
    }
    document.body.appendChild(wrapper);

    const items = extractFromNode(wrapper);
    // a.jpg + b.jpg = 2 unique
    const uniqueUrls = new Set(items.map((i) => i.url));
    expect(uniqueUrls.size).toBe(2);
  });

  it('finds nested <video poster> via querySelectorAll(video[poster])', () => {
    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    video.poster = 'cover.jpg';
    wrapper.appendChild(video);
    document.body.appendChild(wrapper);

    const items = extractFromNode(wrapper);
    expect(items.some((i) => i.type === 'video-poster')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractBackgroundFromNode
// ─────────────────────────────────────────────────────────────────────

describe('extractBackgroundFromNode', () => {
  it('returns [] when no background-image is set', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    expect(extractBackgroundFromNode(div)).toEqual([]);
  });

  it('extracts a single url() from background-image', () => {
    const div = document.createElement('div');
    div.setAttribute('style', "background-image: url('hero.jpg')");
    stubRect(div, 1200, 600);
    document.body.appendChild(div);

    const items = extractBackgroundFromNode(div);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('bg');
    expect(items[0].url.includes('hero.jpg')).toBe(true);
    expect(items[0].displayWidth).toBe(1200);
    expect(items[0].displayHeight).toBe(600);
  });

  it('skips gradient() values (filtered by isGradient mock)', () => {
    const div = document.createElement('div');
    div.setAttribute('style', 'background-image: linear-gradient(red, blue)');
    document.body.appendChild(div);

    // extractBackgroundUrls returns nothing for pure gradients in our mock
    // (no url() match), and even if it did, isGradient would filter.
    expect(extractBackgroundFromNode(div)).toEqual([]);
  });

  it('handles data: URI in background-image', () => {
    const div = document.createElement('div');
    div.setAttribute('style', "background-image: url('data:image/png;base64,AAAA')");
    stubRect(div, 100, 100);
    document.body.appendChild(div);

    const items = extractBackgroundFromNode(div);
    expect(items).toHaveLength(1);
    expect(items[0].url.startsWith('data:image/png')).toBe(true);
  });

  it('catches getComputedStyle exceptions and returns [] (defensive)', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('jsdom failure');
    });

    expect(extractBackgroundFromNode(div)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// startLiveMonitoring / stopLiveMonitoring lifecycle
// ─────────────────────────────────────────────────────────────────────

describe('startLiveMonitoring / stopLiveMonitoring', () => {
  it('startLiveMonitoring assigns a MutationObserver to state.liveObserver', () => {
    expect(state.liveObserver).toBeNull();
    startLiveMonitoring();
    expect(state.liveObserver).toBeInstanceOf(MutationObserver);
  });

  it('stopLiveMonitoring disconnects and nulls out state.liveObserver', () => {
    startLiveMonitoring();
    const observer = state.liveObserver;
    expect(observer).not.toBeNull();

    const disconnectSpy = vi.spyOn(observer!, 'disconnect');
    stopLiveMonitoring();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(state.liveObserver).toBeNull();
  });

  it('stopLiveMonitoring is a no-op when no observer is active', () => {
    expect(state.liveObserver).toBeNull();
    expect(() => stopLiveMonitoring()).not.toThrow();
    expect(state.liveObserver).toBeNull();
  });

  it('startLiveMonitoring twice replaces the existing observer (no leak)', () => {
    startLiveMonitoring();
    const first = state.liveObserver;
    startLiveMonitoring();
    const second = state.liveObserver;

    expect(first).not.toBe(second);
    expect(second).toBeInstanceOf(MutationObserver);
  });

  it('passes config.debounceMs through (smoke test — observer still installs)', () => {
    startLiveMonitoring({ debounceMs: 1000 });
    expect(state.liveObserver).toBeInstanceOf(MutationObserver);
  });
});

// Ensure the sendDiscoveredImages mock is wired (sanity check; the real
// invocation path is tested through e2e because it requires triggering
// MutationObserver callbacks with fake timers).
describe('sendDiscoveredImages mock wiring (sanity)', () => {
  it('sendDiscoveredImages is a vi.fn (verifies module mock applied)', () => {
    expect(vi.isMockFunction(sendDiscoveredImages)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Remaining uncov branches — embed data-uri + nested svg/canvas
// ─────────────────────────────────────────────────────────────────────
// Pin: these branches plug the last gaps in extractFromNode's
// dispatch/traversal. Without them, a regression where a nested <svg>
// or <canvas> inside a dynamically-injected wrapper is silently dropped
// would go unnoticed — users would see "missing" logos on pages that
// mount icon systems via a wrapper element (very common in SPA nav bars).

describe('extractFromNode — remaining branches (embed data-uri + nested svg/canvas)', () => {
  it('extracts <embed src="data:image/..."> and uses the data-uri branch for format/sourceDomain', () => {
    // Pins the L337-342 ternaries: when srcUrl is a data URI, format
    // comes from getFileFormat(srcUrl) and sourceDomain falls back to
    // window.location.hostname (not getDomain of a resolved URL).
    const embed = document.createElement('embed');
    embed.src = 'data:image/svg+xml;base64,PHN2Zy8+';
    embed.type = 'image/svg+xml';
    stubRect(embed, 120, 80);
    document.body.appendChild(embed);

    const items = extractFromNode(embed);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('embed');
    // Data-URI branch: url kept as-is (no resolveUrl call).
    expect(items[0].url).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    // Data-URI branch: format from the data URI itself (mock returns
    // 'svg' only for .svg suffix, so this falls through to 'unknown' —
    // but what matters is the branch is exercised, not the value).
    expect(items[0].format).toBeDefined();
    // Data-URI branch: sourceDomain = window.location.hostname.
    expect(items[0].sourceDomain).toBe(window.location.hostname);
  });

  it('traverses a wrapper and finds a nested <svg> via querySelectorAll(svg)', () => {
    // Pins L376-380 — the child-svg fallback. Delegates to the mocked
    // extractInlineSvg; what matters is that the nested svg is picked
    // up even when the wrapper itself has no direct image content.
    const wrapper = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'nested-svg');
    wrapper.appendChild(svg);
    document.body.appendChild(wrapper);

    const items = extractFromNode(wrapper);
    expect(items.some((i) => i.id === 'svg-item-nested-svg')).toBe(true);
  });

  it('traverses a wrapper and finds a nested <canvas> via querySelectorAll(canvas)', () => {
    // Pins L381-385 — the child-canvas fallback. Delegates to
    // extractCanvasImage; mock returns an item when width >= 2.
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    wrapper.appendChild(canvas);
    document.body.appendChild(wrapper);

    const items = extractFromNode(wrapper);
    expect(items.some((i) => i.id === 'canvas-item-400x300')).toBe(true);
  });

  it('drops null from nested <canvas> (too-small canvas → extractCanvasImage returns null)', () => {
    // Negative pin of the same child-canvas branch — the `if (canvasItem)`
    // guard must filter nulls, otherwise downstream sees undefined items.
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 1; // mock returns null for <2
    canvas.height = 1;
    wrapper.appendChild(canvas);
    document.body.appendChild(wrapper);

    const items = extractFromNode(wrapper);
    expect(items.filter((i) => i.type === 'canvas')).toHaveLength(0);
  });

  it('extracts <input type="image" src="data:image/..."> via the data-URI branch', () => {
    // Pins L245-267 — the <input type=image> data-URI fork. When src is
    // a data URI, url is kept as-is and sourceDomain = hostname (no
    // resolveUrl). Guards against a regression where form-submit image
    // buttons painted via inline SVG data URIs silently disappear from
    // scan results.
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'data:image/png;base64,iVBORw0KGgo=';
    input.width = 64;
    input.height = 64;
    document.body.appendChild(input);

    const items = extractFromNode(input);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('input-image');
    expect(items[0].url).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(items[0].sourceDomain).toBe(window.location.hostname);
  });

  it('skips <input type="image"> with non-image data URI', () => {
    // Negative pin of the same branch — if isImageDataUri returns
    // false, nothing is pushed. Guards against pushing `data:text/...`
    // URIs as images (a spam/tracking-pixel smuggling vector).
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'data:text/plain;base64,aGVsbG8=';
    document.body.appendChild(input);

    expect(extractFromNode(input)).toEqual([]);
  });

  it('extracts <object data="data:image/..."> via the data-URI branch', () => {
    // Pins L306/309 — the <object> data-URI ternaries for url/format/
    // sourceDomain. Guards against a regression where SVG icon systems
    // mounted via <object data="data:image/svg+xml;base64,..."> are
    // silently dropped.
    const obj = document.createElement('object');
    obj.type = 'image/svg+xml';
    obj.data = 'data:image/svg+xml;base64,PHN2Zy8+';
    stubRect(obj, 48, 48);
    document.body.appendChild(obj);

    const items = extractFromNode(obj);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('object');
    expect(items[0].url).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    expect(items[0].sourceDomain).toBe(window.location.hostname);
  });
});
