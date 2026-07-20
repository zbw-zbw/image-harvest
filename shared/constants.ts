// Constants for Image Harvest extension (TypeScript single source of truth).
//
// `as const` is used liberally so consumers get exact literal-union types
// instead of plain `string` when reading enum-like maps such as MESSAGE_TYPES.

import type { AppSettings, FilterConfig } from './types';

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  // Size filters — switches default ON; values 0 / 99999 mean "no limit"
  // so no images are filtered out unless the user tightens the range.
  enableMinSize: true,
  minWidth: 0,
  minHeight: 0,
  enableMaxSize: true,
  maxWidth: 99999,
  maxHeight: 99999,

  // Aspect ratio
  enableAspectRatio: false,
  aspectRatios: [],

  // Format filters
  enableFormats: false,
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'],

  // Live monitoring
  enableLiveMonitoring: true,
  liveDebounceMs: 500,
};

export const ASPECT_RATIOS = {
  square: { min: 0.9, max: 1.1, label: 'Square' },
  landscape: { min: 1.1, max: 2.5, label: 'Landscape' },
  portrait: { min: 0.4, max: 0.9, label: 'Portrait' },
  panorama: { min: 2.5, max: 10, label: 'Panorama' },
} as const;

export const SUPPORTED_FORMATS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'svg',
  'bmp',
  'ico',
  'avif',
] as const;

export const STORAGE_KEYS = {
  FILTER_CONFIG: 'filterConfig',
  DOWNLOAD_HISTORY: 'downloadHistory',
  SESSION_STATE: 'sessionState',
  APP_SETTINGS: 'appSettings',
  COLLECTION: 'collection',
  LICENSE_DATA: 'licenseData',
  INSTANCE_ID: 'instanceId',
  AI_QUOTA: 'aiQuota',
  AI_TAGS: 'aiTags',
  AI_FREE_MONTHLY: 'aiFreeMonthly',
  EAGLE_FREE_MONTHLY: 'eagleFreeMonthly',
  SHOW_VISIBLE_ONLY: 'showVisibleOnly',
  FEATURE_QUOTA: 'featureQuota',
  TRIAL_START: 'trialStart',
} as const;

