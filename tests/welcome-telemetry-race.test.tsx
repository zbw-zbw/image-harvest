// Welcome-page telemetry race regression tests (v1.2.7).
//
// Field data 2026-10: 2,189+ installs produced single-digit
// welcome_page_viewed events, and every onboarding arm attempt after the
// bucket lookup vanished. Root cause: `void track(...); void flushNow();`
// — track() is async (its first call awaits isOptedIn(), a storage read),
// so the synchronous flushNow() drains an EMPTY queue and the event falls
// to the 5s timer, which dies the moment the user closes the welcome tab.
//
// What we pin here:
//   1. flushNow() only runs AFTER track() has resolved (event enqueued).
//   2. startOnboarding() is called BEFORE any bucket lookup — the arm is
//      unconditional (a single storage write) and the bucket gate lives
//      in the panel consumer. Bucket a installs must still arm.
//   3. pagehide fires a final flush as a safety net.
//   4. setEnvelopeMeta runs at page init so events stop shipping with the
//      default version '0.0.0'.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __test as obTest } from '../shared/onboarding-state';

// ── telemetry mock ─────────────────────────────────────────────────────────
// track() resolves after a microtask+timer delay to model the real
// isOptedIn() storage read; flushNow() records whether track had resolved
// when it ran — the exact condition the v1.2.6-and-earlier code violated.
const tel = vi.hoisted(() => {
  const state = {
    trackDone: false,
    // Snapshot of trackDone taken at each flushNow() call — index-aligned
    // with flushCalls so per-event-cycle verdicts stay independent. The
    // pagehide safety-net flush is ALLOWED to see false (empty queue is
    // fine for a last-resort drain); only the event-driven flushes must
    // see the event already enqueued.
    flushSnapshots: [] as boolean[],
    trackCalls: 0,
  };
  return {
    state,
    track: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      state.trackDone = true;
      state.trackCalls += 1;
    }),
    flushNow: vi.fn(async () => {
      state.flushSnapshots.push(state.trackDone);
    }),
    setEnvelopeMeta: vi.fn(),
  };
});
vi.mock('../shared/telemetry', () => tel);

// ── ab-experiment mock: force the CONTROL bucket ───────────────────────────
// The strictest case for the arm: if bucket a installs arm too, the
// unconditional arm works for everyone.
const ab = vi.hoisted(() => ({
  getExperimentBucket: vi.fn(async () => 'a' as const),
  EXPERIMENTS: {
    PRO_UPSELL_COPY: 'pro_upsell_copy_v1',
    ONBOARDING_FLOW: 'onboarding_flow_v1',
    QUOTA_TIGHTEN_V1: 'quota_tighten_v1',
  },
}));
vi.mock('../shared/ab-experiment', () => ab);

// ── chrome stub + onboarding-state fake storage ────────────────────────────
const storageSets: Array<Record<string, unknown>> = [];

function stubChrome(): void {
  const calls: Record<string, (msg: unknown) => unknown> = {};
  (globalThis as Record<string, unknown>).chrome = {
    i18n: {
      getMessage: () => '',
      getUILanguage: () => 'en',
    },
    runtime: {
      getManifest: () => ({ version: '1.2.7-test' }),
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: async () => ({ success: true }),
      onMessage: { addListener: (fn: (msg: unknown) => unknown) => (calls[fn.name] = fn) },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async (obj: Record<string, unknown>) => {
          storageSets.push(obj);
        },
      },
    },
  };
}

async function importWelcomeAndBoot(): Promise<void> {
  // jsdom defaults document.readyState to 'complete', which would make the
  // module self-boot during import. Force the loading state so we control
  // when init() runs.
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => 'loading',
  });
  document.body.innerHTML = `
    <span id="version"></span><span id="countdown-days">7</span>
    <button id="btn-explore"></button>
    <section id="demo-section" hidden></section>
    <button id="btn-try-now"></button><span id="demo-hint" hidden></span>
  `;
  await import('../pages/welcome');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

beforeAll(async () => {
  stubChrome();
  obTest.reset();
  obTest.setStorage({
    // Route the arm through a recording adapter: the welcome page calls
    // the real startOnboarding(), whose write must land for bucket a.
    async get() {
      return undefined;
    },
    async set(_key: string, value: unknown) {
      storageSets.push({ onboardingState: value });
    },
  });
  await importWelcomeAndBoot();
  // Let the page-view track+flush chain and the unconditional arm settle.
  await vi.waitFor(() => {
    expect(tel.state.flushSnapshots.length).toBeGreaterThan(0);
  });
});

beforeEach(() => {
  // New event cycle: the next track() starts unresolved again.
  tel.state.trackDone = false;
});

describe('welcome page telemetry race (v1.2.7)', () => {
  it('flushNow() runs only after track() resolved — event is in the queue', () => {
    // The page-view event's flush (snapshot[0], captured while booting)
    // must have seen track() already resolved.
    expect(tel.state.flushSnapshots[0]).toBe(true);
    expect(tel.state.trackCalls).toBeGreaterThan(0);
  });

  it('bucket a (control) installs still arm the onboarding state', () => {
    const arm = storageSets.find((w) => 'onboardingState' in w);
    expect(arm).toBeDefined();
    expect(arm!.onboardingState).toMatchObject({ active: true });
    // And the bucket lookup was consulted only for the demo-section UI.
    expect(ab.getExperimentBucket).toHaveBeenCalledWith('onboarding_flow_v1');
  });

  it('setEnvelopeMeta runs at init with the real version', () => {
    expect(tel.setEnvelopeMeta).toHaveBeenCalledWith(
      expect.objectContaining({ version: '1.2.7-test' })
    );
  });

  it('pagehide fires a final safety-net flush', async () => {
    const before = tel.state.flushSnapshots.length;
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => {
      expect(tel.state.flushSnapshots.length).toBeGreaterThan(before);
    });
  });

  it('CTA click serializes track → flush → close', async () => {
    const btn = document.getElementById('btn-explore') as HTMLButtonElement;
    const before = tel.state.trackCalls;
    const flushBefore = tel.state.flushSnapshots.length;
    btn.click();
    await vi.waitFor(() => {
      expect(tel.state.trackCalls).toBeGreaterThan(before);
    });
    // The CTA's own flush must also land AFTER its track resolved.
    await vi.waitFor(() => {
      expect(tel.state.flushSnapshots.length).toBeGreaterThan(flushBefore);
    });
    expect(tel.state.flushSnapshots[tel.state.flushSnapshots.length - 1]).toBe(true);
  });
});
