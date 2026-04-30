// ============================================
// UI通用组件
// ============================================
// UI组件模块：提供过滤器标签、视图切换、响应式、对话框、通知、加载状态等UI功能

import { hideDownloadDropdown } from './actions';
import { hideScanOverlay, showScanOverlay } from './scan';
import { closeAllFilterDropdowns } from './settings';
import { elements, state } from './state';
import { throttle } from './utils';

// ============================================
// Filter Button Labels
// ============================================
const filterLabelDefaults = {
  size: 'Size',
  sizeMin: 'Min',
  sizeMax: 'Max',
  types: 'Type',
  layout: 'Layout',
  url: 'URL',
  color: 'Color',
  group: 'Group',
  sort: 'Sort'
} as const;

export function updateFilterButtonLabels(): void {
  // Size button
  const sizeBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="size"]');
  if (sizeBtn) {
    const hasSizeFilter = state.activeFilters.size !== 'all'
      || state.activeFilters.sizeMin > 0
      || state.activeFilters.sizeMax !== Infinity;
    let label: string = filterLabelDefaults.size;
    if (state.activeFilters.size !== 'all') {
      const sizeLabels: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', xl: 'XL', custom: 'Custom' };
      label = sizeLabels[state.activeFilters.size] || label;
    }
    sizeBtn.textContent = label + '▾';
    sizeBtn.classList.toggle('active', hasSizeFilter);
  }

  // Type button
  const typeBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="type"]');
  if (typeBtn) {
    const hasTypeFilter = state.activeFilters.types.length > 0;
    let label: string = filterLabelDefaults.types;
    if (hasTypeFilter) {
      const typeLabels: Record<string, string> = { png: 'PNG', jpg: 'JPG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF', svg: 'SVG', ico: 'ICO', bmp: 'BMP' };
      label = state.activeFilters.types.map(t => typeLabels[t] || t).join(', ');
    }
    typeBtn.textContent = label + '▾';
    typeBtn.classList.toggle('active', hasTypeFilter);
  }

  // Layout button
  const layoutBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="layout"]');
  if (layoutBtn) {
    const hasLayoutFilter = state.activeFilters.layout !== 'all';
    let label: string = filterLabelDefaults.layout;
    if (hasLayoutFilter) {
      const layoutLabels: Record<string, string> = { square: 'Square', landscape: 'Landscape', portrait: 'Portrait', panorama: 'Panorama' };
      label = layoutLabels[state.activeFilters.layout] || label;
    }
    layoutBtn.textContent = label + '▾';
    layoutBtn.classList.toggle('active', state.activeFilters.layout !== 'all');
  }

  // URL button
  const urlBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="url"]');
  if (urlBtn) {
    const hasUrlFilter = !!state.activeFilters.urlKeyword;
    urlBtn.textContent = hasUrlFilter ? 'URL▾' : 'URL▾';
    urlBtn.classList.toggle('active', hasUrlFilter);
  }

  // Color button
  const colorBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="color"]');
  if (colorBtn) {
    const hasColorFilter = !!state.activeFilters.color;
    // Preserve the PRO badge when updating text
    const badge = colorBtn.querySelector('.pro-badge');
    colorBtn.textContent = hasColorFilter ? 'Color▾ ' : 'Color▾ ';
    if (badge) colorBtn.appendChild(badge);
    colorBtn.classList.toggle('active', hasColorFilter);
  }

  // Group button (icon-only: toggle active state only)
  const groupBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="group"]');
  if (groupBtn) {
    groupBtn.classList.toggle('active', state.currentGroupMode !== 'none');
  }

  // Sort button (icon-only: toggle active state only)
  const sortBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="sort"]');
  if (sortBtn) {
    sortBtn.classList.toggle('active', state.currentSortMode !== 'size-desc');
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
  document.querySelectorAll('.group-content').forEach(groupContent => {
    groupContent.classList.toggle('list-view', mode === 'list');
  });
  if (elements.btnViewToggle) {
    elements.btnViewToggle.title = mode === 'grid' ? 'Switch to list view' : 'Switch to grid view';
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
    viewToggleLabel.textContent = mode === 'grid' ? 'List' : 'Grid';
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

  const computedStyle = getComputedStyle(elements.imageGrid);
  const gridPaddingLeft = parseFloat(computedStyle.paddingLeft) || 10;
  const gridPaddingRight = parseFloat(computedStyle.paddingRight) || 10;
  const gridGap = parseFloat(computedStyle.gap) || 10;
  const gridPadding = gridPaddingLeft + gridPaddingRight;
  const minCardWidth = getMinCardWidth();
  const availableWidth = elements.imageGrid.clientWidth - gridPadding;
  const canFitTwoColumns = availableWidth >= (minCardWidth * 2 + gridGap);

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
    // Throttle resize events so layout adapts continuously during drag
    throttledCheckNarrowMode();
  });
  resizeObserver.observe(appElement);

  // Initial check
  checkNarrowMode();
}