export const MESSAGE_TYPES = {
  // Popup to Background
  GET_IMAGES: 'GET_IMAGES',
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  GET_FILTER_CONFIG: 'GET_FILTER_CONFIG',
  SAVE_FILTER_CONFIG: 'SAVE_FILTER_CONFIG',

  // Background to Content
  EXTRACT_IMAGES: 'EXTRACT_IMAGES',
  START_LIVE_MONITOR: 'START_LIVE_MONITOR',
  STOP_LIVE_MONITOR: 'STOP_LIVE_MONITOR',

  // Content to Background
  IMAGES_EXTRACTED: 'IMAGES_EXTRACTED',
  IMAGES_DISCOVERED: 'IMAGES_DISCOVERED',
  EXTRACTION_ERROR: 'EXTRACTION_ERROR',

  // Background to Popup
  DOWNLOAD_PROGRESS: 'DOWNLOAD_PROGRESS',
  DOWNLOAD_COMPLETE: 'DOWNLOAD_COMPLETE',
  DOWNLOAD_ERROR: 'DOWNLOAD_ERROR',

  // Side Panel / Content Script communication
  HIGHLIGHT_IMAGE: 'HIGHLIGHT_IMAGE',
  UNHIGHLIGHT_IMAGE: 'UNHIGHLIGHT_IMAGE',
  HIGHLIGHT_IMAGES: 'HIGHLIGHT_IMAGES',
  REMOVE_HIGHLIGHT: 'REMOVE_HIGHLIGHT',
  CLEAR_SELECTION: 'CLEAR_SELECTION',
  TOGGLE_SIDEBAR: 'TOGGLE_SIDEBAR',
  TOGGLE_FAB: 'TOGGLE_FAB',
  SET_DISPLAY_MODE: 'SET_DISPLAY_MODE',
  MULTI_TAB_EXTRACT: 'MULTI_TAB_EXTRACT',
  MULTI_TAB_EXTRACT_COMPLETE: 'MULTI_TAB_EXTRACT_COMPLETE',
  MULTI_TAB_EXTRACT_ERROR: 'MULTI_TAB_EXTRACT_ERROR',

  // Image data proxy (bypass CORS)
  FETCH_IMAGE_DATA: 'FETCH_IMAGE_DATA',
  FETCH_IMAGE_META: 'FETCH_IMAGE_META',

  // Reverse image search proxy upload
  REVERSE_SEARCH_UPLOAD: 'REVERSE_SEARCH_UPLOAD',

  // Side panel tab tracking
  SIDE_PANEL_OPENED: 'SIDE_PANEL_OPENED',
  SIDE_PANEL_CLOSED: 'SIDE_PANEL_CLOSED',

  // Ping
  PING: 'PING',
  PONG: 'PONG',

  // License
  ACTIVATE_LICENSE: 'ACTIVATE_LICENSE',
  DEACTIVATE_LICENSE: 'DEACTIVATE_LICENSE',
  RESET_LICENSE_INSTANCES: 'RESET_LICENSE_INSTANCES',
  VALIDATE_LICENSE: 'VALIDATE_LICENSE',
  GET_LICENSE_STATUS: 'GET_LICENSE_STATUS',
  LICENSE_STATUS_CHANGED: 'LICENSE_STATUS_CHANGED',

  // Eagle export
  EXPORT_TO_EAGLE: 'EXPORT_TO_EAGLE',

  // AI tagging
  AI_TAG_IMAGE: 'AI_TAG_IMAGE',
  AI_TAG_BATCH: 'AI_TAG_BATCH',

  // Visibility re-check (side panel → content script)
  CHECK_VISIBILITY: 'CHECK_VISIBILITY',
  BG_SCAN_LIMIT_EXCEEDED: 'BG_SCAN_LIMIT_EXCEEDED',
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export const ERROR_CODES = {
  CSP_BLOCKED: 'CSP_BLOCKED',
  TIMEOUT: 'TIMEOUT',
  CORS_DENIED: 'CORS_DENIED',
  MEMORY_LIMIT: 'MEMORY_LIMIT',
  NO_IMAGES: 'NO_IMAGES',
  INJECTION_FAILED: 'INJECTION_FAILED',
} as const;

export const LIMITS = {
  MAX_IMAGES_PER_SCAN: 1000,
  MAX_THUMBNAIL_MEMORY_MB: 50,
  MAX_ZIP_SIZE_MB: 500,
  MAX_DOWNLOAD_HISTORY: 20,
  CONCURRENT_FETCHES: 3,
  FETCH_TIMEOUT_MS: 10000,
  THUMBNAIL_MAX_SIZE: 200,
} as const;

export const TIMING = {
  TAB_SWITCH_GRACE_MS: 2000,
  RECONNECT_DELAY_MS: 1000,
  MAX_RECONNECT_ATTEMPTS: 10,
  VISIBILITY_HIDDEN_THRESHOLD_MS: 1000,
  TAB_UPDATED_DEBOUNCE_MS: 800,
  SEEN_URLS_MAX_SIZE: 10000,
} as const;

// V2.0 Group modes
export const GROUP_MODES = {
  NONE: 'none',
  DOMAIN: 'domain',
  FORMAT: 'format',
  SIZE: 'size',
  TAB: 'tab',
} as const;

// V2.0 Layout density
export const DENSITY = {
  COMPACT: 'compact',
  STANDARD: 'standard',
  COMFORTABLE: 'comfortable',
} as const;

// V2.0 Theme
export const THEME = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
} as const;

// V2.0 Pro features
export const PRO_FEATURES = [
  'similarDetection',
  'colorExtraction',
  'reverseSearch',
  'collection',
  'multiTabExtract',
  'formatConversion',
  'batchHighlight',
  'advancedGrouping',
  'liveMonitoring',
  'unlimitedZip',
  'eagleExport',
  'aiTagging',
] as const;

