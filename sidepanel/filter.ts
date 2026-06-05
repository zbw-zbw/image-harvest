// ============================================
// Filtering & Sorting
// ============================================
// 过滤和排序模块：提供图片过滤、排序、颜色过滤等功能

import type { ImageItem } from '../shared/types';
import { MESSAGE_TYPES } from '../shared/constants';
import { updateSelectionUI } from './actions';
import { renderImages } from './render';
import { closeAllFilterDropdowns } from './settings';
import { elements, state } from './state';
import { t } from '../shared/i18n';
import { updateFilterButtonLabels, updateFilterDropdownCounts } from './ui';
import { getAspectRatioCategory } from './utils';

export function applyFilters(options?: { skipScrollReset?: boolean }): void {
  state.filteredImages = state.allImages.filter((img) => {
    return (
      filterByVisibility(img) &&
      filterBySize(img) &&
      filterByType(img) &&
      filterByLayout(img) &&
      filterByUrl(img) &&
      filterByColor(img) &&
      filterBySettingsMinSize(img) &&
      filterBySettingsMaxSize(img) &&
      filterByFileSize(img) &&
      filterByAiTag(img)
    );
  });

  sortImages();

  // Skip renderImages() if the filtered image list is identical to the last
  // render. This avoids unnecessary scrollTop resets and count updates when
  // tab-switch cache restore produces the same filtered set.
  const currentFilteredIds =
    state.filteredImages.length === 0
      ? ''
      : `${state.filteredImages.length}:${state.filteredImages[0].id}:${state.filteredImages[state.filteredImages.length - 1].id}`;
  if (currentFilteredIds === state.lastRenderedFilteredIds) {
    // Still update selection UI in case selection state changed.
    // Also clear stale skeletons — they may linger after a tab switch
    // or visibility re-check even though the filtered set didn't change.
    if (!state.scanProgress.visible) {
      state.scanSkeletonsToShow = 0;
    }
    updateSelectionUI();
    updateFilterDropdownCounts();
    return;
  }
  state.lastRenderedFilteredIds = currentFilteredIds;

  renderImages(options?.skipScrollReset ? { skipScrollReset: true } : undefined);
  updateSelectionUI();
  updateFilterDropdownCounts();
}

export function sortImages(): void {
  sortImagesArray(state.filteredImages);
}

/** Sort an array of images in-place using the current sort mode.
 *  A deterministic tiebreaker (image id) is always applied so images
 *  with identical sort keys (e.g. all zero-size images) maintain a
 *  consistent order across re-renders, view switches, and cache restores. */
export function sortImagesArray(images: ImageItem[]): void {
  images.sort((a, b) => {
    const aW = a.naturalWidth || a.displayWidth || 0;
    const aH = a.naturalHeight || a.displayHeight || 0;
    const bW = b.naturalWidth || b.displayWidth || 0;
    const bH = b.naturalHeight || b.displayHeight || 0;
    const aPixels = aW * aH;
    const bPixels = bW * bH;

    let primary: number;
    switch (state.currentSortMode) {
      case 'size-asc':
        primary = aPixels - bPixels;
        break;
      case 'filesize-desc':
        primary = (b.estimatedSize || 0) - (a.estimatedSize || 0);
        break;
      case 'filesize-asc':
        primary = (a.estimatedSize || 0) - (b.estimatedSize || 0);
        break;
      case 'type':
        primary = (a.format || '').localeCompare(b.format || '');
        break;
      case 'natural':
        return 0;
      case 'size-desc':
      default:
        primary = bPixels - aPixels;
        break;
    }
    // Deterministic tiebreaker: fall back to id comparison so images with
    // identical sort keys always appear in the same order.
    return primary !== 0 ? primary : a.id.localeCompare(b.id);
  });
}

export function filterBySize(img: ImageItem): boolean {
  if (state.activeFilters.size === 'all') return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  const maxDim = Math.max(w, h);
  return maxDim >= state.activeFilters.sizeMin && maxDim <= state.activeFilters.sizeMax;
}

