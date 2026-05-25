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

import type { AppSettings, FilterConfig, ImageItem } from '../shared/types';
import { DEFAULT_APP_SETTINGS, DEFAULT_FILTER_CONFIG } from '../shared/constants';

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

  // ── Runtime (session-local) custom size filter ──────────────────────────
  // These are initialised from appSettings on every panel open via
  // syncCustomSizeInputsFromSettings(). Toolbar size-input edits only
  // mutate these fields — they never touch appSettings or chrome.storage,
  // so the global defaults stay intact for the next session.
  customMinEnabled: boolean;
  customMinWidth: number;
  customMinHeight: number;
  customMaxEnabled: boolean;
  customMaxWidth: number;
  customMaxHeight: number;

  // File size (KB) filter
  fileSizeEnabled: boolean;
  fileSizePreset: string;
  minFileSizeKB: number;
  maxFileSizeKB: number;
}

// ── Per-tab cache entry ─────────────────────────────────────────────────────
export interface TabCacheEntry {
  url: string;
  images: ImageItem[];
  selectedImages: Set<string>;
  /** Cached filtered result so tab-switch fast path can skip applyFilters(). */
  filteredImages?: ImageItem[];
  /** Matches state.lastRenderedFilteredIds at the time of caching. */
  lastRenderedFilteredIds?: string | null;
  /** Cached similar-image groups so tab-switch restores the correct count. */
  similarGroups?: SimilarGroup[];
}

// ── Similar-image group ─────────────────────────────────────────────────────
// A group of visually-similar images (same pHash bucket). The first element
// is treated as the representative; the rest are duplicates.
export type SimilarGroup = ImageItem[];

// ── DOM element refs (populated by cacheElements()) ─────────────────────────
// Each key is the camelCase form of the underlying element id (e.g. 'btn-refresh'
// → 'btnRefresh'). Refs are populated once in init.ts > cacheElements() and
// remain stable for the life of the panel. Consumers MUST null-check because
// markup variants (e.g. popup vs side-panel) may omit some elements.
export interface ElementsMap {
  // Layout & state containers
  imageGrid: HTMLElement | null;
  loadingState: HTMLElement | null;
  emptyState: HTMLElement | null;
  errorState: HTMLElement | null;
  restrictedState: HTMLElement | null;

  // Modals
  settingsModal: HTMLElement | null;
  progressModal: HTMLElement | null;
  dedupModal: HTMLElement | null;
  collectionModal: HTMLElement | null;
  multitabModal: HTMLElement | null;
  scanOverlay: HTMLElement | null;

  // Toast
  toastContainer: HTMLElement | null;

  // Status bar (counts)
  selectedCount: HTMLElement | null;
  totalCount: HTMLElement | null;
  foundInfo: HTMLElement | null;
  foundActionCount: HTMLElement | null;
  foundCount: HTMLElement | null;
  similarCount: HTMLElement | null;
  downloadCount: HTMLElement | null;
  downloadLabel: HTMLElement | null;

  // Toolbar buttons
  btnDownload: HTMLElement | null;
  btnDownloadToggle: HTMLElement | null;
  btnSelectAll: HTMLElement | null;
  btnRefresh: HTMLElement | null;
  btnViewToggle: HTMLElement | null;
  btnSettings: HTMLElement | null;
  btnCollection: HTMLElement | null;
  btnDedup: HTMLElement | null;
  btnMultitab: HTMLElement | null;

  // Download dropdown
  downloadDropdown: HTMLElement | null;
  downloadGroup: HTMLElement | null;

  // Group / view / filter controls
  groupMode: HTMLElement | null;
  filterUrlInput: HTMLElement | null;
  reverseSearchMenu: HTMLElement | null;
  liveIndicator: HTMLElement | null;

  // Modal bodies / sub-content
  dedupBody: HTMLElement | null;
  collectionBody: HTMLElement | null;
  multitabList: HTMLElement | null;
  collectionSearch: HTMLElement | null;

  // Settings modal: action buttons
  btnSaveSettings: HTMLElement | null;
  btnResetDefaults: HTMLElement | null;
  btnSettingsClose: HTMLElement | null;