// Free tier limits (degraded functionality for non-Pro users).
//
// Sprint 3.5 — relax certain caps so users get to "first wow" before the
// Pro paywall trips. The thesis (from /付费转化率拉升方案-从0到1-3): a user
// who has experienced the feature once is 5-10x more likely to convert
// than one who only saw it greyed out. Specifically:
export const VALID_REVERSE_SEARCH_ENGINES = ['google', 'tineye', 'baidu', 'yandex'] as const;

//   - MAX_ZIP_IMAGES: 20 → 30  (covers the long tail of "single page download")
//   - REVERSE_SEARCH_ENGINES: + 'tineye'  (most useful free engine after Google)
//   - MAX_COLLECTION_ITEMS: 5  (was: collection fully Pro; now 5 free favorites)
export const FREE_LIMITS = {
  MAX_ZIP_IMAGES: 50,
  MAX_BATCH_COPY_URLS: 10,
  MAX_COLLECTION_ITEMS: 10,
  MAX_MONTHLY_AI_TAGS: 5,
  MAX_EAGLE_EXPORT_PER_BATCH: 10,
  MAX_BATCH_DELETE: 15,
  MAX_BATCH_FAVORITE: 15,
  MAX_BATCH_AI_TAGS: 15,
  ALLOWED_GROUP_MODES: ['none', 'format'] as const,
  REVERSE_SEARCH_ENGINES: ['google', 'tineye'] as const,
  COLOR_EXTRACT_COPY: true,
  COLOR_EXTRACT_FILTER: true,
  MAX_MONTHLY_COLOR_COPY: 5,
  HIGHLIGHT_BATCH: false,
  LIVE_MONITORING: false,
  IMAGE_DELETE: true,
  FORMAT_CONVERSION: false,
  // "Experience paywall" strategy: after 7-day Pro trial, core features
  // are locked to Pro-only (0 free quota) to maximise loss-aversion and
  // drive trial→paid conversion. Basic features remain usable.
  CUSTOM_NAMING: false,
  MAX_MONTHLY_MULTI_TAB: 0,
  MAX_MONTHLY_DEDUP: 0,
  MAX_MONTHLY_FORMAT_CONVERT: 0,
  MAX_MONTHLY_LIVE_MONITOR: 0,
  MAX_MONTHLY_BATCH_HIGHLIGHT: 0,
  MAX_MONTHLY_DELETE: 0,
  MAX_MONTHLY_CUSTOM_NAMING: 0,
  MAX_MONTHLY_COLOR_FILTER: 0,
} as const;

/**
 * Get effective free-tier limits, merging remote config over hardcoded defaults.
 * Use this instead of accessing FREE_LIMITS directly when the value may be
 * overridden from the admin dashboard.
 *
 * Returns synchronously — uses whatever remote config is already in memory.
 * The remote config is populated by the Service Worker on startup.
 */
