// Storage management for Image Harvest (ES Module version)
import { DEFAULT_FILTER_CONFIG, STORAGE_KEYS, LIMITS, DEFAULT_APP_SETTINGS } from './constants.mjs';
import { deepMerge } from './utils.mjs';

export async function getFilterConfig() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.FILTER_CONFIG);
    return deepMerge(DEFAULT_FILTER_CONFIG, result[STORAGE_KEYS.FILTER_CONFIG] || {});
  } catch (error) {
    console.error('Failed to get filter config:', error);
    return DEFAULT_FILTER_CONFIG;
  }
}

export async function saveFilterConfig(config) {
  try {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.FILTER_CONFIG]: config
    });
    return true;
  } catch (error) {
    console.error('Failed to save filter config:', error);
    return false;
  }
}

export async function getDownloadHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DOWNLOAD_HISTORY);
    return result[STORAGE_KEYS.DOWNLOAD_HISTORY] || [];
  } catch (error) {
    console.error('Failed to get download history:', error);
    return [];
  }
}

export async function addDownloadRecord(record) {
  try {
    const history = await getDownloadHistory();
    history.unshift(record);
    
    if (history.length > LIMITS.MAX_DOWNLOAD_HISTORY) {
      history.length = LIMITS.MAX_DOWNLOAD_HISTORY;
    }
    
    await chrome.storage.local.set({
      [STORAGE_KEYS.DOWNLOAD_HISTORY]: history
    });
    return true;
  } catch (error) {
    console.error('Failed to add download record:', error);
    return false;
  }
}

export async function clearDownloadHistory() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.DOWNLOAD_HISTORY);
    return true;
  } catch (error) {
    console.error('Failed to clear download history:', error);
    return false;
  }
}

export async function removeDownloadRecord(recordId) {
  try {
    const history = await getDownloadHistory();
    const filtered = history.filter(r => r.id !== recordId);
    await chrome.storage.local.set({
      [STORAGE_KEYS.DOWNLOAD_HISTORY]: filtered
    });
    return true;
  } catch (error) {
    console.error('Failed to remove download record:', error);
    return false;
  }
}

export async function saveSessionState(state) {
  try {
    await chrome.storage.session.set({
      [STORAGE_KEYS.SESSION_STATE]: state
    });
    return true;
  } catch (error) {
    console.error('Failed to save session state:', error);
    return false;
  }
}

export async function getSessionState() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEYS.SESSION_STATE);
    return result[STORAGE_KEYS.SESSION_STATE] || null;
  } catch (error) {
    console.error('Failed to get session state:', error);
    return null;
  }
}

export async function clearSessionState() {
  try {
    await chrome.storage.session.remove(STORAGE_KEYS.SESSION_STATE);
    return true;
  } catch (error) {
    console.error('Failed to clear session state:', error);
    return false;
  }
}

// ============================================
// Per-tab image cache (session storage)
// ============================================

function tabCacheKey(tabId) {
  return `tabImgCache_${tabId}`;
}

function slimImageForCache(img) {
  return {
    id: img.id,
    url: img.url,
    width: img.width,
    height: img.height,
    size: img.size,
    format: img.format,
    type: img.type,
    alt: img.alt,
    tabTitle: img.tabTitle,
    tabIndex: img.tabIndex,
    isCurrentTab: img.isCurrentTab
  };
}

export async function saveTabImageCache(tabId, tabUrl, images) {
  try {
    const key = tabCacheKey(tabId);
    await chrome.storage.session.set({
      [key]: {
        url: tabUrl,
        timestamp: Date.now(),
        images: images.map(slimImageForCache)
      }
    });
    return true;
  } catch (error) {
    console.warn('Failed to save tab image cache:', error);
    return false;
  }
}

export async function getTabImageCache(tabId, expectedUrl) {
  try {
    const key = tabCacheKey(tabId);
    const result = await chrome.storage.session.get(key);
    const cached = result[key];
    if (!cached) return null;
    if (expectedUrl && cached.url !== expectedUrl) return null;
    return cached;
  } catch (error) {
    console.warn('Failed to get tab image cache:', error);
    return null;
  }
}

export async function clearTabImageCache(tabId) {
  try {
    const key = tabCacheKey(tabId);
    await chrome.storage.session.remove(key);
    return true;
  } catch (error) {
    console.warn('Failed to clear tab image cache:', error);
    return false;
  }
}

// V2.0 App Settings
export async function getAppSettings() {
  try {
    const result = await chrome.storage.local.get('appSettings');
    return { ...DEFAULT_APP_SETTINGS, ...(result.appSettings || {}) };
  } catch (error) {
    console.error('Failed to get app settings:', error);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(settings) {
  try {
    await chrome.storage.local.set({ appSettings: settings });
    return true;
  } catch (error) {
    console.error('Failed to save app settings:', error);
    return false;
  }
}

export async function resetAppSettings() {
  try {
    await chrome.storage.local.set({ appSettings: { ...DEFAULT_APP_SETTINGS } });
    return true;
  } catch (error) {
    console.error('Failed to reset app settings:', error);
    return false;
  }
}

export async function getDisplayMode() {
  const settings = await getAppSettings();
  return settings.useSidePanel ? 'sidepanel' : 'popup';
}

export async function setDisplayMode(useSidePanel) {
  const settings = await getAppSettings();
  settings.useSidePanel = useSidePanel;
  return saveAppSettings(settings);
}

// ============================================
// License data storage
// ============================================

export async function saveLicenseData(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE_DATA]: data });
    return true;
  } catch (error) {
    console.error('Failed to save license data:', error);
    return false;
  }
}

export async function getLicenseData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LICENSE_DATA);
    return result[STORAGE_KEYS.LICENSE_DATA] || null;
  } catch (error) {
    console.error('Failed to get license data:', error);
    return null;
  }
}

export async function clearLicenseData() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE_DATA);
    return true;
  } catch (error) {
    console.error('Failed to clear license data:', error);
    return false;
  }
}