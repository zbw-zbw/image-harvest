// Unit tests for shared/referral.ts — the Share-to-Earn module.
//
// Previously 0% covered. What we pin:
//   - Referral link format (INVITE_PAGE_URL + url-encoded instanceId) —
//     the landing page parses ?ref=, so a format regression silently
//     kills the whole referral loop.
//   - Self-referral guard in claimReferralBonus (no API call at all).
//   - Network failure paths NEVER throw — first-open flow calls these
//     fire-and-forget; an unhandled rejection there would break init.
//   - Telemetry contract: copied / shared / claimed events fire with the
//     documented props (the funnel dashboards group by them).
//   - Fingerprint: 64-char lowercase hex (SHA-256), deterministic, and
//     sensitive to its inputs — the backend matches on exact equality
//     with the landing page's hash.
//
// Mocks: '../shared/license' (instanceId) and '../shared/telemetry'
// (track) per repo convention; navigator / screen / chrome / fetch are
// stubbed as globals because this file runs in the node environment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/license', () => ({
  getOrCreateInstanceId: vi.fn(),
}));
vi.mock('../shared/telemetry', () => ({
  track: vi.fn(),
}));

import {
  claimReferralBonus,
  copyReferralLink,
  generateFingerprint,
  getReferralStatus,
  incrementReferralCount,
  matchReferral,
  shareReferralLink,
} from '../shared/referral';
import { INVITE_PAGE_URL, PRICING_PAGE_URL } from '../shared/constants';
import { getOrCreateInstanceId } from '../shared/license';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';

const mockInstanceId = vi.mocked(getOrCreateInstanceId);
const mockTrack = vi.mocked(track);

const API_V1_BASE = `${PRICING_PAGE_URL.replace(/\/pricing$/, '')}/api/v1`;

// ── Global stubs ───────────────────────────────────────────────────────────

const clipboardWrite = vi.fn<(text: string) => Promise<void>>();
const storageGet = vi.fn();
const storageSet = vi.fn();
const fetchMock = vi.fn();

function stubNavigator(extra: Record<string, unknown> = {}): void {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: clipboardWrite },
    userAgent: 'TestUA/1.0',
    language: 'en-US',
    hardwareConcurrency: 8,
    platform: 'TestOS',
    ...extra,
  });
}