export function getFreeLimits(): typeof FREE_LIMITS {
  // Lazy import to avoid circular dependency at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try {
    // Dynamic import won't work synchronously, so we use a global cache
    // that remote-config.ts populates on sync.
    const remote = (globalThis as Record<string, unknown>).__remoteConfig as
      | Record<string, unknown>
      | undefined;
    if (!remote) return FREE_LIMITS;

    return {
      ...FREE_LIMITS,
      MAX_ZIP_IMAGES: (typeof remote.maxZipImages === 'number'
        ? remote.maxZipImages
        : FREE_LIMITS.MAX_ZIP_IMAGES) as typeof FREE_LIMITS.MAX_ZIP_IMAGES,
      MAX_BATCH_COPY_URLS: (typeof remote.maxBatchCopyUrls === 'number'
        ? remote.maxBatchCopyUrls
        : FREE_LIMITS.MAX_BATCH_COPY_URLS) as typeof FREE_LIMITS.MAX_BATCH_COPY_URLS,
      MAX_COLLECTION_ITEMS: (typeof remote.maxCollectionItems === 'number'
        ? remote.maxCollectionItems
        : FREE_LIMITS.MAX_COLLECTION_ITEMS) as typeof FREE_LIMITS.MAX_COLLECTION_ITEMS,
      MAX_MONTHLY_AI_TAGS: (typeof remote.maxMonthlyAiTags === 'number'
        ? remote.maxMonthlyAiTags
        : FREE_LIMITS.MAX_MONTHLY_AI_TAGS) as typeof FREE_LIMITS.MAX_MONTHLY_AI_TAGS,
      MAX_EAGLE_EXPORT_PER_BATCH: (typeof remote.maxEagleExportPerBatch === 'number'
        ? remote.maxEagleExportPerBatch
        : FREE_LIMITS.MAX_EAGLE_EXPORT_PER_BATCH) as typeof FREE_LIMITS.MAX_EAGLE_EXPORT_PER_BATCH,
      MAX_BATCH_DELETE: (typeof remote.maxBatchDelete === 'number'
        ? remote.maxBatchDelete
        : FREE_LIMITS.MAX_BATCH_DELETE) as typeof FREE_LIMITS.MAX_BATCH_DELETE,
      MAX_BATCH_FAVORITE: (typeof remote.maxBatchFavorite === 'number'
        ? remote.maxBatchFavorite
        : FREE_LIMITS.MAX_BATCH_FAVORITE) as typeof FREE_LIMITS.MAX_BATCH_FAVORITE,
      MAX_BATCH_AI_TAGS: (typeof remote.maxBatchAiTags === 'number'
        ? remote.maxBatchAiTags
        : FREE_LIMITS.MAX_BATCH_AI_TAGS) as typeof FREE_LIMITS.MAX_BATCH_AI_TAGS,
      MAX_MONTHLY_MULTI_TAB: (typeof remote.maxMonthlyMultiTab === 'number'
        ? remote.maxMonthlyMultiTab
        : FREE_LIMITS.MAX_MONTHLY_MULTI_TAB) as typeof FREE_LIMITS.MAX_MONTHLY_MULTI_TAB,
      MAX_MONTHLY_DEDUP: (typeof remote.maxMonthlyDedup === 'number'
        ? remote.maxMonthlyDedup
        : FREE_LIMITS.MAX_MONTHLY_DEDUP) as typeof FREE_LIMITS.MAX_MONTHLY_DEDUP,
      MAX_MONTHLY_FORMAT_CONVERT: (typeof remote.maxMonthlyFormatConvert === 'number'
        ? remote.maxMonthlyFormatConvert
        : FREE_LIMITS.MAX_MONTHLY_FORMAT_CONVERT) as typeof FREE_LIMITS.MAX_MONTHLY_FORMAT_CONVERT,
      MAX_MONTHLY_COLOR_COPY: (typeof remote.maxMonthlyColorCopy === 'number'
        ? remote.maxMonthlyColorCopy
        : FREE_LIMITS.MAX_MONTHLY_COLOR_COPY) as typeof FREE_LIMITS.MAX_MONTHLY_COLOR_COPY,
      MAX_MONTHLY_LIVE_MONITOR: (typeof remote.maxMonthlyLiveMonitor === 'number'
        ? remote.maxMonthlyLiveMonitor
        : FREE_LIMITS.MAX_MONTHLY_LIVE_MONITOR) as typeof FREE_LIMITS.MAX_MONTHLY_LIVE_MONITOR,
      MAX_MONTHLY_BATCH_HIGHLIGHT: (typeof remote.maxMonthlyBatchHighlight === 'number'
        ? remote.maxMonthlyBatchHighlight
        : FREE_LIMITS.MAX_MONTHLY_BATCH_HIGHLIGHT) as typeof FREE_LIMITS.MAX_MONTHLY_BATCH_HIGHLIGHT,
      MAX_MONTHLY_DELETE: (typeof remote.maxMonthlyDelete === 'number'
        ? remote.maxMonthlyDelete
        : FREE_LIMITS.MAX_MONTHLY_DELETE) as typeof FREE_LIMITS.MAX_MONTHLY_DELETE,
      MAX_MONTHLY_CUSTOM_NAMING: (typeof remote.maxMonthlyCustomNaming === 'number'
        ? remote.maxMonthlyCustomNaming
        : FREE_LIMITS.MAX_MONTHLY_CUSTOM_NAMING) as typeof FREE_LIMITS.MAX_MONTHLY_CUSTOM_NAMING,
      MAX_MONTHLY_COLOR_FILTER: (typeof remote.maxMonthlyColorFilter === 'number'
        ? remote.maxMonthlyColorFilter
        : FREE_LIMITS.MAX_MONTHLY_COLOR_FILTER) as typeof FREE_LIMITS.MAX_MONTHLY_COLOR_FILTER,
      ALLOWED_GROUP_MODES: Array.isArray(remote.allowedGroupModes)
        ? (remote.allowedGroupModes as unknown as typeof FREE_LIMITS.ALLOWED_GROUP_MODES)
        : FREE_LIMITS.ALLOWED_GROUP_MODES,
      REVERSE_SEARCH_ENGINES: Array.isArray(remote.reverseSearchEngines)
        ? (remote.reverseSearchEngines as unknown as typeof FREE_LIMITS.REVERSE_SEARCH_ENGINES)
        : FREE_LIMITS.REVERSE_SEARCH_ENGINES,
      // Boolean overrides
      CUSTOM_NAMING: (typeof remote.customNaming === 'boolean'
        ? remote.customNaming
        : FREE_LIMITS.CUSTOM_NAMING) as typeof FREE_LIMITS.CUSTOM_NAMING,
      HIGHLIGHT_BATCH: (typeof remote.highlightBatchEnabled === 'boolean'
        ? remote.highlightBatchEnabled
        : FREE_LIMITS.HIGHLIGHT_BATCH) as typeof FREE_LIMITS.HIGHLIGHT_BATCH,
      LIVE_MONITORING: (typeof remote.liveMonitorEnabled === 'boolean'
        ? remote.liveMonitorEnabled
        : FREE_LIMITS.LIVE_MONITORING) as typeof FREE_LIMITS.LIVE_MONITORING,
      FORMAT_CONVERSION: (typeof remote.formatConvertEnabled === 'boolean'
        ? remote.formatConvertEnabled
        : FREE_LIMITS.FORMAT_CONVERSION) as typeof FREE_LIMITS.FORMAT_CONVERSION,
      COLOR_EXTRACT_COPY: (typeof remote.colorExtractCopy === 'boolean'
        ? remote.colorExtractCopy
        : FREE_LIMITS.COLOR_EXTRACT_COPY) as typeof FREE_LIMITS.COLOR_EXTRACT_COPY,
      COLOR_EXTRACT_FILTER: (typeof remote.colorExtractFilter === 'boolean'
        ? remote.colorExtractFilter
        : FREE_LIMITS.COLOR_EXTRACT_FILTER) as typeof FREE_LIMITS.COLOR_EXTRACT_FILTER,
      IMAGE_DELETE: (typeof remote.imageDelete === 'boolean'
        ? remote.imageDelete
        : FREE_LIMITS.IMAGE_DELETE) as typeof FREE_LIMITS.IMAGE_DELETE,
    };
  } catch {
    return FREE_LIMITS;
  }
}