  // Settings modal: per-row controls
  settingSidePanel: HTMLElement | null;
  settingDensity: HTMLElement | null;
  settingTheme: HTMLElement | null;
  settingDefaultGroup: HTMLElement | null;
  settingDownloadOptions: HTMLElement | null;
  settingSubfolder: HTMLElement | null;
  settingFilename: HTMLElement | null;
  settingConvert: HTMLElement | null;
  settingAllFrames: HTMLElement | null;
  settingLiveMonitor: HTMLElement | null;
  settingMinSize: HTMLElement | null;
  settingMinWidth: HTMLElement | null;
  settingMinHeight: HTMLElement | null;
  settingMaxSize: HTMLElement | null;
  settingMaxWidth: HTMLElement | null;
  settingMaxHeight: HTMLElement | null;
  settingSimilarDetection: HTMLElement | null;
  settingColorExtract: HTMLElement | null;
  settingNoWarning: HTMLElement | null;

  // Modal close / cancel buttons
  btnDedupClose: HTMLElement | null;
  btnCancelDedup: HTMLElement | null;
  btnRemoveDuplicates: HTMLElement | null;
  btnMultitabClose: HTMLElement | null;
  btnCancelMultitab: HTMLElement | null;
  btnStartExtraction: HTMLElement | null;
  btnCollectionBack: HTMLElement | null;
  btnCollectionExport: HTMLElement | null;
  btnProgressClose: HTMLElement | null;

  // Progress modal
  progressFill: HTMLElement | null;
  progressText: HTMLElement | null;
  progressCurrent: HTMLElement | null;

  // Scan overlay
  scanProgressFill: HTMLElement | null;
  scanProgressText: HTMLElement | null;
  scanProgressTitle: HTMLElement | null;
  scanProgressCurrent: HTMLElement | null;
  btnScanCancel: HTMLElement | null;

  // Escape hatch for late-bound elements not yet listed above. Avoids forcing
  // a state.ts edit for every new id; should be removed once all consumers
  // are migrated to the typed keys.
  [key: string]: HTMLElement | null;
}

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

// ── UI screen / overlay state ───────────────────────────────────────────────
// Modeled after the four mutually-exclusive "main area" states the previous
// imperative `showEmpty / showError / showRestricted / showLoading` toggled.
// A single discriminator field lets the Preact <StateScreens> render the
// correct view without us having to coordinate four classList toggles.
export type UiScreen = 'images' | 'empty' | 'error' | 'restricted';

export interface ErrorScreenInfo {
  code: string;
  message: string;
  workaround?: string;
}

export interface EmptyScreenInfo {
  /** "no results after filtering" vs "no images on this page at all". */
  isNoResults: boolean;
  /** Number of images hidden by current filters (shown as hint). */
  hiddenCount?: number;
}

export interface ScanProgressState {
  visible: boolean;
  /** When true, hide the percentage progress bar (still shows spinner). */
  indeterminate: boolean;
  title: string;
  current: number;
  total: number;
  /** URL of the tab/frame currently being scanned, shown as a tooltip. */
  currentUrl: string;
}

export interface DownloadProgressState {
  visible: boolean;
  title: string;
  current: number;
  total: number;
  currentFile: string;
  /**
   * For multi-tab scans we want to surface "X tabs · Y images found"; for
   * single-list downloads it's just "X / Y". `null` toggles between the two.
   */
  imageCount: number | null;
}

// ── Toast notifications ─────────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'warning' | 'info';
export interface ToastItem {
  /** Stable id for Preact's reconciliation key; auto-generated on push. */
  id: number;
  message: string;
  type: ToastType;
  /** When true the component should add a `fade-out` class for CSS animation. */
  fadingOut: boolean;
}

// ── Generic modal visibility ────────────────────────────────────────────────
// The four "independent" modals (Dedup / Collection / Multitab / ProUpgrade)
// each have inner contents that are still rendered imperatively (innerHTML +
// querySelector) for now. The Preact migration here only takes ownership of
// the modal *shell*: the wrapper div, the modal-content, header + close
// button. The inner `.modal-body` contents stay as a static slot that the
// existing imperative renderers continue to populate.
//
// `errorText` is included on ProUpgradeModal because the activation flow
// surfaces a one-line error under the input — moving it into the store lets
// us drive the visibility class declaratively.
export interface ModalState {
  open: boolean;
}
export interface ProUpgradeModalState extends ModalState {
  errorText: string;
}

