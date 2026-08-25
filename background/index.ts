// Background Service Worker for Image Harvest.
// Main entry — initializes subsystems and routes runtime messages.
import { MESSAGE_TYPES, ERROR_CODES, UNINSTALL_FEEDBACK_URL } from '../shared/constants';
import { validateIncomingMessage } from '../shared/messaging';
import {
  getFilterConfig,
  getDownloadHistory,
  clearDownloadHistory,
  saveFilterConfig,
  getAppSettings,
  saveAppSettings,
} from '../shared/storage';
import {
  activateLicense,
  deactivateLicense,
  resetAndActivateLicense,
  isProUser,
  getLicenseInfo,
  getOrCreateInstanceId,
} from '../shared/license';
import { setEnvelopeMeta, track, flushNow } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';

import { uiPorts, sidePanelOpenedTabs, getAccessibleTabId, broadcastToPopup } from './utils';
import { initLicenseAlarm } from './license';
import { initDisplayMode, initTabActivationListener } from './display-mode';
import { getImagesFromTab, processMultiTabExtract } from './extractor';
import { resolveLinkImages } from './link-resolver';
import { generateId, getDomain, getFileFormat, isDirectImageUrl } from '../shared/utils';
import type { ImageItem } from '../shared/types';
import { fetchImageData, fetchImageMetaProxy, reverseSearchUpload } from './reverse-search';
import { isAllowedFetchUrl } from '../shared/url-validator';
import { autoStartTrial, initAutoTrialAlarm } from './auto-trial';
import { detectEagle, exportToEagle } from '../shared/export-eagle';
import type { EagleItem } from '../shared/export-eagle';
import { AI_TAG_API_URL, AI_TAG_BATCH_API_URL } from '../shared/constants';
import { getRemainingQuota, setLocalQuotaFromServer } from '../shared/ai-quota';
import { getRemainingMonthlyFreeAiTags, incrementMonthlyFreeAiTag } from '../shared/ai-free-quota';
import { syncRemoteConfig, getRemoteConfig } from '../shared/remote-config';

// ── Initialization ──────────────────────────────────────────────────────────

initLicenseAlarm();
initAutoTrialAlarm();

// ── Remote Config ───────────────────────────────────────────────────────────
// Restore cached config into memory on SW startup, then refresh in background.
void getRemoteConfig().then(() => void syncRemoteConfig());

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

// Chrome opens this URL in a new tab after the user removes the extension.
// It's the only churn signal we can collect — the page asks for an optional,
// anonymous reason (no identifiers, no license key, no telemetry id). Safe to
// call unconditionally on every SW start; Chrome just stores the value.
try {
  chrome.runtime.setUninstallURL(
    `${UNINSTALL_FEEDBACK_URL}?v=${encodeURIComponent(chrome.runtime.getManifest().version || '')}`
  );
} catch {
  /* non-fatal — older Chrome or restricted context */
}

// onInstalled fires exactly once per install/update event. We use it to
// distinguish brand-new installs (the most valuable signal in the funnel)
// from version updates of existing installs.

// ── Context menus (v1.1.0) ──────────────────────────────────────────────────
// Right-click → "Extract image" (on images) / "Extract linked image" (on
// links). Menu titles resolve via chrome.i18n.getMessage() instead of the
// `__MSG_*__` manifest substitution: on some setups the substitution silently
// fails and the raw placeholder leaks into the menu (seen in manual smoke
// testing), while getMessage() shares the same locale-resolution path and
// returns "" for a missing key — which we hard-fallback to English.
const CONTEXT_MENU_EXTRACT_IMAGE = 'ih-context-extract-image';
const CONTEXT_MENU_EXTRACT_LINKED = 'ih-context-extract-linked';

/** storage.session queue for context items injected while the panel is closed. */
const PENDING_CONTEXT_ITEMS_KEY = 'pendingContextItems';

interface ContextItemPayload {
  item?: ImageItem;
  error?: string;
}

/** Build a single-image item for a URL the user right-clicked. */
function buildContextImageItem(url: string, type: 'context-image' | 'link-image'): ImageItem {
  return {
    id: generateId(url),
    url,
    displayWidth: 0,
    displayHeight: 0,
    type,
    format: getFileFormat(url),
    sourceDomain: getDomain(url),
    checked: false,
    timestamp: Date.now(),
    // Explicit user action — must survive the visible-only filter.
    visible: true,
    // …and must survive rescans: not part of the page DOM, so the sidepanel
    // persists it per-tab instead of relying on the next scan to find it.
    userInjected: true,
  } as ImageItem;
}

