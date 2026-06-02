// ============================================
// Selection
// ============================================
// 选择、高亮、下载等操作模块

// JSZip is heavy (~100 KB rendered, ~28 KB gzip). It's only needed when the
// user actually triggers "download as ZIP" (downloadAllAsZip below) — keep it
// out of the main sidepanel bundle by importing on demand. See also
// pro-features.ts which does the same for exportCollection.
import type JSZipType from 'jszip';
import { FREE_LIMITS, MESSAGE_TYPES, VALID_REVERSE_SEARCH_ENGINES } from '../shared/constants';
import { convertImageFormat } from '../shared/converter';
import { t } from '../shared/i18n';
import type { ImageItem } from '../shared/types';
import { isRestrictedUrl } from '../shared/utils';
import { isSafeImageUrl } from '../shared/url-validator';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { recordDownloads } from '../shared/paywall-state';
import { recordDownloadForRating } from '../shared/rating-prompt-state';
import { applyFilters } from './filter';
import { renderImages } from './render';
import { showProUpgradeModal } from './settings';
import { elements, state, store } from './state';
import { hideProgress, showConfirmDialog, showProgress, showToast, updateProgress } from './ui';
import { generateFilename, truncateUrl } from './utils';

export async function toggleSelection(imageId: string): Promise<void> {
  const img = state.allImages.find((i) => i.id === imageId);

  if (state.selectedImages.has(imageId)) {
    state.selectedImages.delete(imageId);
    if (img) unhighlightImageOnPage(img.url);
  } else {
    state.selectedImages.add(imageId);
    // Free tier: only one image highlighted at a time
    if (!state.isProUser && img) {
      // Remove all existing highlights first, then highlight only this one
      removeAllHighlightsOnPage();
      await highlightImageOnPage(img.url);
    } else if (img) {
      await highlightImageOnPage(img.url);
    }
  }

  // Trigger Proxy set trap so Preact components re-render with updated size
  store.set('selectedImages', state.selectedImages);
  updateSelectionUI();
}

export function selectAll(): void {
  state.filteredImages.forEach((img) => state.selectedImages.add(img.id));
  // Trigger Proxy set trap so Preact components re-render with updated size
  store.set('selectedImages', state.selectedImages);
  renderImages();
  updateSelectionUI();
}

export function clearSelection(): void {
  state.selectedImages.clear();
  // Trigger Proxy set trap so Preact components re-render with updated size
  store.set('selectedImages', state.selectedImages);
  removeAllHighlightsOnPage();
  renderImages();
  updateSelectionUI();
}

export function updateSelectionUI(): void {
  const hasSelection = state.selectedImages.size > 0;
  const isAllSelected =
    state.filteredImages.length > 0 &&
    state.filteredImages.every((img) => state.selectedImages.has(img.id));

  // Found info is always visible
  // foundActionCount is now a Preact component — re-renders automatically
  // when state.filteredImages changes.
  // downloadLabel is now a Preact component (StatusCounts.DownloadLabel)
  // that derives its text from state.selectedImages.size automatically.
  // Disable download buttons when no images available
  const noImages = state.filteredImages.length === 0;
  if (elements.btnDownload) {
    (elements.btnDownload as HTMLButtonElement).disabled = noImages;
  }
  if (elements.btnDownloadToggle) {
    (elements.btnDownloadToggle as HTMLButtonElement).disabled = noImages;
  }

  // Select all button: checkbox style with checked/partial states
  if (elements.btnSelectAll) {
    const textEl = elements.btnSelectAll.querySelector('.select-all-text');
    const checkIcon = elements.btnSelectAll.querySelector('.check-icon');

    if (isAllSelected) {
      elements.btnSelectAll.classList.add('checked');
      elements.btnSelectAll.classList.remove('partial');
      elements.btnSelectAll.title = t('toolbar_deselect_all');
      if (textEl) textEl.textContent = t('toolbar_deselect_all');
      if (checkIcon) checkIcon.classList.remove('hidden');
    } else if (hasSelection) {
      elements.btnSelectAll.classList.remove('checked');
      elements.btnSelectAll.classList.add('partial');
      elements.btnSelectAll.title = t('title_select_all');
      if (textEl) textEl.textContent = t('status_n_selected', { count: state.selectedImages.size });
      if (checkIcon) checkIcon.classList.remove('hidden');
    } else {
      elements.btnSelectAll.classList.remove('checked', 'partial');
      elements.btnSelectAll.title = t('toolbar_select_all');
      if (textEl) textEl.textContent = t('toolbar_select_all');
      if (checkIcon) checkIcon.classList.add('hidden');
    }
  }
}

