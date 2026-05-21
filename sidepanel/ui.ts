// ============================================
// UI通用组件
// ============================================
// UI组件模块：提供过滤器标签、视图切换、响应式、对话框、通知、加载状态等UI功能

import { hideDownloadDropdown } from './actions';
import {
  applyFilters,
  clearCustomSizeInputs,
  clearFileSizeInputs,
  syncCustomSizeInputsFromSettings,
} from './filter';
import { hideScanOverlay, showScanOverlay } from './scan';
import { closeAllFilterDropdowns } from './settings';
import { elements, state } from './state';
import { throttle } from './utils';
import { t } from '../shared/i18n';

// ============================================
// Filter Button Labels
// ============================================

/**
 * Append or remove a tiny "×" clear-span inside a filter button.
 * When the user clicks the "×" the provided `onClear` callback fires,
 * the click does NOT bubble to the button itself (no dropdown toggle).
 */
function toggleClearBtn(btn: HTMLElement, isActive: boolean, onClear: () => void): void {
  let clearSpan = btn.querySelector<HTMLElement>('.filter-clear');
  if (isActive) {
    if (!clearSpan) {
      clearSpan = document.createElement('span');
      clearSpan.className = 'filter-clear';
      clearSpan.textContent = '×';
      clearSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        onClear();
      });
      btn.appendChild(clearSpan);
    }
  } else {
    clearSpan?.remove();
  }
}
function getFilterLabelDefaults() {
  return {
    size: t('filter_size'),
    sizeMin: 'Min',
    sizeMax: 'Max',
    types: t('filter_type'),
    layout: t('filter_layout'),
    url: t('filter_url'),
    color: t('filter_color'),
    group: t('toolbar_group'),
    sort: t('toolbar_sort'),
  };
}

