// Tests for shared/license.ts — covers the activate / deactivate flow, the
// pro-user cache freshness window, and the offline grace-period fallback.
//
// We mock fetch + chrome.storage so the API endpoints never get touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock, uninstallChromeMock } from './_helpers/chromeStorageMock';
import {
  activateLicense,
  deactivateLicense,
  getLicenseInfo,
  getOrCreateInstanceId,
  isProUser,
} from '../shared/license';
import { LICENSE_CHECK_INTERVAL, LICENSE_GRACE_PERIOD, LICENSE_STATUS } from '../shared/constants';
import type { LicenseData } from '../shared/types';

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

let fetchCalls: FetchCall[];

/**
 * Install a fetch mock that responds based on URL pattern. Defaults: verify
 * → valid, activate → success. Tests can override per-case.
 */
function installFetchMock(
  responder: (call: FetchCall) => unknown = () => ({ valid: true, success: true, plan: 'yearly' })
): void {
  fetchCalls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call: FetchCall = { url, body };
    fetchCalls.push(call);
    const payload = responder(call);
    if (payload === undefined) {
      throw new Error('network down');
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response;
  });
}

beforeEach(() => {
  installChromeStorageMock();
  installFetchMock();
});
afterEach(() => {
  uninstallChromeMock();
  vi.restoreAllMocks();
});

describe('getOrCreateInstanceId', () => {
  it('creates and persists a stable id on first call', async () => {
    const a = await getOrCreateInstanceId();
    const b = await getOrCreateInstanceId();
    expect(a).toBe(b);
    expect(a).toMatch(/^inst_/);
  });
});

describe('activateLicense', () => {
  it('persists license data on successful verify + activate', async () => {
    const result = await activateLicense('aaaa-bbbb-cccc-dddd');
    expect(result.success).toBe(true);
    expect(result.plan).toBe('yearly');

    const info = await getLicenseInfo();
    expect(info.hasLicense).toBe(true);
    if (info.hasLicense) {
      expect(info.licenseKey).toBe('AAAA-BBBB-CCCC-DDDD'); // upper-cased
      expect(info.status).toBe('active');
    }
  });

  it('fails fast when verify says invalid (does not call activate)', async () => {
    installFetchMock((call) => {
      if (call.url.includes('/verify')) return { valid: false, error: 'bad key' };
      throw new Error('should not reach activate');
    });
    const result = await activateLicense('xxxx-yyyy-zzzz-wwww');
    expect(result.success).toBe(false);
    expect(result.error).toBe('bad key');
    // Only one fetch call (the verify)
    expect(fetchCalls).toHaveLength(1);
  });

  it('reports activation error when remote activate fails', async () => {
    installFetchMock((call) => {
      if (call.url.includes('/verify')) return { valid: true, plan: 'yearly' };
      if (call.url.endsWith('/activate'))
        return { success: false, error: 'instance limit reached' };
      return { success: false };
    });
    const result = await activateLicense('aaaa-bbbb-cccc-dddd');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/instance limit/);
  });
});

describe('deactivateLicense', () => {
  it('returns success even when there is nothing to deactivate', async () => {
    const result = await deactivateLicense();
    expect(result.success).toBe(true);
  });

  it('clears local license data after a remote deactivate', async () => {
    await activateLicense('aaaa-bbbb-cccc-dddd');
    expect((await getLicenseInfo()).hasLicense).toBe(true);
    await deactivateLicense();
    expect((await getLicenseInfo()).hasLicense).toBe(false);
  });
});

