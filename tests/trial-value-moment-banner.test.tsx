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
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('<TrialValueMomentBanner>', () => {
  it('renders nothing when no value moment is set (the common case)', () => {
    const { container } = render(<TrialValueMomentBanner />);
    expect(container.querySelector('.trial-value-moment-banner')).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('renders the banner when the trigger sets the moment payload', () => {
    state.trialValueMoment = { count: 120, daysRemaining: 5, variant: 'batch' };
    const { container } = render(<TrialValueMomentBanner />);
    expect(container.querySelector('.trial-value-moment-banner')).not.toBeNull();
    expect(container.querySelector('.trial-value-moment-btn')).not.toBeNull();
    // The message interpolates both values — assert the raw numbers made
    // it through t() without coupling to the catalogue wording.
    expect(container.textContent).toContain('120');
    expect(container.textContent).toContain('5');
  });

  it('upgrade CTA fires trial_value_moment_cta_clicked with count/daysRemaining and opens the upgrade modal', () => {
    state.trialValueMoment = { count: 87, daysRemaining: 3, variant: 'batch' };
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

  // Phase 1: the first-scan echo reuses this slot but must not be counted
  // as an ordinary batch value moment — the shown/cta pair has its own event
  // names so one-shot reach stays separable in the funnel.
  it('first-scan variant fires its own CTA event, not the batch one', () => {
    state.trialValueMoment = { count: 42, daysRemaining: 7, variant: 'first_scan' };
    const { container } = render(<TrialValueMomentBanner />);
    const btn = container.querySelector('.trial-value-moment-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_FIRST_SCAN_CTA_CLICKED, {
      count: 42,
      daysRemaining: 7,
    });
    expect(state.proUpgradeModalState.open).toBe(true);
  });

  // Phase 1: day-3/5/7 recap. It must render the annual anchor (the whole
  // point of the milestone) and report under its own event name carrying
  // the day, so reach per milestone stays separable.
  it('recap variant renders the annual anchor and fires the recap CTA event', () => {
    state.trialValueMoment = {
      count: 310,
      daysRemaining: 5,
      variant: 'recap',
      day: 3,
      features: [],
    };
    const { container } = render(<TrialValueMomentBanner />);

    expect(container.querySelector('.trial-recap-anchor')).not.toBeNull();
    expect(container.textContent).toContain('29.99');
    expect(container.textContent).toContain('310');

    const btn = container.querySelector('.trial-value-moment-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();
    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_RECAP_CTA_CLICKED, {
      day: 3,
      count: 310,
      daysRemaining: 5,
    });
  });

  // Phase 1: the recap names the Pro features the trial actually used, so an
  // expiring trial reads as "here is what you'd lose" instead of a countdown.
  it('recap variant names the Pro features the trial used', () => {
    state.trialValueMoment = {
      count: 310,
      daysRemaining: 5,
      variant: 'recap',
      day: 3,
      features: ['dedup', 'formatConvert'],
    };
    const { container } = render(<TrialValueMomentBanner />);

    const chips = container.querySelectorAll('.trial-recap-chip');
    expect(chips.length).toBe(2);
    expect(container.textContent).toContain('Duplicate Detection');
    expect(container.textContent).toContain('Format Conversion');
  });

  it('caps the recap chips at three so the banner stays one line tall', () => {
    state.trialValueMoment = {
      count: 40,
      daysRemaining: 2,
      variant: 'recap',
      day: 5,
      features: ['multiTab', 'dedup', 'formatConvert', 'colorCopy', 'deepScan'],
    };
    const { container } = render(<TrialValueMomentBanner />);

    expect(container.querySelectorAll('.trial-recap-chip').length).toBe(3);
  });

  it('omits the chip row when the trial used no Pro features yet', () => {
    state.trialValueMoment = {
      count: 8,
      daysRemaining: 4,
      variant: 'recap',
      day: 3,
      features: [],
    };
    const { container } = render(<TrialValueMomentBanner />);

    expect(container.querySelector('.trial-recap-features')).toBeNull();
    expect(container.textContent).toContain('8');
  });

  // Phase 2: the post-grace notice reuses the recap layout (what they used,
  // what it costs) but its CTA leaves for the pricing page instead of the
  // modal — an expired user already knows what Pro does, so the shortest
  // path to checkout wins.
  it('ended variant names the features used and keeps the annual anchor', () => {
    state.trialValueMoment = {
      count: 204,
      variant: 'ended',
      daysSinceExpiry: 6,
      features: ['dedup', 'deepScan'],
    };
    const { container } = render(<TrialValueMomentBanner />);

    expect(container.querySelector('.trial-recap-anchor')).not.toBeNull();
    expect(container.textContent).toContain('29.99');
    expect(container.querySelectorAll('.trial-recap-chip').length).toBe(2);
    expect(container.textContent).toContain('Duplicate Detection');
  });

  it('ended CTA opens the pricing page with trigger=trial_ended and skips the modal', () => {
    const createTab = vi.fn();
    (globalThis as unknown as { chrome: { tabs: { create: unknown } } }).chrome = {
      tabs: { create: createTab },
    };
    state.trialValueMoment = {
      count: 204,
      variant: 'ended',
      daysSinceExpiry: 6,
      features: [],
    };
    const { container } = render(<TrialValueMomentBanner />);
    const btn = container.querySelector('.trial-value-moment-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_ENDED_NOTICE_CTA_CLICKED, {
      daysSinceExpiry: 6,
      count: 204,
    });
    expect(createTab).toHaveBeenCalledTimes(1);
    expect(String(createTab.mock.calls[0][0].url)).toContain('trigger=trial_ended');
    expect(state.proUpgradeModalState.open).toBe(false);
  });
});
