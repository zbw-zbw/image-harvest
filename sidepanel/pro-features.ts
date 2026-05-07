import { collectionAdd, collectionGetAll, collectionRemove } from '../shared/collection';
import { FREE_LIMITS } from '../shared/constants';
import { t } from '../shared/i18n';
import { hammingDistance } from '../shared/phash';
import type { CollectionItem, ImageItem } from '../shared/types';
import { applyFilters } from './filter';
import { showProUpgradeModal } from './settings';
import { elements, state } from './state';
import { showToast } from './ui';
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

  // Similar button is now always visible in the status bar. The badge
  // count is Preact-managed (SimilarCount) and auto-hides when 0.
  // No imperative DOM toggling needed.
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

/**
 * Remove an image from the in-memory list and re-run downstream
 * pipelines (filters + similar-group detection).
 *
 * Pure business inverse: callers are responsible for any Pro/permission
 * gating *before* invoking this. Embedding the Pro check at this level
 * (the previous behavior) misled callers into thinking they could call
 * unconditionally, and produced surprising silent redirects to the
 * upgrade modal — see ImageCard.handleDelete which originally awaited
 * the confirm dialog and only then discovered the action would not run.
 *
 * Implementation note: state is a Proxy that only traps property
 * assignments — calling `state.selectedImages.delete(id)` mutates the
 * Set in place and never reaches the trap, so selector subscribers
 * watching `s.selectedImages.size` (StatusCounts.DownloadLabel) would
 * silently go stale after deleting a selected image. Reassigning
 * `state.selectedImages = new Set(...)` goes through the trap and
 * fires notifySelectors so the "Download (N)" label re-renders. We
 * only allocate when the deleted image was actually selected; in the
 * common case (deleting an un-selected image) the Set reference is
 * left untouched.
 */
export function removeImageById(imageId: string): void {
  state.allImages = state.allImages.filter((img) => img.id !== imageId);
  if (state.selectedImages.has(imageId)) {
    const next = new Set(state.selectedImages);
    next.delete(imageId);
    state.selectedImages = next;
  }
  applyFilters();
  detectSimilarImages();
  showToast(t('toast_image_removed'), 'success');
}

// ============================================
// Collection / Favorites — Sprint 3.5: Free users get 5 "tasting" slots,
// Pro is unlimited. The Pro guard moved from ImageCard.handleFavorite to
// here so the limit lives next to the data write — keeping the cap as a
// pure-data concern means future entry points (drag-to-collection,
// keyboard shortcut) automatically inherit the same gate.
// ============================================
export async function addToCollection(img: ImageItem): Promise<void> {
  try {
    // Free-tier cap: count current items first; if at/over the cap, block
    // and surface the upgrade modal. Pro users skip this entirely. We
    // count before write to avoid race-y "added then immediately removed"
    // UX when the user is exactly at the threshold.
    if (!state.isProUser) {
      const existing = await collectionGetAll();
      // If this image is already collected (toggle case), let the write
      // proceed; collectionAdd is idempotent on { id }.
      const alreadyIn = existing.some((c: CollectionItem) => c.id === img.id);
      if (!alreadyIn && existing.length >= FREE_LIMITS.MAX_COLLECTION_ITEMS) {
        showToast(t('pro_collection_limit', { max: FREE_LIMITS.MAX_COLLECTION_ITEMS }), 'warning');
        showProUpgradeModal();
        return;
      }
    }

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
    showToast(t('toast_collection_added'), 'success');
  } catch {
    showToast(t('toast_collection_add_failed'), 'error');
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
    showToast(t('toast_collection_removed'), 'success');
  } catch {
    showToast(t('toast_collection_remove_failed'), 'error');
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
        `<div class="card-color-bar" style="background:${c}" data-color="${c}" title="${state.isProUser ? t('title_click_copy_color', { color: c }) : t('title_upgrade_copy_color')}"></div>`
    )
    .join('')}</div>`;
}

export function renderTransparentBar(): string {
  return `<div class="card-colors"><div class="card-color-bar card-color-bar-transparent" data-transparent="true" title="${t('title_transparent_image')}"></div></div>`;
}

export async function copyColor(hex: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hex);
    showToast(t('toast_color_copied', { hex }), 'success');
  } catch {
    showToast(t('toast_color_copy_failed'), 'error');
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