// ============================================
// Page Highlight (multi-image support)
// ============================================

export function safeSendMessageToTab<T = unknown>(message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    const tabId = state.currentTabId;
    if (tabId) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || isRestrictedUrl(tab.url)) {
          resolve(null);
          return;
        }
        chrome.tabs
          .sendMessage(tabId, message)
          .then((resp) => resolve(resp as T))
          .catch(() => resolve(null));
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id || isRestrictedUrl(tab.url)) {
          resolve(null);
          return;
        }
        chrome.tabs
          .sendMessage(tab.id, message)
          .then((resp) => resolve(resp as T))
          .catch(() => resolve(null));
      });
    }
  });
}

export async function highlightImageOnPage(imageUrl: string): Promise<boolean> {
  const response = await safeSendMessageToTab<{ found?: boolean }>({
    type: 'HIGHLIGHT_IMAGE',
    imageUrl,
  });
  return response?.found ?? false;
}

export function unhighlightImageOnPage(imageUrl: string): void {
  safeSendMessageToTab({ type: 'UNHIGHLIGHT_IMAGE', imageUrl });
}

export function syncHighlightsWithSelection(): void {
  const selectedUrls: string[] = [];
  for (const imgId of state.selectedImages) {
    const img = state.allImages.find((i) => i.id === imgId);
    if (img) selectedUrls.push(img.url);
  }
  // Free tier: only highlight the first selected image
  if (!state.isProUser) {
    safeSendMessageToTab({ type: 'HIGHLIGHT_IMAGES', imageUrls: selectedUrls.slice(0, 1) });
    return;
  }
  safeSendMessageToTab({ type: 'HIGHLIGHT_IMAGES', imageUrls: selectedUrls });
}

export function removeAllHighlightsOnPage(): void {
  safeSendMessageToTab({ type: 'REMOVE_HIGHLIGHT' });
}

// ============================================
// Download Functions
// ============================================

interface PageInfo {
  domain: string;
  title: string;
}

/**
 * Get active page info (domain, title) from the real webpage tab,
 * not the extension's sidepanel/popup page.
 */
export async function getActivePageInfo(): Promise<PageInfo> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const tabUrl = new URL(tab.url);
      if (tabUrl.protocol === 'http:' || tabUrl.protocol === 'https:') {
        return {
          domain: tabUrl.hostname,
          title: tab.title || 'untitled',
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { domain: 'images', title: 'untitled' };
}

/**
 * Format a Date to compact timestamp string: YYYYMMDD-HHmmss
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function getOriginalFilename(img: ImageItem): string {
  try {
    const urlPath = new URL(img.url).pathname;
    const name = urlPath.split('/').pop() || 'image';
    return name.includes('.') ? name : name + '.' + (img.format || 'png');
  } catch {
    return 'image.' + (img.format || 'png');
  }
}

/**
 * Fetch an image as a Blob with a CORS-bypass fallback.
 *
 * Strategy:
 *   1. Try a normal CORS fetch from the side-panel page (fast path; no IPC overhead).
 *   2. If that fails (network error, CORS denied, mixed content, etc.), ask the
 *      background service worker to fetch via `FETCH_IMAGE_DATA` and decode the
 *      returned data URL into a Blob. The background context has broader host
 *      permissions and can avoid most CORS restrictions.
 *
 * Throws if both attempts fail so callers can record the URL as "failed".
 */
export async function fetchImageBlobWithFallback(url: string): Promise<Blob> {
  // Fast path: direct CORS fetch
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (resp.ok) {
      const blob = await resp.blob();
      if (blob.size > 0) return blob;
    }
  } catch {
    // fall through to background fallback
  }

  // Slow path: ask background to fetch (bypasses CORS via host_permissions)
  const response = await new Promise<{ success: boolean; dataUrl?: string; error?: string }>(
    (resolve) => {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FETCH_IMAGE_DATA, url }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { success: false, error: 'No response from background' });
        }
      });
    }
  );

  if (!response.success || !response.dataUrl) {
    throw new Error(response.error || 'Background fetch failed');
  }

  // Decode the data URL into a Blob
  const fetchResp = await fetch(response.dataUrl);
  return fetchResp.blob();
}

