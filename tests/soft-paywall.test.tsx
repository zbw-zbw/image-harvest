// Tests for shared/paywall-state.ts + the paywall notice inside
// sidepanel/components/NoticeStrip.tsx (v1.2: NoticeStrip consolidated the
// legacy ReferralBanner / SoftPaywallBanner / TrialGraceBanner trio).
//
// Two surfaces:
//   1. State module (shared/paywall-state.ts) — pure-function level: counter
//      semantics, threshold gating, cooldown after dismissal, resolved
//      sticky terminal state. We use the SDK's __test hooks to swap the
//      storage adapter and the clock so we can drive 30-day windows
//      deterministically.
//   2. Component (NoticeStrip.tsx) — render-level with the REAL paywall
//      state module: referral fallback when below threshold, paywall notice
//      once threshold met, ✕ dismiss persists the cooldown state, try CTA
//      opens the upgrade modal without marking resolved.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import {
  __test as paywallTest,
  SOFT_PAYWALL_COOLDOWN_MS,
  SOFT_PAYWALL_THRESHOLD,
  getState,
  markDismissed,
  markResolved,
  markShown,
  recordDownloads,
  shouldShowBanner,
} from '../shared/paywall-state';
import { NoticeStrip } from '../sidepanel/components/NoticeStrip';
import { state } from '../sidepanel/state';
import { __test as telemetryTest } from '../shared/telemetry';

// ── Test fixtures ─────────────────────────────────────────────────────────

interface MemStorage {
  store: Map<string, unknown>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

function makeMemStorage(): MemStorage {
  const store = new Map<string, unknown>();
  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      // Round-trip through JSON to mirror chrome.storage.local serialization.
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

// Telemetry side effects in the component fire-and-forget; we don't want
// network calls during the component tests, so install a no-op fetch and
// drain after each test.
function installTelemetryNoOp(): void {
  telemetryTest.reset();
  const noopFetch: typeof fetch = (async () =>
    new Response('{"ok":true}', { status: 200 })) as typeof fetch;
  telemetryTest.setFetch(noopFetch);
  // Storage adapter for the telemetry SDK — separate Map so the
  // component test isolation matches production (paywall + telemetry use
  // different storage keys, but same chrome.storage.local in real life).
  const mem = makeMemStorage();
  telemetryTest.setStorage({
    get: async <T = unknown,>(k: string) => (await mem.get(k)) as T | undefined,
    set: (k, v) => mem.set(k, v),
    remove: async (k) => {
      mem.store.delete(k);
    },
  });
}

let now = 1_700_000_000_000;
let mem: MemStorage;

beforeEach(() => {
  paywallTest.reset();
  mem = makeMemStorage();
  paywallTest.setStorage(mem);
  now = 1_700_000_000_000;
  paywallTest.setNow(() => now);
  installTelemetryNoOp();
  state.isProUser = false;
  state.inTrialGracePeriod = false;
  localStorage.clear();
});

afterEach(async () => {
  await telemetryTest.waitForIdle();
  cleanup();
});

// ════════════════════════════════════════════════════════════════════════════
// shared/paywall-state.ts
// ════════════════════════════════════════════════════════════════════════════

describe('paywall-state: counter', () => {
  test('starts at zero downloads', async () => {
    const s = await getState();
    expect(s.downloadCount).toBe(0);
    expect(s.shownCount).toBe(0);
    expect(s.resolved).toBe(false);
  });

  test('recordDownloads accumulates', async () => {
    await recordDownloads(3);
    await recordDownloads(2);
    expect((await getState()).downloadCount).toBe(5);
  });

  test('recordDownloads ignores non-positive / non-finite counts', async () => {
    await recordDownloads(0);
    await recordDownloads(-5);
    await recordDownloads(Number.NaN);
    await recordDownloads(Number.POSITIVE_INFINITY);
    expect((await getState()).downloadCount).toBe(0);
  });

  test('recordDownloads floors fractional counts', async () => {
    await recordDownloads(2.9);
    expect((await getState()).downloadCount).toBe(2);
  });
});

describe('paywall-state: shouldShowBanner gating', () => {
  test('returns false below threshold', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD - 1);
    expect(await shouldShowBanner()).toBe(false);
  });

  test('returns true once threshold met', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    expect(await shouldShowBanner()).toBe(true);
  });

