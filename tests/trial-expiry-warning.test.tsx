// Tests for the pre-expiry trial warning inside ProStatusBadge.tsx — the
// amber banner shown during a trial's final 3 days (0 < daysLeft <= 3).
//
// Scope:
//   - Hidden while more than 3 days remain (and NO impression telemetry)
//   - Hidden once the trial has expired (daysLeft clamps to 0 — post-expiry
//     is TrialGraceBanner's job, covered by tests/trial-grace-banner.test.tsx)
//   - Renders inside the window + hands daysLeft to
//     maybeReportTrialExpiryWarning (the once/day/install throttle lives in
//     shared/trial and is covered by tests/trial.test.ts — here we only
//     assert the component hand-off)
//   - Upgrade CTA fires trial_expiry_cta_clicked with daysRemaining and
//     opens the upgrade modal
//
// Strategy: mock shared/telemetry + shared/trial so assertions target the
// call contract; drive the real sidepanel store by direct assignment (same
// pattern as tests/trial-grace-banner.test.tsx). DOM hooks are the banner's
// CSS classes (.trial-expiry-warning / .trial-expiry-btn) so tests stay
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
  maybeReportTrialExpiryWarning: mockMaybeReport,
  TRIAL_EXPIRY_WARNING_DAYS: 3,
}));

import { state } from '../sidepanel/state';
import { EVENTS } from '../shared/telemetry-events';

let ProStatusBadge: (typeof import('../sidepanel/components/ProStatusBadge'))['ProStatusBadge'];

beforeAll(async () => {
  ({ ProStatusBadge } = await import('../sidepanel/components/ProStatusBadge'));
});

const DAY_MS = 86_400_000;

function setTrial(daysLeft: number): void {
  state.isProUser = true;
  state.proLicenseInfo = {
    plan: 'trial',
    // One hour shy of the full day so trialDaysRemaining() ceils to daysLeft.
    expiresAt: Date.now() + daysLeft * DAY_MS - 3_600_000,
  };
}

function resetState(): void {
  state.isProUser = false;
  state.proLicenseInfo = null;
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

describe('<ProStatusBadge> trial expiry warning', () => {
  it('renders no warning while more than 3 days remain, with no impression', async () => {
    setTrial(5);
    const { container } = render(<ProStatusBadge />);
    expect(container.querySelector('.trial-expiry-warning')).toBeNull();
    // Flush the effect queue before asserting the negative.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMaybeReport).not.toHaveBeenCalled();
  });

  it('renders no warning for an expired trial (grace banner owns post-expiry)', async () => {
    state.proLicenseInfo = { plan: 'trial', expiresAt: Date.now() - 1_000 };
    const { container } = render(<ProStatusBadge />);
    expect(container.querySelector('.trial-expiry-warning')).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMaybeReport).not.toHaveBeenCalled();
  });

  it('renders on the boundary day (3) and hands daysLeft to the throttled reporter', async () => {
    setTrial(3);
    const { container } = render(<ProStatusBadge />);
    expect(container.querySelector('.trial-expiry-warning')).not.toBeNull();
    await waitFor(() => {
      expect(mockMaybeReport).toHaveBeenCalledTimes(1);
    });
    expect(mockMaybeReport).toHaveBeenCalledWith(3);
  });

  it('renders inside the window and hands daysLeft to the throttled reporter', async () => {
    setTrial(2);
    const { container } = render(<ProStatusBadge />);
    expect(container.querySelector('.trial-expiry-warning')).not.toBeNull();
    await waitFor(() => {
      expect(mockMaybeReport).toHaveBeenCalledTimes(1);
    });
    expect(mockMaybeReport).toHaveBeenCalledWith(2);
  });

  it('upgrade CTA fires trial_expiry_cta_clicked with daysRemaining and opens the modal', async () => {
    setTrial(2);
    const { container } = render(<ProStatusBadge />);
    const btn = container.querySelector('.trial-expiry-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_EXPIRY_CTA_CLICKED, {
      daysRemaining: 2,
    });
    expect(state.proUpgradeModalState.open).toBe(true);
    expect(state.proUpgradeModalState.errorText).toBe('');
  });
});
