// Tests for shared/trial.ts — the 7-day Pro free trial module (Sprint 2.3).
//
// Scope:
//   - isTrialEligible: 4 cases (no sentinel + no license → true / sentinel
//     set → false / sentinel missing but plan='trial' → false / plan='lifetime'
//     → false)
//   - startTrial: happy path + ineligible + 409 conflict + non-2xx + network
//     throw + server returned success:false + sentinel persists after success
//   - isTrialActive: 4 cases (no license / non-trial / expired / live)
//   - getTrialState: returns null for non-trial / returns snapshot for live
//   - reportTrialExpiryIfNeeded: idempotent — fires once, second call no-op
//
// CRITICAL: trial.ts depends on chrome.storage + fetch + saveLicenseData
// + getLicenseData + getOrCreateInstanceId. Each is mocked; the real
// license.ts saveLicenseData/getLicenseData wrap chrome.storage so we
// stub at the chrome level for end-to-end realism in a few tests, and
// at the license module level when we want surgical control.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────
//
// We mock telemetry and license. trial.ts dynamically reads
// LICENSE_API_URL from constants — that one is left real (it's just a
// string), so the fetch URL matches what production would hit.

const mockTrack = vi.fn();
const mockGetLicenseData = vi.fn();
const mockSaveLicenseData = vi.fn();
const mockGetOrCreateInstanceId = vi.fn();

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
  setEnvelopeMeta: vi.fn(),
  flushNow: vi.fn(),
}));

vi.mock('../shared/license', () => ({
  getLicenseData: mockGetLicenseData,
  saveLicenseData: mockSaveLicenseData,
  getOrCreateInstanceId: mockGetOrCreateInstanceId,
}));

// chrome.storage stub — backed by an in-memory Map per test for realism
// and to allow assertions on what was set.
let storage: Map<string, unknown>;
let chromeStub: {
  storage: { local: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
};

function installChromeStorage(): void {
  storage = new Map();
  chromeStub = {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          if (typeof key === 'string') {
            return storage.has(key) ? { [key]: storage.get(key) } : {};
          }
          const out: Record<string, unknown> = {};
          for (const k of key) if (storage.has(k)) out[k] = storage.get(k);
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  installChromeStorage();
  mockGetOrCreateInstanceId.mockResolvedValue('inst_abc123');
  mockSaveLicenseData.mockResolvedValue(true);
  mockGetLicenseData.mockResolvedValue(null);

  fetchMock = vi.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
});

// ────────────────────────────────────────────────────────────────────────────
// isTrialEligible
// ────────────────────────────────────────────────────────────────────────────

describe('isTrialEligible', () => {
  it('returns true when no sentinel and no license', async () => {
    const { isTrialEligible } = await import('../shared/trial');
    expect(await isTrialEligible()).toBe(true);
  });

  it('returns false when local sentinel is set (regardless of license state)', async () => {
    storage.set('_trial_redeemed_at', Date.now());
    const { isTrialEligible } = await import('../shared/trial');
    // Pin: sentinel takes precedence over license check. A regression
    // letting users re-trial after deactivating their trial license
    // would leak unlimited 7-day Pro for free.
    expect(await isTrialEligible()).toBe(false);
  });

  it('returns false when license plan is "trial" (sentinel cleared but license still active)', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'XXXX',
      plan: 'trial',
      expiresAt: Date.now() + 1000,
      status: 'active',
      lastVerified: Date.now(),
      instanceId: 'inst_abc123',
    });
    const { isTrialEligible } = await import('../shared/trial');
    expect(await isTrialEligible()).toBe(false);
  });

  it('returns false when license plan is "lifetime" (already a paid forever user)', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'XXXX',
      plan: 'lifetime',
      expiresAt: null,
      status: 'active',
      lastVerified: Date.now(),
      instanceId: 'inst_abc123',
    });
    const { isTrialEligible } = await import('../shared/trial');
    // Pin: lifetime users get nothing from a 7-day trial; offering
    // one would be confusing UX. Monthly/yearly users CAN technically
    // re-trial here (they're not blocked) — that's intentional, since
    // a churned monthly user might want to retry the trial pitch.
    expect(await isTrialEligible()).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// startTrial
// ────────────────────────────────────────────────────────────────────────────

