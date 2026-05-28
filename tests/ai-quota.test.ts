import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};
const chromeStorageMock = {
  local: {
    get: vi.fn(async (key: string) => {
      return { [key]: mockStorage[key] };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
    }),
  },
};
vi.stubGlobal('chrome', { storage: chromeStorageMock });

import {
  getLocalQuota,
  incrementLocalQuota,
  setLocalQuotaFromServer,
  getRemainingQuota,
} from '../shared/ai-quota';

function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLocalQuota', () => {
  it('returns zero count for fresh storage', async () => {
    const quota = await getLocalQuota();
    expect(quota.count).toBe(0);
    expect(quota.month).toBe(currentMonth());
  });

  it('returns stored quota when month matches', async () => {
    const month = currentMonth();
    mockStorage['aiQuota'] = { count: 42, month };
    const quota = await getLocalQuota();
    expect(quota.count).toBe(42);
    expect(quota.month).toBe(month);
  });

  it('resets count when month changes', async () => {
    mockStorage['aiQuota'] = { count: 99, month: '2020-01' };
    const quota = await getLocalQuota();
    expect(quota.count).toBe(0);
    expect(quota.month).toBe(currentMonth());
  });
});

describe('incrementLocalQuota', () => {
  it('increments from zero and returns remaining', async () => {
    const remaining = await incrementLocalQuota();
    expect(remaining).toBe(99);
    expect(mockStorage['aiQuota']).toEqual({ count: 1, month: currentMonth() });
  });

  it('increments existing count', async () => {
    mockStorage['aiQuota'] = { count: 50, month: currentMonth() };
    const remaining = await incrementLocalQuota();
    expect(remaining).toBe(49);
    expect(mockStorage['aiQuota']).toEqual({ count: 51, month: currentMonth() });
  });

  it('returns 0 when at limit', async () => {
    mockStorage['aiQuota'] = { count: 99, month: currentMonth() };
    const remaining = await incrementLocalQuota();
    expect(remaining).toBe(0);
  });
});

describe('setLocalQuotaFromServer', () => {
  it('sets quota based on remaining', async () => {
    await setLocalQuotaFromServer(75);
    expect(mockStorage['aiQuota']).toEqual({ count: 25, month: currentMonth() });
  });

  it('handles zero remaining', async () => {
    await setLocalQuotaFromServer(0);
    expect(mockStorage['aiQuota']).toEqual({ count: 100, month: currentMonth() });
  });
});

describe('getRemainingQuota', () => {
  it('returns 100 for fresh storage', async () => {
    const remaining = await getRemainingQuota();
    expect(remaining).toBe(100);
  });

  it('returns correct remaining', async () => {
    mockStorage['aiQuota'] = { count: 30, month: currentMonth() };
    const remaining = await getRemainingQuota();
    expect(remaining).toBe(70);
  });

  it('returns 0 when exceeded', async () => {
    mockStorage['aiQuota'] = { count: 150, month: currentMonth() };
    const remaining = await getRemainingQuota();
    expect(remaining).toBe(0);
  });
});