export async function exportSingleToEagle(img: ImageItem): Promise<void> {
  let name = img.alt || '';
  if (!name) {
    try {
      name = new URL(img.url).pathname.split('/').pop() || img.id;
    } catch {
      name = img.id;
    }
  }
  const items = [{ url: img.url, name, website: img.tabUrl, tags: img.aiTags }];
  showToast(t('toast_eagle_exporting', { count: '1' }), 'info');
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.EXPORT_TO_EAGLE,
      items,
    })) as { success: boolean; added?: number; error?: string };
    if (!response?.success) {
      const reason = response?.error || 'api_error';
      showToast(
        reason === 'eagle_not_running' ? t('toast_eagle_not_running') : t('toast_eagle_failed'),
        'error'
      );
      return;
    }
    showToast(t('toast_eagle_success', { count: String(response.added ?? 0) }), 'success');
  } catch {
    showToast(t('toast_eagle_failed'), 'error');
  }
}

export async function downloadSingle(img: ImageItem, format: string | null): Promise<void> {
  // Pro check: format conversion requires Pro
  if (format && !state.isProUser) {
    showToast(t('pro_feature_blocked_format_conversion'), 'warning');
    showProUpgradeModal();
    return;
  }

  let downloadUrl = img.url;
  const pageInfo = await getActivePageInfo();
  let filename =
    state.appSettings.specifyDownload !== false
      ? generateFilename(img, 0, format, pageInfo)
      : getOriginalFilename(img);

  if (format && format !== img.format && typeof convertImageFormat === 'function') {
    try {
      const result = await convertImageFormat(img.url, format as 'png' | 'jpg' | 'jpeg' | 'webp');
      downloadUrl = result.dataUrl;
      filename = filename.replace(/\.[^.]+$/, '.' + format);
    } catch (err) {
      console.error('Conversion failed:', err);
    }
  }

  try {
    await chrome.downloads.download({ url: downloadUrl, filename: filename, saveAs: false });
    showToast(t('toast_download_started'), 'success');
    // Telemetry: format prop reveals which conversions are popular (helps
    // decide whether to push WebP / JPG conversion as a Pro selling point).
    void track(EVENTS.DOWNLOAD_SINGLE, { format: format || 'original' });
    // Soft paywall (Sprint 2.1): count this toward the threshold that
    // arms the upgrade banner. Pro users still get counted — the banner
    // gate in shared/paywall-state.ts is purely behavioral; the
    // SoftPaywallBanner component does the actual `state.isProUser`
    // short-circuit on render.
    void recordDownloads(1);
    void recordDownloadForRating(1);
  } catch (error) {
    console.error('Download error:', error);
    showToast(t('toast_download_failed'), 'error');
  }
}

