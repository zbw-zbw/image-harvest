// Display mode control (side panel vs popup).
import { getAppSettings } from '../shared/storage';
import { sidePanelOpenedTabs, uiPorts } from './utils';

/** Configure the action surface (side panel vs popup) on startup. */
export async function initDisplayMode(): Promise<void> {
  try {
    const settings = await getAppSettings();
    const useSidePanel = settings.useSidePanel !== false;

    if (useSidePanel) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      await chrome.action.setPopup({ popup: '' });
      await chrome.sidePanel.setOptions({ enabled: false });
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
          await chrome.sidePanel.setOptions({
            tabId: activeTab.id,
            path: 'pages/sidepanel.html',
            enabled: true,
          });
        }
      } catch {
        // ignore
      }
    } else {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      await chrome.sidePanel.setOptions({ enabled: false });
      await chrome.action.setPopup({ popup: 'pages/popup.html' });
    }
  } catch (error) {
    console.error('Failed to init display mode:', error);
  }
}

/**
 * Tab activation listener — keeps the side panel enabled for tabs the user has
 * explicitly opened it on, without flipping the panel state on every switch
 * (which would cause it to auto-close).
 */
export function initTabActivationListener(): void {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const settings = await getAppSettings();
      if (!settings.useSidePanel) return;

      if (sidePanelOpenedTabs.has(activeInfo.tabId) || uiPorts.size > 0) {
        await chrome.sidePanel.setOptions({
          tabId: activeInfo.tabId,
          path: 'pages/sidepanel.html',
          enabled: true,
        });
      }
    } catch {
      // ignore
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    sidePanelOpenedTabs.delete(tabId);
  });
}