export function updateFilterButtonLabels(): void {
  const defaults = getFilterLabelDefaults();

  // Size button
  const sizeBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="size"]');
  if (sizeBtn) {
    // Only show X button when the user has manually changed the custom size
    // inputs away from the global settings defaults (not absolute 0/Infinity).
    const settingsMinW = state.appSettings.minWidth ?? 0;
    const settingsMinH = state.appSettings.minHeight ?? 0;
    const settingsMaxW = state.appSettings.maxWidth ?? 99999;
    const settingsMaxH = state.appSettings.maxHeight ?? 99999;
    const hasCustomMin =
      state.activeFilters.customMinEnabled !== state.appSettings.enableMinSize ||
      state.activeFilters.customMinWidth !== settingsMinW ||
      state.activeFilters.customMinHeight !== settingsMinH;
    const hasCustomMax =
      state.activeFilters.customMaxEnabled !== state.appSettings.enableMaxSize ||
      state.activeFilters.customMaxWidth !== settingsMaxW ||
      state.activeFilters.customMaxHeight !== settingsMaxH;
    const hasSizeFilter =
      state.activeFilters.size !== 'all' ||
      state.activeFilters.sizeMin > 0 ||
      state.activeFilters.sizeMax !== Infinity ||
      hasCustomMin ||
      hasCustomMax;
    let label: string = defaults.size;
    if (state.activeFilters.size !== 'all') {
      const sizeLabels: Record<string, string> = {
        small: t('size_btn_small'),
        medium: t('size_btn_medium'),
        large: t('size_btn_large'),
        xl: t('size_btn_xl'),
        custom: t('size_btn_custom'),
      };
      label = sizeLabels[state.activeFilters.size] || label;
    }
    sizeBtn.textContent = label + '▾';
    sizeBtn.classList.toggle('active', hasSizeFilter);
    toggleClearBtn(sizeBtn, hasSizeFilter, () => {
      state.activeFilters.size = 'all';
      state.activeFilters.sizeMin = 0;
      state.activeFilters.sizeMax = Infinity;
      // Restore custom size from global settings
      syncCustomSizeInputsFromSettings();
      document.querySelectorAll('[data-size-filter]').forEach((o) => o.classList.remove('active'));
      const allOpt = document.querySelector('[data-size-filter="all"]');
      if (allOpt) allOpt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // Type button
  const typeBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="type"]');
  if (typeBtn) {
    const hasTypeFilter = state.activeFilters.types.length > 0;
    let label: string = defaults.types;
    if (hasTypeFilter) {
      const typeLabels: Record<string, string> = {
        png: 'PNG',
        jpg: 'JPG',
        jpeg: 'JPEG',
        webp: 'WebP',
        gif: 'GIF',
        svg: 'SVG',
        ico: 'ICO',
        bmp: 'BMP',
        other: t('filter_type_other'),
      };
      label = state.activeFilters.types.map((type) => typeLabels[type] || type).join(', ');
    }
    typeBtn.textContent = label + '▾';
    typeBtn.classList.toggle('active', hasTypeFilter);
    toggleClearBtn(typeBtn, hasTypeFilter, () => {
      state.activeFilters.types = [];
      document.querySelectorAll<HTMLInputElement>('.type-checkbox').forEach((cb) => {
        cb.checked = true;
      });
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // Layout button
  const layoutBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="layout"]');
  if (layoutBtn) {
    const hasLayoutFilter = state.activeFilters.layout !== 'all';
    let label: string = defaults.layout;
    if (hasLayoutFilter) {
      const layoutLabels: Record<string, string> = {
        square: t('layout_btn_square'),
        landscape: t('layout_btn_landscape'),
        portrait: t('layout_btn_portrait'),
        panorama: t('layout_btn_panorama'),
      };
      label = layoutLabels[state.activeFilters.layout] || label;
    }
    layoutBtn.textContent = label + '▾';
    layoutBtn.classList.toggle('active', hasLayoutFilter);
    toggleClearBtn(layoutBtn, hasLayoutFilter, () => {
      state.activeFilters.layout = 'all';
      document
        .querySelectorAll('[data-layout-filter]')
        .forEach((o) => o.classList.remove('active'));
      const allOpt = document.querySelector('[data-layout-filter="all"]');
      if (allOpt) allOpt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // URL button
  const urlBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="url"]');
  if (urlBtn) {
    const hasUrlFilter = !!state.activeFilters.urlKeyword;
    urlBtn.textContent = defaults.url + '▾';
    urlBtn.classList.toggle('active', hasUrlFilter);
    toggleClearBtn(urlBtn, hasUrlFilter, () => {
      state.activeFilters.urlKeyword = '';
      if (elements.filterUrlInput) (elements.filterUrlInput as HTMLInputElement).value = '';
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // Color button
  const colorBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="color"]');
  if (colorBtn) {
    const hasColorFilter = !!state.activeFilters.color;
    // Preserve the PRO badge when updating text
    const badge = colorBtn.querySelector('.pro-badge');
    colorBtn.textContent = defaults.color + '▾ ';
    if (badge) colorBtn.appendChild(badge);
    colorBtn.classList.toggle('active', hasColorFilter);
    toggleClearBtn(colorBtn, hasColorFilter, () => {
      state.activeFilters.color = null;
      document
        .querySelectorAll('#color-swatches .color-swatch')
        .forEach((s) => s.classList.remove('active'));
      const allOpt = document.querySelector('[data-color-filter="all"]');
      if (allOpt) allOpt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // File Size button
  const fileSizeBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="filesize"]');
  if (fileSizeBtn) {
    const hasFileSizeFilter = state.activeFilters.fileSizeEnabled;
    let label = t('filter_filesize');
    if (hasFileSizeFilter) {
      const preset = state.activeFilters.fileSizePreset;
      if (preset && preset !== 'all' && preset !== 'custom') {
        label = t(`filter_filesize_${preset}`);
      } else {
        const min = state.activeFilters.minFileSizeKB;
        const max = state.activeFilters.maxFileSizeKB;
        if (min > 0 && max < Infinity) {
          label = `${min}-${max} KB`;
        } else if (min > 0) {
          label = `≥${min} KB`;
        } else if (max < Infinity) {
          label = `≤${max} KB`;
        }
      }
    }
    fileSizeBtn.textContent = label + '▾';
    fileSizeBtn.classList.toggle('active', hasFileSizeFilter);
    toggleClearBtn(fileSizeBtn, hasFileSizeFilter, () => {
      clearFileSizeInputs();
      document
        .querySelectorAll('[data-filesize-filter]')
        .forEach((o) => o.classList.remove('active'));
      const allOpt = document.querySelector('[data-filesize-filter="all"]');
      if (allOpt) allOpt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // Group button (icon-only: toggle active state only)
  const groupBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="group"]');
  if (groupBtn) {
    groupBtn.classList.toggle('active', state.currentGroupMode !== 'none');
  }

  // Sort button (icon-only: toggle active state only)
  const sortBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="sort"]');
  if (sortBtn) {
    sortBtn.classList.toggle('active', state.currentSortMode !== 'natural');
  }
}

// ============================================
// View Mode Toggle
// ============================================
let isNarrowMode = false;
let userViewMode: 'grid' | 'list' = 'list';

export function toggleViewMode(): void {
  userViewMode = userViewMode === 'grid' ? 'list' : 'grid';
  state.currentViewMode = userViewMode;
  applyViewMode(state.currentViewMode);
}

export function applyViewMode(mode: 'grid' | 'list'): void {
  state.currentViewMode = mode;
  if (elements.imageGrid) {
    elements.imageGrid.classList.toggle('list-view', mode === 'list');
  }
  // Sync group-content elements with the current view mode
  document.querySelectorAll('.group-content').forEach((groupContent) => {
    groupContent.classList.toggle('list-view', mode === 'list');
  });
  if (elements.btnViewToggle) {
    elements.btnViewToggle.title =
      mode === 'grid' ? t('title_switch_list') : t('title_switch_grid');
  }
  const iconGrid = document.getElementById('icon-grid');
  const iconList = document.getElementById('icon-list');
  if (iconGrid && iconList) {
    // Show the opposite icon: grid icon when in list mode, list icon when in grid mode
    iconGrid.classList.toggle('hidden', mode === 'grid');
    iconList.classList.toggle('hidden', mode === 'list');
  }
  const viewToggleLabel = document.getElementById('view-toggle-label');
  if (viewToggleLabel) {
    viewToggleLabel.textContent = mode === 'grid' ? t('view_list') : t('view_grid');
  }
}

// ============================================
// Responsive Width Observer
// ============================================
export function getMinCardWidth(): number {
  // Minimum card width must fit compact tags and action buttons in card-info-bar.
  // Compact tags: format ~28px + dims ~50px + filesize ~40px + 2 × 4px gap = ~126px
  // Compact actions: 4 buttons × 22px + 3 × 1px gap = 91px (search, favorite, download, delete)
  // + 2 PRO badge wrappers extra ~8px
  // Info-bar padding: left 6px + right 4px = 10px, gap: 2px
  // Card border + rounding: ~5px
  // Total ≈ 242px, use 250px for safety.
  return 250;
}

export function checkNarrowMode(): void {
  if (!elements.imageGrid) return;

  const minCardWidth = getMinCardWidth();
  let availableWidth: number;
  let gridGap: number;

  // When imageGrid is hidden (e.g. modal open over it), clientWidth is 0.
  // Fall back to #app width so compact-mode toggles correctly even when a
  // modal (collection, dedup, etc.) is the visible content.
  if (elements.imageGrid.clientWidth > 0) {
    const computedStyle = getComputedStyle(elements.imageGrid);
    const gridPaddingLeft = parseFloat(computedStyle.paddingLeft) || 10;
    const gridPaddingRight = parseFloat(computedStyle.paddingRight) || 10;
    gridGap = parseFloat(computedStyle.gap) || 10;
    const gridPadding = gridPaddingLeft + gridPaddingRight;
    availableWidth = elements.imageGrid.clientWidth - gridPadding;
  } else {
    const appElement = document.getElementById('app');
    const appWidth = appElement?.clientWidth || document.documentElement.clientWidth;
    gridGap = 10;
    const gridPadding = 20; // fallback padding estimate
    availableWidth = appWidth - gridPadding;
  }

  const canFitTwoColumns = availableWidth >= minCardWidth * 2 + gridGap;

  // Compact mode: when panel is narrow (can't fit two columns, or each card < 310px)
  const compactThreshold = 310;
  const isCompact = !canFitTwoColumns || (availableWidth - gridGap) / 2 < compactThreshold;

  // Toggle compact-mode class on #app for unified compact styles (grid cards)
  const appElement = document.getElementById('app');
  if (appElement) {
    appElement.classList.toggle('compact-mode', isCompact);
  }

  // Always sync view toggle button visibility with current width
  if (elements.btnViewToggle) {
    elements.btnViewToggle.style.display = canFitTwoColumns ? '' : 'none';
    // Also hide the toolbar-right container to prevent empty space affecting layout
    const toolbarRight = elements.btnViewToggle.closest('.toolbar-right') as HTMLElement | null;
    if (toolbarRight) {
      toolbarRight.style.display = canFitTwoColumns ? '' : 'none';
    }
  }

  if (!canFitTwoColumns) {
    if (!isNarrowMode) {
      isNarrowMode = true;
      applyViewMode('list');
    }
  } else {
    if (isNarrowMode) {
      isNarrowMode = false;
      applyViewMode(userViewMode);
    }
  }
}

export function initResizeObserver(): void {
  const appElement = document.getElementById('app');
  if (!appElement) return;

  const throttledCheckNarrowMode = throttle(checkNarrowMode, 150);
  const resizeObserver = new ResizeObserver(() => {
    throttledCheckNarrowMode();

    // Recalculate skeleton count once the Chrome sidepanel finishes its
    // opening animation and layout stabilizes. showLoading() may have
    // used a fallback height (800px) because measurements were unreliable
    // at init time — now that the resize event fired we have real values.
    if (state.scanProgress.visible && elements.imageGrid) {
      const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
      const height = gridWrapper?.clientHeight || 0;
      if (height > 200) {
        const isListView = elements.imageGrid.classList.contains('list-view');
        const totalSlots = calcSkeletonCount(height, isListView);
        const needed = Math.max(0, totalSlots - state.filteredImages.length);
        if (needed !== state.scanSkeletonsToShow) {
          state.scanSkeletonsToShow = needed;
          state.scanSkeletonLimit = totalSlots;
        }
      }
    }
  });
  resizeObserver.observe(appElement);

  // Initial check
  checkNarrowMode();
}

// ============================================
// Confirm Dialog (reusable)
// ============================================
// SVG icons moved into <ConfirmDialog> component (sidepanel/components/ConfirmDialog.tsx).
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'danger' | 'info';
}

/**
 * Show a custom confirm dialog, replacing native confirm().
 *
 * Implementation: pushes the dialog config + a Promise resolver into the
 * store; the <ConfirmDialog> Preact component reads the store and invokes
 * the resolver from its button handlers. The promise pattern is preserved
 * so existing call sites (`await showConfirmDialog({...})`) work unchanged.
 *
 * If a previous dialog is still open when this is called we resolve it to
 * `false` first — there's only one slot in state, and silently dropping the
 * old promise would leak an unresolved awaiter.
 *
 * @returns Promise that resolves to true if confirmed, false if cancelled
 */
export function showConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning',
}: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = state.confirmDialog;
    if (prev.open && prev.resolve) prev.resolve(false);
    state.confirmDialog = {
      open: true,
      config: { title, message, confirmText, cancelText, type },
      resolve,
    };
  });
}

// ============================================
// Toast Notifications
// ============================================
// Re-exported from state.ts so existing imports `import { ToastType } from
// './ui'` continue to work without changing call sites.
export type { ToastType } from './state';

let toastIdCounter = 0;

export function showToast(message: string, type?: import('./state').ToastType): void {
  // Match legacy "only one toast visible at a time" behavior by replacing
  // the entire list. The `id` ensures Preact's keyed reconciliation treats
  // each push as a fresh node (so the fade-in animation re-runs).
  const id = ++toastIdCounter;
  const toast: import('./state').ToastItem = {
    id,
    message,
    type: type || 'info',
    fadingOut: false,
  };
  state.toasts = [toast];

  setTimeout(() => {
    // Mark for fade-out only if this exact toast is still on screen — a
    // newer toast may have replaced it already.
    const cur = state.toasts.find((t) => t.id === id);
    if (cur) {
      state.toasts = state.toasts.map((t) => (t.id === id ? { ...t, fadingOut: true } : t));
    }
  }, 2500);
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
  }, 3000);
}

// ============================================
// Progress Modal
// ============================================
let progressAbortCallback: (() => void) | null = null;

export function showProgress(title: string, onAbort?: () => void): void {
  progressAbortCallback = onAbort || null;
  // Mutating a single field on the .downloadProgress object would not be
  // observed by the Proxy (it watches top-level state.* assignments only),
  // so we replace the whole object to trigger the <DownloadProgressModal>
  // re-render. Same pattern used in updateProgress / hideProgress.
  state.downloadProgress = {
    ...state.downloadProgress,
    visible: true,
    title: title || t('progress_downloading'),
  };
}

export function hideProgress(): void {
  progressAbortCallback = null;
  state.downloadProgress = {
    ...state.downloadProgress,
    visible: false,
  };
}

export function handleProgressClose(): void {
  if (progressAbortCallback) {
    progressAbortCallback();
  }
  hideProgress();
}

export function updateProgress(
  current: number,
  total: number,
  currentFile?: string,
  imageCount?: number | null
): void {
  state.downloadProgress = {
    ...state.downloadProgress,
    current,
    total,
    currentFile: currentFile || '',
    imageCount: imageCount ?? null,
  };
}

// ============================================
// State Display
// ============================================
export function showError(code: string, message: string, workaround?: string): void {
  hideAll();
  // <ErrorScreen> reads errorInfo for code/message/workaround; uiScreen
  // controls visibility (mutually exclusive with empty/restricted).
  state.errorInfo = {
    code: code || t('error_default_code'),
    message: message || t('error_default_message'),
    workaround,
  };
  state.uiScreen = 'error';
}

export function showEmpty(isNoResults?: boolean, hiddenCount?: number): void {
  hideAll();
  // Hide image-grid-wrapper so empty-state can take full flex space and center vertically
  const gridWrapper = document.querySelector('.image-grid-wrapper');
  if (gridWrapper) gridWrapper.classList.add('hidden');
  // <EmptyScreen> derives its title / description / button label from
  // emptyInfo.isNoResults — see StateScreens.tsx.
  state.emptyInfo = { isNoResults: !!isNoResults, hiddenCount };
  state.uiScreen = 'empty';
}

export function showRestricted(): void {
  // Hide all normal-page UI elements FIRST (synchronous DOM ops) to prevent
  // a flash of the previous tab's content before the restricted screen
  // appears. We use both the CSS class AND an inline style override for
  // image-grid-wrapper: the class handles the normal case, while the inline
  // style ensures immediate hiding even when this function is called from
  // an async path (e.g. handleTabChange's URL-verification await) where
  // the wrapper may have just been shown by hideRestricted().
  const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
  if (wrapper) {
    wrapper.classList.add('hidden');
    wrapper.style.display = 'none';
  }
  document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
    el.classList.add('hidden');
  });
  if (elements.imageGrid) elements.imageGrid.classList.add('hidden');
  if (elements.loadingState) elements.loadingState.classList.add('hidden');

  // Invalidate the rendered-filter cache because the grid DOM is about to be
  // hidden/cleared. Without this, a subsequent applyFilters() after
  // hideRestricted() would see matching IDs and skip renderImages().
  state.lastRenderedFilteredIds = null;
  // Close any open dropdowns, modals, and clean up UI state
  closeAllFilterDropdowns();
  hideDownloadDropdown();
  hideScanOverlay();

  // Synchronously show the StateScreens mount container so the restricted
  // screen is visible in the same paint frame as the image grid disappears.
  const stateScreensMount = document.querySelector<HTMLElement>(
    '[data-preact-mount="state-screens"]'
  );
  if (stateScreensMount) stateScreensMount.style.display = 'flex';

  // Now flip the screen — Preact will show the restricted screen via
  // StateScreens. The mount container is already visible (set above).
  state.uiScreen = 'restricted';
}

export function hideRestricted(): void {
  // Synchronously hide the StateScreens mount container BEFORE restoring
  // normal UI, so the restricted screen disappears in the same paint frame
  // as the image grid appears. This prevents a one-frame flash where both
  // layers are visible (the Preact useEffect that normally toggles the
  // mount container's display is async and would lag by one frame).
  const stateScreensMount = document.querySelector<HTMLElement>(
    '[data-preact-mount="state-screens"]'
  );
  if (stateScreensMount) stateScreensMount.style.display = 'none';

  // Setting uiScreen to 'images' tears down the restricted screen (and any
  // empty/error sibling) via the <StateScreens> component.
  const wasRestricted = state.uiScreen === 'restricted';
  if (wasRestricted) state.uiScreen = 'images';
  // Clean up scanning-disabled state and residual skeletons ONLY when we're
  // actually transitioning away from a restricted/error/empty screen.
  // During initial load, showLoading() sets scanProgress.visible and
  // scanSkeletonsToShow before loadCurrentTab() calls hideRestricted() as a
  // defensive "ensure normal UI" step — calling hideScanOverlay() or clearing
  // skeletons there would erase the loading state the user is supposed to see.
  if (wasRestricted || state.uiScreen === 'error' || state.uiScreen === 'empty') {
    hideScanOverlay();
    state.scanSkeletonsToShow = 0;
  }
  // Restore toolbar, status-bar and image-grid-wrapper
  document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
    el.classList.remove('hidden');
  });
  // showRestricted() sets both the CSS class AND an inline style on
  // image-grid-wrapper to guarantee immediate hiding. We must clear
  // both when restoring visibility.
  const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
  if (wrapper) {
    wrapper.classList.remove('hidden');
    wrapper.style.removeProperty('display');
  }
  // hideAll() (called by showRestricted) adds 'hidden' to #image-grid.
  // When switching back from a restricted tab to a cached normal tab,
  // renderImages() may be skipped (needsRender=false optimisation), so
  // we must explicitly restore imageGrid visibility here.
  if (elements.imageGrid) elements.imageGrid.classList.remove('hidden');
}

