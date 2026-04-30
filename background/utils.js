// Background utility functions
import { MESSAGE_TYPES } from '../shared/constants.mjs';

// Track connected UI ports (popup / side panel) for broadcasting
export const uiPorts = new Set();

// Track which tabs the user has explicitly opened the side panel on.
export const sidePanelOpenedTabs = new Set();

// Re-export isRestrictedUrl from shared utils
export { isRestrictedUrl } from '../shared/utils.mjs';

// Get an accessible tab ID, returning null if the tab is restricted or unavailable
export async function getAccessibleTabId(explicitTabId) {
  try {
    const tabId = explicitTabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!tabId) return null;
    const tabInfo = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tabInfo.url)) return null;
    return tabId;
  } catch {
    return null;
  }
}

// Send a message to a tab with a timeout to prevent hanging indefinitely.
export function sendMessageToTabWithTimeout(tabId, message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Message to tab ${tabId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message)
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// Broadcast message to connected UI ports (popup / side panel)
export function broadcastToPopup(message) {
  for (const port of uiPorts) {
    try {
      port.postMessage(message);
    } catch {
      uiPorts.delete(port);
    }
  }
}

// Convert ArrayBuffer to base64 string
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
