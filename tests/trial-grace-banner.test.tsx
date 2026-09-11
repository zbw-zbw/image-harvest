// Tests for sidepanel/components/TrialGraceBanner.tsx — the persistent banner
// shown during the 3-day post-trial grace window.
//
// Scope:
//   - Hidden outside the grace window (and NO impression telemetry)
//   - Renders inside grace + hands daysLeft to maybeReportTrialGraceBanner
//     (the once/day/install throttle lives in shared/trial and is covered by
//     tests/trial.test.ts — here we only assert the component hand-off)
//   - Upgrade CTA fires trial_grace_cta_clicked and opens the upgrade modal
//
// Strategy: mock shared/telemetry + shared/trial so assertions target the
// call contract; drive the real sidepanel store by direct assignment (same
// pattern as tests/soft-paywall.test.tsx). DOM hooks are the component's
// CSS classes (.trial-grace-banner / .trial-grace-btn) so tests stay
// decoupled from the i18n catalogue text.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

// Top-level mock fns referenced by the hoisted vi.mock factories below —
// the factories only execute when the (dynamically imported) component
// module resolves them, by which time these consts are initialized.
const mockTrack = vi.fn(() => Promise.resolve());
const mockMaybeReport = vi.fn(() => Promise.resolve(true));

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
}));

vi.mock('../shared/trial', () => ({
  maybeReportTrialGraceBanner: mockMaybeReport,
}));

import { state } from '../sidepanel/state';
import { EVENTS } from '../shared/telemetry-events';

let TrialGraceBanner: (typeof import('../sidepanel/components/TrialGraceBanner'))['TrialGraceBanner'];

beforeAll(async () => {
  ({ TrialGraceBanner } = await import('../sidepanel/components/TrialGraceBanner'));
});

function resetState(): void {
  state.inTrialGracePeriod = false;
  state.trialGraceDaysRemaining = 0;
  state.proUpgradeModalState = { open: false, errorText: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

afterEach(() => {
  cleanup();
  resetState();
});

describe('<TrialGraceBanner>', () => {
  it('renders nothing outside the grace window and reports no impression', async () => {
    const { container } = render(<TrialGraceBanner />);
    expect(container.querySelector('.trial-grace-banner')).toBeNull();
    // Flush the effect queue before asserting the negative.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMaybeReport).not.toHaveBeenCalled();
  });

  it('renders inside grace and hands daysLeft to the throttled impression reporter', async () => {
    state.inTrialGracePeriod = true;
    state.trialGraceDaysRemaining = 2;
    const { container } = render(<TrialGraceBanner />);
    expect(container.querySelector('.trial-grace-banner')).not.toBeNull();
    await waitFor(() => {
      expect(mockMaybeReport).toHaveBeenCalledTimes(1);
    });
    expect(mockMaybeReport).toHaveBeenCalledWith(2);
  });

  it('upgrade CTA fires trial_grace_cta_clicked and opens the upgrade modal', async () => {
    state.inTrialGracePeriod = true;
    state.trialGraceDaysRemaining = 2;
    const { container } = render(<TrialGraceBanner />);
    const btn = container.querySelector('.trial-grace-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_GRACE_CTA_CLICKED);
    expect(state.proUpgradeModalState.open).toBe(true);
    expect(state.proUpgradeModalState.errorText).toBe('');
  });
});
