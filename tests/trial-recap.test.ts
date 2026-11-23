// Tests for shared/trial-recap.ts — the day-3/5/7 trial value recap.
//
// Scope:
//   - trialDayFromExpiry: pure milestone maths (day 1 … day 7, expired,
//     clock-skew, non-finite expiry)
//   - getDueTrialRecap: only live trials, only milestone days, never repeats
//     a milestone already shown
//   - markTrialRecapShown: appends, never duplicates
//
// Storage is a real in-memory Map behind a chrome stub (same shape as
// tests/trial.test.ts) so the claim/read cycle is exercised end to end.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLicenseData = vi.fn();

vi.mock('../shared/license', () => ({
  getLicenseData: mockGetLicenseData,
  saveLicenseData: vi.fn(),
  getOrCreateInstanceId: vi.fn().mockResolvedValue('inst_test'),
}));

const DAY = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7;

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

describe('trialDayFromExpiry', () => {
  const expiresAt = Date.UTC(2026, 8, 15); // arbitrary fixed point
  const startedAt = expiresAt - TRIAL_DAYS * DAY;

  it('counts from 1 on the start day', async () => {
    const { trialDayFromExpiry } = await import('../shared/trial-recap');
    expect(trialDayFromExpiry(expiresAt, startedAt)).toBe(1);
  });

  it('reports the milestone days exactly', async () => {
    const { trialDayFromExpiry } = await import('../shared/trial-recap');
    expect(trialDayFromExpiry(expiresAt, startedAt + 2 * DAY)).toBe(3);
    expect(trialDayFromExpiry(expiresAt, startedAt + 4 * DAY)).toBe(5);
    expect(trialDayFromExpiry(expiresAt, startedAt + 6 * DAY)).toBe(7);
  });

  it('the last millisecond of the trial is still day 7', async () => {
    const { trialDayFromExpiry } = await import('../shared/trial-recap');
    expect(trialDayFromExpiry(expiresAt, expiresAt - 1)).toBe(7);
  });

  it('returns null once the trial has expired', async () => {
    const { trialDayFromExpiry } = await import('../shared/trial-recap');
    expect(trialDayFromExpiry(expiresAt, expiresAt)).toBeNull();
    expect(trialDayFromExpiry(expiresAt, expiresAt + DAY)).toBeNull();
  });

  it('returns null when the local clock is before the computed start', async () => {
    const { trialDayFromExpiry } = await import('../shared/trial-recap');
    expect(trialDayFromExpiry(expiresAt, startedAt - 1)).toBeNull();
  });

  it('returns null for a non-finite expiry', async () => {
    const { trialDayFromExpiry } = await import('../shared/trial-recap');
    expect(trialDayFromExpiry(Number.NaN, startedAt)).toBeNull();
  });
});

describe('getDueTrialRecap', () => {
  it('returns null when there is no license', async () => {
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap()).toBeNull();
  });

  it('returns null for a paid plan even at the same day offset', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('monthly', now + 5 * DAY));
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap(now)).toBeNull();
  });

  it('returns null on a non-milestone day (day 2)', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now + 6 * DAY));
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap(now)).toBeNull();
  });

  it('returns the due milestone with days remaining on day 3', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now + 5 * DAY));
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap(now)).toEqual({ day: 3, daysRemaining: 5 });
  });

  it('does not repeat a milestone that was already shown', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now + 5 * DAY));
    storage.set('_trial_recap_days_shown', [3]);
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap(now)).toBeNull();
  });

  it('still fires day 5 after day 3 was shown', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now + 3 * DAY));
    storage.set('_trial_recap_days_shown', [3]);
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap(now)).toEqual({ day: 5, daysRemaining: 3 });
  });

  it('returns null once the trial has expired (grace banner owns that window)', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - DAY));
    const { getDueTrialRecap } = await import('../shared/trial-recap');
    expect(await getDueTrialRecap(now)).toBeNull();
  });
});

describe('markTrialRecapShown', () => {
  it('records the day and is idempotent', async () => {
    const { markTrialRecapShown } = await import('../shared/trial-recap');
    await markTrialRecapShown(3);
    await markTrialRecapShown(3);
    expect(storage.get('_trial_recap_days_shown')).toEqual([3]);
  });

  it('keeps previous milestones when a later one fires', async () => {
    storage.set('_trial_recap_days_shown', [3]);
    const { markTrialRecapShown } = await import('../shared/trial-recap');
    await markTrialRecapShown(5);
    expect(storage.get('_trial_recap_days_shown')).toEqual([3, 5]);
  });
});
