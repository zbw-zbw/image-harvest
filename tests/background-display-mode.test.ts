// Unit tests for background/display-mode.ts — the popup-vs-sidepanel
// bootstrapper. Two main paths:
//   - useSidePanel === true  → enable sidePanel.openPanelOnActionClick,
//                              clear action.popup, then enable the
//                              panel for the active tab
//   - useSidePanel === false → disable sidePanel, set action.popup to
//                              pages/popup.html
// Plus the tab activation listener that re-enables the side panel only
// for tabs the user has explicitly opened it on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SidePanelStub {
  setPanelBehavior: ReturnType<typeof vi.fn>;
  setOptions: ReturnType<typeof vi.fn>;
}
interface ActionStub {
  setPopup: ReturnType<typeof vi.fn>;
}
interface TabsStub {
  query: ReturnType<typeof vi.fn>;
  onActivated: { addListener: ReturnType<typeof vi.fn> };
  onRemoved: { addListener: ReturnType<typeof vi.fn> };
}
interface StorageAreaStub {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

interface ChromeStub {
  sidePanel: SidePanelStub;
  action: ActionStub;
  tabs: TabsStub;
  storage: { local: StorageAreaStub };
}

function installChromeStub(appSettings: Record<string, unknown> = {}): ChromeStub {
  const stub: ChromeStub = {
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      setOptions: vi.fn().mockResolvedValue(undefined),
    },
    action: {
      setPopup: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn(),
      onActivated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          if (key === 'appSettings') return { appSettings };
          return {};
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = stub;
  return stub;
}

// Import lazily after the chrome stub is installed in beforeEach so the
// module-level imports of background/utils (which uses globalThis.chrome
// only inside function bodies) see a real object during top-level eval.
// utils.ts itself does NOT touch chrome at module init.
const { initDisplayMode, initTabActivationListener } = await import('../background/display-mode');
const { sidePanelOpenedTabs, uiPorts } = await import('../background/utils');

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub({ useSidePanel: true });
  sidePanelOpenedTabs.clear();
  uiPorts.clear();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  sidePanelOpenedTabs.clear();
  uiPorts.clear();
});

