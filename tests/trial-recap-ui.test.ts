// Tests for sidepanel/trial-recap-ui.ts — the single entry point that keeps
// the value-moment slot one-shot across the day-3/5/7 recap, the post-grace
// "trial ended" notice and the weekly win-back for long-expired trials.
//
// Scope:
//   - The recap wins when both could fire (a live trial never has a lapsed
//     grace window, but the ordering is the contract init.ts relies on)
//   - The ended notice fires only when the recap is not due
//   - The weekly reminder fires only when neither of the above is due
//   - Nothing is marked when nothing is due
//
// Collaborators are mocked at module level: the window maths live in
// shared/trial-recap.ts and shared/trial-ended-notice.ts and are covered by
// their own tests. What matters here is which branch claims the slot.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDueTrialRecap = vi.fn();
const mockMarkTrialRecapShown = vi.fn();
const mockGetDueTrialEndedNotice = vi.fn();
const mockMarkTrialEndedNoticeShown = vi.fn();
const mockGetDueWeeklyWinback = vi.fn();
const mockMarkWeeklyWinbackShown = vi.fn();
const mockGetState = vi.fn();
const mockGetTrialProFeaturesUsed = vi.fn();
const mockTrack = vi.fn(() => Promise.resolve());

vi.mock('../shared/trial-recap', () => ({
  getDueTrialRecap: mockGetDueTrialRecap,
  markTrialRecapShown: mockMarkTrialRecapShown,
}));

vi.mock('../shared/trial-ended-notice', () => ({
  getDueTrialEndedNotice: mockGetDueTrialEndedNotice,
  markTrialEndedNoticeShown: mockMarkTrialEndedNoticeShown,
}));

vi.mock('../shared/weekly-winback', () => ({
  getDueWeeklyWinback: mockGetDueWeeklyWinback,
  markWeeklyWinbackShown: mockMarkWeeklyWinbackShown,
}));

vi.mock('../shared/paywall-state', () => ({
  getState: mockGetState,
}));

vi.mock('../shared/trial-pro-usage', () => ({
  getTrialProFeaturesUsed: mockGetTrialProFeaturesUsed,
}));

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
}));

import { EVENTS } from '../shared/telemetry-events';
import { state } from '../sidepanel/state';

beforeEach(() => {
  vi.clearAllMocks();
  state.trialValueMoment = null;
  mockGetDueTrialRecap.mockResolvedValue(null);
  mockGetDueTrialEndedNotice.mockResolvedValue(null);
  mockGetDueWeeklyWinback.mockResolvedValue(null);
  mockGetState.mockResolvedValue({ downloadCount: 150 });
  mockGetTrialProFeaturesUsed.mockResolvedValue([]);
});

describe('maybeShowTrialRecap', () => {
  it('fills the slot with the recap and never consults the ended notice', async () => {
    mockGetDueTrialRecap.mockResolvedValue({ day: 5, daysRemaining: 3 });
    mockGetTrialProFeaturesUsed.mockResolvedValue(['dedup']);

    const { maybeShowTrialRecap } = await import('../sidepanel/trial-recap-ui');
    await maybeShowTrialRecap();

    expect(state.trialValueMoment).toEqual({
      variant: 'recap',
      day: 5,
      count: 150,
      daysRemaining: 3,
      features: ['dedup'],
    });
    expect(mockMarkTrialRecapShown).toHaveBeenCalledWith(5);
    expect(mockGetDueTrialEndedNotice).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_RECAP_SHOWN, {
      day: 5,
      count: 150,
      daysRemaining: 3,
    });
  });

  it('falls through to the ended notice once the recap is not due', async () => {
    mockGetDueTrialEndedNotice.mockResolvedValue({ daysSinceExpiry: 6 });
    mockGetTrialProFeaturesUsed.mockResolvedValue(['deepScan']);

    const { maybeShowTrialRecap } = await import('../sidepanel/trial-recap-ui');
    await maybeShowTrialRecap();

    expect(state.trialValueMoment).toEqual({
      variant: 'ended',
      count: 150,
      daysSinceExpiry: 6,
      features: ['deepScan'],
    });
    expect(mockMarkTrialEndedNoticeShown).toHaveBeenCalledTimes(1);
    expect(mockMarkTrialRecapShown).not.toHaveBeenCalled();
    expect(mockGetDueWeeklyWinback).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_ENDED_NOTICE_SHOWN, {
      daysSinceExpiry: 6,
      count: 150,
    });
  });

  it('falls through to the weekly win-back once the ended notice window is over', async () => {
    mockGetDueWeeklyWinback.mockResolvedValue({ week: 2 });
    mockGetTrialProFeaturesUsed.mockResolvedValue(['batchZip']);

    const { maybeShowTrialRecap } = await import('../sidepanel/trial-recap-ui');
    await maybeShowTrialRecap();

    expect(state.trialValueMoment).toEqual({
      variant: 'weekly',
      week: 2,
      count: 150,
      features: ['batchZip'],
    });
    expect(mockMarkWeeklyWinbackShown).toHaveBeenCalledTimes(1);
    expect(mockMarkTrialEndedNoticeShown).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.TRIAL_WEEKLY_WINBACK_SHOWN, {
      week: 2,
      count: 150,
    });
  });

  it('leaves the slot empty and claims nothing when none is due', async () => {
    const { maybeShowTrialRecap } = await import('../sidepanel/trial-recap-ui');
    await maybeShowTrialRecap();

    expect(state.trialValueMoment).toBeNull();
    expect(mockMarkTrialRecapShown).not.toHaveBeenCalled();
    expect(mockMarkTrialEndedNoticeShown).not.toHaveBeenCalled();
    expect(mockMarkWeeklyWinbackShown).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('swallows storage failures so the panel still opens', async () => {
    mockGetDueTrialEndedNotice.mockImplementation(async () => {
      throw new Error('storage unavailable');
    });

    const { maybeShowTrialRecap } = await import('../sidepanel/trial-recap-ui');
    await expect(maybeShowTrialRecap()).resolves.toBeUndefined();
    expect(state.trialValueMoment).toBeNull();
  });
});
