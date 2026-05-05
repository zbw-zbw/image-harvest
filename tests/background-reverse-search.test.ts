// Unit tests for background/reverse-search.ts.
//
// Coverage:
//   - fetchImageData: ok / non-ok / default-mime fallback
//   - reverseSearchUpload: dispatch table (unknown engine throws,
//     baidu vs yandex routing) + MIME → file extension map
//   - uploadToYandex (exercised through reverseSearchUpload):
//     two cbir_id response shapes, HTTP failure, no-cbir_id throw
//
// Skipped on purpose:
//   - uploadToBaidu — depends on chrome.tabs.onUpdated + 10s timeout
//     + chrome.scripting.executeScript injecting into a real Baidu
//     page. Already covered by e2e. ROI for unit-level mocking is low.
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
}): Response {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
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

  it('falls back to image/png when the response omits Content-Type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () =>
      makeResponse({
        body: new Uint8Array([0x41]).buffer,
        headers: {}, // no Content-Type
      })
    );

    const dataUrl = await fetchImageData('https://x.com/a');

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
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
