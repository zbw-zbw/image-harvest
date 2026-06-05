import { collectionAdd, collectionGetAll, collectionRemove } from '../shared/collection';
import { getFreeLimits } from '../shared/constants';
import { t } from '../shared/i18n';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { hammingDistance } from '../shared/phash';
import type { CollectionItem, ImageItem } from '../shared/types';
import { applyFilters } from './filter';
import { showProUpgradeModal } from './settings';
import { state } from './state';
import { showToast } from './ui';
// ============================================
// Similar Image Detection (Pro)
// ============================================
export function detectSimilarImages(): void {
  const allImages = state.allImages;
  const withHash = allImages.filter((img) => img.phash);

  // Phase 1: URL-based similarity — strip size/resolution params and group
  // images whose base URLs match. This catches srcset variants that share
  // the same origin image but differ only by a width/height query param.
  const urlGroups = new Map<string, ImageItem[]>();
  for (const img of allImages) {
    const baseUrl = normalizeImageUrl(img.url);
    const existing = urlGroups.get(baseUrl);
    if (existing) existing.push(img);
    else urlGroups.set(baseUrl, [img]);
  }

  if (withHash.length < 2 && [...urlGroups.values()].every((g) => g.length < 2)) return;

  const HASH_THRESHOLD = 10;
  const ASPECT_RATIO_TOLERANCE = 0.25;

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

  const groups: ImageItem[][] = [];
  const usedIds = new Set<string>();

  // Phase 1 results: URL-based groups
  for (const [, urlGroup] of urlGroups) {
    if (urlGroup.length > 1) {
      groups.push(urlGroup);
      for (const img of urlGroup) usedIds.add(img.id);
    }
  }

  // Phase 2: pHash-based similarity (only for images not already grouped)
  const remaining = withHash.filter((img) => !usedIds.has(img.id));
  const used = new Set<number>();

  for (let i = 0; i < remaining.length; i++) {
    if (used.has(i)) continue;
    const group: ImageItem[] = [remaining[i]];
    const baseRatio = getAspectRatio(remaining[i]);

    for (let j = i + 1; j < remaining.length; j++) {
      if (used.has(j)) continue;
      const candidateRatio = getAspectRatio(remaining[j]);
      const isSimilarToAny = group.some((member) => {
        const dist = hammingDistance(member.phash!, remaining[j].phash!);
        return dist <= HASH_THRESHOLD;
      });
      if (isSimilarToAny && areAspectRatiosSimilar(baseRatio, candidateRatio)) {
        group.push(remaining[j]);
        used.add(j);
      }
    }

    if (group.length > 1) {
      groups.push(group);
      used.add(i);
    }
  }

  state.similarGroups = groups;
}

/** Strip common size/resolution query parameters from image URLs to produce
 *  a normalized base URL for comparison. This helps detect srcset variants
 *  (e.g. ?w=200 vs ?w=800) as duplicates. */
function normalizeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common CDN size/quality params
    for (const param of [
      'w',
      'h',
      'width',
      'height',
      'size',
      'resize',
      'quality',
      'q',
      'dpr',
      'fit',
      'crop',
      'sz',
      's',
      'dim',
      'auto',
      'format',
      'fm',
    ]) {
      parsed.searchParams.delete(param);
    }
    // Remove trailing size suffix patterns like -200x300, _200x300
    parsed.pathname = parsed.pathname.replace(/[-_]\d+x\d+(?=\.\w+$)/, '');
    // Remove size in path segments like /32x32/ or /icon-32x32/
    parsed.pathname = parsed.pathname.replace(/[-_]?\d+x\d+\/?/g, '/');
    // Normalize social sharing image variants (opengraph-image, twitter-image,
    // og-image, etc.) to a common key so visually identical share images with
    // different paths are grouped together.
    parsed.pathname = parsed.pathname.replace(
      /\/(opengraph-image|twitter-image|og-image|og_image|twitter_image)(?=\/?$|\?)/,
      '/__social-image__'
    );
    // Collapse repeated slashes
    parsed.pathname = parsed.pathname.replace(/\/+/g, '/');
    return parsed.toString();
  } catch {
    return url;
  }
}

// ── Dedup modal — lazy loaded ──────────────────────────────────────────────
// closeDedupModal stays here (message.ts ESC handler depends on it
// synchronously). removeImageById + detectSimilarImages also stay
// (ImageCard / scan.ts / settings.ts top-level imports). Only the modal
// rendering + bulk removal pipeline is split out to ./dedup-ui.
/** Lazy entry: triggered by the "Dedup" toolbar button. */
export async function showDedupModal(): Promise<void> {
  if (!state.isProUser) {
    const { checkFeatureQuota } = await import('../shared/feature-quota');
    const { allowed, limit } = await checkFeatureQuota('dedup');
    if (!allowed) {
      showToast(
        t('quota_exhausted_monthly', { feature: t('feature_dedup'), limit: String(limit) }),
        'warning'
      );
      showProUpgradeModal();
      return;
    }
  }
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
  applyFilters({ skipScrollReset: true });
  detectSimilarImages();
  showToast(t('toast_image_removed'), 'success');
}

// ============================================
// Collection / Favorites — Pro-only feature.
// Non-Pro users are completely blocked from adding to collection.
// ============================================
export async function addToCollection(img: ImageItem): Promise<void> {
  try {
    const all = await collectionGetAll();

    if (all.some((c: CollectionItem) => c.url === img.url)) {
      showToast(t('toast_collection_already_exists'), 'info');
      void track(EVENTS.COLLECTION_DUPLICATE);
      return;
    }

    if (!state.isProUser) {
      if (all.length >= getFreeLimits().MAX_COLLECTION_ITEMS) {
        showToast(
          t('toast_collection_limit', { max: getFreeLimits().MAX_COLLECTION_ITEMS }),
          'warning'
        );
        void track(EVENTS.COLLECTION_FULL);
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
    void track(EVENTS.COLLECTION_ADDED);
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
  if (!state.isProUser) {
    const { checkFeatureQuota } = await import('../shared/feature-quota');
    const { allowed, limit } = await checkFeatureQuota('multiTab');
    if (!allowed) {
      showToast(
        t('quota_exhausted_monthly', { feature: t('feature_multitab'), limit: String(limit) }),
        'warning'
      );
      showProUpgradeModal();
      return;
    }
  }
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
