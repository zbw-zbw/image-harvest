// Pro Features: Reverse Search, Similar Detection, Collection, Color Extraction, Multi-Tab Extract
//
// JSZip is dynamically imported inside exportCollection only — see actions.ts
// for the same pattern. Avoids pulling ~100 KB into the sidepanel main bundle
// for users who never export their collection.

import type JSZipType from 'jszip';
import { collectionAdd, collectionGetAll, collectionRemove } from '../shared/collection';
import { hammingDistance } from '../shared/phash';
import { isRestrictedUrl } from '../shared/utils';
import type { CollectionItem, ImageItem } from '../shared/types';
import {
  downloadSingle,
  formatTimestamp,
  getActivePageInfo,
  openInNewTab,
  showReverseSearchMenu,
} from './actions';
import { applyFilters } from './filter';
import { processImageExtras } from './scan';
import { showProUpgradeModal } from './settings';
import { elements, state } from './state';
import {
  hideProgress,
  showConfirmDialog,
  showProgress,
  showToast,
  updateFilterButtonLabels,
  updateProgress,
} from './ui';
import { formatBytes, generateFilename, generateId, truncateUrl } from './utils';

// ============================================
// Similar Image Detection (Pro)
// ============================================
export function detectSimilarImages(): void {
  const withHash = state.allImages.filter((img) => img.phash);
  if (withHash.length < 2) return;

  const HASH_THRESHOLD = 0;
  const ASPECT_RATIO_TOLERANCE = 0.15;

  function getAspectRatio(img: ImageItem): number {
    const width = img.naturalWidth || img.displayWidth || 0;
    const height = img.naturalHeight || img.displayHeight || 0;
    if (width <= 0 || height <= 0) return 0;
    return width / height;
  }

  function areAspectRatiosSimilar(ratioA: number, ratioB: number): boolean {
    if (ratioA === 0 || ratioB === 0) return true;
    const diff = Math.abs(ratioA - ratioB) / Math.max(ratioA, ratioB);
    return diff <= ASPECT_RATIO_TOLERANCE;
  }

  state.similarGroups = [];
  const used = new Set<number>();

  for (let i = 0; i < withHash.length; i++) {
    if (used.has(i)) continue;
    const group: ImageItem[] = [withHash[i]];
    const baseRatio = getAspectRatio(withHash[i]);

    for (let j = i + 1; j < withHash.length; j++) {
      if (used.has(j)) continue;
      const candidateRatio = getAspectRatio(withHash[j]);
      const isSimilarToAll = group.every((member) => {
        const dist = hammingDistance(member.phash!, withHash[j].phash!);
        return dist <= HASH_THRESHOLD;
      });
      if (isSimilarToAll && areAspectRatiosSimilar(baseRatio, candidateRatio)) {
        group.push(withHash[j]);
        used.add(j);
      }
    }

    if (group.length > 1) {
      state.similarGroups.push(group);
      used.add(i);
    }
  }

  // similarCount is now a Preact component (StatusCounts.SimilarCount)
  // subscribed to state.similarGroups.length.

  const similarEnabled = state.appSettings.enableSimilarDetection !== false;
  if (elements.btnDedup) {
    elements.btnDedup.style.display =
      similarEnabled && state.similarGroups.length > 0 ? '' : 'none';
  }

  const dedupInfo = document.getElementById('dedup-info');
  if (dedupInfo) {
    dedupInfo.classList.toggle('hidden', !similarEnabled || state.similarGroups.length === 0);
  }
}

// ── Dedup modal — lazy loaded ──────────────────────────────────────────────
// closeDedupModal stays here (message.ts ESC handler depends on it
// synchronously). removeImageById + detectSimilarImages also stay
// (ImageCard / scan.ts / settings.ts top-level imports). Only the modal
// rendering + bulk removal pipeline is split out to ./dedup-ui.
/** Lazy entry: triggered by the "Dedup" toolbar button. */
export async function showDedupModal(): Promise<void> {
  const mod = await import('./dedup-ui');
  mod.showDedupModal();
}

/** Lazy entry: triggered by the modal's "Remove duplicates" button. */
export async function removeDuplicates(): Promise<void> {
  const mod = await import('./dedup-ui');
  return mod.removeDuplicates();
}

export function closeDedupModal(): void {
  state.dedupModalState = { open: false };
}

