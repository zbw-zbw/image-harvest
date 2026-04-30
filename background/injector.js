// Content script injection with fallback strategies
import { MESSAGE_TYPES, ERROR_CODES } from '../shared/constants.mjs';
import { isRestrictedUrl, sendMessageToTabWithTimeout } from './utils.js';

// Inject content script with fallback
export async function injectContentScript(tabId, options = {}) {
  const { allFrames = false } = options;

  try {
    // Attempt 1: Check if already injected in main frame via PING (with timeout)
    try {
      await sendMessageToTabWithTimeout(tabId, { type: MESSAGE_TYPES.PING }, 3000);
      if (allFrames) {
        await injectIntoAllFrames(tabId);
      }
      return { success: true };
    } catch {
      // PING failed — content script may not be ready yet
    }
    
    // Attempt 2: Check if tab is showing an error page before injection
    try {
      const tabInfo = await chrome.tabs.get(tabId);
      if (isRestrictedUrl(tabInfo.url) || tabInfo.status === 'unloaded') {
        return {
          success: false,
          error: ERROR_CODES.INJECTION_FAILED,
          message: 'Cannot access this page: browser internal or error pages are not supported'
        };
      }
    } catch {
      // If we can't get tab info, proceed and let injection handle the error
    }

    // Attempt 3: Check if scripts are already present in the page
    try {
      const probeResult = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => typeof isExtracting !== 'undefined'
      });
      if (probeResult?.[0]?.result === true) {
        await new Promise(resolve => setTimeout(resolve, 200));
        try {
          await sendMessageToTabWithTimeout(tabId, { type: MESSAGE_TYPES.PING }, 3000);
        } catch {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (allFrames) {
          await injectIntoAllFrames(tabId);
        }
        return { success: true };
      }
    } catch (probeError) {
      if (probeError.message?.includes('error page') || probeError.message?.includes('showing error')) {
        return {
          success: false,
          error: ERROR_CODES.INJECTION_FAILED,
          message: 'Cannot access this page: the page failed to load or is showing an error'
        };
      }
    }

    // Attempt 4: Standard injection into main frame
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'shared/constants.js',
        'shared/utils.js',
        'shared/phash.js',
        'content/main.js',
        'content/monitor.js',
        'content/highlight.js',
        'content/extract-advanced.js',
        'content/shadow-iframe.js'
      ]
    });

    if (allFrames) {
      await injectIntoAllFrames(tabId);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Injection failed:', error);
    
    if (error.message?.includes('Cannot access a chrome') || 
        error.message?.includes('Cannot access') ||
        error.message?.includes('prohibited') ||
        error.message?.includes('error page') ||
        error.message?.includes('showing error')) {
      return {
        success: false,
        error: ERROR_CODES.INJECTION_FAILED,
        message: 'Cannot access this page: browser internal or error pages are not supported'
      };
    }

    if (error.message?.includes('CSP') || error.message?.includes('content script')) {
      return {
        success: false,
        error: ERROR_CODES.CSP_BLOCKED,
        message: 'Page security policy prevents extension access',
        workaround: 'Right-click images and select "Open in new tab" to download manually'
      };
    }
    
    return {
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: error.message
    };
  }
}

// Inject content script into all sub-frames of a tab
export async function injectIntoAllFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const subFrames = frames.filter(frame => frame.frameId !== 0 && !isRestrictedUrl(frame.url));

    for (const frame of subFrames) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING }, { frameId: frame.frameId });
      } catch {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frame.frameId] },
            files: [
              'shared/constants.js',
              'shared/utils.js',
              'shared/phash.js',
              'content/main.js',
              'content/monitor.js',
              'content/highlight.js',
              'content/extract-advanced.js',
              'content/shadow-iframe.js'
            ]
          });
        } catch (injError) {
          console.warn(`Could not inject into frame ${frame.frameId} (${frame.url}):`, injError.message);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to enumerate frames for all-frames injection:', error);
  }
}
