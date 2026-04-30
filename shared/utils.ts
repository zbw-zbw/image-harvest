// Utility functions for Image Harvest.

export function generateId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + Date.now().toString(36);
}

export function resolveUrl(
  url: string,
  base: string = typeof window !== 'undefined' ? window.location.href : ''
): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** Normalize format variants to standard format names. */
function normalizeFormat(ext: string): string {
  const formatAliases: Record<string, string> = {
    jpeg: 'jpg',
    jfif: 'jpg',
    pjpeg: 'jpg',
    pjp: 'jpg',
    awebp: 'webp',
    apng: 'png',
    tif: 'tiff',
    heif: 'heic',
    svgz: 'svg',
    cur: 'ico'
  };
  const lower = ext.toLowerCase();
  return formatAliases[lower] || lower;
}

const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp',
  'png', 'apng',
  'webp', 'awebp',
  'gif',
  'svg', 'svgz',
  'bmp',
  'ico', 'cur',
  'avif',
  'tiff', 'tif',
  'heic', 'heif'
] as const;

function buildExtensionPattern(): string {
  return IMAGE_EXTENSIONS.join('|');
}

export function getFileFormat(url: string, contentType: string = ''): string {
  if (isDataUri(url)) {
    return getDataUriFormat(url);
  }

  if (contentType) {
    const mimeMap: Record<string, string> = {
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
      'image/apng': 'png'
    };
    for (const [mime, ext] of Object.entries(mimeMap)) {
      if (contentType.includes(mime)) return ext;
    }
  }

  const extPattern = buildExtensionPattern();
  const endOfStr = String.fromCharCode(36);

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const match = pathname.match(new RegExp('[.](' + extPattern + ')(?:[?#].*)?' + endOfStr));
    if (match) return normalizeFormat(match[1]);
  } catch {
    const match2 = url.match(new RegExp('[.](' + extPattern + ')', 'i'));
    if (match2) return normalizeFormat(match2[1]);
  }

  return 'unknown';
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export function formatDimensions(width: number, height: number): string {
  return `${width}×${height}`;
}

export function isDataUri(url: string | null | undefined): boolean {
  return !!url && url.startsWith('data:');
}

export function isImageDataUri(url: string | null | undefined): boolean {
  if (!isDataUri(url)) return false;
  return /^data:image\//i.test(url as string);
}

export function getDataUriMimeType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;,]+)/);
  return match ? match[1].toLowerCase() : '';
}

export function getDataUriFormat(dataUri: string): string {
  const mime = getDataUriMimeType(dataUri);
  const mimeToFormat: Record<string, string> = {
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
    'image/apng': 'png'
  };
  return mimeToFormat[mime] || 'unknown';
}

export function generateDataUriKey(dataUri: string): string {
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

export function estimateDataUriSize(dataUri: string): number {
  const commaIndex = dataUri.indexOf(',');
  if (commaIndex === -1) return 0;
  const payload = dataUri.slice(commaIndex + 1);
  const isBase64 = dataUri.slice(0, commaIndex).includes('base64');
  if (isBase64) {
    const padding = (payload.match(/=+$/) || [''])[0].length;
    return Math.floor((payload.length * 3) / 4) - padding;
  }
  return payload.length;
}

export function extractBackgroundUrls(cssValue: string | null | undefined): string[] {
  if (!cssValue || cssValue === 'none') return [];

  const urls: string[] = [];
  const regex = /url\(['"]?([^'")]+)['"]?\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cssValue)) !== null) {
    urls.push(match[1]);
  }

  return urls;
}

export function isGradient(url: string): boolean {
  return /^(linear|radial|conic)-gradient\(/i.test(url);
}

export type AspectCategory = 'square' | 'landscape' | 'portrait' | 'panorama' | null;

export function getAspectRatio(width: number, height: number): AspectCategory {
  if (!width || !height) return null;
  const ratio = width / height;

  if (ratio >= 0.9 && ratio <= 1.1) return 'square';
  if (ratio > 1.1 && ratio <= 2.5) return 'landscape';
  if (ratio >= 0.4 && ratio < 0.9) return 'portrait';
  if (ratio > 2.5) return 'panorama';
  return null;
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return function executedFunction(...args: Parameters<T>): void {
    const later = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      func(...args);
    };
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function (this: unknown, ...args: Parameters<T>): void {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export function generateFilename(url: string, index: number, format: string | null = null): string {
  const ext = format || getFileFormat(url);
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const paddedIndex = String(index + 1).padStart(3, '0');
  return `image_${timestamp}_${paddedIndex}.${ext}`;
}

export class EventEmitter<E extends Record<string, unknown[]> = Record<string, unknown[]>> {
  private events: Partial<Record<keyof E, Array<(...args: unknown[]) => void>>> = {};

  on<K extends keyof E>(event: K, listener: (...args: E[K]) => void): () => void {
    const list = (this.events[event] ||= []);
    list.push(listener as (...args: unknown[]) => void);
    return () => this.off(event, listener);
  }

  off<K extends keyof E>(event: K, listener: (...args: E[K]) => void): void {
    const list = this.events[event];
    if (!list) return;
    this.events[event] = list.filter((l) => l !== (listener as (...args: unknown[]) => void));
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    const list = this.events[event];
    if (!list) return;
    list.forEach((listener) => listener(...args));
  }

  once<K extends keyof E>(event: K, listener: (...args: E[K]) => void): void {
    const onceListener = (...args: E[K]) => {
      this.off(event, onceListener);
      listener(...args);
    };
    this.on(event, onceListener);
  }
}

const RESTRICTED_URL_PATTERNS: RegExp[] = [
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

export function isRestrictedUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const output: Record<string, any> = { ...target };
  for (const key in source) {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge((target as any)[key] || {}, value as any);
    } else {
      output[key] = value;
    }
  }
  return output as T;
}
