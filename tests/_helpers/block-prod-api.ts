// Safety net for the WHOLE unit-test suite: neutralize any fetch that
// escapes to the real production API.
//
// Why this exists (2026-08-24 incident): shared/telemetry.ts binds
// `fetchImpl = fetch.bind(globalThis)` at MODULE LOAD time — before any
// test can vi.stubGlobal('fetch', …). So when a non-telemetry test (e.g. a
// sidepanel-init or license-activation test) exercised code that calls
// track(…) + flushNow(), the flush used the REAL global fetch and wrote
// REAL events to the production telemetry table. The write raced worker
// teardown, so only some runs leaked (CI's Test job and a local pre-push
// run both leaked ext_first_open / license_activated bursts on 2026-08-24;
// two other identical runs the same hour leaked nothing). This wrapper
// removes the race entirely: production-host requests resolve to a fake
// 200 and never touch the network, no matter which module captured fetch
// or when.
//
// tests/prod-api-guard.test.ts asserts this file is wired into
// vitest.config.ts setupFiles — keep both or neither.

export {};

declare global {
  // eslint-disable-next-line no-var
  var __prodApiFetchBlocked: boolean | undefined;
}

// Vitest reuses workers across test files and re-runs setupFiles for each
// one — guard against wrapping the wrapper.
if (!globalThis.__prodApiFetchBlocked) {
  globalThis.__prodApiFetchBlocked = true;
  const realFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const { hostname } = new URL(url);
      // All production surfaces (extension API + website) live under
      // kyriewen.cn. Unit tests must never reach any of them.
      if (hostname === 'kyriewen.cn' || hostname.endsWith('.kyriewen.cn')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    } catch {
      // Not a parseable URL — fall through to the real fetch.
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