export async function downloadSelectedAsZip(targetFormat: string | null): Promise<void> {
  const selected = state.filteredImages.filter((img) => state.selectedImages.has(img.id));
  if (selected.length === 0) {
    showToast(t('toast_no_images_selected'), 'error');
    return;
  }

  // Pro check: format conversion requires Pro
  if (targetFormat && !state.isProUser) {
    showToast(t('pro_feature_blocked_format_conversion'), 'warning');
    showProUpgradeModal();
    return;
  }

  // Free tier: per-batch image count limit
  if (!state.isProUser && selected.length > FREE_LIMITS.MAX_ZIP_IMAGES) {
    showToast(t('pro_zip_limit', { max: String(FREE_LIMITS.MAX_ZIP_IMAGES) }), 'warning');
    showProUpgradeModal();
    return;
  }

  if (selected.length > 100 && !state.appSettings.noManyFilesWarning) {
    const confirmed = await showConfirmDialog({
      title: t('dialog_download_many_title'),
      message: t('dialog_download_many_message', { count: selected.length }),
      confirmText: t('common_download'),
      cancelText: t('common_cancel'),
      type: 'info',
    });
    if (!confirmed) return;
  }

  let aborted = false;

  showProgress(t('progress_downloading'), () => {
    aborted = true;
    showToast(t('toast_download_cancelled'), 'info');
  });

  try {
    const { default: JSZip } = (await import('jszip')) as { default: typeof JSZipType };
    const zip = new JSZip();
    const pageInfo = await getActivePageInfo();
    const now = new Date();
    const ts = formatTimestamp(now);

    // Resolve subfolder template variables
    const rawSubfolder = (state.appSettings.subfolder as string | undefined) || '';
    const subfolder = rawSubfolder
      .replace('{domain}', pageInfo.domain)
      .replace('{date}', now.toISOString().slice(0, 10))
      .replace('{title}', pageInfo.title.replace(/[/\\:*?"<>|]/g, '_').substring(0, 50));
    const folder = subfolder ? zip.folder(subfolder) : zip;
    if (!folder) throw new Error('Failed to create ZIP folder');
    const failed: string[] = [];

    for (let i = 0; i < selected.length; i++) {
      if (aborted) return;

      const img = selected[i];
      updateProgress(i + 1, selected.length, truncateUrl(img.url, 50));

      try {
        let blob: Blob;
        if (
          targetFormat &&
          targetFormat !== img.format &&
          typeof convertImageFormat === 'function'
        ) {
          const result = await convertImageFormat(
            img.url,
            targetFormat as 'png' | 'jpg' | 'jpeg' | 'webp'
          );
          blob = await fetch(result.dataUrl).then((r) => r.blob());
        } else {
          // Use background fallback so cross-origin images without CORS headers
          // can still be packaged (background uses host_permissions to bypass CORS).
          blob = await fetchImageBlobWithFallback(img.url);
        }

        const filename = generateFilename(img, i, targetFormat, pageInfo);
        folder.file(filename, blob);
      } catch {
        failed.push(img.url);
      }
    }

    if (aborted) return;

    if (failed.length > 0) {
      zip.file('_failed.txt', 'Failed to download:\n' + failed.join('\n'));
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);

    await chrome.downloads.download({
      url: blobUrl,
      filename: `${pageInfo.domain}-${ts}.zip`,
      saveAs: false,
    });

    URL.revokeObjectURL(blobUrl);
    const successCount = selected.length - failed.length;
    showToast(t('toast_download_completed', { count: successCount }), 'success');
    // Telemetry: count is the SUCCESSFUL count, not selected.length —
    // failures are inferred via (selected.length - count). Funnels care
    // about user-perceived success.
    void track(EVENTS.DOWNLOAD_BATCH, { count: successCount });
    // Soft paywall: a 30-image batch counts as 30 toward the threshold.
    // Same intent as DOWNLOAD_SINGLE above — see comment there.
    if (successCount > 0) void recordDownloads(successCount);
    // Rating prompt — same batch contribution rule (success count, not
    // selected count). See DOWNLOAD_SINGLE call above for rationale.
    if (successCount > 0) void recordDownloadForRating(successCount);
  } catch (error) {
    if (!aborted) {
      console.error('ZIP download error:', error);
      showToast(t('toast_download_failed') + ': ' + (error as Error).message, 'error');
    }
  } finally {
    hideProgress();
  }
}

export function toggleDownloadDropdown(): void {
  return;
}
export function showDownloadDropdown(): void {
  if (elements.downloadDropdown) elements.downloadDropdown.classList.remove('hidden');
}

export function hideDownloadDropdown(): void {
  return;
}

// ============================================
// Copy URL
// ============================================
export async function copyImageUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    showToast(t('toast_url_copied_single'), 'success');
    // Telemetry: no url payload — privacy contract forbids it. Just count.
    void track(EVENTS.COPY_URL_SINGLE);
  } catch {
    showToast(t('toast_url_copy_failed'), 'error');
  }
}

/**
 * Copy a batch of image URLs to the clipboard, one per line.
 *
 * Sprint 3.4 — most-requested feature from the only 5-star user. Builds on
 * top of the single-URL `copyImageUrl` above so the privacy/telemetry
 * contract stays identical: never log the URL payload itself, only the
 * count.
 *
 * Free-tier guard: an additional Pro touchpoint. We cap at
 * FREE_LIMITS.MAX_BATCH_COPY_URLS (currently 20) to leave headroom for the
 * "select 30 → upgrade" funnel without making the feature feel useless on
 * Free. Pro users bypass the cap entirely.
 *
 * Why a separate function rather than overloading copyImageUrl(string |
 * string[])? The single-URL path is called from per-card click handlers
 * with hot subscriptions — overloading would force a runtime branch on
 * every call. Splitting also keeps the telemetry events distinct
 * (COPY_URL_SINGLE vs COPY_URL_BATCH), which the funnel needs.
 *
 * Returns true when at least one URL was copied; false on early exit
 * (empty input, Pro guard tripped) or clipboard failure. Callers that need
 * to chain UI state (e.g. clear selection on success) should branch on the
 * return value rather than inferring success from the toast.
 */
export async function copyImageUrls(urls: string[]): Promise<boolean> {
  if (urls.length === 0) {
    showToast(t('toolbar_copy_urls_empty'), 'error');
    return false;
  }
  // Free-tier copy cap — same guard pattern as downloadSelectedAsZip.
  if (!state.isProUser && urls.length > FREE_LIMITS.MAX_BATCH_COPY_URLS) {
    showToast(t('pro_copy_urls_limit', { max: FREE_LIMITS.MAX_BATCH_COPY_URLS }), 'warning');
    showProUpgradeModal();
    return false;
  }
  try {
    // Newline-separated so users can paste straight into a CSV / wget /
    // any line-oriented downloader. Trailing newline omitted to match
    // platform clipboard conventions.
    await navigator.clipboard.writeText(urls.join('\n'));
    showToast(t('toast_url_copied_batch', { count: urls.length }), 'success');
    void track(EVENTS.COPY_URL_BATCH, { count: urls.length });
    return true;
  } catch {
    showToast(t('toast_url_copy_failed'), 'error');
    return false;
  }
}

/**
 * Read the currently-selected (or, when nothing is selected, all-filtered)
 * image URLs in the order they appear in the grid. Used by the toolbar
 * "Copy URLs" button so the same selection model that powers Download
 * Selected As ZIP also drives the copy.
 *
 * Lives in actions.ts (not state.ts) because it consumes both
 * state.selectedImages and state.filteredImages — those are state.ts's
 * concern, but the orchestration ("which one wins when both are set") is
 * a feature decision better expressed alongside the consumers.
 */
export function getSelectedOrFilteredUrls(): string[] {
  const selected = state.filteredImages.filter((img) => state.selectedImages.has(img.id));
  const source = selected.length > 0 ? selected : state.filteredImages;
  return source.map((img) => img.url);
}

// ============================================
// Drag & Drop
// ============================================
export function setupDragAndDrop(element: HTMLElement, img: ImageItem): void {
  element.setAttribute('draggable', 'true');
  element.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/uri-list', img.url);
    e.dataTransfer.setData('text/plain', img.url);
    e.dataTransfer.effectAllowed = 'copy';
  });
}

