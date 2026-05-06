// Rating prompt state — owns the "should we ask the user to leave a
// 5-star review?" decision. Sprint 3.6 of /付费转化率拉升方案-从0到1-3.
//
// Why a separate module from shared/paywall-state.ts?
//   - The two prompts have different thesis: paywall is about converting
//     to Pro; rating is about social proof for the Chrome Web Store
//     listing. They should not share thresholds, cooldowns, or "resolved"
//     flags. Conflating them would mean a user who upgraded would never
//     be asked to rate, and vice versa.
//   - Both prompts could fire in the same session; isolation lets us
//     order them independently (paywall takes priority — the modal layer
//     handles z-order / suppression).
//
// Contract:
//   - First show: cumulative successful downloads >= RATING_PROMPT_THRESHOLD
//   - Each download (single or batch success count) contributes
//   - Dismiss ("Maybe later") -> RATING_PROMPT_COOLDOWN_MS before re-arm
//   - Click "Rate now" -> resolved = true forever (we don't pester users
//     who already engaged with the CTA, regardless of whether they
//     actually completed the review on the store)
//   - Click "Don't ask again" -> resolved = true forever
//
// All persistence goes through chrome.storage.local under one key, same
// pattern as paywall-state.ts so unit tests can swap storage / clock via
// the __test export.

const STORAGE_KEY = 'ratingPromptState';

/**
 * Total successful downloads required before the rating prompt first
 * arms. 50 was picked because the median active user reaches it in ~2
 * weeks of regular use (per CHANGELOG telemetry baseline) — late enough
 * that they've already formed an opinion, early enough that they haven't
 * silently churned.
 */
export const RATING_PROMPT_THRESHOLD = 50;

/**
 * Re-show window after a "Maybe later" dismissal. 14 days is shorter than
 * the soft paywall (30d) because rating fatigue is lower than upsell
 * fatigue — users tolerate "still here? mind rating?" better than "buy
 * Pro?".
 */
export const RATING_PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Persisted shape. Same conventions as SoftPaywallState.
 */
export interface RatingPromptState {
  /** Cumulative successful downloads since install (or last reset). */
  downloadCount: number;
  /** Number of times the prompt has been displayed across the install. */
  shownCount: number;
  /** Last time we showed the prompt (epoch ms). 0 = never. */
  shownAt: number;
  /** Last time the user explicitly dismissed it (epoch ms). 0 = never. */
  dismissedAt: number;
  /**
   * Sticky terminal flag. True after either "Rate now" or "Don't ask
   * again" — both intentions mean we should never bring this back up.
   */
  resolved: boolean;
}

const DEFAULT_STATE: RatingPromptState = {
  downloadCount: 0,
  shownCount: 0,
  shownAt: 0,
  dismissedAt: 0,
  resolved: false,
};

// ── Test-injectable adapters ────────────────────────────────────────────────
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

let cache: RatingPromptState | null = null;

async function load(): Promise<RatingPromptState> {
  if (cache) return cache;
  const raw = (await storage.get(STORAGE_KEY)) as Partial<RatingPromptState> | undefined;
  cache = { ...DEFAULT_STATE, ...(raw ?? {}) };
  return cache;
}

async function save(next: RatingPromptState): Promise<void> {
  cache = next;
  await storage.set(STORAGE_KEY, next);
}

/**
 * Record successful downloads toward the rating prompt threshold. Same
 * counting rules as paywall-state.recordDownloads — count only what the
 * user actually received, batches contribute their success count.
 */
export async function recordDownloadForRating(count: number): Promise<void> {
  if (!Number.isFinite(count) || count <= 0) return;
  const s = await load();
  await save({ ...s, downloadCount: s.downloadCount + Math.floor(count) });
}

/**
 * Decide whether to show the rating prompt right now. Returns false in
 * any of:
 *   - resolved (user already engaged with the CTA at any point)
 *   - downloadCount < RATING_PROMPT_THRESHOLD
 *   - dismissed within the cooldown window
 *   - already shown within the current session (60s suppression)
 *
 * Pure read — does NOT mark the prompt as shown. Caller must call
 * markShown() once the modal actually mounts.
 */
export async function shouldShowRatingPrompt(): Promise<boolean> {
  const s = await load();
  if (s.resolved) return false;
  if (s.downloadCount < RATING_PROMPT_THRESHOLD) return false;

  const now = nowImpl();
  if (s.dismissedAt > 0 && now - s.dismissedAt < RATING_PROMPT_COOLDOWN_MS) {
    return false;
  }
  if (s.shownAt > 0 && now - s.shownAt < 60_000) return false;
  return true;
}

/** Mark the prompt as displayed. Increments shownCount + sets shownAt. */
export async function markRatingPromptShown(): Promise<void> {
  const s = await load();
  await save({ ...s, shownCount: s.shownCount + 1, shownAt: nowImpl() });
}

/** "Maybe later" dismissal — starts the cooldown. */
export async function markRatingPromptDismissed(): Promise<void> {
  const s = await load();
  await save({ ...s, dismissedAt: nowImpl() });
}

/**
 * Sticky resolution. Called for both "Rate now" and "Don't ask again"
 * because either intention permanently retires the prompt.
 */
export async function markRatingPromptResolved(): Promise<void> {
  const s = await load();
  await save({ ...s, resolved: true });
}

/** Snapshot read for tests / debug. */
export async function getRatingPromptState(): Promise<RatingPromptState> {
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
  setCache(state: RatingPromptState): void {
    cache = { ...state };
  },
};
