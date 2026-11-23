// Orchestration for the trial banners that share the value-moment slot:
// the day-3/5/7 recap and the post-grace "your trial ended" notice.
//
// Split out of shared/trial-recap.ts (which owns the milestone maths and must
// stay free of sidepanel state so it is testable without the store) and out
// of init.ts (already the largest module in the panel).
//
// Claim-before-render, deliberately: a crash between the claim and the paint
// costs one impression, whereas painting without claiming would make "how many
// users reached the day-3 recap" unanswerable.
//
// The two are mutually exclusive by construction (the recap requires a live
// trial, the ended notice requires a trial whose grace window is over), so a
// single entry point keeps init.ts honest about the slot being one-shot.

import { getState } from '../shared/paywall-state';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { getDueTrialEndedNotice, markTrialEndedNoticeShown } from '../shared/trial-ended-notice';
import { getDueTrialRecap, markTrialRecapShown } from '../shared/trial-recap';
import { getTrialProFeaturesUsed } from '../shared/trial-pro-usage';
import { state } from './state';

export async function maybeShowTrialRecap(): Promise<void> {
  try {
    if (await showTrialRecapIfDue()) return;
    await showTrialEndedNoticeIfDue();
  } catch {
    // Both banners are additive UI: storage or license failures must not
    // surface in the panel.
  }
}

async function showTrialRecapIfDue(): Promise<boolean> {
  const due = await getDueTrialRecap();
  if (!due) return false;

  // Cumulative successful downloads since install. The soft-paywall counter
  // deliberately counts Pro/trial users too (only its banner is gated), so
  // for a trial user this is exactly the trial's download total.
  const { downloadCount } = await getState();

  // Named back to the user on the recap ("you've used: …"). A trial that
  // only shows a download count undersells the quiet Pro features, and an
  // empty list is fine — the banner then renders the count alone.
  const features = await getTrialProFeaturesUsed();

  await markTrialRecapShown(due.day);

  state.trialValueMoment = {
    variant: 'recap',
    day: due.day,
    count: downloadCount,
    daysRemaining: due.daysRemaining,
    features,
  };

  void track(EVENTS.TRIAL_RECAP_SHOWN, {
    day: due.day,
    count: downloadCount,
    daysRemaining: due.daysRemaining,
  });
  return true;
}

async function showTrialEndedNoticeIfDue(): Promise<void> {
  const due = await getDueTrialEndedNotice();
  if (!due) return;

  const { downloadCount } = await getState();
  // Same "name what they used" argument as the recap: at this point the
  // feature list is the only concrete thing they are giving up.
  const features = await getTrialProFeaturesUsed();

  await markTrialEndedNoticeShown();

  state.trialValueMoment = {
    variant: 'ended',
    count: downloadCount,
    daysSinceExpiry: due.daysSinceExpiry,
    features,
  };

  void track(EVENTS.TRIAL_ENDED_NOTICE_SHOWN, {
    daysSinceExpiry: due.daysSinceExpiry,
    count: downloadCount,
  });
}