/**
 * Deliver a context-menu item to the sidepanel over two channels:
 *   1. storage.session queue — survives a closed/busy panel; the sidepanel
 *      drains it on boot and clears it once consumed.
 *   2. broadcastToPopup — picked up live over the UI port when the panel is
 *      already open (same channel as DOWNLOAD_PROGRESS et al.).
 */
async function injectContextItem(payload: ContextItemPayload): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(PENDING_CONTEXT_ITEMS_KEY);
    const existing = stored[PENDING_CONTEXT_ITEMS_KEY];
    const queue: ContextItemPayload[] = Array.isArray(existing) ? existing : [];
    queue.push(payload);
    await chrome.storage.session.set({ [PENDING_CONTEXT_ITEMS_KEY]: queue });
  } catch {
    /* storage unavailable — the live broadcast below still covers an open panel */
  }
  broadcastToPopup({
    type: MESSAGE_TYPES.CONTEXT_ITEM_INJECTED,
    ...payload,
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return;

  // Open the panel FIRST, while the user-gesture context is still fresh —
  // chrome.sidePanel.open() must run inside a gesture handler. Resolution
  // work happens after, so the panel is already booting to receive the item.
  try {
    await chrome.sidePanel.setOptions({ tabId, path: 'pages/sidepanel.html', enabled: true });
    await chrome.sidePanel.open({ tabId });
  } catch {
    /* restricted page etc. — still queue the item via storage.session */
  }

  if (info.menuItemId === CONTEXT_MENU_EXTRACT_IMAGE) {
    if (info.srcUrl) {
      await injectContextItem({ item: buildContextImageItem(info.srcUrl, 'context-image') });
    }
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_EXTRACT_LINKED) {
    if (!info.linkUrl) return;
    if (isDirectImageUrl(info.linkUrl)) {
      await injectContextItem({ item: buildContextImageItem(info.linkUrl, 'link-image') });
      return;
    }
    // Non-image link — try to pull its og:image original via deep resolution.
    const { images } = await resolveLinkImages([info.linkUrl]);
    if (images.length > 0) {
      await injectContextItem({ item: images[0] });
    } else {
      await injectContextItem({ error: 'resolve_failed' });
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  // (Re-)register context menus on every install/update — Chrome wipes an
  // extension's menus when it updates, so this must run for both reasons.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_EXTRACT_IMAGE,
      title: chrome.i18n.getMessage('contextExtractImage') || 'Extract image with Image Harvest',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_EXTRACT_LINKED,
      title: chrome.i18n.getMessage('contextExtractLinked') || 'Extract linked image',
      contexts: ['link'],
    });
  });

  if (details.reason === 'install') {
    void track(EVENTS.EXTENSION_INSTALLED);
    void autoStartTrial('install');
    // Attempt to match a pending referral (from the invite landing page).
    // Runs async in background — non-blocking, best-effort.
    void import('../shared/referral').then(({ matchReferral }) =>
      matchReferral().then((result) => {
        if (result) {
          void track(EVENTS.REFERRAL_CLAIMED, { bonusDays: result.bonusDays });
        }
      })
    );
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
  } else if (details.reason === 'update') {
    void track(EVENTS.EXTENSION_UPDATED, {
      fromVersion: details.previousVersion || 'unknown',
      toVersion: chrome.runtime.getManifest().version || 'unknown',
    });
    void autoStartTrial('update');
    // One-time migration (v1.0.16): drop any persisted telemetryOptIn value.
    // Between v1.0.6 and v1.0.15 a dead-settings bug force-wrote
    // telemetryOptIn=false on every "Save & Apply" (the toggle's HTML had
    // been removed while its wiring survived, and the read fell back to
    // false) — and with the toggle gone there was NO user path that could
    // ever write true. Every stored value from that era is bug noise, not
    // a user choice. Telemetry is silent-by-design anonymous events now
    // (disclosed in the store listing), so a clean slate restores the
    // intended default-on state for all survivors of that window.
    void (async () => {
      try {
        const { _telemetry_opt_in_reset_v1016: done } = await chrome.storage.local.get(
          '_telemetry_opt_in_reset_v1016'
        );
        if (!done) {
          await chrome.storage.local.remove('telemetryOptIn');
          await chrome.storage.local.set({ _telemetry_opt_in_reset_v1016: true });
        }
      } catch {
        /* non-fatal — migration retries on next update */
      }
    })();
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
    broadcastToPopup({ type: 'DOWNLOAD_COMPLETE', downloadId: delta.id, count: 1 });
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
  // Drop unknown / malformed / version-mismatched messages before dispatch.
  const valid = validateIncomingMessage(message);
  if (!valid) {
    sendResponse({ success: false, error: 'Unknown or malformed message' });
    return false;
  }

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

  handleMessage(valid, sender, safeSendResponse).catch((unhandledError: Error) => {
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
        // Gallery-link candidates (v1.1.0) ride along on the same response —
        // the sidepanel's resolve-originals bar reads `galleryLinks`.
        let galleryLinks: string[] = [];
        const images = await getImagesFromTab(message.tabId as number | undefined, {
          searchAllFrames: (message.searchAllFrames as boolean) || false,
          liveMonitoring: message.liveMonitoring !== false,
          onGalleryLinks: (links: string[]) => {
            galleryLinks = links;
          },
        });
        sendResponse({ success: true, images, galleryLinks });
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

      // ── DEV-ONLY: manually trigger referral match for testing ──
      case 'TEST_MATCH_REFERRAL': {
        if (import.meta.env.DEV) {
          const { matchReferral } = await import('../shared/referral');
          const result = await matchReferral();
          sendResponse({ success: true, result });
        } else {
          sendResponse({ success: false, error: 'dev_only' });
        }
        break;
      }

      case MESSAGE_TYPES.TOGGLE_SIDEBAR:
        sendResponse({
          success: false,
          error: 'Use toolbar icon or shortcut to open side panel',
        });
        break;

      // Onboarding (Phase 2a): the welcome page's "Try it now" CTA opens the
      // side panel on its own tab. sendMessage preserves the user-gesture
      // context (Chrome 116+), which chrome.sidePanel.open() requires.
      case MESSAGE_TYPES.OPEN_SIDE_PANEL: {
        try {
          const tabId = sender.tab?.id;
          if (!tabId) {
            sendResponse({ success: false, error: 'no_tab' });
            break;
          }
          await chrome.sidePanel.setOptions({
            tabId,
            path: 'pages/sidepanel.html',
            enabled: true,
          });
          await chrome.sidePanel.open({ tabId });
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

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

      case MESSAGE_TYPES.CHECK_VISIBILITY: {
        try {
          const tabId = await getAccessibleTabId(message.tabId as number | undefined);
          if (tabId) {
            const response = await chrome.tabs.sendMessage(tabId, {
              type: MESSAGE_TYPES.CHECK_VISIBILITY,
              imageUrls: message.imageUrls,
            });
            sendResponse({ success: true, visibilityMap: response?.visibilityMap ?? {} });
          } else {
            sendResponse({ success: true, visibilityMap: {} });
          }
        } catch (error) {
          sendResponse({ success: false, visibilityMap: {}, error: (error as Error).message });
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
          if (deactivateResult.success) {
            broadcastToPopup({
              type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
              isPro: false,
              status: 'inactive',
            });
          }
          sendResponse(deactivateResult);
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.RESET_LICENSE_INSTANCES: {
        try {
          const resetResult = await resetAndActivateLicense(message.licenseKey as string);
          if (resetResult.success) {
            broadcastToPopup({
              type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
              isPro: true,
              plan: resetResult.plan,
              status: 'active',
            });
          }
          sendResponse(resetResult);
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

          let licenseKey = '';
          let instanceId = '';
          let previousQuota: number | null = null;

          if (proInfo.isPro) {
            const remaining = await getRemainingQuota();
            if (remaining <= 0) {
              sendResponse({ success: false, error: 'quota_exceeded', quotaRemaining: 0 });
              break;
            }
            // Optimistic deduction: deduct 1 before making the request to prevent
            // TOCTOU race conditions when multiple requests are in flight.
            previousQuota = remaining;
            await setLocalQuotaFromServer(remaining - 1);

            const licenseInfo = await getLicenseInfo();
            if (!licenseInfo.hasLicense) {
              // Rollback the optimistic deduction
              await setLocalQuotaFromServer(previousQuota);
              sendResponse({ success: false, error: 'no_license' });
              break;
            }
            licenseKey = licenseInfo.licenseKey;
            instanceId = licenseInfo.instanceId;
          } else {
            const freeRemaining = await getRemainingMonthlyFreeAiTags();
            if (freeRemaining <= 0) {
              sendResponse({ success: false, error: 'monthly_limit', quotaRemaining: 0 });
              break;
            }
            // Optimistic deduction for free tier — increment before sending
            await incrementMonthlyFreeAiTag();

            instanceId = await getOrCreateInstanceId();
          }

          const requestBody: Record<string, unknown> = {
            instanceId,
            imageUrl,
            tier: proInfo.isPro ? 'pro' : 'free',
          };
          if (proInfo.isPro && licenseKey) {
            requestBody.licenseKey = licenseKey;
          }

          const aiController = new AbortController();
          const aiTimeout = setTimeout(() => aiController.abort(), 15000);
          let aiTagSuccess = false;
          try {
            const resp = await fetch(AI_TAG_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody),
              signal: aiController.signal,
            });
            const data = (await resp.json()) as {
              success: boolean;
              tags?: string[];
              quotaRemaining?: number;
              error?: string;
            };
            if (!resp.ok || !data.success) {
              // Request failed — rollback the optimistic deduction
              if (proInfo.isPro && previousQuota !== null) {
                await setLocalQuotaFromServer(previousQuota);
              }
              sendResponse({
                success: false,
                error: data.error || 'ai_tag_failed',
                quotaRemaining: data.quotaRemaining,
              });
              break;
            }
            // Success — use server's authoritative quota value to correct local state
            if (proInfo.isPro && typeof data.quotaRemaining === 'number') {
              await setLocalQuotaFromServer(data.quotaRemaining);
            }
            aiTagSuccess = true;
            sendResponse({
              success: true,
              tags: data.tags || [],
              quotaRemaining: data.quotaRemaining,
            });
          } finally {
            clearTimeout(aiTimeout);
            // Rollback optimistic deduction on abort/network errors
            if (!aiTagSuccess && proInfo.isPro && previousQuota !== null) {
              await setLocalQuotaFromServer(previousQuota);
            }
          }
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        break;
      }

      case MESSAGE_TYPES.AI_TAG_BATCH: {
        try {
          const { imageUrls } = message as { imageUrls: string[] };
          const proInfo = await isProUser();
          if (!proInfo.isPro) {
            sendResponse({ success: false, error: 'pro_required' });
            break;
          }
          const batchSize = Array.isArray(imageUrls) ? imageUrls.length : 0;
          if (batchSize === 0) {
            sendResponse({ success: false, error: 'no_images' });
            break;
          }
          const remaining = await getRemainingQuota();
          if (remaining < batchSize) {
            sendResponse({
              success: false,
              error: 'quota_exceeded',
              quotaRemaining: remaining,
            });
            break;
          }
          const previousQuota = remaining;
          // Optimistic deduction: deduct the full batch size up front
          await setLocalQuotaFromServer(remaining - batchSize);

          const licenseInfo = await getLicenseInfo();
          if (!licenseInfo.hasLicense) {
            // Rollback
            await setLocalQuotaFromServer(previousQuota);
            sendResponse({ success: false, error: 'no_license' });
            break;
          }
          const batchController = new AbortController();
          const batchTimeout = setTimeout(() => batchController.abort(), 30000);
          let batchSuccess = false;
          try {
            const resp = await fetch(AI_TAG_BATCH_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                licenseKey: licenseInfo.licenseKey,
                instanceId: licenseInfo.instanceId,
                imageUrls,
              }),
              signal: batchController.signal,
            });
            const data = (await resp.json()) as {
              success: boolean;
              results?: Array<{ url: string; tags: string[]; success: boolean }>;
              quotaRemaining?: number;
              error?: string;
            };
            if (!resp.ok || !data.success) {
              // Rollback optimistic deduction
              await setLocalQuotaFromServer(previousQuota);
              sendResponse({ success: false, error: data.error || 'batch_tag_failed' });
              break;
            }
            // Use server's authoritative quota value
            if (typeof data.quotaRemaining === 'number') {
              await setLocalQuotaFromServer(data.quotaRemaining);
            }
            batchSuccess = true;
            sendResponse({
              success: true,
              results: data.results || [],
              quotaRemaining: data.quotaRemaining,
            });
          } finally {
            clearTimeout(batchTimeout);
            // Rollback optimistic deduction on abort/network errors
            if (!batchSuccess) {
              await setLocalQuotaFromServer(previousQuota);
            }
          }
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

      // Deep link-resolution (v1.1.0): fetch detail pages, pull og:image.
      // Quota gating / telemetry live in the sidepanel — this route is pure.
      case MESSAGE_TYPES.RESOLVE_LINK_IMAGES: {
        try {
          const result = await resolveLinkImages((message.urls as string[]) || []);
          sendResponse({ success: true, ...result });
        } catch (resolveError) {
          sendResponse({ success: false, error: (resolveError as Error).message });
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
