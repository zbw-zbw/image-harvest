// Utility functions for Image Harvest

// Use var instead of const to allow re-injection without "already declared" errors
// (e.g. when the extension is reloaded while a page is still open)

/**
 * Generate a unique ID from a URL using simple hash
 */
function generateId(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + Date.now().toString(36);
}

/**
 * Resolve a relative URL to absolute
 */
function resolveUrl(url, base = window.location.href) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * Normalize format variants to standard format names.
 * e.g. 'awebp' -> 'webp', 'jpeg' -> 'jpg', 'apng' -> 'png'
 */
function normalizeFormat(ext) {
  const formatAliases = {
    'jpeg': 'jpg',
    'jfif': 'jpg',
    'pjpeg': 'jpg',
    'pjp': 'jpg',
    'awebp': 'webp',
    'apng': 'png',
    'tif': 'tiff',
    'heif': 'heic',
    'svgz': 'svg',
    'cur': 'ico',
  };
  const lower = ext.toLowerCase();
  return formatAliases[lower] || lower;
}

/**
 * Known image extensions for direct matching (including variants).
 */
var IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp',
  'png', 'apng',
  'webp', 'awebp',
  'gif',
  'svg', 'svgz',
  'bmp',
  'ico', 'cur',
  'avif',
  'tiff', 'tif',
  'heic', 'heif',
];

/**
 * Build a regex pattern string from the known image extensions list.
 */
function buildExtensionPattern() {
  return IMAGE_EXTENSIONS.join('|');
}

/**
 * Extract file extension from URL or content type
 */
function getFileFormat(url, contentType = '') {
  // Handle data URIs — extract format from MIME type
  if (isDataUri(url)) {
    return getDataUriFormat(url);
  }

  // Try content type first
  if (contentType) {
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico',
      'image/avif': 'avif',
      'image/tiff': 'tiff',
      'image/heic': 'heic',
      'image/heif': 'heic',
      'image/apng': 'png',
    };
    for (const [mime, ext] of Object.entries(mimeMap)) {
      if (contentType.includes(mime)) return ext;
    }
  }
  
  var extPattern = buildExtensionPattern();
  var endOfStr = String.fromCharCode(36);
  
  // Try URL pathname extension (matches last dot-extension before query string)
  try {
    var urlObj = new URL(url);
    var pathname = urlObj.pathname.toLowerCase();
    var match = pathname.match(new RegExp('[.](' + extPattern + ')(?:[?#].*)?' + endOfStr));
    if (match) return normalizeFormat(match[1]);
  } catch (e) {
    // Invalid URL, try regex on raw string
    var match2 = url.match(new RegExp('[.](' + extPattern + ')', 'i'));
    if (match2) return normalizeFormat(match2[1]);
  }
  
  return 'unknown';
}

/**
 * Extract domain from URL
 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format dimensions
 */
function formatDimensions(width, height) {
  return `${width}×${height}`;
}

/**
 * Check if URL is a data URI
 */
function isDataUri(url) {
  return url.startsWith('data:');
}

/**
 * Check if a data URI represents an image
 */
function isImageDataUri(url) {
  if (!isDataUri(url)) return false;
  return /^data:image\//i.test(url);
}

/**
 * Extract MIME type from a data URI
 * e.g. "data:image/png;base64,..." -> "image/png"
 */
function getDataUriMimeType(dataUri) {
  const match = dataUri.match(/^data:([^;,]+)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Extract format from a data URI based on its MIME type
 */
function getDataUriFormat(dataUri) {
  const mime = getDataUriMimeType(dataUri);
  const mimeToFormat = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'image/avif': 'avif',
    'image/tiff': 'tiff',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'image/apng': 'png',
  };
  return mimeToFormat[mime] || 'unknown';
}

/**
 * Generate a short stable hash for a data URI to use as a unique key.
 * We hash only the first 200 + last 100 chars to keep it fast for large data URIs.
 */
function generateDataUriKey(dataUri) {
  const sample = dataUri.length > 300
    ? dataUri.slice(0, 200) + dataUri.slice(-100)
    : dataUri;
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'datauri_' + Math.abs(hash).toString(36) + '_' + dataUri.length.toString(36);
}

/**
 * Estimate the byte size of a data URI's payload
 */
function estimateDataUriSize(dataUri) {
  const commaIndex = dataUri.indexOf(',');
  if (commaIndex === -1) return 0;
  const payload = dataUri.slice(commaIndex + 1);
  const isBase64 = dataUri.slice(0, commaIndex).includes('base64');
  if (isBase64) {
    // Base64 encodes 3 bytes into 4 chars
    const padding = (payload.match(/=+$/) || [''])[0].length;
    return Math.floor((payload.length * 3) / 4) - padding;
  }
  return payload.length;
}

/**
 * Extract URLs from CSS background-image value
 */
function extractBackgroundUrls(cssValue) {
  if (!cssValue || cssValue === 'none') return [];
  
  const urls = [];
  const regex = /url\(['"]?([^'"\)]+)['"]?\)/g;
  let match;
  
  while ((match = regex.exec(cssValue)) !== null) {
    urls.push(match[1]);
  }
  
  return urls;
}

/**
 * Check if URL is a gradient
 */
function isGradient(url) {
  return /^(linear|radial|conic)-gradient\(/i.test(url);
}

/**
 * Get aspect ratio category
 */
function getAspectRatio(width, height) {
  if (!width || !height) return null;
  const ratio = width / height;
  
  if (ratio >= 0.9 && ratio <= 1.1) return 'square';
  if (ratio > 1.1 && ratio <= 2.5) return 'landscape';
  if (ratio >= 0.4 && ratio < 0.9) return 'portrait';
  if (ratio > 2.5) return 'panorama';
  return null;
}

/**
 * Debounce function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function
 */
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Generate filename for download
 */
function generateFilename(url, index, format = null) {
  const ext = format || getFileFormat(url);
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const paddedIndex = String(index + 1).padStart(3, '0');
  return `image_${timestamp}_${paddedIndex}.${ext}`;
}

/**
 * Simple EventEmitter implementation
 * Use var + class expression to allow re-injection without "already declared" errors
 */
var EventEmitter = class {
  constructor() {
    this.events = {};
  }
  
  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return () => this.off(event, listener);
  }
  
  off(event, listener) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listener);
  }
  
  emit(event, ...args) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => listener(...args));
  }
  
  once(event, listener) {
    const onceListener = (...args) => {
      this.off(event, onceListener);
      listener(...args);
    };
    this.on(event, onceListener);
  }
}

/**
 * Deep merge objects
 */
/**
 * Check if a URL is a restricted browser page where content scripts cannot run
 */
var RESTRICTED_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^chrome-error:\/\//,
  /^edge:\/\//,
  /^about:/,
  /^devtools:\/\//,
  /^view-source:/,
  /^chrome-search:\/\//,
  /^chrome-untrusted:\/\//,
  /^data:/,
  /^blob:/,
  /^https?:\/\/chrome\.google\.com\/webstore/,
  /^https?:\/\/chromewebstore\.google\.com/,
  /^https?:\/\/microsoftedge\.microsoft\.com\/addons/,
  /^https?:\/\/addons\.mozilla\.org/
];

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_URL_PATTERNS.some(pattern => pattern.test(url));
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}