// ── Confirm dialog ──────────────────────────────────────────────────────────
// The previous `showConfirmDialog` directly bound DOM listeners and resolved
// a Promise via closure. We keep the Promise pattern but move the dialog
// config + resolver into the store so a single Preact <ConfirmDialog> can
// render any active prompt declaratively.
export type ConfirmDialogType = 'warning' | 'danger' | 'info';
export interface ConfirmDialogConfig {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  type: ConfirmDialogType;
}
export interface ConfirmDialogState {
  open: boolean;
  config: ConfirmDialogConfig | null;
  /**
   * Resolver kept on the state object (not closed-over) so the component
   * click handlers can resolve regardless of which call originated the
   * dialog. Cleared on close.
   */
  resolve: ((ok: boolean) => void) | null;
}

// ── The single mutable state object ─────────────────────────────────────────
export interface SidepanelState {
  // Image data
  allImages: ImageItem[];
  filteredImages: ImageItem[];
  selectedImages: Set<string>;

  /** CSV of last rendered image IDs to skip redundant innerHTML rebuilds */
  lastRenderedFilteredIds: string | null;

  // Settings & filters
  filterConfig: FilterConfig;
  appSettings: AppSettings;
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
  /**
   * Number of skeleton placeholders to append after real cards in <ImageGrid>.
   * Set by showLoading() and cleared when a real render completes. Drives
   * the Preact-managed grid's "loading" state without needing imperative
   * innerHTML writes.
   */
  scanSkeletonsToShow: number;
  scanAborted: boolean;

  // Multi-tab extract lifecycle
  isMultiTabExtracting: boolean;

  // License
  isProUser: boolean;
  inTrialGracePeriod: boolean;
  trialGraceDaysRemaining: number;

  // ── Preact-managed UI screens (replaces classList toggles) ───────────────
  /** Which "main area" view is active. Mutually exclusive with itself. */
  uiScreen: UiScreen;
  /** Payload for <ErrorScreen>; null means use the static fallback markup. */
  errorInfo: ErrorScreenInfo | null;
  /** Payload for <EmptyScreen>; controls title + reset button label. */
  emptyInfo: EmptyScreenInfo;
  /** Reactive replacement for showScanOverlay/updateScanProgress. */
  scanProgress: ScanProgressState;
  /** Reactive replacement for showProgress/updateProgress (download modal). */
  downloadProgress: DownloadProgressState;
  /**
   * License plan + expiry returned by GET_LICENSE_STATUS. Used by the
   * <ProStatusBadge> to render the "Monthly / Yearly / Lifetime" label and
   * the expiry date. Imported here as a structural type to avoid a circular
   * dependency with the component file.
   */
  proLicenseInfo: {
    plan: string;
    expiresAt?: number | string;
  } | null;

  /** Active toast notifications rendered by <ToastContainer>. */
  toasts: ToastItem[];
  /** Active confirm dialog (or `open: false` when nothing is showing). */
  confirmDialog: ConfirmDialogState;

  // ── Independent modals (shell visibility only — body still imperative) ───
  dedupModalState: ModalState;
  collectionModalState: ModalState;
  multitabModalState: ModalState;
  proUpgradeModalState: ProUpgradeModalState;
  /**
   * Settings modal — shell-only migration. The body subtree is moved
   * verbatim from the legacy HTML into the Preact-rendered shell at mount
   * time so the existing 47 imperative getElementById call sites in
   * settings.ts continue to work unchanged.
   */
  settingsModalState: ModalState;
  /**
   * Privacy opt-in modal — shown exactly once per install on first
   * sidepanel open. Drives the user's choice into telemetry.setOptIn().
   * The "decided" flag lives in chrome.storage.local; this state field
   * only controls in-memory visibility for the current session.
   */
  privacyOptInModalState: ModalState;

  /**
   * Monotonically-increasing counter bumped every time the runtime locale
   * changes (via Settings → language switch). Preact components that call
   * `t()` subscribe to this field so they re-render with the new translations
   * without needing a panel reload.
   */
  localeTick: number;
}

