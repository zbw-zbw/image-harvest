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

// Grace period after closing a reverse-search tab. When Chrome closes
// a tab it fires onRemoved (which clears the tabId from our set) and
// then immediately fires onActivated to switch focus back to the
// original tab. Without this grace period, handleTabChange would treat
// the focus-restore as a regular tab switch — potentially triggering a
// full rescan, skeleton flash, or stuck loading state.
let reverseSearchCloseGraceUntil = 0;

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

/** True if we are within the grace period after closing a reverse-search tab. */
export function isWithinReverseSearchCloseGrace(): boolean {
  return Date.now() < reverseSearchCloseGraceUntil;
}

export function forgetReverseSearchTab(tabId: number): void {
  if (reverseSearchTabIds.has(tabId)) {
    reverseSearchTabIds.delete(tabId);
    // Allow a short grace period so the subsequent onActivated (focus
    // returning to the original tab) is also ignored.
    reverseSearchCloseGraceUntil = Date.now() + 500;
  }
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

// ── Generic "opened tab" tracking ────────────────────────────────────────────
// Tracks tabs intentionally opened by the extension (e.g. "open image in new
// tab") so handleTabChange ignores them — preventing unnecessary cache
// save/load/rescan cycles and scroll position loss when the user closes the
// new tab and focus returns to the original page.

let pendingOpenedTab = false;
const openedTabIds = new Set<number>();
let openedTabCloseGraceUntil = 0;

/** Call BEFORE chrome.tabs.create to arm the pending flag. */
export function armOpenedTabPending(): void {
  pendingOpenedTab = true;
}

/** Called from chrome.tabs.create().then() to record the actual tabId. */
export function markOpenedTab(tabId: number): void {
  openedTabIds.add(tabId);
  pendingOpenedTab = false;
}

/** Clear the pending flag without recording any tabId (e.g. when tab creation fails). */
export function clearOpenedTabPending(): void {
  pendingOpenedTab = false;
}

/** Synchronous check: is the given tabId (or a pending create) an opened tab? */
export function isOpenedTab(tabId: number): boolean {
  return pendingOpenedTab || openedTabIds.has(tabId);
}

/** Remove tracking for a closed tab and start a short grace period. */
export function forgetOpenedTab(tabId: number): void {
  if (openedTabIds.has(tabId)) {
    openedTabIds.delete(tabId);
    openedTabCloseGraceUntil = Date.now() + 500;
  }
}

/** True if we are within the grace period after closing an opened tab. */
export function isWithinOpenedTabCloseGrace(): boolean {
  return Date.now() < openedTabCloseGraceUntil;
}
