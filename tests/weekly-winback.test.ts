// Tests for shared/weekly-winback.ts — the capped weekly reminder that
// reaches trials which expired long after the one-shot ended notice window.
//
// Scope:
//   - weeklyWinbackFrom: pure window maths (starts after the ended-notice
//     window, 7-day spacing, 4-impression cap, clock-skew safety)
//   - getDueWeeklyWinback: only expired trial licenses, respects the stored
//     record, fails open when storage is unreadable
//   - markWeeklyWinbackShown: increments the counter, best-effort
//
// Storage is a real in-memory Map behind a chrome stub, same shape as
// tests/trial-ended-notice.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLicenseData = vi.fn();

vi.mock('../shared/license', () => ({
  getLicenseData: mockGetLicenseData,
  saveLicenseData: vi.fn(),
  getOrCreateInstanceId: vi.fn().mockResolvedValue('inst_test'),
}));

const DAY = 24 * 60 * 60 * 1000;

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

describe('weeklyWinbackFrom', () => {
  const expiresAt = Date.UTC(2026, 8, 15);

  it('stays silent throughout grace and the ended-notice window', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS } = await import('../shared/weekly-winback');
    expect(
      weeklyWinbackFrom(expiresAt, 0, null, expiresAt + WEEKLY_WINBACK_START_MS - 1)
    ).toBeNull();
  });

  it('fires the first reminder the moment the window opens', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS } = await import('../shared/weekly-winback');
    expect(weeklyWinbackFrom(expiresAt, 0, null, expiresAt + WEEKLY_WINBACK_START_MS)).toEqual({
      week: 1,
    });
  });

  it('does not repeat within seven days', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS, WEEKLY_WINBACK_INTERVAL_MS } =
      await import('../shared/weekly-winback');
    const shownAt = expiresAt + WEEKLY_WINBACK_START_MS;
    expect(
      weeklyWinbackFrom(expiresAt, 1, shownAt, shownAt + WEEKLY_WINBACK_INTERVAL_MS - 1)
    ).toBeNull();
  });

  it('advances the week number after the interval', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS, WEEKLY_WINBACK_INTERVAL_MS } =
      await import('../shared/weekly-winback');
    const shownAt = expiresAt + WEEKLY_WINBACK_START_MS;
    expect(weeklyWinbackFrom(expiresAt, 1, shownAt, shownAt + WEEKLY_WINBACK_INTERVAL_MS)).toEqual({
      week: 2,
    });
  });

  it('stops at the impression cap', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS, WEEKLY_WINBACK_MAX_IMPRESSIONS } =
      await import('../shared/weekly-winback');
    const shownAt = expiresAt + WEEKLY_WINBACK_START_MS;
    expect(
      weeklyWinbackFrom(expiresAt, WEEKLY_WINBACK_MAX_IMPRESSIONS, shownAt, shownAt + 30 * DAY)
    ).toBeNull();
  });

  it('ignores a clock that moved backwards instead of double-nudging', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS } = await import('../shared/weekly-winback');
    const now = expiresAt + WEEKLY_WINBACK_START_MS;
    expect(weeklyWinbackFrom(expiresAt, 1, now + 2 * DAY, now)).toBeNull();
  });

  it('returns null for a non-finite expiry', async () => {
    const { weeklyWinbackFrom, WEEKLY_WINBACK_START_MS } = await import('../shared/weekly-winback');
    expect(weeklyWinbackFrom(Number.NaN, 0, null, expiresAt + WEEKLY_WINBACK_START_MS)).toBeNull();
  });
});

describe('getDueWeeklyWinback', () => {
  it('returns null when there is no license', async () => {
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback()).toBeNull();
  });

  it('returns null for a paid plan', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('yearly', now - 60 * DAY));
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toBeNull();
  });

  it('returns null while the trial is still live', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now + 2 * DAY));
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toBeNull();
  });

  it('returns null during grace and the ended-notice window', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 10 * DAY));
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toBeNull();
  });

  it('reaches a trial that expired long before this shipped', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 90 * DAY));
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toEqual({ week: 1 });
  });

  it('stays silent until the interval has passed', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 90 * DAY));
    storage.set('_weekly_winback', { count: 1, lastShownAt: now - 6 * DAY });
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toBeNull();
  });

  it('advances to the next week after seven days', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 90 * DAY));
    storage.set('_weekly_winback', { count: 1, lastShownAt: now - 7 * DAY });
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toEqual({ week: 2 });
  });

  it('fails open when storage cannot be read', async () => {
    const now = Date.now();
    mockGetLicenseData.mockResolvedValue(licenseFor('trial', now - 90 * DAY));
    const chromeStub = (
      globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }
    ).chrome;
    chromeStub.storage.local.get = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const { getDueWeeklyWinback } = await import('../shared/weekly-winback');
    expect(await getDueWeeklyWinback(now)).toEqual({ week: 1 });
  });
});

describe('markWeeklyWinbackShown', () => {
  it('increments the counter and records the timestamp', async () => {
    const now = Date.now();
    const { markWeeklyWinbackShown } = await import('../shared/weekly-winback');

    await markWeeklyWinbackShown(now);
    expect(storage.get('_weekly_winback')).toEqual({ count: 1, lastShownAt: now });

    await markWeeklyWinbackShown(now + 1);
    expect(storage.get('_weekly_winback')).toEqual({ count: 2, lastShownAt: now + 1 });
  });

  it('never throws when storage cannot be written', async () => {
    const chromeStub = (
      globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }
    ).chrome;
    chromeStub.storage.local.set = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    const { markWeeklyWinbackShown } = await import('../shared/weekly-winback');
    await expect(markWeeklyWinbackShown()).resolves.toBeUndefined();
  });
});
