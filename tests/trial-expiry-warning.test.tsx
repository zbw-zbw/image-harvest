// Tests for the pre-expiry trial warning inside ProStatusBadge.tsx — the
// amber banner shown during a trial's final 3 days (0 < daysLeft <= 3).
//
// Scope:
//   - Hidden while more than 3 days remain (and NO impression telemetry)
//   - Expiry day itself (daysLeft clamps to 0) renders the today-variant
//     warning — post-expiry beyond that day is TrialGraceBanner's job,
//     covered by tests/trial-grace-banner.test.tsx
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

  it('renders the today-variant warning on the expiry day itself (daysLeft=0 closes the old dead zone)', async () => {
    // A trial that expired one second ago still sits inside its expiry day,
    // and the badge keeps treating plan=trial as trial until the next
    // VALIDATE_LICENSE refresh — exactly the moment where the old
    // `daysLeft > 0` gap left the user with NO touchpoint until the grace
    // banner took over hours later. Production forensics 2026-09-21: both
    // in-window installs were active on their expiry day and saw nothing.
    state.proLicenseInfo = { plan: 'trial', expiresAt: Date.now() - 1_000 };
    const { container } = render(<ProStatusBadge />);
    expect(container.querySelector('.trial-expiry-warning')).not.toBeNull();
    await waitFor(() => {
      expect(mockMaybeReport).toHaveBeenCalledWith(0);
    });
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

// ─────────────────────────────────────────────────────────────────────
// Integration: applyProFeatureVisibility → updateTopProStatus → badge
// ─────────────────────────────────────────────────────────────────────
// Production forensics (2026-09-21): the 7d window had 53 trial_expired
// but 0 trial_expiry_warning_shown, and 2 expired installs WERE active
// inside the warning window on v1.1.5. This suite pins the full chain
// (panel init → VALIDATE_LICENSE/GET_LICENSE_STATUS → proLicenseInfo →
// amber warning) so a future regression can't silently mute the trial's
// only pre-expiry touchpoint again.

vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
  renderColorSwatches: vi.fn(),
  syncCustomSizeInputsFromSettings: vi.fn(),
}));
vi.mock('../sidepanel/pro-features', () => ({
  detectSimilarImages: vi.fn(),
}));
vi.mock('../sidepanel/scan', () => ({
  fetchImages: vi.fn(),
  processImageExtras: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  checkNarrowMode: vi.fn(),
  showConfirmDialog: vi.fn(),
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
}));
vi.mock('../sidepanel/license-ui', () => ({
  bindLicenseModalEvents: vi.fn(),
  updateLicenseUI: vi.fn().mockResolvedValue(undefined),
}));

import {
  installChromeMock,
  uninstallChromeApiMock,
  type ChromeMock,
} from './_helpers/chromeApiMock';

describe('applyProFeatureVisibility → <ProStatusBadge> warning (full chain)', () => {
  let chromeMock: ChromeMock;
  let applyProFeatureVisibility: (typeof import('../sidepanel/settings'))['applyProFeatureVisibility'];

  beforeEach(async () => {
    chromeMock = installChromeMock();
    // Dynamic import (mirrors the ProStatusBadge pattern above): settings.ts
    // pulls shared/trial through its dependency graph, and the vi.mock
    // factories above reference consts that must be initialized first.
    ({ applyProFeatureVisibility } = await import('../sidepanel/settings'));
  });

  afterEach(() => {
    uninstallChromeApiMock();
  });

  it('panel-init chain fills proLicenseInfo and renders the amber warning', async () => {
    chromeMock.runtime.sendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'VALIDATE_LICENSE') return Promise.resolve({ isPro: true });
      if (msg.type === 'GET_LICENSE_STATUS') {
        return Promise.resolve({
          hasLicense: true,
          plan: 'trial',
          // One hour shy of two full days so trialDaysRemaining() ceils to 2.
          expiresAt: Date.now() + 2 * DAY_MS - 3_600_000,
        });
      }
      return Promise.resolve({});
    });
    state.isProUser = true; // already-Pro: skip newly-Pro side effects
    state.proLicenseInfo = null;

    const { container } = render(<ProStatusBadge />);
    // Before the license payload lands: no warning (badge has no plan info).
    expect(container.querySelector('.trial-expiry-warning')).toBeNull();

    await applyProFeatureVisibility();

    await waitFor(() => {
      expect(container.querySelector('.trial-expiry-warning')).not.toBeNull();
    });
    expect(state.proLicenseInfo).toEqual({
      plan: 'trial',
      expiresAt: expect.any(Number),
    });
    await waitFor(() => {
      expect(mockMaybeReport).toHaveBeenCalledWith(2);
    });
  });

  it('free user (isPro:false) gets proLicenseInfo cleared → upgrade CTA side, no warning', async () => {
    chromeMock.runtime.sendMessage.mockImplementation((msg: { type: string }) => {
      // VALIDATE_LICENSE says inactive; GET_LICENSE_STATUS won't be called.
      if (msg.type === 'VALIDATE_LICENSE') return Promise.resolve({ isPro: false });
      return Promise.resolve({});
    });
    state.isProUser = false;
    state.proLicenseInfo = { plan: 'trial', expiresAt: Date.now() + DAY_MS };

    const { container } = render(<ProStatusBadge />);

    await applyProFeatureVisibility();

    expect(state.proLicenseInfo).toBeNull();
    expect(container.querySelector('.trial-expiry-warning')).toBeNull();
    expect(container.querySelector('#btn-upgrade-pro')).toBeTruthy();
  });
});
