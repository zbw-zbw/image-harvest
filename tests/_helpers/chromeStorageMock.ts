// In-memory mock of the chrome.storage API surface used by shared/storage.ts
// and shared/license.ts. Returns a fresh, isolated mock per call so each test
// case starts from a clean slate.

interface AreaStore {
  data: Map<string, unknown>;
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
  clear: () => Promise<void>;
}

function createArea(): AreaStore {
  const data = new Map<string, unknown>();

  const get = async (keys?: string | string[] | null): Promise<Record<string, unknown>> => {
    if (keys == null) {
      // Return everything
      return Object.fromEntries(data.entries());
    }
    const keyList = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const k of keyList) {
      if (data.has(k)) result[k] = data.get(k);
    }
    return result;
  };

  const set = async (items: Record<string, unknown>): Promise<void> => {
    for (const [k, v] of Object.entries(items)) {
      data.set(k, v);
    }
  };

  const remove = async (keys: string | string[]): Promise<void> => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) data.delete(k);
  };

  const clear = async (): Promise<void> => {
    data.clear();
  };

  return { data, get, set, remove, clear };
}

export interface ChromeStorageMock {
  local: AreaStore;
  sync: AreaStore;
  session: AreaStore;
}

/**
 * Install a fresh mock onto the global `chrome.storage` namespace and return
 * the area refs so the test can introspect / preset values.
 */
export function installChromeStorageMock(): ChromeStorageMock {
  const local = createArea();
  const sync = createArea();
  const session = createArea();

  // Bind onto globalThis.chrome so production code paths work unchanged.
  // We intentionally only stub the subset of properties shared/* uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    storage: { local, sync, session },
  };

  return { local, sync, session };
}

/** Cleanup hook for `afterEach`. */
export function uninstallChromeMock(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
}
