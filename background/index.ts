// Background Service Worker for Image Harvest.
// Main entry — initializes subsystems and routes runtime messages.
import { MESSAGE_TYPES, ERROR_CODES } from '../shared/constants';
import {
  getFilterConfig,
  getDownloadHistory,
  clearDownloadHistory,
  saveFilterConfig,
  getAppSettings,
  saveAppSettings,
} from '../shared/storage';
import { activateLicense, deactivateLicense, isProUser, getLicenseInfo } from '../shared/license';
import { setEnvelopeMeta, track, flushNow } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';

import { uiPorts, sidePanelOpenedTabs, getAccessibleTabId, broadcastToPopup } from './utils';
import { initLicenseAlarm } from './license';
import { initDisplayMode, initTabActivationListener } from './display-mode';
import { getImagesFromTab, processMultiTabExtract } from './extractor';
import { fetchImageData, fetchImageMetaProxy, reverseSearchUpload } from './reverse-search';
import { isAllowedFetchUrl } from '../shared/url-validator';
import { autoStartTrial, initAutoTrialAlarm } from './auto-trial';
import { detectEagle, exportToEagle } from '../shared/export-eagle';
import type { EagleItem } from '../shared/export-eagle';
import { AI_TAG_API_URL } from '../shared/constants';
import { getRemainingQuota, setLocalQuotaFromServer } from '../shared/ai-quota';

// ── Initialization ──────────────────────────────────────────────────────────

initLicenseAlarm();
initAutoTrialAlarm();

// ── Telemetry initialization ────────────────────────────────────────────────
// Two responsibilities:
//   1. Seed the envelope meta (version + plan) so sidepanel/popup don't have
//      to re-derive it on every load. lang is filled in lazily by the UI
//      side at boot via setEnvelopeMeta().
//   2. Capture EXT_INSTALLED / EXT_UPDATED at the only place chrome lets
//      us — the onInstalled hook, which is only invoked in the SW.
function initTelemetry(): void {
  // Seed `version` synchronously from the manifest. Plan defaults to
  // 'free'; the sidepanel will overwrite once isProUser() resolves.
  const version = chrome.runtime.getManifest().version || '0.0.0';
  setEnvelopeMeta({ version, plan: 'free' });

  // Late-bind plan after license check completes. Failure is non-fatal —
  // we just keep the 'free' default.
  isProUser()
    .then((info) => {
      const plan = info.isPro ? info.plan || 'pro' : 'free';
      setEnvelopeMeta({ plan });
    })
    .catch(() => {
      /* keep default */
    });
}

initTelemetry();

// onInstalled fires exactly once per install/update event. We use it to
// distinguish brand-new installs (the most valuable signal in the funnel)
// from version updates of existing installs.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void track(EVENTS.EXTENSION_INSTALLED);
    void autoStartTrial('install');
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
  } else if (details.reason === 'update') {
    void track(EVENTS.EXTENSION_UPDATED, {
      fromVersion: details.previousVersion || 'unknown',
      toVersion: chrome.runtime.getManifest().version || 'unknown',
    });
    void autoStartTrial('update');
  }
  // SW may go dormant before the 5s flush window — ship immediately.
  void flushNow();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'image-harvest-ui') return;
  uiPorts.add(port);
  port.onDisconnect.addListener(() => {
    uiPorts.delete(port);
  });
});

initDisplayMode();
initTabActivationListener();

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === 'complete') {
    broadcastToPopup({ type: 'DOWNLOAD_COMPLETE', downloadId: delta.id });
  }
});

// ── Message Router ──────────────────────────────────────────────────────────

interface RuntimeMessage {
  type?: string;
  [key: string]: unknown;
}

interface ExtensionError extends Error {
  code?: string;
  workaround?: string;
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  let channelOpen = true;
  const safeSendResponse = (response: unknown): void => {
    if (!channelOpen) return;
    try {
      sendResponse(response);
    } catch {
      // Channel already closed.
    }
    channelOpen = false;
  };

  handleMessage(message, sender, safeSendResponse).catch((unhandledError: Error) => {
    console.error('[Background] Unhandled error in handleMessage:', unhandledError);
    safeSendResponse({ success: false, error: unhandledError?.message || 'Internal error' });
  });
  return true;
});