// ============================================
// Open in New Tab
// ============================================
export async function openInNewTab(url: string): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const createOptions: chrome.tabs.CreateProperties = { url, active: true };
    if (activeTab && typeof activeTab.index === 'number') {
      createOptions.index = activeTab.index + 1;
    }
    chrome.tabs.create(createOptions);
  } catch {
    chrome.tabs.create({ url, active: true });
  }
}

// ============================================
// Reverse Image Search (Pro)
// ============================================
export function showReverseSearchMenu(imageUrl: string, anchor: HTMLElement): void {
  if (!elements.reverseSearchMenu) return;
  if (!isSafeImageUrl(imageUrl)) return;

  const menu = elements.reverseSearchMenu as HTMLElement;

  // Toggle: if menu is already visible, close it and return
  if (!menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const menuWidth = 180;
  const viewportWidth = window.innerWidth;

  let leftPos = rect.left;
  if (leftPos + menuWidth > viewportWidth - 8) {
    leftPos = rect.right - menuWidth;
  }
  if (leftPos < 4) leftPos = 4;

  menu.style.left = `${leftPos}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.dataset.imageUrl = imageUrl;
  menu.classList.remove('hidden');
}

export function reverseSearch(imageUrl: string, engine: string): void {
  if (!(VALID_REVERSE_SEARCH_ENGINES as readonly string[]).includes(engine)) return;

  const searchPageUrl =
    chrome.runtime.getURL('pages/reverse-search.html') +
    `?engine=${encodeURIComponent(engine)}` +
    `&imageUrl=${encodeURIComponent(imageUrl)}`;
  chrome.tabs.create({ url: searchPageUrl, active: true });
}

// ============================================
// Batch operations (Pro-only)
// ============================================

export async function batchAddToCollection(images: ImageItem[]): Promise<void> {
  if (images.length === 0) return;
  const { addToCollection } = await import('./pro-features');
  let added = 0;
  for (const img of images) {
    await addToCollection(img);
    added++;
  }
  showToast(t('toast_batch_favorite_done', { count: String(added) }), 'success');
}

export async function batchAiTag(images: ImageItem[]): Promise<void> {
  if (images.length === 0) return;
  const urls = images.map((img) => img.url);
  showToast(t('toast_batch_ai_tag_started', { count: String(urls.length) }), 'info');
  try {
    const resp = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.AI_TAG_BATCH,
      imageUrls: urls,
    });
    if (!resp?.success) {
      showToast(t('toast_ai_tag_failed'), 'error');
      return;
    }
    const results: Array<{ url: string; tags: string[]; success: boolean }> = resp.results ?? [];
    let taggedCount = 0;
    const tagMap = new Map<string, string[]>();
    for (const result of results) {
      if (result.success && result.tags.length > 0) {
        tagMap.set(result.url, result.tags);
        taggedCount++;
      }
    }
    if (taggedCount > 0) {
      store.set(
        'allImages',
        state.allImages.map((img) => {
          const tags = tagMap.get(img.url);
          return tags ? { ...img, aiTags: tags } : img;
        })
      );
      // Re-filter + re-render so the newly generated AI tags appear on
      // each card immediately, without requiring a manual refresh.
      applyFilters();
    }
    showToast(t('toast_batch_ai_tag_done', { count: String(taggedCount) }), 'success');
  } catch {
    showToast(t('toast_ai_tag_failed'), 'error');
  }
}

export async function deleteSelectedImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const confirmed = await showConfirmDialog({
    title: t('confirm_batch_delete_title', { count: String(ids.length) }),
    message: t('confirm_batch_delete_message', { count: String(ids.length) }),
    confirmText: t('common_remove'),
    cancelText: t('common_cancel'),
    type: 'danger',
  });
  if (!confirmed) return;
  const idSet = new Set(ids);
  store.set(
    'allImages',
    state.allImages.filter((img) => !idSet.has(img.id))
  );
  store.set('selectedImages', new Set());
  renderImages();
}