describe('startTrial', () => {
  it('happy path: server 200 → saves license + sentinel + returns success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        licenseKey: 'TRIAL-AAAA-BBBB-CCCC',
        plan: 'trial',
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }),
    });

    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    expect(result.success).toBe(true);
    expect(result.plan).toBe('trial');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    // saveLicenseData was called with a license_key + plan='trial' shape.
    expect(mockSaveLicenseData).toHaveBeenCalledTimes(1);
    expect(mockSaveLicenseData).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseKey: 'TRIAL-AAAA-BBBB-CCCC',
        plan: 'trial',
        status: 'active',
        instanceId: 'inst_abc123',
      })
    );

    // Sentinel must be persisted so future startTrial calls short-circuit.
    expect(storage.has('_trial_redeemed_at')).toBe(true);
  });

  it('ineligible (sentinel set) → returns error WITHOUT touching network or license', async () => {
    storage.set('_trial_redeemed_at', Date.now() - 86400_000);
    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already used your free trial/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSaveLicenseData).not.toHaveBeenCalled();
  });

  it('server 409 conflict → persists sentinel + returns "already used" error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ success: false, error: 'already redeemed' }),
    });
    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already used your free trial/i);
    // Pin: the sentinel persistence on 409 is what prevents future
    // network round-trips. Without it, every modal open would hit
    // /api/trial/start and waste both the user's bandwidth and our
    // serverless budget.
    expect(storage.has('_trial_redeemed_at')).toBe(true);
    expect(mockSaveLicenseData).not.toHaveBeenCalled();
  });

  it('server 500 → returns error with status code in message; sentinel NOT set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
    // Pin: a transient 5xx must NOT lock the user out. They should
    // be able to retry once the server recovers.
    expect(storage.has('_trial_redeemed_at')).toBe(false);
  });

  it('fetch throws (offline) → returns network error; sentinel NOT set', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network error/i);
    expect(storage.has('_trial_redeemed_at')).toBe(false);
    expect(mockSaveLicenseData).not.toHaveBeenCalled();
  });

  it('server returns success:false → propagates server error verbatim', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: false, error: 'Service paused' }),
    });
    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Service paused');
    expect(mockSaveLicenseData).not.toHaveBeenCalled();
  });

  it('server returns success:true but no licenseKey → treats as failure (no half-state)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true /* missing licenseKey */ }),
    });
    const { startTrial } = await import('../shared/trial');
    const result = await startTrial();

    // Pin: defensive against a malformed server response. Without
    // this guard we'd save a license with `licenseKey: undefined`
    // which would later fail validateLicenseRemote and downgrade
    // the user mid-session.
    expect(result.success).toBe(false);
    expect(mockSaveLicenseData).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isTrialActive
// ────────────────────────────────────────────────────────────────────────────

describe('isTrialActive', () => {
  it('returns false when no license', async () => {
    const { isTrialActive } = await import('../shared/trial');
    expect(await isTrialActive()).toBe(false);
  });

  it('returns false when license plan is not "trial"', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'monthly',
      expiresAt: Date.now() + 1000,
    });
    const { isTrialActive } = await import('../shared/trial');
    expect(await isTrialActive()).toBe(false);
  });

  it('returns false when trial expired', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt: Date.now() - 1000,
    });
    const { isTrialActive } = await import('../shared/trial');
    expect(await isTrialActive()).toBe(false);
  });

  it('returns true when trial expiresAt is in the future', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt: Date.now() + 5 * 86400_000,
    });
    const { isTrialActive } = await import('../shared/trial');
    expect(await isTrialActive()).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getTrialState
// ────────────────────────────────────────────────────────────────────────────

describe('getTrialState', () => {
  it('returns null for non-trial license', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'yearly',
      expiresAt: Date.now() + 1000,
    });
    const { getTrialState } = await import('../shared/trial');
    expect(await getTrialState()).toBeNull();
  });

  it('returns snapshot with msRemaining for live trial', async () => {
    const expiresAt = Date.now() + 3 * 86400_000;
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt,
    });
    const { getTrialState } = await import('../shared/trial');
    const snap = await getTrialState();
    expect(snap).not.toBeNull();
    expect(snap!.active).toBe(true);
    expect(snap!.expiresAt).toBe(expiresAt);
    // Allow a 1s slop for test-runtime drift between Date.now() in
    // production code and Date.now() at assert time.
    expect(snap!.msRemaining).toBeGreaterThan(3 * 86400_000 - 1000);
    expect(snap!.msRemaining).toBeLessThanOrEqual(3 * 86400_000);
  });

  it('returns snapshot with msRemaining=0 + active=false for expired trial', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt: Date.now() - 1000,
    });
    const { getTrialState } = await import('../shared/trial');
    const snap = await getTrialState();
    // Pin: msRemaining is clamped to 0 by Math.max so the UI can render
    // "0 days remaining" instead of negative numbers.
    expect(snap!.msRemaining).toBe(0);
    expect(snap!.active).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// reportTrialExpiryIfNeeded
// ────────────────────────────────────────────────────────────────────────────

describe('reportTrialExpiryIfNeeded', () => {
  it('non-trial license → returns false; no telemetry', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'monthly',
      expiresAt: Date.now() - 1000,
    });
    const { reportTrialExpiryIfNeeded } = await import('../shared/trial');
    expect(await reportTrialExpiryIfNeeded()).toBe(false);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('trial still in window → returns false; no telemetry', async () => {
    mockGetLicenseData.mockResolvedValueOnce({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt: Date.now() + 1000,
    });
    const { reportTrialExpiryIfNeeded } = await import('../shared/trial');
    expect(await reportTrialExpiryIfNeeded()).toBe(false);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('trial expired + first call → fires TRIAL_EXPIRED + sets sentinel + returns true', async () => {
    mockGetLicenseData.mockResolvedValue({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt: Date.now() - 1000,
    });
    const { reportTrialExpiryIfNeeded } = await import('../shared/trial');
    expect(await reportTrialExpiryIfNeeded()).toBe(true);
    expect(mockTrack).toHaveBeenCalledWith('trial_expired');
    expect(storage.has('_trial_expired_reported')).toBe(true);
  });

  it('trial expired + second call → no-op (idempotency guard)', async () => {
    mockGetLicenseData.mockResolvedValue({
      licenseKey: 'X',
      plan: 'trial',
      expiresAt: Date.now() - 1000,
    });
    storage.set('_trial_expired_reported', Date.now() - 1000);
    const { reportTrialExpiryIfNeeded } = await import('../shared/trial');
    // Pin: the sentinel guarantees TRIAL_EXPIRED fires AT MOST ONCE per
    // redemption. Without it, every periodic background check would
    // re-emit the event and skew funnel conversion math.
    expect(await reportTrialExpiryIfNeeded()).toBe(false);
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
