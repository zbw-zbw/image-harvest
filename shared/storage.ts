// Storage management for Image Harvest.
import { DEFAULT_FILTER_CONFIG, STORAGE_KEYS, LIMITS, DEFAULT_APP_SETTINGS } from './constants';
import { deepMerge } from './utils';
import type { AppSettings, FilterConfig, ImageItem, TabImageCacheEntry } from './types';

interface DownloadRecord {
  id: string;
  [key: string]: unknown;
}

export async function getFilterConfig(): Promise<FilterConfig> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.FILTER_CONFIG);
    return deepMerge(DEFAULT_FILTER_CONFIG, result[STORAGE_KEYS.FILTER_CONFIG] || {});
  } catch (error) {
    console.error('Failed to get filter config:', error);
    return DEFAULT_FILTER_CONFIG;
  }
}

export async function saveFilterConfig(config: FilterConfig): Promise<boolean> {
  try {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.FILTER_CONFIG]: config,
    });
    return true;
  } catch (error) {
    console.error('Failed to save filter config:', error);
    return false;
  }
}

export async function getDownloadHistory(): Promise<DownloadRecord[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DOWNLOAD_HISTORY);
    return (result[STORAGE_KEYS.DOWNLOAD_HISTORY] as DownloadRecord[]) || [];
  } catch (error) {
    console.error('Failed to get download history:', error);
    return [];
  }
}

let historyMutex: Promise<void> = Promise.resolve();

export async function addDownloadRecord(record: DownloadRecord): Promise<boolean> {
  let release: () => void;
  const prev = historyMutex;
  historyMutex = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    const history = await getDownloadHistory();
    history.unshift(record);

    if (history.length > LIMITS.MAX_DOWNLOAD_HISTORY) {
      history.length = LIMITS.MAX_DOWNLOAD_HISTORY;
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.DOWNLOAD_HISTORY]: history,
    });
    return true;
  } catch (error) {
    console.error('Failed to add download record:', error);
    return false;
  } finally {
    release!();
  }
}

export async function clearDownloadHistory(): Promise<boolean> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.DOWNLOAD_HISTORY);
    return true;
  } catch (error) {
    console.error('Failed to clear download history:', error);
    return false;
  }
}

export async function removeDownloadRecord(recordId: string): Promise<boolean> {
  try {
    const history = await getDownloadHistory();
    const filtered = history.filter((r) => r.id !== recordId);
    await chrome.storage.local.set({
      [STORAGE_KEYS.DOWNLOAD_HISTORY]: filtered,
    });
    return true;
  } catch (error) {
    console.error('Failed to remove download record:', error);
    return false;
  }
}

export async function saveSessionState(state: unknown): Promise<boolean> {
  try {
    await chrome.storage.session.set({
      [STORAGE_KEYS.SESSION_STATE]: state,
    });
    return true;
  } catch (error) {
    console.error('Failed to save session state:', error);
    return false;
  }
}

export async function getSessionState<T = unknown>(): Promise<T | null> {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEYS.SESSION_STATE);
    return (result[STORAGE_KEYS.SESSION_STATE] as T) || null;
  } catch (error) {
    console.error('Failed to get session state:', error);
    return null;
  }
}

export async function clearSessionState(): Promise<boolean> {
  try {
    await chrome.storage.session.remove(STORAGE_KEYS.SESSION_STATE);
    return true;
  } catch (error) {
    console.error('Failed to clear session state:', error);
    return false;
  }
}

// ── Per-tab image cache (session storage) ───────────────────────────────────

function tabCacheKey(tabId: number): string {
  return `tabImgCache_${tabId}`;
}

function slimImageForCache(img: ImageItem): ImageItem {
  return {
    id: img.id,
    url: img.url,
    displayWidth: img.displayWidth,
    displayHeight: img.displayHeight,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    estimatedSize: img.estimatedSize,
    format: img.format,
    type: img.type,
    alt: img.alt,
    sourceDomain: img.sourceDomain,
    tabId: img.tabId,
    tabTitle: img.tabTitle,
    tabUrl: img.tabUrl,
    tabIndex: img.tabIndex,
    isCurrentTab: img.isCurrentTab,
    colors: img.colors,
    phash: img.phash,
  };
}

export async function saveTabImageCache(
  tabId: number,
  tabUrl: string,
  images: ImageItem[]
): Promise<boolean> {
  try {
    const key = tabCacheKey(tabId);
    await chrome.storage.session.set({
      [key]: {
        url: tabUrl,
        timestamp: Date.now(),
        images: images.map(slimImageForCache),
      } satisfies TabImageCacheEntry,
    });
    return true;
  } catch (error) {
    console.warn('Failed to save tab image cache:', error);
    return false;
  }
}

export async function getTabImageCache(
  tabId: number,
  expectedUrl?: string
): Promise<TabImageCacheEntry | null> {
  try {
    const key = tabCacheKey(tabId);
    const result = await chrome.storage.session.get(key);
    const cached = result[key] as TabImageCacheEntry | undefined;
    if (!cached) return null;
    if (expectedUrl && cached.url !== expectedUrl) return null;
    return cached;
  } catch (error) {
    console.warn('Failed to get tab image cache:', error);
    return null;
  }
}

export async function clearTabImageCache(tabId: number): Promise<boolean> {
  try {
    const key = tabCacheKey(tabId);
    await chrome.storage.session.remove(key);
    return true;
  } catch (error) {
    console.warn('Failed to clear tab image cache:', error);
    return false;
  }
}

// ── App Settings ─────────────────────────────────────────────────────────────

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const result = await chrome.storage.local.get('appSettings');
    const stored = (result.appSettings as Partial<AppSettings>) || {};
    return { ...DEFAULT_APP_SETTINGS, ...stored };
  } catch (error) {
    console.error('Failed to get app settings:', error);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<boolean> {
  try {
    await chrome.storage.local.set({ appSettings: settings });
    return true;
  } catch (error) {
    console.error('Failed to save app settings:', error);
    return false;
  }
}

export async function resetAppSettings(): Promise<boolean> {
  try {
    await chrome.storage.local.set({ appSettings: { ...DEFAULT_APP_SETTINGS } });
    return true;
  } catch (error) {
    console.error('Failed to reset app settings:', error);
    return false;
  }
}

export async function getDisplayMode(): Promise<'sidepanel' | 'popup'> {
  const settings = await getAppSettings();
  return settings.useSidePanel ? 'sidepanel' : 'popup';
}

export async function setDisplayMode(useSidePanel: boolean): Promise<boolean> {
  const settings = await getAppSettings();
  settings.useSidePanel = useSidePanel;
  return saveAppSettings(settings);
}
