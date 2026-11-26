// Tests for background/trial-badge.ts — the toolbar badge that reaches the
// trial cohort who never reopen the side panel.
//
// Baseline this locks in (2026-11-26): 992 trial_expired events, but only 3
// side-panel expiry notices were ever shown. The badge is the only zero-cost
// channel that does not require the panel to be open.
//
// Two contracts matter and both are asserted here:
//   1. The badge lights exactly once per install — repeated service-worker
//      wakes must not re-light what the panel already cleared.
//   2. It never touches the badge when nothing has expired. The install nudge
//      ("1", set in background/index.ts onInstalled) shares the same global
//      badge slot and must not be stomped by a no-op refresh.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetLicenseData, mockTrack } = vi.hoisted(() => ({
  mockGetLicenseData: vi.fn(),
  mockTrack: vi.fn(),
}));

vi.mock('../shared/license', () => ({
  getLicenseData: mockGetLicenseData,
}));

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
}));

import {
  decideTrialBadge,
  refreshTrialBadge,
  TRIAL_BADGE_COLOR,
  TRIAL_BADGE_TEXT,
} from '../background/trial-badge';

// ── chrome stub ───────────────────────────────────────────────────────────

let store: Map<string, unknown>;
let setBadgeText: ReturnType<typeof vi.fn>;
let setBadgeBackgroundColor: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = new Map();
  setBadgeText = vi.fn(() => Promise.resolve());
  setBadgeBackgroundColor = vi.fn(() => Promise.resolve());
  mockGetLicenseData.mockReset();
  mockTrack.mockReset();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(patch)) store.set(k, v);
        }),
        remove: vi.fn(async (key: string) => {
          store.delete(key);
        }),
      },
    },
    action: { setBadgeText, setBadgeBackgroundColor },
  };
});

const DAY = 24 * 60 * 60 * 1000;

function license(plan: string, expiresAt: number) {
  return { licenseKey: 'key', status: 'active', plan, expiresAt, lastVerified: Date.now() };
}

// ── decideTrialBadge ──────────────────────────────────────────────────────

describe('decideTrialBadge', () => {
  it('lights the badge for an expired trial that has never been lit', () => {
    expect(decideTrialBadge({ trialExpired: true, hasPaidLicense: false, alreadyLit: false })).toBe(
      'set'
    );
  });

  it('does not re-light a badge the panel already cleared', () => {
    expect(decideTrialBadge({ trialExpired: true, hasPaidLicense: false, alreadyLit: true })).toBe(
      'noop'
    );
  });

  it('leaves the badge alone while the trial is still running', () => {
    // The install nudge owns the slot here — clearing it would delete the
    // only install-time surface we have.
    expect(
      decideTrialBadge({ trialExpired: false, hasPaidLicense: false, alreadyLit: false })
    ).toBe('noop');
  });

  it('clears a lit badge once a paid license shows up', () => {
    expect(decideTrialBadge({ trialExpired: true, hasPaidLicense: true, alreadyLit: true })).toBe(
      'clear'
    );
  });

  it('does nothing for a paid user who never saw the badge', () => {
    expect(decideTrialBadge({ trialExpired: false, hasPaidLicense: true, alreadyLit: false })).toBe(
      'noop'
    );
  });
});

// ── refreshTrialBadge ─────────────────────────────────────────────────────

describe('refreshTrialBadge', () => {
  it('sets the badge, records the sentinel, and reports reach', async () => {
    // Pin `now`: daysSinceExpiry is Math.ceil(elapsed / DAY), so letting the
    // test clock drift even 1 ms past the boundary flips 2 to 3.
    const expiresAt = Date.now() - 2 * DAY;
    mockGetLicenseData.mockResolvedValue(license('trial', expiresAt));

    await expect(refreshTrialBadge(expiresAt + 2 * DAY)).resolves.toBe('set');

    expect(setBadgeText).toHaveBeenCalledWith({ text: TRIAL_BADGE_TEXT });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: TRIAL_BADGE_COLOR });
    expect(store.get('_trial_badge_shown_at')).toEqual(expect.any(Number));
    expect(mockTrack).toHaveBeenCalledWith('trial_badge_shown', {
      daysSinceExpiry: 2,
    });
  });

  it('is idempotent across service-worker wakes', async () => {
    mockGetLicenseData.mockResolvedValue(license('trial', Date.now() - DAY));

    await refreshTrialBadge();
    setBadgeText.mockClear();
    await expect(refreshTrialBadge()).resolves.toBe('noop');

    expect(setBadgeText).not.toHaveBeenCalled();
  });

  it('never clears the badge for an active trial', async () => {
    mockGetLicenseData.mockResolvedValue(license('trial', Date.now() + 3 * DAY));

    await expect(refreshTrialBadge()).resolves.toBe('noop');
    expect(setBadgeText).not.toHaveBeenCalled();
  });

  it('clears a lit badge after the buyer upgrades to lifetime', async () => {
    mockGetLicenseData.mockResolvedValue(license('trial', Date.now() - DAY));
    await refreshTrialBadge();

    setBadgeText.mockClear();
    mockGetLicenseData.mockResolvedValue(license('lifetime', 0));

    await expect(refreshTrialBadge()).resolves.toBe('clear');
    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('stays quiet when no license exists at all', async () => {
    mockGetLicenseData.mockResolvedValue(null);

    await expect(refreshTrialBadge()).resolves.toBe('noop');
    expect(setBadgeText).not.toHaveBeenCalled();
  });
});