export function filterByType(img: ImageItem): boolean {
  if (state.activeFilters.types.length === 0) return true;
  return state.activeFilters.types.includes((img.format || 'unknown').toLowerCase());
}

export function filterByLayout(img: ImageItem): boolean {
  if (state.activeFilters.layout === 'all') return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  if (!w || !h) return true;
  return getAspectRatioCategory(w, h) === state.activeFilters.layout;
}

export function filterByUrl(img: ImageItem): boolean {
  if (!state.activeFilters.urlKeyword) return true;
  return (img.url || '').toLowerCase().includes(state.activeFilters.urlKeyword);
}

export function filterByColor(img: ImageItem): boolean {
  if (!state.activeFilters.color) return true;
  if (!img.colors || img.colors.length === 0) return false;
  // Check if any of the image's colors is close to the selected color
  return img.colors.some((c) => colorDistance(c, state.activeFilters.color!) < 60);
}

export function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

export function renderColorSwatches(): void {
  const container = document.getElementById('color-swatches');
  if (!container) return;

  // Collect all unique colors from images
  const colorMap = new Map<string, number>();
  state.allImages.forEach((img) => {
    if (img.colors && img.colors.length > 0) {
      img.colors.forEach((c) => {
        const hex = c.toLowerCase();
        colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
      });
    }
  });

  // Sort by frequency (matching image list color order) and take top colors
  const sortedColors = [...colorMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([hex]) => hex);

  if (sortedColors.length === 0) {
    container.innerHTML = `<p class="color-empty-hint">${t('color_no_extracted')}</p>`;
    return;
  }

  const swatchTitle = state.isProUser ? (hex: string) => hex : () => t('title_upgrade_copy_color');

  container.innerHTML = sortedColors
    .map(
      (hex) =>
        `<div class="color-swatch${state.activeFilters.color === hex ? ' active' : ''}" style="background:${hex}" data-color-value="${hex}" title="${swatchTitle(hex)}"></div>`
    )
    .join('');

  // Bind click events
  container.querySelectorAll<HTMLElement>('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = swatch.dataset.colorValue || null;
      if (state.activeFilters.color === color) {
        // Deselect
        state.activeFilters.color = null;
        swatch.classList.remove('active');
      } else {
        state.activeFilters.color = color;
        container.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
      }
      // Update "All Colors" option state
      const allOption = document.querySelector('[data-color-filter="all"]');
      if (allOption) allOption.classList.toggle('active', !state.activeFilters.color);
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });
}

export function filterBySettingsMinSize(img: ImageItem): boolean {
  if (!state.activeFilters.customMinEnabled) return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  return (
    w >= (state.activeFilters.customMinWidth || 0) &&
    h >= (state.activeFilters.customMinHeight || 0)
  );
}

export function filterByFileSize(img: ImageItem): boolean {
  if (!state.activeFilters.fileSizeEnabled) return true;
  const bytes = img.estimatedSize || 0;
  const kb = bytes / 1024;
  return kb >= state.activeFilters.minFileSizeKB && kb <= state.activeFilters.maxFileSizeKB;
}

export function filterByVisibility(img: ImageItem): boolean {
  if (!state.activeFilters.showVisibleOnly) return true;
  // When "visible only" is on, only show images explicitly marked as visible.
  // Images without a visible flag (meta, link-icon, svg, canvas, etc.) are hidden.
  return img.visible === true;
}

/**
 * Re-check visibility of all images in real-time by asking the content script
 * to run `isElementAccessibleWithoutInteraction` on each image's DOM element.
 * Updates `img.visible` in-place so subsequent `filterByVisibility` calls
 * reflect the current page state (not the stale scan-time snapshot).
 *
 * Only non-data-URI images are sent for re-check (data URIs are typically
 * inline SVGs/canvas whose visibility rarely changes, and transmitting their
 * full content would bloat the Chrome message payload).
 *
 * Call this before `applyFilters()` when `showVisibleOnly` is toggled ON.
 */
