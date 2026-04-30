// Background Service Worker for Image Harvest
// Main entry point — imports modules and routes messages

import { MESSAGE_TYPES, ERROR_CODES } from '../shared/constants.mjs';
import { getFilterConfig, getDownloadHistory, clearDownloadHistory, saveFilterConfig, getAppSettings, saveAppSettings } from '../shared/storage.mjs';
import { activateLicense, deactivateLicense, isProUser, getLicenseInfo } from '../shared/license.mjs';

import { uiPorts, sidePanelOpenedTabs, getAccessibleTabId, broadcastToPopup } from './utils.js';
import { initLicenseAlarm } from './license.js';
import { initDisplayMode, initTabActivationListener } from './display-mode.js';
import { getImagesFromTab, processMultiTabExtract } from './extractor.js';
import { fetchImageData, reverseSearchUpload } from './reverse-search.js';

// ============================================
// Initialization
// ============================================

// Start license periodic check
initLicenseAlarm();

// Set up UI port tracking
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'image-snatcher-ui') return;
  uiPorts.add(port);
  port.onDisconnect.addListener(() => {
    uiPorts.delete(port);
  });
});

// Initialize display mode and tab listeners
initDisplayMode();
initTabActivationListener();

// Handle download completion events
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === 'complete') {
    console.log('Download completed:', delta.id);
  }
});