// Default filter setting for visible-only images
export const DEFAULT_SHOW_VISIBLE_ONLY = true;

// V2.0 Reverse search engines
export const SEARCH_ENGINES = {
  google: { name: 'Google Images', url: 'https://lens.google.com/uploadbyurl?url={imageUrl}' },
  tineye: { name: 'TinEye', url: 'https://tineye.com/search?url={imageUrl}' },
  baidu: {
    name: 'Baidu',
    url: 'https://graph.baidu.com/details?isfromtusdk=1&tn=pc&image={imageUrl}',
  },
  yandex: { name: 'Yandex', url: 'https://yandex.com/images/search?rpt=imageview&url={imageUrl}' },
} as const;

// V2.0 Naming template variables
export const NAMING_VARIABLES = [
  '{index}',
  '{number}',
  '{original}',
  '{title}',
  '{domain}',
  '{width}',
  '{height}',
  '{format}',
  '{date}',
  '{timestamp}',
] as const;

// Backend base URL — override via VITE_API_BASE in .env.local for local dev.
const API_BASE = import.meta.env.VITE_API_BASE || 'https://image-harvest.kyriewen.cn';

// Versioned API surface (P2-1). All extension↔backend calls go through the
// `/api/v1` prefix so the contract can evolve without breaking older installs.
// The backend serves `/api/v1/*` via a rewrite onto the same handlers as the
// legacy `/api/*` paths, so this is fully backward compatible on the wire.
const API_V1_BASE = `${API_BASE}/api/v1`;

