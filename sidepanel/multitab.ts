// Multi-tab image extraction — split out of pro-features.ts so it stays
// off the sidepanel main bundle. Loaded on demand the first time a user
// clicks the "Multi-tab" toolbar button (see init.ts > showMultiTabModal
// wrapper). 90%+ of users never touch this, so deferring saves ~10 kB
// gzip on first paint.
//
// Public API (matches the legacy pro-features.ts surface so callers
// don't change shape — only the import becomes async at the call site):
//   - showMultiTabModal()
//   - loadTabList()
//   - startMultiTabExtract(tabIds)
//   - toggleMultitabSelectAll()
//
// Note: closeMultiTabModal() lives in pro-features.ts (1-liner that flips
// the store), because message.ts depends on it synchronously for ESC-key
// dismissal. Pulling it here would force every ESC press to await a
// dynamic import.

import { isRestrictedUrl } from '../shared/utils';
import { t } from '../shared/i18n';
import type { ImageItem } from '../shared/types';
import { applyFilters } from './filter';
import { closeMultiTabModal } from './pro-features';
import { processImageExtras } from './scan';
import { elements, state } from './state';
import {
  hideProgress,
  showProgress,
  showToast,
  updateFilterButtonLabels,
  updateProgress,
} from './ui';
import { generateId, truncateUrl } from './utils';

export function showMultiTabModal(): void {
  // Open the Preact-managed shell. modal element ref is re-resolved because
  // Preact owns the subtree now (cached elements.multitabModal would be stale).
  state.multitabModalState = { open: true };
  const modalEl = document.getElementById('multitab-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  loadTabList();
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
          <div class="tab-title">${tab.title || t('multitab_untitled')}${tab.active ? `<span class="tab-current-badge">${t('multitab_current')}</span>` : ''}</div>
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
    if (resolvedUrl && resolvedUrl !== previousSrc && faviconImg) {
      faviconImg.addEventListener(
        'error',
        () => {
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
    if (textEl) textEl.textContent = t('status_n_selected', { count: checkedCount });
  } else if (checkedCount > 0) {
    selectAllBtn.classList.add('partial');
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (textEl) textEl.textContent = t('status_n_selected', { count: checkedCount });
  } else {
    if (checkIcon) checkIcon.classList.add('hidden');
    if (textEl) textEl.textContent = t('toolbar_select_all');
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

  showProgress(t('multitab_extracting'), () => {
    aborted = true;
    state.isMultiTabExtracting = false;
    showToast(t('toast_extraction_cancelled'), 'info');
  });
  updateProgress(0, tabIds.length, t('multitab_starting'), 0);

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

      // Replace allImages with only the multi-tab results.
      // The user explicitly chose which tabs to extract from; showing images
      // from tabs they did NOT select would be confusing.
      state.allImages = newImages;
      const addedCount = newImages.length;

      // Only switch to tab grouping when new images were actually added
      if (addedCount > 0) {
        state.currentGroupMode = 'tab';
        if (elements.groupMode) (elements.groupMode as HTMLSelectElement).value = 'tab';
        document.querySelectorAll<HTMLElement>('[data-group-filter]').forEach((o) => {
          o.classList.toggle('active', o.dataset.groupFilter === 'tab');
        });
        updateFilterButtonLabels();
        applyFilters();
      }

      closeMultiTabModal();
      showToast(
        t('toast_extraction_success', {
          images: addedCount,
          tabs: response.tabCount || tabIds.length,
        }),
        addedCount > 0 ? 'success' : 'info'
      );

      if (
        addedCount > 0 &&
        (state.appSettings.enableSimilarDetection !== false ||
          state.appSettings.enableColorExtraction !== false)
      ) {
        processImageExtras(newImages);
      }
    } else {
      showToast(
        t('toast_extraction_failed') + ': ' + (response?.error || t('error_default_message')),
        'error'
      );
    }
  } catch {
    if (!aborted) showToast(t('toast_multitab_failed'), 'error');
  } finally {
    state.isMultiTabExtracting = false;
    hideProgress();
  }
}
