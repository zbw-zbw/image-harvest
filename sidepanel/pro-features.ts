// Pro Features: Reverse Search, Similar Detection, Collection, Color Extraction, Multi-Tab Extract

import JSZip from 'jszip';
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

export function showDedupModal(): void {
  // Open the Preact-managed shell. The cached `elements.dedupModal` ref may
  // be stale (Preact replaced the DOM node on mount), so look it up fresh
  // when we need to scroll the body.
  state.dedupModalState = { open: true };
  const modalEl = document.getElementById('dedup-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  // Re-resolve the body slot too — it lives inside the Preact-rendered
  // subtree so the cached ref is unreliable.
  const dedupBody = document.getElementById('dedup-body');
  if (dedupBody) {
    if (state.similarGroups.length === 0) {
      dedupBody.innerHTML = '<p class="empty-message">No similar images found</p>';
      return;
    }
    dedupBody.innerHTML = `
      <p class="dedup-hint">Click images to mark them for removal</p>
      ${state.similarGroups
        .map(
          (group, gi) => `
      <div class="dedup-group" data-group="${gi}">
        <div class="dedup-group-title">Group ${gi + 1} (${group.length} similar)</div>
        <div class="dedup-group-images">
          ${group
            .map(
              (img, ii) => `
            <div class="dedup-image" data-group="${gi}" data-index="${ii}">
              <div class="dedup-image-thumb">
                <img src="${img.url}" alt="">
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `
        )
        .join('')}`;

    // Click image to toggle selection (mark for removal)
    dedupBody.querySelectorAll('.dedup-image').forEach((el) => {
      el.addEventListener('click', () => {
        el.classList.toggle('selected');
      });
    });
  }
}

export function closeDedupModal(): void {
  state.dedupModalState = { open: false };
}

export async function removeDuplicates(): Promise<void> {
  if (!state.isProUser) {
    closeDedupModal();
    showToast('Removing duplicates is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }

  const toRemove = new Set<string>();

  state.similarGroups.forEach((group, gi) => {
    group.forEach((img, ii) => {
      const el = document.querySelector(`.dedup-image[data-group="${gi}"][data-index="${ii}"]`);
      if (el && el.classList.contains('selected')) toRemove.add(img.id);
    });
  });

  // If no images were manually selected, default to removing all duplicates
  // in each similar group (keep the first image, remove the rest).
  if (toRemove.size === 0) {
    state.similarGroups.forEach((group) => {
      for (let i = 1; i < group.length; i++) {
        toRemove.add(group[i].id);
      }
    });
  }

  if (toRemove.size === 0) {
    showToast('No duplicate images found', 'info');
    return;
  }

  const confirmed = await showConfirmDialog({
    title: 'Remove Duplicates',
    message: `Are you sure you want to remove ${toRemove.size} selected duplicate image${toRemove.size > 1 ? 's' : ''}?`,
    confirmText: 'Remove',
    cancelText: 'Cancel',
    type: 'danger',
  });
  if (!confirmed) return;

  state.allImages = state.allImages.filter((img) => !toRemove.has(img.id));
  state.selectedImages = new Set([...state.selectedImages].filter((id) => !toRemove.has(id)));

  closeDedupModal();
  applyFilters();
  detectSimilarImages();
  showToast(`Removed ${toRemove.size} duplicate images`, 'success');
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

export function showCollectionModal(): void {
  // Open the Preact-managed shell. cached refs may be stale because Preact
  // owns the modal subtree now — re-resolve via getElementById.
  state.collectionModalState = { open: true };
  const modalEl = document.getElementById('collection-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  // Bind search input. The input lives inside the Preact subtree; use a
  // fresh lookup so we don't grab a detached reference from cacheElements().
  const searchInput = document.getElementById('collection-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = () => {
      loadCollection(searchInput.value.trim());
    };
  }
  loadCollection();
}

export function closeCollectionModal(): void {
  state.collectionModalState = { open: false };
}

export async function loadCollection(searchQuery = ''): Promise<void> {
  if (!elements.collectionBody) return;

  try {
    let items: CollectionItem[] = await collectionGetAll();

    // Filter by search query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          (item.url && item.url.toLowerCase().includes(lowerQuery)) ||
          (item.sourceTitle && item.sourceTitle.toLowerCase().includes(lowerQuery)) ||
          (item.sourceUrl && item.sourceUrl.toLowerCase().includes(lowerQuery)) ||
          (item.tags && item.tags.some((tag: string) => tag.toLowerCase().includes(lowerQuery)))
      );
    }

    // Sort by newest first
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (items.length === 0) {
      elements.collectionBody.innerHTML = `
        <div class="collection-empty">
          <div class="collection-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          <p>${searchQuery ? 'No matching images found' : 'No images in collection yet'}</p>
          <p style="font-size:11px;margin-top:4px;color:var(--text-tertiary)">${searchQuery ? 'Try a different search term' : 'Click the ★ button on any image to save it here'}</p>
        </div>`;
      return;
    }

    elements.collectionBody.innerHTML = `
      <div class="collection-grid">
        ${items
          .map((item) => {
            const dims = item.width && item.height ? `${item.width}×${item.height}` : '';
            const format = ((item.format as string | undefined) || 'unknown').toUpperCase();
            const fileSize = item.fileSize ? formatBytes(item.fileSize as number) : '';
            return `
          <div class="image-card collection-card" data-id="${item.id}">
            <div class="card-thumb checkerboard">
              <img src="${item.url}" alt="" loading="lazy">
            </div>
            <div class="card-info-bar">
              <div class="card-tags">
                <span class="card-tag format">${format}</span>
                ${dims ? `<span class="card-tag dims">${dims}</span>` : ''}
                ${fileSize ? `<span class="card-tag filesize">${fileSize}</span>` : ''}
              </div>
              <div class="card-actions">
                <button class="card-action-btn btn-search-collection" title="Reverse search" data-url="${item.url}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="card-action-btn btn-dl-collection" data-url="${item.url}" data-format="${item.format || ''}" title="Download">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="card-action-btn btn-remove-collection" data-id="${item.id}" title="Remove from collection">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            <div class="card-url-row">
              <div class="card-url" title="${item.url}">${item.url}</div>
              <div class="card-url-actions">
                <button class="card-action-btn btn-copy-collection" data-url="${item.url}" title="Copy URL">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button class="card-action-btn btn-open-collection" data-url="${item.url}" title="Open in new tab">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
              </div>
            </div>
          </div>`;
          })
          .join('')}
      </div>`;

    // Bind action events
    elements.collectionBody
      .querySelectorAll<HTMLElement>('.btn-remove-collection')
      .forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeFromCollection(btn.dataset.id!);
          // Also update favorite button state in main grid
          const mainCard = document.querySelector(
            `.image-card[data-id="${btn.dataset.id}"] .btn-favorite`
          );
          if (mainCard) {
            mainCard.classList.remove('favorited');
            (mainCard as HTMLElement).title = 'Add to collection';
          }
          loadCollection(
            (elements.collectionSearch as HTMLInputElement | null)?.value?.trim() || ''
          );
        });
      });

    elements.collectionBody.querySelectorAll<HTMLElement>('.btn-open-collection').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInNewTab(btn.dataset.url!);
      });
    });

    elements.collectionBody.querySelectorAll<HTMLElement>('.btn-copy-collection').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(btn.dataset.url!);
          showToast('URL copied', 'success');
        } catch {
          showToast('Failed to copy URL', 'error');
        }
      });
    });

    elements.collectionBody.querySelectorAll<HTMLElement>('.btn-dl-collection').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const imgObj = {
          url: btn.dataset.url!,
          format: btn.dataset.format || 'unknown',
        } as unknown as ImageItem;
        downloadSingle(imgObj, null);
      });
    });

    elements.collectionBody
      .querySelectorAll<HTMLElement>('.btn-search-collection')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          showReverseSearchMenu(btn.dataset.url!, e.currentTarget as HTMLElement);
        });
      });

    // Handle broken images
    elements.collectionBody.querySelectorAll<HTMLImageElement>('.card-thumb img').forEach((img) => {
      img.addEventListener('load', () => {
        img.classList.add('loaded');
        img.parentElement?.classList.add('loaded');
      });
      img.addEventListener('error', () => {
        img.style.display = 'none';
        img.parentElement?.classList.add('loaded');
      });
    });
  } catch {
    elements.collectionBody.innerHTML = `
      <div class="collection-empty">
        <div class="collection-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <p>Failed to load collection</p>
      </div>`;
  }
}

export async function exportCollection(): Promise<void> {
  // Hoisted out of `try` so the `catch` block below can read it without
  // running into a TDZ / no-undef bug.
  let aborted = false;

  try {
    const items: CollectionItem[] = await collectionGetAll();

    if (items.length === 0) {
      showToast('Collection is empty', 'info');
      return;
    }

    showProgress('Exporting collection...', () => {
      aborted = true;
      showToast('Export cancelled', 'info');
    });

    const zip = new JSZip();
    const pageInfo = await getActivePageInfo();
    const folder = zip.folder('collection')!;

    for (let i = 0; i < items.length; i++) {
      if (aborted) return;

      updateProgress(i + 1, items.length, truncateUrl(items[i].url, 40));
      try {
        const resp = await fetch(items[i].url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          folder.file(generateFilename(items[i] as unknown as ImageItem, i, null, pageInfo), blob);
        }
      } catch {
        /* skip */
      }
    }

    if (aborted) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);
    const ts = formatTimestamp(new Date());
    await chrome.downloads.download({
      url: blobUrl,
      filename: `collection-${ts}.zip`,
      saveAs: false,
    });
    URL.revokeObjectURL(blobUrl);
    showToast('Collection exported', 'success');
  } catch {
    if (!aborted) showToast('Export failed', 'error');
  } finally {
    hideProgress();
  }
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
// Multi-Tab Extract (Pro)
// ============================================
export function showMultiTabModal(): void {
  // Open the Preact-managed shell. modal element ref is re-resolved because
  // Preact owns the subtree now (cached elements.multitabModal would be stale).
  state.multitabModalState = { open: true };
  const modalEl = document.getElementById('multitab-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  loadTabList();
}

export function closeMultiTabModal(): void {
  state.multitabModalState = { open: false };
}

export function getFallbackFaviconUrl(pageUrl: string): string {
  try {
    const urlObj = new URL(pageUrl);
    return `${urlObj.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

export async function loadTabList(): Promise<void> {
  if (!elements.multitabList) return;
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const validTabs = tabs.filter((tab) => !isRestrictedUrl(tab.url));
    // Sort: current (active) tab first
    validTabs.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    elements.multitabList.innerHTML = validTabs
      .map((tab) => {
        const faviconUrl = tab.favIconUrl || getFallbackFaviconUrl(tab.url || '');
        return `
      <div class="tab-item${tab.active ? ' tab-current' : ''}" data-tab-id="${tab.id}">
        <label class="tab-checkbox" data-tab-id="${tab.id}">
          <input type="checkbox" value="${tab.id}">
          <span class="checkbox-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </label>
        <img src="${faviconUrl}" alt="" class="tab-favicon">
        <div class="tab-info">
          <div class="tab-title">${tab.title || 'Untitled'}${tab.active ? '<span class="tab-current-badge">Current</span>' : ''}</div>
          <div class="tab-url">${truncateUrl(tab.url || '', 50)}</div>
        </div>
      </div>
    `;
      })
      .join('');

    // Click entire tab-item row to toggle checkbox
    elements.multitabList.querySelectorAll<HTMLElement>('.tab-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tab-checkbox')) return;
        const checkbox = item.querySelector<HTMLInputElement>('.tab-checkbox input');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          toggleTabCheckboxVisual(item);
          updateMultitabSelectAllState();
        }
      });
    });

    // Update select-all state when individual checkboxes change
    elements.multitabList
      .querySelectorAll<HTMLInputElement>('.tab-checkbox input')
      .forEach((cb) => {
        cb.addEventListener('change', () => {
          toggleTabCheckboxVisual(cb.closest('.tab-item') as HTMLElement);
          updateMultitabSelectAllState();
        });
      });

    // When favicon fails to load, try resolving from the page's <link> tags
    elements.multitabList.querySelectorAll<HTMLImageElement>('.tab-favicon').forEach((favicon) => {
      favicon.addEventListener('error', () => {
        favicon.style.visibility = 'hidden';
        const tabItem = favicon.closest('.tab-item') as HTMLElement | null;
        const tabId = tabItem ? Number(tabItem.dataset.tabId) : null;
        if (tabId) resolveTabFaviconById(tabId, favicon);
      });
    });

    // Async: try to resolve real favicon from page <link> for tabs missing favIconUrl
    resolveTabFavicons(validTabs);

    updateMultitabSelectAllState();
  } catch {
    elements.multitabList.innerHTML = '<p class="empty-message">Failed to load tabs</p>';
  }
}

