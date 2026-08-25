// Unit tests for sidepanel/injected-items.ts (v1.1.0 link penetration).
//
// Pinned contracts:
//   - mergeContextItem
//     * URL-deduped merge into state.allImages
//     * fires persistInjectedItems so injected items survive a reload
//     * stamps the owning tabId (scans must not leak them cross-tab)
//   - persistInjectedItems
//     * full rewrite of the per-tab key (deleted items fall out)
//     * removes the key when nothing is injected anymore
//   - restoreInjectedItems
//     * re-merges persisted items idempotently (URL-dedup)
//     * aborts when the user switched tabs during the storage read
//   - drainPendingContextItems
//     * consumes the storage.session queue once and toasts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtua', () => ({ Virtualizer: vi.fn() }));
vi.mock('../sidepanel/filter', () => ({ applyFilters: vi.fn() }));
vi.mock('../sidepanel/scan', () => ({ processImageExtras: vi.fn() }));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
}));

import {
  drainPendingContextItems,
  mergeContextItem,
  persistInjectedItems,
  restoreInjectedItems,
} from '../sidepanel/injected-items';
import { state, store } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

// ── chrome.storage.session stub backed by a plain Map ──────────────────────
const sessionStore = new Map<string, unknown>();

function installStorageStub(): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  sessionStore.clear();
  const get = vi.fn(async (keys: string | string[]) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of keyList) {
      if (sessionStore.has(k)) out[k] = sessionStore.get(k);
    }
    return out;
  });
  const set = vi.fn(async (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) sessionStore.set(k, v);
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) sessionStore.delete(k);
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { session: { get, set, remove } },
  };
  return { get, set, remove };
}

function injectedItem(url: string, overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: `inj-${url}`,
    url,
    type: 'context-image',
    visible: true,
    userInjected: true,
    ...overrides,
  } as ImageItem;
}

/** Flush the fire-and-forget persist promises inside mergeContextItem. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  store.reset();
  installStorageStub();
  vi.clearAllMocks();
});

afterEach(() => {
  store.reset();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

// ─────────────────────────────────────────────────────────────────────
// mergeContextItem
// ─────────────────────────────────────────────────────────────────────

describe('mergeContextItem', () => {
  it('merges a new item into allImages and persists it under the current tab key', async () => {
    state.currentTabId = 5;
    state.allImages = [];

    expect(mergeContextItem(injectedItem('https://a.com/i.png'))).toBe(true);
    expect(state.allImages).toHaveLength(1);
    expect(state.allImages[0]).toMatchObject({
      url: 'https://a.com/i.png',
      tabId: 5,
    });

    await flushMicrotasks();
    const persisted = sessionStore.get('ih:injected:5') as ImageItem[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].url).toBe('https://a.com/i.png');
  });

  it('dedupes by URL — the second merge of the same URL is a no-op', async () => {
    state.currentTabId = 5;
    state.allImages = [];

    expect(mergeContextItem(injectedItem('https://a.com/dup.png'))).toBe(true);
    expect(mergeContextItem(injectedItem('https://a.com/dup.png', { id: 'other-id' }))).toBe(false);
    expect(state.allImages).toHaveLength(1);
  });

  it('does not persist a non-userInjected merge target away from page-scan items', async () => {
    state.currentTabId = 3;
    state.allImages = [injectedItem('https://scan.example/img.jpg', { userInjected: false })];

    mergeContextItem(injectedItem('https://scan.example/img.jpg'));
    await flushMicrotasks();

    // The page-scan item is already in the grid (URL dedup) and nothing
    // was user-injected, so no per-tab key is written at all.
    expect(sessionStore.has('ih:injected:3')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// persistInjectedItems / restoreInjectedItems
// ─────────────────────────────────────────────────────────────────────

describe('persistInjectedItems / restoreInjectedItems', () => {
  it('persist is a full rewrite — removing an injected item drops it from the key', async () => {
    state.currentTabId = 8;
    state.allImages = [injectedItem('https://a.com/1.png'), injectedItem('https://a.com/2.png')];
    await persistInjectedItems();
    expect((sessionStore.get('ih:injected:8') as ImageItem[]).map((i) => i.url)).toEqual([
      'https://a.com/1.png',
      'https://a.com/2.png',
    ]);

    // Simulate the user deleting 1.png from the grid.
    state.allImages = state.allImages.filter((img) => img.url !== 'https://a.com/1.png');
    await persistInjectedItems();
    expect((sessionStore.get('ih:injected:8') as ImageItem[]).map((i) => i.url)).toEqual([
      'https://a.com/2.png',
    ]);
  });

  it('persist removes the key when no injected items remain', async () => {
    state.currentTabId = 8;
    sessionStore.set('ih:injected:8', [injectedItem('https://a.com/1.png')]);
    state.allImages = [];

    await persistInjectedItems();
    expect(sessionStore.has('ih:injected:8')).toBe(false);
  });

  it('restore re-merges persisted items into the grid — idempotently', async () => {
    state.currentTabId = 9;
    state.allImages = [];
    sessionStore.set('ih:injected:9', [injectedItem('https://a.com/keep.png')]);

    await restoreInjectedItems(9);
    expect(state.allImages.map((i) => i.url)).toEqual(['https://a.com/keep.png']);

    // A second restore (e.g. another tab-switch back) must not duplicate.
    await restoreInjectedItems(9);
    expect(state.allImages).toHaveLength(1);
  });

  it('restore aborts when the user switched tabs during the storage read', async () => {
    sessionStore.set('ih:injected:9', [injectedItem('https://a.com/keep.png')]);
    // currentTabId differs from the restore target → merge must not run.
    state.currentTabId = 10;
    state.allImages = [];

    await restoreInjectedItems(9);
    expect(state.allImages).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// drainPendingContextItems
// ─────────────────────────────────────────────────────────────────────

describe('drainPendingContextItems', () => {
  it('consumes the queued payload once, merges it, and toasts success', async () => {
    state.currentTabId = 12;
    state.allImages = [];
    sessionStore.set('pendingContextItems', [{ item: injectedItem('https://a.com/queued.png') }]);

    await drainPendingContextItems();

    expect(state.allImages.map((i) => i.url)).toEqual(['https://a.com/queued.png']);
    expect(sessionStore.has('pendingContextItems')).toBe(false);

    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith(expect.stringContaining('added'), 'success');

    // A second drain must be a no-op — the queue was already consumed.
    await drainPendingContextItems();
    expect(state.allImages).toHaveLength(1);
  });

  it('queues an error payload → failure toast, nothing merged', async () => {
    state.currentTabId = 12;
    state.allImages = [];
    sessionStore.set('pendingContextItems', [{ error: 'resolve_failed' }]);

    await drainPendingContextItems();
    expect(state.allImages).toHaveLength(0);

    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('empty queue → no-op, no toast', async () => {
    await drainPendingContextItems();
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalled();
  });
});