export function removeImageById(imageId: string): void {
  // Free tier: image deletion requires Pro
  if (!state.isProUser) {
    showToast('Image removal is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }
  state.allImages = state.allImages.filter((img) => img.id !== imageId);
  state.selectedImages.delete(imageId);
  applyFilters();
  detectSimilarImages();
  showToast('Image removed', 'success');
}

// ============================================
// Collection / Favorites (Pro)
// ============================================
export async function addToCollection(img: ImageItem): Promise<void> {
  try {
    // Get the actual page URL from the active tab (not the extension panel URL)
    let pageUrl = '';
    let pageTitle = '';
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        pageUrl = activeTab.url || '';
        pageTitle = activeTab.title || '';
      }
    } catch {
      // Fallback: use tab info from the image if available (multi-tab mode)
      pageUrl = img.tabUrl || '';
      pageTitle = img.tabTitle || '';
    }

    await collectionAdd({
      id: img.id,
      url: img.url,
      width: img.naturalWidth || img.displayWidth,
      height: img.naturalHeight || img.displayHeight,
      format: img.format,
      fileSize: img.estimatedSize,
      colors: img.colors,
      sourceUrl: pageUrl,
      sourceTitle: pageTitle,
      tags: [],
      notes: '',
      createdAt: Date.now(),
    } as CollectionItem);
    showToast('Added to collection', 'success');
  } catch {
    showToast('Failed to add to collection', 'error');
  }
}

export async function isImageInCollection(imgUrl: string): Promise<boolean> {
  try {
    const all = await collectionGetAll();
    return all.some((c: CollectionItem) => c.url === imgUrl);
  } catch {
    return false;
  }
}

export async function removeFromCollection(imgId: string): Promise<void> {
  try {
    await collectionRemove(imgId);
    showToast('Removed from collection', 'success');
  } catch {
    showToast('Failed to remove', 'error');
  }
}

// ── Collection modal — lazy loaded ─────────────────────────────────────────
// closeCollectionModal stays here (message.ts ESC handler depends on it
// synchronously). showCollectionModal / loadCollection / exportCollection
// live in sidepanel/collection-ui.ts (~210 lines + 14 SVG icons + JSZip).
export function closeCollectionModal(): void {
  state.collectionModalState = { open: false };
}

/** Lazy entry: triggered by the "Collection" toolbar button. */
export async function showCollectionModal(): Promise<void> {
  const mod = await import('./collection-ui');
  mod.showCollectionModal();
}

/** Lazy entry: triggered by the modal's "Export" button. */
export async function exportCollection(): Promise<void> {
  const mod = await import('./collection-ui');
  return mod.exportCollection();
}

// ============================================
// Color Extraction (Pro)
// ============================================
export function renderColorBar(colors: string[] | undefined | null): string {
  if (!colors || colors.length === 0) return renderTransparentBar();
  return `<div class="card-colors">${colors
    .map(
      (c) =>
        `<div class="card-color-bar" style="background:${c}" data-color="${c}" title="${state.isProUser ? 'Click to copy ' + c : 'Upgrade to Pro to copy colors'}"></div>`
    )
    .join('')}</div>`;
}

export function renderTransparentBar(): string {
  return `<div class="card-colors"><div class="card-color-bar card-color-bar-transparent" data-transparent="true" title="Transparent image"></div></div>`;
}

export async function copyColor(hex: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hex);
    showToast(`Color ${hex} copied`, 'success');
  } catch {
    showToast('Failed to copy color', 'error');
  }
}

// ============================================
// Multi-Tab Extract (Pro) — lazy loaded
// ============================================
// Only the synchronous closer stays here (message.ts + init.ts depend on
// it for ESC-key dismissal). Everything else lives in
// sidepanel/multitab.ts and is loaded on first user interaction.
export function closeMultiTabModal(): void {
  state.multitabModalState = { open: false };
}

/**
 * Lazy entry point for the "Multi-tab" toolbar button. Loads
 * sidepanel/multitab.ts on demand (saves ~10 kB gzip on first paint for
 * users who never click this).
 */
export async function showMultiTabModal(): Promise<void> {
  const mod = await import('./multitab');
  mod.showMultiTabModal();
}

/** Lazy entry: triggered by the "Start extraction" button in the modal. */
export async function startMultiTabExtract(tabIds: number[]): Promise<void> {
  const mod = await import('./multitab');
  return mod.startMultiTabExtract(tabIds);
}

/** Lazy entry: triggered by the modal's "Select all" checkbox. */
export async function toggleMultitabSelectAll(): Promise<void> {
  const mod = await import('./multitab');
  mod.toggleMultitabSelectAll();
}