beforeEach(() => {
  mockInstanceId.mockResolvedValue('inst_me');
  clipboardWrite.mockResolvedValue(undefined);
  storageGet.mockResolvedValue({});
  storageSet.mockResolvedValue(undefined);
  fetchMock.mockReset();
  stubNavigator();
  vi.stubGlobal('screen', { width: 1920, height: 1080, colorDepth: 24 });
  vi.stubGlobal('chrome', { storage: { local: { get: storageGet, set: storageSet } } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── getReferralStatus ──────────────────────────────────────────────────────

describe('getReferralStatus', () => {
  it('builds the invite link from INVITE_PAGE_URL + url-encoded instanceId', async () => {
    mockInstanceId.mockResolvedValue('inst/with special+chars');
    const status = await getReferralStatus();
    expect(status.referralLink).toBe(
      `${INVITE_PAGE_URL}?ref=${encodeURIComponent('inst/with special+chars')}`
    );
  });

  it('reads the claimed count from storage and derives bonus days (×3)', async () => {
    storageGet.mockResolvedValue({ _referral_claimed_count: 4 });
    const status = await getReferralStatus();
    expect(status.claimedCount).toBe(4);
    expect(status.bonusDaysEarned).toBe(12);
  });

  it('falls back to zero when storage is unavailable', async () => {
    storageGet.mockRejectedValue(new Error('storage down'));
    const status = await getReferralStatus();
    expect(status.claimedCount).toBe(0);
    expect(status.bonusDaysEarned).toBe(0);
  });
});

// ── copyReferralLink / shareReferralLink ──────────────────────────────────

describe('copyReferralLink', () => {
  it('writes the link to the clipboard, tracks the event, returns the link', async () => {
    const link = await copyReferralLink();
    expect(link).toBe(`${INVITE_PAGE_URL}?ref=inst_me`);
    expect(clipboardWrite).toHaveBeenCalledWith(link);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.REFERRAL_LINK_COPIED);
  });
});

describe('shareReferralLink', () => {
  it('uses the Web Share API when available and tracks method=web_share', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    expect(await shareReferralLink()).toBe(true);
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${INVITE_PAGE_URL}?ref=inst_me` })
    );
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.REFERRAL_LINK_SHARED, { method: 'web_share' });
  });

  it('falls back to clipboard copy when the user cancels the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new Error('AbortError'));
    stubNavigator({ share, clipboard: { writeText: clipboardWrite } });
    expect(await shareReferralLink()).toBe(true);
    expect(clipboardWrite).toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.REFERRAL_LINK_COPIED);
  });

  it('falls back to clipboard copy when navigator.share does not exist', async () => {
    expect(await shareReferralLink()).toBe(true);
    expect(clipboardWrite).toHaveBeenCalled();
  });
});

// ── claimReferralBonus ─────────────────────────────────────────────────────

describe('claimReferralBonus', () => {
  it('rejects self-referral WITHOUT hitting the API', async () => {
    expect(await claimReferralBonus('inst_me')).toEqual({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs both instance ids to the versioned claim endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, bonusDays: 3 }),
    });
    const result = await claimReferralBonus('inst_referrer');
    expect(result).toEqual({ success: true, bonusDays: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_V1_BASE}/referral/claim`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          referrerInstanceId: 'inst_referrer',
          newUserInstanceId: 'inst_me',
        }),
      })
    );
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.REFERRAL_CLAIMED, { bonusDays: 3 });
  });

  it('defaults the tracked bonusDays to 3 when the server omits it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await claimReferralBonus('inst_referrer');
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.REFERRAL_CLAIMED, { bonusDays: 3 });
  });

  it('returns success:false on a non-OK response without tracking', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await claimReferralBonus('inst_referrer')).toEqual({ success: false });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('never throws when the network is down', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await claimReferralBonus('inst_referrer')).toEqual({ success: false });
  });
});

// ── incrementReferralCount ─────────────────────────────────────────────────

describe('incrementReferralCount', () => {
  it('increments from an empty storage slot to 1', async () => {
    await incrementReferralCount();
    expect(storageSet).toHaveBeenCalledWith({ _referral_claimed_count: 1 });
  });

  it('increments an existing count', async () => {
    storageGet.mockResolvedValue({ _referral_claimed_count: 4 });
    await incrementReferralCount();
    expect(storageSet).toHaveBeenCalledWith({ _referral_claimed_count: 5 });
  });

  it('swallows storage failures (non-fatal)', async () => {
    storageGet.mockRejectedValue(new Error('storage down'));
    await expect(incrementReferralCount()).resolves.toBeUndefined();
  });
});

// ── generateFingerprint ────────────────────────────────────────────────────

describe('generateFingerprint', () => {
  it('produces a 64-char lowercase hex SHA-256 digest', async () => {
    const fp = await generateFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical environment inputs', async () => {
    expect(await generateFingerprint()).toBe(await generateFingerprint());
  });

  it('changes when an input dimension changes (backend matches on equality)', async () => {
    const before = await generateFingerprint();
    vi.stubGlobal('screen', { width: 800, height: 600, colorDepth: 24 });
    expect(await generateFingerprint()).not.toBe(before);
  });
});

// ── matchReferral ──────────────────────────────────────────────────────────

describe('matchReferral', () => {
  it('POSTs instanceId + fingerprint and returns the granted bonus days', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, bonusDays: 3 }),
    });
    const result = await matchReferral();
    expect(result).toEqual({ bonusDays: 3 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_V1_BASE}/referral/match`);
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.newUserInstanceId).toBe('inst_me');
    expect(body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.REFERRAL_CLAIMED, { bonusDays: 3 });
  });

  it('returns null when no pending referral matches (success:false)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
    expect(await matchReferral()).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('returns null on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await matchReferral()).toBeNull();
  });

  it('never throws when the network is down (first-open flow safety)', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await matchReferral()).toBeNull();
  });
});
