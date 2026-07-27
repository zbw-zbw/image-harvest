// Unit tests for shared/remote-config.ts — the three-tier limits cache
// (memory → chrome.storage → network) behind Pro/Free feature gating.
//
// Previously ~44% covered: only the pure helpers were exercised. What we
// pin now:
//   - syncRemoteConfig(): success writes ALL three sinks (memory,
//     globalThis.__remoteConfig for getFreeLimits(), chrome.storage);
//     non-OK / network-down return false WITHOUT poisoning the cache.
//   - getRemoteConfig(): tier order and the stale-while-revalidate
//     behaviour (expired storage cache still returned, background sync
//     fired non-blocking).
//   - clearRemoteConfig(): wipes memory + storage.
//   - Copy helpers: getFeatureCopySynchronous / interpolateFeatureDesc.
//
// The module keeps its cache in module-level lets with no test hook, so
// every scenario re-imports a fresh copy via vi.resetModules().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RemoteConfigModule = typeof import('../shared/remote-config');

const storageGet = vi.fn();
const storageSet = vi.fn();
const storageRemove = vi.fn();
const fetchMock = vi.fn();

async function loadModule(): Promise<RemoteConfigModule> {
  vi.resetModules();
  return import('../shared/remote-config');
}

function okResponse(body: unknown): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  storageGet.mockResolvedValue({});
  storageSet.mockResolvedValue(undefined);
  storageRemove.mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('chrome', {
    storage: { local: { get: storageGet, set: storageSet, remove: storageRemove } },
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__remoteConfig;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── syncRemoteConfig ───────────────────────────────────────────────────────

describe('syncRemoteConfig', () => {
  it('fetches /api/v1/config/limits and writes memory + globalThis + storage', async () => {
    const { syncRemoteConfig, getRemoteConfig } = await loadModule();
    fetchMock.mockResolvedValue(okResponse({ maxZipImages: 30 }));

    expect(await syncRemoteConfig()).toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/api\/v1\/config\/limits$/);
    // getFreeLimits() reads this synchronously
    expect((globalThis as Record<string, unknown>).__remoteConfig).toEqual({ maxZipImages: 30 });
    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({ remote_config: { maxZipImages: 30 } })
    );
    // Memory tier serves the follow-up read without touching storage
    storageGet.mockClear();
    expect(await getRemoteConfig()).toEqual({ maxZipImages: 30 });
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('returns false on a non-OK response and leaves the cache untouched', async () => {
    const { syncRemoteConfig } = await loadModule();
    fetchMock.mockResolvedValue({ ok: false });
    expect(await syncRemoteConfig()).toBe(false);
    expect(storageSet).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).__remoteConfig).toBeUndefined();
  });

  it('returns false (never throws) when the network is down', async () => {
    const { syncRemoteConfig } = await loadModule();
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await syncRemoteConfig()).toBe(false);
  });
});

// ── getRemoteConfig ────────────────────────────────────────────────────────

describe('getRemoteConfig', () => {
  it('hydrates memory from a fresh chrome.storage cache without fetching', async () => {
    const { getRemoteConfig } = await loadModule();
    storageGet.mockResolvedValue({
      remote_config: { maxCollectionItems: 50 },
      remote_config_ts: Date.now(),
    });

    expect(await getRemoteConfig()).toEqual({ maxCollectionItems: 50 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).__remoteConfig).toEqual({
      maxCollectionItems: 50,
    });

    // Second read hits the memory tier
    storageGet.mockClear();
    expect(await getRemoteConfig()).toEqual({ maxCollectionItems: 50 });
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('returns a STALE storage cache immediately and refreshes in the background', async () => {
    const { getRemoteConfig } = await loadModule();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    storageGet.mockResolvedValue({
      remote_config: { maxZipImages: 10 },
      remote_config_ts: twoHoursAgo,
    });
    fetchMock.mockResolvedValue(okResponse({ maxZipImages: 99 }));

    // Stale-while-revalidate: the old value is served, not awaited-refreshed
    expect(await getRemoteConfig()).toEqual({ maxZipImages: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // background sync fired
  });

  it('returns null and triggers a sync when no cache exists anywhere', async () => {
    const { getRemoteConfig } = await loadModule();
    fetchMock.mockResolvedValue(okResponse({ maxZipImages: 30 }));
    expect(await getRemoteConfig()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when storage access throws (still schedules a sync)', async () => {
    const { getRemoteConfig } = await loadModule();
    storageGet.mockRejectedValue(new Error('storage down'));
    fetchMock.mockResolvedValue(okResponse({}));
    expect(await getRemoteConfig()).toBeNull();
  });
});

// ── clearRemoteConfig ──────────────────────────────────────────────────────

describe('clearRemoteConfig', () => {
  it('wipes the memory tier and removes both storage keys', async () => {
    const { syncRemoteConfig, clearRemoteConfig, getRemoteConfig } = await loadModule();
    fetchMock.mockResolvedValue(okResponse({ maxZipImages: 30 }));
    await syncRemoteConfig();

    await clearRemoteConfig();
    expect(storageRemove).toHaveBeenCalledWith(['remote_config', 'remote_config_ts']);

    // Memory gone → falls through to (empty) storage → null
    storageGet.mockResolvedValue({});
    expect(await getRemoteConfig()).toBeNull();
  });
});

// ── Feature copy helpers ───────────────────────────────────────────────────

describe('getFeatureCopySynchronous', () => {
  it('returns null before any sync', async () => {
    const { getFeatureCopySynchronous } = await loadModule();
    expect(getFeatureCopySynchronous()).toBeNull();
  });

  it('returns the copy block after a sync that includes one', async () => {
    const { syncRemoteConfig, getFeatureCopySynchronous } = await loadModule();
    const copy = {
      features: {
        aiTag: { label: { en: 'AI Tags' }, free: { en: '10/mo' }, pro: { en: '∞' }, group: 'ai' },
      },
      featureOrder: ['aiTag'],
      groups: { ai: { en: 'AI' } },
    };
    fetchMock.mockResolvedValue(okResponse({ copy }));
    await syncRemoteConfig();
    expect(getFeatureCopySynchronous()).toEqual(copy);
  });

  it('returns null when the synced config has no copy block', async () => {
    const { syncRemoteConfig, getFeatureCopySynchronous } = await loadModule();
    fetchMock.mockResolvedValue(okResponse({ maxZipImages: 30 }));
    await syncRemoteConfig();
    expect(getFeatureCopySynchronous()).toBeNull();
  });
});

describe('interpolateFeatureDesc', () => {
  it('replaces known {placeholders} with limit values', async () => {
    const { interpolateFeatureDesc } = await loadModule();
    expect(
      interpolateFeatureDesc('{maxZipImages}/batch, {maxMonthlyAiTags}/mo', {
        maxZipImages: 30,
        maxMonthlyAiTags: 10,
      })
    ).toBe('30/batch, 10/mo');
  });

  it('keeps unknown placeholders verbatim instead of printing "undefined"', async () => {
    const { interpolateFeatureDesc } = await loadModule();
    expect(interpolateFeatureDesc('{nope}/batch', { maxZipImages: 30 })).toBe('{nope}/batch');
  });

  it('treats null values as missing (placeholder preserved)', async () => {
    const { interpolateFeatureDesc } = await loadModule();
    expect(interpolateFeatureDesc('{a}|{b}', { a: 0, b: null })).toBe('0|{b}');
  });
});
