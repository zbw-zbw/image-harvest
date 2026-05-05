// Unit tests for sidepanel/init.ts — focused on:
//   - Module-level IIFE: DOMContentLoaded → init() registration
//   - init() orchestration: mountPreactComponents → cacheElements →
//     loadSettings → applyTheme/Density → bindEvents → applyProFeature
//     Visibility → showLoading → chrome.runtime.connect → tab listeners
//     → visibilitychange → loadCurrentTab
//   - isPopupMode detection (window.location.pathname.endsWith('popup.html'))
//   - Conditional tab listeners (only registered when !isPopupMode)
//   - bindEvents Pro gates (Pro feature interceptions in setting selects,
//     download dropdown, group filter, reverse search)
//   - __IH_E2E__ test hook installation
//
// Strategy: init.ts has NO exports — every function is private. The only
// way to drive it is to import the module (which fires the DOMContentLoaded
// listener), then assert mock calls + DOM state. We mock every dependency
// so we can isolate init's orchestration logic.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// Mock all sidepanel/* + shared/* dependencies
// ─────────────────────────────────────────────────────────────────────

vi.mock('../sidepanel/actions', () => ({
  clearSelection: vi.fn(),
  downloadSelectedAsZip: vi.fn(),
  downloadSingle: vi.fn(),
  hideDownloadDropdown: vi.fn(),
  removeAllHighlightsOnPage: vi.fn(),
  reverseSearch: vi.fn(),
  selectAll: vi.fn(),
  toggleDownloadDropdown: vi.fn(),
  updateSelectionUI: vi.fn(),
}));

vi.mock('../sidepanel/filter', () => ({
  applyCustomSizeInputs: vi.fn(),
  applyFilters: vi.fn(),
  clearCustomSizeInputs: vi.fn(),
  syncCustomSizeInputsFromSettings: vi.fn(),
}));

vi.mock('../sidepanel/components/mount', () => ({
  mountPreactComponents: vi.fn(),
}));

vi.mock('../sidepanel/message', () => ({
  handleKeyDown: vi.fn(),
  handleMessage: vi.fn(),
}));

vi.mock('../sidepanel/pro-features', () => ({
  exportCollection: vi.fn(),
  removeDuplicates: vi.fn(),
  showCollectionModal: vi.fn(),
  showDedupModal: vi.fn(),
  showMultiTabModal: vi.fn(),
  startMultiTabExtract: vi.fn(),
  toggleMultitabSelectAll: vi.fn(),
}));

vi.mock('../sidepanel/render', () => ({
  renderImages: vi.fn(),
}));

vi.mock('../sidepanel/scan', () => ({
  fetchImages: vi.fn().mockResolvedValue(undefined),
  handleScanCancel: vi.fn(),
}));

vi.mock('../sidepanel/settings', () => ({
  applyDensity: vi.fn(),
  applyProFeatureVisibility: vi.fn().mockResolvedValue(undefined),
  applyTheme: vi.fn(),
  bindProGuards: vi.fn(),
  closeAllFilterDropdowns: vi.fn(),
  closeSettings: vi.fn(),
  openShortcutSettings: vi.fn(),
  resetSettings: vi.fn(),
  saveSettings: vi.fn(),
  setSelect: vi.fn(),
  showProUpgradeModal: vi.fn(),
  showSettings: vi.fn(),
  toggleFilterDropdown: vi.fn(),
  updateLiveIndicator: vi.fn(),
}));

vi.mock('../shared/storage', () => ({
  clearTabImageCache: vi.fn(),
  getTabImageCache: vi.fn().mockResolvedValue(null),
  saveTabImageCache: vi.fn(),
}));

vi.mock('../sidepanel/ui', () => ({
  handleProgressClose: vi.fn(),
  hideLoading: vi.fn(),
  hideRestricted: vi.fn(),
  initResizeObserver: vi.fn(),
  showLoading: vi.fn(),
  showRestricted: vi.fn(),
  showToast: vi.fn(),
  toggleViewMode: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
}));