export async function refreshVisibility(): Promise<void> {
  // Data-URI images are inline (SVG, canvas) and always considered visible
  // since they don't correspond to a discoverable DOM element in the same
  // way network-loaded images do. Mark them explicitly so
  // filterByVisibility doesn't drop them (visible defaults to undefined).
  for (const img of state.allImages) {
    if (img.url?.startsWith('data:') && img.visible === undefined) {
      img.visible = true;
    }
  }

  // Only check non-data-URI images to avoid message size issues.
  const checkableImages = state.allImages.filter((img) => img.url && !img.url.startsWith('data:'));
  if (checkableImages.length === 0) return;

  const imageUrls = checkableImages.map((img) => img.url);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.CHECK_VISIBILITY,
      imageUrls,
      tabId: state.currentTabId,
    });

    if (response?.success && response.visibilityMap) {
      const visibilityMap = response.visibilityMap as Record<string, boolean>;
      for (const img of checkableImages) {
        if (img.url in visibilityMap) {
          img.visible = visibilityMap[img.url];
        }
      }
    }
  } catch {
    // If the content script is unreachable (e.g. tab navigated away),
    // fall back to the existing scan-time snapshot — no-op.
  }
}

export function filterByAiTag(img: ImageItem): boolean {
  const tags = state.activeFilters.aiTagFilter;
  if (tags.length === 0) return true;
  if (!img.aiTags || img.aiTags.length === 0) return false;
  return tags.some((t) => img.aiTags!.includes(t));
}

export const FILESIZE_PRESETS: Record<string, { min: number; max: number }> = {
  all: { min: 0, max: Infinity },
  tiny: { min: 0, max: 50 },
  small: { min: 50, max: 200 },
  medium: { min: 200, max: 500 },
  large: { min: 500, max: 2048 },
  xlarge: { min: 2048, max: Infinity },
};

export function applyFileSizePreset(preset: string): void {
  const range = FILESIZE_PRESETS[preset];
  if (!range) return;
  state.activeFilters.fileSizePreset = preset;
  if (preset === 'all') {
    state.activeFilters.fileSizeEnabled = false;
    state.activeFilters.minFileSizeKB = 0;
    state.activeFilters.maxFileSizeKB = Infinity;
  } else {
    state.activeFilters.fileSizeEnabled = true;
    state.activeFilters.minFileSizeKB = range.min;
    state.activeFilters.maxFileSizeKB = range.max;
  }
  const minInput = document.getElementById('filter-filesize-min') as HTMLInputElement | null;
  const maxInput = document.getElementById('filter-filesize-max') as HTMLInputElement | null;
  if (minInput) minInput.value = '';
  if (maxInput) maxInput.value = '';
  updateFilterButtonLabels();
  applyFilters();
}

export function applyFileSizeInputs(): void {
  const minInput = document.getElementById('filter-filesize-min') as HTMLInputElement | null;
  const maxInput = document.getElementById('filter-filesize-max') as HTMLInputElement | null;
  const minVal = minInput?.value ? parseFloat(minInput.value) : 0;
  const maxVal = maxInput?.value ? parseFloat(maxInput.value) : Infinity;

  const hasFilter = minVal > 0 || (maxVal > 0 && maxVal < Infinity);
  state.activeFilters.fileSizeEnabled = hasFilter;
  state.activeFilters.minFileSizeKB = minVal;
  state.activeFilters.maxFileSizeKB = maxVal > 0 ? maxVal : Infinity;

  if (hasFilter) {
    state.activeFilters.fileSizePreset = 'custom';
    document
      .querySelectorAll('[data-filesize-filter]')
      .forEach((o) => o.classList.remove('active'));
  }

  updateFilterButtonLabels();
  applyFilters();
}

export function clearFileSizeInputs(): void {
  const minInput = document.getElementById('filter-filesize-min') as HTMLInputElement | null;
  const maxInput = document.getElementById('filter-filesize-max') as HTMLInputElement | null;
  if (minInput) minInput.value = '';
  if (maxInput) maxInput.value = '';
  state.activeFilters.fileSizeEnabled = false;
  state.activeFilters.fileSizePreset = 'all';
  state.activeFilters.minFileSizeKB = 0;
  state.activeFilters.maxFileSizeKB = Infinity;
}