export function clearCurrentImages(): void {
  state.allImages = [];
  state.filteredImages = [];
  state.lastRenderedFilteredIds = null;
  state.selectedImages.clear();
  if (elements.imageGrid) elements.imageGrid.innerHTML = '';
}

// buildSkeletonCard() lived here in the legacy imperative-render flow.
// It was used by ui.ts > showLoading() to inject skeleton placeholders as
// raw HTML into #image-grid. The Preact migration replaced it with the
// <SkeletonCard> component (sidepanel/components/SkeletonCard.tsx), which
// <ImageGrid> renders via state.scanSkeletonsToShow. The string-template
// version is no longer referenced and has been removed.

export function calcSkeletonCount(containerHeight: number, isListView: boolean): number {
  const app = document.getElementById('app');
  const isCompact = !!app && app.classList.contains('density-compact');
  const isComfortable = !!app && app.classList.contains('density-comfortable');
  const isPopup = !!app && app.classList.contains('popup-mode');

  // Determine gap and padding based on density
  let gap = 10;
  let padding = 10;
  if (isCompact) {
    gap = 6;
    padding = 6;
  } else if (isComfortable) {
    gap = 14;
    padding = 14;
  }

  // Determine thumb height based on density and view mode
  let thumbHeight: number;
  if (isListView) {
    thumbHeight = 100;
  } else if (isCompact) {
    thumbHeight = 80;
  } else if (isComfortable) {
    thumbHeight = 180;
  } else {
    thumbHeight = 120;
  }

  // Popup mode overrides thumb height for grid view
  if (isPopup && !isListView) {
    if (isCompact) thumbHeight = 80;
    else if (isComfortable) thumbHeight = 180;
    else thumbHeight = 120;
  }

  // skeleton-info-bar: min-height 38px + border-top 1px + border-bottom 1px = 40px
  const infoBarHeight = 40;
  // skeleton-url-row: min-height 36px + border-top 1px = 37px
  const urlRowHeight = 37;
  // card border: 1.5px top + 1.5px bottom ≈ 3px
  const borderHeight = 3;

  const cardHeight = thumbHeight + infoBarHeight + urlRowHeight + borderHeight;
  const columns = isListView ? 1 : 2;

  // Available height = container height - top padding - bottom padding
  const availableHeight = containerHeight - padding * 2;
  // Number of rows that fit: (availableHeight + gap) / (cardHeight + gap)
  const rows = Math.max(1, Math.ceil((availableHeight + gap) / (cardHeight + gap)));

  return rows * columns;
}

