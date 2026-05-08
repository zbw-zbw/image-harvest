// ============================================
// Filtering & Sorting
// ============================================
// 过滤和排序模块：提供图片过滤、排序、颜色过滤等功能

import type { ImageItem } from '../shared/types';
import { updateSelectionUI } from './actions';
import { renderImages } from './render';
import { closeAllFilterDropdowns, showProUpgradeModal } from './settings';
import { state } from './state';
import { t } from '../shared/i18n';
import { showToast } from './ui';
import { updateFilterButtonLabels } from './ui';
import { getAspectRatioCategory } from './utils';

export function applyFilters(): void {
  state.filteredImages = state.allImages.filter((img) => {
    return (
      filterBySize(img) &&
      filterByType(img) &&
      filterByLayout(img) &&
      filterByUrl(img) &&
      filterByColor(img) &&
      filterBySettingsMinSize(img) &&
      filterBySettingsMaxSize(img)
    );
  });

  sortImages();

  // Skip renderImages() if the filtered image list is identical to the last
  // render. This avoids unnecessary scrollTop resets and count updates when
  // tab-switch cache restore produces the same filtered set.
  const currentFilteredIds = state.filteredImages.map((img) => img.id).join(',');
  if (currentFilteredIds === state.lastRenderedFilteredIds) {
    // Still update selection UI in case selection state changed
    updateSelectionUI();
    return;
  }
  state.lastRenderedFilteredIds = currentFilteredIds;

  renderImages();
  updateSelectionUI();
}

export function sortImages(): void {
  sortImagesArray(state.filteredImages);
}

/** Sort an array of images in-place using the current sort mode. */
export function sortImagesArray(images: ImageItem[]): void {
  images.sort((a, b) => {
    const aW = a.naturalWidth || a.displayWidth || 0;
    const aH = a.naturalHeight || a.displayHeight || 0;
    const bW = b.naturalWidth || b.displayWidth || 0;
    const bH = b.naturalHeight || b.displayHeight || 0;
    const aPixels = aW * aH;
    const bPixels = bW * bH;

    switch (state.currentSortMode) {
      case 'size-asc':
        return aPixels - bPixels;
      case 'filesize-desc':
        return (b.estimatedSize || 0) - (a.estimatedSize || 0);
      case 'filesize-asc':
        return (a.estimatedSize || 0) - (b.estimatedSize || 0);
      case 'type':
        return (a.format || '').localeCompare(b.format || '');
      case 'natural':
        return 0;
      case 'size-desc':
      default:
        return bPixels - aPixels;
    }
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

  container.innerHTML = sortedColors
    .map(
      (hex) =>
        `<div class="color-swatch${state.activeFilters.color === hex ? ' active' : ''}" style="background:${hex}" data-color-value="${hex}" title="${hex}"></div>`
    )
    .join('');

  // Bind click events
  container.querySelectorAll<HTMLElement>('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.isProUser) {
        showToast(t('toast_pro_color_filter'), 'warning');
        showProUpgradeModal();
        return;
      }
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
  if (!state.appSettings.enableMinSize) return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  return (
    w >= ((state.appSettings.minWidth as number | undefined) || 0) &&
    h >= ((state.appSettings.minHeight as number | undefined) || 0)
  );
}

export function filterBySettingsMaxSize(img: ImageItem): boolean {
  if (!state.appSettings.enableMaxSize) return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  return (
    w <= ((state.appSettings.maxWidth as number | undefined) || Infinity) &&
    h <= ((state.appSettings.maxHeight as number | undefined) || Infinity)
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
  const minW =
    parseInt(
      (document.getElementById('filter-min-width') as HTMLInputElement | null)?.value || ''
    ) || 0;
  const minH =
    parseInt(
      (document.getElementById('filter-min-height') as HTMLInputElement | null)?.value || ''
    ) || 0;
  const maxW =
    parseInt(
      (document.getElementById('filter-max-width') as HTMLInputElement | null)?.value || ''
    ) || 0;
  const maxH =
    parseInt(
      (document.getElementById('filter-max-height') as HTMLInputElement | null)?.value || ''
    ) || 0;

  const hasMin = minW > 0 || minH > 0;
  const hasMax = maxW > 0 || maxH > 0;

  state.appSettings.enableMinSize = hasMin;
  state.appSettings.minWidth = minW || 0;
  state.appSettings.minHeight = minH || 0;
  state.appSettings.enableMaxSize = hasMax;
  state.appSettings.maxWidth = maxW || Infinity;
  state.appSettings.maxHeight = maxH || Infinity;

  // Deselect preset options when custom values are entered
  if (hasMin || hasMax) {
    state.activeFilters.size = 'all';
    state.activeFilters.sizeMin = 0;
    state.activeFilters.sizeMax = Infinity;
    document.querySelectorAll('[data-size-filter]').forEach((o) => o.classList.remove('active'));
  }

  updateFilterButtonLabels();
  applyFilters();

  // Persist to storage
  chrome.storage.local.set({ appSettings: state.appSettings }).catch(() => {});
}

export function syncCustomSizeInputsFromSettings(): void {
  const minWInput = document.getElementById('filter-min-width') as HTMLInputElement | null;
  const minHInput = document.getElementById('filter-min-height') as HTMLInputElement | null;
  const maxWInput = document.getElementById('filter-max-width') as HTMLInputElement | null;
  const maxHInput = document.getElementById('filter-max-height') as HTMLInputElement | null;

  if (state.appSettings.enableMinSize) {
    if (minWInput && state.appSettings.minWidth)
      minWInput.value = String(state.appSettings.minWidth);
    if (minHInput && state.appSettings.minHeight)
      minHInput.value = String(state.appSettings.minHeight);
  }
  if (state.appSettings.enableMaxSize) {
    const maxW = state.appSettings.maxWidth as number | undefined;
    const maxH = state.appSettings.maxHeight as number | undefined;
    if (maxWInput && maxW && maxW < Infinity) maxWInput.value = String(maxW);
    if (maxHInput && maxH && maxH < Infinity) maxHInput.value = String(maxH);
  }
}
