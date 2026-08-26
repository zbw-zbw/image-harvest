// Unit tests for background/link-resolver.ts — the v1.1.0 deep link
// resolver. fetch is globally stubbed per-test; every case asserts the
// og:image → twitter:image → image_src extraction ladder plus the
// safety rails (isAllowedFetchUrl gate, content-type check, redirect
// re-validation, timeout, per-link failure isolation).
//
// The real shared/utils + shared/url-validator are used (pure functions)
// — only the network boundary is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLinkImages, MAX_LINKS_PER_REQUEST } from '../background/link-resolver';

function makeResponse(
  html: string,
  opts?: { url?: string; status?: number; contentType?: string | null }
): Response {
  const status = opts?.status ?? 200;
  const headers = new Headers();
  if (opts?.contentType !== null) {
    headers.set('content-type', opts?.contentType ?? 'text/html; charset=utf-8');
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    url: opts?.url ?? 'https://example.com/page',
    headers,
    text: async () => html,
  } as unknown as Response;
}

/** Route fetch by URL: each entry is [urlToMatch, response]. */
function stubFetch(routes: Array<[string, Response]>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes.find(([match]) => match === url);
    if (route) return route[1];
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────
// Meta extraction ladder: og:image → twitter:image → image_src
// ─────────────────────────────────────────────────────────────────────

describe('resolveLinkImages — meta extraction', () => {
  it('extracts og:image from <meta property content> (attribute order A)', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse(
          '<html><head><meta property="og:image" content="https://cdn.example.com/og.jpg"></head></html>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://cdn.example.com/og.jpg');
    expect(result.images[0].type).toBe('link-resolved');
    // visible:true — user-requested originals survive visible-only filter.
    expect(result.images[0].visible).toBe(true);
    expect(result.images[0].sourceDomain).toBe('example.com');
  });

  it('extracts og:image with content BEFORE property (attribute order B)', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse(
          '<head><meta content="https://cdn.example.com/reversed.png" property="og:image"></head>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/reversed.png');
  });

  it('supports og:image:secure_url variant', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse(
          '<meta property="og:image:secure_url" content="https://cdn.example.com/secure.webp">'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/secure.webp');
  });

  it('falls back to twitter:image when og:image is absent', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse('<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">'),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/tw.jpg');
  });

  it('falls back to twitter:image:src and reversed attribute order', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse('<meta content="https://cdn.example.com/twsrc.gif" name="twitter:image:src">'),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/twsrc.gif');
  });

  it('falls back to <link rel="image_src" href> when both meta tags are absent', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse('<link rel="image_src" href="https://cdn.example.com/src.png">'),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/src.png');
  });

  it('og:image wins when all three are present (priority order)', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse(
          '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">' +
            '<link rel="image_src" href="https://cdn.example.com/src.png">' +
            '<meta property="og:image" content="https://cdn.example.com/og.jpg">'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/og.jpg');
  });

  it('resolves RELATIVE og:image URLs against the final (post-redirect) page URL', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse('<meta property="og:image" content="/uploads/2024/cover.jpg">', {
          url: 'https://example.com/articles/2024',
        }),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://example.com/uploads/2024/cover.jpg');
  });

  it('decodes HTML entities (&amp;) in the og:image attribute value', async () => {
    stubFetch([
      [
        'https://example.com/page',
        makeResponse(
          '<meta property="og:image" content="https://cdn.example.com/a.jpg?x=1&amp;y=2">'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.images[0].url).toBe('https://cdn.example.com/a.jpg?x=1&y=2');
  });

  it('a page with NO meta image counts as failed (not an error)', async () => {
    stubFetch([
      ['https://example.com/page', makeResponse('<html><body>no meta here</body></html>')],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.resolved).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.images).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Safety rails
// ─────────────────────────────────────────────────────────────────────

describe('resolveLinkImages — safety rails', () => {
  it('rejects non-http(s) link URLs before fetching (isAllowedFetchUrl gate)', async () => {
    const fetchMock = stubFetch([]);
    const result = await resolveLinkImages(['ftp://example.com/page', 'not-a-url']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(2);
  });

  it('rejects loopback / private hosts (SSRF hardening)', async () => {
    const fetchMock = stubFetch([]);
    const result = await resolveLinkImages([
      'http://localhost:8080/admin',
      'http://127.0.0.1/x',
      'http://192.168.1.1/router',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(3);
  });

  it('404 response → single link counted as failed', async () => {
    stubFetch([['https://example.com/missing', makeResponse('Not Found', { status: 404 })]]);

    const result = await resolveLinkImages(['https://example.com/missing']);
    expect(result.failed).toBe(1);
    expect(result.resolved).toBe(0);
  });

  it('non-HTML content-type (direct image response) → failed', async () => {
    // Pin: a link that 302-redirects straight to the image binary is NOT
    // treated as a resolved gallery page — the resolver only trusts meta
    // tags it parsed out of an HTML document.
    stubFetch([
      [
        'https://example.com/direct',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/x.jpg">', {
          contentType: 'image/jpeg',
        }),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/direct']);
    expect(result.failed).toBe(1);
  });

  it('re-validates response.url after redirects — redirected-to private host is rejected', async () => {
    stubFetch([
      [
        'https://public.example.com/page',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/og.jpg">', {
          url: 'http://192.168.0.5/hijacked',
        }),
      ],
    ]);

    // Pin: the DNS-rebind / open-redirect bypass — the fetch URL was
    // public but the FINAL URL is private; must not leak the response.
    const result = await resolveLinkImages(['https://public.example.com/page']);
    expect(result.failed).toBe(1);
  });

  it('aborts the fetch after the 10s timeout and counts the link as failed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = resolveLinkImages(['https://slow.example.com/page']);
    // Let workers start (microtask flush) then fire the abort timer.
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.resolved).toBe(0);
  });

  it('network error on one link does not sink the batch (failure isolation)', async () => {
    const okResponse = makeResponse(
      '<meta property="og:image" content="https://cdn.example.com/ok.jpg">'
    );
    const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = input.toString();
      if (url === 'https://ok.example.com/page') return okResponse;
      throw new TypeError('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveLinkImages([
      'https://ok.example.com/page',
      'https://broken.example.com/page',
    ]);
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Batch semantics
// ─────────────────────────────────────────────────────────────────────

describe('resolveLinkImages — batch semantics', () => {
  it('empty input → zeroed result', async () => {
    stubFetch([]);
    const result = await resolveLinkImages([]);
    expect(result).toEqual({ images: [], resolved: 0, failed: 0, results: [] });
  });

  it('dedups identical og:image URLs across different detail pages', async () => {
    stubFetch([
      [
        'https://example.com/a',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/shared.jpg">'),
      ],
      [
        'https://example.com/b',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/shared.jpg">'),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/a', 'https://example.com/b']);
    // Both links RESOLVED, but the image list holds ONE entry — the grid
    // must not show two identical cards.
    expect(result.resolved).toBe(2);
    expect(result.images).toHaveLength(1);
  });

  it(`caps the batch at MAX_LINKS_PER_REQUEST (${MAX_LINKS_PER_REQUEST}) links`, async () => {
    const routes: Array<[string, Response]> = [];
    for (let i = 0; i < MAX_LINKS_PER_REQUEST + 5; i++) {
      routes.push([
        `https://example.com/page-${i}`,
        makeResponse(`<meta property="og:image" content="https://cdn.example.com/img-${i}.jpg">`),
      ]);
    }
    const fetchMock = stubFetch(routes);

    const urls = routes.map(([url]) => url);
    const result = await resolveLinkImages(urls);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_LINKS_PER_REQUEST);
    expect(result.images).toHaveLength(MAX_LINKS_PER_REQUEST);
  });

  it('mixes resolved and failed counts across a batch', async () => {
    stubFetch([
      [
        'https://example.com/ok-1',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/1.jpg">'),
      ],
      [
        'https://example.com/ok-2',
        makeResponse('<meta name="twitter:image" content="https://cdn.example.com/2.jpg">'),
      ],
      ['https://example.com/none', makeResponse('<p>no meta</p>')],
      ['https://example.com/err', makeResponse('Server Error', { status: 500 })],
    ]);

    const result = await resolveLinkImages([
      'https://example.com/ok-1',
      'https://example.com/ok-2',
      'https://example.com/none',
      'https://example.com/err',
    ]);
    expect(result.resolved).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.images.map((i) => i.url).sort()).toEqual([
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg',
    ]);
  });

  it('sends Accept: text/html and credentials: include for same-site links (session cookie)', async () => {
    const fetchMock = stubFetch([
      [
        'https://example.com/page',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/og.jpg">'),
      ],
    ]);

    // Same approximate registrable domain (www.example.com ↔ example.com),
    // mirroring the intranet estate case: *.alibaba-inc.com ↔ *.alibaba-inc.com.
    await resolveLinkImages(['https://example.com/page'], 'https://www.example.com/browse');
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)['Accept']).toContain('text/html');
    // credentials: 'include' — intranet/auth-walled pages need the session
    // cookie; the default 'same-origin' never sends it cross-site from the
    // chrome-extension:// service-worker origin (v1.1.0 smoke: Aone resolve
    // always failed because every fetch landed on an auth redirect).
    expect(init?.credentials).toBe('include');
  });

  it('sends credentials: same-origin for cross-site links (cookie-scoping)', async () => {
    // A hostile page can plant third-party/intranet links among the
    // candidates — those must NOT ride the user's session cookie
    // (CSRF-style credentialed-GET surface, security review M-1).
    const fetchMock = stubFetch([
      [
        'https://internal.company.com/export',
        makeResponse('<meta property="og:image" content="https://cdn.company.com/og.jpg">'),
      ],
    ]);

    await resolveLinkImages(['https://internal.company.com/export'], 'https://evil.com/bait');
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.credentials).toBe('same-origin');
  });

  it('sends credentials: same-origin when no sourceUrl is given (conservative fallback)', async () => {
    const fetchMock = stubFetch([
      [
        'https://example.com/page',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/og.jpg">'),
      ],
    ]);

    await resolveLinkImages(['https://example.com/page']);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.credentials).toBe('same-origin');
  });

  it('treats multi-label public suffixes as separate sites (a.co.uk vs b.co.uk)', async () => {
    const fetchMock = stubFetch([
      [
        'https://shop.a.co.uk/item',
        makeResponse('<meta property="og:image" content="https://cdn.co.uk/og.jpg">'),
      ],
    ]);

    await resolveLinkImages(['https://shop.a.co.uk/item'], 'https://evil.b.co.uk/bait');
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.credentials).toBe('same-origin');
  });
});

// ─────────────────────────────────────────────────────────────────────
// JSON-LD fallback: 4th rung after og:image → twitter:image → image_src
// (SPA pages ship no og:image in server HTML but often embed ld+json)
// ─────────────────────────────────────────────────────────────────────

describe('resolveLinkImages — JSON-LD image fallback', () => {
  it('falls back to ld+json image (string form) when no meta tags exist', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<html><head><script type="application/ld+json">{"@type":"ImageObject","image":"https://cdn.example.com/jsonld.jpg"}</script></head></html>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.resolved).toBe(1);
    expect(result.images[0].url).toBe('https://cdn.example.com/jsonld.jpg');
  });

  it('handles the ImageObject form { image: { url } }', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<script type="application/ld+json">{"image":{"url":"https://cdn.example.com/object.jpg"}}</script>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.resolved).toBe(1);
    expect(result.images[0].url).toBe('https://cdn.example.com/object.jpg');
  });

  it('handles @graph arrays and image arrays (first usable entry wins)', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"image":[{"url":"https://cdn.example.com/graph-1.jpg"},{"url":"https://cdn.example.com/graph-2.jpg"}]}]}</script>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.resolved).toBe(1);
    expect(result.images[0].url).toBe('https://cdn.example.com/graph-1.jpg');
  });

  it('skips malformed ld+json blocks and still finds a later valid one', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<script type="application/ld+json">{broken json}</script>' +
            '<script type="application/ld+json">{"image":"https://cdn.example.com/valid.jpg"}</script>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.resolved).toBe(1);
    expect(result.images[0].url).toBe('https://cdn.example.com/valid.jpg');
  });

  it('og:image still wins over ld+json (priority order unchanged)', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<meta property="og:image" content="https://cdn.example.com/og.jpg">' +
            '<script type="application/ld+json">{"image":"https://cdn.example.com/jsonld.jpg"}</script>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.images[0].url).toBe('https://cdn.example.com/og.jpg');
  });

  it('ld+json without an image field → no-meta-image failure', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<script type="application/ld+json">{"@type":"WebPage","name":"Home"}</script>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.resolved).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].reason).toBe('no-meta-image');
  });

  it('rejects a whitespace-only og:image instead of resolving the page itself', async () => {
    // `new URL(' ', pageUrl)` parses to the PAGE (WHATWG strips the space),
    // which would inject a fake "original" pointing at the HTML document.
    stubFetch([
      ['https://example.com/page', makeResponse('<meta property="og:image" content=" ">')],
    ]);

    const result = await resolveLinkImages(['https://example.com/page']);
    expect(result.resolved).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].reason).toBe('no-meta-image');
    expect(result.images).toHaveLength(0);
  });

  it('rejects a whitespace-only JSON-LD image instead of resolving the page itself', async () => {
    stubFetch([
      [
        'https://example.com/spa',
        makeResponse(
          '<script type="application/ld+json">{"@type":"ImageObject","image":" "}</script>'
        ),
      ],
    ]);

    const result = await resolveLinkImages(['https://example.com/spa']);
    expect(result.resolved).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].reason).toBe('no-meta-image');
    expect(result.images).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-link outcome reporting (v1.1.0 smoke: "resolve failed" must say
// WHICH link failed and WHY — not one aggregate number)
// ─────────────────────────────────────────────────────────────────────

describe('resolveLinkImages — per-link results', () => {
  it('reports status + reason per link across a mixed batch', async () => {
    stubFetch([
      [
        'https://example.com/ok',
        makeResponse('<meta property="og:image" content="https://cdn.example.com/ok.jpg">'),
      ],
      ['https://example.com/none', makeResponse('<p>no meta anywhere</p>')],
      ['https://example.com/err', makeResponse('nope', { status: 502 })],
    ]);

    const result = await resolveLinkImages([
      'https://example.com/ok',
      'https://example.com/none',
      'https://example.com/err',
    ]);

    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toMatchObject({ url: 'https://example.com/ok', status: 'resolved' });
    expect(result.results[1]).toMatchObject({
      url: 'https://example.com/none',
      status: 'failed',
      reason: 'no-meta-image',
    });
    expect(result.results[2]).toMatchObject({
      url: 'https://example.com/err',
      status: 'failed',
      reason: 'http-error',
    });
  });

  it('network errors surface as reason: network-error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveLinkImages(['https://example.com/down']);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({
      url: 'https://example.com/down',
      status: 'failed',
      reason: 'network-error',
    });
  });

  it('SSRF-guard rejections surface as reason: blocked', async () => {
    // No fetch stub needed — the URL is rejected before any network call.
    const result = await resolveLinkImages(['http://127.0.0.1:8080/admin']);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({
      url: 'http://127.0.0.1:8080/admin',
      status: 'failed',
      reason: 'blocked',
    });
  });
});
