// Display mode control (side panel vs popup)
import { getAppSettings } from '../shared/storage.mjs';
import { sidePanelOpenedTabs, uiPorts } from './utils.js';

// Initialize display mode based on saved settings
export async function initDisplayMode() {
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
            enabled: true
          });
        }
      } catch { /* ignore */ }
    } else {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      await chrome.sidePanel.setOptions({ enabled: false });
      await chrome.action.setPopup({ popup: 'pages/popup.html' });
    }
  } catch (error) {
    console.error('Failed to init display mode:', error);
  }
}

// Set up tab activation listener for side panel visibility control
export function initTabActivationListener() {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const settings = await getAppSettings();
      if (!settings.useSidePanel) return;

      // Only enable side panel for tabs that user has explicitly opened it on,
      // or when there are active UI ports connected.
      // Do NOT disable/re-enable side panel as it causes unwanted close behavior.
      if (sidePanelOpenedTabs.has(activeInfo.tabId) || uiPorts.size > 0) {
        await chrome.sidePanel.setOptions({
          tabId: activeInfo.tabId,
          path: 'pages/sidepanel.html',
          enabled: true
        });
      }
    } catch { /* ignore */ }
  });

  // Clean up tracking when tabs are closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    sidePanelOpenedTabs.delete(tabId);
  });
}
