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
import {
  installChromeMock,
  type PortListenerBuckets,
  type TabListenerBuckets,
} from './_helpers/chromeApiMock';

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
  applyFileSizeInputs: vi.fn(),
  applyFileSizePreset: vi.fn(),
  applyFilters: vi.fn(),
  clearCustomSizeInputs: vi.fn(),
  syncCustomSizeInputsFromSettings: vi.fn(),
}));

// v1.2 filter_applied telemetry assertions spy on this mock.
vi.mock('../shared/telemetry', () => ({
  flushNow: vi.fn().mockResolvedValue(undefined),
  setEnvelopeMeta: vi.fn(),
  track: vi.fn().mockResolvedValue(undefined),
}));

import { track } from '../shared/telemetry';

const mockTrack = vi.mocked(track);

vi.mock('../sidepanel/components/mount', () => ({
  mountPreactComponents: vi.fn(),
}));

vi.mock('../sidepanel/message', () => ({
  cancelDiscoveredToast: vi.fn(),
  handleKeyDown: vi.fn(),
  handleMessage: vi.fn(),
}));

vi.mock('../sidepanel/injected-items', () => ({
  // v1.1.0: drains right-click-injected items queued in storage.session
  // while the panel was closed, then restores persisted injected items.
  // Mock-resolved so init() never blocks.
  drainPendingContextItems: vi.fn().mockResolvedValue(undefined),
  restoreInjectedItems: vi.fn().mockResolvedValue(undefined),
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
  processImageExtras: vi.fn().mockResolvedValue(undefined),
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
  applyTranslations: vi.fn(),
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
//
// Shared buckets are reset in-place on every installChromeMock() call
// (see tests/_helpers/chromeApiMock.ts), so passing the same object
// across a beforeEach is safe.
// ─────────────────────────────────────────────────────────────────────

const tabListeners: TabListenerBuckets = {
  onActivated: [],
  onUpdated: [],
  onRemoved: [],
};
const portListeners: PortListenerBuckets = {
  message: [],
  disconnect: [],
};

function installMock(): void {
  installChromeMock({
    captureTabListeners: tabListeners,
    capturePortListeners: portListeners,
  });
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
  installMock();
});

beforeEach(() => {
  installMock();
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

  it('chrome.runtime.connect is called with name "image-harvest-ui" (long-lived port)', async () => {
    await loadInitModule();
    const chromeMock = (
      globalThis as unknown as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }
    ).chrome;
    // Pin: the long-lived port is named "image-harvest-ui" — content
    // script's onConnect listener uses this exact name to drive the
    // highlight-cleanup safety net.
    expect(chromeMock.runtime.connect).toHaveBeenCalledWith({ name: 'image-harvest-ui' });
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

    const ih = (
      window as unknown as {
        __IH__?: {
          store: unknown;
          applyFilters: unknown;
          loadMultitab: unknown;
          applyTheme: unknown;
          handleMessage: unknown;
        };
      }
    ).__IH__;
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

    const chromeMock = (
      globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }
    ).chrome;
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

    const chromeMock = (
      globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }
    ).chrome;
    chromeMock.runtime.sendMessage.mockClear();
    window.dispatchEvent(new Event('beforeunload'));

    // Pin: popup mode doesn't generate SIDE_PANEL_CLOSED — it's a
    // sidepanel-only contract. Sending it from popup would confuse
    // bg's tab-tracking state machine.
    const sidePanelClosedCalls = chromeMock.runtime.sendMessage.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'object' && call[0] !== null && 'tabId' in (call[0] as object)
    );
    expect(sidePanelClosedCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// filter_applied telemetry (v1.2: filter-row usage data)
// ─────────────────────────────────────────────────────────────────────
// Pin: every user-driven filter interaction fires one filter_applied
// event with a stable filter name — the data behind the v1.2+ "does
// the filter row earn its 34px" decision. Text inputs (url / filesize /
// custom size) must NOT fire per keystroke, and the URL keyword VALUE
// is never reported (privacy contract — name only).

describe('filter_applied telemetry', () => {
  it('size preset click → {filter:"size"}', async () => {
    document.body.innerHTML = '<div data-size-filter="large">Large</div>';
    await loadInitModule();

    document
      .querySelector('[data-size-filter="large"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'size' });
  });

  it('custom size input fires ONLY on change (confirm), never per keystroke', async () => {
    document.body.innerHTML = '<input id="filter-min-width" type="number" />';
    await loadInitModule();

    const input = document.getElementById('filter-min-width') as HTMLInputElement;
    input.value = '500';
    input.dispatchEvent(new Event('input'));
    expect(mockTrack).not.toHaveBeenCalledWith('filter_applied', { filter: 'size' });

    input.dispatchEvent(new Event('change'));
    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'size' });
  });

  it('type checkbox change → {filter:"type"}', async () => {
    document.body.innerHTML = '<input type="checkbox" class="type-checkbox" value="jpg" checked />';
    await loadInitModule();

    document.querySelector('.type-checkbox')!.dispatchEvent(new Event('change'));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'type' });
  });

  it('layout option click → {filter:"layout"}', async () => {
    document.body.innerHTML = '<div data-layout-filter="landscape">Landscape</div>';
    await loadInitModule();

    document
      .querySelector('[data-layout-filter="landscape"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'layout' });
  });

  it('url keyword input → {filter:"url"} WITHOUT the keyword value (privacy)', async () => {
    document.body.innerHTML = '<input id="filter-url-input" type="text" />';
    await loadInitModule();

    const input = document.getElementById('filter-url-input') as HTMLInputElement;
    input.value = 'cdn.example';
    input.dispatchEvent(new Event('input'));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'url' });
    // The typed keyword must never leave the panel — assert no payload
    // anywhere in the recorded calls contains it.
    expect(JSON.stringify(mockTrack.mock.calls)).not.toContain('cdn.example');
  });

  it('filesize preset click → {filter:"filesize"}', async () => {
    document.body.innerHTML = '<div data-filesize-filter="1mb">1 MB+</div>';
    await loadInitModule();

    document
      .querySelector('[data-filesize-filter="1mb"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'filesize' });
  });

  it('filesize min input → {filter:"filesize"} on debounce settle', async () => {
    document.body.innerHTML = '<input id="filter-filesize-min" type="number" />';
    await loadInitModule();

    const input = document.getElementById('filter-filesize-min') as HTMLInputElement;
    input.value = '100';
    input.dispatchEvent(new Event('input'));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'filesize' });
  });

  it('color "All Colors" click → {filter:"color"}', async () => {
    document.body.innerHTML = '<div data-color-filter="all">All Colors</div>';
    await loadInitModule();

    document
      .querySelector('[data-color-filter="all"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'color' });
  });

  it('sort option click → {filter:"sort"}', async () => {
    document.body.innerHTML = '<div data-sort-filter="name">Name</div>';
    await loadInitModule();

    document
      .querySelector('[data-sort-filter="name"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'sort' });
  });

  it('group option click (free-allowed mode) → {filter:"group"}', async () => {
    document.body.innerHTML = '<div data-group-filter="format">Format</div>';
    await loadInitModule();

    document
      .querySelector('[data-group-filter="format"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(mockTrack).toHaveBeenCalledWith('filter_applied', { filter: 'group' });
  });
});
