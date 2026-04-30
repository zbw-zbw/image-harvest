// Shared domain types for Image Harvest.
//
// During the migration these stay deliberately loose (lots of optional fields,
// lots of `unknown`/`any`). Tighten them in later passes once the runtime
// shape of each producer/consumer has been audited.

// ── Image item (the central data structure passed between content / bg / UI) ─
export interface ImageItem {
  id: string;
  url: string;
  /** Rendered (CSS) width on the page */
  displayWidth?: number;
  /** Rendered (CSS) height on the page */
  displayHeight?: number;
  /** Intrinsic image width */
  naturalWidth?: number;
  /** Intrinsic image height */
  naturalHeight?: number;
  estimatedSize?: number;
  format?: string;
  /** Producer category (img / background / canvas / svg / picture / ...) */
  type?: string;
  alt?: string;
  sourceDomain?: string;
  tabId?: number;
  tabTitle?: string;
  tabUrl?: string;
  tabIndex?: number;
  isCurrentTab?: boolean;
  /** Dominant colors as `#RRGGBB` strings */
  colors?: string[];
  /** Perceptual hash (64-bit binary string) */
  phash?: string | null;
}

// ── App settings (persisted to chrome.storage.local) ────────────────────────
export interface AppSettings {
  useSidePanel: boolean;
  density: 'compact' | 'standard' | 'comfortable';
  theme: 'system' | 'light' | 'dark';
  defaultGroup: 'none' | 'domain' | 'format' | 'size' | 'tab';
  specifyDownload: boolean;
  subfolder: string;
  filenameTemplate: string;
  convertFormat: 'none' | 'png' | 'jpg' | 'jpeg' | 'webp';
  searchAllFrames: boolean;
  liveMonitoring: boolean;
  enableMinSize: boolean;
  minWidth: number;
  minHeight: number;
  enableMaxSize: boolean;
  maxWidth: number;
  maxHeight: number;
  enableSimilarDetection: boolean;
  enableColorExtraction: boolean;
  noManyFilesWarning: boolean;
}

// ── Filter config ───────────────────────────────────────────────────────────
export interface FilterConfig {
  enableMinSize: boolean;
  minWidth: number;
  minHeight: number;
  enableMaxSize: boolean;
  maxWidth: number;
  maxHeight: number;
  enableAspectRatio: boolean;
  aspectRatios: string[];
  enableFormats: boolean;
  allowedFormats: string[];
  enableLiveMonitoring: boolean;
  liveDebounceMs: number;
}

// ── License ─────────────────────────────────────────────────────────────────
export type LicenseStatusValue = 'active' | 'expired' | 'inactive';

export interface LicenseData {
  licenseKey: string;
  status: LicenseStatusValue;
  plan?: string | null;
  expiresAt?: number | null;
  lastVerified?: number;
  instanceId: string;
}

export interface LicenseValidationResult {
  valid: boolean;
  status?: string;
  plan?: string | null;
  expiresAt?: number | null;
  error?: string;
}

export interface LicenseActivationResult {
  success: boolean;
  plan?: string | null;
  expiresAt?: number | null;
  error?: string;
}

export interface ProUserInfo {
  isPro: boolean;
  plan?: string | null;
  expiresAt?: number | null;
  status: LicenseStatusValue;
}

// ── Collection (IndexedDB) ──────────────────────────────────────────────────
export interface CollectionItem {
  id: string;
  url: string;
  sourceUrl?: string;
  sourceTitle?: string;
  tags?: string[];
  notes?: string;
  thumbnail?: Blob;
  fullImage?: Blob;
  createdAt: number;
  [key: string]: unknown;
}

// ── Naming template ─────────────────────────────────────────────────────────
export interface NamingVariableInput {
  url?: string;
  index?: number;
  pageTitle?: string;
  pageDomain?: string;
  width?: number;
  height?: number;
  format?: string;
  date?: string;
  timestamp?: number;
}

export type NamingVariables = Record<string, string>;

// ── Color ───────────────────────────────────────────────────────────────────
export interface RGB {
  r: number;
  g: number;
  b: number;
}

// ── Format conversion ───────────────────────────────────────────────────────
export type ConvertibleFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

export interface ConversionResult {
  dataUrl: string;
  blob: Blob;
  format: string;
}

// ── Tab image cache (chrome.storage.session) ───────────────────────────────
export interface TabImageCacheEntry {
  url: string;
  timestamp: number;
  images: ImageItem[];
}