/**
 * For tabs missing favIconUrl, try to resolve the real favicon from the page's
 * <link rel="icon"> via chrome.scripting.executeScript, then update the img src.
 */
export async function resolveTabFavicons(tabs: chrome.tabs.Tab[]): Promise<void> {
  const tabsMissingFavicon = tabs.filter((tab) => !tab.favIconUrl);
  if (tabsMissingFavicon.length === 0) return;

  for (const tab of tabsMissingFavicon) {
    if (tab.id == null) continue;
    const tabItem = elements.multitabList?.querySelector(`[data-tab-id="${tab.id}"]`);
    const faviconImg = tabItem?.querySelector<HTMLImageElement>('.tab-favicon');
    if (!faviconImg) continue;

    let resolved = false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const selectors = [
            'link[rel="icon"]',
            'link[rel="shortcut icon"]',
            'link[rel="apple-touch-icon"]',
            'link[rel="apple-touch-icon-precomposed"]',
          ];
          const linkEl = document.querySelector(selectors.join(','));
          return linkEl ? (linkEl as HTMLLinkElement).href : null;
        },
      });
      const resolvedUrl = results?.[0]?.result as string | null | undefined;
      if (resolvedUrl) {
        faviconImg.addEventListener(
          'error',
          () => {
            tryGoogleFaviconFallback(tab.id!, faviconImg);
          },
          { once: true }
        );
        faviconImg.src = resolvedUrl;
        faviconImg.style.visibility = '';
        resolved = true;
      }
    } catch {
      // Tab may be restricted or discarded
    }

    // If page <link> resolution failed, try Google favicon service
    if (!resolved) {
      tryGoogleFaviconFallback(tab.id, faviconImg);
    }
  }
}