describe('isProUser', () => {
  it('returns inactive when no license is stored', async () => {
    const info = await isProUser();
    expect(info.isPro).toBe(false);
    expect(info.status).toBe(LICENSE_STATUS.INACTIVE);
  });

  it('uses the cached status if lastVerified is fresh', async () => {
    // Seed an active license verified 1 hour ago (well inside the 24h window)
    const data: LicenseData = {
      licenseKey: 'XXXX',
      status: LICENSE_STATUS.ACTIVE,
      plan: 'lifetime',
      expiresAt: null,
      lastVerified: Date.now() - 60 * 60 * 1000,
      instanceId: 'inst_test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({ licenseData: data });

    const info = await isProUser();
    expect(info.isPro).toBe(true);
    expect(info.plan).toBe('lifetime');
    // No fetch should have happened
    expect(fetchCalls).toHaveLength(0);
  });

  it('re-validates remotely when the cache is stale', async () => {
    const data: LicenseData = {
      licenseKey: 'XXXX',
      status: LICENSE_STATUS.ACTIVE,
      plan: 'monthly',
      expiresAt: null,
      lastVerified: Date.now() - LICENSE_CHECK_INTERVAL - 1000,
      instanceId: 'inst_test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({ licenseData: data });

    installFetchMock(() => ({ valid: true, plan: 'monthly' }));
    const info = await isProUser();
    expect(info.isPro).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('/verify');
  });

  it('marks the license expired when remote rejects it', async () => {
    const data: LicenseData = {
      licenseKey: 'XXXX',
      status: LICENSE_STATUS.ACTIVE,
      plan: 'monthly',
      expiresAt: null,
      lastVerified: Date.now() - LICENSE_CHECK_INTERVAL - 1000,
      instanceId: 'inst_test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({ licenseData: data });

    installFetchMock(() => ({ valid: false }));
    const info = await isProUser();
    expect(info.isPro).toBe(false);
    expect(info.status).toBe(LICENSE_STATUS.EXPIRED);
  });

  // ── Grace period ─────────────────────────────────────────────────────────
  // validateLicenseRemote() throws on transport failures so isProUser()'s
  // outer catch can engage the offline grace period. Server-reachable
  // "invalid" responses still mark the license expired.
  it('honors the offline grace period when the network is down', async () => {
    const data: LicenseData = {
      licenseKey: 'XXXX',
      status: LICENSE_STATUS.ACTIVE,
      plan: 'yearly',
      expiresAt: null,
      lastVerified: Date.now() - LICENSE_CHECK_INTERVAL - 1000,
      instanceId: 'inst_test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({ licenseData: data });

    // Network throws → license.ts catches and falls back to grace logic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    const info = await isProUser();
    expect(info.isPro).toBe(true); // grace period kept us alive
    expect(info.status).toBe(LICENSE_STATUS.ACTIVE);
  });

  it('falls back to non-Pro after the grace period expires while offline', async () => {
    const data: LicenseData = {
      licenseKey: 'XXXX',
      status: LICENSE_STATUS.ACTIVE,
      plan: 'yearly',
      expiresAt: null,
      lastVerified: Date.now() - LICENSE_GRACE_PERIOD - 1000,
      instanceId: 'inst_test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({ licenseData: data });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    const info = await isProUser();
    expect(info.isPro).toBe(false);
    expect(info.status).toBe(LICENSE_STATUS.EXPIRED);
  });

  it('does NOT extend the grace window during a long outage', async () => {
    // Seed: ACTIVE, last verified just inside the grace window
    const lastVerifiedAt = Date.now() - LICENSE_CHECK_INTERVAL - 1000;
    const data: LicenseData = {
      licenseKey: 'XXXX',
      status: LICENSE_STATUS.ACTIVE,
      plan: 'yearly',
      expiresAt: null,
      lastVerified: lastVerifiedAt,
      instanceId: 'inst_test',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (globalThis as any).chrome.storage.local.set({ licenseData: data });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    await isProUser();

    // Verify the grace fallback did NOT bump lastVerified — otherwise a
    // permanently-offline machine would extend Pro forever.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stored = await (globalThis as any).chrome.storage.local.get('licenseData');
    expect((stored.licenseData as LicenseData).lastVerified).toBe(lastVerifiedAt);
  });
});
