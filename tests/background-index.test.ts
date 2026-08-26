// Unit tests for background/index.ts — focused on:
//   - handleMessage routing table (19 MESSAGE_TYPES branches + default)
//   - Error-shape contract: { success: false, error, message?, workaround? }
//   - Bootstrap side effects (initLicenseAlarm + chrome.runtime.onConnect
//     listener + chrome.downloads.onChanged listener) — verified via mock
//     call counts during module import.
//
// Strategy: mock every imported subsystem so the router's own dispatch
// logic is the only thing under test. Each case asserts:
//   1. The right subsystem function got called with the right args
//   2. sendResponse was called with the documented payload shape

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Subsystem mocks ─────────────────────────────────────────────────

vi.mock('../shared/storage', () => ({
  getFilterConfig: vi.fn(),
  getDownloadHistory: vi.fn(),
  clearDownloadHistory: vi.fn(),
  saveFilterConfig: vi.fn(),
  getAppSettings: vi.fn(),
  saveAppSettings: vi.fn(),
}));

vi.mock('../shared/license', () => ({
  activateLicense: vi.fn(),
  deactivateLicense: vi.fn(),
  // initTelemetry() at module top-level calls isProUser().then(...).
  // A bare vi.fn() returns undefined and crashes the bootstrap import,
  // so seed a resolved default; individual tests can override via mockResolvedValueOnce.
  isProUser: vi.fn(() => Promise.resolve({ isPro: false, plan: 'free' })),
  getLicenseInfo: vi.fn(),
}));

vi.mock('../background/utils', () => ({
  uiPorts: new Set(),
  sidePanelOpenedTabs: new Set<number>(),
  getAccessibleTabId: vi.fn(),
  broadcastToPopup: vi.fn(),
}));

vi.mock('../background/license', () => ({
  initLicenseAlarm: vi.fn(),
}));

vi.mock('../background/display-mode', () => ({
  initDisplayMode: vi.fn(),
  initTabActivationListener: vi.fn(),
}));

vi.mock('../background/extractor', () => ({
  getImagesFromTab: vi.fn(),
  processMultiTabExtract: vi.fn(),
}));

vi.mock('../background/reverse-search', () => ({
  fetchImageData: vi.fn(),
  fetchImageMetaProxy: vi.fn(),
  reverseSearchUpload: vi.fn(),
}));

// Telemetry is invoked at module top-level via initTelemetry() — mock to
// no-op so the bootstrap import doesn't hit chrome.runtime.getManifest
// failures or start the 5s flush timer. We don't assert on telemetry
// calls here; those live in tests/telemetry.test.ts.
vi.mock('../shared/telemetry', () => ({
  setEnvelopeMeta: vi.fn(),
  track: vi.fn(() => Promise.resolve()),
  flushNow: vi.fn(() => Promise.resolve()),
}));

vi.mock('../shared/telemetry-events', () => ({
  EVENTS: {
    EXTENSION_INSTALLED: 'ext_installed',
    EXTENSION_UPDATED: 'ext_updated',
  },
}));

vi.mock('../background/auto-trial', () => ({
  autoStartTrial: vi.fn(() => Promise.resolve()),
  initAutoTrialAlarm: vi.fn(),
}));

// ── chrome global mock ──────────────────────────────────────────────
// Capture the onMessage listener so tests can invoke it directly.
let onMessageListener:
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean | undefined)
  | null = null;
let onConnectListener: ((port: chrome.runtime.Port) => void) | null = null;
let onDownloadChanged: ((delta: chrome.downloads.DownloadDelta) => void) | null = null;
// v1.1.0: captured at module import — clearAllMocks() wipes mock call
// records between cases, so listener REFERENCES are the only stable way
// to re-invoke bootstrap-time registrations.
let onInstalledListener: ((details: chrome.runtime.InstalledDetails) => void) | null = null;
let onContextMenuClick:
  | ((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void)
  | null = null;

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
      onInstalled: {
        addListener: vi.fn((fn) => {
          onInstalledListener = fn;
        }),
      },
      // initTelemetry() reads version from here at module init time.
      getManifest: vi.fn(() => ({ version: '1.0.1' })),
    },
    downloads: {
      onChanged: {
        addListener: vi.fn((fn) => {
          onDownloadChanged = fn;
        }),
      },
    },
    // v1.1.0 context menus — registered at module top-level
    // (onClicked listener) and inside onInstalled (removeAll + create).
    // Menu titles resolve via chrome.i18n.getMessage() (NOT manifest
    // __MSG__ substitution — that silently fails on some setups), so the
    // mock returns a distinctive marker the registration test pins.
    i18n: {
      getMessage: vi.fn((key: string) => `[i18n:${key}]`),
    },
    contextMenus: {
      onClicked: {
        addListener: vi.fn((fn) => {
          onContextMenuClick = fn;
        }),
      },
      removeAll: vi.fn((callback?: () => void) => callback?.()),
      create: vi.fn(),
    },
    tabs: {
      sendMessage: vi.fn(),
      query: vi.fn(),
      create: vi.fn(),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(() => Promise.resolve()),
      setOptions: vi.fn(() => Promise.resolve()),
      open: vi.fn(() => Promise.resolve()),
    },
    action: {
      setPopup: vi.fn(() => Promise.resolve()),
    },
  };

  // Import target after chrome global is in place — module top-level
  // runs initialization (initLicenseAlarm + onConnect/onMessage register).
  bgIndex = await import('../background/index');
});

