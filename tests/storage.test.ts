// Tests for shared/storage.ts — chrome.storage.* round-trips, download
// history capping, app-settings defaults / display mode helpers, and per-tab
// image cache invalidation by URL.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock, uninstallChromeMock } from './_helpers/chromeStorageMock';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_FILTER_CONFIG,
  LIMITS,
  STORAGE_KEYS,
} from '../shared/constants';
import {
  addDownloadRecord,
  clearDownloadHistory,
  clearLicenseData,
  clearSessionState,
  clearTabImageCache,
  getAppSettings,
  getDisplayMode,
  getDownloadHistory,
  getFilterConfig,
  getLicenseData,
  getSessionState,
  getTabImageCache,
  removeDownloadRecord,
  resetAppSettings,
  saveAppSettings,
  saveFilterConfig,
  saveLicenseData,
  saveSessionState,
  saveTabImageCache,
  setDisplayMode,
} from '../shared/storage';
import type { ImageItem, LicenseData } from '../shared/types';

beforeEach(() => {
  installChromeStorageMock();
});
afterEach(() => {
  uninstallChromeMock();
});

describe('filter config', () => {
  it('returns defaults when storage is empty', async () => {
    const cfg = await getFilterConfig();
    expect(cfg).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('round-trips a saved value via deepMerge', async () => {
    const next = { ...DEFAULT_FILTER_CONFIG, minWidth: 200, enableMinSize: true };
    expect(await saveFilterConfig(next)).toBe(true);
    const loaded = await getFilterConfig();
    expect(loaded.minWidth).toBe(200);
    expect(loaded.enableMinSize).toBe(true);
    // Untouched defaults still present
    expect(loaded.maxWidth).toBe(DEFAULT_FILTER_CONFIG.maxWidth);
  });
});

describe('download history', () => {
  it('starts empty and accepts new records LIFO', async () => {
    expect(await getDownloadHistory()).toEqual([]);
    await addDownloadRecord({ id: 'a' });
    await addDownloadRecord({ id: 'b' });
    const history = await getDownloadHistory();
    expect(history.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('caps history length at LIMITS.MAX_DOWNLOAD_HISTORY', async () => {
    for (let i = 0; i < LIMITS.MAX_DOWNLOAD_HISTORY + 5; i++) {
      await addDownloadRecord({ id: 'r' + i });
    }
    const history = await getDownloadHistory();
    expect(history).toHaveLength(LIMITS.MAX_DOWNLOAD_HISTORY);
    // Newest first
    expect(history[0].id).toBe('r' + (LIMITS.MAX_DOWNLOAD_HISTORY + 4));
  });

  it('removes a single record by id', async () => {
    await addDownloadRecord({ id: 'a' });
    await addDownloadRecord({ id: 'b' });
    await removeDownloadRecord('a');
    const history = await getDownloadHistory();
    expect(history.map((r) => r.id)).toEqual(['b']);
  });

  it('clears the entire history', async () => {
    await addDownloadRecord({ id: 'a' });
    await clearDownloadHistory();
    expect(await getDownloadHistory()).toEqual([]);
  });
});

describe('session state', () => {
  it('starts as null and round-trips arbitrary payloads', async () => {
    expect(await getSessionState()).toBeNull();
    await saveSessionState({ foo: 'bar' });
    expect(await getSessionState()).toEqual({ foo: 'bar' });
    await clearSessionState();
    expect(await getSessionState()).toBeNull();
  });
});

describe('app settings', () => {
  it('returns defaults when nothing is stored', async () => {
    const settings = await getAppSettings();
    expect(settings).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('layers stored partials on top of defaults', async () => {
    const partial = {
      ...DEFAULT_APP_SETTINGS,
      theme: 'dark' as const,
      density: 'compact' as const,
    };
    await saveAppSettings(partial);
    const loaded = await getAppSettings();
    expect(loaded.theme).toBe('dark');
    expect(loaded.density).toBe('compact');
    // Other defaults preserved
    expect(loaded.useSidePanel).toBe(DEFAULT_APP_SETTINGS.useSidePanel);
  });

  it('reset writes the defaults back into storage', async () => {
    await saveAppSettings({ ...DEFAULT_APP_SETTINGS, theme: 'dark' });
    await resetAppSettings();
    const after = await getAppSettings();
    expect(after).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe('display mode helpers', () => {
  it('reports sidepanel when useSidePanel is true', async () => {
    await saveAppSettings({ ...DEFAULT_APP_SETTINGS, useSidePanel: true });
    expect(await getDisplayMode()).toBe('sidepanel');
  });

  it('reports popup when useSidePanel is false', async () => {
    await saveAppSettings({ ...DEFAULT_APP_SETTINGS, useSidePanel: false });
    expect(await getDisplayMode()).toBe('popup');
  });

  it('setDisplayMode flips and persists', async () => {
    await setDisplayMode(false);
    expect(await getDisplayMode()).toBe('popup');
    await setDisplayMode(true);
    expect(await getDisplayMode()).toBe('sidepanel');
  });
});

describe('per-tab image cache', () => {
  const sample: ImageItem = {
    id: 'i1',
    url: 'https://x/y.png',
    displayWidth: 100,
    displayHeight: 50,
    naturalWidth: 200,
    naturalHeight: 100,
    type: 'img',
  };

  it('saves and retrieves images keyed by tabId', async () => {
    await saveTabImageCache(7, 'https://example.com', [sample]);
    const cached = await getTabImageCache(7);
    expect(cached?.url).toBe('https://example.com');
    expect(cached?.images[0].id).toBe('i1');
  });

  it('returns null when expectedUrl does not match', async () => {
    await saveTabImageCache(7, 'https://a.com', [sample]);
    expect(await getTabImageCache(7, 'https://b.com')).toBeNull();
  });

  it('clearTabImageCache removes the entry', async () => {
    await saveTabImageCache(7, 'https://a.com', [sample]);
    await clearTabImageCache(7);
    expect(await getTabImageCache(7)).toBeNull();
  });
});

describe('license data storage', () => {
  it('starts null, round-trips, and clears', async () => {
    expect(await getLicenseData()).toBeNull();
    const data: LicenseData = {
      licenseKey: 'AAAA-BBBB-CCCC-DDDD',
      status: 'active',
      plan: 'yearly',
      expiresAt: 9999999999999,
      lastVerified: Date.now(),
      instanceId: 'inst_test',
    };
    await saveLicenseData(data);
    expect(await getLicenseData()).toEqual(data);
    await clearLicenseData();
    expect(await getLicenseData()).toBeNull();
  });

  it('writes under the documented STORAGE_KEYS.LICENSE_DATA key', async () => {
    const data: LicenseData = {
      licenseKey: 'X',
      status: 'active',
      instanceId: 'i',
    };
    await saveLicenseData(data);
    // Reach into mock to verify the actual key used
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const local = (globalThis as any).chrome.storage.local;
    expect(local.data.has(STORAGE_KEYS.LICENSE_DATA)).toBe(true);
  });
});
