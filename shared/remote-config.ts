/**
 * Remote Config — fetches feature limits from the backend and caches locally.
 *
 * Design:
 * 1. On SW startup, call `syncRemoteConfig()` to fetch from /api/config/limits.
 * 2. Successful response is written to chrome.storage.local (survives restarts).
 * 3. `getRemoteConfig()` returns the cached config (memory > storage > null).
 * 4. Cache TTL is 1 hour — expired cache is refreshed on next `getRemoteConfig()`.
 * 5. Network failures silently fall back to cached or default values.
 */

const STORAGE_KEY = 'remote_config';
const STORAGE_TS_KEY = 'remote_config_ts';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Shape of the public config response from /api/config/limits */
export interface RemoteLimitsConfig {
  maxZipImages?: number;
  maxBatchCopyUrls?: number;
  maxCollectionItems?: number;
  maxMonthlyAiTags?: number;
  maxEagleExportPerBatch?: number;
  maxBatchDelete?: number;
  maxBatchFavorite?: number;
  allowedGroupModes?: string[];
  reverseSearchEngines?: string[];
  proAiMonthlyQuota?: number;
  proAiBatchSize?: number;
  proAiBatchConcurrency?: number;
  trialDurationDays?: number;
  maxImagesPerScan?: number;
}

// In-memory cache
let memoryConfig: RemoteLimitsConfig | null = null;
let memoryTimestamp = 0;

function isMemoryCacheValid(): boolean {
  return memoryConfig !== null && Date.now() - memoryTimestamp < CACHE_TTL_MS;
}

/** Build the config API URL from the same base used for other APIs. */
function getConfigApiUrl(): string {
  // Reuse VITE_API_BASE if available (injected at build time), else production URL.
  // In SW context import.meta.env may not exist, so we guard with try/catch.
  try {
    const base =
      (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) ||
      'https://image-harvest.kyriewen.cn';
    return `${base}/api/config/limits`;
  } catch {
    return 'https://image-harvest.kyriewen.cn/api/config/limits';
  }
}

/** Fetch config from backend, write to storage + memory. Returns true on success. */
export async function syncRemoteConfig(): Promise<boolean> {
  try {
    const response = await fetch(getConfigApiUrl(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;

    const config = (await response.json()) as RemoteLimitsConfig;

    // Write to memory
    memoryConfig = config;
    memoryTimestamp = Date.now();

    // Expose on globalThis so getFreeLimits() can read synchronously
    (globalThis as Record<string, unknown>).__remoteConfig = config;

    // Persist to chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: config,
        [STORAGE_TS_KEY]: memoryTimestamp,
      });
    }

    return true;
  } catch {
    // Network error — silently fail, keep existing cache
    return false;
  }
}

/** Get the cached remote config. Returns null if never synced. */
export async function getRemoteConfig(): Promise<RemoteLimitsConfig | null> {
  // 1. Memory cache (fastest)
  if (isMemoryCacheValid()) return memoryConfig;

  // 2. Chrome storage cache
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY, STORAGE_TS_KEY]);
      const config = stored[STORAGE_KEY] as RemoteLimitsConfig | undefined;
      const timestamp = stored[STORAGE_TS_KEY] as number | undefined;

      if (config && timestamp) {
        memoryConfig = config;
        memoryTimestamp = timestamp;

        // Expose on globalThis so getFreeLimits() can read synchronously
        (globalThis as Record<string, unknown>).__remoteConfig = config;

        // If cache is expired, trigger background refresh (non-blocking)
        if (Date.now() - timestamp > CACHE_TTL_MS) {
          void syncRemoteConfig();
        }

        return config;
      }
    } catch {
      // Storage access error
    }
  }

  // 3. No cache available — trigger sync and return null
  void syncRemoteConfig();
  return null;
}

/** Clear all cached remote config. */
export async function clearRemoteConfig(): Promise<void> {
  memoryConfig = null;
  memoryTimestamp = 0;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove([STORAGE_KEY, STORAGE_TS_KEY]);
  }
}
