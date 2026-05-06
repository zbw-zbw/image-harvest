// Unit tests for pages/reverse-search.ts — the 226-line IIFE that runs
// inside the intermediate tab opened by the sidepanel's reverse-image-
// search action. Since the entire file is a single top-level IIFE with
// no exports, we drive it via vi.resetModules() + dynamic import per
// scenario (same pattern as tests/pages-popup.test.tsx).
//
// Coverage targets:
//   - param guard: missing engine / missing imageUrl → showError
//   - 4 engine dispatch: google / tineye (form upload) + yandex / baidu
//     (background-bridge with redirectUrl / window.close fallback)
//   - fallbackUrlSearch: 4 whitelisted URL builders + unknown engine
//     → showError path
//   - FETCH_IMAGE_DATA failure → fallbackUrlSearch
//   - top-level try/catch: thrown error → showError('Search failed: …')
//   - internal helpers: dataUrlToBlob MIME parsing + guessFileName URL
//     pathname extraction + ext map fallback
//
// The IIFE touches chrome.runtime.sendMessage + window.location +
// window.close + form.submit + DataTransfer + atob — all stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// Test-scoped stubs
// ─────────────────────────────────────────────────────────────────────

interface ChromeStub {
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
  };
}

let chromeStub: ChromeStub;
let submitMock: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;
let hrefSetter: ReturnType<typeof vi.fn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

/**
 * Install the full jsdom scaffold the IIFE needs:
 *   - #status element with a <p> child (error/progress messages)
 *   - window.location with search / and an href setter spy
 *   - window.close spy
 *   - chrome.runtime.sendMessage mock
 *   - HTMLFormElement.prototype.submit spy
 *   - DataTransfer stub (jsdom doesn't implement it)
 */
function installScaffold(search: string): void {
  document.body.innerHTML = '<div id="status"><p></p></div>';

  // Location: the IIFE reads both .search (for URLSearchParams) and
  // writes to .href (fallback redirect). Define a proxy so both
  // patterns work against the same mock state.
  hrefSetter = vi.fn();
  const locationStub = {
    search,
    href: 'http://localhost/pages/reverse-search.html' + search,
    get hash(): string {
      return '';
    },
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new Proxy(locationStub, {
      set(target, prop, value) {
        if (prop === 'href') {
          hrefSetter(value);
          return true;
        }
        (target as Record<string, unknown>)[prop as string] = value;
        return true;
      },
    }),
  });

  closeMock = vi.fn();
  window.close = closeMock;

  chromeStub = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

  submitMock = vi.fn();
  HTMLFormElement.prototype.submit = submitMock;

  // jsdom does not implement DataTransfer — stub the minimum surface
  // pages/reverse-search uses (items.add + files getter).
  class FakeDataTransfer {
    files: unknown[] = [];
    items = {
      add: (file: unknown) => {
        this.files.push(file);
      },
    };
  }
  (globalThis as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer;

  // jsdom's HTMLInputElement.files setter strictly requires a FileList
  // instance. Our FakeDataTransfer returns a plain array, so the
  // `input.files = dataTransfer.files` assignment in pages/reverse-search
  // throws TypeError and the whole form-upload path short-circuits into
  // the outer try/catch. Override the setter to accept anything — the
  // IIFE only reads back `input.files` indirectly (via form submission
  // which we're spying on anyway).
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() {
      return (this as unknown as { _files?: unknown })._files ?? null;
    },
    set(value: unknown) {
      (this as unknown as { _files?: unknown })._files = value;
    },
  });

  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/**
 * Reset modules then dynamic-import the IIFE. The IIFE's top-level is
 * `(async function () { ... })()` so awaiting the import does NOT wait
 * for it to finish — we drain the microtask queue a few times instead.
 */