// License & Payment
export const LICENSE_API_URL = `${API_V1_BASE}/license`;
export const PRICING_PAGE_URL = `${API_BASE}/pricing`;
export const INVITE_PAGE_URL = `${API_BASE}/invite`;

// Telemetry (anonymous, opt-in). See shared/telemetry.ts.
//   - FLUSH_INTERVAL_MS: max time a single event waits in the queue before
//     being shipped. 5s balances battery drain vs. dashboard freshness.
//   - BATCH_SIZE: high-water mark that forces an early flush. Keeps a single
//     POST body small enough that `keepalive: true` does not exceed the
//     ~64KB Chrome cap on unload-time fetches.
//   - MAX_QUEUE: hard cap on persisted retry events. Prevents a long server
//     outage from filling chrome.storage.local indefinitely.
export const TELEMETRY_API_URL = `${API_V1_BASE}/telemetry`;
export const TELEMETRY_FLUSH_INTERVAL_MS = 5_000;
export const TELEMETRY_BATCH_SIZE = 20;
export const TELEMETRY_MAX_QUEUE = 100;
export const PRICING = {
  MONTHLY: 3.99,
  YEARLY: 29.99,
  LIFETIME: 49.99,
} as const;
export const LICENSE_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  INACTIVE: 'inactive',
} as const;
export const LICENSE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
export const LICENSE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days offline grace
export const MAX_LICENSE_INSTANCES = 1;

// Public key (base64 SPKI DER, ECDSA P-256) used to verify server-signed
// license responses offline. Generate the matching keypair on the backend with
// `npm run keys:generate` and paste the printed public key here; put the
// private key in the backend's LICENSE_SIGNING_PRIVATE_KEY env var.
//
// Empty string = signing not yet provisioned. In that case the extension
// treats every license as "unsigned/legacy" and trusts the cache exactly as
// before (fully backward compatible) — no user is locked out.
export const LICENSE_PUBLIC_KEY = '';

// Eagle export (Phase 5) — local API provided by Eagle app.
export const EAGLE_API_BASE = 'http://localhost:41595';
export const EAGLE_BATCH_SIZE = 10;

// AI tagging (Phase 4) — backend API + quota.
export const AI_TAG_API_URL = `${API_V1_BASE}/ai/tag`;
export const AI_TAG_BATCH_API_URL = `${API_V1_BASE}/ai/tag-batch`;
/** Fallback Pro AI quota when remote config is unavailable. Must match backend default. */
export const AI_QUOTA_LIMIT_FALLBACK = 100;

/**
 * Get the effective Pro AI monthly quota limit from remote config,
 * falling back to the hardcoded default if remote config is unavailable.
 */
export function getProAiQuotaLimit(): number {
  const remote = (globalThis as Record<string, unknown>).__remoteConfig as
    | Record<string, unknown>
    | undefined;
  if (remote && typeof remote.proAiMonthlyQuota === 'number') {
    return remote.proAiMonthlyQuota;
  }
  return AI_QUOTA_LIMIT_FALLBACK;
}
export const AI_TAG_CATEGORIES = [
  'photo',
  'illustration',
  'icon',
  'logo',
  'ui',
  'background',
  'texture',
  'pattern',
  'screenshot',
  'diagram',
  'chart',
  'banner',
  'avatar',
  'product',
  'typography',
  'mockup',
  '3d',
  'animation',
  'gradient',
  'abstract',
] as const;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  useSidePanel: true,
  density: 'standard',
  theme: 'system',
  defaultGroup: 'none',
  specifyDownload: true,
  subfolder: '{domain}',
  filenameTemplate: 'img_{index}_{original}.{format}',
  convertFormat: 'none',
  searchAllFrames: true,
  liveMonitoring: true,
  enableMinSize: true,
  minWidth: 0,
  minHeight: 0,
  enableMaxSize: true,
  maxWidth: 99999,
  maxHeight: 99999,
  noManyFilesWarning: false,
};
