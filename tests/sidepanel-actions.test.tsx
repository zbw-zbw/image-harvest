// Unit tests for the pure helpers in sidepanel/actions.ts.
//
// Scope:
//   - formatTimestamp: pads every Date field into YYYYMMDD-HHmmss
//   - getOriginalFilename: URL parse + extension fallback contract
//     (the contract every download path uses to derive a safe filename)
//   - selectAll / clearSelection: state.selectedImages mutation pipeline
//   - reverseSearch: 4-engine whitelist guard + URL builder
//
// Out of scope (chrome.runtime IPC long chains / DOM-heavy paths):
//   - downloadSingle / downloadSelectedAsZip / fetchImageBlobWithFallback
//   - toggleSelection (transitively highlights via background)
//   - showReverseSearchMenu (DOM positioning, e2e covers it)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the heavy DOM/IPC neighbors so importing actions.ts doesn't drag
// the entire UI render pipeline into the test.
vi.mock('../sidepanel/render', () => ({
  renderImages: vi.fn(),
}));
vi.mock('../sidepanel/settings', () => ({
  showProUpgradeModal: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
  showProgress: vi.fn(),
  hideProgress: vi.fn(),
  updateProgress: vi.fn(),
  showConfirmDialog: vi.fn(),
}));

import {
  formatTimestamp,
  getOriginalFilename,
  selectAll,
  clearSelection,
  reverseSearch,
  openInNewTab,
  setupDragAndDrop,
} from '../sidepanel/actions';
import { state, store } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

interface ChromeStub {
  tabs: {
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  runtime: {
    getURL: ReturnType<typeof vi.fn>;
  };
}

let chromeStub: ChromeStub;

beforeEach(() => {
  store.reset();
  document.body.innerHTML = '';
  chromeStub = {
    tabs: {
      // safeSendMessageToTab → chrome.tabs.query → tab.id
      // We resolve to no tab so the IPC bails silently — the helpers
      // we test don't depend on the highlight side effect actually
      // landing.
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 99 }),
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://abcd/${path}`),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = chromeStub;
});

afterEach(() => {
  store.reset();
  document.body.innerHTML = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
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
// formatTimestamp
// ─────────────────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('pads every field to a fixed-width YYYYMMDD-HHmmss string', () => {
    // Single-digit month, day, hour, minute, second all padded.
    const d = new Date(2024, 0, 5, 7, 8, 9); // 2024-01-05 07:08:09
    expect(formatTimestamp(d)).toBe('20240105-070809');
  });

  it('handles two-digit fields without extra padding', () => {
    const d = new Date(2025, 11, 31, 23, 59, 59); // 2025-12-31 23:59:59
    expect(formatTimestamp(d)).toBe('20251231-235959');
  });

