// Image extraction from tabs.
import { MESSAGE_TYPES } from '../shared/constants';
import type { ImageItem } from '../shared/types';
import { isRestrictedUrl, sendMessageToTabWithTimeout, broadcastToPopup } from './utils';
import { injectContentScript } from './injector';

interface ExtractOptions {
  searchAllFrames?: boolean;
  liveMonitoring?: boolean;
  /**
   * Receives the gallery-link candidates (thumb → detail page) collected by
   * the content script's link-image stage. Optional so existing callers /
   * tests that don't care about link penetration are unaffected.
   */
  onGalleryLinks?: (links: string[]) => void;
}

interface ExtractResponse {
  images?: ImageItem[];
  /** Gallery-link candidates from the link-image stage (v1.1.0). */
  galleryLinks?: string[];
}

interface InjectionError extends Error {
  code?: string;
  workaround?: string;
}

// Per-tab dedup: if multiple callers request images from the same tab
// concurrently (e.g. sidepanel retry loop), reuse the in-flight promise
// instead of bombarding the content script with parallel EXTRACT_IMAGES.
// The map value carries the gallery-link candidates too: the promise alone
// only resolves with images, so a caller that hits the in-flight entry
// would otherwise never receive its onGalleryLinks callback.
interface InFlightExtraction {
  promise: Promise<ImageItem[]>;
  /** Set once the main-frame response arrives; late dedup callers get it immediately. */
  galleryLinks?: string[];
  /** One entry per caller still waiting for the gallery links (cleared after each emit). */
  listeners: Array<(links: string[]) => void>;
}
const pendingExtractions = new Map<number, InFlightExtraction>();

/** Deliver gallery links to every registered caller of an in-flight extraction. */
function emitGalleryLinks(tabId: number, links: string[]): void {
  const entry = pendingExtractions.get(tabId);
  if (!entry) return;
  entry.galleryLinks = links;
  for (const fn of entry.listeners) {
    try {
      fn(links);
    } catch {
      // A listener error must never break the extraction pipeline.
    }
  }
  entry.listeners.length = 0;
}

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

  // Register this caller's gallery-links interest BEFORE any early return,
  // so a dedup hit never silently swallows the callback.
  let entry = pendingExtractions.get(tabId);
  if (entry) {
    if (options.onGalleryLinks) {
      if (entry.galleryLinks) options.onGalleryLinks(entry.galleryLinks);
      else entry.listeners.push(options.onGalleryLinks);
    }
    return entry.promise;
  }

  entry = {
    promise: null as unknown as Promise<ImageItem[]>,
    galleryLinks: undefined,
    listeners: [],
  };
  if (options.onGalleryLinks) entry.listeners.push(options.onGalleryLinks);
  // Safe ordering: doGetImagesFromTab's first statement awaits chrome.tabs.get,
  // so emitGalleryLinks (further in) always runs after the set() below.
  entry.promise = doGetImagesFromTab(tabId, options);
  pendingExtractions.set(tabId, entry);
  try {
    return await entry.promise;
  } finally {
    if (pendingExtractions.get(tabId) === entry) {
      pendingExtractions.delete(tabId);
    }
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
    { type: MESSAGE_TYPES.EXTRACT_IMAGES },
    { frameId: 0 }
  );
  let allImages: ImageItem[] = response?.images || [];

  // Hand the link-penetration gallery candidates to every caller waiting on
  // this extraction (sidepanel's GET_IMAGES handler forwards them to the
  // resolve-originals bar). Only the main frame's candidates are
  // meaningful — sub-frame links stay in-frame.
  if (Array.isArray(response?.galleryLinks)) {
    emitGalleryLinks(tabId, response.galleryLinks);
  }

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

// ── Deep scan (v1.2.0) ───────────────────────────────────────────────

export interface DeepScanStats {
  count: number;
  newCount: number;
  steps: number;
  durationMs: number;
  stopReason: string;
}

export interface DeepScanTabResult {
  images: ImageItem[];
  galleryLinks: string[];
  stats: DeepScanStats;
}

interface DeepScanContentResponse {
  success?: boolean;
  error?: string;
  images?: ImageItem[];
  galleryLinks?: string[];
  stats?: DeepScanStats;
}

// Per-tab re-entry guard: a deep scan can run up to MAX_DURATION_MS
// (45s), far longer than a plain extract, so double-clicks / retry loops
// must not stack parallel scroll runs on the same page.
const activeDeepScans = new Set<number>();

/**
 * Run an auto-scroll deep scan on a tab: inject the content script, start
 * live monitoring FIRST (so the panel gets IMAGES_DISCOVERED increments
 * during the run — the incremental channel is the existing one), then let
 * the content-side controller scroll + extract.
 */
export async function getDeepScanFromTab(tabId: number | undefined): Promise<DeepScanTabResult> {
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

  if (activeDeepScans.has(tabId)) {
    throw new Error('deep_scan_in_progress');
  }
  activeDeepScans.add(tabId);

  try {
    const tabInfo = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tabInfo.url)) {
      throw new Error('Cannot access this page: browser internal pages are not supported');
    }

    const injectionResult = await injectContentScript(tabId);
    if (injectionResult.success === false) {
      const error: InjectionError = new Error(
        injectionResult.message || 'Failed to inject content script'
      );
      error.code = injectionResult.error;
      error.workaround = injectionResult.workaround;
      throw error;
    }

    // Live monitor BEFORE the scroll run — the panel's scan overlay reads
    // its IMAGES_DISCOVERED increments as real-time deep-scan progress.
    try {
      await chrome.tabs.sendMessage(
        tabId,
        { type: MESSAGE_TYPES.START_LIVE_MONITOR, config: { debounceMs: 500 } },
        { frameId: 0 }
      );
    } catch {
      // Best-effort: the final extract still delivers the full image list.
    }

    const response: DeepScanContentResponse = await chrome.tabs.sendMessage(
      tabId,
      { type: MESSAGE_TYPES.START_DEEP_SCAN },
      { frameId: 0 }
    );

    if (!response?.success) {
      throw new Error(response?.error || 'Deep scan failed');
    }

    return {
      images: response.images || [],
      galleryLinks: response.galleryLinks || [],
      stats: response.stats as DeepScanStats,
    };
  } finally {
    activeDeepScans.delete(tabId);
  }
}

/** Best-effort abort — the content script may be gone after navigation. */
export async function cancelDeepScan(tabId: number | undefined): Promise<void> {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.CANCEL_DEEP_SCAN }, { frameId: 0 });
  } catch {
    // Tab navigated away or content script reloaded — the run is dead anyway.
  }
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
  // Cross-tab dedup: the same URL can appear in several tabs (shared banner,
  // same site opened twice, multi-frame duplicates). Without this the grid
  // rendered one card per tab instead of per image.
  const seenUrls = new Set<string>();
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
      for (const img of tabImages.images) {
        if (seenUrls.has(img.url)) continue;
        seenUrls.add(img.url);
        allTabImages.push(img);
      }
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
