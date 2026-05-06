// Constants for Image Harvest extension (TypeScript single source of truth).
//
// `as const` is used liberally so consumers get exact literal-union types
// instead of plain `string` when reading enum-like maps such as MESSAGE_TYPES.

import type { AppSettings, FilterConfig } from './types';

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  // Size filters
  enableMinSize: false,
  minWidth: 50,
  minHeight: 50,
  enableMaxSize: false,
  maxWidth: 8000,
  maxHeight: 8000,

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
  VALIDATE_LICENSE: 'VALIDATE_LICENSE',
  GET_LICENSE_STATUS: 'GET_LICENSE_STATUS',
  LICENSE_STATUS_CHANGED: 'LICENSE_STATUS_CHANGED',
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
  'customNaming',
  'batchHighlight',
  'advancedGrouping',
  'advancedPreview',
  'liveMonitoring',
  'imageDelete',
  'unlimitedZip',
] as const;

// Free tier limits (degraded functionality for non-Pro users).
//
// Sprint 3.5 — relax certain caps so users get to "first wow" before the
// Pro paywall trips. The thesis (from /付费转化率拉升方案-从0到1-3): a user
// who has experienced the feature once is 5-10x more likely to convert
// than one who only saw it greyed out. Specifically:
//   - MAX_ZIP_IMAGES: 20 → 30  (covers the long tail of "single page download")
//   - REVERSE_SEARCH_ENGINES: + 'tineye'  (most useful free engine after Google)
//   - MAX_COLLECTION_ITEMS: 5  (was: collection fully Pro; now 5 free favorites)
export const FREE_LIMITS = {
  MAX_ZIP_IMAGES: 30,
  // Sprint 3.4 — batch URL copy. Capped on Free to leave a Pro touchpoint;
  // Pro users bypass entirely (see actions.ts > copyImageUrls).
  MAX_BATCH_COPY_URLS: 20,
  // Sprint 3.5 — Free users now get a "tasting" amount of favorites (5)
  // before the Pro paywall trips. See pro-features.ts > addToCollection.
  MAX_COLLECTION_ITEMS: 5,
  ALLOWED_GROUP_MODES: ['none', 'format'] as const,
  REVERSE_SEARCH_ENGINES: ['google', 'tineye'] as const,
  COLOR_EXTRACT_COPY: false,
  COLOR_EXTRACT_FILTER: false,
  HIGHLIGHT_BATCH: false,
  PREVIEW_ADVANCED: false,
  LIVE_MONITORING: false,
  IMAGE_DELETE: false,
  FORMAT_CONVERSION: false,
  CUSTOM_NAMING: false,
} as const;

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

// License & Payment
export const LICENSE_API_URL = 'https://image-harvest.kyriewen.cn/api/license';
export const PRICING_PAGE_URL = 'https://image-harvest.kyriewen.cn/pricing';

// Telemetry (anonymous, opt-in). See shared/telemetry.ts.
//   - FLUSH_INTERVAL_MS: max time a single event waits in the queue before
//     being shipped. 5s balances battery drain vs. dashboard freshness.
//   - BATCH_SIZE: high-water mark that forces an early flush. Keeps a single
//     POST body small enough that `keepalive: true` does not exceed the
//     ~64KB Chrome cap on unload-time fetches.
//   - MAX_QUEUE: hard cap on persisted retry events. Prevents a long server
//     outage from filling chrome.storage.local indefinitely.
export const TELEMETRY_API_URL = 'https://image-harvest.kyriewen.cn/api/telemetry';
export const TELEMETRY_FLUSH_INTERVAL_MS = 5_000;
export const TELEMETRY_BATCH_SIZE = 20;
export const TELEMETRY_MAX_QUEUE = 100;
export const PRICING = {
  MONTHLY: 2.99,
  YEARLY: 19.99,
  LIFETIME: 39.99,
} as const;
export const LICENSE_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  INACTIVE: 'inactive',
} as const;
export const LICENSE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
export const LICENSE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days offline grace
export const MAX_LICENSE_INSTANCES = 1;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  useSidePanel: true,
  density: 'standard',
  theme: 'system',
  defaultGroup: 'none',
  specifyDownload: true,
  subfolder: '{domain}',
  filenameTemplate: 'img_{index}_{original}.{format}',
  convertFormat: 'none',
  searchAllFrames: false,
  liveMonitoring: true,
  enableMinSize: false,
  minWidth: 50,
  minHeight: 50,
  enableMaxSize: false,
  maxWidth: 8000,
  maxHeight: 8000,
  enableSimilarDetection: true,
  enableColorExtraction: true,
  noManyFilesWarning: false,
};
