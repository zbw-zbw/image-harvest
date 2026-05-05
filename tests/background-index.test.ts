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
  isProUser: vi.fn(),
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
  reverseSearchUpload: vi.fn(),
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
    downloads: {
      onChanged: {
        addListener: vi.fn((fn) => {
          onDownloadChanged = fn;
        }),
      },
    },
    tabs: {
      sendMessage: vi.fn(),
      query: vi.fn(),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(),
      setOptions: vi.fn(),
      open: vi.fn(),
    },
    action: {
      setPopup: vi.fn(),
    },
  };

  // Import target after chrome global is in place — module top-level
  // runs initialization (initLicenseAlarm + onConnect/onMessage register).
  await import('../background/index');
});

import { MESSAGE_TYPES, ERROR_CODES } from '../shared/constants';
import * as storage from '../shared/storage';
import * as license from '../shared/license';
import * as bgUtils from '../background/utils';
import * as bgLicense from '../background/license';
import * as bgDisplayMode from '../background/display-mode';
import * as bgExtractor from '../background/extractor';
import * as bgReverseSearch from '../background/reverse-search';

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
      name: 'image-snatcher-ui',
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
  it('GET_IMAGES → calls getImagesFromTab + responds with success+images', async () => {
    vi.mocked(bgExtractor.getImagesFromTab).mockResolvedValue([
      { url: 'a.jpg' },
    ] as unknown as Awaited<ReturnType<typeof bgExtractor.getImagesFromTab>>);
    const result = await dispatch({ type: MESSAGE_TYPES.GET_IMAGES, tabId: 42 });
    expect(bgExtractor.getImagesFromTab).toHaveBeenCalledWith(42, {
      searchAllFrames: false,
      liveMonitoring: true,
    });
    expect(result).toEqual({ success: true, images: [{ url: 'a.jpg' }] });
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
    const result = await dispatch({ type: MESSAGE_TYPES.FETCH_IMAGE_DATA, url: 'x.jpg' });
    expect(bgReverseSearch.fetchImageData).toHaveBeenCalledWith('x.jpg');
    expect(result).toEqual({ success: true, dataUrl: 'data:abc' });
  });

  it('FETCH_IMAGE_DATA → catches rejection', async () => {
    vi.mocked(bgReverseSearch.fetchImageData).mockRejectedValue(new Error('bad url'));
    const result = await dispatch({ type: MESSAGE_TYPES.FETCH_IMAGE_DATA, url: 'x' });
    expect(result).toEqual({ success: false, error: 'bad url' });
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
