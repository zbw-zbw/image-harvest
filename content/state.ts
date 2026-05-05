// Content script shared state. The legacy classic-script implementation
// relied on top-level `var` declarations being shared across every <script>
// in the manifest's `js` array. ESM modules don't share globals, so every
// consumer now imports `state` explicitly.

export interface ContentState {
  /** Guard against re-entrancy of extractImages() */
  isExtracting: boolean;
  /** MutationObserver instance for live monitoring (null when not running) */
  liveObserver: MutationObserver | null;
  /** De-dup set populated during a single extraction pass */
  seenUrls: Set<string>;
}

export const state: ContentState = {
  isExtracting: false,
  liveObserver: null,
  seenUrls: new Set<string>(),
};

/**
 * Check whether the extension context is still valid. After an extension
 * reload / update the old content script stays alive but `chrome.runtime`
 * becomes unusable — any property access throws "Extension context invalidated".
 */
export function isExtensionContextValid(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
