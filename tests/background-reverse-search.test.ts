// Unit tests for background/reverse-search.ts.
//
// Coverage:
//   - fetchImageData: ok / non-ok / default-mime fallback
//   - reverseSearchUpload: dispatch table (unknown engine throws,
//     baidu vs yandex routing) + MIME → file extension map
//   - uploadToYandex (exercised through reverseSearchUpload):
//     two cbir_id response shapes, HTTP failure, no-cbir_id throw
//   - uploadToBaidu (exercised through reverseSearchUpload):
//     tabs.create + onUpdated listener complete-event + 10s timeout
//     fallback + scripting.executeScript injection pipeline.
//     Originally skipped as "e2e-only" but the Chrome API surface is
//     mockable with fake timers + a minimal chrome stub, and without
//     it the module sits at ~59% line coverage which violates the
//     Stage-5 85%+ floor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchImageData, reverseSearchUpload } from '../background/reverse-search';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let fetchCalls: FetchCall[];

/**
 * Minimal Response factory — vitest's node env doesn't ship a Response
 * polyfill that exposes arrayBuffer() the way we need it, so we hand-roll
 * just the surface fetchImageData / uploadToYandex touch.
 */
function makeResponse(opts: {
  ok?: boolean;
  status?: number;
  body?: ArrayBuffer | string;
  headers?: Record<string, string>;
  json?: unknown;
  url?: string;
}): Response {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    url: opts.url ?? 'https://x.com/a.jpg',
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () =>
      typeof opts.body === 'string'
        ? new TextEncoder().encode(opts.body).buffer
        : (opts.body ?? new ArrayBuffer(0)),
    json: async () => opts.json,
  } as unknown as Response;
}

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  vi.restoreAllMocks();
});

// ── fetchImageData ──────────────────────────────────────────────────────────

describe('fetchImageData', () => {
  it('returns a base64 data: URL using the response Content-Type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return makeResponse({
        body: new Uint8Array([0x41, 0x42, 0x43, 0x44]).buffer, // "ABCD"
        headers: { 'content-type': 'image/jpeg' },
      });
    });

    const dataUrl = await fetchImageData('https://x.com/a.jpg');

    expect(dataUrl).toBe('data:image/jpeg;base64,QUJDRA==');
    // Pin the Accept header — the upstream contract expects image/* hint.
    expect(fetchCalls[0]?.init?.headers).toEqual({ Accept: 'image/*' });
  });

  it('detects PNG from magic bytes when the response omits Content-Type', async () => {
    // PNG magic bytes: 89 50 4E 47
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({
        body: pngMagic.buffer,
        headers: {}, // no Content-Type
      })
    );

    const dataUrl = await fetchImageData('https://x.com/a');

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('throws "Response is not an image" when bytes have no image magic and no Content-Type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({
        body: new Uint8Array([0x41]).buffer,
        headers: {}, // no Content-Type, no image magic
      })
    );

    await expect(fetchImageData('https://x.com/a')).rejects.toThrow('Response is not an image');
  });

  it('throws "HTTP <status>" when the response is not ok', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => makeResponse({ ok: false, status: 403 }));

    await expect(fetchImageData('https://x.com/a')).rejects.toThrow('HTTP 403');
  });
});

// ── reverseSearchUpload — dispatch table ────────────────────────────────────

describe('reverseSearchUpload — dispatch', () => {
  it('throws "Unknown engine" for unrecognized engine names', async () => {
    const dataUrl = 'data:image/png;base64,QUJDRA==';
    await expect(reverseSearchUpload('google', dataUrl)).rejects.toThrow(/Unknown engine: google/);
    await expect(reverseSearchUpload('', dataUrl)).rejects.toThrow(/Unknown engine:/);
    await expect(reverseSearchUpload('YANDEX', dataUrl)).rejects.toThrow(
      // dispatch is case-sensitive — pin the contract.
      /Unknown engine: YANDEX/
    );
  });

  it('routes engine=yandex through uploadToYandex (fetch is invoked once)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({
        json: { blocks: [{ params: { cbirId: 'abc123' } }] },
      })
    );

    const result = await reverseSearchUpload('yandex', 'data:image/png;base64,QUJDRA==');

    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });
});

// ── uploadToYandex (via reverseSearchUpload) ────────────────────────────────

