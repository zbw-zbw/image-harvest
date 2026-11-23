// Trial day-3/5/7 value recap.
//
// Why this exists: the trial has exactly one announcement (the install page)
// and one deadline warning (the last 3 days). In between the panel is silent
// for the whole first week — the window where the habit either forms or the
// user drifts away without ever noticing what they had. A recap at day 3, 5
// and 7 turns the trial into a narrative instead of a countdown.
//
// Milestones are 1-based days since the trial started; day 7 is the last
// day. Each fires once per install, so a user who opens the panel ten times
// on day 3 sees it once.
//
// Deliberately NOT cloud-synced and NOT derived from trial start timestamps
// stored separately: `expiresAt - TRIAL_DURATION_MS` is the start, which is
// always consistent with what the license check will say on the last day.

import { getLicenseData } from './license';
import { TRIAL_DURATION_MS } from './trial';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milestone days, 1-based. Day 7 is the final day of the trial. */
export const TRIAL_RECAP_DAYS = [3, 5, 7] as const;
export type TrialRecapDay = (typeof TRIAL_RECAP_DAYS)[number];

const STORAGE_KEY = '_trial_recap_days_shown';

/**
 * Which day of the trial `now` falls on, or null when there is no live trial
 * day (not started yet, already expired, or a clock skew put `now` before
 * the computed start).
 *
 * Pure and exported so the milestone maths is testable without storage or a
 * license record.
 */
export function trialDayFromExpiry(expiresAt: number, now: number = Date.now()): number | null {
  if (!Number.isFinite(expiresAt)) return null;
  const startedAt = expiresAt - TRIAL_DURATION_MS;
  const elapsed = now - startedAt;
  // Negative elapsed means the local clock disagrees with the issued license;
  // treating it as a recap day would fire every milestone at once.
  if (elapsed < 0) return null;
  // Expired: the grace banner owns that window, and "day 8 of 7" is nonsense.
  if (now >= expiresAt) return null;
  return Math.floor(elapsed / DAY_MS) + 1;
}

async function readShownDays(): Promise<number[]> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const raw = data[STORAGE_KEY];
    return Array.isArray(raw) ? (raw as number[]) : [];
  } catch {
    return [];
  }
}

/**
 * Should a recap fire right now? Returns the milestone and the remaining
 * days, or null. Never marks anything — the caller claims via
 * markTrialRecapShown() once it has actually put the recap on screen.
 */
export async function getDueTrialRecap(
  now: number = Date.now()
): Promise<{ day: TrialRecapDay; daysRemaining: number } | null> {
  const license = await getLicenseData();
  if (!license || license.plan !== 'trial' || !license.expiresAt) return null;

  const day = trialDayFromExpiry(license.expiresAt, now);
  if (day === null) return null;
  if (!(TRIAL_RECAP_DAYS as readonly number[]).includes(day)) return null;

  const shown = await readShownDays();
  if (shown.includes(day)) return null;

  return {
    day: day as TrialRecapDay,
    daysRemaining: Math.max(1, Math.ceil((license.expiresAt - now) / DAY_MS)),
  };
}

/** Record that a milestone's recap has been displayed. Best-effort. */
export async function markTrialRecapShown(day: TrialRecapDay): Promise<void> {
  try {
    const shown = await readShownDays();
    if (shown.includes(day)) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: [...shown, day] });
  } catch {
    // Storage failure only means the same milestone may show again next
    // panel open — never a reason to break the panel.
  }
}
