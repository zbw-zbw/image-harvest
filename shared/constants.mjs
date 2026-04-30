// Constants for Image Harvest extension (ES Module version for background/popup)

export const DEFAULT_FILTER_CONFIG = {
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
  liveDebounceMs: 500
};

export const ASPECT_RATIOS = {
  square: { min: 0.9, max: 1.1, label: 'Square' },
  landscape: { min: 1.1, max: 2.5, label: 'Landscape' },
  portrait: { min: 0.4, max: 0.9, label: 'Portrait' },
  panorama: { min: 2.5, max: 10, label: 'Panorama' }
};

export const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'];

export const STORAGE_KEYS = {
  FILTER_CONFIG: 'filterConfig',
  DOWNLOAD_HISTORY: 'downloadHistory',
  SESSION_STATE: 'sessionState',
  APP_SETTINGS: 'appSettings',
  COLLECTION: 'collection',
  LICENSE_DATA: 'licenseData',
  INSTANCE_ID: 'instanceId'
};

export const MESSAGE_TYPES = {
  // Popup to Background
  GET_IMAGES: 'GET_IMAGES',
  DOWNLOAD_ZIP: 'DOWNLOAD_ZIP',
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
  LICENSE_STATUS_CHANGED: 'LICENSE_STATUS_CHANGED'
};

export const ERROR_CODES = {
  CSP_BLOCKED: 'CSP_BLOCKED',
  TIMEOUT: 'TIMEOUT',
  CORS_DENIED: 'CORS_DENIED',
  MEMORY_LIMIT: 'MEMORY_LIMIT',
  NO_IMAGES: 'NO_IMAGES',
  INJECTION_FAILED: 'INJECTION_FAILED'
};

export const LIMITS = {
  MAX_IMAGES_PER_SCAN: 1000,
  MAX_THUMBNAIL_MEMORY_MB: 50,
  MAX_ZIP_SIZE_MB: 500,
  MAX_DOWNLOAD_HISTORY: 20,
  CONCURRENT_FETCHES: 3,
  FETCH_TIMEOUT_MS: 10000,
  THUMBNAIL_MAX_SIZE: 200
};

// V2.0 Group modes
export const GROUP_MODES = {
  NONE: 'none',
  DOMAIN: 'domain',
  FORMAT: 'format',
  SIZE: 'size',
  TAB: 'tab'
};

// V2.0 Layout density
export const DENSITY = {
  COMPACT: 'compact',
  STANDARD: 'standard',
  COMFORTABLE: 'comfortable'
};

// V2.0 Theme
export const THEME = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark'
};

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
  'unlimitedZip'
];

// Free tier limits (degraded functionality for non-Pro users)
export const FREE_LIMITS = {
  MAX_ZIP_IMAGES: 20,                    // Max images per ZIP download
  ALLOWED_GROUP_MODES: ['none', 'format'], // Only None and Format grouping
  REVERSE_SEARCH_ENGINES: ['google'],     // Only Google for free users
  COLOR_EXTRACT_COPY: false,              // Cannot copy HEX values
  COLOR_EXTRACT_FILTER: false,            // Cannot filter by color
  HIGHLIGHT_BATCH: false,                 // No batch highlight sync
  PREVIEW_ADVANCED: false,                // No zoom/navigation/info panel
  LIVE_MONITORING: false,                 // No live monitoring
  IMAGE_DELETE: false,                    // Cannot delete images from list
  FORMAT_CONVERSION: false,               // No format conversion
  CUSTOM_NAMING: false                    // No custom naming template
};

// V2.0 Reverse search engines
export const SEARCH_ENGINES = {
  google: { name: 'Google Images', url: 'https://lens.google.com/uploadbyurl?url={imageUrl}' },
  tineye: { name: 'TinEye', url: 'https://tineye.com/search?url={imageUrl}' },
  baidu: { name: 'Baidu', url: 'https://graph.baidu.com/details?isfromtusdk=1&tn=pc&image={imageUrl}' },
  yandex: { name: 'Yandex', url: 'https://yandex.com/images/search?rpt=imageview&url={imageUrl}' }
};

// V2.0 Naming template variables
export const NAMING_VARIABLES = [
  '{index}', '{number}', '{original}', '{title}', '{domain}',
  '{width}', '{height}', '{format}', '{date}', '{timestamp}'
];

// V2.0 Default app settings
// License & Payment
export const LICENSE_API_URL = 'https://image-harvest.kyriewen.cn/api/license';
export const PRICING_PAGE_URL = 'https://image-harvest.kyriewen.cn/pricing';
export const PRICING = {
  MONTHLY: 2.99,
  YEARLY: 19.99,
  LIFETIME: 39.99
};
export const LICENSE_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  INACTIVE: 'inactive'
};
export const LICENSE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
export const LICENSE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days offline grace
export const MAX_LICENSE_INSTANCES = 1;

export const DEFAULT_APP_SETTINGS = {
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
  noManyFilesWarning: false
};