async function runIIFE(): Promise<void> {
  vi.resetModules();
  await import('../pages/reverse-search');
  // Drain microtasks so the awaited sendMessage + subsequent dispatch
  // complete before the test inspects side effects.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  delete (globalThis as unknown as { DataTransfer?: unknown }).DataTransfer;
  consoleErrorSpy?.mockRestore();
  consoleWarnSpy?.mockRestore();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// Bootstrap guards
// ─────────────────────────────────────────────────────────────────────

describe('bootstrap guards', () => {
  it('returns silently when #status element is missing (no crash)', async () => {
    installScaffold('?engine=google&imageUrl=https://x.com/a.png');
    // Remove the status shell BEFORE the IIFE runs.
    document.body.innerHTML = '';
    await expect(runIIFE()).resolves.toBeUndefined();
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('shows "Missing search parameters" when engine is absent', async () => {
    installScaffold('?imageUrl=https://x.com/a.png');
    await runIIFE();
    const status = document.getElementById('status')!;
    expect(status.innerHTML).toContain('Missing search parameters');
    // Pin: a close-tab link is always offered alongside the error so
    // the user isn't stuck in a dead-end tab.
    expect(status.querySelector('#close-tab')).not.toBeNull();
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('shows "Missing search parameters" when imageUrl is absent', async () => {
    installScaffold('?engine=google');
    await runIIFE();
    expect(document.getElementById('status')!.innerHTML).toContain('Missing search parameters');
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('close-tab anchor click calls window.close()', async () => {
    installScaffold('?engine=');
    await runIIFE();
    const closeLink = document.getElementById('close-tab') as HTMLAnchorElement;
    closeLink.click();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FETCH_IMAGE_DATA → engine dispatch
// ─────────────────────────────────────────────────────────────────────

describe('engine dispatch (form-upload engines)', () => {
  // Minimal valid data URL: 1×1 transparent PNG. atob(dataPart) must
  // succeed so dataUrlToBlob doesn't throw; the exact bytes don't
  // matter for dispatch-level assertions.
  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('google: FETCH_IMAGE_DATA success → submits form to lens.google.com', async () => {
    installScaffold('?engine=google&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      dataUrl: tinyPngDataUrl,
    });
    await runIIFE();

    // Pin: form is injected and submitted. A regression returning
    // the data URL directly (rather than form-uploading the decoded
    // blob) would break Lens's multipart/form-data contract.
    expect(submitMock).toHaveBeenCalledTimes(1);
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form.action).toBe('https://lens.google.com/v3/upload');
    expect(form.enctype).toBe('multipart/form-data');
    expect(form.method).toBe('post');
    // Hidden file input uses the engine's expected field name.
    const fileInput = form.querySelector<HTMLInputElement>('input[type=file]');
    expect(fileInput?.name).toBe('encoded_image');
  });

  it('tineye: success → submits form to tineye.com/search with field "image"', async () => {
    installScaffold('?engine=tineye&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      dataUrl: tinyPngDataUrl,
    });
    await runIIFE();

    expect(submitMock).toHaveBeenCalledTimes(1);
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form.action).toBe('https://tineye.com/search');
    const fileInput = form.querySelector<HTMLInputElement>('input[type=file]');
    // Pin: tineye uses "image" whereas google uses "encoded_image".
    // Swapping these would cause the upload to silently be ignored.
    expect(fileInput?.name).toBe('image');
  });

  it('unknown engine: shows "Unknown search engine" error after successful image fetch', async () => {
    installScaffold('?engine=bing&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      dataUrl: tinyPngDataUrl,
    });
    await runIIFE();
    expect(document.getElementById('status')!.innerHTML).toContain('Unknown search engine: bing');
    expect(submitMock).not.toHaveBeenCalled();
  });
});

describe('engine dispatch (background-bridge engines)', () => {
  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('yandex: REVERSE_SEARCH_UPLOAD returns redirectUrl → window.location.href set', async () => {
    installScaffold('?engine=yandex&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    // 1st call: FETCH_IMAGE_DATA. 2nd call: REVERSE_SEARCH_UPLOAD.
    chromeStub.runtime.sendMessage
      .mockResolvedValueOnce({ success: true, dataUrl: tinyPngDataUrl })
      .mockResolvedValueOnce({
        success: true,
        redirectUrl: 'https://yandex.ru/images/search?rpt=imageview&url=...',
      });
    await runIIFE();

    // Pin: yandex success path redirects the tab rather than opening
    // a new one (the intermediate tab becomes the results tab).
    expect(hrefSetter).toHaveBeenCalledWith(
      'https://yandex.ru/images/search?rpt=imageview&url=...'
    );
  });

  it('yandex: REVERSE_SEARCH_UPLOAD returns {success:false} → fallback URL search', async () => {
    installScaffold('?engine=yandex&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage
      .mockResolvedValueOnce({ success: true, dataUrl: tinyPngDataUrl })
      .mockResolvedValueOnce({ success: false });
    await runIIFE();

    // Pin: fallback goes to yandex.com (not yandex.ru) — the public
    // URL-based search endpoint.
    const target = hrefSetter.mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('https://yandex.com/images/search');
    expect(target).toContain('rpt=imageview');
  });

  it('yandex: REVERSE_SEARCH_UPLOAD throws → falls back to URL search (background-upload error swallowed)', async () => {
    installScaffold('?engine=yandex&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage
      .mockResolvedValueOnce({ success: true, dataUrl: tinyPngDataUrl })
      .mockRejectedValueOnce(new Error('bg crashed'));
    await runIIFE();
    const target = hrefSetter.mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('https://yandex.com/images/search');
    // Pin: console.warn logged but not re-thrown.
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('baidu: REVERSE_SEARCH_UPLOAD success → window.close() (intermediate tab discarded)', async () => {
    installScaffold('?engine=baidu&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage
      .mockResolvedValueOnce({ success: true, dataUrl: tinyPngDataUrl })
      .mockResolvedValueOnce({ success: true });
    await runIIFE();

    // Pin: baidu's success path closes THIS tab because the
    // background service worker has already opened the baidu.com
    // results tab separately via scripting.executeScript.
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('baidu: REVERSE_SEARCH_UPLOAD fails → fallback to graph.baidu.com URL search', async () => {
    installScaffold('?engine=baidu&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage
      .mockResolvedValueOnce({ success: true, dataUrl: tinyPngDataUrl })
      .mockResolvedValueOnce({ success: false });
    await runIIFE();
    const target = hrefSetter.mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('https://graph.baidu.com/details');
  });
});

// ─────────────────────────────────────────────────────────────────────
// FETCH_IMAGE_DATA failure paths
// ─────────────────────────────────────────────────────────────────────

describe('FETCH_IMAGE_DATA failure → fallback URL search', () => {
  it('undefined response → google fallback URL', async () => {
    installScaffold('?engine=google&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce(undefined);
    await runIIFE();
    const target = hrefSetter.mock.calls.at(-1)?.[0] as string;
    expect(target).toBe(
      'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent('https://x.com/a.png')
    );
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('{success:false} response → tineye fallback URL', async () => {
    installScaffold('?engine=tineye&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({ success: false });
    await runIIFE();
    const target = hrefSetter.mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('https://tineye.com/search?url=');
  });

  it('{success:true} but dataUrl missing → fallback URL', async () => {
    installScaffold('?engine=google&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      dataUrl: undefined,
    });
    await runIIFE();
    const target = hrefSetter.mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('https://lens.google.com/uploadbyurl');
  });

  it('fallbackUrlSearch with unknown engine shows "Fallback search not available" error', async () => {
    // Use bing to hit FETCH_IMAGE_DATA success + unknown-engine path.
    // But to test fallback-with-unknown-engine we need FETCH to fail
    // WHILE engine is not in the fallback whitelist.
    installScaffold('?engine=bing&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockResolvedValueOnce(undefined);
    await runIIFE();
    expect(document.getElementById('status')!.innerHTML).toContain('Fallback search not available');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Top-level try/catch
// ─────────────────────────────────────────────────────────────────────

describe('top-level error handling', () => {
  it('chrome.runtime.sendMessage throws → "Search failed: …" error shown', async () => {
    installScaffold('?engine=google&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockRejectedValueOnce(new Error('network down'));
    await runIIFE();
    // Pin: the outer try/catch catches ANY error (including
    // sendMessage rejection) and surfaces a user-readable message
    // rather than leaving the page stuck on "Downloading image...".
    expect(document.getElementById('status')!.innerHTML).toContain('Search failed: network down');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('non-Error throw (string) is stringified via String(error)', async () => {
    installScaffold('?engine=google&imageUrl=https%3A%2F%2Fx.com%2Fa.png');
    chromeStub.runtime.sendMessage.mockRejectedValueOnce('raw string rejection');
    await runIIFE();
    // Pin: the `error instanceof Error ? .message : String(error)`
    // fallback. Non-Error rejections (legacy code that `throw "..."`)
    // still render a readable message.
    expect(document.getElementById('status')!.innerHTML).toContain('raw string rejection');
  });
});
