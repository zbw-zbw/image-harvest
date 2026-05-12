// Image extraction from tabs.
import { MESSAGE_TYPES } from '../shared/constants';
import type { ImageItem } from '../shared/types';
import { isRestrictedUrl, sendMessageToTabWithTimeout, broadcastToPopup } from './utils';
import { injectContentScript } from './injector';

interface ExtractOptions {
  searchAllFrames?: boolean;
  liveMonitoring?: boolean;
}

interface ExtractResponse {
  images?: ImageItem[];
}

interface InjectionError extends Error {
  code?: string;
  workaround?: string;
}

// Per-tab dedup: if multiple callers request images from the same tab
// concurrently (e.g. sidepanel retry loop), reuse the in-flight promise
// instead of bombarding the content script with parallel EXTRACT_IMAGES.
const pendingExtractions = new Map<number, Promise<ImageItem[]>>();

/** Get all images from a tab; injects the content script as needed. */
export async function getImagesFromTab(
  tabId: number | undefined,
  options: ExtractOptions = {}
): Promise<ImageItem[]> {
  // Resolve tabId early so we can dedup on it
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && isRestrictedUrl(tab.url)) {
      throw new Error('Cannot access this page: browser internal pages are not supported');
    }
    tabId = tab?.id;
  }
  if (!tabId) {
    throw new Error('No active tab found');
  }

  // If there's already an in-flight extraction for this tab, reuse it
  const existing = pendingExtractions.get(tabId);
  if (existing) {
    return existing;
  }

  const promise = doGetImagesFromTab(tabId, options);
  pendingExtractions.set(tabId, promise);
  try {
    return await promise;
  } finally {
    pendingExtractions.delete(tabId);
  }
}

async function doGetImagesFromTab(tabId: number, options: ExtractOptions): Promise<ImageItem[]> {
  const { searchAllFrames = false, liveMonitoring = true } = options;

  // tabId is guaranteed non-null by the calling wrapper (getImagesFromTab).

  try {
    const tabInfo = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tabInfo.url)) {
      throw new Error('Cannot access this page: browser internal pages are not supported');
    }
  } catch (error) {
    if ((error as Error).message?.includes('Cannot access')) throw error;
  }

  const injectionResult = await injectContentScript(tabId, { allFrames: searchAllFrames });

  if (injectionResult.success === false) {
    const error: InjectionError = new Error(
      injectionResult.message || 'Failed to inject content script'
    );
    error.code = injectionResult.error;
    error.workaround = injectionResult.workaround;
    throw error;
  }

  const response: ExtractResponse = await chrome.tabs.sendMessage(
    tabId,
    {
      type: MESSAGE_TYPES.EXTRACT_IMAGES,
      skipIframes: searchAllFrames,
    },
    { frameId: 0 }
  );
  let allImages: ImageItem[] = response?.images || [];

  if (searchAllFrames) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      const subFrames = (frames || []).filter(
        (frame) => frame.frameId !== 0 && !isRestrictedUrl(frame.url)
      );

      for (const frame of subFrames) {
        try {
          const frameResponse: ExtractResponse = await chrome.tabs.sendMessage(
            tabId,
            { type: MESSAGE_TYPES.EXTRACT_IMAGES },
            { frameId: frame.frameId }
          );

          if (frameResponse?.images?.length) {
            const frameImages = frameResponse.images.map((img) => ({
              ...img,
              fromFrame: true,
              frameUrl: frame.url,
            }));
            allImages.push(...frameImages);
          }
        } catch {
          // Frame may not have content script or may be inaccessible.
        }
      }

      const seenUrls = new Set<string>();
      allImages = allImages.filter((img) => {
        if (seenUrls.has(img.url)) return false;
        seenUrls.add(img.url);
        return true;
      });
    } catch (error) {
      console.warn('Failed to extract from sub-frames:', error);
    }
  }

  try {
    if (liveMonitoring) {
      await chrome.tabs.sendMessage(
        tabId,
        {
          type: MESSAGE_TYPES.START_LIVE_MONITOR,
          config: { debounceMs: 500 },
        },
        { frameId: 0 }
      );
    } else {
      await chrome.tabs.sendMessage(
        tabId,
        { type: MESSAGE_TYPES.STOP_LIVE_MONITOR },
        { frameId: 0 }
      );
    }
  } catch {
    // Live monitoring message may fail if content script is not ready.
  }

  return allImages;
}

