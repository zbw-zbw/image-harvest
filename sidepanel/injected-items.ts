// User-injected images (v1.1.0 link penetration): right-click "Extract
// image / Extract linked image" items and resolve-originals results.
//
// These items are NOT part of the page DOM — no scan will ever rediscover
// them, so without extra care they are lost in two ways:
//   1. A scan's authoritative `state.allImages = fresh` replace wipes them
//      (scan.ts re-attaches them at every replace point).
//   2. A sidepanel reload wipes the in-memory state — the panel restores
//      them from a per-tab storage.session key written by
//      persistInjectedItems.
import { t } from '../shared/i18n';
import type { ImageItem } from '../shared/types';
import { applyFilters } from './filter';
import { processImageExtras } from './scan';
import { state } from './state';
import { showToast } from './ui';
import { generateId } from './utils';

/** storage.session queue key — must match background/index.ts. */
export const PENDING_CONTEXT_ITEMS_KEY = 'pendingContextItems';

/** Per-tab key for injected items that outlive the queue drain. */
const injectedKey = (tabId: number) => `ih:injected:${tabId}`;

interface ContextItemPayload {
  item?: ImageItem;
  error?: string;
}

/** Merge a right-click extracted item into the grid (URL-deduped). */
export function mergeContextItem(item: ImageItem): boolean {
  const normalized: ImageItem = {
    ...item,
    id: item.id || generateId(item.url),
    // Tag the owning tab so scans never preserve an injected item into
    // another tab's result after a fast tab switch.
    tabId: item.tabId ?? state.currentTabId ?? undefined,
    // Owning-tab grouping metadata: the 'tab' group mode must bucket
    // injected items with the tab they belong to, never a nameless
    // fallback group. New items carry it from the injector; legacy
    // persisted items (pre-v1.1.1) fall back to the current tab's title.
    tabTitle: item.tabTitle || state.currentTabTitle || undefined,
    tabIndex: item.tabIndex,
    isCurrentTab: item.isCurrentTab ?? true,
    colors: undefined,
    phash: null,
  };
  if (state.allImages.some((img) => img.url === normalized.url)) return false;
  state.allImages = [...state.allImages, normalized];
  applyFilters();
  processImageExtras([normalized]);
  // Not part of the page — persist so a reload/rescan can't drop it.
  void persistInjectedItems();
  return true;
}

/**
 * Boot-time fallback: context items queued while the panel was closed live in
 * storage.session (written by the background before broadcasting). Drained
 * once after init through the same merge path as live injections.
 */
export async function drainPendingContextItems(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(PENDING_CONTEXT_ITEMS_KEY);
    const queue = stored[PENDING_CONTEXT_ITEMS_KEY] as ContextItemPayload[] | undefined;
    if (!Array.isArray(queue) || queue.length === 0) return;
    await chrome.storage.session.remove(PENDING_CONTEXT_ITEMS_KEY);

    let merged = 0;
    let failed = false;
    for (const payload of queue) {
      if (payload.error) {
        failed = true;
      } else if (payload.item && mergeContextItem(payload.item)) {
        merged++;
      }
    }
    if (failed) showToast(t('toast_gallery_resolve_failed'), 'error');
    if (merged > 0) showToast(t('toast_context_item_added'), 'success');
  } catch {
    /* storage unavailable — nothing to drain */
  }
}

/**
 * Persist the current tab's user-injected items (full rewrite) to
 * storage.session. Called after every merge and after a user deletes one,
 * so the key always mirrors "injected items currently in the grid".
 */
export async function persistInjectedItems(): Promise<void> {
  const tabId = state.currentTabId;
  if (tabId == null) return;
  const injected = state.allImages.filter((img) => img.userInjected);
  try {
    if (injected.length === 0) {
      await chrome.storage.session.remove(injectedKey(tabId));
    } else {
      await chrome.storage.session.set({ [injectedKey(tabId)]: injected });
    }
  } catch {
    /* storage unavailable — items stay in memory for this session */
  }
}

/**
 * Re-merge the persisted injected items for `tabId` into the grid after a
 * cache restore or fresh scan. Idempotent (URL-deduped) and silent — it is
 * a re-merge of something the user already saw land, not a new discovery.
 */
export async function restoreInjectedItems(tabId: number | null): Promise<void> {
  if (tabId == null) return;
  try {
    const stored = await chrome.storage.session.get(injectedKey(tabId));
    const items = stored[injectedKey(tabId)] as ImageItem[] | undefined;
    if (!Array.isArray(items) || items.length === 0) return;
    // Abort if the user switched tabs while we were reading storage.
    if (state.currentTabId !== tabId) return;
    for (const item of items) {
      mergeContextItem(item);
    }
  } catch {
    /* storage unavailable — nothing to restore */
  }
}
