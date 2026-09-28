// Guard test for tests/_helpers/block-prod-api.ts (see that file for the
// 2026-08-24 and 2026-09-28 leak incidents). The setup file is wired via
// vitest.config.ts setupFiles and must run for every test file BEFORE any
// module binds `fetch` — this test fails if the wiring is removed (the
// request would hit the real network and not resolve to the sentinel).
import { describe, expect, test, vi } from 'vitest';

describe('prod-API fetch guard (setupFiles wiring)', () => {
  test('fetch to a kyriewen.cn host resolves to the fake 200 sentinel', async () => {
    const resp = await fetch('https://image-harvest.kyriewen.cn/api/v1/telemetry', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });
  });

  test('fetch to a NON-prod host /api/v1 path is blocked (2026-09-28 leak vector)', async () => {
    // VITE_API_BASE can point API_BASE at e.g. http://localhost:3000 (a
    // local dev server with production Supabase keys). The hostname rule
    // missed that host, and unit tests wrote real rows to prod tables.
    // The /api/v1 surface path must be blocked on ANY host.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const resp = await fetch('http://localhost:3000/api/v1/telemetry', {
        method: 'POST',
        body: JSON.stringify({ events: [] }),
      });
      expect(resp.status).toBe(200);
      expect(await resp.json()).toEqual({ ok: true });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('blocked /api/v1 request to non-production host localhost')
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('non-API-v1 localhost paths pass through untouched (Eagle local API)', async () => {
    // Eagle's local API lives at localhost:41595 with NON-/api/v1 paths —
    // assert the pass-through branch does not over-block. A data: URL
    // never reaches the network, so this asserts without a real request.
    const resp = await fetch('data:application/json,{"pass":true}');
    expect(await resp.json()).toEqual({ pass: true });
  });
});