// ============================================
// Confirm Dialog (reusable)
// ============================================
const CONFIRM_ICONS: Record<string, string> = {
  warning: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  danger: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  info: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
};

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'danger' | 'info';
}

/**
 * Show a custom confirm dialog, replacing native confirm().
 * @returns Promise that resolves to true if confirmed, false if cancelled
 */
export function showConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning'
}: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog');
    const iconEl = document.getElementById('confirm-dialog-icon');
    const titleEl = document.getElementById('confirm-dialog-title');
    const messageEl = document.getElementById('confirm-dialog-message');
    const confirmBtn = document.getElementById('confirm-dialog-confirm');
    const cancelBtn = document.getElementById('confirm-dialog-cancel');

    if (!dialog || !confirmBtn || !cancelBtn || !iconEl || !titleEl || !messageEl) {
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    iconEl.className = 'confirm-dialog-icon';
    iconEl.innerHTML = CONFIRM_ICONS[type] || CONFIRM_ICONS.warning;
    if (type === 'danger') {
      iconEl.classList.add('icon-danger');
    } else if (type === 'info') {
      iconEl.classList.add('icon-info');
    } else {
      iconEl.classList.add('icon-warning');
    }

    confirmBtn.className = type === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

    dialog.classList.remove('hidden');

    const overlay = dialog.querySelector('.modal-overlay');

    function cleanup() {
      dialog!.classList.add('hidden');
      confirmBtn!.removeEventListener('click', onConfirm);
      cancelBtn!.removeEventListener('click', onCancel);
      if (overlay) overlay.removeEventListener('click', onCancel);
    }

    function onConfirm() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);

    if (overlay) overlay.addEventListener('click', onCancel);

    const closeBtn = document.getElementById('btn-confirm-dialog-close');
    if (closeBtn) closeBtn.addEventListener('click', onCancel);
  });
}

