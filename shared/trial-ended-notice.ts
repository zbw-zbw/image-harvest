// Post-grace "your trial ended" notice.
//
// Why this exists: an expired trial has exactly two touchpoints today — the
// 3-day grace banner (TrialGraceBanner) and, much later, the winback hero
// inside ProUpgradeModal, which only appears if the user hits a Pro feature.
// The field data (2026-11) showed 265 trials expiring in 30 days against a
// winback reach of 59 users: once grace lapses, most users reopen the panel
// into a silent downgrade and are never told what happened or what Pro cost.
//
// This notice fills that hole with ONE impression per install, inside a
// 30-day post-grace window:
//   * never during grace (the grace banner owns that window),
//   * never for licenses that are not expired trials,
//   * never twice, and never for trials that expired long before this
//     version shipped (a 90-day-old expiry is not a re-engagement moment,
//     it is a resurrection).
//
// Deliberately NOT throttled per day like the grace banner: this one is
// one-shot, so the storage read doubles as the "already shown" gate.

import { getLicenseData } from './license';
import { TRIAL_GRACE_PERIOD_MS } from './trial';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long after the grace window the notice stays relevant. */
export const TRIAL_ENDED_NOTICE_WINDOW_MS = 30 * DAY_MS;

const STORAGE_KEY = '_trial_ended_notice_shown';

/**
 * Whole days since the trial expired, or null when the notice is not due.
 *
 * Pure and exported so the window maths is testable without storage or a
 * license record. `expiresAt` is the trial's expiry, not the grace deadline.
 */
export function trialEndedNoticeFromExpiry(
  expiresAt: number,
  now: number = Date.now()
): number | null {
  if (!Number.isFinite(expiresAt)) return null;
  const elapsed = now - expiresAt;
  // Grace window: TrialGraceBanner is already on screen.
  if (elapsed < TRIAL_GRACE_PERIOD_MS) return null;
  if (elapsed > TRIAL_GRACE_PERIOD_MS + TRIAL_ENDED_NOTICE_WINDOW_MS) return null;
  return Math.floor(elapsed / DAY_MS);
}

/**
 * Should the notice fire right now? Never marks anything — the caller claims
 * via markTrialEndedNoticeShown() once it has actually put it on screen.
 */
export async function getDueTrialEndedNotice(
  now: number = Date.now()
): Promise<{ daysSinceExpiry: number } | null> {
  const license = await getLicenseData();
  if (!license || license.plan !== 'trial' || !license.expiresAt) return null;

  const daysSinceExpiry = trialEndedNoticeFromExpiry(license.expiresAt, now);
  if (daysSinceExpiry === null) return null;

  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (data[STORAGE_KEY]) return null;
  } catch {
    // Unreadable storage: show it (one extra impression beats silence), the
    // mark below will simply fail and we try again next panel open.
  }

  return { daysSinceExpiry };
}

/** Record that the notice has been displayed. Best-effort. */
export async function markTrialEndedNoticeShown(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: Date.now() });
  } catch {
    // Storage failure only means the notice may repeat — never a reason to
    // break the panel.
  }
}
