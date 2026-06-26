// Unit tests for shared/telemetry.ts.
//
// Test surface: opt-in semantics, batching, throttling, retry queue,
// MAX_QUEUE truncation, concurrent flushNow coalescing, unknown-event
// drop, prop sanitization, instance hash stability.
//
// We use the SDK's __test hooks (setStorage / setFetch / setNow / reset)
// rather than the global chromeApiMock helper because:
//   1. We want a real in-memory store so retry-queue assertions check
//      actual persisted bytes, not vi.fn() call counts.
//   2. We want full control over `now()` to drive the 5s flush timer
//      with vi.useFakeTimers() without racing chrome.* polyfills.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __test, flushNow, isOptedIn, setEnvelopeMeta, setOptIn, track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import {
  TELEMETRY_BATCH_SIZE,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_MAX_QUEUE,
} from '../shared/constants';

// ── Test fixtures ─────────────────────────────────────────────────────────

interface MemStorage {
  store: Map<string, unknown>;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

function makeMemStorage(): MemStorage {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key) as T | undefined;
    },
    async set(key, value) {
      // Deep-clone via JSON to mirror chrome.storage.local's serialization
      // boundary — catches accidental object-identity reliance.
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      store.delete(key);
    },
  };
}

interface MockedFetch {
  fn: typeof fetch;
  calls: { body: unknown; url: string }[];
  setNextResult(result: 'ok' | 'http-error' | 'network-error' | 'no-ack'): void;
}

function makeMockFetch(
  initial: 'ok' | 'http-error' | 'network-error' | 'no-ack' = 'ok'
): MockedFetch {
  let next = initial;
  const calls: { body: unknown; url: string }[] = [];
  const fn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown = undefined;
    try {
      body = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      body = init?.body;
    }
    calls.push({ url, body });
    if (next === 'network-error') throw new Error('simulated network down');
    if (next === 'http-error') return new Response('', { status: 500 });
    if (next === 'no-ack') return new Response('{"ok":false}', { status: 200 });
    return new Response('{"ok":true,"accepted":1}', { status: 200 });
  }) as typeof fetch;
  return {
    fn,
    calls,
    setNextResult(result) {
      next = result;
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────

let mem: MemStorage;
let mockFetch: MockedFetch;

beforeEach(async () => {
  __test.reset();
  mem = makeMemStorage();
  mockFetch = makeMockFetch('ok');
  __test.setStorage(mem);
  __test.setFetch(mockFetch.fn);
  __test.setNow(() => 1_700_000_000_000);
  setEnvelopeMeta({ version: '1.0.1', lang: 'en', plan: 'free' });
  // Default is now opt-out (GDPR). Set storage key directly to opt-in
  // without enqueuing the TELEMETRY_OPT_IN event that setOptIn() produces.
  await mem.set('telemetryOptIn', true);
});

afterEach(async () => {
  // CRITICAL: drain any fire-and-forget Promise from track()'s high-water
  // branch BEFORE switching to real timers / running the next beforeEach.
  // Without this, a still-in-flight sendBatch from the previous test can
  // settle inside the next test's mock fetch capture, polluting its
  // assertions (we burned a debug session learning this — the failure
  // mode is "envelope test sees 20 events instead of 1").
  await __test.waitForIdle();
  vi.useRealTimers();
});

// ── opt-in / opt-out ──────────────────────────────────────────────────────

describe('opt-in semantics', () => {
  test('defaults to opted-out when no explicit choice has been made (GDPR)', async () => {
    // Reset to a clean state with no persisted preference.
    __test.reset();
    const freshMem = makeMemStorage();
    __test.setStorage(freshMem);
    __test.setFetch(mockFetch.fn);
    expect(await isOptedIn()).toBe(false);
  });

  test('persisted false survives the in-memory cache reset', async () => {
    await mem.set('telemetryOptIn', false);
    expect(await isOptedIn()).toBe(false);
  });

  test('setOptIn(false) becomes silent immediately and clears retry queue', async () => {
    // Seed a "previously failed" retry queue.
    await mem.set('telemetryQueue', [{ event: EVENTS.SCAN_TRIGGERED, ts: 1 }]);

    await setOptIn(false);
    expect(await isOptedIn()).toBe(false);
    expect(mem.store.get('telemetryQueue')).toBeUndefined();

    // Subsequent track() calls must not enqueue or fetch.
    await track(EVENTS.SCAN_TRIGGERED);
    expect(__test.getQueueSnapshot()).toHaveLength(0);
    expect(mockFetch.calls).toHaveLength(0);
  });

  test('setOptIn(true) records the consent decision itself', async () => {
    await setOptIn(true);
    // The TELEMETRY_OPT_IN event was enqueued; flush and assert.
    await flushNow();
    expect(mockFetch.calls).toHaveLength(1);
    const body = mockFetch.calls[0].body as { events: { event: string }[] };
    expect(body.events.map((e) => e.event)).toContain(EVENTS.TELEMETRY_OPT_IN);
  });
});

// ── unknown event + prop sanitization ─────────────────────────────────────

describe('input validation', () => {
  test('unknown event names are silently dropped', async () => {
    await track('not_a_real_event');
    expect(__test.getQueueSnapshot()).toHaveLength(0);
  });

  test('whitelisted props pass through; unknown props are dropped', async () => {
    await track(EVENTS.DOWNLOAD_BATCH, {
      count: 42,
      // Not in EVENT_PROP_SCHEMAS for DOWNLOAD_BATCH — must be dropped.
      url: 'https://leaks.example.com/secret',
    });
    const snap = __test.getQueueSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].props).toEqual({ count: 42 });
    expect(snap[0].props).not.toHaveProperty('url');
  });

  test('events with no schema-allowed props ship without a props field', async () => {
    await track(EVENTS.EXTENSION_FIRST_OPEN, { whatever: 'no' });
    const snap = __test.getQueueSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).not.toHaveProperty('props');
  });
});