  it('produces a 15-char string (8 date + 1 dash + 6 time) every time', () => {
    expect(formatTimestamp(new Date(2000, 0, 1, 0, 0, 0))).toBe('20000101-000000');
    expect(formatTimestamp(new Date(2000, 0, 1, 0, 0, 0))).toHaveLength(15);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getOriginalFilename — extension fallback contract
// ─────────────────────────────────────────────────────────────────────

describe('getOriginalFilename', () => {
  it('returns the URL pathname tail when it already has an extension', () => {
    expect(getOriginalFilename(makeImg({ url: 'https://x.com/dir/photo.png' }))).toBe('photo.png');
  });

  it('appends img.format when the pathname tail has no extension', () => {
    expect(getOriginalFilename(makeImg({ url: 'https://x.com/dir/photo', format: 'webp' }))).toBe(
      'photo.webp'
    );
  });

  it('falls back to .png when both URL extension AND img.format are missing', () => {
    expect(
      getOriginalFilename(makeImg({ url: 'https://x.com/dir/photo', format: undefined }))
    ).toBe('photo.png');
  });

  it('returns "image" + extension when URL pathname is empty (just /)', () => {
    expect(getOriginalFilename(makeImg({ url: 'https://x.com/' }))).toBe('image.jpg');
  });

  it('returns "image.<format>" for unparseable URLs (catch branch)', () => {
    expect(getOriginalFilename(makeImg({ url: 'not a url', format: 'gif' }))).toBe('image.gif');
    expect(getOriginalFilename(makeImg({ url: 'not a url', format: undefined }))).toBe('image.png');
  });
});

// ─────────────────────────────────────────────────────────────────────
// selectAll / clearSelection
// ─────────────────────────────────────────────────────────────────────

describe('selectAll', () => {
  it('adds every filteredImages.id to selectedImages and re-renders', async () => {
    state.filteredImages = [makeImg({ id: 'a' }), makeImg({ id: 'b' }), makeImg({ id: 'c' })];
    state.selectedImages = new Set();

    selectAll();

    expect(Array.from(state.selectedImages).sort()).toEqual(['a', 'b', 'c']);
    const renderMod = await import('../sidepanel/render');
    expect(renderMod.renderImages).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — selecting again with the same filter set is a no-op for membership', () => {
    state.filteredImages = [makeImg({ id: 'a' }), makeImg({ id: 'b' })];
    state.selectedImages = new Set(['a']);

    selectAll();

    expect(Array.from(state.selectedImages).sort()).toEqual(['a', 'b']);
  });

  it('does NOT touch images outside the current filter (preserves selection of hidden items)', () => {
    state.filteredImages = [makeImg({ id: 'a' })];
    state.selectedImages = new Set(['hidden-1']); // not in filteredImages

    selectAll();

    // 'hidden-1' is a stale selection from a wider filter; selectAll
    // adds the currently-visible 'a' but should not evict 'hidden-1'.
    expect(state.selectedImages.has('hidden-1')).toBe(true);
    expect(state.selectedImages.has('a')).toBe(true);
  });
});

describe('clearSelection', () => {
  it('empties selectedImages and re-renders', async () => {
    state.selectedImages = new Set(['a', 'b', 'c']);

    clearSelection();

    expect(state.selectedImages.size).toBe(0);
    const renderMod = await import('../sidepanel/render');
    expect(renderMod.renderImages).toHaveBeenCalledTimes(1);
  });

  it('triggers REMOVE_HIGHLIGHT IPC (best-effort, swallowed if no active tab)', () => {
    state.selectedImages = new Set(['a']);
    // safeSendMessageToTab → chrome.tabs.query() → [] (no tab) → bails
    // silently. We just need to verify the call SITE was reached, which
    // means chrome.tabs.query was consulted.
    clearSelection();
    expect(chromeStub.tabs.query).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// reverseSearch — engine whitelist + URL builder
// ─────────────────────────────────────────────────────────────────────

describe('reverseSearch', () => {
  const imageUrl = 'https://example.com/photo.jpg';

  it.each(['google', 'tineye', 'baidu', 'yandex'])(
    'opens a new tab to the intermediate page for whitelisted engine "%s"',
    (engine) => {
      reverseSearch(imageUrl, engine);
      expect(chromeStub.tabs.create).toHaveBeenCalledTimes(1);
      const arg = chromeStub.tabs.create.mock.calls[0][0] as { url: string; active: boolean };
      expect(arg.active).toBe(true);
      expect(arg.url).toContain('pages/reverse-search.html');
      expect(arg.url).toContain(`engine=${engine}`);
      expect(arg.url).toContain(`imageUrl=${encodeURIComponent(imageUrl)}`);
    }
  );

  it.each(['', 'GOOGLE', 'bing', 'duckduckgo', 'sogou'])(
    'ignores non-whitelisted engine "%s" (no tab opened, no error)',
    (engine) => {
      reverseSearch(imageUrl, engine);
      expect(chromeStub.tabs.create).not.toHaveBeenCalled();
    }
  );

  it('URL-encodes the imageUrl param to survive special chars (& + spaces)', () => {
    const tricky = 'https://x.com/p?q=1&w=2 3';
    reverseSearch(tricky, 'google');
    const url = (chromeStub.tabs.create.mock.calls[0][0] as { url: string }).url;
    expect(url).toContain(`imageUrl=${encodeURIComponent(tricky)}`);
    // Sanity: literal '&' inside the imageUrl param must NOT appear
    // un-escaped (would break query-string parsing on the receiving page).
    const imageUrlMatch = url.match(/imageUrl=([^&]+)/);
    expect(imageUrlMatch?.[1]).toBe(encodeURIComponent(tricky));
  });
});

// ─────────────────────────────────────────────────────────────────────
// openInNewTab — tab-index-aware "open to the right of the active tab"
// ─────────────────────────────────────────────────────────────────────

describe('openInNewTab', () => {
  const url = 'https://example.com/photo.jpg';

  it('inserts the new tab immediately after the active tab (index+1)', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([{ id: 7, index: 3 } as chrome.tabs.Tab]);
    await openInNewTab(url);
    expect(chromeStub.tabs.create).toHaveBeenCalledTimes(1);
    const arg = chromeStub.tabs.create.mock.calls[0][0];
    expect(arg).toEqual({ url, active: true, index: 4 });
  });

  it('omits the index option when no active tab is returned (empty query result)', async () => {
    // Pin: Chrome sometimes returns [] if the window is transitioning
    // (e.g. popup just opened). Falling back to "append at the end"
    // (no index) is safer than crashing.
    chromeStub.tabs.query.mockResolvedValueOnce([]);
    await openInNewTab(url);
    const arg = chromeStub.tabs.create.mock.calls[0][0];
    expect(arg).toEqual({ url, active: true });
    expect(arg).not.toHaveProperty('index');
  });

  it('omits the index option when activeTab.index is not a number (guard)', async () => {
    // Pin the typeof-number guard. If Chrome ever returns a Tab object
    // without `index` (undocumented edge case on some mobile builds),
    // the fallback must still produce a valid create() call.
    chromeStub.tabs.query.mockResolvedValueOnce([{ id: 7 } as unknown as chrome.tabs.Tab]);
    await openInNewTab(url);
    const arg = chromeStub.tabs.create.mock.calls[0][0];
    expect(arg).toEqual({ url, active: true });
    expect(arg).not.toHaveProperty('index');
  });

  it('catch branch: chrome.tabs.query throws → falls back to create({url, active})', async () => {
    // Pin: any rejection from query() (permission revoked / extension
    // context invalidated) must NOT propagate. User right-clicking a
    // card should always get the image opened, even in degraded state.
    chromeStub.tabs.query.mockRejectedValueOnce(new Error('permission denied'));
    await expect(openInNewTab(url)).resolves.toBeUndefined();
    expect(chromeStub.tabs.create).toHaveBeenCalledTimes(1);
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url, active: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// setupDragAndDrop — HTML5 drag source wiring on an image card element
// ─────────────────────────────────────────────────────────────────────

describe('setupDragAndDrop', () => {
  it('flips draggable="true" on the host element (so the browser initiates drag)', () => {
    const el = document.createElement('div');
    setupDragAndDrop(el, makeImg());
    // Pin the draggable attribute contract. Without this the dragstart
    // event never fires, silently breaking every "drag image out to
    // desktop" UX.
    expect(el.getAttribute('draggable')).toBe('true');
  });

  it('dragstart handler writes text/uri-list + text/plain + effectAllowed=copy', () => {
    const el = document.createElement('div');
    const img = makeImg({ url: 'https://cdn.example.com/x.png' });
    setupDragAndDrop(el, img);

    // Fabricate a dragstart event with a stub DataTransfer — jsdom's
    // native DragEvent constructor is incomplete.
    const setData = vi.fn();
    const dataTransfer = {
      setData,
      effectAllowed: '',
    } as unknown as DataTransfer;
    const event = new Event('dragstart', { bubbles: true }) as unknown as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    el.dispatchEvent(event);

    // Pin BOTH MIME flavors. Some file managers (Finder/Explorer) read
    // text/uri-list; browsers/IDEs read text/plain. Dropping either
    // would break a subset of drop targets.
    expect(setData).toHaveBeenCalledWith('text/uri-list', img.url);
    expect(setData).toHaveBeenCalledWith('text/plain', img.url);
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('dragstart handler bails silently when dataTransfer is null', () => {
    // Pin: the `if (!e.dataTransfer) return` guard. Some synthetic
    // events (e.g. from automated tests) have a null dataTransfer;
    // without this guard the handler would throw and Preact's event
    // bridge would log a noisy error.
    const el = document.createElement('div');
    setupDragAndDrop(el, makeImg());

    const event = new Event('dragstart', { bubbles: true }) as unknown as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: null });
    expect(() => el.dispatchEvent(event)).not.toThrow();
  });
});