  test('returns false within cooldown window after dismissal', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    await markShown();
    // Advance past the per-session suppression window first so dismissal
    // is the *only* gating reason in play.
    now += 120_000;
    await markDismissed();

    // Just inside the cooldown window — still suppressed.
    now += SOFT_PAYWALL_COOLDOWN_MS - 1;
    expect(await shouldShowBanner()).toBe(false);
  });

  test('re-arms after cooldown elapses', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    await markShown();
    now += 120_000;
    await markDismissed();
    now += SOFT_PAYWALL_COOLDOWN_MS + 1;
    expect(await shouldShowBanner()).toBe(true);
  });

  test('resolved is sticky — banner never shows again', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD * 10);
    await markResolved();
    expect(await shouldShowBanner()).toBe(false);
    // Even after the cooldown window — `resolved` short-circuits everything.
    now += SOFT_PAYWALL_COOLDOWN_MS * 10;
    expect(await shouldShowBanner()).toBe(false);
  });

  test('per-session suppression: shouldShowBanner is false for 60s after markShown', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    expect(await shouldShowBanner()).toBe(true);
    await markShown();

    // Same instant — still not eligible (defends against double-mount).
    expect(await shouldShowBanner()).toBe(false);

    // 30s later — still suppressed.
    now += 30_000;
    expect(await shouldShowBanner()).toBe(false);

    // 61s later — re-eligible (no dismissal happened, threshold still met).
    now += 31_001;
    expect(await shouldShowBanner()).toBe(true);
  });
});

describe('paywall-state: counters track shown', () => {
  test('markShown increments shownCount and updates shownAt', async () => {
    await markShown();
    const s = await getState();
    expect(s.shownCount).toBe(1);
    expect(s.shownAt).toBe(now);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NoticeStrip component (paywall notice — real paywall-state + real trial
// eligibility; the strip picks the paywall notice once threshold met)
// ════════════════════════════════════════════════════════════════════════════

describe('<NoticeStrip> paywall notice', () => {
  test('referral fallback renders when below threshold', async () => {
    const { container } = render(<NoticeStrip />);
    await waitFor(() => {
      expect(container.querySelector('.notice-strip--referral')).not.toBeNull();
    });
  });

  test('renders nothing for Pro users even when eligible', async () => {
    state.isProUser = true;
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    const { container } = render(<NoticeStrip />);
    // Let the eligibility microtasks settle, then some extra ticks.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('.notice-strip')).toBeNull();
  });

  test('paywall notice takes the row once threshold met', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    const { container } = render(<NoticeStrip />);
    await waitFor(() => {
      expect(container.querySelector('.notice-strip--paywall')).not.toBeNull();
    });
    // Legacy CTA id kept; trial-eligible default in the test env.
    expect(screen.queryByRole('button', { name: 'Try Pro Free' })).not.toBeNull();
    // Referral is displaced while the paywall notice owns the row.
    expect(container.querySelector('.notice-strip--referral')).toBeNull();
  });

  test('✕ (the only dismissal path) persists dismissedAt and frees the row', async () => {
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    const { container } = render(<NoticeStrip />);
    // Wait for the paywall notice to take the row BEFORE grabbing the ✕ —
    // the referral fallback also renders an aria-label="Dismiss" close
    // button synchronously, and findByLabelText would click that one
    // before the async eligibility check flips the strip to paywall.
    await waitFor(() => {
      expect(container.querySelector('.notice-strip--paywall')).not.toBeNull();
    });
    const closeBtn = screen.getByLabelText('Dismiss');

    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(container.querySelector('.notice-strip--paywall')).toBeNull();
    });
    // markDismissed() is fire-and-forget inside the component — the storage
    // write needs a few extra ticks beyond the UI disappearing.
    await waitFor(async () => {
      const s = await getState();
      expect(s.dismissedAt).toBe(now);
    });
    expect((await getState()).resolved).toBe(false);
  });

  test('clicking "Try Pro Free" opens the upgrade modal but does NOT mark resolved', async () => {
    state.proUpgradeModalState = { open: false, errorText: '' };
    await recordDownloads(SOFT_PAYWALL_THRESHOLD);
    render(<NoticeStrip />);
    const tryBtn = await screen.findByRole('button', { name: 'Try Pro Free' });

    fireEvent.click(tryBtn);

    expect(state.proUpgradeModalState.open).toBe(true);
    // resolved stays false — the user hasn't actually converted yet.
    const s = await getState();
    expect(s.resolved).toBe(false);
  });
});
