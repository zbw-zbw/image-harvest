// ============================================
// Rendering
// ============================================
// 渲染模块：提供图片卡片渲染、分组渲染等功能

import type { ImageItem } from '../shared/types';
import { updateSelectionUI } from './actions';
import {
  filterByColor,
  filterByFileSize,
  filterByLayout,
  filterBySettingsMaxSize,
  filterBySettingsMinSize,
  filterBySize,
  filterByType,
  filterByUrl,
  filterByVisibility,
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
      filterByVisibility(img) &&
      filterBySize(img) &&
      filterByType(img) &&
      filterByLayout(img) &&
      filterByUrl(img) &&
      filterByColor(img) &&
      filterBySettingsMinSize(img) &&
      filterBySettingsMaxSize(img) &&
      filterByFileSize(img)
    );
  });
  sortImages();

  // Compute remaining skeleton slots so the grid stays visually full while
  // discovery continues. <ImageGrid> renders trailing <SkeletonCard> nodes
  // up to scanSkeletonsToShow.
  // When scanning is already complete, clear skeletons immediately to avoid
  // stale placeholders when filtered images are fewer than total slots.
  if (!state.scanProgress.visible) {
    state.scanSkeletonsToShow = 0;
  } else {
    const isListView = elements.imageGrid.classList.contains('list-view');
    const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
    const measured = gridWrapper?.clientHeight || 0;
    const containerHeight = measured > 200 ? measured : 800;
    const totalSlots = calcSkeletonCount(containerHeight, isListView);
    state.scanSkeletonsToShow = Math.max(0, totalSlots - state.filteredImages.length);
  }

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

export function renderImages(options?: { skipScrollReset?: boolean }): void {
  if (!elements.imageGrid) {
    return;
  }

  // Clear skeletons only when scan is fully complete. During progressive
  // rendering, keep remaining skeletons to fill the viewport and prevent
  // visible whitespace below real cards.
  if (!state.scanProgress.visible) {
    state.scanSkeletonsToShow = 0;
  } else {
    // Still scanning — keep enough skeletons to fill remaining space
    const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
    const containerHeight = gridWrapper?.clientHeight || 600;
    const isListView = elements.imageGrid.classList.contains('list-view');
    const totalSlots = calcSkeletonCount(containerHeight, isListView);
    state.scanSkeletonsToShow = Math.max(0, totalSlots - state.filteredImages.length);
  }

  if (state.filteredImages.length === 0) {
    // <ImageGrid> renders nothing when filteredImages is empty — no manual
    // innerHTML clear needed. Hide the grid + show empty-state if we're not
    // mid-scan (scan overlay still visible means analysis still in progress).
    if (!state.scanProgress.visible) {
      elements.imageGrid.classList.add('hidden');
      const isNoResults = state.allImages.length > 0;
      const hiddenCount = isNoResults ? state.allImages.length : undefined;
      showEmpty(isNoResults, hiddenCount);
    }
    return;
  }

  // Ensure the grid wrapper is visible (showEmpty hides it to let the
  // empty-state placeholder take full flex space for vertical centering).
  // Clear both the CSS class AND inline styles — handleTabChange's
  // preemptive hide sets style.display='none' which persists across
  // filter changes if only the class is removed.
  const gridWrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
  if (gridWrapper) {
    gridWrapper.classList.remove('hidden');
    gridWrapper.style.removeProperty('display');
    gridWrapper.style.visibility = '';
  }

  // Reset uiScreen so Preact's <StateScreens> hides any visible
  // empty/error/restricted screen — prevents the "images + empty state
  // both visible" bug that occurs after a tab switch restores cached images.
  state.uiScreen = 'images';

  elements.imageGrid.classList.remove('hidden');

  // Scroll to top on re-render so the user sees images from the beginning,
  // unless the caller explicitly opts out (e.g. tab-switch cache restore).
  if (!options?.skipScrollReset) {
    elements.imageGrid.scrollTop = 0;
  }

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
 * state.collapsedGroups via useStoreSelector — we must replace the Set
 * reference (not mutate in-place) so the Proxy set trap fires and
 * notifySelectors() triggers a Preact re-render.
 */
export function toggleGroupCollapse(groupName: string): void {
  const next = new Set(state.collapsedGroups);
  if (next.has(groupName)) {
    next.delete(groupName);
  } else {
    next.add(groupName);
  }
  state.collapsedGroups = next;
}
