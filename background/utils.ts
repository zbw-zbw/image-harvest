// Background utility functions.
import { isRestrictedUrl } from '../shared/utils';

export type UIPort = chrome.runtime.Port;

/** Connected UI ports (popup / side panel) — used for broadcasting. */
export const uiPorts: Set<UIPort> = new Set();

/** Tabs the user has explicitly opened the side panel on. */
export const sidePanelOpenedTabs: Set<number> = new Set();

// Re-export for convenience inside the background bundle.
export { isRestrictedUrl };

/**
 * Resolve to a tab id only if the tab exists and is not a restricted URL.
 * Returns `null` for any error/restricted case so callers can short-circuit.
 */
export async function getAccessibleTabId(explicitTabId?: number | null): Promise<number | null> {
  try {
    const tabId =
      explicitTabId ||
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!tabId) return null;
    const tabInfo = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tabInfo.url)) return null;
    return tabId;
  } catch {
    return null;
  }
}

/** Send a message to a tab, rejecting after `timeoutMs` to avoid hangs. */
export function sendMessageToTabWithTimeout<T = unknown>(
  tabId: number,
  message: unknown,
  timeoutMs: number = 30000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Message to tab ${tabId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.tabs
      .sendMessage(tabId, message)
      .then((response) => {
        clearTimeout(timer);
        resolve(response as T);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/** Broadcast a message to every connected UI port; drop dead ports silently. */
export function broadcastToPopup(message: unknown): void {
  for (const port of uiPorts) {
    try {
      port.postMessage(message);
    } catch {
      uiPorts.delete(port);
    }
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