describe('uploadToYandex — response shapes', () => {
  it('uses blocks[0].params.cbirId when present (modern shape)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({
        json: { blocks: [{ params: { cbirId: 'modern-id-42' } }] },
      })
    );

    const result = await reverseSearchUpload('yandex', 'data:image/png;base64,QUJDRA==');

    expect(result).toEqual({
      success: true,
      redirectUrl: 'https://yandex.ru/images/search?cbir_id=modern-id-42&rpt=imageview',
    });
  });

  it('falls back to top-level cbir_id (legacy shape)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({ json: { cbir_id: 'legacy-id-99' } })
    );

    const result = await reverseSearchUpload('yandex', 'data:image/png;base64,QUJDRA==');

    // Note the param order differs from the modern shape — pin it
    // so a refactor that "tidies up" the URL doesn't silently break.
    expect(result).toEqual({
      success: true,
      redirectUrl: 'https://yandex.ru/images/search?rpt=imageview&cbir_id=legacy-id-99',
    });
  });

  it('throws "Yandex HTTP <status>" when the upload request fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => makeResponse({ ok: false, status: 502 }));

    await expect(reverseSearchUpload('yandex', 'data:image/png;base64,QUJDRA==')).rejects.toThrow(
      'Yandex HTTP 502'
    );
  });

  it('throws "Yandex returned no cbir_id" when neither field is present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({ json: { blocks: [{ params: {} }] } })
    );

    await expect(reverseSearchUpload('yandex', 'data:image/png;base64,QUJDRA==')).rejects.toThrow(
      'Yandex returned no cbir_id'
    );
  });

  it('handles MIME variants (jpeg/webp/gif) via the extension map', async () => {
    // The ext map only affects the uploaded filename — there's no easy
    // post-hoc inspection of the FormData, but we can at least pin
    // that all four documented MIME types make it through dispatch
    // without throwing the "Unknown engine" guard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => makeResponse({ json: { cbir_id: 'x' } }));
    const mimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    for (const mime of mimes) {
      const res = await reverseSearchUpload('yandex', `data:${mime};base64,QUJDRA==`);
      expect(res.success).toBe(true);
    }
    // Unknown MIME falls through to .jpg fallback — also exercised.
    const res = await reverseSearchUpload('yandex', 'data:image/avif;base64,QUJDRA==');
    expect(res.success).toBe(true);
  });
});

