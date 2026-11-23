// Orchestration for the day-3/5/7 trial recap.
//
// Split out of shared/trial-recap.ts (which owns the milestone maths and must
// stay free of sidepanel state so it is testable without the store) and out
// of init.ts (already the largest module in the panel).
//
// Claim-before-render, deliberately: a crash between the claim and the paint
// costs one milestone, whereas painting without claiming would make "how many
// users reached the day-3 recap" unanswerable.

import { getState } from '../shared/paywall-state';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { getDueTrialRecap, markTrialRecapShown } from '../shared/trial-recap';
import { state } from './state';

export async function maybeShowTrialRecap(): Promise<void> {
  try {
    const due = await getDueTrialRecap();
    if (!due) return;

    // Cumulative successful downloads since install. The soft-paywall counter
    // deliberately counts Pro/trial users too (only its banner is gated), so
    // for a trial user this is exactly the trial's download total.
    const { downloadCount } = await getState();

    await markTrialRecapShown(due.day);

    state.trialValueMoment = {
      variant: 'recap',
      day: due.day,
      count: downloadCount,
      daysRemaining: due.daysRemaining,
    };

    void track(EVENTS.TRIAL_RECAP_SHOWN, {
      day: due.day,
      count: downloadCount,
      daysRemaining: due.daysRemaining,
    });
  } catch {
    // Recap is additive UI: storage or license failures must not surface.
  }
}
