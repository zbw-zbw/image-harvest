// Cross-workspace schema-consistency + rate-limiter tests for the website's
// telemetry receiver.
//
// We deliberately do NOT spin up a Next.js test server here:
//   - Adding @vitejs/plugin-react / next/test / supertest would drag a
//     three-figure megabyte of devDeps just to assert four endpoints.
//   - The receiver's correctness has two distinct concerns and we test
//     them separately:
//        (a) Whitelist / sanitizer agreement with the extension's
//            shared/telemetry-events.ts. If these drift, the server will
//            silently drop legitimate events forever.
//        (b) The in-memory rate limiter's window/cap math.
//   - End-to-end "POST → 200 → row in supabase" is covered by Sprint 1.6
//     manual verification against staging.
//
// IMPORTANT: This file imports from website/src/lib/* using a relative
// path. The website is a separate workspace under the same git root, so
// the import is purely a TS source-level reference — no Next.js runtime
// types are pulled in.

import { describe, expect, test, beforeEach } from 'vitest';

// Extension-side source of truth.
import {
  EVENTS,
  EVENT_PROP_SCHEMAS as CLIENT_SCHEMAS,
  TELEMETRY_EVENT_WHITELIST as CLIENT_WHITELIST,
} from '../shared/telemetry-events';

// Server-side mirror.
import {
  EVENT_PROP_SCHEMAS as SERVER_SCHEMAS,
  TELEMETRY_EVENT_WHITELIST as SERVER_WHITELIST,
  isKnownEvent,
  sanitizeEventProps,
} from '../website/src/lib/telemetry-schema';

// Route-internal helpers (rate limiter + envelope parser). We import the
// underlying primitive modules directly rather than going through
// route.ts, which would force vitest to resolve the website's `@/*` path
// alias from outside its workspace (it can't, and it shouldn't have to).
// The route file is a thin orchestration layer over these three modules:
//   - lib/telemetry-schema.ts   → whitelist + sanitize
//   - lib/telemetry-rate-limit.ts → checkRateLimit + reset
//   - lib/telemetry-envelope.ts  → parseEnvelope
// End-to-end "POST → 200 → row in supabase" is covered by Sprint 1.6
// manual verification against staging.
import { checkRateLimit, resetRateLimiter } from '../website/src/lib/telemetry-rate-limit';
import { parseEnvelope } from '../website/src/lib/telemetry-envelope';

const routeTest = {
  resetRateLimiter,
  checkRateLimit,
  parseEnvelope,
};

// ── Schema parity ─────────────────────────────────────────────────────────
// If these drift, real events get silently dropped server-side.

describe('schema parity (extension ↔ website)', () => {
  test('whitelists contain the same event names', () => {
    const clientNames = [...CLIENT_WHITELIST].sort();
    const serverNames = [...SERVER_WHITELIST].sort();
    expect(serverNames).toEqual(clientNames);
  });

  test('every event has the same prop key set on both sides', () => {
    for (const name of Object.values(EVENTS)) {
      const client = [...CLIENT_SCHEMAS[name]].sort();
      const server = [...(SERVER_SCHEMAS[name] ?? [])].sort();
      expect(server, `prop schema mismatch for "${name}"`).toEqual(client);
    }
  });

  test('isKnownEvent agrees with the client whitelist', () => {
    for (const name of CLIENT_WHITELIST) {
      expect(isKnownEvent(name)).toBe(true);
    }
    expect(isKnownEvent('not_an_event')).toBe(false);
    expect(isKnownEvent('')).toBe(false);
  });
});

// ── Server-side sanitizer ─────────────────────────────────────────────────

describe('sanitizeEventProps (server)', () => {
  test('drops props for unknown events', () => {
    expect(sanitizeEventProps('not_real', { x: 1 })).toBeNull();
  });

  test('drops keys not on the whitelist', () => {
    const out = sanitizeEventProps(EVENTS.DOWNLOAD_BATCH, {
      count: 5,
      // Privacy violation if leaked → MUST be dropped.
      url: 'https://example.com/secret',
      userId: 'u_123',
    });
    expect(out).toEqual({ count: 5 });
  });

  test('returns null when whitelist is empty', () => {
    expect(sanitizeEventProps(EVENTS.EXTENSION_FIRST_OPEN, { foo: 'bar' })).toBeNull();
  });

  test('returns null when no whitelisted key has a value', () => {
    expect(sanitizeEventProps(EVENTS.DOWNLOAD_BATCH, { url: 'x' })).toBeNull();
  });

  test('rejects non-primitive values', () => {
    const out = sanitizeEventProps(EVENTS.DOWNLOAD_BATCH, {
      count: 1,
      // @ts-expect-error — deliberately passing an array to prove it's dropped
      bogus: [1, 2, 3],
    });
    expect(out).toEqual({ count: 1 });
  });
});