// ── uploadToBaidu (via reverseSearchUpload) ────────────────────────────────
// The Baidu flow is heavier than Yandex: we open a tab, wait for its
// status='complete' event (with a 10s fallback timeout), sleep 1.5s
// for the upload UI to settle, then inject a content script via
// chrome.scripting.executeScript that programmatically builds a File
// and fires a synthetic 'change' event on the page's file input.
//
// Every one of those Chrome APIs is mockable at the chrome.* global
// level; fake timers let us collapse the 10s + 1.5s waits into
// microtasks so the test runs in single-digit ms.
describe('uploadToBaidu — tab-open + scripting.executeScript injection', () => {
  // Helper: set up a chrome stub exposing exactly the surface
  // uploadToBaidu touches. Returns the spies so each test can assert
  // on them. The default behaviour simulates the happy path (tab
  // opens, status flips to 'complete' asynchronously, executeScript
  // succeeds).
  interface BaiduChromeHarness {
    tabsCreate: ReturnType<typeof vi.fn>;
    onUpdatedAddListener: ReturnType<typeof vi.fn>;
    onUpdatedRemoveListener: ReturnType<typeof vi.fn>;
    executeScript: ReturnType<typeof vi.fn>;
    /** Trigger whatever listener uploadToBaidu just registered with
     * the given changeInfo. Used to simulate the tab load cycle. */
    fireOnUpdated: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void;
    registeredListeners: Array<(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void>;
  }

  function installBaiduChrome(
    opts: {
      tabId?: number | undefined;
      /** When true, tabs.create explicitly resolves with id:undefined
       * to exercise the "no tab id" defensive branch. We can't use `??`
       * on opts.tabId because its undefined value is meaningful, not a
       * "not supplied" signal. */
      simulateMissingTabId?: boolean;
      executeScriptImpl?: () => Promise<unknown>;
    } = {}
  ): BaiduChromeHarness {
    const registeredListeners: BaiduChromeHarness['registeredListeners'] = [];
    const resolvedTabId = opts.simulateMissingTabId ? undefined : (opts.tabId ?? 77);
    const tabsCreate = vi.fn(async () => ({ id: resolvedTabId }));
    const onUpdatedAddListener = vi.fn(
      (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => {
        registeredListeners.push(listener);
      }
    );
    const onUpdatedRemoveListener = vi.fn(
      (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => {
        const idx = registeredListeners.indexOf(listener);
        if (idx !== -1) registeredListeners.splice(idx, 1);
      }
    );
    const executeScript = vi.fn(opts.executeScriptImpl ?? (async () => [{ result: undefined }]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome = {
      tabs: {
        create: tabsCreate,
        onUpdated: {
          addListener: onUpdatedAddListener,
          removeListener: onUpdatedRemoveListener,
        },
      },
      scripting: { executeScript },
    };

    return {
      tabsCreate,
      onUpdatedAddListener,
      onUpdatedRemoveListener,
      executeScript,
      registeredListeners,
      fireOnUpdated(tabId, changeInfo) {
        // Copy the list first — listeners that call removeListener
        // during firing mutate registeredListeners mid-iteration.
        for (const fn of [...registeredListeners]) {
          fn(tabId, changeInfo);
        }
      },
    };
  }

  it('opens the Baidu tab, awaits status=complete, injects the upload script, returns injected:true', async () => {
    vi.useFakeTimers();
    const harness = installBaiduChrome({ tabId: 42 });
    const dataUrl = 'data:image/png;base64,QUJDRA==';

    // Kick off the async call — we'll drive it forward in slices.
    const promise = reverseSearchUpload('baidu', dataUrl);

    // Let the microtasks chained after tabs.create() settle so the
    // onUpdated listener has been registered before we fire it.
    await vi.advanceTimersByTimeAsync(0);

    // Simulate the tab finishing load — this resolves the
    // waiter-promise inside uploadToBaidu.
    expect(harness.registeredListeners.length).toBe(1);
    harness.fireOnUpdated(42, { status: 'complete' });

    // The 1.5s "let Baidu's uploader settle" sleep.
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result).toEqual({ success: true, injected: true });
    expect(harness.tabsCreate).toHaveBeenCalledWith({
      url: 'https://graph.baidu.com/pcpage/index?tpl_from=pc',
      active: true,
    });
    // Pin: after onUpdated fires with status=complete, the listener
    // must be removed — otherwise it would leak across subsequent
    // Baidu searches and execute content scripts against tabs the
    // user opened for unrelated reasons.
    expect(harness.onUpdatedRemoveListener).toHaveBeenCalled();
    // Script injection targets the right tab and forwards image bytes.
    const scriptCall = harness.executeScript.mock.calls[0][0] as {
      target: { tabId: number };
      args: [string, string, string];
    };
    expect(scriptCall.target.tabId).toBe(42);
    expect(scriptCall.args[0]).toBe(dataUrl);
    expect(scriptCall.args[1]).toBe('image.png'); // png MIME → .png ext
    expect(scriptCall.args[2]).toBe('image/png');

    vi.useRealTimers();
  });

  it('falls back after the 10s tab-load timeout when status=complete never fires', async () => {
    vi.useFakeTimers();
    const harness = installBaiduChrome({ tabId: 7 });

    const promise = reverseSearchUpload('baidu', 'data:image/jpeg;base64,QUJDRA==');

    await vi.advanceTimersByTimeAsync(0);
    expect(harness.registeredListeners.length).toBe(1);

    // Do NOT fire onUpdated. Advance past the 10s timeout plus the
    // 1.5s settle-sleep.
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;
    // Pin: even on timeout we still attempt the script injection
    // (Baidu's upload input frequently exists before the page
    // reports 'complete' — bailing here would regress the happy path
    // on slow networks).
    expect(result).toEqual({ success: true, injected: true });
    expect(harness.onUpdatedRemoveListener).toHaveBeenCalled();
    expect(harness.executeScript).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('ignores onUpdated events for OTHER tab ids (listener is per-tab)', async () => {
    vi.useFakeTimers();
    const harness = installBaiduChrome({ tabId: 100 });

    const promise = reverseSearchUpload('baidu', 'data:image/webp;base64,QUJDRA==');
    await vi.advanceTimersByTimeAsync(0);

    // Events for a different tab id must NOT unblock the waiter —
    // otherwise an unrelated tab completing first would pull us past
    // the load gate before Baidu is actually ready.
    harness.fireOnUpdated(999, { status: 'complete' });
    harness.fireOnUpdated(100, { status: 'loading' }); // wrong status
    // Neither should have removed the listener.
    expect(harness.onUpdatedRemoveListener).not.toHaveBeenCalled();

    // The correct event finally arrives.
    harness.fireOnUpdated(100, { status: 'complete' });
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;
    expect(result.success).toBe(true);
    // Correct MIME → correct upload filename extension.
    const scriptCall = harness.executeScript.mock.calls[0][0] as {
      args: [string, string, string];
    };
    expect(scriptCall.args[1]).toBe('image.webp');

    vi.useRealTimers();
  });

  it('throws "Failed to open Baidu reverse-search tab" when tabs.create returns no id', async () => {
    // Defensive branch: MV3 can hand back a tab object with id===undefined
    // if the user has certain tab-management extensions installed that
    // cancel tab creation. Without this guard, the subsequent
    // chrome.scripting.executeScript({target:{tabId:undefined}}) would
    // throw a cryptic Chrome error.
    installBaiduChrome({ simulateMissingTabId: true });

    await expect(reverseSearchUpload('baidu', 'data:image/png;base64,QUJDRA==')).rejects.toThrow(
      'Failed to open Baidu reverse-search tab'
    );
  });

  it('handles unknown MIME by using the .jpg fallback in the upload filename', async () => {
    vi.useFakeTimers();
    const harness = installBaiduChrome({ tabId: 5 });

    const promise = reverseSearchUpload('baidu', 'data:image/avif;base64,QUJDRA==');
    await vi.advanceTimersByTimeAsync(0);
    harness.fireOnUpdated(5, { status: 'complete' });
    await vi.advanceTimersByTimeAsync(1500);

    await promise;
    const scriptCall = harness.executeScript.mock.calls[0][0] as {
      args: [string, string, string];
    };
    // extMap has no 'image/avif' entry → default '.jpg' kicks in.
    expect(scriptCall.args[1]).toBe('image.jpg');
    expect(scriptCall.args[2]).toBe('image/avif');

    vi.useRealTimers();
  });
});