/**
 * Resolve favicon for a single tab by ID (used when an img fails to load).
 * Tries: 1) page's <link rel="icon">, 2) Google favicon service as fallback.
 */
export async function resolveTabFaviconById(
  tabId: number,
  faviconImg: HTMLImageElement
): Promise<void> {
  const previousSrc = faviconImg.src;

  // Step 1: try to get real favicon from the page's <link> tags
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [
          'link[rel="icon"]',
          'link[rel="shortcut icon"]',
          'link[rel="apple-touch-icon"]',
          'link[rel="apple-touch-icon-precomposed"]',
        ];
        const linkEl = document.querySelector(selectors.join(','));
        return linkEl ? (linkEl as HTMLLinkElement).href : null;
      },
    });
    const resolvedUrl = results?.[0]?.result as string | null | undefined;
    // Only try the resolved URL if it's different from what already failed
    if (resolvedUrl && resolvedUrl !== previousSrc && faviconImg) {
      faviconImg.addEventListener(
        'error',
        () => {
          // Step 2: resolved URL also failed — fall back to Google favicon service
          tryGoogleFaviconFallback(tabId, faviconImg);
        },
        { once: true }
      );
      faviconImg.src = resolvedUrl;
      faviconImg.style.visibility = '';
      return;
    }
  } catch {
    // Tab may be restricted or discarded
  }

  // Step 2: fall back to Google favicon service
  tryGoogleFaviconFallback(tabId, faviconImg);
}