// ============================================
// Message Router
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let channelOpen = true;
  const safeSendResponse = (response) => {
    if (!channelOpen) return;
    try {
      sendResponse(response);
    } catch {
      // Channel already closed
    }
    channelOpen = false;
  };

  handleMessage(message, sender, safeSendResponse).catch((unhandledError) => {
    console.error('[Background] Unhandled error in handleMessage:', unhandledError);
    safeSendResponse({ success: false, error: unhandledError?.message || 'Internal error' });
  });
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case MESSAGE_TYPES.GET_IMAGES: {
        const images = await getImagesFromTab(message.tabId, {
          searchAllFrames: message.searchAllFrames || false,
          liveMonitoring: message.liveMonitoring !== false
        });
        sendResponse({ success: true, images });
        break;
      }

      case MESSAGE_TYPES.DOWNLOAD_ZIP:
        sendResponse({ success: false, error: 'Use popup for ZIP downloads' });
        break;

      case MESSAGE_TYPES.GET_HISTORY: {
        const history = await getDownloadHistory();
        sendResponse({ success: true, history });
        break;
      }

      case MESSAGE_TYPES.CLEAR_HISTORY:
        await clearDownloadHistory();
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.GET_FILTER_CONFIG: {
        const config = await getFilterConfig();
        sendResponse({ success: true, config });
        break;
      }

      case MESSAGE_TYPES.SAVE_FILTER_CONFIG:
        await saveFilterConfig(message.config);
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.IMAGES_DISCOVERED:
        broadcastToPopup({
          ...message,
          fromTabId: sender.tab?.id ?? null
        });
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.TOGGLE_SIDEBAR:
        sendResponse({ success: false, error: 'Use toolbar icon or shortcut to open side panel' });
        break;

      case MESSAGE_TYPES.HIGHLIGHT_IMAGE: {
        try {
          const tabId = await getAccessibleTabId(message.tabId);
          if (tabId) {
            const response = await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
              imageUrl: message.imageUrl
            });
            sendResponse({ success: true, found: response?.found ?? false });
          } else {
            sendResponse({ success: true, found: false });
          }
        } catch (error) {
          sendResponse({ success: false, found: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.UNHIGHLIGHT_IMAGE: {
        try {
          const tabId = await getAccessibleTabId(message.tabId);
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.UNHIGHLIGHT_IMAGE,
              imageUrl: message.imageUrl
            });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.HIGHLIGHT_IMAGES: {
        try {
          const tabId = await getAccessibleTabId(message.tabId);
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.HIGHLIGHT_IMAGES,
              imageUrls: message.imageUrls
            });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.REMOVE_HIGHLIGHT: {
        try {
          const tabId = await getAccessibleTabId(message.tabId);
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.REMOVE_HIGHLIGHT
            });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.CLEAR_SELECTION:
        broadcastToPopup({ type: MESSAGE_TYPES.CLEAR_SELECTION });
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.SET_DISPLAY_MODE: {
        try {
          const useSidePanel = message.useSidePanel;
          const currentSettings = await getAppSettings();
          currentSettings.useSidePanel = useSidePanel;
          await saveAppSettings(currentSettings);

          if (useSidePanel) {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            await chrome.action.setPopup({ popup: '' });
            await chrome.sidePanel.setOptions({ enabled: false });

            if (message.openSidePanel && message.tabId) {
              try {
                sidePanelOpenedTabs.add(message.tabId);
                await chrome.sidePanel.setOptions({
                  tabId: message.tabId,
                  path: 'pages/sidepanel.html',
                  enabled: true
                });
                await chrome.sidePanel.open({ tabId: message.tabId });
              } catch {
                // sidePanel.open may fail if no user gesture
              }
            }
          } else {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
            await chrome.sidePanel.setOptions({ enabled: false });
            await chrome.action.setPopup({ popup: 'pages/popup.html' });
            sidePanelOpenedTabs.clear();
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.TOGGLE_FAB:
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.SIDE_PANEL_OPENED:
        if (message.tabId) {
          sidePanelOpenedTabs.add(message.tabId);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.SIDE_PANEL_CLOSED:
        if (message.tabId) {
          sidePanelOpenedTabs.delete(message.tabId);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.FETCH_IMAGE_DATA: {
        try {
          const dataUrl = await fetchImageData(message.url);
          sendResponse({ success: true, dataUrl });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.REVERSE_SEARCH_UPLOAD: {
        try {
          const result = await reverseSearchUpload(message.engine, message.imageDataUrl);
          sendResponse(result);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.ACTIVATE_LICENSE: {
        try {
          const activateResult = await activateLicense(message.licenseKey);
          if (activateResult.success) {
            broadcastToPopup({
              type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
              isPro: true,
              plan: activateResult.plan,
              status: 'active'
            });
          }
          sendResponse(activateResult);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.DEACTIVATE_LICENSE: {
        try {
          const deactivateResult = await deactivateLicense();
          broadcastToPopup({
            type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
            isPro: false,
            status: 'inactive'
          });
          sendResponse(deactivateResult);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.VALIDATE_LICENSE: {
        try {
          const proStatus = await isProUser();
          sendResponse(proStatus);
        } catch (error) {
          sendResponse({ isPro: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.GET_LICENSE_STATUS: {
        try {
          const licenseInfo = await getLicenseInfo();
          sendResponse(licenseInfo);
        } catch (error) {
          sendResponse({ hasLicense: false, error: error.message });
        }
        break;
      }

      case MESSAGE_TYPES.MULTI_TAB_EXTRACT: {
        try {
          const multiTabResult = await processMultiTabExtract(message.tabIds || []);
          sendResponse(multiTabResult);
        } catch (multiTabError) {
          sendResponse({ success: false, error: multiTabError.message });
        }
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    const isExpectedError = error.message?.includes('Cannot access this page')
      || error.message?.includes('Receiving end does not exist')
      || error.message?.includes('Could not establish connection');

    if (isExpectedError) {
      console.warn('Background:', error.message);
    } else {
      console.error('Background error:', error);
    }

    let errorCode = ERROR_CODES.INJECTION_FAILED;
    let errorMessage = error.message;
    let workaround = null;

    if (error.code === ERROR_CODES.CSP_BLOCKED || error.message?.includes('CSP_BLOCKED')) {
      errorCode = ERROR_CODES.CSP_BLOCKED;
      errorMessage = error.message || 'Page security policy prevents extension access';
      workaround = error.workaround || 'Right-click images and select "Open in new tab" to download manually';
    }

    sendResponse({
      success: false,
      error: errorCode,
      message: errorMessage,
      workaround
    });
  }
}
