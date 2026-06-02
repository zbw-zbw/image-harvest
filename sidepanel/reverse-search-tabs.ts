// Tracks whether the extension is currently opening a reverse-search tab.
// handleTabChange consults this flag synchronously BEFORE chrome.tabs.create
// resolves (because onActivated fires before the create promise settles).
//
// Flow:
//   1. reverseSearch() sets pendingReverseSearch = true
//   2. chrome.tabs.create() fires onActivated with the new tabId
//   3. handleTabChange checks isPendingReverseSearch() → true → ignores
//   4. chrome.tabs.create().then() records the tabId and clears the flag
//
// Kept in its own module (no store, no Preact) so it can be imported by both
// actions.ts (writer) and tab-lifecycle.ts (reader) without a circular
// dependency, and without triggering any re-render.

let pendingReverseSearch = false;
const reverseSearchTabIds = new Set<number>();

/** Call BEFORE chrome.tabs.create to arm the pending flag. */
export function armReverseSearchPending(): void {
  pendingReverseSearch = true;
}

/** Called from chrome.tabs.create().then() to record the actual tabId. */
export function markReverseSearchTab(tabId: number): void {
  reverseSearchTabIds.add(tabId);
  pendingReverseSearch = false;
}

/** Synchronous check: is the given tabId (or a pending create) a reverse-search tab? */
export function isReverseSearchTab(tabId: number): boolean {
  return pendingReverseSearch || reverseSearchTabIds.has(tabId);
}

export function forgetReverseSearchTab(tabId: number): void {
  reverseSearchTabIds.delete(tabId);
}

// Additional set of extension-owned tab IDs (welcome page, etc.) that should
// be ignored by tab-switch handlers. Unlike reverse-search tabs (which are
// known before onActivated fires), these are discovered after the first await
// and then remembered for subsequent switches.
const ignoredExtensionTabIds = new Set<number>();

export function markIgnoredExtensionTab(tabId: number): void {
  ignoredExtensionTabIds.add(tabId);
}

export function isIgnoredExtensionTab(tabId: number): boolean {
  return ignoredExtensionTabIds.has(tabId);
}

export function forgetIgnoredExtensionTab(tabId: number): void {
  ignoredExtensionTabIds.delete(tabId);
}

// Origin of our own extension pages, e.g. "chrome-extension://<id>/".
// Used to detect any of our own pages (welcome.html, reverse-search.html, …)
// so tab-switch handlers can skip them: these are not scannable web pages and
// switching focus to one must not touch the current tab's image state.
const OWN_EXTENSION_ORIGIN = (() => {
  try {
    return chrome.runtime?.getURL?.('') || '';
  } catch {
    return '';
  }
})();

/** True when the URL belongs to one of our own extension pages. */
export function isOwnExtensionUrl(url: string | null | undefined): boolean {
  if (!url || !OWN_EXTENSION_ORIGIN) return false;
  return url.startsWith(OWN_EXTENSION_ORIGIN);
}
