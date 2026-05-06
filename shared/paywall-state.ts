// Soft paywall state — owns the "should we show the upsell banner?" decision.
//
// Design contract (Sprint 2.1 in implementation_plan.md):
//   - The banner appears at most ONCE per install per cooldown window. We
//     never spam users; the whole point of the soft paywall is to be a
//     gentle, dismissible nudge — not the existing modal pop-up.
//   - Trigger: cumulative successful downloads >= SOFT_PAYWALL_THRESHOLD.
//     Both single (download_single) and batch (download_batch) downloads
//     contribute to the counter; a batch of N adds N (not 1).
//   - Dismissal: "Maybe later" sets dismissed_at = now() and the banner
//     stays gone for SOFT_PAYWALL_COOLDOWN_MS. After that we re-arm and
//     wait for the threshold to be crossed again.
//   - Trial / Pro users never see the banner (the caller is responsible
//     for the Pro check; this module deliberately doesn't import license
//     state to keep it cheap and unit-testable).
//
// All persistence goes through chrome.storage.local under a single key so
// we can wipe state by removing one entry. The module is framework-agnostic
// (no Preact, no DOM) so background / popup / sidepanel can all share it.

const STORAGE_KEY = 'softPaywallState';

/**
 * Total successful downloads required before the banner first arms.
 * Picked to land AFTER the user has felt clear value — "I downloaded a
 * bunch already, this thing works" — but before they've fully internalized
 * the Free experience as the new normal.
 */
export const SOFT_PAYWALL_THRESHOLD = 5;

/**
 * Re-show window after a "Maybe later" dismissal. 30 days matches the
 * implementation plan's "Maybe Later 30 天后再提示一次" line; long enough
 * that the user doesn't feel hounded, short enough that the banner is
 * still around when their usage habit settles.
 */
export const SOFT_PAYWALL_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Persisted shape. Kept intentionally tiny so a future schema bump is
 * cheap. `shownAt` is the last time the banner was displayed (used to
 * suppress duplicate shows within a single session).
 */
export interface SoftPaywallState {
  /** Cumulative successful downloads since install (or last reset). */
  downloadCount: number;
  /** Number of times the banner has been displayed across the install. */
  shownCount: number;
  /** Last time we showed the banner (epoch ms). 0 = never. */
  shownAt: number;
  /** Last time the user explicitly dismissed it (epoch ms). 0 = never. */
  dismissedAt: number;
  /**
   * Sticky terminal flag. When true the user clicked "Try Pro Free" or
   * activated a trial/license; we never bother them with the banner again.
   */
  resolved: boolean;
}

const DEFAULT_STATE: SoftPaywallState = {
  downloadCount: 0,
  shownCount: 0,
  shownAt: 0,
  dismissedAt: 0,
  resolved: false,
};

// ── Test-injectable adapters ────────────────────────────────────────────────
// Mirrors the pattern in shared/telemetry.ts so unit tests can swap storage +
// clock without monkey-patching globals.

interface StorageAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const defaultStorage: StorageAdapter = {
  async get(key) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
    const r = await chrome.storage.local.get(key);
    return r[key];
  },
  async set(key, value) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [key]: value });
  },
};

let storage: StorageAdapter = defaultStorage;
let nowImpl: () => number = () => Date.now();

// In-memory cache. Reads of the persisted state are cheap (single
// chrome.storage.local hit), but we still cache so a hot path like
// recordDownloads() doesn't re-await the same promise on every call.
let cache: SoftPaywallState | null = null;

async function load(): Promise<SoftPaywallState> {
  if (cache) return cache;
  const raw = (await storage.get(STORAGE_KEY)) as Partial<SoftPaywallState> | undefined;
  cache = { ...DEFAULT_STATE, ...(raw ?? {}) };
  return cache;
}

async function save(next: SoftPaywallState): Promise<void> {
  cache = next;
  await storage.set(STORAGE_KEY, next);
}

/**
 * Record successful downloads. `count` should be the number of files the
 * user actually received — for `download_batch` that's the success count
 * (the same number we ship to telemetry), not the selected count. Callers
 * MUST gate this on a real success path; counting requested-but-failed
 * downloads would inflate the threshold artificially.
 */
export async function recordDownloads(count: number): Promise<void> {
  if (!Number.isFinite(count) || count <= 0) return;
  const s = await load();
  await save({ ...s, downloadCount: s.downloadCount + Math.floor(count) });
}

/**
 * Decide whether to show the banner right now. Returns false in any of:
 *   - `resolved` is true (user already converted / explicitly opted into
 *     the Pro flow at some point)
 *   - download count below threshold
 *   - banner already shown in the cooldown window since last dismissal
 *   - banner already shown in the current session (shownAt within 60s)
 *
 * Pure read — does NOT mark the banner as shown. Call markShown() once
 * the UI actually mounts the banner. Splitting the two operations lets
 * the caller bail (e.g. Pro user, narrow viewport) without permanently
 * burning the show slot.
 */
export async function shouldShowBanner(): Promise<boolean> {
  const s = await load();
  if (s.resolved) return false;
  if (s.downloadCount < SOFT_PAYWALL_THRESHOLD) return false;

  const now = nowImpl();
  if (s.dismissedAt > 0 && now - s.dismissedAt < SOFT_PAYWALL_COOLDOWN_MS) {
    return false;
  }
  // Suppress duplicate shows in a single session — protects against
  // re-mounts (popup → sidepanel transition, dev hot reload, etc.) that
  // would otherwise replay the banner appear/dismiss cycle.
  if (s.shownAt > 0 && now - s.shownAt < 60_000) return false;
  return true;
}

/** Mark the banner as displayed. Increments `shownCount` and sets `shownAt`. */
export async function markShown(): Promise<void> {
  const s = await load();
  await save({ ...s, shownCount: s.shownCount + 1, shownAt: nowImpl() });
}

/**
 * Record an explicit dismissal ("Maybe Later" / close X). Starts the
 * cooldown window; the banner won't reappear until SOFT_PAYWALL_COOLDOWN_MS
 * has elapsed AND the threshold is met again.
 */
export async function markDismissed(): Promise<void> {
  const s = await load();
  await save({ ...s, dismissedAt: nowImpl() });
}

/**
 * Mark the banner as permanently resolved. Called when the user clicks
 * the trial CTA or activates a license — at that point the soft paywall
 * has done its job and we should never show it again on this install,
 * even if the trial later expires (the modal handles re-conversion).
 */
export async function markResolved(): Promise<void> {
  const s = await load();
  await save({ ...s, resolved: true });
}

/** Read a snapshot of the current state. Mainly used by tests / debug UI. */
export async function getState(): Promise<SoftPaywallState> {
  return { ...(await load()) };
}

// ── Test hooks (do NOT use in production code) ─────────────────────────────

export const __test = {
  reset(): void {
    cache = null;
    storage = defaultStorage;
    nowImpl = () => Date.now();
  },
  setStorage(adapter: StorageAdapter): void {
    storage = adapter;
    cache = null;
  },
  setNow(impl: () => number): void {
    nowImpl = impl;
  },
  /** Force-set the cache for tests that don't want to round-trip storage. */
  setCache(state: SoftPaywallState): void {
    cache = { ...state };
  },
};
