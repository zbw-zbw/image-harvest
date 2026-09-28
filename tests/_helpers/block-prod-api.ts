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
// Rule 2 (2026-09-28 incident): hostname matching alone is NOT enough.
// constants.ts derives API_BASE from import.meta.env.VITE_API_BASE
// (.env.local exists for local dev), so a test run executed while
// VITE_API_BASE=http://localhost:3000 and a local Next.js dev server
// (wired to the PRODUCTION Supabase keys) was up sent test telemetry to
// that dev server — which relayed it into the production tables. Exactly
// that leaked 12 license_activated rows (version=0.0.0, plan=yearly mock
// value) on 2026-09-13/24-25, invisible to the hostname rule because the
// host was localhost. ALL extension↔backend data calls live under the
// /api/v1/ surface path (see constants.ts API_V1_BASE), so we block that
// path on ANY host. Eagle's local API on localhost:41595 does not use
// /api/v1 — unaffected.
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

  // Surface the misconfiguration itself, loudly: tests running with an
  // overridden API base are how the 2026-09-28 leak started.
  const envBase = (import.meta.env?.VITE_API_BASE as string | undefined) ?? undefined;
  if (envBase) {
    console.warn(
      `[block-prod-api] VITE_API_BASE=${envBase} is set — unit tests are running with an overridden API base (2026-09-28 leak vector). /api/v1/* requests are force-blocked regardless of host.`
    );
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const { hostname, pathname } = new URL(url);
      // Rule 1: All production surfaces (extension API + website) live
      // under kyriewen.cn. Unit tests must never reach any of them.
      // Rule 2: The /api/v1/* surface path is the extension↔backend data
      // API on whatever host API_BASE resolved to (VITE_API_BASE can point
      // it at a local dev server with production credentials). Block it on
      // ANY host — see header comment for the 2026-09-28 incident.
      const isProdHost = hostname === 'kyriewen.cn' || hostname.endsWith('.kyriewen.cn');
      const isApiV1Path = pathname === '/api/v1' || pathname.startsWith('/api/v1/');
      if (isProdHost || isApiV1Path) {
        if (!isProdHost) {
          console.warn(
            `[block-prod-api] blocked /api/v1 request to non-production host ${hostname} (${pathname}) — tests must never write to a real backend.`
          );
        }
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
