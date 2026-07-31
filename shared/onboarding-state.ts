// Onboarding state — owns the "is the guided first-run flow active?" flag.
//
// Written by the welcome page when the "Try it now" CTA fires (bucket b of
// onboarding_flow_v1), read by the side panel's <OnboardingCoach/> to decide
// whether to render the 3-step coach marks, and resolved forever once the
// user completes their first download (or dismisses the coach).
//
// Same storage conventions as paywall-state / rating-prompt-state: one
// chrome.storage.local key, test-injectable adapter, in-memory cache.

const STORAGE_KEY = 'onboardingState';

export interface OnboardingState {
  /** True from CTA click until done/dismissed. */
  active: boolean;
  /** Epoch ms of the CTA click. 0 = never started. */
  startedAt: number;
  /** Sticky terminal flag — first download completed or coach dismissed. */
  resolved: boolean;
}

const DEFAULT_STATE: OnboardingState = {
  active: false,
  startedAt: 0,
  resolved: false,
};

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
let cache: OnboardingState | null = null;

async function load(): Promise<OnboardingState> {
  if (cache) return cache;
  const raw = (await storage.get(STORAGE_KEY)) as Partial<OnboardingState> | undefined;
  cache = { ...DEFAULT_STATE, ...(raw ?? {}) };
  return cache;
}

async function save(next: OnboardingState): Promise<void> {
  cache = next;
  await storage.set(STORAGE_KEY, next);
}

/** Welcome CTA clicked — arm the coach marks for the next panel open. */
export async function startOnboarding(): Promise<void> {
  const s = await load();
  if (s.resolved) return; // never re-arm after completion/dismissal
  await save({ ...s, active: true, startedAt: Date.now() });
}

/** Should the side panel render the coach marks right now? */
export async function isOnboardingActive(): Promise<boolean> {
  const s = await load();
  return s.active && !s.resolved;
}

/** First download completed or the user dismissed the coach — retire it. */
export async function resolveOnboarding(): Promise<void> {
  const s = await load();
  await save({ ...s, active: false, resolved: true });
}

/** Snapshot read for tests / debug. */
export async function getOnboardingState(): Promise<OnboardingState> {
  return { ...(await load()) };
}

// ── Test hooks (do NOT use in production code) ─────────────────────────────
export const __test = {
  reset(): void {
    cache = null;
    storage = defaultStorage;
  },
  setStorage(adapter: StorageAdapter): void {
    storage = adapter;
    cache = null;
  },
};