export function showLoading(): void {
  // Reset scan discovery state to avoid stale counts from a previous scan
  // showing up in the scan overlay (e.g. "found 7 images" at the start).
  state.scanDiscoveredCount = 0;
  state.scanDiscoveredImages = [];
  state.scanAborted = false;

  // Invalidate the rendered-filter cache because we are about to replace the
  // grid DOM with skeleton cards. Without this, a subsequent applyFilters()
  // may see the same filtered IDs and skip renderImages(), leaving the grid
  // stuck on skeletons (or empty) even though images are available.
  state.lastRenderedFilteredIds = null;

  // Ensure image-grid-wrapper is visible
  const gridWrapper = document.querySelector('.image-grid-wrapper');
  if (gridWrapper) gridWrapper.classList.remove('hidden');

  // Drive skeleton rendering through the store: <ImageGrid> reads
  // scanSkeletonsToShow and renders that many <SkeletonCard> nodes after
  // (zero) real cards. No imperative innerHTML write needed here.
  if (elements.imageGrid) {
    // Restore visibility in case it was hidden during a tab switch
    (elements.imageGrid as HTMLElement).style.visibility = '';
    elements.imageGrid.classList.remove('hidden');

    // Force a synchronous layout reflow so the browser computes the actual
    // dimensions of the now-visible containers before we read clientHeight.
    // Without this, clientHeight may still return 0 because the browser
    // batches style recalculations and the 'hidden' removal (display:none →
    // display:flex) hasn't been flushed yet.
    void (gridWrapper as HTMLElement).offsetHeight;

    const isListView = elements.imageGrid.classList.contains('list-view');
    const measured = (gridWrapper as HTMLElement | null)?.clientHeight || 0;
    // Chrome sidepanel dimensions are unreliable during the opening
    // animation — both clientHeight and window.innerHeight can return
    // tiny values. Fall back to 800px (typical sidepanel height) so
    // skeletons fill the viewport from the first frame.
    const containerHeight = measured > 200 ? measured : 800;
    const skeletonCount = calcSkeletonCount(containerHeight, isListView);
    // scanSkeletonLimit gates incremental render in message.ts (stop after we
    // fill the visible skeleton slots); scanSkeletonsToShow drives the
    // Preact-rendered placeholders.
    state.scanSkeletonLimit = skeletonCount;
    state.scanSkeletonsToShow = skeletonCount;
  }
  // The empty/error/restricted screens are now managed by <StateScreens>
  // — bouncing uiScreen back to 'images' clears whichever was visible.
  state.uiScreen = 'images';
  if (elements.loadingState) elements.loadingState.classList.add('hidden');

  // Show scan overlay in indeterminate mode (no percent bar yet) — the
  // discovery phase has no known total. <ScanProgressOverlay> reads these
  // fields directly.
  state.scanProgress = {
    visible: true,
    indeterminate: true,
    title: t('scan_scanning'),
    current: 0,
    total: 0,
    currentUrl: '',
  };
  showScanOverlay(0, 0);

  // Reset status bar counts to avoid stale data from previous tab
  resetStatusBar();
}