export function filterBySettingsMaxSize(img: ImageItem): boolean {
  if (!state.activeFilters.customMaxEnabled) return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  return (
    w <= (state.activeFilters.customMaxWidth || Infinity) &&
    h <= (state.activeFilters.customMaxHeight || Infinity)
  );
}

// Custom size inputs helpers
export function clearCustomSizeInputs(): void {
  ['filter-min-width', 'filter-min-height', 'filter-max-width', 'filter-max-height'].forEach(
    (id) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.value = '';
    }
  );
}

export function applyCustomSizeInputs(): void {
  const minWRaw =
    (document.getElementById('filter-min-width') as HTMLInputElement | null)?.value || '';
  const minHRaw =
    (document.getElementById('filter-min-height') as HTMLInputElement | null)?.value || '';
  const maxWRaw =
    (document.getElementById('filter-max-width') as HTMLInputElement | null)?.value || '';
  const maxHRaw =
    (document.getElementById('filter-max-height') as HTMLInputElement | null)?.value || '';

  const minW = minWRaw ? parseInt(minWRaw) : 0;
  const minH = minHRaw ? parseInt(minHRaw) : 0;
  const maxW = maxWRaw ? parseInt(maxWRaw) : 0;
  const maxH = maxHRaw ? parseInt(maxHRaw) : 0;

  // Custom size filter stays enabled as long as any input has a meaningful
  // value (> 0 for min, > 0 for max). Empty inputs are treated as "no limit".
  const hasMin = minW > 0 || minH > 0;
  const hasMax = maxW > 0 || maxH > 0;

  // Only update the session-local (runtime) custom size filter — never
  // touch appSettings or chrome.storage so the global defaults stay
  // intact for the next panel session.
  state.activeFilters.customMinEnabled = hasMin;
  state.activeFilters.customMinWidth = minW;
  state.activeFilters.customMinHeight = minH;
  state.activeFilters.customMaxEnabled = hasMax;
  state.activeFilters.customMaxWidth = hasMax ? maxW || Infinity : Infinity;
  state.activeFilters.customMaxHeight = hasMax ? maxH || Infinity : Infinity;

  // Deselect preset options when custom values are entered
  if (hasMin || hasMax) {
    state.activeFilters.size = 'all';
    state.activeFilters.sizeMin = 0;
    state.activeFilters.sizeMax = Infinity;
    document.querySelectorAll('[data-size-filter]').forEach((o) => o.classList.remove('active'));
  }

  updateFilterButtonLabels();
  applyFilters();
}

/**
 * Initialise the runtime (session-local) custom size filter from the
 * persisted global settings, and populate the toolbar input fields.
 *
 * Called once during init() and again after the user saves settings so
 * that any global changes are immediately reflected in the toolbar.
 * Toolbar edits only modify activeFilters.custom* (see
 * applyCustomSizeInputs) and are discarded when the panel closes.
 */