// ── Initial state value ─────────────────────────────────────────────────────
// Kept as a separate const so tests / future hot-reload can re-create a
// pristine state object without re-importing the whole module.
function createInitialState(): SidepanelState {
  return {
    allImages: [],
    filteredImages: [],
    selectedImages: new Set<string>(),
    lastRenderedFilteredIds: null,

    // Typed defaults — real values are layered on top once chrome.storage
    // resolves in init.ts > loadSettings().
    filterConfig: { ...DEFAULT_FILTER_CONFIG },
    appSettings: { ...DEFAULT_APP_SETTINGS },
    activeFilters: {
      size: 'all',
      sizeMin: 0,
      sizeMax: Infinity,
      types: [],
      layout: 'all',
      urlKeyword: '',
      color: null,
      // Runtime custom size — initialised from appSettings each session
      customMinEnabled: true,
      customMinWidth: 0,
      customMinHeight: 0,
      customMaxEnabled: true,
      customMaxWidth: 99999,
      customMaxHeight: 99999,
      fileSizeEnabled: false,
      fileSizePreset: 'all',
      minFileSizeKB: 0,
      maxFileSizeKB: Infinity,
    },

    collapsedGroups: new Set<string>(),
    similarGroups: [],
    currentSortMode: 'natural',
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
    scanSkeletonsToShow: 0,
    scanAborted: false,

    isMultiTabExtracting: false,

    isProUser: false,
    inTrialGracePeriod: false,
    trialGraceDaysRemaining: 0,

    uiScreen: 'images',
    errorInfo: null,
    emptyInfo: { isNoResults: false },
    scanProgress: {
      visible: false,
      indeterminate: false,
      title: 'Scanning...',
      current: 0,
      total: 0,
      currentUrl: '',
    },
    downloadProgress: {
      visible: false,
      title: 'Downloading...',
      current: 0,
      total: 0,
      currentFile: '',
      imageCount: null,
    },
    proLicenseInfo: null,
    toasts: [],
    confirmDialog: { open: false, config: null, resolve: null },
    dedupModalState: { open: false },
    collectionModalState: { open: false },
    multitabModalState: { open: false },
    proUpgradeModalState: { open: false, errorText: '' },
    settingsModalState: { open: false },
    privacyOptInModalState: { open: false },
    localeTick: 0,
  };
}

// ============================================================================
// Reactive store
// ============================================================================
// We can't drop a real flux/zustand store in here — the codebase has 100+
// direct `state.foo = bar` mutations spread across sidepanel/*.ts that we
// don't want to rewrite in one go. Instead we wrap the plain state object in
// a Proxy that:
//   1. Lets every existing `state.foo = bar` keep working unchanged.
//   2. Notifies subscribers registered on that field.
//   3. Notifies "all-changes" subscribers used by debug overlays / devtools.
//   4. Powers selector-based subscriptions (zustand-style) for new code.
//
// New code should prefer `store.set('foo', bar)` for explicit intent and
// `store.subscribe('foo', cb)` / `store.subscribeSelector(sel, cb)` to react.

export type Listener<T> = (value: T, prev: T) => void;
export type Unsubscribe = () => void;
export type Selector<T> = (s: SidepanelState) => T;
export type EqualityFn<T> = (a: T, b: T) => boolean;

const defaultEquality = <T>(a: T, b: T): boolean => Object.is(a, b);

interface StoreApi {
  /** The reactive state object — same shape as before, mutations are tracked. */
  state: SidepanelState;
  /** Read a single field. */
  get<K extends keyof SidepanelState>(key: K): SidepanelState[K];
  /** Write a single field; equivalent to `state[key] = value` but explicit. */
  set<K extends keyof SidepanelState>(key: K, value: SidepanelState[K]): void;
  /**
   * Patch multiple fields atomically. All field-level subscribers fire after
   * every assignment is applied; the all-changes subscribers fire once.
   */
  setMany(patch: Partial<SidepanelState>): void;
  /** Subscribe to a single field's changes. Returns an unsubscribe fn. */
  subscribe<K extends keyof SidepanelState>(
    key: K,
    listener: Listener<SidepanelState[K]>
  ): Unsubscribe;
  /**
   * Subscribe to a derived value. Listener fires only when the selector
   * output changes (Object.is by default; pass a custom comparator for
   * deep-equality on objects/arrays).
   */
  subscribeSelector<T>(
    selector: Selector<T>,
    listener: Listener<T>,
    equalityFn?: EqualityFn<T>
  ): Unsubscribe;
  /** Subscribe to *any* field change. Useful for devtools / logging. */
  subscribeAll(
    listener: (key: keyof SidepanelState, value: unknown, prev: unknown) => void
  ): Unsubscribe;
  /** Reset to the initial value. Mainly used in tests. */
  reset(): void;
}

