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
  // New flow: no probe stage — executeScript is only called once with
  // `files`. Rejecting it triggers the outer-catch error classifier.
  chromeStub.scripting.executeScript.mockRejectedValue(new Error(rejectMessage));
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
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    // Post-injection PING must succeed for the happy path.
    let pingCount = 0;
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockImplementation(async () => {
      pingCount++;
      if (pingCount === 1) throw new Error('No content script'); // initial PING fails
      return { pong: true }; // post-injection PING succeeds
    });

    const result = await injectContentScript(1);

    expect(result).toEqual({ success: true });
    // New flow: only one executeScript call (files injection, no probe).
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(1);
    const filesCall = chromeStub.scripting.executeScript.mock.calls[0];
    expect(filesCall[0]).toMatchObject({
      target: { tabId: 1, frameIds: [0] },
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

describe('injectContentScript — post-injection PING verification', () => {
  it('classifies "showing error" executeScript reject → INJECTION_FAILED via outer catch', async () => {
    // New flow: no probe stage. executeScript({ files }) rejects with
    // an "error page" message, caught by the outer catch classifier.
    chromeStub.scripting.executeScript.mockRejectedValue(new Error('Frame is showing error page'));

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: expect.stringContaining('browser internal'),
    });
  });

  it('injection succeeds but all post-injection PINGs fail → INJECTION_FAILED with PING message', async () => {
    // Pin: the post-injection PING loop (3 attempts). When all PINGs
    // fail, the injector returns a specific "failed to respond to
    // PING" error — distinct from an executeScript failure.
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    // All sendMessage calls reject (initial PING + 3 post-injection PINGs).

    const result = await injectContentScript(1);

    expect(result).toEqual({
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message: expect.stringContaining('failed to respond to PING'),
    });
  });

  it('injection succeeds + post-injection PING succeeds on 2nd attempt → success', async () => {
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    let pingCount = 0;
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockImplementation(async () => {
      pingCount++;
      // 1st call = initial PING (fails), 2nd = 1st post-injection (fails),
      // 3rd = 2nd post-injection (succeeds)
      if (pingCount <= 2) throw new Error('No content script');
      return { pong: true };
    });

    const result = await injectContentScript(1);
    expect(result).toEqual({ success: true });
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('injection succeeds + first post-injection PING succeeds → success (no extra retries)', async () => {
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    let pingCount = 0;
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockImplementation(async () => {
      pingCount++;
      if (pingCount === 1) throw new Error('No content script'); // initial PING
      return { pong: true }; // first post-injection PING succeeds
    });

    const result = await injectContentScript(1);
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// getContentScriptFiles fallback — manifest missing content_scripts.
// Exercises the warn-only fallback path (L44-45) without exporting the
// helper: we override the manifest and let the injector itself read it
// during a standard injection.
// ─────────────────────────────────────────────────────────────────────

describe('getContentScriptFiles — fallback when manifest is missing content_scripts', () => {
  it('uses the conventional crxjs loader path when manifest.content_scripts is undefined', async () => {
    // Manifest returns NO content_scripts at all — forces fallback
    // to ['assets/main.ts-loader.js'].
    chromeStub.runtime.getManifest.mockReturnValue({ name: 'x' });
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    // Post-injection PING must succeed.
    let pingCount = 0;
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockImplementation(async () => {
      pingCount++;
      if (pingCount === 1) throw new Error('No content script');
      return { pong: true };
    });

    const result = await injectContentScript(1);
    expect(result).toEqual({ success: true });

    // Pin: the hardcoded fallback path. If the manifest declaration
    // ever gets lost in a future crxjs upgrade, this path is at least
    // predictable — and a 404 on this exact name is an easier debug
    // signal than an undefined files array.
    const filesCall = chromeStub.scripting.executeScript.mock.calls.find(
      (call) => 'files' in (call[0] as object)
    );
    expect(filesCall?.[0]).toMatchObject({
      files: ['assets/main.ts-loader.js'],
    });
  });

  it('uses fallback when manifest.content_scripts is an empty array too', async () => {
    // Declared but no js entries — same fallback.
    chromeStub.runtime.getManifest.mockReturnValue({ content_scripts: [] });
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    // Post-injection PING must succeed.
    let pingCount = 0;
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockImplementation(async () => {
      pingCount++;
      if (pingCount === 1) throw new Error('No content script');
      return { pong: true };
    });

    await injectContentScript(1);
    const filesCall = chromeStub.scripting.executeScript.mock.calls.find(
      (call) => 'files' in (call[0] as object)
    );
    expect(filesCall?.[0]).toMatchObject({
      files: ['assets/main.ts-loader.js'],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// chrome.tabs.get rejection inside the restricted-URL guard (L76 area).
// The injector wraps tabs.get in a try/catch and falls through to
// injection so the standard-injection error message is what surfaces.
// ─────────────────────────────────────────────────────────────────────

describe('injectContentScript — tabs.get rejection (L76 inner catch)', () => {
  it('tabs.get throws → swallows error and falls through to standard injection', async () => {
    // Pin: the inner try/catch around chrome.tabs.get. A transient
    // "No tab with id" during injection attempts must NOT short-
    // circuit the whole operation — we still try to inject and let
    // the real error surface from the scripting.executeScript call.
    chromeStub.tabs.get.mockRejectedValueOnce(new Error('No tab with id: 1'));
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: undefined }]);
    // Post-injection PING must succeed.
    let pingCount = 0;
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockImplementation(async () => {
      pingCount++;
      if (pingCount === 1) throw new Error('No content script');
      return { pong: true };
    });

    const result = await injectContentScript(1);
    // Falls through to standard injection which succeeds.
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// injectIntoAllFrames (L152-182) — the all-frames fallback loop.
// Exercises by calling injectContentScript with {allFrames: true}
// along the success path — injectIntoAllFrames is private.
// ─────────────────────────────────────────────────────────────────────

describe('injectContentScript with allFrames — injectIntoAllFrames loop', () => {
  it('PING-success + allFrames=true → enumerates sub-frames and PINGs each (no injection needed)', async () => {
    // Pin: on the already-injected short-circuit, allFrames must
    // still run the per-frame PING sweep. Without it, sub-frames
    // that loaded AFTER the top frame had injected would stay
    // unscanned.
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockResolvedValue({ pong: true }); // every PING succeeds
    chromeStub.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, url: 'https://example.com/' }, // main frame, filtered out
      { frameId: 1, url: 'https://example.com/iframe' },
      { frameId: 2, url: 'chrome://errorpage' }, // restricted, filtered out
    ]);

    const result = await injectContentScript(1, { allFrames: true });
    expect(result).toEqual({ success: true });

    // Verify sub-frame 1 was PINGed.
    expect(chromeStub.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'PING' }, { frameId: 1 });
    // Filter out the initial PING (frameId: 0) to count only per-sub-frame PINGs.
    // frameId 0 (main frame initial PING) and frameId 2 (chrome://) MUST be skipped.
    const subFrameCalls = chromeStub.tabs.sendMessage.mock.calls.filter(
      (c) =>
        c[2] &&
        typeof c[2] === 'object' &&
        'frameId' in (c[2] as object) &&
        (c[2] as { frameId: number }).frameId !== 0
    );
    expect(subFrameCalls).toHaveLength(1);
  });

  it('sub-frame PING rejects → falls through to scripting.executeScript on that frame', async () => {
    // Pin: the per-frame inner try/catch that swaps PING-fail for
    // re-injection on that specific frame. Without this fallback,
    // any iframe that hasn't received its content script yet (because
    // it loaded late) would never get injected — common on SPAs that
    // lazy-mount iframes.
    chromeStub.tabs.sendMessage.mockReset();
    // Initial PING (frameId: 0) succeeds → already-injected short-circuit.
    // Sub-frame PINGs fail → triggers per-frame injection.
    chromeStub.tabs.sendMessage.mockImplementation(
      async (_tabId: number, _msg: unknown, options?: { frameId?: number }) => {
        if (options?.frameId != null && options.frameId !== 0) {
          throw new Error('No content script in sub-frame');
        }
        return { pong: true };
      }
    );
    chromeStub.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, url: 'https://example.com/' },
      { frameId: 5, url: 'https://example.com/deep-iframe' },
    ]);

    await injectContentScript(1, { allFrames: true });

    // scripting.executeScript should have been called for the sub-frame
    // with its specific frameId in the target.
    const frameInjection = chromeStub.scripting.executeScript.mock.calls.find((c) => {
      const opts = c[0] as { target?: { frameIds?: number[] } };
      return opts.target?.frameIds?.[0] === 5;
    });
    expect(frameInjection?.[0]).toMatchObject({
      target: { tabId: 1, frameIds: [5] },
      files: ['assets/main.ts-loader-XXXX.js'],
    });
  });

  it('sub-frame re-injection throws → console.warn + continues to next frame (no total failure)', async () => {
    // Pin: per-frame injection failures must NOT abort the main
    // injection. A single iframe with restrictive CSP would otherwise
    // kill the whole scan even though 99% of the tab works fine.
    chromeStub.tabs.sendMessage.mockReset();
    // Initial PING (frameId: 0) succeeds; sub-frame PINGs fail.
    chromeStub.tabs.sendMessage.mockImplementation(
      async (_tabId: number, _msg: unknown, options?: { frameId?: number }) => {
        if (options?.frameId != null && options.frameId !== 0) {
          throw new Error('sub-frame PING fail');
        }
        return { pong: true };
      }
    );
    chromeStub.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 1, url: 'https://frame1.example.com/' },
      { frameId: 2, url: 'https://frame2.example.com/' },
    ]);
    // ALL per-frame re-injections throw — but the loop should still
    // visit both frames without re-raising.
    chromeStub.scripting.executeScript.mockRejectedValue(new Error('CSP blocks sub-frame'));

    // Must NOT throw.
    const result = await injectContentScript(1, { allFrames: true });
    expect(result).toEqual({ success: true });
    // console.warn fired twice — once per failed sub-frame.
    // (beforeEach spies on console.warn → it's silent but counted.)
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('getAllFrames returns null → early-return without attempting any per-frame work', async () => {
    // Pin: the `if (!frames) return` guard. Chrome may return null
    // for tabs that are navigating / unloading. Without the guard,
    // `frames.filter` would throw TypeError and the outer
    // injectContentScript call would fail even though the top-level
    // injection had already succeeded.
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockResolvedValue({ pong: true });
    chromeStub.webNavigation.getAllFrames.mockResolvedValue(null);

    const result = await injectContentScript(1, { allFrames: true });
    expect(result).toEqual({ success: true });
    // Only the initial PING (frameId: 0) should have fired — no sub-frame PINGs.
    const subFrameCalls = chromeStub.tabs.sendMessage.mock.calls.filter(
      (c) =>
        c[2] &&
        typeof c[2] === 'object' &&
        'frameId' in (c[2] as object) &&
        (c[2] as { frameId: number }).frameId !== 0
    );
    expect(subFrameCalls).toHaveLength(0);
  });

  it('getAllFrames throws → console.warn + injectContentScript still returns success', async () => {
    // Pin: the OUTER try/catch in injectIntoAllFrames. A webNavigation
    // permission hiccup must not fail an otherwise-successful top-
    // level injection.
    chromeStub.tabs.sendMessage.mockReset();
    chromeStub.tabs.sendMessage.mockResolvedValue({ pong: true });
    chromeStub.webNavigation.getAllFrames.mockRejectedValue(
      new Error('webNavigation permission denied')
    );

    const result = await injectContentScript(1, { allFrames: true });
    expect(result).toEqual({ success: true });
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to enumerate frames for all-frames injection:',
      expect.any(Error)
    );
  });
});