// ============================================
// Toast Notifications
// ============================================
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export function showToast(message: string, type?: ToastType): void {
  if (!elements.toastContainer) return;
  // Remove any existing toasts to ensure only one is visible at a time
  elements.toastContainer.innerHTML = '';
  const toast = document.createElement('div');
  toast.className = `toast ${type || 'info'}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); }, 2500);
  setTimeout(() => { toast.remove(); }, 3000);
}

// ============================================
// Progress Modal
// ============================================
let progressAbortCallback: (() => void) | null = null;

export function showProgress(title: string, onAbort?: () => void): void {
  progressAbortCallback = onAbort || null;
  if (elements.progressModal) {
    const titleEl = document.getElementById('progress-title');
    if (titleEl) titleEl.textContent = title || 'Downloading...';
    elements.progressModal.classList.remove('hidden');
  }
}

export function hideProgress(): void {
  progressAbortCallback = null;
  if (elements.progressModal) elements.progressModal.classList.add('hidden');
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
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  if (elements.progressFill) (elements.progressFill as HTMLElement).style.width = `${pct}%`;
  if (elements.progressText) {
    if (imageCount != null) {
      elements.progressText.textContent = `${current} / ${total} tabs · ${imageCount} images found`;
    } else {
      elements.progressText.textContent = `${current} / ${total}`;
    }
  }
  if (elements.progressCurrent) elements.progressCurrent.textContent = currentFile || '';
}

// ============================================
// State Display
// ============================================
export function showError(code: string, message: string, workaround?: string): void {
  hideAll();
  if (elements.errorState) {
    elements.errorState.classList.remove('hidden');
    const t = elements.errorState.querySelector('.error-title');
    const m = elements.errorState.querySelector('.error-message');
    const w = elements.errorState.querySelector('.error-workaround') as HTMLElement | null;
    if (t) t.textContent = code || 'Error';
    if (m) m.textContent = message || 'An error occurred';
    if (w) { w.textContent = workaround || ''; w.style.display = workaround ? '' : 'none'; }
  }
}

export function showEmpty(isNoResults?: boolean): void {
  hideAll();
  // Hide image-grid-wrapper so empty-state can take full flex space and center vertically
  const gridWrapper = document.querySelector('.image-grid-wrapper');
  if (gridWrapper) gridWrapper.classList.add('hidden');

  if (elements.emptyState) {
    elements.emptyState.classList.remove('hidden');
    const resetBtn = document.getElementById('btn-reset-filters');
    const title = elements.emptyState.querySelector('.empty-state-title');
    const desc = elements.emptyState.querySelector('.empty-state-desc');
    const resetBtnLabel = resetBtn?.querySelector('span');
    if (isNoResults) {
      if (title) title.textContent = 'No images found';
      if (desc) desc.textContent = 'Try adjusting your filter criteria or visit a different page.';
      if (resetBtnLabel) resetBtnLabel.textContent = 'Reset Filters';
    } else {
      if (title) title.textContent = 'No images found';
      if (desc) desc.textContent = 'No images were detected on this page. Try refreshing or visiting a different page.';
      if (resetBtnLabel) resetBtnLabel.textContent = 'Rescan Images';
    }
  }
}

export function showRestricted(): void {
  hideAll();
  // Invalidate the rendered-filter cache because the grid DOM is about to be
  // hidden/cleared. Without this, a subsequent applyFilters() after
  // hideRestricted() would see matching IDs and skip renderImages().
  state.lastRenderedFilteredIds = null;
  // Close any open dropdowns, modals, and clean up UI state
  closeAllFilterDropdowns();
  hideDownloadDropdown();
  hideScanOverlay();
  // Hide toolbar, status-bar and image-grid-wrapper that are irrelevant on restricted pages
  document.querySelectorAll('.toolbar, .status-bar, .image-grid-wrapper').forEach(el => {
    el.classList.add('hidden');
  });
  if (elements.restrictedState) elements.restrictedState.classList.remove('hidden');
}

export function hideRestricted(): void {
  if (elements.restrictedState) elements.restrictedState.classList.add('hidden');
  // Clean up any scanning-disabled state that may have been left over from a
  // previous showLoading() → showRestricted() transition (e.g. switching to a
  // restricted tab and back).
  hideScanOverlay();
  // Restore toolbar, status-bar and image-grid-wrapper
  document.querySelectorAll('.toolbar, .status-bar, .image-grid-wrapper').forEach(el => {
    el.classList.remove('hidden');
  });
}

export function clearCurrentImages(): void {
  state.allImages = [];
  state.filteredImages = [];
  state.lastRenderedFilteredIds = null;
  state.selectedImages.clear();
  if (elements.imageGrid) elements.imageGrid.innerHTML = '';
}

export function buildSkeletonCard(): string {
  return '<div class="skeleton-card">'
    + '<div class="skeleton-thumb"></div>'
    + '<div class="skeleton-info-bar">'
    + '<div class="skeleton-tags">'
    + '<span class="skeleton-tag"></span>'
    + '<span class="skeleton-tag"></span>'
    + '<span class="skeleton-tag"></span>'
    + '</div>'
    + '<div class="skeleton-actions">'
    + '<span class="skeleton-action"></span>'
    + '<span class="skeleton-action"></span>'
    + '<span class="skeleton-action"></span>'
    + '</div>'
    + '</div>'
    + '<div class="skeleton-url-row">'
    + '<div class="skeleton-url-bar"></div>'
    + '<div class="skeleton-url-actions">'
    + '<span class="skeleton-action small"></span>'
    + '<span class="skeleton-action small"></span>'
    + '</div>'
    + '</div>'
    + '</div>';
}

export function calcSkeletonCount(containerHeight: number, isListView: boolean): number {
  const app = document.getElementById('app');
  const isCompact = !!app && app.classList.contains('density-compact');
  const isComfortable = !!app && app.classList.contains('density-comfortable');
  const isPopup = !!app && app.classList.contains('popup-mode');

  // Determine gap and padding based on density
  let gap = 10;
  let padding = 10;
  if (isCompact) { gap = 6; padding = 6; }
  else if (isComfortable) { gap = 14; padding = 14; }

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

  // Render skeleton cards directly into image-grid
  if (elements.imageGrid) {
    // Restore visibility in case it was hidden during a tab switch
    (elements.imageGrid as HTMLElement).style.visibility = '';
    elements.imageGrid.classList.remove('hidden');
    const isListView = elements.imageGrid.classList.contains('list-view');
    const containerHeight = (gridWrapper as HTMLElement | null)?.clientHeight || 600;
    const skeletonCount = calcSkeletonCount(containerHeight, isListView);
    state.scanSkeletonLimit = skeletonCount;
    elements.imageGrid.innerHTML = Array(skeletonCount).fill(buildSkeletonCard()).join('');
  }
  if (elements.emptyState) elements.emptyState.classList.add('hidden');
  if (elements.errorState) elements.errorState.classList.add('hidden');
  if (elements.loadingState) elements.loadingState.classList.add('hidden');
  if (elements.restrictedState) elements.restrictedState.classList.add('hidden');

  // Show scan overlay (semi-transparent backdrop + floating progress card)
  if (elements.scanProgressTitle) {
    elements.scanProgressTitle.textContent = 'Scanning...';
  }
  // Hide progress bar during discovery phase (spinner is sufficient)
  const scanProgressBar = elements.scanOverlay?.querySelector('.progress-bar');
  if (scanProgressBar) scanProgressBar.classList.add('hidden');
  showScanOverlay(0, 0);

  // Reset status bar counts to avoid stale data from previous tab
  resetStatusBar();
}

export function hideLoading(): void {
  hideScanOverlay();
}

export function resetStatusBar(): void {
  if (elements.foundActionCount) elements.foundActionCount.textContent = '0';
  if (elements.foundCount) elements.foundCount.textContent = '0';
  if (elements.downloadLabel) elements.downloadLabel.textContent = 'Download All';
  // Reset similar groups state and UI
  state.similarGroups = [];
  if (elements.similarCount) elements.similarCount.textContent = '0';
  if (elements.btnDedup) (elements.btnDedup as HTMLElement).style.display = 'none';
  const dedupInfo = document.getElementById('dedup-info');
  if (dedupInfo) dedupInfo.classList.add('hidden');
}

export function hideAll(): void {
  if (elements.imageGrid) elements.imageGrid.classList.add('hidden');
  if (elements.emptyState) elements.emptyState.classList.add('hidden');
  if (elements.errorState) elements.errorState.classList.add('hidden');
  if (elements.loadingState) elements.loadingState.classList.add('hidden');
  if (elements.restrictedState) elements.restrictedState.classList.add('hidden');
}