function createStore(): StoreApi {
  // Per-key subscribers, plus a wildcard set for "anything changed".
  // We use Set<unknown> internally to avoid the maintenance cost of a
  // 30-entry per-key typed map; the public API still types each listener.
  const fieldSubs = new Map<keyof SidepanelState, Set<Listener<unknown>>>();
  const allSubs = new Set<(key: keyof SidepanelState, value: unknown, prev: unknown) => void>();
  const selectorSubs = new Set<() => void>();

  // The raw object that the Proxy wraps. Keeping it inside the closure means
  // outside code can only reach it through the Proxy.
  const raw = createInitialState();

  // Suppress notifications during setMany so we batch.
  let batching = false;

  function notifyField<K extends keyof SidepanelState>(
    key: K,
    value: SidepanelState[K],
    prev: SidepanelState[K]
  ): void {
    const subs = fieldSubs.get(key);
    if (subs) {
      for (const fn of subs) (fn as Listener<SidepanelState[K]>)(value, prev);
    }
    for (const fn of allSubs) fn(key, value, prev);
  }

  function notifySelectors(): void {
    for (const fn of selectorSubs) fn();
  }

  const proxy = new Proxy(raw, {
    set(target, prop, value, receiver) {
      const key = prop as keyof SidepanelState;
      const prev = target[key];
      const ok = Reflect.set(target, prop, value, receiver);
      if (ok && !batching) {
        notifyField(key, value as SidepanelState[typeof key], prev);
        notifySelectors();
      }
      return ok;
    },
  }) as SidepanelState;

  function subscribe<K extends keyof SidepanelState>(
    key: K,
    listener: Listener<SidepanelState[K]>
  ): Unsubscribe {
    let set = fieldSubs.get(key);
    if (!set) {
      set = new Set();
      fieldSubs.set(key, set);
    }
    set.add(listener as Listener<unknown>);
    return () => {
      set!.delete(listener as Listener<unknown>);
    };
  }

  function subscribeSelector<T>(
    selector: Selector<T>,
    listener: Listener<T>,
    equalityFn: EqualityFn<T> = defaultEquality
  ): Unsubscribe {
    let last = selector(proxy);
    const wrapped = (): void => {
      const next = selector(proxy);
      if (!equalityFn(next, last)) {
        const prev = last;
        last = next;
        listener(next, prev);
      }
    };
    selectorSubs.add(wrapped);
    return () => {
      selectorSubs.delete(wrapped);
    };
  }

  function subscribeAll(
    listener: (key: keyof SidepanelState, value: unknown, prev: unknown) => void
  ): Unsubscribe {
    allSubs.add(listener);
    return () => {
      allSubs.delete(listener);
    };
  }

  function get<K extends keyof SidepanelState>(key: K): SidepanelState[K] {
    return proxy[key];
  }

  function setField<K extends keyof SidepanelState>(key: K, value: SidepanelState[K]): void {
    proxy[key] = value;
  }

  function setMany(patch: Partial<SidepanelState>): void {
    batching = true;
    const prevValues = new Map<keyof SidepanelState, unknown>();
    try {
      for (const k of Object.keys(patch) as (keyof SidepanelState)[]) {
        prevValues.set(k, proxy[k]);
        // Cast through unknown: TS can't see through Partial<> per-key narrow,
        // and Proxy mutations always go via the same trap regardless of type.
        (proxy as unknown as Record<string, unknown>)[k as string] = patch[k];
      }
    } finally {
      batching = false;
    }
    // Fire all field-level notifications now that every value is in place.
    for (const [k, prev] of prevValues) {
      notifyField(k, proxy[k] as never, prev as never);
    }
    notifySelectors();
  }

  function reset(): void {
    setMany(createInitialState());
  }

  return {
    state: proxy,
    get,
    set: setField,
    setMany,
    subscribe,
    subscribeSelector,
    subscribeAll,
    reset,
  };
}

export const store: StoreApi = createStore();

/**
 * The mutable state object. Direct assignment (`state.foo = bar`) still works
 * for backwards compatibility with the 100+ existing call sites; behind the
 * scenes a Proxy notifies any subscribers registered via `store.subscribe`.
 */
export const state: SidepanelState = store.state;

// DOM refs — populated by init.ts > cacheElements().
// We assert the empty literal to ElementsMap; cacheElements() is responsible
// for actually filling every key. Until that runs, all accessors return null.
export const elements: ElementsMap = {} as ElementsMap;