// ── Envelope parser ───────────────────────────────────────────────────────

describe('parseEnvelope', () => {
  const valid = {
    instanceIdHash: '0123456789abcdef',
    version: '1.0.1',
    lang: 'en',
    plan: 'free',
    schemaVersion: 1,
    events: [{ event: EVENTS.SCAN_TRIGGERED, ts: 1700000000000 }],
  };

  test('accepts a well-formed envelope', () => {
    const out = routeTest.parseEnvelope(valid);
    expect(out).not.toBeNull();
    expect(out?.events).toHaveLength(1);
  });

  test('rejects non-hex / wrong-length instanceIdHash', () => {
    expect(routeTest.parseEnvelope({ ...valid, instanceIdHash: 'NOT-HEX-VALUE' })).toBeNull();
    expect(routeTest.parseEnvelope({ ...valid, instanceIdHash: '0123' })).toBeNull();
  });

  test('rejects schemaVersion !== 1', () => {
    expect(routeTest.parseEnvelope({ ...valid, schemaVersion: 2 })).toBeNull();
  });

  test('rejects when events is not an array', () => {
    expect(routeTest.parseEnvelope({ ...valid, events: 'oops' })).toBeNull();
  });

  test('truncates oversized event arrays at MAX_BATCH', () => {
    const huge = {
      ...valid,
      events: Array.from({ length: 200 }, () => ({ event: EVENTS.SCAN_TRIGGERED, ts: 1 })),
    };
    const out = routeTest.parseEnvelope(huge);
    // Server cap is 50; anything over is silently dropped.
    expect(out?.events.length).toBeLessThanOrEqual(50);
  });

  test('drops individual events with malformed shape but keeps the rest', () => {
    const mixed = {
      ...valid,
      events: [
        { event: EVENTS.SCAN_TRIGGERED, ts: 1 },
        { event: EVENTS.SCAN_TRIGGERED }, // missing ts
        { ts: 2 }, // missing event
        { event: EVENTS.SCAN_TRIGGERED, ts: 'not a number' },
        { event: EVENTS.IMAGES_SHOWN, ts: 3, props: { count: 7 } },
      ],
    };
    const out = routeTest.parseEnvelope(mixed);
    expect(out?.events).toHaveLength(2);
    expect(out?.events[1].props).toEqual({ count: 7 });
  });

  test('clamps oversized version/lang/plan strings', () => {
    const out = routeTest.parseEnvelope({
      ...valid,
      version: 'x'.repeat(1000),
      lang: 'y'.repeat(1000),
      plan: 'z'.repeat(1000),
    });
    expect(out?.version.length).toBeLessThanOrEqual(32);
    expect(out?.lang.length).toBeLessThanOrEqual(16);
    expect(out?.plan.length).toBeLessThanOrEqual(16);
  });
});

// ── Rate limiter ──────────────────────────────────────────────────────────

describe('rate limiter', () => {
  beforeEach(() => {
    routeTest.resetRateLimiter();
  });

  test('allows requests up to the cap inside the window', () => {
    const hash = 'aaaa1111bbbb2222';
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(routeTest.checkRateLimit(hash, now + i)).toBe(true);
    }
  });

  test('blocks the 11th request inside the window', () => {
    const hash = 'aaaa1111bbbb2222';
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      routeTest.checkRateLimit(hash, now + i);
    }
    expect(routeTest.checkRateLimit(hash, now + 11)).toBe(false);
  });

  test('expires old timestamps once the window has elapsed', () => {
    const hash = 'aaaa1111bbbb2222';
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      routeTest.checkRateLimit(hash, now + i);
    }
    // Jump past the window — old entries are evicted.
    expect(routeTest.checkRateLimit(hash, now + 20_000)).toBe(true);
  });

  test('isolates buckets per instance hash', () => {
    const a = 'aaaa1111bbbb2222';
    const b = 'cccc3333dddd4444';
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) routeTest.checkRateLimit(a, now + i);
    // a is full, b is fresh.
    expect(routeTest.checkRateLimit(a, now + 11)).toBe(false);
    expect(routeTest.checkRateLimit(b, now + 11)).toBe(true);
  });
});