export function hideLoading(): void {
  hideScanOverlay();
}

export function resetStatusBar(): void {
  // foundActionCount / downloadLabel are Preact-managed; resetting state
  // triggers their re-render automatically. Only the still-imperative
  // foundCount widget needs an explicit clear here.
  if (elements.foundCount) elements.foundCount.textContent = '0';
  // Reset similar groups state and UI
  state.similarGroups = [];
  // similarCount is Preact-managed (StatusCounts.SimilarCount).
  // Similar button is always visible; badge auto-hides when count is 0.
}

export function hideAll(): void {
  if (elements.imageGrid) elements.imageGrid.classList.add('hidden');
  if (elements.loadingState) elements.loadingState.classList.add('hidden');
  // empty/error/restricted are Preact-managed; resetting uiScreen hides them.
  state.uiScreen = 'images';
}

// ============================================
// i18n: Apply translations to DOM elements
// ============================================

/**
 * Walk the DOM and update textContent for all elements carrying a
 * `data-i18n` attribute. The attribute value is the i18n key looked up
 * via `t()`. Elements whose key resolves to the key itself (missing
 * translation) are left untouched so the original hard-coded English
 * remains visible as a safe fallback.
 *
 * Also updates placeholder attributes when `data-i18n-placeholder` is present.
 *
 * Call this:
 *  1. Once at init (after detectLocale resolves) to stamp the UI with the
 *     user's preferred language.
 *  2. From the onLocaleChange listener so a runtime language switch in
 *     Settings takes effect immediately without a panel reload.
 */
export function applyTranslations(): void {
  // Translate textContent via data-i18n
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (!key) return;
    const translated = t(key);
    // Only apply if t() resolved to an actual translation (not the raw key)
    if (translated !== key) {
      element.textContent = translated;
    }
  });

  // Translate placeholder attributes via data-i18n-placeholder
  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((element) => {
    const key = element.getAttribute('data-i18n-placeholder');
    if (!key) return;
    const translated = t(key);
    if (translated !== key) {
      (element as HTMLInputElement).placeholder = translated;
    }
  });

  // Translate title attributes via data-i18n-title
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    const key = element.getAttribute('data-i18n-title');
    if (!key) return;
    const translated = t(key);
    if (translated !== key) {
      element.title = translated;
    }
  });

  // Sync setting-select display text with the translated active option.
  // After data-i18n elements update, the .setting-select-text (button label)
  // still shows the old language text. Re-derive it from the active option.
  document.querySelectorAll<HTMLElement>('.setting-select').forEach((selectEl) => {
    const textEl = selectEl.querySelector('.setting-select-text');
    const activeOpt = selectEl.querySelector<HTMLElement>('.setting-select-option.active');
    if (textEl && activeOpt) {
      textEl.textContent = activeOpt.textContent;
    }
  });
}