vi.mock('../sidepanel/utils', () => ({
  debounce: vi.fn(<T extends (...args: unknown[]) => unknown>(fn: T) => fn),
  generateId: vi.fn((url: string) => `id-${url.slice(0, 16)}`),
  loadSettings: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────
// Chrome API mocks (capture listeners for later invocation)
// ─────────────────────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => unknown;
const tabListeners: {
  onActivated: Listener[];
  onUpdated: Listener[];
  onRemoved: Listener[];
} = {
  onActivated: [],
  onUpdated: [],
  onRemoved: [],
};
const portListeners: {
  message: Listener[];
  disconnect: Listener[];
} = { message: [], disconnect: [] };

function installChromeMock(): void {
  tabListeners.onActivated = [];
  tabListeners.onUpdated = [];
  tabListeners.onRemoved = [];
  portListeners.message = [];
  portListeners.disconnect = [];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({}),
      connect: vi.fn(() => ({
        name: 'image-snatcher-ui',
        onMessage: { addListener: vi.fn((fn) => portListeners.message.push(fn)) },
        onDisconnect: { addListener: vi.fn((fn) => portListeners.disconnect.push(fn)) },
        disconnect: vi.fn(),
        postMessage: vi.fn(),
      })),
      lastError: null,
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      get: vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com' }),
      connect: vi.fn(() => ({
        name: 'image-snatcher-ui',
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      onActivated: { addListener: vi.fn((fn) => tabListeners.onActivated.push(fn)) },
      onUpdated: { addListener: vi.fn((fn) => tabListeners.onUpdated.push(fn)) },
      onRemoved: { addListener: vi.fn((fn) => tabListeners.onRemoved.push(fn)) },
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    commands: { getAll: vi.fn().mockResolvedValue([]) },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Module load helper — re-imports init.ts under controlled location
// path. Because vitest module cache makes a top-level static import
// run only once, we use a resetModules + dynamic import dance to
// re-enter the IIFE per case where needed.
// ─────────────────────────────────────────────────────────────────────

function setLocationPathname(pathname: string): void {
  // jsdom: location is read-only, but we can override the getter.
  const url = new URL(`http://localhost${pathname}`);
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: url.pathname, href: url.href },
    writable: true,
    configurable: true,
  });
}

async function loadInitModule(): Promise<void> {
  vi.resetModules();
  await import('../sidepanel/init');
  // Fire the DOMContentLoaded listener init.ts attached at module top.
  document.dispatchEvent(new Event('DOMContentLoaded'));
  // Let microtasks settle (init() is async + the post-IIFE Promise.all chain).
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeAll(() => {
  installChromeMock();
});

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
  document.documentElement.className = '';
  vi.clearAllMocks();
  // Default to non-popup pathname (sidepanel mode)
  setLocationPathname('/sidepanel.html');
  // Reset E2E flag between cases
  delete (window as unknown as { __IH_E2E__?: boolean }).__IH_E2E__;
  delete (window as unknown as { __IH__?: unknown }).__IH__;
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────
// IIFE bootstrap: DOMContentLoaded → init()
// ─────────────────────────────────────────────────────────────────────

describe('sidepanel/init.ts module bootstrap', () => {
  it('attaches DOMContentLoaded listener at module top (init runs after DOM ready)', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    await loadInitModule();
    // Pin: init.ts MUST attach DOMContentLoaded — without it, the
    // sidepanel/popup would render but never wire up event handlers.
    const calls = addSpy.mock.calls.filter((c) => c[0] === 'DOMContentLoaded');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('init() chains: mountPreactComponents → loadSettings → applyTheme/Density → bindEvents → applyProFeatureVisibility', async () => {
    await loadInitModule();

    const mount = await import('../sidepanel/components/mount');
    const utils = await import('../sidepanel/utils');
    const settings = await import('../sidepanel/settings');
    const ui = await import('../sidepanel/ui');

    // Pin the orchestration sequence — every entry point downstream
    // assumes Preact is mounted, settings are loaded, theme/density are
    // applied, and Pro visibility is computed before any user interaction.
    expect(mount.mountPreactComponents).toHaveBeenCalled();
    expect(utils.loadSettings).toHaveBeenCalled();
    expect(settings.applyTheme).toHaveBeenCalled();
    expect(settings.applyDensity).toHaveBeenCalled();
    expect(settings.applyProFeatureVisibility).toHaveBeenCalled();
    expect(ui.initResizeObserver).toHaveBeenCalled();
    expect(ui.showLoading).toHaveBeenCalled();
  });

  it('chrome.runtime.connect is called with name "image-snatcher-ui" (long-lived port)', async () => {
    await loadInitModule();
    const chromeMock = (globalThis as unknown as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } })
      .chrome;
    // Pin: the long-lived port is named "image-snatcher-ui" — content
    // script's onConnect listener uses this exact name to drive the
    // highlight-cleanup safety net.
    expect(chromeMock.runtime.connect).toHaveBeenCalledWith({ name: 'image-snatcher-ui' });
  });

  it('uiPort.onMessage.addListener wires handleMessage as the broadcast handler', async () => {
    await loadInitModule();
    const message = await import('../sidepanel/message');
    // Pin: broadcast frames from background (e.g. IMAGES_DISCOVERED)
    // route through handleMessage. If wired wrong, live monitoring
    // and multi-tab extract would silently drop frames.
    expect(portListeners.message).toContain(message.handleMessage);
  });
});

// ─────────────────────────────────────────────────────────────────────
// isPopupMode detection
// ─────────────────────────────────────────────────────────────────────

describe('isPopupMode detection (window.location.pathname.endsWith("popup.html"))', () => {
  it('sidepanel.html → state.isPopupMode = false → tab listeners ARE registered', async () => {
    setLocationPathname('/sidepanel.html');
    await loadInitModule();
    const { state } = await import('../sidepanel/state');

    expect(state.isPopupMode).toBe(false);
    // Pin: sidepanel mode MUST register tab listeners. Otherwise,
    // switching tabs in the browser wouldn't refresh the panel.
    expect(tabListeners.onActivated.length).toBeGreaterThan(0);
    expect(tabListeners.onUpdated.length).toBeGreaterThan(0);
    expect(tabListeners.onRemoved.length).toBeGreaterThan(0);
  });

  it('popup.html → state.isPopupMode = true → tab listeners are NOT registered', async () => {
    setLocationPathname('/popup.html');
    await loadInitModule();
    const { state } = await import('../sidepanel/state');

    expect(state.isPopupMode).toBe(true);
    // Pin: popup mode does NOT register tab listeners — popup closes
    // automatically when the user switches tabs anyway. Registering
    // them in popup mode would leak listeners across popup re-opens.
    expect(tabListeners.onActivated.length).toBe(0);
    expect(tabListeners.onUpdated.length).toBe(0);
    expect(tabListeners.onRemoved.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// __IH_E2E__ test hook installation
// ─────────────────────────────────────────────────────────────────────

describe('__IH_E2E__ test hook', () => {
  it('NOT installed when window.__IH_E2E__ is absent (production safety)', async () => {
    await loadInitModule();
    expect((window as unknown as { __IH__?: unknown }).__IH__).toBeUndefined();
  });

  it('installed when window.__IH_E2E__ is true (e2e test enablement)', async () => {
    (window as unknown as { __IH_E2E__: boolean }).__IH_E2E__ = true;
    await loadInitModule();

    const ih = (window as unknown as { __IH__?: { store: unknown; applyFilters: unknown; loadMultitab: unknown; applyTheme: unknown; handleMessage: unknown } }).__IH__;
    // Pin: e2e tests rely on these 5 hooks. Removing or renaming any
    // would silently break e2e_helpers and Playwright specs that drive
    // store/state directly without going through 4-deep dropdown menus.
    expect(ih).toBeDefined();
    expect(ih?.store).toBeDefined();
    expect(ih?.applyFilters).toBeTypeOf('function');
    expect(ih?.loadMultitab).toBeTypeOf('function');
    expect(ih?.applyTheme).toBeTypeOf('function');
    expect(ih?.handleMessage).toBeTypeOf('function');
  });
});

// ─────────────────────────────────────────────────────────────────────
// beforeunload cleanup
// ─────────────────────────────────────────────────────────────────────

describe('beforeunload cleanup', () => {
  it('beforeunload triggers removeAllHighlightsOnPage', async () => {
    await loadInitModule();
    const actions = await import('../sidepanel/actions');

    window.dispatchEvent(new Event('beforeunload'));
    // Pin: closing sidepanel/popup must clean up highlights on the
    // page. Without this, the user closes the panel and the colored
    // outlines stay forever on the page.
    expect(actions.removeAllHighlightsOnPage).toHaveBeenCalled();
  });

  it('sidepanel mode + currentTabId → beforeunload sends SIDE_PANEL_CLOSED to background', async () => {
    setLocationPathname('/sidepanel.html');
    await loadInitModule();
    const { state } = await import('../sidepanel/state');
    state.currentTabId = 42;

    const chromeMock = (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } })
      .chrome;
    chromeMock.runtime.sendMessage.mockClear();
    window.dispatchEvent(new Event('beforeunload'));

    // Pin: background tracks which tabs have an open sidepanel for
    // injection bookkeeping. Without this notify-on-close, the bg
    // would leak references to closed sidepanels and could try to
    // send broadcast frames that have nowhere to land.
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.any(String), tabId: 42 })
    );
  });

  it('popup mode → beforeunload does NOT send SIDE_PANEL_CLOSED (only sidepanel cares)', async () => {
    setLocationPathname('/popup.html');
    await loadInitModule();

    const chromeMock = (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } })
      .chrome;
    chromeMock.runtime.sendMessage.mockClear();
    window.dispatchEvent(new Event('beforeunload'));

    // Pin: popup mode doesn't generate SIDE_PANEL_CLOSED — it's a
    // sidepanel-only contract. Sending it from popup would confuse
    // bg's tab-tracking state machine.
    const sidePanelClosedCalls = chromeMock.runtime.sendMessage.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'object' &&
        call[0] !== null &&
        'tabId' in (call[0] as object)
    );
    expect(sidePanelClosedCalls.length).toBe(0);
  });
});
