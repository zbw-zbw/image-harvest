// Image extraction from tabs
import { MESSAGE_TYPES } from '../shared/constants.mjs';
import { isRestrictedUrl, sendMessageToTabWithTimeout, broadcastToPopup } from './utils.js';
import { injectContentScript } from './injector.js';

// Get images from active tab
export async function getImagesFromTab(tabId, options = {}) {
  const { searchAllFrames = false, liveMonitoring = true } = options;

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

  try {
    const tabInfo = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tabInfo.url)) {
      throw new Error('Cannot access this page: browser internal pages are not supported');
    }
  } catch (error) {
    if (error.message?.includes('Cannot access')) throw error;
  }
  
  const injectionResult = await injectContentScript(tabId, { allFrames: searchAllFrames });
  
  if (!injectionResult.success) {
    const error = new Error(injectionResult.message || 'Failed to inject content script');
    error.code = injectionResult.error;
    error.workaround = injectionResult.workaround;
    throw error;
  }
  
  const response = await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPES.EXTRACT_IMAGES,
    skipIframes: searchAllFrames
  }, { frameId: 0 });
  let allImages = response.images || [];

  if (searchAllFrames) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      const subFrames = frames.filter(frame => frame.frameId !== 0 && !isRestrictedUrl(frame.url));

      for (const frame of subFrames) {
        try {
          const frameResponse = await chrome.tabs.sendMessage(tabId, {
            type: MESSAGE_TYPES.EXTRACT_IMAGES
          }, { frameId: frame.frameId });

          if (frameResponse?.images?.length) {
            const frameImages = frameResponse.images.map(img => ({
              ...img,
              fromFrame: true,
              frameUrl: frame.url
            }));
            allImages.push(...frameImages);
          }
        } catch {
          // Frame may not have content script or may be inaccessible
        }
      }

      const seenUrls = new Set();
      allImages = allImages.filter(img => {
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
      await chrome.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.START_LIVE_MONITOR,
        config: { debounceMs: 500 }
      }, { frameId: 0 });
    } else {
      await chrome.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.STOP_LIVE_MONITOR
      }, { frameId: 0 });
    }
  } catch {
    // Live monitoring message may fail if content script is not ready
  }

  return allImages;
}

// Process multi-tab extraction
export async function processMultiTabExtract(tabIds) {
  const allTabImages = [];
  const perTabTimeoutMs = 15000;

  // Get the currently active tab to mark it as current
  let currentTabId = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTab?.id || null;
  } catch {
    // Ignore error
  }

  for (let i = 0; i < tabIds.length; i++) {
    const tid = tabIds[i];
    let tabTitle = `Tab ${tid}`;
    try {
      const tabImages = await Promise.race([
        extractFromSingleTab(tid, tid === currentTabId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Per-tab timeout')), perTabTimeoutMs)
        )
      ]);
      tabTitle = tabImages.tabTitle || tabTitle;
      allTabImages.push(...tabImages.images);
    } catch (tabError) {
      // Tab skipped
    }

    broadcastToPopup({
      type: MESSAGE_TYPES.DOWNLOAD_PROGRESS,
      completed: i + 1,
      total: tabIds.length,
      current: tabTitle,
      imageCount: allTabImages.length
    });
  }

  return { success: true, images: allTabImages, tabCount: tabIds.length };
}

// Extract images from a single tab
async function extractFromSingleTab(tid, isCurrentTab = false) {
  const tabInfo = await chrome.tabs.get(tid);
  const tabTitle = tabInfo.title || tabInfo.url || '';

  if (isRestrictedUrl(tabInfo.url)) {
    return { images: [], tabTitle };
  }

  const injResult = await Promise.race([
    injectContentScript(tid),
    new Promise(resolve =>
      setTimeout(() => resolve({
        success: false,
        message: 'Content script injection timed out'
      }), 10000)
    )
  ]);
  if (!injResult.success) {
    return { images: [], tabTitle };
  }

  const tabResponse = await sendMessageToTabWithTimeout(tid, {
    type: MESSAGE_TYPES.EXTRACT_IMAGES
  }, 10000);

  const images = (tabResponse.images || []).map(img => ({
    ...img,
    tabId: tid,
    tabTitle: tabInfo.title || '',
    tabUrl: tabInfo.url || '',
    tabIndex: tabInfo.index ?? 0,
    isCurrentTab: isCurrentTab
  }));

  return { images, tabTitle };
}
