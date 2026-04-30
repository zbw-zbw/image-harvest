// ============================================
// State Management
// ============================================
// Sidepanel/popup central state. All mutable data lives in the `state` object
// so consumers can both read and write through a single import. The `elements`
// object is exported separately because DOM refs are filled once during init
// and read everywhere — a dedicated export keeps call-sites short.
//
// Migration note: the previous classic-script implementation relied on
// top-level `const` declarations being shared across every <script> tag in
// sidepanel.html. ESM modules don't share globals, so every consumer now
// imports `state` / `elements` explicitly.

import type {
  AppSettings,
  FilterConfig,
  ImageItem
} from '../shared/types';

// ── Filter UI state ─────────────────────────────────────────────────────────
export interface ActiveFilters {
  size: string;
  sizeMin: number;
  sizeMax: number;
  types: string[];
  layout: string;
  urlKeyword: string;
  /** null = all colors, hex string = selected */
  color: string | null;
}

// ── Per-tab cache entry ─────────────────────────────────────────────────────
export interface TabCacheEntry {
  url: string;
  images: ImageItem[];
  selectedImages: Set<string>;
}

// ── Similar-image group ─────────────────────────────────────────────────────
// A group of visually-similar images (same pHash bucket). The first element
// is treated as the representative; the rest are duplicates.
export type SimilarGroup = ImageItem[];

// ── DOM element refs (populated by cacheElements()) ─────────────────────────
// Loose typing: every entry is HTMLElement | null until accessed. Consumers
// null-check before use.
export type ElementsMap = Record<string, HTMLElement | null>;

// ── Sort / view / group enums ───────────────────────────────────────────────
export type SortMode =
  | 'size-desc'
  | 'size-asc'
  | 'filesize-desc'
  | 'filesize-asc'
  | 'type'
  | 'natural';

export type ViewMode = 'grid' | 'list';
export type GroupMode = 'none' | 'domain' | 'format' | 'size' | 'tab';

// ── The single mutable state object ─────────────────────────────────────────
export interface SidepanelState {
  // Image data
  allImages: ImageItem[];
  filteredImages: ImageItem[];
  selectedImages: Set<string>;

  /** CSV of last rendered image IDs to skip redundant innerHTML rebuilds */
  lastRenderedFilteredIds: string | null;

  // Settings & filters
  filterConfig: FilterConfig | Record<string, unknown>;
  appSettings: Partial<AppSettings> & Record<string, unknown>;
  activeFilters: ActiveFilters;

  // Grouping / sorting / view
  collapsedGroups: Set<string>;
  similarGroups: SimilarGroup[];
  currentSortMode: SortMode;
  currentViewMode: ViewMode;
  currentGroupMode: GroupMode;

  // Display mode (popup vs side panel)
  isPopupMode: boolean;

  // Per-tab cache for instant restore on tab switch
  tabCache: Map<number, TabCacheEntry>;
  currentTabId: number | null;

  // Scan / fetch lifecycle flags
  isFetching: boolean;
  isScanning: boolean;
  isSilentScanning: boolean;
  isInitialized: boolean;
  isTabSwitching: boolean;
  scanDiscoveredCount: number;
  /** Buffer for live-monitor discoveries arriving during an active scan */
  scanDiscoveredImages: ImageItem[];
  /** Max images to incrementally render (= skeleton card count) */
  scanSkeletonLimit: number;
  scanAborted: boolean;

  // Multi-tab extract lifecycle
  isMultiTabExtracting: boolean;

  // License
  isProUser: boolean;
}

export const state: SidepanelState = {
  allImages: [],
  filteredImages: [],
  selectedImages: new Set<string>(),
  lastRenderedFilteredIds: null,

  filterConfig: {},
  appSettings: {},
  activeFilters: {
    size: 'all',
    sizeMin: 0,
    sizeMax: Infinity,
    types: [],
    layout: 'all',
    urlKeyword: '',
    color: null
  },

  collapsedGroups: new Set<string>(),
  similarGroups: [],
  currentSortMode: 'size-desc',
  currentViewMode: 'list',
  currentGroupMode: 'none',

  isPopupMode: false,

  tabCache: new Map<number, TabCacheEntry>(),
  currentTabId: null,

  isFetching: false,
  isScanning: false,
  isSilentScanning: false,
  isInitialized: false,
  isTabSwitching: false,
  scanDiscoveredCount: 0,
  scanDiscoveredImages: [],
  scanSkeletonLimit: 0,
  scanAborted: false,

  isMultiTabExtracting: false,

  isProUser: false
};

// DOM refs — populated by init.ts > cacheElements()
export const elements: ElementsMap = {};
