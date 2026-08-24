// Guard test for tests/_helpers/block-prod-api.ts (see that file for the
// 2026-08-24 leak incident). The setup file is wired via
// vitest.config.ts setupFiles and must run for every test file BEFORE any
// module binds `fetch` — this test fails if the wiring is removed (the
// request would hit the real network and not resolve to the sentinel).
import { describe, expect, test } from 'vitest';

describe('prod-API fetch guard (setupFiles wiring)', () => {
  test('fetch to a kyriewen.cn host resolves to the fake 200 sentinel', async () => {
    const resp = await fetch('https://image-harvest.kyriewen.cn/api/v1/telemetry', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });
  });

  test('non-production URLs pass through untouched', async () => {
    // data: URLs never reach the network, so this asserts the wrapper's
    // pass-through branch without any real request.
    const resp = await fetch('data:application/json,{"pass":true}');
    expect(await resp.json()).toEqual({ pass: true });
  });
});
