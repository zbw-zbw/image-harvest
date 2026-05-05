// Unit tests for background/injector.ts — covers the catch-block error
// classifier which maps free-form chrome.scripting.executeScript reject
// messages to stable ERROR_CODES the UI can branch on.
//
// Strategy:
//   - PING (sendMessageToTabWithTimeout) is forced to reject so the
//     "already injected" short-circuit never fires.
//   - chrome.tabs.get returns an accessible URL so the restricted-URL
//     short-circuit doesn't fire either.
//   - The probe (chrome.scripting.executeScript with a `func`) returns
//     `{ result: false }` so we fall through to the final standard
//     injection (chrome.scripting.executeScript with `files`).
//   - The standard injection then rejects with whatever message we want
//     to classify.
//
// This setup pins the error-message → ERROR_CODES mapping that every
// caller (sidepanel, popup, multi-tab extractor) relies on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../shared/constants';

interface ScriptingStub {
  executeScript: ReturnType<typeof vi.fn>;
}
interface TabsStub {
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
}
interface RuntimeStub {
  getManifest: ReturnType<typeof vi.fn>;
}
interface WebNavStub {
  getAllFrames: ReturnType<typeof vi.fn>;
}
interface ChromeStub {
  scripting: ScriptingStub;
  tabs: TabsStub;
  runtime: RuntimeStub;
  webNavigation: WebNavStub;
}

function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    scripting: {
      executeScript: vi.fn(),
    },
    tabs: {
      // Accessible URL by default — keeps the restricted-URL guard
      // from short-circuiting.
      get: vi.fn(async () => ({ id: 1, url: 'https://example.com/page' })),
      // PING rejects → forces the injection path. Per-test mocks can
      // override this with mockReset+mockResolvedValue if needed.
      sendMessage: vi.fn(async () => {
        throw new Error('No content script');
      }),
    },
    runtime: {
      getManifest: vi.fn(() => ({
        content_scripts: [{ js: ['assets/main.ts-loader-XXXX.js'] }],
      })),
    },
    webNavigation: {
      getAllFrames: vi.fn(async () => []),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = stub;
  return stub;
}

const { injectContentScript } = await import('../background/injector');

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
  // Silence the console.error calls that the injector emits inside its
  // outer catch block — they're expected for the failure-path tests.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  vi.restoreAllMocks();
});

/**
 * Wire scripting.executeScript so the probe call (with `func`) returns
 * a "not yet injected" probe result, and the subsequent standard
 * injection (with `files`) rejects with the supplied error.
 */
function installInjectionFlow(rejectMessage: string): void {
  chromeStub.scripting.executeScript.mockImplementation(
    async (opts: { func?: unknown; files?: unknown }) => {
      if (opts.func) {
        // Probe: report "no existing globals" so we fall through.
        return [{ result: false }];
      }
      if (opts.files) {
        // Standard injection: throw the classified message.
        throw new Error(rejectMessage);
      }
      return [];
    }
  );
}

describe('injectContentScript — happy path', () => {
  it('returns { success: true } when PING already responds (already-injected short-circuit)', async () => {
    // Override the default sendMessage stub to resolve PING.
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockResolvedValue({ pong: true });

    const result = await injectContentScript(1);

    expect(result).toEqual({ success: true });
    // Standard injection should never be called when PING succeeds.
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('returns { success: true } after a successful standard injection', async () => {
    chromeStub.scripting.executeScript.mockImplementation(
      async (opts: { func?: unknown; files?: unknown }) => {
        if (opts.func) return [{ result: false }];
        if (opts.files) return [{ result: undefined }];
        return [];
      }
    );

    const result = await injectContentScript(1);

    expect(result).toEqual({ success: true });
    // Both the probe and the standard injection should have been called.
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(2);
    // Standard injection used the manifest-derived files list.
    const filesCall = chromeStub.scripting.executeScript.mock.calls.find(
      (call) => 'files' in (call[0] as object)
    );
    expect(filesCall?.[0]).toMatchObject({
      target: { tabId: 1 },
      files: ['assets/main.ts-loader-XXXX.js'],
    });
  });
});

describe('injectContentScript — restricted-URL short-circuit', () => {
  it('returns INJECTION_FAILED with the restricted-page message when chrome.tabs.get reports a chrome:// URL', async () => {
    chromeStub.tabs.get.mockResolvedValue({ id: 1, url: 'chrome://settings' });

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: expect.stringContaining('browser internal'),
    });
    // Should never have attempted any executeScript.
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('returns INJECTION_FAILED when the tab is in "unloaded" status', async () => {
    chromeStub.tabs.get.mockResolvedValue({
      id: 1,
      url: 'https://example.com',
      status: 'unloaded',
    });

    const result = await injectContentScript(1);

    expect(result).toMatchObject({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
    });
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('injectContentScript — error classification (outer catch)', () => {
  it('classifies "Cannot access a chrome:" → INJECTION_FAILED with restricted-page message', async () => {
    installInjectionFlow('Cannot access a chrome:// URL');

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: expect.stringContaining('browser internal'),
    });
  });

  it('classifies generic "Cannot access" → INJECTION_FAILED with restricted-page message', async () => {
    installInjectionFlow('Cannot access contents of url');

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: expect.stringContaining('browser internal'),
    });
  });

  it('classifies "prohibited" → INJECTION_FAILED with restricted-page message', async () => {
    installInjectionFlow(
      'Extension manifest must request permission to access this host (prohibited)'
    );

    const result = await injectContentScript(1);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toBe(ERROR_CODES.INJECTION_FAILED);
      expect(result.message).toContain('browser internal');
    }
  });

  it('classifies "error page" → INJECTION_FAILED with restricted-page message', async () => {
    installInjectionFlow('The tab is showing an error page');

    const result = await injectContentScript(1);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toBe(ERROR_CODES.INJECTION_FAILED);
      expect(result.message).toContain('browser internal');
    }
  });

  it('classifies "CSP" → CSP_BLOCKED with the manual-download workaround', async () => {
    installInjectionFlow('Refused to execute inline script because it violates CSP');

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.CSP_BLOCKED,
      message: expect.stringContaining('security policy'),
      workaround: expect.stringContaining('Open in new tab'),
    });
  });

  it('classifies "content script" message → CSP_BLOCKED with workaround', async () => {
    installInjectionFlow('Cannot inject content script on this page');

    const result = await injectContentScript(1);

    expect(result).toMatchObject({
      success: false,
      error: ERROR_CODES.CSP_BLOCKED,
      workaround: expect.any(String),
    });
  });

  it('falls through to INJECTION_FAILED with the raw message for unrecognized errors', async () => {
    installInjectionFlow('Some unexpected internal error: 0x42');

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: 'Some unexpected internal error: 0x42',
    });
    // No workaround field for the generic bucket — the UI uses its
    // presence to decide whether to surface the manual-download tip.
    expect((result as { workaround?: string }).workaround).toBeUndefined();
  });
});

describe('injectContentScript — probe-stage classification', () => {
  it('classifies probe-stage "showing error" reject → INJECTION_FAILED with the failed-load message', async () => {
    // The probe (the executeScript call WITH `func`) rejects with an
    // "error page" message. injector's probe-stage catch matches this
    // and returns the failed-load variant of the message — distinct
    // from the outer catch's restricted-page variant.
    chromeStub.scripting.executeScript.mockImplementation(async (opts: { func?: unknown }) => {
      if (opts.func) throw new Error('Frame is showing error page');
      return [];
    });

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: expect.stringContaining('failed to load'),
    });
  });
});
