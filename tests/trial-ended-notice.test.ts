// Tests for shared/trial-ended-notice.ts — the one-shot "your Pro trial
// ended" notice that fires after the 3-day grace window has lapsed.
//
// Scope:
//   - trialEndedNoticeFromExpiry: pure window maths (never inside grace,
//     day count is whole days since expiry, 30-day tail, non-finite expiry)
//   - getDueTrialEndedNotice: only expired trial licenses, never repeats,
//     never resurrects a long-dead expiry
//   - markTrialEndedNoticeShown: records one timestamp, best-effort
//
// Storage is a real in-memory Map behind a chrome stub, same shape as
// tests/trial-recap.test.ts, so the read/claim cycle is exercised end to end.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLicenseData = vi.fn();

vi.mock('../shared/license', () => ({
  getLicenseData: mockGetLicenseData,
  saveLicenseData: vi.fn(),
  getOrCreateInstanceId: vi.fn().mockResolvedValue('inst_test'),
}));

const DAY = 24 * 60 * 60 * 1000;
const GRACE = 3 * DAY;

let storage: Map<string, unknown>;

function installChromeStorage(): void {
  storage = new Map();
  const chromeStub = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          return storage.has(key) ? { [key]: storage.get(key) } : {};
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
}

function licenseFor(plan: string, expiresAt: number) {
  return { licenseKey: 'K', plan, valid: true, expiresAt, checkedAt: Date.now() };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  installChromeStorage();
  mockGetLicenseData.mockResolvedValue(null);
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('trialEndedNoticeFromExpiry', () => {
  const expiresAt = Date.UTC(2026, 8, 15); // arbitrary fixed point

  it('stays silent on the expiry instant (the grace banner owns grace)', async () => {
    const { trialEndedNoticeFromExpiry } = await import('../shared/trial-ended-notice');
    expect(trialEndedNoticeFromExpiry(expiresAt, expiresAt)).toBeNull();
  });

  it('stays silent on the last millisecond of grace', async () => {
    const { trialEndedNoticeFromExpiry } = await import('../shared/trial-ended-notice');
    expect(trialEndedNoticeFromExpiry(expiresAt, expiresAt + GRACE - 1)).toBeNull();
  });

  it('reports 3 whole days the instant grace ends', async () => {
    const { trialEndedNoticeFromExpiry } = await import('../shared/trial-ended-notice');
    expect(trialEndedNoticeFromExpiry(expiresAt, expiresAt + GRACE)).toBe(3);
  });

  it('counts whole days since expiry, not since grace', async () => {
    const { trialEndedNoticeFromExpiry } = await import('../shared/trial-ended-notice');
    expect(trialEndedNoticeFromExpiry(expiresAt, expiresAt + GRACE + 2 * DAY)).toBe(5);
  });

  it('still fires on the last day of the 30-day window', async () => {
    const { trialEndedNoticeFromExpiry, TRIAL_ENDED_NOTICE_WINDOW_MS } =
      await import('../shared/trial-ended-notice');
    const lastMs = expiresAt + GRACE + TRIAL_ENDED_NOTICE_WINDOW_MS - 1;
    expect(trialEndedNoticeFromExpiry(expiresAt, lastMs)).toBe(32);
  });

  it('returns null once the 30-day window has passed', async () => {
    const { trialEndedNoticeFromExpiry, TRIAL_ENDED_NOTICE_WINDOW_MS } =
      await import('../shared/trial-ended-notice');
    const pastMs = expiresAt + GRACE + TRIAL_ENDED_NOTICE_WINDOW_MS + 1;
    expect(trialEndedNoticeFromExpiry(expiresAt, pastMs)).toBeNull();
  });

  it('returns null when the local clock is before expiry', async () => {
    const { trialEndedNoticeFromExpiry } = await import('../shared/trial-ended-notice');
    expect(trialEndedNoticeFromExpiry(expiresAt, expiresAt - DAY)).toBeNull();
  });

  it('returns null for a non-finite expiry', async () => {
    const { trialEndedNoticeFromExpiry } = await import('../shared/trial-ended-notice');
    expect(trialEndedNoticeFromExpiry(Number.NaN, expiresAt + GRACE)).toBeNull();
  });
});

describe('getDueTrialEndedNotice', () => {
  it('returns null when there is no license', async () => {
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice()).toBeNull();
  });

  it('returns null for a paid plan', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('yearly', now - 10 * DAY));
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toBeNull();
  });

  it('returns null while the trial is still live', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now + 2 * DAY));
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toBeNull();
  });

  it('returns null during the grace window', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 1 * DAY));
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toBeNull();
  });

  it('returns the day count once grace has lapsed', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 5 * DAY));
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toEqual({ daysSinceExpiry: 5 });
  });

  it('does not fire twice', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 5 * DAY));
    storage.set('_trial_ended_notice_shown', now - 4 * DAY);
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toBeNull();
  });

  it('does not resurrect a trial that expired long before this shipped', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 90 * DAY));
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toBeNull();
  });

  it('fails open when storage cannot be read', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 5 * DAY));
    storage.clear();
    const chromeStub = (
      globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }
    ).chrome;
    chromeStub.storage.local.get = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const { getDueTrialEndedNotice } = await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toEqual({ daysSinceExpiry: 5 });
  });
});

describe('markTrialEndedNoticeShown', () => {
  it('records a timestamp that suppresses the notice from then on', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 5 * DAY));

    const { getDueTrialEndedNotice, markTrialEndedNoticeShown } =
      await import('../shared/trial-ended-notice');
    expect(await getDueTrialEndedNotice(now)).toEqual({ daysSinceExpiry: 5 });

    await markTrialEndedNoticeShown();
    expect(typeof storage.get('_trial_ended_notice_shown')).toBe('number');
    expect(await getDueTrialEndedNotice(now)).toBeNull();
  });

  it('never throws when storage cannot be written', async () => {
    const chromeStub = (
      globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }
    ).chrome;
    chromeStub.storage.local.set = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    const { markTrialEndedNoticeShown } = await import('../shared/trial-ended-notice');
    await expect(markTrialEndedNoticeShown()).resolves.toBeUndefined();
  });
});