interface MultiTabResult {
  success: true;
  images: ImageItem[];
  tabCount: number;
}

interface SingleTabExtractResult {
  images: ImageItem[];
  tabTitle: string;
}

/** Extract images from many tabs sequentially, broadcasting progress. */
export async function processMultiTabExtract(tabIds: number[]): Promise<MultiTabResult> {
  const allTabImages: ImageItem[] = [];
  const perTabTimeoutMs = 30000;

  let currentTabId: number | null = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTab?.id || null;
  } catch {
    // ignore
  }

  for (let i = 0; i < tabIds.length; i++) {
    const tid = tabIds[i];
    let tabTitle = `Tab ${tid}`;
    try {
      const tabImages = await Promise.race<SingleTabExtractResult>([
        extractFromSingleTab(tid, tid === currentTabId),
        new Promise<SingleTabExtractResult>((_, reject) =>
          setTimeout(() => reject(new Error('Per-tab timeout')), perTabTimeoutMs)
        ),
      ]);
      tabTitle = tabImages.tabTitle || tabTitle;
      allTabImages.push(...tabImages.images);
    } catch (tabError) {
      console.warn(`[multi-tab] Tab ${tid} skipped:`, (tabError as Error).message);
    }

    broadcastToPopup({
      type: MESSAGE_TYPES.DOWNLOAD_PROGRESS,
      completed: i + 1,
      total: tabIds.length,
      current: tabTitle,
      imageCount: allTabImages.length,
    });
  }

  return { success: true, images: allTabImages, tabCount: tabIds.length };
}

/**
 * Wait for a tab to finish loading (status === 'complete').
 * Resolves immediately if the tab is already complete.
 * Rejects after `timeoutMs` to avoid blocking indefinitely.
 */
async function waitForTabComplete(tabId: number, timeoutMs: number = 3000): Promise<void> {
  const tabInfo = await chrome.tabs.get(tabId);
  if (tabInfo.status === 'complete') return;

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      // Resolve anyway — the page may be usable even if not fully "complete"
      resolve();
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromSingleTab(
  tid: number,
  isCurrentTab: boolean = false
): Promise<SingleTabExtractResult> {
  const tabInfo = await chrome.tabs.get(tid);
  const tabTitle = tabInfo.title || tabInfo.url || '';

  if (isRestrictedUrl(tabInfo.url)) {
    return { images: [], tabTitle };
  }

  // Wait for the page to finish loading before injecting / extracting.
  if (tabInfo.status !== 'complete') {
    await waitForTabComplete(tid);
  }

  // Give injectContentScript at most 8 seconds to avoid hanging on pages
  // where chrome.scripting.executeScript stalls (CSP, heavy JS, etc.).
  try {
    const injResult = await Promise.race([
      injectContentScript(tid),
      new Promise<{ success: false; error: string; message: string }>((resolve) =>
        setTimeout(
          () => resolve({ success: false, error: 'TIMEOUT', message: 'Injection timed out' }),
          8000
        )
      ),
    ]);
    if (!injResult.success) {
      return { images: [], tabTitle };
    }
  } catch {
    return { images: [], tabTitle };
  }

  try {
    const tabResponse: ExtractResponse = await sendMessageToTabWithTimeout(
      tid,
      { type: MESSAGE_TYPES.EXTRACT_IMAGES },
      10000,
      { frameId: 0 }
    );

    const images: ImageItem[] = (tabResponse?.images || []).map((img) => ({
      ...img,
      tabId: tid,
      tabTitle: tabInfo.title || '',
      tabUrl: tabInfo.url || '',
      tabIndex: tabInfo.index ?? 0,
      isCurrentTab,
    }));

    return { images, tabTitle };
  } catch (extractError) {
    console.warn(
      `[multi-tab] ✗ EXTRACT_IMAGES failed for tab ${tid}:`,
      (extractError as Error).message
    );
    return { images: [], tabTitle };
  }
}
