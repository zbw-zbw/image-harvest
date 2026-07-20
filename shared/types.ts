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
  /** AI-generated category tags (e.g. "photo", "icon", "logo") */
  aiTags?: string[];
  /** Whether the image element is visible in the page viewport */
  visible?: boolean;

  // ── Runtime fields (injected by content script / sidepanel) ─────────
  /** Selection state for batch operations */
  checked?: boolean;
  /** Discovery timestamp (ms) for sort-by-time */
  timestamp?: number;
  /** Whether the image is currently being downloaded */
  downloading?: boolean;
  /** Whether the image is marked as favorite / in collection */
  favorite?: boolean;
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
  /** Base64 ECDSA-P256 signature from the server (tamper-evidence). */
  signature?: string;
  /** epoch ms the server signed at; part of the signed payload. */
  signedAt?: number;
}

export interface LicenseValidationResult {
  valid: boolean;
  status?: string;
  plan?: string | null;
  expiresAt?: number | null;
  error?: string;
  /** Base64 ECDSA-P256 signature (present when the server has a signing key). */
  signature?: string;
  signedAt?: number;
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
  inGracePeriod?: boolean;
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

// ── Telemetry (anonymous, opt-in) ──────────────────────────────────────────
//
// Design constraints (see implementation_plan.md → "User Review Required"):
//   - Completely anonymous: NO url / page title / image url / IP / user-id.
//   - `instanceIdHash` is a one-way digest of the per-installation id created
//     by getOrCreateInstanceId() — used only for de-duplication.
//   - Props are a small whitelisted bag of primitives (string | number |
//     boolean). Avoid nested objects so the receiver can flatten cheaply.
//   - The event NAME is a plain string here (not a union) so the SDK stays
//     decoupled from the constants module — `EVENTS` in
//     shared/telemetry-events.ts is the source of truth callers should import.

export type TelemetryPropValue = string | number | boolean;
export type TelemetryProps = Record<string, TelemetryPropValue>;

/** A single event captured locally before it ships. */
export interface TelemetryEvent {
  /** Event name. MUST match a key in shared/telemetry-events.ts EVENTS. */
  event: string;
  /** Unix epoch ms at the moment the event was emitted (client clock). */
  ts: number;
  /** Optional per-event payload. Shape constrained by EVENT_PROP_SCHEMAS. */
  props?: TelemetryProps;
}

/**
 * The on-the-wire envelope: a batch of events plus the small set of stable
 * dimensions that apply to all events in the batch. The server enriches this
 * with `received_at` (and discards IP after country lookup).
 */
export interface TelemetryEnvelope {
  /** SHA-256(instanceId) truncated to 16 hex chars. Stable per install. */
  instanceIdHash: string;
  /** Extension version, e.g. "1.0.1". */
  version: string;
  /** UI locale at send time, e.g. "en", "zh-CN". */
  lang: string;
  /** Pro plan tag at send time: "free" | "monthly" | "yearly" | "lifetime" | "trial". */
  plan: string;
  /** Schema version of the envelope itself; bump when this shape changes. */
  schemaVersion: 1;
  /** Batch of events (max ~50 per request after batching). */
  events: TelemetryEvent[];
}

/** Server-side ack. Kept tiny on purpose. */
export interface TelemetryAck {
  ok: boolean;
  /** Number of events the server actually persisted (after whitelist drop). */
  accepted?: number;
  /** Optional human-readable error for client logs. */
  error?: string;
}
