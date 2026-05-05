// ============================================
// Rendering
// ============================================
// 渲染模块：提供图片卡片渲染、分组渲染等功能

import type { ImageItem } from '../shared/types';
import { updateSelectionUI } from './actions';
import {
  filterByColor,
  filterByLayout,
  filterBySettingsMaxSize,
  filterBySettingsMinSize,
  filterBySize,
  filterByType,
  filterByUrl,
  sortImages,
} from './filter';
import { elements, state } from './state';
import { calcSkeletonCount, checkNarrowMode, showEmpty } from './ui';
import { getSizeCategory } from './utils';

interface ImageGroup {
  name: string;
  images: ImageItem[];
  tabIndex: number;
  isCurrentTab: boolean;
}

/**
 * Render real image cards followed by remaining skeleton placeholders.
 * Called during scanning to progressively replace skeletons with real images.
 */
export function renderProgressiveImages(): void {
  if (!elements.imageGrid) return;

  // Apply filters + sort. Mutating state.filteredImages triggers <ImageGrid>
  // to re-render via its store subscription — no manual innerHTML write.
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

  // Compute remaining skeleton slots so the grid stays visually full while
  // discovery continues. <ImageGrid> renders trailing <SkeletonCard> nodes
  // up to scanSkeletonsToShow.
  const isListView = elements.imageGrid.classList.contains('list-view');
  const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
  const containerHeight = gridWrapper?.clientHeight || 600;
  const totalSlots = calcSkeletonCount(containerHeight, isListView);
  state.scanSkeletonsToShow = Math.max(0, totalSlots - state.filteredImages.length);

  elements.imageGrid.classList.remove('hidden');
  // Scroll to top so the user always sees images from the beginning
  elements.imageGrid.scrollTop = 0;

  checkNarrowMode();

  // Update counts. foundActionCount is now Preact-managed (subscribes to
  // filteredImages directly) — only the still-imperative foundCount is set.
  if (elements.foundCount) {
    elements.foundCount.textContent = String(state.filteredImages.length);
  }
  updateSelectionUI();
}

export function renderImages(): void {
  if (!elements.imageGrid) return;

  // Final render pass: clear any leftover skeletons so the grid shows only
  // real cards. <ImageGrid> reads scanSkeletonsToShow from the store.
  state.scanSkeletonsToShow = 0;

  if (state.filteredImages.length === 0) {
    // <ImageGrid> renders nothing when filteredImages is empty — no manual
    // innerHTML clear needed. Hide the grid + show empty-state if we're not
    // mid-scan (scan overlay still visible means analysis still in progress).
    if (!state.scanProgress.visible) {
      elements.imageGrid.classList.add('hidden');
      showEmpty(state.allImages.length > 0);
    }
    return;
  }

  // Ensure the grid wrapper is visible (showEmpty hides it to let the
  // empty-state placeholder take full flex space for vertical centering)
  const gridWrapper = document.querySelector('.image-grid-wrapper');
  if (gridWrapper) gridWrapper.classList.remove('hidden');

  elements.imageGrid.classList.remove('hidden');

  // Always scroll to top on re-render so the user sees images from the beginning
  elements.imageGrid.scrollTop = 0;

  // Re-check narrow mode after grid becomes visible (important for popup mode
  // where initial check may see clientWidth=0 when grid was hidden)
  checkNarrowMode();

  // Update counts. foundActionCount is Preact-managed.
  if (elements.foundCount) {
    elements.foundCount.textContent = String(state.filteredImages.length);
  }
  updateSelectionUI();
}

// ============================================
// Grouping
// ============================================
export function groupImages(images: ImageItem[], mode: string): ImageGroup[] {
  const groups = new Map<
    string,
    { images: ImageItem[]; tabIndex: number; isCurrentTab: boolean }
  >();

  images.forEach((img) => {
    let key = 'Other';
    switch (mode) {
      case 'domain':
        try {
          const parsedUrl = new URL(img.url);
          key = parsedUrl.hostname || 'Other';
          // data: URLs and blob: URLs have no meaningful hostname
          if (
            !key ||
            key === '' ||
            parsedUrl.protocol === 'data:' ||
            parsedUrl.protocol === 'blob:'
          ) {
            key = 'Other';
          }
        } catch {
          key = 'Other';
        }
        break;
      case 'format':
        key = (img.format || 'unknown').toUpperCase();
        break;
      case 'size':
        key = getSizeCategory(
          img.naturalWidth || img.displayWidth,
          img.naturalHeight || img.displayHeight
        );
        break;
      case 'tab':
        key =
          img.tabTitle ||
          (img as ImageItem & { sourceTabTitle?: string }).sourceTabTitle ||
          'Current Tab';
        break;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        images: [],
        tabIndex: img.tabIndex ?? Infinity,
        isCurrentTab: !!img.isCurrentTab,
      });
    }
    groups.get(key)!.images.push(img);
  });

  const result: ImageGroup[] = Array.from(groups.entries()).map(([name, data]) => ({
    name,
    images: data.images,
    tabIndex: data.tabIndex,
    isCurrentTab: data.isCurrentTab,
  }));

  if (mode === 'tab') {
    return result.sort((a, b) => a.tabIndex - b.tabIndex);
  }
  // Sort by image count descending, but always put "Other" / "Unknown" at the end
  return result.sort((a, b) => {
    const aIsOther = a.name === 'Other' || a.name === 'Unknown';
    const bIsOther = b.name === 'Other' || b.name === 'Unknown';
    if (aIsOther && !bIsOther) return 1;
    if (!aIsOther && bIsOther) return -1;
    return b.images.length - a.images.length;
  });
}

/**
 * Toggle a group's collapsed state. <ImageGrid> subscribes to
 * state.collapsedGroups, so mutating the set is enough to trigger a
 * re-render — no manual renderImages() call needed.
 */
export function toggleGroupCollapse(groupName: string): void {
  if (state.collapsedGroups.has(groupName)) {
    state.collapsedGroups.delete(groupName);
  } else {
    state.collapsedGroups.add(groupName);
  }
}
