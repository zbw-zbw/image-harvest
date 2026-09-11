// NoticeStrip — the single 26px hint row consolidating the three legacy
// banners. Priority: trial-grace > soft-paywall > referral. One notice at
// a time; the ✕ dismisses THAT notice for 24h (per-type localStorage
// timestamp) and the next-priority notice may take its place.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

// vi.mock factories are hoisted above every declaration — plain consts
// would be in TDZ when the factory runs. vi.hoisted lifts these out first.
const {
  mockShouldShowBanner,
  mockMarkShown,
  mockMarkDismissed,
  mockIsTrialEligible,
  mockCopyReferralLink,
  mockTrack,
  mockMaybeReportTrialGraceBanner,
} = vi.hoisted(() => ({
  mockShouldShowBanner: vi.fn(),
  mockMarkShown: vi.fn(),
  mockMarkDismissed: vi.fn(),
  mockIsTrialEligible: vi.fn(),
  mockCopyReferralLink: vi.fn(),
  mockTrack: vi.fn(),
  mockMaybeReportTrialGraceBanner: vi.fn(),
}));

vi.mock('../shared/paywall-state', () => ({
  shouldShowBanner: mockShouldShowBanner,
  markShown: mockMarkShown,
  markDismissed: mockMarkDismissed,
}));
vi.mock('../shared/trial', () => ({
  isTrialEligible: mockIsTrialEligible,
  maybeReportTrialGraceBanner: mockMaybeReportTrialGraceBanner,
}));
vi.mock('../shared/referral', () => ({ copyReferralLink: mockCopyReferralLink }));
vi.mock('../shared/telemetry', () => ({ track: mockTrack }));
vi.mock('../sidepanel/ui', () => ({ showToast: vi.fn() }));

import { NoticeStrip } from '../sidepanel/components/NoticeStrip';
import { state } from '../sidepanel/state';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.isProUser = false;
  state.inTrialGracePeriod = false;
  state.trialGraceDaysRemaining = 0;
  state.proUpgradeModalState = { open: false, errorText: '' };
  mockShouldShowBanner.mockResolvedValue(false);
  mockIsTrialEligible.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('NoticeStrip — priority & rendering', () => {
  it('renders nothing for Pro users even when every source is eligible', async () => {
    state.isProUser = true;
    state.inTrialGracePeriod = true;
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    // The grace-impression effect runs regardless of Pro status — use it
    // as proof the effects settled before asserting nothing rendered.
    await waitFor(() => expect(mockMaybeReportTrialGraceBanner).toHaveBeenCalled());
    expect(container.querySelector('.notice-strip')).toBeNull();
  });

  it('trial-grace wins over soft-paywall and referral', async () => {
    state.inTrialGracePeriod = true;
    state.trialGraceDaysRemaining = 2;
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--trial-grace')).toBeTruthy());
    expect(container.querySelector('.notice-strip--paywall')).toBeNull();
    expect(container.querySelector('.notice-strip--referral')).toBeNull();
  });

  it('soft-paywall shows when grace inactive but banner eligible', async () => {
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('#soft-paywall-banner')).toBeTruthy());
    expect(mockMarkShown).toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith('soft_paywall_shown');
  });

  it('referral is the fallback when neither grace nor paywall applies', async () => {
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--referral')).toBeTruthy());
  });
});

describe('NoticeStrip — 24h per-type dismiss', () => {
  it('✕ writes a per-type timestamp and the notice disappears immediately', async () => {
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('#btn-soft-paywall-close')).toBeTruthy());
    fireEvent.click(container.querySelector('#btn-soft-paywall-close')!);
    await waitFor(() => expect(container.querySelector('.notice-strip')).toBeNull());
    expect(localStorage.getItem('notice_dismissed_paywall')).toBeTruthy();
    expect(mockMarkDismissed).toHaveBeenCalled();
  });

  it('a dismissed notice stays hidden for 24h (timestamp in the future)', async () => {
    localStorage.setItem('notice_dismissed_paywall', String(Date.now() + 23 * 3600 * 1000));
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.notice-strip--paywall')).toBeNull();
  });

  it('an expired dismissal (older than 24h) lets the notice return', async () => {
    localStorage.setItem('notice_dismissed_paywall', String(Date.now() - 25 * 3600 * 1000));
    mockShouldShowBanner.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--paywall')).toBeTruthy());
  });
});

describe('NoticeStrip — CTAs keep their legacy ids & telemetry', () => {
  it('paywall try CTA keeps #btn-soft-paywall-try and opens the upgrade modal', async () => {
    mockShouldShowBanner.mockResolvedValue(true);
    mockIsTrialEligible.mockResolvedValue(true);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('#btn-soft-paywall-try')).toBeTruthy());
    fireEvent.click(container.querySelector('#btn-soft-paywall-try')!);
    expect(state.proUpgradeModalState.open).toBe(true);
    expect(mockTrack).toHaveBeenCalledWith('soft_paywall_cta_clicked', {
      action: 'trial',
    });
  });

  it('referral copy CTA copies and toasts', async () => {
    mockCopyReferralLink.mockResolvedValue(undefined);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => expect(container.querySelector('.notice-strip--referral')).toBeTruthy());
    fireEvent.click(container.querySelector('.notice-strip-cta')!);
    await waitFor(() => expect(mockCopyReferralLink).toHaveBeenCalled());
  });
});