// ── batching + throttling ─────────────────────────────────────────────────

describe('batch + throttle', () => {
  // Why `toFake: ['setTimeout', 'clearTimeout']` instead of the default
  // useFakeTimers()?
  //
  //   The default fakes the *entire* timer surface, including queueMicrotask
  //   and Promise resolution scheduling under some vitest configurations.
  //   `track()` internally awaits isOptedIn() → storage.get() → sha256Hex()
  //   → storage.set() before it ever calls scheduleFlush(). Under the
  //   default fake-timer regime — and only when the full ~1.4k-test suite
  //   runs under load — those awaited microtasks can stall, so the 5s
  //   setTimeout is never registered before advanceTimersByTimeAsync()
  //   runs. The result: the timer we wait on doesn't exist yet, and the
  //   later-registered timer never fires. End state: mockFetch.calls.length
  //   stays at 0, the assertion fails, the test was "flaky" in CI.
  //
  //   Faking only setTimeout + clearTimeout leaves microtasks on the real
  //   queue, so all `await`s in `track()` resolve normally. The explicit
  //   drainMicrotasks() below is a belt-and-suspenders guarantee that
  //   scheduleFlush() has already armed the timer before we advance it.
  async function drainMicrotasks(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await Promise.resolve();
    }
  }

  test('does not flush before the 5s window when queue is small', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await track(EVENTS.SCAN_TRIGGERED);
    await drainMicrotasks();
    // Just under the interval — no flush yet.
    vi.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS - 1);
    expect(mockFetch.calls).toHaveLength(0);
  });

  test('flushes once the 5s window elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await track(EVENTS.SCAN_TRIGGERED);
    // Phase 1: wait for scheduleFlush() to actually arm the setTimeout.
    // Under CI load the awaited chain inside track() (isOptedIn →
    // storage.get → sha256Hex → storage.set) can take dozens of microtask
    // rounds, so a fixed drainMicrotasks(10) is not enough — we poll on
    // the actual observable: vi.getTimerCount(). Bail after ~200 rounds
    // so a genuine bug surfaces as a real failure instead of an infinite loop.
    for (let i = 0; i < 200 && vi.getTimerCount() === 0; i++) {
      await Promise.resolve();
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    // Phase 2: advance fake time to fire the timer callback `void flushNow()`.
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_INTERVAL_MS + 10);
    // Phase 3: wait for the in-flight flushNow() to fully settle. We CANNOT
    // rely on microtask draining alone because sendBatch() awaits
    // sha256Hex() (native crypto.subtle.digest) which resolves on a
    // macrotask boundary — fake-timer microtask polls miss it entirely.
    // __test.waitForIdle() observes the `inFlight` flag inside the SDK
    // and is the only deterministic signal that the whole chain
    // (buildEnvelope → fetchImpl → resp.json) has actually finished.
    await __test.waitForIdle();
    expect(mockFetch.calls).toHaveLength(1);
  });

  test('high-water mark forces an early flush at BATCH_SIZE events', async () => {
    for (let i = 0; i < TELEMETRY_BATCH_SIZE; i++) {
      await track(EVENTS.SCAN_TRIGGERED);
    }
    // The BATCH_SIZE-th track() kicked off a fire-and-forget flushNow().
    // We MUST drain it deterministically — otherwise the still-pending
    // sendBatch promise can settle (and reset module-level `inFlight`)
    // mid-way through the NEXT test, polluting its mockFetch capture.
    // flushNow() is idempotent under the inFlight gate, so awaiting a
    // second invocation here also waits for the first to settle.
    await flushNow();
    expect(mockFetch.calls.length).toBeGreaterThanOrEqual(1);
    const body = mockFetch.calls[0].body as { events: unknown[] };
    expect(body.events).toHaveLength(TELEMETRY_BATCH_SIZE);
  });
});

// ── envelope shape ────────────────────────────────────────────────────────