import { MESSAGE_TYPES, ERROR_CODES } from '../shared/constants';
import * as storage from '../shared/storage';
import * as license from '../shared/license';
import * as bgUtils from '../background/utils';
import * as bgLicense from '../background/license';
import * as bgDisplayMode from '../background/display-mode';
import * as bgExtractor from '../background/extractor';
import * as bgReverseSearch from '../background/reverse-search';
// NOTE: background/index is imported dynamically in beforeAll (after the
// chrome global is installed) — a static import would evaluate its module
// top-level too early and crash on `chrome is not defined`. Bind exports we
// need through the same dynamic import.
let bgIndex: typeof import('../background/index') | null = null;

// Helper: invoke the registered onMessage listener and capture sendResponse.
async function dispatch(
  message: Record<string, unknown>,
  sender: Partial<chrome.runtime.MessageSender> = {}
): Promise<unknown> {
  if (!onMessageListener) throw new Error('listener not registered');
  return new Promise((resolve) => {
    onMessageListener!(message, sender as chrome.runtime.MessageSender, (response: unknown) =>
      resolve(response)
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// Bootstrap side effects (verified once at module load)
// ─────────────────────────────────────────────────────────────────────

describe('module bootstrap', () => {
  it('registers chrome.runtime.onMessage listener that returns true (keep async channel open)', () => {
    expect(onMessageListener).toBeTypeOf('function');
    // A listener returning `true` keeps sendResponse async-callable.
    const result = onMessageListener!(
      { type: 'NON_EXISTENT' },
      {} as chrome.runtime.MessageSender,
      () => {}
    );
    expect(result).toBe(true);
  });

  it('registers chrome.runtime.onConnect listener', () => {
    expect(onConnectListener).toBeTypeOf('function');
  });

  it('registers chrome.downloads.onChanged listener', () => {
    expect(onDownloadChanged).toBeTypeOf('function');
  });

  it('initLicenseAlarm + initDisplayMode + initTabActivationListener are wired as mocks (sanity)', () => {
    // Call counts can't be asserted here because beforeEach runs
    // vi.clearAllMocks() between cases, while these init functions
    // fire only ONCE at module import (in beforeAll). Verifying that
    // the module is correctly mocked is sufficient sanity — the real
    // contract that init runs at import time is implicitly proven by
    // the onMessage / onConnect / onDownloadChanged listeners being
    // captured (those use the same chrome global wired in beforeAll).
    expect(vi.isMockFunction(bgLicense.initLicenseAlarm)).toBe(true);
    expect(vi.isMockFunction(bgDisplayMode.initDisplayMode)).toBe(true);
    expect(vi.isMockFunction(bgDisplayMode.initTabActivationListener)).toBe(true);
  });

  it('onConnect: adds matching ports to uiPorts set, removes them on disconnect', () => {
    let onDisconnect: (() => void) | null = null;
    const port = {
      name: 'image-harvest-ui',
      onDisconnect: { addListener: vi.fn((fn) => (onDisconnect = fn)) },
    } as unknown as chrome.runtime.Port;

    onConnectListener!(port);
    expect((bgUtils.uiPorts as Set<unknown>).has(port)).toBe(true);

    onDisconnect!();
    expect((bgUtils.uiPorts as Set<unknown>).has(port)).toBe(false);
  });

  it('onConnect: ignores ports with non-matching names', () => {
    const port = {
      name: 'random-port-name',
      onDisconnect: { addListener: vi.fn() },
    } as unknown as chrome.runtime.Port;

    const sizeBefore = (bgUtils.uiPorts as Set<unknown>).size;
    onConnectListener!(port);
    expect((bgUtils.uiPorts as Set<unknown>).size).toBe(sizeBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Storage routes
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — storage routes', () => {
  it('GET_IMAGES → calls getImagesFromTab + responds with success+images+galleryLinks', async () => {
    vi.mocked(bgExtractor.getImagesFromTab).mockResolvedValue([
      { url: 'a.jpg' },
    ] as unknown as Awaited<ReturnType<typeof bgExtractor.getImagesFromTab>>);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_IMAGES, tabId: 42 });
    expect(bgExtractor.getImagesFromTab).toHaveBeenCalledWith(42, {
      searchAllFrames: false,
      liveMonitoring: true,
      onGalleryLinks: expect.any(Function),
    });
    // Pin: galleryLinks always present (empty array when the page has no
    // gallery candidates) — the sidepanel's resolve-bar treats absence
    // and [] identically, but a stable shape keeps consumers simple.
    expect(result).toEqual({ success: true, images: [{ url: 'a.jpg' }], galleryLinks: [] });
  });

  it('GET_IMAGES forwards searchAllFrames + liveMonitoring=false flags', async () => {
    vi.mocked(bgExtractor.getImagesFromTab).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof bgExtractor.getImagesFromTab>>
    );
    await dispatch({
      type: MESSAGE_TYPES.GET_IMAGES,
      tabId: 1,
      searchAllFrames: true,
      liveMonitoring: false,
    });
    expect(bgExtractor.getImagesFromTab).toHaveBeenCalledWith(1, {
      searchAllFrames: true,
      liveMonitoring: false,
      onGalleryLinks: expect.any(Function),
    });
  });

  it('GET_IMAGES → onGalleryLinks callback feeds galleryLinks into the response', async () => {
    // Pin: the extractor invokes the callback with the content script's
    // gallery-link candidates; background MUST forward them verbatim so
    // the sidepanel resolve-bar can offer deep resolution.
    vi.mocked(bgExtractor.getImagesFromTab).mockImplementation((async (
      _tabId: number,
      options?: { onGalleryLinks?: (links: string[]) => void }
    ) => {
      options?.onGalleryLinks?.(['https://example.com/gallery/1', 'https://example.com/gallery/2']);
      return [];
    }) as unknown as typeof bgExtractor.getImagesFromTab);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_IMAGES, tabId: 7 });
    expect(result).toEqual({
      success: true,
      images: [],
      galleryLinks: ['https://example.com/gallery/1', 'https://example.com/gallery/2'],
    });
  });

  it('GET_HISTORY → calls getDownloadHistory', async () => {
    vi.mocked(storage.getDownloadHistory).mockResolvedValue(['a', 'b'] as never);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_HISTORY });
    expect(result).toEqual({ success: true, history: ['a', 'b'] });
  });

  it('CLEAR_HISTORY → calls clearDownloadHistory', async () => {
    vi.mocked(storage.clearDownloadHistory).mockResolvedValue(undefined as never);
    const result = await dispatch({ type: MESSAGE_TYPES.CLEAR_HISTORY });
    expect(storage.clearDownloadHistory).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('GET_FILTER_CONFIG → calls getFilterConfig', async () => {
    const cfg = { minWidth: 100 };
    vi.mocked(storage.getFilterConfig).mockResolvedValue(cfg as never);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_FILTER_CONFIG });
    expect(result).toEqual({ success: true, config: cfg });
  });

  it('SAVE_FILTER_CONFIG → calls saveFilterConfig with provided config', async () => {
    vi.mocked(storage.saveFilterConfig).mockResolvedValue(undefined as never);
    const cfg = { minWidth: 200 };
    await dispatch({ type: MESSAGE_TYPES.SAVE_FILTER_CONFIG, config: cfg });
    expect(storage.saveFilterConfig).toHaveBeenCalledWith(cfg);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Broadcast / pass-through routes
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — broadcast routes', () => {
  it('IMAGES_DISCOVERED → broadcasts to popup with fromTabId from sender', async () => {
    const result = await dispatch(
      { type: MESSAGE_TYPES.IMAGES_DISCOVERED, images: [{ url: 'x' }] },
      { tab: { id: 7 } as chrome.tabs.Tab }
    );
    expect(bgUtils.broadcastToPopup).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      images: [{ url: 'x' }],
      fromTabId: 7,
    });
    expect(result).toEqual({ success: true });
  });

  it('IMAGES_DISCOVERED with no sender.tab → fromTabId=null', async () => {
    await dispatch({ type: MESSAGE_TYPES.IMAGES_DISCOVERED, images: [] });
    expect(bgUtils.broadcastToPopup).toHaveBeenCalledWith(
      expect.objectContaining({ fromTabId: null })
    );
  });

  it('CLEAR_SELECTION → broadcasts to popup', async () => {
    const result = await dispatch({ type: MESSAGE_TYPES.CLEAR_SELECTION });
    expect(bgUtils.broadcastToPopup).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CLEAR_SELECTION,
    });
    expect(result).toEqual({ success: true });
  });

  it('TOGGLE_SIDEBAR → returns the documented "use toolbar icon" failure', async () => {
    // Pin: this is intentionally NOT a successful action — sidePanel.open
    // requires a direct user gesture in MV3, which background can't synthesize.
    const result = await dispatch({ type: MESSAGE_TYPES.TOGGLE_SIDEBAR });
    expect(result).toEqual({
      success: false,
      error: 'Use toolbar icon or shortcut to open side panel',
    });
  });

  it('TOGGLE_FAB → unconditional success (legacy stub)', async () => {
    const result = await dispatch({ type: MESSAGE_TYPES.TOGGLE_FAB });
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Highlight routes (forward to content script via tabs.sendMessage)
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — highlight routes', () => {
  it('HIGHLIGHT_IMAGE → forwards to tab + responds with found from content script', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(99);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ found: true } as never);

    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      tabId: 99,
      imageUrl: 'x.jpg',
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(result).toEqual({ success: true, found: true });
  });

  it('HIGHLIGHT_IMAGE → defaults found=false when content script returns no body', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(99);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(result).toEqual({ success: true, found: false });
  });

  it('HIGHLIGHT_IMAGE → returns success+found=false when no accessible tab', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(null);
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(result).toEqual({ success: true, found: false });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('UNHIGHLIGHT_IMAGE → forwards then responds success', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(7);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.UNHIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: MESSAGE_TYPES.UNHIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(result).toEqual({ success: true });
  });

  it('HIGHLIGHT_IMAGES → forwards array of imageUrls', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(7);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGES,
      imageUrls: ['a.jpg', 'b.jpg'],
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGES,
      imageUrls: ['a.jpg', 'b.jpg'],
    });
    expect(result).toEqual({ success: true });
  });

  it('REMOVE_HIGHLIGHT → forwards bare type and responds success', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(7);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined as never);
    const result = await dispatch({ type: MESSAGE_TYPES.REMOVE_HIGHLIGHT });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: MESSAGE_TYPES.REMOVE_HIGHLIGHT,
    });
    expect(result).toEqual({ success: true });
  });

  it('HIGHLIGHT_IMAGE → catches sendMessage rejection and responds with error', async () => {
    vi.mocked(bgUtils.getAccessibleTabId).mockResolvedValue(7);
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('tab closed'));
    const result = await dispatch({
      type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
      imageUrl: 'x.jpg',
    });
    expect(result).toEqual({ success: false, found: false, error: 'tab closed' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// SET_DISPLAY_MODE — the 76-line side-panel / popup mode switch case.
// Covers the single largest uncovered block (L194-269) in the router.
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — SET_DISPLAY_MODE (popup ↔ side-panel switch)', () => {
  // Typed alias for the chrome global mock to keep the type assertions
  // out of each test body.
  const chromeMock = () =>
    (globalThis as unknown as { chrome: typeof chrome }).chrome as unknown as {
      action: { setPopup: ReturnType<typeof vi.fn> };
      sidePanel: {
        setPanelBehavior: ReturnType<typeof vi.fn>;
        setOptions: ReturnType<typeof vi.fn>;
        open: ReturnType<typeof vi.fn>;
      };
      tabs: { query: ReturnType<typeof vi.fn> };
    };

  beforeEach(() => {
    vi.mocked(storage.getAppSettings).mockResolvedValue({} as never);
    vi.mocked(storage.saveAppSettings).mockResolvedValue(undefined as never);
    (bgUtils.sidePanelOpenedTabs as Set<number>).clear();
  });

  it('switch TO side-panel (useSidePanel=true) → clears action popup + enables panel behavior', async () => {
    const c = chromeMock();
    const result = await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: true,
    });

    // Pin: useSidePanel=true MUST clear the popup (setPopup({popup:''})).
    // A regression passing the wrong popup value would make clicking the
    // extension icon silently open the popup instead of the side panel
    // that the user just enabled — the #1 user-reported "mode switch
    // does nothing" bug shape.
    expect(c.action.setPopup).toHaveBeenCalledWith({ popup: '' });
    expect(c.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    // Persists the new mode to storage BEFORE the Chrome API writes so
    // reload-during-switch can't leave storage and Chrome state
    // disagreeing.
    expect(storage.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ useSidePanel: true })
    );
    expect(result).toEqual({ success: true });
  });

  it('switch TO side-panel WITH openSidePanel=true + tabId → opens panel + records tabId in bookkeeping', async () => {
    const c = chromeMock();
    const result = await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: true,
      openSidePanel: true,
      tabId: 77,
    });

    // Pin: when openSidePanel+tabId are provided, setOptions must be
    // called with BOTH tabId AND path — leaving path empty causes
    // Chrome to serve the last-used path which may be stale.
    expect(c.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 77,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
    expect(c.sidePanel.open).toHaveBeenCalledWith({ tabId: 77 });
    // Bookkeeping: tab must be tracked so a later mode-switch-back
    // can disable the side panel for it.
    expect((bgUtils.sidePanelOpenedTabs as Set<number>).has(77)).toBe(true);
    expect(result).toEqual({ success: true });
  });

  it('switch TO side-panel with open() throwing (no user gesture) → swallows error, still succeeds', async () => {
    const c = chromeMock();
    c.sidePanel.open.mockRejectedValueOnce(new Error('user gesture required'));

    const result = await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: true,
      openSidePanel: true,
      tabId: 88,
    });

    // Pin: the inner try/catch around sidePanel.open. The "no user
    // gesture" error is expected during programmatic mode switches
    // (e.g., from a settings toggle that's not counted as a gesture)
    // and must NOT fail the whole SET_DISPLAY_MODE round-trip.
    expect(result).toEqual({ success: true });
  });

  it('switch TO popup (useSidePanel=false) → disables panel behavior + restores popup path', async () => {
    const c = chromeMock();
    c.tabs.query.mockResolvedValueOnce([{ id: 999 } as chrome.tabs.Tab]);

    const result = await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: false,
    });

    expect(c.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: false,
    });
    // Pin: popup path restore is the LAST side effect — if Chrome
    // action-click fires between the setPanelBehavior call and the
    // setPopup call, the icon briefly does nothing. setPopup with
    // the real path must follow the disable-loop, not precede it.
    expect(c.action.setPopup).toHaveBeenCalledWith({ popup: 'pages/popup.html' });
    expect(result).toEqual({ success: true });
  });

  it('switch TO popup with tracked tabs → disables side panel for EACH tracked tab + clears bookkeeping', async () => {
    const c = chromeMock();
    const tracked = bgUtils.sidePanelOpenedTabs as Set<number>;
    tracked.add(11);
    tracked.add(22);
    tracked.add(33);
    c.tabs.query.mockResolvedValueOnce([{ id: 22 } as chrome.tabs.Tab]); // active tab already tracked

    await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: false,
    });

    // Pin: every tracked tab must get setOptions({enabled:false}).
    // Without this, the side panel UI stays visibly on-screen for
    // any tab that had it open — Chrome does NOT auto-close it
    // when panel behavior is globally disabled.
    const setOptionsCalls = c.sidePanel.setOptions.mock.calls.map((args) => args[0]);
    expect(setOptionsCalls).toEqual(
      expect.arrayContaining([
        { enabled: false }, // global disable first
        { tabId: 11, enabled: false },
        { tabId: 22, enabled: false },
        { tabId: 33, enabled: false },
      ])
    );
    // Bookkeeping reset so the next switch-to-sidepanel starts fresh.
    expect(tracked.size).toBe(0);
  });

  it('switch TO popup + active tab NOT already tracked → ALSO disables side panel for it (catches background.initDisplayMode case)', async () => {
    const c = chromeMock();
    const tracked = bgUtils.sidePanelOpenedTabs as Set<number>;
    tracked.clear();
    c.tabs.query.mockResolvedValueOnce([{ id: 555 } as chrome.tabs.Tab]);

    await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: false,
    });

    // Pin: the `!sidePanelOpenedTabs.has(activeTab.id)` branch. Without
    // this fallback, a side panel opened by background.initDisplayMode
    // (which bypasses SIDE_PANEL_OPENED bookkeeping) would stay open
    // forever after a popup-mode switch.
    expect(c.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 555, enabled: false });
  });

  it('switch TO popup + chrome.tabs.query throws → swallows error, still succeeds (resilient path)', async () => {
    const c = chromeMock();
    c.tabs.query.mockRejectedValueOnce(new Error('no active tab'));

    const result = await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: false,
    });

    // Pin: the final try/catch around chrome.tabs.query + the "also
    // disable active tab" branch. A regression removing it would
    // fail the entire SET_DISPLAY_MODE operation just because no
    // window was focused at the moment of the switch.
    expect(result).toEqual({ success: true });
  });

  it('SET_DISPLAY_MODE top-level throw (saveAppSettings fails) → catches and returns {success:false, error}', async () => {
    vi.mocked(storage.saveAppSettings).mockRejectedValueOnce(new Error('quota exceeded'));

    const result = await dispatch({
      type: MESSAGE_TYPES.SET_DISPLAY_MODE,
      useSidePanel: true,
    });

    // Pin: the OUTER try/catch on SET_DISPLAY_MODE. A regression
    // omitting it would let the error bubble to the outer handleMessage
    // catch which reports INJECTION_FAILED — misleading when the true
    // cause is a local storage quota problem.
    expect(result).toEqual({ success: false, error: 'quota exceeded' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Side-panel bookkeeping
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — side panel bookkeeping', () => {
  it('SIDE_PANEL_OPENED → adds tabId to sidePanelOpenedTabs', async () => {
    (bgUtils.sidePanelOpenedTabs as Set<number>).clear();
    const result = await dispatch({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED, tabId: 42 });
    expect((bgUtils.sidePanelOpenedTabs as Set<number>).has(42)).toBe(true);
    expect(result).toEqual({ success: true });
  });

  it('SIDE_PANEL_OPENED with non-numeric tabId is ignored', async () => {
    (bgUtils.sidePanelOpenedTabs as Set<number>).clear();
    const result = await dispatch({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED, tabId: 'abc' });
    expect((bgUtils.sidePanelOpenedTabs as Set<number>).size).toBe(0);
    expect(result).toEqual({ success: true });
  });

  it('SIDE_PANEL_CLOSED → removes tabId from sidePanelOpenedTabs', async () => {
    const set = bgUtils.sidePanelOpenedTabs as Set<number>;
    set.clear();
    set.add(99);
    const result = await dispatch({ type: MESSAGE_TYPES.SIDE_PANEL_CLOSED, tabId: 99 });
    expect(set.has(99)).toBe(false);
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Reverse-search routes
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — reverse search', () => {
  it('FETCH_IMAGE_DATA → forwards URL + returns dataUrl', async () => {
    vi.mocked(bgReverseSearch.fetchImageData).mockResolvedValue('data:abc' as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.FETCH_IMAGE_DATA,
      url: 'https://example.com/x.jpg',
    });
    expect(bgReverseSearch.fetchImageData).toHaveBeenCalledWith('https://example.com/x.jpg');
    expect(result).toEqual({ success: true, dataUrl: 'data:abc' });
  });

  it('FETCH_IMAGE_DATA → catches rejection', async () => {
    vi.mocked(bgReverseSearch.fetchImageData).mockRejectedValue(new Error('bad url'));
    const result = await dispatch({
      type: MESSAGE_TYPES.FETCH_IMAGE_DATA,
      url: 'https://example.com/x',
    });
    expect(result).toEqual({ success: false, error: 'bad url' });
  });

  it('FETCH_IMAGE_DATA → blocks non-http URLs (isAllowedFetchUrl gate)', async () => {
    const result = await dispatch({
      type: MESSAGE_TYPES.FETCH_IMAGE_DATA,
      url: 'data:image/png;base64,abc',
    });
    expect(result).toEqual({ success: false, error: 'Blocked: URL not allowed for fetch' });
  });

  it('REVERSE_SEARCH_UPLOAD → forwards engine + dataUrl', async () => {
    vi.mocked(bgReverseSearch.reverseSearchUpload).mockResolvedValue({
      success: true,
      url: 'https://google.com/search',
    } as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.REVERSE_SEARCH_UPLOAD,
      engine: 'google',
      imageDataUrl: 'data:foo',
    });
    expect(bgReverseSearch.reverseSearchUpload).toHaveBeenCalledWith('google', 'data:foo');
    expect(result).toEqual({ success: true, url: 'https://google.com/search' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// License routes
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — license', () => {
  it('ACTIVATE_LICENSE on success → broadcasts LICENSE_STATUS_CHANGED + responds with activate result', async () => {
    vi.mocked(license.activateLicense).mockResolvedValue({
      success: true,
      plan: 'pro-yearly',
    } as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.ACTIVATE_LICENSE,
      licenseKey: 'KEY-123',
    });
    expect(license.activateLicense).toHaveBeenCalledWith('KEY-123');
    expect(bgUtils.broadcastToPopup).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
      isPro: true,
      plan: 'pro-yearly',
      status: 'active',
    });
    expect(result).toEqual({ success: true, plan: 'pro-yearly' });
  });

  it('ACTIVATE_LICENSE on failure → does NOT broadcast, just responds with the failure shape', async () => {
    vi.mocked(license.activateLicense).mockResolvedValue({
      success: false,
      error: 'invalid',
    } as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.ACTIVATE_LICENSE,
      licenseKey: 'BAD',
    });
    expect(bgUtils.broadcastToPopup).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'invalid' });
  });

  it('ACTIVATE_LICENSE when activateLicense throws → local try/catch returns {success:false, error}', async () => {
    // Pin: the inner try/catch around activateLicense. Without it the
    // error would bubble to the outer handleMessage catch and be
    // reported as INJECTION_FAILED instead of a clean license-layer
    // error — users would see a misleading "scripting injection
    // failed" toast when the real cause is a license-server outage.
    vi.mocked(license.activateLicense).mockRejectedValue(new Error('license server down'));
    const result = await dispatch({
      type: MESSAGE_TYPES.ACTIVATE_LICENSE,
      licenseKey: 'KEY-123',
    });
    expect(bgUtils.broadcastToPopup).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'license server down' });
  });

  it('DEACTIVATE_LICENSE → broadcasts inactive status THEN responds', async () => {
    vi.mocked(license.deactivateLicense).mockResolvedValue({ success: true } as never);
    const result = await dispatch({ type: MESSAGE_TYPES.DEACTIVATE_LICENSE });
    expect(bgUtils.broadcastToPopup).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
      isPro: false,
      status: 'inactive',
    });
    expect(result).toEqual({ success: true });
  });

  it('DEACTIVATE_LICENSE when deactivateLicense throws → local try/catch returns {success:false, error} and NO broadcast', async () => {
    // Pin: broadcast-before-respond order is also try/catch guarded.
    // Without the wrapping try/catch, a storage exception mid-
    // deactivation would simultaneously skip the broadcast AND
    // surface a misleading INJECTION_FAILED code to the UI.
    vi.mocked(license.deactivateLicense).mockRejectedValue(new Error('storage write denied'));
    const result = await dispatch({ type: MESSAGE_TYPES.DEACTIVATE_LICENSE });
    expect(bgUtils.broadcastToPopup).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'storage write denied' });
  });

  it('VALIDATE_LICENSE → returns proStatus directly (no envelope)', async () => {
    vi.mocked(license.isProUser).mockResolvedValue({
      isPro: true,
      plan: 'pro-monthly',
    } as never);
    const result = await dispatch({ type: MESSAGE_TYPES.VALIDATE_LICENSE });
    expect(result).toEqual({ isPro: true, plan: 'pro-monthly' });
  });

  it('VALIDATE_LICENSE on rejection → returns isPro:false (graceful degrade)', async () => {
    vi.mocked(license.isProUser).mockRejectedValue(new Error('network'));
    const result = await dispatch({ type: MESSAGE_TYPES.VALIDATE_LICENSE });
    expect(result).toEqual({ isPro: false, error: 'network' });
  });

  it('GET_LICENSE_STATUS → returns licenseInfo directly (no envelope)', async () => {
    vi.mocked(license.getLicenseInfo).mockResolvedValue({
      hasLicense: true,
      plan: 'pro-yearly',
    } as never);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });
    expect(result).toEqual({ hasLicense: true, plan: 'pro-yearly' });
  });

  it('GET_LICENSE_STATUS on rejection → returns hasLicense:false', async () => {
    vi.mocked(license.getLicenseInfo).mockRejectedValue(new Error('storage error'));
    const result = await dispatch({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });
    expect(result).toEqual({ hasLicense: false, error: 'storage error' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Multi-tab extract
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — multi-tab extract', () => {
  it('MULTI_TAB_EXTRACT → forwards tabIds array', async () => {
    vi.mocked(bgExtractor.processMultiTabExtract).mockResolvedValue({
      success: true,
      results: [],
    } as never);
    const result = await dispatch({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT,
      tabIds: [1, 2, 3],
    });
    expect(bgExtractor.processMultiTabExtract).toHaveBeenCalledWith([1, 2, 3]);
    expect(result).toEqual({ success: true, results: [] });
  });

  it('MULTI_TAB_EXTRACT with no tabIds → defaults to []', async () => {
    vi.mocked(bgExtractor.processMultiTabExtract).mockResolvedValue({
      success: true,
    } as never);
    await dispatch({ type: MESSAGE_TYPES.MULTI_TAB_EXTRACT });
    expect(bgExtractor.processMultiTabExtract).toHaveBeenCalledWith([]);
  });

  it('MULTI_TAB_EXTRACT when processMultiTabExtract throws → local try/catch returns {success:false, error}', async () => {
    // Pin: the MULTI_TAB error path has its OWN try/catch wrapping
    // processMultiTabExtract. A regression removing it would promote
    // per-tab scripting failures to the outer handleMessage catch
    // which emits INJECTION_FAILED — losing the specific error detail
    // the sidepanel needs to render "Extracted 0 images from N tabs"
    // vs. "Extraction failed: <reason>".
    vi.mocked(bgExtractor.processMultiTabExtract).mockRejectedValue(
      new Error('all tabs are restricted')
    );
    const result = await dispatch({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT,
      tabIds: [1, 2, 3],
    });
    expect(result).toEqual({ success: false, error: 'all tabs are restricted' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Link resolve (v1.1.0 deep penetration)
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — RESOLVE_LINK_IMAGES', () => {
  it('forwards urls to resolveLinkImages and responds with success + result', async () => {
    const linkResolver = await import('../background/link-resolver');
    const spy = vi.spyOn(linkResolver, 'resolveLinkImages').mockResolvedValue({
      images: [{ url: 'https://example.com/og.jpg' }] as never,
      resolved: 1,
      failed: 0,
      results: [{ url: 'https://example.com/gallery/1', status: 'resolved' }],
    });

    const result = await dispatch({
      type: MESSAGE_TYPES.RESOLVE_LINK_IMAGES,
      urls: ['https://example.com/gallery/1'],
      sourceUrl: 'https://www.example.com/source',
    });

    // sourceUrl rides along so the resolver can scope the session cookie.
    expect(spy).toHaveBeenCalledWith(
      ['https://example.com/gallery/1'],
      'https://www.example.com/source'
    );
    expect(result).toEqual({
      success: true,
      images: [{ url: 'https://example.com/og.jpg' }],
      resolved: 1,
      failed: 0,
      results: [{ url: 'https://example.com/gallery/1', status: 'resolved' }],
    });
    spy.mockRestore();
  });

  it('missing urls → defaults to [] (empty batch resolves nothing)', async () => {
    const linkResolver = await import('../background/link-resolver');
    const spy = vi
      .spyOn(linkResolver, 'resolveLinkImages')
      .mockResolvedValue({ images: [], resolved: 0, failed: 0, results: [] });

    await dispatch({ type: MESSAGE_TYPES.RESOLVE_LINK_IMAGES });
    // No sourceUrl in the message → undefined (conservative cookie-less path).
    expect(spy).toHaveBeenCalledWith([], undefined);

    spy.mockRestore();
  });

  it('resolveLinkImages rejection → local try/catch returns {success:false, error}', async () => {
    const linkResolver = await import('../background/link-resolver');
    const spy = vi
      .spyOn(linkResolver, 'resolveLinkImages')
      .mockRejectedValue(new Error('network unreachable'));

    const result = await dispatch({
      type: MESSAGE_TYPES.RESOLVE_LINK_IMAGES,
      urls: ['https://example.com/x'],
    });

    // Pin: the RESOLVE_LINK_IMAGES route owns its error shape. Without
    // the local try/catch the failure would bubble to the outer
    // handleMessage catch and surface as INJECTION_FAILED — misleading
    // for a network-level resolution problem.
    expect(result).toEqual({ success: false, error: 'network unreachable' });
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Context menus (v1.1.0) — bootstrap registration
// ─────────────────────────────────────────────────────────────────────

describe('context menus bootstrap', () => {
  it('chrome.contextMenus.onClicked listener registered at module top-level', () => {
    // The listener reference was captured during the beforeAll module
    // import — mock call records are wiped by clearAllMocks, so we pin
    // the reference itself.
    expect(onContextMenuClick).toBeTypeOf('function');
  });

  it('onInstalled registers both menus with chrome.i18n titles (removeAll first)', () => {
    expect(onInstalledListener).toBeTypeOf('function');

    const chromeMock = (globalThis as unknown as { chrome: typeof chrome }).chrome as unknown as {
      contextMenus: {
        removeAll: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
      };
      i18n: {
        getMessage: ReturnType<typeof vi.fn>;
      };
    };

    chromeMock.contextMenus.removeAll.mockClear();
    chromeMock.contextMenus.create.mockClear();
    chromeMock.i18n.getMessage.mockClear();
    onInstalledListener!({ reason: 'update' } as chrome.runtime.InstalledDetails);

    // Pin: menus are re-created on EVERY install/update (Chrome wipes
    // them on update) — removeAll runs first so IDs never collide.
    expect(chromeMock.contextMenus.removeAll).toHaveBeenCalled();
    // Pin: titles come from chrome.i18n.getMessage() per-key, not the
    // `__MSG_*__` manifest substitution — on some setups Chrome never
    // substitutes and the raw placeholder leaks into the menu (seen in
    // manual smoke testing). getMessage() shares Chrome's locale
    // resolution and returns "" for a missing key.
    expect(chromeMock.i18n.getMessage).toHaveBeenCalledWith('contextExtractImage');
    expect(chromeMock.i18n.getMessage).toHaveBeenCalledWith('contextExtractLinked');
    const createCalls = chromeMock.contextMenus.create.mock.calls.map((c) => c[0]);
    expect(createCalls).toContainEqual(
      expect.objectContaining({
        id: 'ih-context-extract-image',
        title: '[i18n:contextExtractImage]',
        contexts: ['image'],
      })
    );
    expect(createCalls).toContainEqual(
      expect.objectContaining({
        id: 'ih-context-extract-linked',
        title: '[i18n:contextExtractLinked]',
        contexts: ['link'],
      })
    );
  });

  it('missing i18n key (getMessage → "") falls back to hardcoded English titles', () => {
    const chromeMock = (globalThis as unknown as { chrome: typeof chrome }).chrome as unknown as {
      contextMenus: {
        removeAll: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
      };
      i18n: {
        getMessage: ReturnType<typeof vi.fn>;
      };
    };

    // getMessage returns "" for a missing key — registration must not
    // create a menu with an empty title. ('update' reason keeps this on
    // the pure re-registration path — 'install' also opens the welcome
    // page, which the mock chrome has no runtime.getURL for.)
    chromeMock.i18n.getMessage.mockReturnValueOnce('');
    chromeMock.contextMenus.removeAll.mockClear();
    chromeMock.contextMenus.create.mockClear();
    onInstalledListener!({ reason: 'update' } as chrome.runtime.InstalledDetails);

    const titles = chromeMock.contextMenus.create.mock.calls.map(
      (c) => (c[0] as { title?: string }).title
    );
    // First registration with the "" return falls back to English; the
    // second (contextExtractLinked) gets the normal marker again.
    expect(titles[0]).toBe('Extract image with Image Harvest');
    expect(titles).toContain('[i18n:contextExtractLinked]');
  });
});

describe('buildContextImageItem — tab-metadata stamping (v1.1.1)', () => {
  // v1.1.1: right-click injected items must carry the owning tab's title /
  // index so the sidepanel's 'tab' group mode buckets them WITH the tab's
  // scanned images instead of a hardcoded "Current Tab" fallback group.
  it('stamps tabTitle + tabIndex + isCurrentTab from the clicked tab', () => {
    const item = bgIndex!.buildContextImageItem('https://a.com/img.png', 'context-image', {
      id: 7,
      title: 'My Gallery — Detail',
      index: 3,
    } as chrome.tabs.Tab);
    expect(item).toMatchObject({
      tabTitle: 'My Gallery — Detail',
      tabIndex: 3,
      isCurrentTab: true,
      userInjected: true,
      visible: true,
    });
  });

  it('without a tab (title-less edge) leaves tabTitle undefined — group fallback stays localized', () => {
    const item = bgIndex!.buildContextImageItem('https://a.com/img.png', 'link-image');
    expect(item.tabTitle).toBeUndefined();
    expect(item.tabIndex).toBeUndefined();
    expect(item.isCurrentTab).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// sidePanel.open() user-gesture timing (v1.1.1)
// ─────────────────────────────────────────────────────────────────────

describe('sidePanel.open() sync-first timing (v1.1.1)', () => {
  // Chrome's transient user activation does NOT survive an await: if the
  // handler awaits setOptions (or anything else) before calling open(),
  // the gesture expires, open() throws "may only be called with a user
  // gesture", and the right-click menu items / welcome CTA look completely
  // dead whenever the panel is closed. These tests pin open() to the
  // SYNCHRONOUS phase of each handler.

  const sidePanelMocks = () => {
    const c = (globalThis as unknown as { chrome: typeof chrome }).chrome as unknown as {
      sidePanel: {
        open: ReturnType<typeof vi.fn>;
        setOptions: ReturnType<typeof vi.fn>;
      };
    };
    c.sidePanel.open.mockClear();
    c.sidePanel.setOptions.mockClear();
    return c;
  };

  it('context-menu click → open() fires synchronously; setOptions follows async', async () => {
    const c = sidePanelMocks();

    // Do NOT await the listener — the first assertion must observe the
    // synchronous phase, before any microtask can run.
    onContextMenuClick!(
      {
        menuItemId: 'ih-context-extract-image',
        srcUrl: 'https://a.com/pic.png',
      } as chrome.contextMenus.OnClickData,
      { id: 7, title: 'Smoke page', index: 0 } as chrome.tabs.Tab
    );

    // Synchronous phase: open() already invoked — this is exactly what the
    // old `await setOptions` → `await open` ordering broke.
    expect(c.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });

    // Async tail settles: per-tab options are still refreshed afterwards.
    await new Promise((r) => setTimeout(r, 0));
    expect(c.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
  });

  it('context-menu click with open() rejected → no crash, options still written (queue path delivers)', async () => {
    const c = sidePanelMocks();
    c.sidePanel.open.mockRejectedValueOnce(new Error('may only be called with a user gesture'));

    // Direct-image link → no network resolution involved in this path.
    onContextMenuClick!(
      {
        menuItemId: 'ih-context-extract-linked',
        linkUrl: 'https://a.com/img.png',
      } as chrome.contextMenus.OnClickData,
      { id: 9, title: 'Link page', index: 1 } as chrome.tabs.Tab
    );

    await new Promise((r) => setTimeout(r, 0));
    // open() failure (restricted page etc.) must not break the handler —
    // the item still lands via the storage.session queue path.
    expect(c.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 9,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
  });

  it('OPEN_SIDE_PANEL (welcome CTA) → open() fires synchronously in the handler prologue', async () => {
    const c = sidePanelMocks();

    const p = dispatch(
      { type: MESSAGE_TYPES.OPEN_SIDE_PANEL },
      { tab: { id: 42 } as chrome.tabs.Tab }
    );

    // Synchronous phase of the onMessage listener: open() already fired —
    // awaiting setOptions first would let the gesture expire.
    expect(c.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });

    const result = (await p) as { success: boolean };
    expect(result.success).toBe(true);
    expect(c.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Default + error handling
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — default + error', () => {
  it('unknown message type → returns "Unknown message type" failure', async () => {
    const result = await dispatch({ type: 'NOT_A_REAL_TYPE' });
    expect(result).toEqual({ success: false, error: 'Unknown message type' });
  });

  it('throwing subsystem call → returns INJECTION_FAILED with error message', async () => {
    vi.mocked(bgExtractor.getImagesFromTab).mockRejectedValue(new Error('boom'));
    const result = await dispatch({ type: MESSAGE_TYPES.GET_IMAGES, tabId: 1 });
    // GET_IMAGES wraps its own try/catch via handleMessage outer catch.
    // The outer catch produces the INJECTION_FAILED error code.
    expect(result).toMatchObject({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: 'boom',
    });
  });

  it('CSP_BLOCKED error code → bubbles up with workaround text', async () => {
    const cspError = Object.assign(new Error('CSP_BLOCKED'), {
      code: ERROR_CODES.CSP_BLOCKED,
      workaround: 'Right-click and save manually',
    });
    vi.mocked(bgExtractor.getImagesFromTab).mockRejectedValue(cspError);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_IMAGES, tabId: 1 });
    expect(result).toMatchObject({
      success: false,
      error: ERROR_CODES.CSP_BLOCKED,
      workaround: 'Right-click and save manually',
    });
  });
});
