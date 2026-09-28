// Tests for sidepanel/components/TrialValueMomentBanner.tsx — the
// non-blocking value-moment banner shown right after a trial user
// completes a ≥50-image batch download (B-plan 2026-09-28).
//
// Scope:
//   - Hidden when state.trialValueMoment is null (the common case)
//   - Renders when the trigger sets the moment payload
//   - Upgrade CTA fires trial_value_moment_cta_clicked WITH the count /
//     daysRemaining props and opens the upgrade modal
//
// Out of scope (covered elsewhere):
//   - The trigger itself (actions.ts downloadSelectedAsZip — e2e covers
//     the IPC-heavy download path, per tests/sidepanel-actions.test.tsx)
//   - getTrialState() branch logic (tests/trial.test.ts)
//   - Impression throttling — there is none by design: ≥50-image batches
//     are naturally rare, and TRIAL_VALUE_MOMENT_SHOWN is fired by the
//     trigger site in actions.ts, not by this component.
//
// Strategy: mock shared/telemetry so assertions target the call contract;
// drive the real sidepanel store by direct assignment (same pattern as
// tests/trial-grace-banner.test.tsx). DOM hooks are the component's CSS
// classes so tests stay decoupled from the i18n catalogue text.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';

const mockTrack = vi.fn(() => Promise.resolve());

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
}));

import { state } from '../sidepanel/state';
import { EVENTS } from '../shared/telemetry-events';

let TrialValueMomentBanner: (typeof import('../sidepanel/components/TrialValueMomentBanner'))['TrialValueMomentBanner'];

beforeAll(async () => {
  ({ TrialValueMomentBanner } = await import('../sidepanel/components/TrialValueMomentBanner'));
});

function resetState(): void {
  state.trialValueMoment = null;
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

describe('<TrialValueMomentBanner>', () => {
  it('renders nothing when no value moment is set (the common case)', () => {
    const { container } = render(<TrialValueMomentBanner />);
    expect(container.querySelector('.trial-value-moment-banner')).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('renders the banner when the trigger sets the moment payload', () => {
    state.trialValueMoment = { count: 120, daysRemaining: 5 };
    const { container } = render(<TrialValueMomentBanner />);
    expect(container.querySelector('.trial-value-moment-banner')).not.toBeNull();
    expect(container.querySelector('.trial-value-moment-btn')).not.toBeNull();
    // The message interpolates both values — assert the raw numbers made
    // it through t() without coupling to the catalogue wording.
    expect(container.textContent).toContain('120');
    expect(container.textContent).toContain('5');
  });

  it('upgrade CTA fires trial_value_moment_cta_clicked with count/daysRemaining and opens the upgrade modal', () => {
    state.trialValueMoment = { count: 87, daysRemaining: 3 };
    const { container } = render(<TrialValueMomentBanner />);
    const btn = container.querySelector('.trial-value-moment-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_VALUE_MOMENT_CTA_CLICKED, {
      count: 87,
      daysRemaining: 3,
    });
    expect(state.proUpgradeModalState.open).toBe(true);
    expect(state.proUpgradeModalState.errorText).toBe('');
  });
});