/**
 * Use Google's favicon service as the final fallback.
 */
export async function tryGoogleFaviconFallback(
  tabId: number,
  faviconImg: HTMLImageElement
): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return;
    const origin = new URL(tab.url).origin;
    const googleFaviconUrl = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(origin)}`;
    faviconImg.addEventListener(
      'error',
      () => {
        faviconImg.style.visibility = 'hidden';
      },
      { once: true }
    );
    faviconImg.src = googleFaviconUrl;
    faviconImg.style.visibility = '';
  } catch {
    faviconImg.style.visibility = 'hidden';
  }
}

export function toggleTabCheckboxVisual(tabItem: HTMLElement): void {
  const checkbox = tabItem.querySelector<HTMLInputElement>('.tab-checkbox input');
  const tabCheckbox = tabItem.querySelector('.tab-checkbox');
  if (!checkbox || !tabCheckbox) return;
  tabCheckbox.classList.toggle('checked', checkbox.checked);
}

export function updateMultitabSelectAllState(): void {
  const selectAllBtn = document.getElementById('multitab-select-all');
  if (!selectAllBtn) return;
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.tab-checkbox input');
  const checkedCount = Array.from(checkboxes).filter((cb) => cb.checked).length;
  const totalCount = checkboxes.length;

  const textEl = selectAllBtn.querySelector('.select-all-text');

  selectAllBtn.classList.remove('checked', 'partial');
  const checkIcon = selectAllBtn.querySelector('.check-icon');

  if (checkedCount === totalCount && totalCount > 0) {
    selectAllBtn.classList.add('checked');
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (textEl) textEl.textContent = `${checkedCount} selected`;
  } else if (checkedCount > 0) {
    selectAllBtn.classList.add('partial');
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (textEl) textEl.textContent = `${checkedCount} selected`;
  } else {
    if (checkIcon) checkIcon.classList.add('hidden');
    if (textEl) textEl.textContent = 'Select all';
  }
}

export function toggleMultitabSelectAll(): void {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.tab-checkbox input');
  const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every((cb) => cb.checked);
  checkboxes.forEach((cb) => {
    cb.checked = !allChecked;
  });
  document
    .querySelectorAll<HTMLElement>('.tab-item')
    .forEach((item) => toggleTabCheckboxVisual(item));
  updateMultitabSelectAllState();
}

export async function startMultiTabExtract(tabIds: number[]): Promise<void> {
  let aborted = false;
  state.isMultiTabExtracting = true;

  showProgress('Extracting...', () => {
    aborted = true;
    state.isMultiTabExtracting = false;
    showToast('Extraction cancelled', 'info');
  });
  updateProgress(0, tabIds.length, 'Starting extraction...', 0);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'MULTI_TAB_EXTRACT',
      tabIds: tabIds,
    });

    if (aborted) return;

    if (response && response.success && response.images) {
      const newImages: ImageItem[] = response.images.map((img: ImageItem) => ({
        ...img,
        id: img.id || generateId(img.url),
        colors: undefined,
        phash: null,
      }));

      newImages.forEach((newImg) => {
        if (!state.allImages.find((img) => img.url === newImg.url)) {
          state.allImages.push(newImg);
        }
      });

      state.currentGroupMode = 'tab';
      if (elements.groupMode) (elements.groupMode as HTMLSelectElement).value = 'tab';
      document.querySelectorAll<HTMLElement>('[data-group-filter]').forEach((o) => {
        o.classList.toggle('active', o.dataset.groupFilter === 'tab');
      });
      updateFilterButtonLabels();

      applyFilters();
      closeMultiTabModal();
      showToast(
        `Extracted ${newImages.length} images from ${response.tabCount || tabIds.length} tabs`,
        'success'
      );

      if (
        state.appSettings.enableSimilarDetection !== false ||
        state.appSettings.enableColorExtraction !== false
      ) {
        processImageExtras(newImages);
      }
    } else {
      showToast('Extraction failed: ' + (response?.error || 'Unknown error'), 'error');
    }
  } catch {
    if (!aborted) showToast('Multi-tab extraction failed', 'error');
  } finally {
    state.isMultiTabExtracting = false;
    hideProgress();
  }
}
