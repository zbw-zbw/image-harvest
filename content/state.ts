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
 * Bound the dedup set to `max` entries using approximate-LRU eviction.
 * A `Set` preserves insertion order, so the oldest URLs are dropped first.
 * This keeps recent-discovery memory intact — unlike a blanket `.clear()`,
 * which wipes everything and forces re-discovery of every image on
 * long-lived SPA pages. Evicts down to half of `max` to amortise the cost.
 */
export function evictOldestSeenUrls(max: number): void {
  const size = state.seenUrls.size;
  if (size <= max) return;
  const evictCount = size - Math.floor(max / 2);
  const iter = state.seenUrls.values();
  for (let i = 0; i < evictCount; i++) {
    const oldest = iter.next().value;
    if (oldest === undefined) break;
    state.seenUrls.delete(oldest);
  }
}

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
