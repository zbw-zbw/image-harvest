// Weekly win-back for long-expired trials.
//
// Why this exists: the post-grace ended notice (shared/trial-ended-notice.ts)
// is one-shot inside a 30-day window. After that the panel goes silent
// forever — a user who comes back on day 60 sees the free product and no
// acknowledgement that Pro exists. The winback hero in ProUpgradeModal only
// fires when they hit a Pro feature, which is exactly the moment they are
// already frustrated.
//
// This adds at most WEEKLY_WINBACK_MAX_IMPRESSIONS reminders, one per week
// and only on panel open, starting after the ended-notice window so the two
// never compete for the same slot. The storage record doubles as the gate:
// `lastShownAt` enforces the interval, `count` enforces the cap.
//
// Deliberately client-side and per-install: no email, no cloud sync, nothing
// that can reach a user who never reopens the panel.

import { getLicenseData } from './license';
import { TRIAL_GRACE_PERIOD_MS } from './trial';
import { TRIAL_ENDED_NOTICE_WINDOW_MS } from './trial-ended-notice';

const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKLY_WINBACK_INTERVAL_MS = 7 * DAY_MS;
export const WEEKLY_WINBACK_MAX_IMPRESSIONS = 4;

/** First reminder: right after the one-shot ended-notice window closes. */
export const WEEKLY_WINBACK_START_MS = TRIAL_GRACE_PERIOD_MS + TRIAL_ENDED_NOTICE_WINDOW_MS;

const STORAGE_KEY = '_weekly_winback';

interface WeeklyWinbackRecord {
  count: number;
  lastShownAt: number;
}

/**
 * Should a reminder fire right now? Pure and exported so the window maths is
 * testable without storage or a license record. `impressions` is how many
 * reminders this install has already seen; the returned `week` is 1-based.
 */
export function weeklyWinbackFrom(
  expiresAt: number,
  impressions: number,
  lastShownAt: number | null,
  now: number = Date.now()
): { week: number } | null {
  if (!Number.isFinite(expiresAt)) return null;

  const elapsed = now - expiresAt;
  if (elapsed < WEEKLY_WINBACK_START_MS) return null;
  if (impressions >= WEEKLY_WINBACK_MAX_IMPRESSIONS) return null;

  // A negative delta (clock moved backwards) also fails this check, which is
  // the safe direction: silence beats double-nudging.
  if (lastShownAt !== null && now - lastShownAt < WEEKLY_WINBACK_INTERVAL_MS) {
    return null;
  }

  return { week: impressions + 1 };
}

async function readRecord(): Promise<WeeklyWinbackRecord | null> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const raw = data[STORAGE_KEY];
    if (!raw || typeof raw !== 'object') return null;
    const count = Number((raw as WeeklyWinbackRecord).count);
    const lastShownAt = Number((raw as WeeklyWinbackRecord).lastShownAt);
    if (!Number.isFinite(count) || !Number.isFinite(lastShownAt)) return null;
    return { count, lastShownAt };
  } catch {
    return null;
  }
}

/**
 * Should a reminder fire right now? Never marks anything — the caller claims
 * via markWeeklyWinbackShown() once it has actually put it on screen.
 */
export async function getDueWeeklyWinback(
  now: number = Date.now()
): Promise<{ week: number } | null> {
  const license = await getLicenseData();
  if (!license || license.plan !== 'trial' || !license.expiresAt) return null;

  const record = await readRecord();
  return weeklyWinbackFrom(license.expiresAt, record?.count ?? 0, record?.lastShownAt ?? null, now);
}

/** Record one impression. Best-effort: a failure only means a repeat. */
export async function markWeeklyWinbackShown(now: number = Date.now()): Promise<void> {
  try {
    const record = await readRecord();
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        count: (record?.count ?? 0) + 1,
        lastShownAt: now,
      } satisfies WeeklyWinbackRecord,
    });
  } catch {
    // Storage failure must never break the panel.
  }
}