async function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    switch (message.type) {
      case MESSAGE_TYPES.GET_IMAGES: {
        const images = await getImagesFromTab(message.tabId as number | undefined, {
          searchAllFrames: (message.searchAllFrames as boolean) || false,
          liveMonitoring: message.liveMonitoring !== false,
        });
        sendResponse({ success: true, images });
        const tabId = message.tabId as number | undefined;
        if (tabId && images.length > 0) {
          const text = images.length > 999 ? '999+' : String(images.length);
          chrome.action.setBadgeText({ text, tabId }).catch(() => {});
          chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId }).catch(() => {});
        }
        break;
      }

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
        await saveFilterConfig(message.config as Parameters<typeof saveFilterConfig>[0]);
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.IMAGES_DISCOVERED:
        broadcastToPopup({
          ...message,
          fromTabId: sender.tab?.id ?? null,
        });
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.TOGGLE_SIDEBAR:
        sendResponse({
          success: false,
          error: 'Use toolbar icon or shortcut to open side panel',
        });
        break;

      case MESSAGE_TYPES.HIGHLIGHT_IMAGE: {
        try {
          const tabId = await getAccessibleTabId(message.tabId as number | undefined);
          if (tabId) {
            const response = await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.HIGHLIGHT_IMAGE,
              imageUrl: message.imageUrl,
            });
            sendResponse({ success: true, found: response?.found ?? false });
          } else {
            sendResponse({ success: true, found: false });
          }
        } catch (error) {
          sendResponse({ success: false, found: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.UNHIGHLIGHT_IMAGE: {
        try {
          const tabId = await getAccessibleTabId(message.tabId as number | undefined);
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.UNHIGHLIGHT_IMAGE,
              imageUrl: message.imageUrl,
            });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.HIGHLIGHT_IMAGES: {
        try {
          const tabId = await getAccessibleTabId(message.tabId as number | undefined);
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.HIGHLIGHT_IMAGES,
              imageUrls: message.imageUrls,
            });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.REMOVE_HIGHLIGHT: {
        try {
          const tabId = await getAccessibleTabId(message.tabId as number | undefined);
          if (tabId) {
            await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.REMOVE_HIGHLIGHT });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.CLEAR_SELECTION:
        broadcastToPopup({ type: MESSAGE_TYPES.CLEAR_SELECTION });
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.SET_DISPLAY_MODE: {
        try {
          const useSidePanel = message.useSidePanel as boolean;
          const currentSettings = await getAppSettings();
          currentSettings.useSidePanel = useSidePanel;
          await saveAppSettings(currentSettings);

          if (useSidePanel) {
            // Switching to side-panel mode: clear popup, enable side panel
            // open-on-action-click, and (optionally) open it for the active tab.
            await chrome.action.setPopup({ popup: '' });
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            await chrome.sidePanel.setOptions({ enabled: false });

            if (message.openSidePanel && message.tabId) {
              try {
                sidePanelOpenedTabs.add(message.tabId as number);
                await chrome.sidePanel.setOptions({
                  tabId: message.tabId as number,
                  path: 'pages/sidepanel.html',
                  enabled: true,
                });
                await chrome.sidePanel.open({ tabId: message.tabId as number });
              } catch {
                // sidePanel.open may fail if no user gesture.
              }
            }
          } else {
            // Switching to popup mode: we MUST disable the side panel for every
            // tab that previously had it enabled, otherwise the currently-open
            // side panel UI stays on screen and Chrome will keep treating the
            // action click as "open side panel" until explicitly disabled.
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

            // Disable the panel default-globally first.
            try {
              await chrome.sidePanel.setOptions({ enabled: false });
            } catch {
              // ignore
            }

            // Then disable for every tab where the side panel had been opened.
            // This is what actually causes the visible side panel UI to close.
            const tabIds = Array.from(sidePanelOpenedTabs);
            await Promise.all(
              tabIds.map(async (tid) => {
                try {
                  await chrome.sidePanel.setOptions({ tabId: tid, enabled: false });
                } catch {
                  // tab may have been closed
                }
              })
            );

            // Also try to disable for the currently active tab (catches the
            // case where the side panel was opened by background.initDisplayMode
            // but never ran through SIDE_PANEL_OPENED bookkeeping).
            try {
              const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (activeTab?.id != null && !sidePanelOpenedTabs.has(activeTab.id)) {
                await chrome.sidePanel.setOptions({ tabId: activeTab.id, enabled: false });
              }
            } catch {
              // ignore
            }

            sidePanelOpenedTabs.clear();

            // Finally re-register the popup so the next click opens it.
            await chrome.action.setPopup({ popup: 'pages/popup.html' });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.TOGGLE_FAB:
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.SIDE_PANEL_OPENED:
        if (typeof message.tabId === 'number') {
          sidePanelOpenedTabs.add(message.tabId);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.SIDE_PANEL_CLOSED:
        if (typeof message.tabId === 'number') {
          sidePanelOpenedTabs.delete(message.tabId);
        }
        sendResponse({ success: true });
        break;

      case MESSAGE_TYPES.FETCH_IMAGE_DATA: {
        const url = message.url as string;
        if (!isAllowedFetchUrl(url)) {
          sendResponse({ success: false, error: 'Blocked: URL not allowed for fetch' });
          break;
        }
        try {
          const dataUrl = await fetchImageData(url);
          sendResponse({ success: true, dataUrl });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.FETCH_IMAGE_META: {
        const metaUrl = message.url as string;
        if (!isAllowedFetchUrl(metaUrl)) {
          sendResponse({ success: false, error: 'Blocked: URL not allowed for fetch' });
          break;
        }
        try {
          const meta = await fetchImageMetaProxy(metaUrl);
          sendResponse({ success: true, size: meta.size, contentType: meta.contentType });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.REVERSE_SEARCH_UPLOAD: {
        try {
          const result = await reverseSearchUpload(
            message.engine as string,
            message.imageDataUrl as string
          );
          sendResponse(result);
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.ACTIVATE_LICENSE: {
        try {
          const activateResult = await activateLicense(message.licenseKey as string);
          if (activateResult.success) {
            broadcastToPopup({
              type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
              isPro: true,
              plan: activateResult.plan,
              status: 'active',
            });
          }
          sendResponse(activateResult);
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.DEACTIVATE_LICENSE: {
        try {
          const deactivateResult = await deactivateLicense();
          broadcastToPopup({
            type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
            isPro: false,
            status: 'inactive',
          });
          sendResponse(deactivateResult);
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.VALIDATE_LICENSE: {
        try {
          const proStatus = await isProUser();
          sendResponse(proStatus);
        } catch (error) {
          sendResponse({ isPro: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.GET_LICENSE_STATUS: {
        try {
          const licenseInfo = await getLicenseInfo();
          sendResponse(licenseInfo);
        } catch (error) {
          sendResponse({ hasLicense: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.EXPORT_TO_EAGLE: {
        try {
          const { items } = message as { items: EagleItem[] };
          const detect = await detectEagle();
          if (!detect.running) {
            sendResponse({ success: false, error: 'eagle_not_running' });
            break;
          }
          const result = await exportToEagle(items);
          sendResponse({ success: result.success, added: result.added, failed: result.failed });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.AI_TAG_IMAGE: {
        try {
          const { imageUrl } = message as { imageUrl: string };
          const proInfo = await isProUser();
          if (!proInfo.isPro) {
            sendResponse({ success: false, error: 'pro_required' });
            break;
          }
          const remaining = await getRemainingQuota();
          if (remaining <= 0) {
            sendResponse({ success: false, error: 'quota_exceeded', quotaRemaining: 0 });
            break;
          }
          const licenseInfo = await getLicenseInfo();
          if (!licenseInfo.hasLicense) {
            sendResponse({ success: false, error: 'no_license' });
            break;
          }
          const resp = await fetch(AI_TAG_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              licenseKey: licenseInfo.licenseKey,
              instanceId: licenseInfo.instanceId,
              imageUrl,
            }),
          });
          const data = (await resp.json()) as {
            success: boolean;
            tags?: string[];
            quotaRemaining?: number;
            error?: string;
          };
          if (!resp.ok || !data.success) {
            sendResponse({
              success: false,
              error: data.error || 'ai_tag_failed',
              quotaRemaining: data.quotaRemaining,
            });
            break;
          }
          if (typeof data.quotaRemaining === 'number') {
            await setLocalQuotaFromServer(data.quotaRemaining);
          }
          sendResponse({
            success: true,
            tags: data.tags || [],
            quotaRemaining: data.quotaRemaining,
          });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.MULTI_TAB_EXTRACT: {
        try {
          const multiTabResult = await processMultiTabExtract((message.tabIds as number[]) || []);
          sendResponse(multiTabResult);
        } catch (multiTabError) {
          sendResponse({ success: false, error: (multiTabError as Error).message });
        }
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (rawError) {
    const error = rawError as ExtensionError;
    // Predictable Chrome runtime quirks: tab is restricted, content script
    // not loaded yet, target frame disappeared, etc. These happen routinely
    // during normal operation (PING-then-inject pattern, sub-frames without
    // a listener) and should not pollute the console.
    const isExpectedError =
      error.message?.includes('Cannot access this page') ||
      error.message?.includes('Receiving end does not exist') ||
      error.message?.includes('Could not establish connection');

    if (!isExpectedError) {
      console.error('Background error:', error);
    }

    let errorCode: string = ERROR_CODES.INJECTION_FAILED;
    let errorMessage: string | undefined = error.message;
    let workaround: string | null = null;

    if (error.code === ERROR_CODES.CSP_BLOCKED || error.message?.includes('CSP_BLOCKED')) {
      errorCode = ERROR_CODES.CSP_BLOCKED;
      errorMessage = error.message || 'Page security policy prevents extension access';
      workaround =
        error.workaround || 'Right-click images and select "Open in new tab" to download manually';
    }

    sendResponse({
      success: false,
      error: errorCode,
      message: errorMessage,
      workaround,
    });
  }
}