describe('initDisplayMode — useSidePanel branch', () => {
  it('enables openPanelOnActionClick, clears action.popup, and enables panel for the active tab', async () => {
    chromeStub = installChromeStub({ useSidePanel: true });
    chromeStub.tabs.query.mockResolvedValue([{ id: 42 }]);

    await initDisplayMode();

    // 1) openPanelOnActionClick = true
    expect(chromeStub.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    // 2) action.popup cleared
    expect(chromeStub.action.setPopup).toHaveBeenCalledWith({ popup: '' });
    // 3) panel enabled for the active tab with the sidepanel.html path
    expect(chromeStub.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
    // (And there's a defensive `enabled: false` reset before the
    // per-tab enable to avoid stale state.)
    expect(chromeStub.sidePanel.setOptions).toHaveBeenCalledWith({ enabled: false });
  });

  it('treats undefined useSidePanel as side-panel mode (default-on contract)', async () => {
    // settings.useSidePanel !== false → side panel branch.
    chromeStub = installChromeStub({});
    chromeStub.tabs.query.mockResolvedValue([{ id: 7 }]);

    await initDisplayMode();

    expect(chromeStub.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(chromeStub.action.setPopup).toHaveBeenCalledWith({ popup: '' });
  });

  it('still completes when the active-tab lookup throws (per-tab enable is best-effort)', async () => {
    chromeStub = installChromeStub({ useSidePanel: true });
    chromeStub.tabs.query.mockRejectedValue(new Error('no tabs permission'));

    // Should not throw — the inner try/catch swallows the lookup failure.
    await expect(initDisplayMode()).resolves.toBeUndefined();

    // Behavior still applied even though per-tab enable was skipped.
    expect(chromeStub.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(chromeStub.action.setPopup).toHaveBeenCalledWith({ popup: '' });
    // No per-tab enable — the only setOptions call is the defensive reset.
    const enableCalls = chromeStub.sidePanel.setOptions.mock.calls.filter(
      (call) => (call[0] as { enabled?: boolean }).enabled === true
    );
    expect(enableCalls).toHaveLength(0);
  });
});

describe('initDisplayMode — popup branch', () => {
  it('disables side panel and routes action click to popup.html', async () => {
    chromeStub = installChromeStub({ useSidePanel: false });

    await initDisplayMode();

    expect(chromeStub.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: false,
    });
    expect(chromeStub.sidePanel.setOptions).toHaveBeenCalledWith({ enabled: false });
    expect(chromeStub.action.setPopup).toHaveBeenCalledWith({ popup: 'pages/popup.html' });
  });

  it('does not consult chrome.tabs.query in popup mode (per-tab enable not needed)', async () => {
    chromeStub = installChromeStub({ useSidePanel: false });

    await initDisplayMode();

    expect(chromeStub.tabs.query).not.toHaveBeenCalled();
  });
});

describe('initDisplayMode — top-level error swallowed', () => {
  it('swallows top-level errors so the service worker never crashes on init', async () => {
    chromeStub = installChromeStub({ useSidePanel: true });
    // Make storage throw → getAppSettings catches internally and falls
    // back to defaults, so display-mode itself still runs. To trigger
    // the OUTER catch we need a chrome.* call after settings to throw.
    chromeStub.sidePanel.setPanelBehavior.mockRejectedValue(new Error('sidePanel API unavailable'));

    // Should not throw — the outer try/catch logs and resolves undefined.
    await expect(initDisplayMode()).resolves.toBeUndefined();
  });
});

describe('initTabActivationListener', () => {
  it('registers both onActivated and onRemoved listeners', () => {
    initTabActivationListener();
    expect(chromeStub.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    expect(chromeStub.tabs.onRemoved.addListener).toHaveBeenCalledTimes(1);
  });

  it('onActivated re-enables panel for tabs the user opened it on', async () => {
    chromeStub = installChromeStub({ useSidePanel: true });
    initTabActivationListener();
    sidePanelOpenedTabs.add(123);

    const onActivated = chromeStub.tabs.onActivated.addListener.mock.calls[0][0] as (info: {
      tabId: number;
    }) => Promise<void>;

    await onActivated({ tabId: 123 });

    expect(chromeStub.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 123,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
  });

  it('onActivated re-enables panel when any UI port is connected (sticky panel)', async () => {
    chromeStub = installChromeStub({ useSidePanel: true });
    initTabActivationListener();
    // Even if tab 999 was never explicitly opened, having an active UI
    // port means the panel is currently open and must be re-enabled
    // for the new tab to keep it from auto-closing on tab switch.
    uiPorts.add({} as chrome.runtime.Port);

    const onActivated = chromeStub.tabs.onActivated.addListener.mock.calls[0][0] as (info: {
      tabId: number;
    }) => Promise<void>;

    await onActivated({ tabId: 999 });

    expect(chromeStub.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 999,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
  });

  it('onActivated enables sidePanel for any tab (even without a prior port)', async () => {
    chromeStub = installChromeStub({ useSidePanel: true });
    initTabActivationListener();

    const onActivated = chromeStub.tabs.onActivated.addListener.mock.calls[0][0] as (info: {
      tabId: number;
    }) => Promise<void>;

    await onActivated({ tabId: 555 });

    expect(chromeStub.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 555,
      path: 'pages/sidepanel.html',
      enabled: true,
    });
  });

  it('onActivated is a no-op when popup mode is configured', async () => {
    chromeStub = installChromeStub({ useSidePanel: false });
    initTabActivationListener();
    sidePanelOpenedTabs.add(123);

    const onActivated = chromeStub.tabs.onActivated.addListener.mock.calls[0][0] as (info: {
      tabId: number;
    }) => Promise<void>;

    await onActivated({ tabId: 123 });

    expect(chromeStub.sidePanel.setOptions).not.toHaveBeenCalled();
  });

  it('onRemoved evicts the tab from sidePanelOpenedTabs', () => {
    initTabActivationListener();
    sidePanelOpenedTabs.add(42);
    sidePanelOpenedTabs.add(99);

    const onRemoved = chromeStub.tabs.onRemoved.addListener.mock.calls[0][0] as (
      tabId: number
    ) => void;

    onRemoved(42);

    expect(sidePanelOpenedTabs.has(42)).toBe(false);
    expect(sidePanelOpenedTabs.has(99)).toBe(true);
  });
});