describe('envelope', () => {
  test('carries the configured version / lang / plan and stable instance hash', async () => {
    setEnvelopeMeta({ version: '2.5.0', lang: 'zh-CN', plan: 'yearly' });
    await track(EVENTS.SCAN_TRIGGERED);
    await flushNow();
    const body = mockFetch.calls[0].body as {
      version: string;
      lang: string;
      plan: string;
      instanceIdHash: string;
      schemaVersion: number;
      events: unknown[];
    };
    expect(body.version).toBe('2.5.0');
    expect(body.lang).toBe('zh-CN');
    expect(body.plan).toBe('yearly');
    expect(body.schemaVersion).toBe(1);
    // Hash is 16 hex chars (truncated SHA-256).
    expect(body.instanceIdHash).toMatch(/^[0-9a-f]{16}$/);
    expect(body.events).toHaveLength(1);
  });

  test('instance hash is stable across flushes', async () => {
    await track(EVENTS.SCAN_TRIGGERED);
    await flushNow();
    await track(EVENTS.SCAN_TRIGGERED);
    await flushNow();
    const a = (mockFetch.calls[0].body as { instanceIdHash: string }).instanceIdHash;
    const b = (mockFetch.calls[1].body as { instanceIdHash: string }).instanceIdHash;
    expect(a).toBe(b);
  });
});

// ── retry queue ───────────────────────────────────────────────────────────

describe('retry queue', () => {
  test('persists batch on HTTP error, drains on next successful flush', async () => {
    mockFetch.setNextResult('http-error');
    await track(EVENTS.SCAN_TRIGGERED);
    await flushNow();
    // Failed: persisted, not delivered.
    const persisted = mem.store.get('telemetryQueue') as unknown[] | undefined;
    expect(persisted).toHaveLength(1);

    // Now the network recovers AND we have a fresh event. The fresh event
    // ships and the drain attempt also retries the persisted one.
    mockFetch.setNextResult('ok');
    await track(EVENTS.SCAN_COMPLETED, { count: 5, durationMs: 100 });
    await flushNow();

    expect(mem.store.get('telemetryQueue')).toBeUndefined();
    // 1 attempt that failed + 1 fresh batch + 1 drain attempt of persisted = 3
    expect(mockFetch.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('persists batch on network error (thrown)', async () => {
    mockFetch.setNextResult('network-error');
    await track(EVENTS.SCAN_TRIGGERED);
    await flushNow();
    const persisted = mem.store.get('telemetryQueue') as unknown[] | undefined;
    expect(persisted).toHaveLength(1);
  });

  test('persists batch when server returns ok=false in body', async () => {
    mockFetch.setNextResult('no-ack');
    await track(EVENTS.SCAN_TRIGGERED);
    await flushNow();
    expect(mem.store.get('telemetryQueue')).toHaveLength(1);
  });

  test('retry queue is capped at MAX_QUEUE; oldest events are dropped first', async () => {
    // Pre-seed an oversized retry queue (simulate prolonged outage).
    const oversize: { event: string; ts: number }[] = [];
    for (let i = 0; i < TELEMETRY_MAX_QUEUE + 30; i++) {
      oversize.push({ event: EVENTS.SCAN_TRIGGERED, ts: i });
    }
    mockFetch.setNextResult('http-error');
    // Ship a fresh single event so persistForRetry runs against the
    // oversized base.
    await mem.set('telemetryQueue', oversize);
    await track(EVENTS.IMAGES_SHOWN, { count: 7 });
    await flushNow();

    const trimmed = mem.store.get('telemetryQueue') as { event: string; ts: number }[];
    expect(trimmed.length).toBe(TELEMETRY_MAX_QUEUE);
    // The most recent event (the IMAGES_SHOWN we just tried) MUST be in
    // the trimmed tail — losing fresh data would defeat the entire point.
    expect(trimmed[trimmed.length - 1].event).toBe(EVENTS.IMAGES_SHOWN);
  });
});

// ── concurrency ───────────────────────────────────────────────────────────

describe('concurrency', () => {
  test('two simultaneous flushNow() calls do not double-send the same batch', async () => {
    await track(EVENTS.SCAN_TRIGGERED);
    await track(EVENTS.SCAN_TRIGGERED);
    // Fire both flushes; the second must observe inFlight=true and bail.
    await Promise.all([flushNow(), flushNow()]);
    expect(mockFetch.calls).toHaveLength(1);
    const body = mockFetch.calls[0].body as { events: unknown[] };
    expect(body.events).toHaveLength(2);
  });

  test('flushNow with an empty queue still drains a previously persisted batch', async () => {
    await mem.set('telemetryQueue', [{ event: EVENTS.SCAN_TRIGGERED, ts: 1 }]);
    await flushNow();
    expect(mockFetch.calls).toHaveLength(1);
    expect(mem.store.get('telemetryQueue')).toBeUndefined();
  });
});
