// ============================================
// State Management
// ============================================
// 全局状态变量管理模块

let allImages = [];
let filteredImages = [];
let lastRenderedFilteredIds = null; // Track last rendered image IDs to skip redundant renders
let selectedImages = new Set();
let filterConfig = {};
let appSettings = {};
let collapsedGroups = new Set();
let similarGroups = [];
let isPopupMode = false;

let activeFilters = {
  size: 'all',
  sizeMin: 0,
  sizeMax: Infinity,
  types: [],
  layout: 'all',
  urlKeyword: '',
  color: null  // null = all colors, string = selected hex color
};

let currentSortMode = 'size-desc';
let currentViewMode = 'list';
let currentGroupMode = 'none';

// Per-tab cache: maps tabId → { url, images, filteredImages, selectedImages }
// so switching back to a previously scanned tab restores instantly.
const tabCache = new Map();
let currentTabId = null;
let isFetching = false;
let isScanning = false;
let isSilentScanning = false;
let isInitialized = false;
let isTabSwitching = false;
let scanDiscoveredCount = 0;
let scanDiscoveredImages = []; // Buffer for images discovered by live monitoring during a scan
let scanSkeletonLimit = 0; // Max images to incrementally render (= skeleton card count)
let scanAborted = false; // Whether the user cancelled the current scan
let isMultiTabExtracting = false; // Whether a multi-tab extraction is in progress

// isRestrictedUrl is now defined in shared/utils.js

// ============================================
// DOM Element References
// ============================================
const elements = {};