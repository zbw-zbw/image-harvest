// Unified chrome.* API mock for sidepanel-level unit tests.
//
// Replaces the per-file installChromeMock() implementations that used
// to live in tests/sidepanel-init.test.tsx and tests/sidepanel-settings
// .test.tsx. Both needed a full runtime + tabs + storage + commands
// surface; init additionally needed listener capture buckets for
// chrome.tabs.on{Activated,Updated,Removed} + port.onMessage +
// port.onDisconnect.
//
// NOT a replacement for tests/_helpers/chromeStorageMock.ts — that
// helper provides an *in-memory* storage impl (shared/storage.ts + shared
// /license.ts are tested against real storage semantics). This helper
// provides plain vi.fn() stubs, which is what the sidepanel orchestration
// tests want (assert call counts, not state).
import { vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

type AnyFn = ReturnType<typeof vi.fn>;

export type TabListener = (...args: unknown[]) => unknown;

export interface TabListenerBuckets {
  onActivated: TabListener[];
  onUpdated: TabListener[];
  onRemoved: TabListener[];
}

export interface PortListenerBuckets {
  message: TabListener[];
  disconnect: TabListener[];
}

export interface ChromeMock {
  runtime: {
    sendMessage: AnyFn;
    connect: AnyFn;
    lastError: chrome.runtime.LastError | null;
  };
  tabs: {
    query: AnyFn;
    get: AnyFn;
    create: AnyFn;
    connect: AnyFn;
    onActivated: { addListener: AnyFn };
    onUpdated: { addListener: AnyFn };
    onRemoved: { addListener: AnyFn };
  };
  storage: {
    local: { get: AnyFn; set: AnyFn };
  };
  commands: { getAll: AnyFn };
}

export interface InstallOptions {
  /**
   * When provided, tab-level listeners (onActivated / onUpdated / onRemoved)
   * push incoming callbacks into these arrays, letting tests manually fire
   * a listener to exercise the production handler. Arrays are cleared
   * in-place on every installChromeMock() call so the same buckets can
   * safely be shared across a describe block via beforeEach.
   */
  captureTabListeners?: TabListenerBuckets;
  /**
   * When provided, the Port returned from chrome.runtime.connect() captures
   * its onMessage / onDisconnect subscriptions into these buckets. Same
   * reset-on-install semantics as captureTabListeners.
   */
  capturePortListeners?: PortListenerBuckets;
}

// ─────────────────────────────────────────────────────────────────────
// installChromeMock — install a fresh full mock onto globalThis.chrome.
// Returns the ChromeMock so callers can introspect calls / tweak
// per-case mockResolvedValue overrides without reaching into globalThis.
// ─────────────────────────────────────────────────────────────────────

export function installChromeMock(options: InstallOptions = {}): ChromeMock {
  const { captureTabListeners, capturePortListeners } = options;

  // Reset capture buckets in-place so test authors can share one
  // `const buckets = { onActivated: [], ... }` object across a describe.
  if (captureTabListeners) {
    captureTabListeners.onActivated.length = 0;
    captureTabListeners.onUpdated.length = 0;
    captureTabListeners.onRemoved.length = 0;
  }
  if (capturePortListeners) {
    capturePortListeners.message.length = 0;
    capturePortListeners.disconnect.length = 0;
  }

  const mock: ChromeMock = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({}),
      connect: vi.fn(() => ({
        name: 'image-harvest-ui',
        onMessage: {
          addListener: vi.fn((fn: TabListener) => {
            if (capturePortListeners) capturePortListeners.message.push(fn);
          }),
        },
        onDisconnect: {
          addListener: vi.fn((fn: TabListener) => {
            if (capturePortListeners) capturePortListeners.disconnect.push(fn);
          }),
        },
        disconnect: vi.fn(),
        postMessage: vi.fn(),
      })),
      lastError: null,
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      get: vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com' }),
      create: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn(() => ({
        name: 'image-harvest-ui',
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      onActivated: {
        addListener: vi.fn((fn: TabListener) => {
          if (captureTabListeners) captureTabListeners.onActivated.push(fn);
        }),
      },
      onUpdated: {
        addListener: vi.fn((fn: TabListener) => {
          if (captureTabListeners) captureTabListeners.onUpdated.push(fn);
        }),
      },
      onRemoved: {
        addListener: vi.fn((fn: TabListener) => {
          if (captureTabListeners) captureTabListeners.onRemoved.push(fn);
        }),
      },
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    commands: { getAll: vi.fn().mockResolvedValue([]) },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = mock;
  return mock;
}

/** Cleanup hook for `afterEach`. Mirrors chromeStorageMock.uninstallChromeMock. */
export function uninstallChromeApiMock(): void {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}