export function syncCustomSizeInputsFromSettings(): void {
  const minWInput = document.getElementById('filter-min-width') as HTMLInputElement | null;
  const minHInput = document.getElementById('filter-min-height') as HTMLInputElement | null;
  const maxWInput = document.getElementById('filter-max-width') as HTMLInputElement | null;
  const maxHInput = document.getElementById('filter-max-height') as HTMLInputElement | null;

  // ── 1. Copy global settings → runtime locals ──────────────────────────
  state.activeFilters.customMinEnabled = state.appSettings.enableMinSize;
  state.activeFilters.customMinWidth = state.appSettings.minWidth ?? 0;
  state.activeFilters.customMinHeight = state.appSettings.minHeight ?? 0;
  state.activeFilters.customMaxEnabled = state.appSettings.enableMaxSize;
  state.activeFilters.customMaxWidth = state.appSettings.maxWidth ?? 8000;
  state.activeFilters.customMaxHeight = state.appSettings.maxHeight ?? 8000;

  // ── 2. Toggle visibility of the custom-size section ───────────────────
  const customSizeContainer = document.querySelector('.filter-custom-size') as HTMLElement | null;
  const customSizeDivider = customSizeContainer?.previousElementSibling as HTMLElement | null;
  const anyEnabled = state.appSettings.enableMinSize || state.appSettings.enableMaxSize;

  if (customSizeContainer) {
    customSizeContainer.style.display = anyEnabled ? '' : 'none';
  }
  if (customSizeDivider?.classList.contains('filter-divider')) {
    customSizeDivider.style.display = anyEnabled ? '' : 'none';
  }

  // ── 3. Populate input fields from global values ───────────────────────
  if (state.appSettings.enableMinSize) {
    const minW = state.appSettings.minWidth ?? 0;
    const minH = state.appSettings.minHeight ?? 0;
    if (minWInput) minWInput.value = minW > 0 ? String(minW) : '';
    if (minHInput) minHInput.value = minH > 0 ? String(minH) : '';
  } else {
    if (minWInput) minWInput.value = '';
    if (minHInput) minHInput.value = '';
  }
  if (state.appSettings.enableMaxSize) {
    const maxW = state.appSettings.maxWidth ?? Infinity;
    const maxH = state.appSettings.maxHeight ?? Infinity;
    if (maxWInput) maxWInput.value = maxW < Infinity ? String(maxW) : '';
    if (maxHInput) maxHInput.value = maxH < Infinity ? String(maxH) : '';
  } else {
    if (maxWInput) maxWInput.value = '';
    if (maxHInput) maxHInput.value = '';
  }
}

export function resetAllFilters(): void {
  // Preserve showVisibleOnly across resets — it is a persistent user preference
  // stored in chrome.storage, not a transient filter like size/type/layout.
  const preservedShowVisibleOnly = state.activeFilters.showVisibleOnly;
  state.activeFilters = {
    size: 'all',
    sizeMin: 0,
    sizeMax: Infinity,
    types: [],
    layout: 'all',
    urlKeyword: '',
    color: null,
    customMinEnabled: state.appSettings.enableMinSize,
    customMinWidth: state.appSettings.minWidth ?? 0,
    customMinHeight: state.appSettings.minHeight ?? 0,
    customMaxEnabled: state.appSettings.enableMaxSize,
    customMaxWidth: state.appSettings.maxWidth ?? 8000,
    customMaxHeight: state.appSettings.maxHeight ?? 8000,
    fileSizeEnabled: false,
    minFileSizeKB: 0,
    maxFileSizeKB: Infinity,
    fileSizePreset: 'all',
    aiTagFilter: [],
    showVisibleOnly: preservedShowVisibleOnly,
  };
  if (elements.filterUrlInput) (elements.filterUrlInput as HTMLInputElement).value = '';
  const fsMin = document.getElementById('filter-filesize-min') as HTMLInputElement | null;
  const fsMax = document.getElementById('filter-filesize-max') as HTMLInputElement | null;
  if (fsMin) fsMin.value = '';
  if (fsMax) fsMax.value = '';
  document.querySelectorAll('[data-filesize-filter]').forEach((o) => o.classList.remove('active'));
  document.querySelector('[data-filesize-filter="all"]')?.classList.add('active');
  syncCustomSizeInputsFromSettings();
  document.querySelectorAll<HTMLInputElement>('.type-checkbox').forEach((cb) => {
    cb.checked = true;
  });
  document.querySelectorAll('[data-size-filter]').forEach((o) => o.classList.remove('active'));
  document.querySelectorAll('[data-layout-filter]').forEach((o) => o.classList.remove('active'));
  document.querySelector('[data-size-filter="all"]')?.classList.add('active');
  document.querySelector('[data-layout-filter="all"]')?.classList.add('active');
  document
    .querySelectorAll('#color-swatches .color-swatch')
    .forEach((s) => s.classList.remove('active'));
  document.querySelector('[data-color-filter="all"]')?.classList.add('active');
  updateFilterButtonLabels();
}
