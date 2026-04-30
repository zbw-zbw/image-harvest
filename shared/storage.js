// Storage management for Image Harvest
// Depends on: constants.js (DEFAULT_FILTER_CONFIG, STORAGE_KEYS, LIMITS, DEFAULT_APP_SETTINGS)
//             utils.js (deepMerge)
// These must be loaded via <script> tags before this file.

/**
 * Get filter configuration from storage
 */
async function getFilterConfig() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.FILTER_CONFIG);
    return deepMerge(DEFAULT_FILTER_CONFIG, result[STORAGE_KEYS.FILTER_CONFIG] || {});
  } catch (error) {
    console.error('Failed to get filter config:', error);
    return DEFAULT_FILTER_CONFIG;
  }
}

/**
 * Save filter configuration to storage
 */
async function saveFilterConfig(config) {
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

/**
 * Get download history from storage
 */
async function getDownloadHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DOWNLOAD_HISTORY);
    return result[STORAGE_KEYS.DOWNLOAD_HISTORY] || [];
  } catch (error) {
    console.error('Failed to get download history:', error);
    return [];
  }
}

/**
 * Add download record to history
 */
async function addDownloadRecord(record) {
  try {
    const history = await getDownloadHistory();
    history.unshift(record);
    
    // Keep only last N records
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

/**
 * Clear download history
 */
async function clearDownloadHistory() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.DOWNLOAD_HISTORY);
    return true;
  } catch (error) {
    console.error('Failed to clear download history:', error);
    return false;
  }
}

/**
 * Remove specific record from history
 */
async function removeDownloadRecord(recordId) {
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

/**
 * Save session state (for popup persistence)
 */
async function saveSessionState(state) {
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

/**
 * Get session state
 */
async function getSessionState() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEYS.SESSION_STATE);
    return result[STORAGE_KEYS.SESSION_STATE] || null;
  } catch (error) {
    console.error('Failed to get session state:', error);
    return null;
  }
}

/**
 * Clear session state
 */
async function clearSessionState() {
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

/**
 * Build the session storage key for a given tab.
 */
function tabCacheKey(tabId) {
  return `tabImgCache_${tabId}`;
}

/**
 * Strip heavy / non-essential fields from images before persisting
 * to keep within chrome.storage.session quota (~10 MB).
 */
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

/**
 * Save scanned images for a tab into session storage.
 */
async function saveTabImageCache(tabId, tabUrl, images) {
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
    // Quota exceeded or other error — silently ignore
    console.warn('Failed to save tab image cache:', error);
    return false;
  }
}

/**
 * Retrieve cached images for a tab from session storage.
 * Returns null if no cache exists or the URL has changed.
 */
async function getTabImageCache(tabId, expectedUrl) {
  try {
    const key = tabCacheKey(tabId);
    const result = await chrome.storage.session.get(key);
    const cached = result[key];
    if (!cached) return null;
    // Invalidate if the tab has navigated to a different URL
    if (expectedUrl && cached.url !== expectedUrl) return null;
    return cached;
  } catch (error) {
    console.warn('Failed to get tab image cache:', error);
    return null;
  }
}

/**
 * Remove cached images for a specific tab.
 */
async function clearTabImageCache(tabId) {
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
async function getAppSettings() {
  try {
    const result = await chrome.storage.local.get('appSettings');
    return { ...DEFAULT_APP_SETTINGS, ...(result.appSettings || {}) };
  } catch (error) {
    console.error('Failed to get app settings:', error);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

async function saveAppSettings(settings) {
  try {
    await chrome.storage.local.set({ appSettings: settings });
    return true;
  } catch (error) {
    console.error('Failed to save app settings:', error);
    return false;
  }
}

async function resetAppSettings() {
  try {
    await chrome.storage.local.set({ appSettings: { ...DEFAULT_APP_SETTINGS } });
    return true;
  } catch (error) {
    console.error('Failed to reset app settings:', error);
    return false;
  }
}

async function getDisplayMode() {
  const settings = await getAppSettings();
  return settings.useSidePanel ? 'sidepanel' : 'popup';
}

async function setDisplayMode(useSidePanel) {
  const settings = await getAppSettings();
  settings.useSidePanel = useSidePanel;
  return saveAppSettings(settings);
}

// ============================================
// License data storage
// ============================================

/**
 * Save license data to chrome.storage.local
 */
async function saveLicenseData(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE_DATA]: data });
    return true;
  } catch (error) {
    console.error('Failed to save license data:', error);
    return false;
  }
}

/**
 * Get license data from chrome.storage.local
 */
async function getLicenseData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LICENSE_DATA);
    return result[STORAGE_KEYS.LICENSE_DATA] || null;
  } catch (error) {
    console.error('Failed to get license data:', error);
    return null;
  }
}

/**
 * Clear license data from chrome.storage.local
 */
async function clearLicenseData() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE_DATA);
    return true;
  } catch (error) {
    console.error('Failed to clear license data:', error);
    return false;
  }
}