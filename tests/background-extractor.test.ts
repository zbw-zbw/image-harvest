// Unit tests for background/extractor.ts — focuses on
// processMultiTabExtract, the multi-tab orchestration whose contract
// is hard to assert in e2e:
//   - emits one DOWNLOAD_PROGRESS broadcast per tab (success OR fail)
//   - broadcast payload shape: { type, completed, total, current, imageCount }
//   - aggregates images across tabs with per-tab metadata stamped on
//   - per-tab failures are swallowed; the loop continues
//
// Strategy:
//   - PING (chrome.tabs.sendMessage with type=PING) resolves so
//     injectContentScript short-circuits to { success: true } without
//     ever calling chrome.scripting.executeScript.
//   - The subsequent EXTRACT_IMAGES sendMessage returns a controllable
//     image list per tab.
//   - We push a fake port into uiPorts to capture broadcasts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_TYPES } from '../shared/constants';

interface ChromeStub {
  tabs: {
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
  runtime: { getManifest: ReturnType<typeof vi.fn> };
  webNavigation: { getAllFrames: ReturnType<typeof vi.fn> };
}

interface TabFixture {
  id: number;
  title: string;
  url: string;
  index?: number;
  /** Images returned by EXTRACT_IMAGES, or null to make sendMessage reject. */
  images: Array<{ url: string }> | null;
  /** When true, chrome.tabs.get reports a chrome:// URL → restricted-skip path. */
  restricted?: boolean;
}

function installChromeStub(tabs: TabFixture[]): ChromeStub {
  const byId = new Map(tabs.map((t) => [t.id, t] as const));

  const sendMessage = vi.fn(async (tabId: number, message: { type: string }) => {
    const fixture = byId.get(tabId);
    if (!fixture) throw new Error(`Unknown tabId ${tabId}`);

    if (message.type === MESSAGE_TYPES.PING) {
      // Short-circuit injectContentScript via the "already-injected" path.
      return { pong: true };
    }
    if (message.type === MESSAGE_TYPES.EXTRACT_IMAGES) {
      if (fixture.images === null) {
        throw new Error('Extraction failed in tab ' + tabId);
      }
      return { images: fixture.images };
    }
    // Live monitor messages etc — no-op.
    return undefined;
  });

  const stub: ChromeStub = {
    tabs: {
      query: vi.fn(async () => [{ id: tabs[0]?.id ?? 0 }]),
      get: vi.fn(async (id: number) => {
        const t = byId.get(id);
        if (!t) throw new Error(`Unknown tabId ${id}`);
        return {
          id: t.id,
          title: t.title,
          url: t.restricted ? 'chrome://settings' : t.url,
          index: t.index ?? 0,
        };
      }),
      sendMessage,
    },
    scripting: {
      // Should never be called when PING short-circuits, but keep a
      // safety stub so an accidental call surfaces as "called".
      executeScript: vi.fn(),
    },
    runtime: {
      getManifest: vi.fn(() => ({ content_scripts: [{ js: ['x.js'] }] })),
    },
    webNavigation: {
      getAllFrames: vi.fn(async () => []),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = stub;
  return stub;
}

const { processMultiTabExtract, getImagesFromTab } = await import('../background/extractor');
const { uiPorts } = await import('../background/utils');

interface BroadcastCapture {
  type: string;
  completed: number;
  total: number;
  current: string;
  imageCount: number;
}

function attachBroadcastCapture(): BroadcastCapture[] {
  const captured: BroadcastCapture[] = [];
  const port = {
    postMessage: (msg: unknown) => {
      captured.push(msg as BroadcastCapture);
    },
  };
  uiPorts.add(port as unknown as chrome.runtime.Port);
  return captured;
}

let chromeStub: ChromeStub;

beforeEach(() => {
  uiPorts.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  uiPorts.clear();
  vi.restoreAllMocks();
});

describe('processMultiTabExtract — broadcast contract', () => {
  it('emits one DOWNLOAD_PROGRESS broadcast per tab with monotonically increasing imageCount', async () => {
    chromeStub = installChromeStub([
      { id: 1, title: 'Tab one', url: 'https://a.com', images: [{ url: 'a1' }, { url: 'a2' }] },
      { id: 2, title: 'Tab two', url: 'https://b.com', images: [{ url: 'b1' }] },
      { id: 3, title: 'Tab three', url: 'https://c.com', images: [] },
    ]);
    const captured = attachBroadcastCapture();

    const result = await processMultiTabExtract([1, 2, 3]);

    expect(result.success).toBe(true);
    expect(result.tabCount).toBe(3);
    expect(result.images).toHaveLength(3);

    expect(captured).toHaveLength(3);
    // Every broadcast must carry the canonical shape.
    for (const msg of captured) {
      expect(msg.type).toBe(MESSAGE_TYPES.DOWNLOAD_PROGRESS);
      expect(msg.total).toBe(3);
    }
    // completed counter advances 1→3 with current = title and a
    // monotonically non-decreasing imageCount.
    expect(captured[0]).toMatchObject({ completed: 1, current: 'Tab one', imageCount: 2 });
    expect(captured[1]).toMatchObject({ completed: 2, current: 'Tab two', imageCount: 3 });
    expect(captured[2]).toMatchObject({ completed: 3, current: 'Tab three', imageCount: 3 });
  });

  it('still broadcasts progress for tabs whose extraction throws (failure is swallowed, not propagated)', async () => {
    chromeStub = installChromeStub([
      { id: 1, title: 'Good', url: 'https://a.com', images: [{ url: 'a1' }] },
      { id: 2, title: 'Bad', url: 'https://b.com', images: null }, // EXTRACT_IMAGES rejects
      { id: 3, title: 'AlsoGood', url: 'https://c.com', images: [{ url: 'c1' }] },
    ]);
    const captured = attachBroadcastCapture();

    const result = await processMultiTabExtract([1, 2, 3]);

    // The bad tab contributes 0 images but does NOT abort the run.
    expect(result.images.map((i) => (i as { url: string }).url)).toEqual(['a1', 'c1']);
    expect(captured).toHaveLength(3);
    // Progress for the failed tab keeps total=3 and reports the same
    // imageCount as the previous successful tab — proves the loop
    // continued past the throw without resetting state.
    expect(captured[1]).toMatchObject({ completed: 2, total: 3, imageCount: 1 });
    // The current tab title for the failure case falls back to 'Tab N'
    // because tabTitle is only assigned AFTER extractFromSingleTab
    // resolves — when it throws the catch block leaves tabTitle at
    // its pre-loop default.
    expect(captured[1].current).toBe('Tab 2');
  });

  it('skips restricted-URL tabs silently (zero images, broadcast still fires)', async () => {
    chromeStub = installChromeStub([
      { id: 1, title: 'Settings', url: '', restricted: true, images: [] },
      { id: 2, title: 'OK', url: 'https://b.com', images: [{ url: 'b1' }] },
    ]);
    const captured = attachBroadcastCapture();

    const result = await processMultiTabExtract([1, 2]);

    expect(result.images).toHaveLength(1);
    expect(captured).toHaveLength(2);
    // Restricted tab still gets a broadcast — UI keeps progress moving.
    expect(captured[0]).toMatchObject({ completed: 1, total: 2, imageCount: 0 });
    expect(captured[1]).toMatchObject({ completed: 2, total: 2, imageCount: 1 });
  });
});

describe('processMultiTabExtract — image metadata stamping', () => {
  it('stamps tabId / tabTitle / tabUrl / tabIndex / isCurrentTab on every extracted image', async () => {
    chromeStub = installChromeStub([
      { id: 7, title: 'Seven', url: 'https://seven.com', index: 4, images: [{ url: 's1' }] },
      {
        id: 9,
        title: 'Nine',
        url: 'https://nine.com',
        index: 5,
        images: [{ url: 'n1' }, { url: 'n2' }],
      },
    ]);
    // Make tab 9 the "current" tab.
    const stub = chromeStub;
    stub.tabs.query.mockResolvedValue([{ id: 9 }]);
    attachBroadcastCapture();

    const result = await processMultiTabExtract([7, 9]);

    expect(result.images).toHaveLength(3);
    // Double-cast through `unknown` because ImageItem lacks an index
    // signature — the only thing the assertions need is plain
    // property access for matchObject, so a structural view is fine.
    const stamped = result.images as unknown as Array<Record<string, unknown>>;
    const [s1, n1, n2] = stamped;

    expect(s1).toMatchObject({
      url: 's1',
      tabId: 7,
      tabTitle: 'Seven',
      tabUrl: 'https://seven.com',
      tabIndex: 4,
      isCurrentTab: false,
    });
    expect(n1).toMatchObject({
      url: 'n1',
      tabId: 9,
      tabTitle: 'Nine',
      tabUrl: 'https://nine.com',
      tabIndex: 5,
      isCurrentTab: true,
    });
    expect(n2.isCurrentTab).toBe(true);
  });

  it('tolerates an empty tabIds array — no broadcasts, empty result', async () => {
    chromeStub = installChromeStub([]);
    chromeStub.tabs.query.mockResolvedValue([]);
    const captured = attachBroadcastCapture();

    const result = await processMultiTabExtract([]);

    expect(result).toEqual({ success: true, images: [], tabCount: 0 });
    expect(captured).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getImagesFromTab — the single-tab extractor used by the sidepanel's
// "Extract" button. Covers the full L22-143 block: tabId resolution,
// restricted-URL guards, injection-error propagation, searchAllFrames
// dedupe, and live-monitoring message routing.
// ─────────────────────────────────────────────────────────────────────

describe('getImagesFromTab — tabId resolution', () => {
  it('resolves tabId from chrome.tabs.query when not provided', async () => {
    chromeStub = installChromeStub([
      { id: 42, title: 'Active', url: 'https://active.com', images: [{ url: 'x' }] },
    ]);
    // query() returns the active tab by default.
    chromeStub.tabs.query.mockResolvedValue([{ id: 42, url: 'https://active.com' }]);

    const result = await getImagesFromTab(undefined);
    expect(result).toHaveLength(1);
    // Pin: chrome.tabs.query was invoked with the active-tab filter.
    // Without that filter, a background tab would get scanned instead
    // of the foreground one — the #1 "scanned the wrong page" bug shape.
    expect(chromeStub.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
  });

  it('throws "Cannot access this page" when the active tab is chrome:// (restricted-URL guard)', async () => {
    chromeStub = installChromeStub([]);
    chromeStub.tabs.query.mockResolvedValue([{ id: 5, url: 'chrome://settings' }]);

    // Pin: the early restricted-URL throw happens BEFORE injection is
    // attempted. This preserves the readable error message instead of
    // letting the injector surface a generic "Cannot access" later.
    await expect(getImagesFromTab(undefined)).rejects.toThrow(/browser internal/i);
  });

  it('throws "No active tab found" when query returns an empty list', async () => {
    chromeStub = installChromeStub([]);
    chromeStub.tabs.query.mockResolvedValue([]);

    // Pin: both the "no tab" and "tab has no id" branches fall through
    // to the same readable error. Without it the sidepanel would show
    // an unhelpful "tabId is undefined" message.
    await expect(getImagesFromTab(undefined)).rejects.toThrow(/No active tab/);
  });

  it('throws "No active tab found" when active tab has no id field', async () => {
    chromeStub = installChromeStub([]);
    chromeStub.tabs.query.mockResolvedValue([{ url: 'https://a.com' }]); // id missing

    await expect(getImagesFromTab(undefined)).rejects.toThrow(/No active tab/);
  });
});

describe('getImagesFromTab — post-query restricted-URL guard', () => {
  it('tabId provided → chrome.tabs.get restricted URL → throws "Cannot access"', async () => {
    chromeStub = installChromeStub([
      { id: 3, title: 'Bad', url: 'should-not-use', restricted: true, images: [] },
    ]);

    // Pin: the SECOND restricted-URL check (chrome.tabs.get after
    // tabId is already known). Users who pass a tabId directly (e.g.
    // via keyboard shortcut) must still hit the guard — otherwise
    // they could trigger injection attempts against chrome:// pages.
    await expect(getImagesFromTab(3)).rejects.toThrow(/browser internal/i);
  });

  it('chrome.tabs.get rejects with a non-"Cannot access" error → swallows + falls through to injection', async () => {
    chromeStub = installChromeStub([
      { id: 4, title: 'Good', url: 'https://good.com', images: [{ url: 'g1' }] },
    ]);
    // Override get to throw a transient error.
    chromeStub.tabs.get.mockRejectedValueOnce(new Error('transient tabs.get glitch'));

    // Pin: the inner try/catch only re-throws if the error includes
    // "Cannot access". Other errors (transient Chrome API hiccups)
    // must NOT kill the whole extraction — the injector's own retry
    // logic handles it downstream.
    const result = await getImagesFromTab(4);
    expect(result).toHaveLength(1);
  });

  it('chrome.tabs.get rejects WITH "Cannot access" → re-throws unchanged', async () => {
    chromeStub = installChromeStub([{ id: 6, title: 'X', url: 'https://x.com', images: [] }]);
    chromeStub.tabs.get.mockRejectedValueOnce(
      new Error('Cannot access: tab is in a different profile')
    );

    // Pin: the conditional re-throw — a specific substring match so
    // the real "restricted page" error reaches the UI unaltered.
    await expect(getImagesFromTab(6)).rejects.toThrow(/Cannot access/);
  });
});

describe('getImagesFromTab — injection failure propagation', () => {
  it('injection failure → throws Error with .code and .workaround set from InjectionResult', async () => {
    chromeStub = installChromeStub([{ id: 1, title: 'CSP', url: 'https://csp.com', images: [] }]);
    // Make PING fail so injector enters real path, then make the
    // standard scripting.executeScript throw a CSP-style error.
    chromeStub.tabs.sendMessage.mockImplementation(
      async (_tabId: number, message: { type: string }) => {
        if (message.type === MESSAGE_TYPES.PING) throw new Error('no content script');
        if (message.type === MESSAGE_TYPES.EXTRACT_IMAGES) return { images: [] };
        return undefined;
      }
    );
    chromeStub.scripting.executeScript.mockImplementation(
      async (opts: { func?: unknown; files?: unknown }) => {
        if (opts.func) return [{ result: false }];
        if (opts.files) throw new Error('Refused to execute inline script because CSP');
        return [];
      }
    );

    // Pin: the InjectionResult → Error mapping. error.code +
    // error.workaround MUST be preserved so handleMessage's outer
    // catch can surface the CSP_BLOCKED error code (used by the
    // sidepanel to show the "right-click and save manually" banner).
    // Losing these fields would demote the CSP scenario to a generic
    // "injection failed" toast.
    let thrown: Error & { code?: string; workaround?: string } = new Error('dummy');
    try {
      await getImagesFromTab(1);
    } catch (e) {
      thrown = e as Error & { code?: string; workaround?: string };
    }
    expect(thrown.message).toMatch(/security policy/i);
    expect(thrown.code).toBe('CSP_BLOCKED');
    expect(thrown.workaround).toMatch(/Open in new tab/i);
  });
});

describe('getImagesFromTab — searchAllFrames sub-frame handling', () => {
  it('aggregates sub-frame images + stamps fromFrame/frameUrl + dedupes by url across frames', async () => {
    chromeStub = installChromeStub([
      {
        id: 10,
        title: 'Main',
        url: 'https://main.com',
        images: [{ url: 'shared.jpg' }, { url: 'main-only.jpg' }],
      },
    ]);
    chromeStub.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, url: 'https://main.com/' }, // filtered out
      { frameId: 1, url: 'https://iframe-a.com/' },
      { frameId: 2, url: 'chrome://restricted' }, // filtered out
      { frameId: 3, url: 'https://iframe-b.com/' },
    ]);

    // Per-frame EXTRACT_IMAGES responses.
    const originalSend = chromeStub.tabs.sendMessage.getMockImplementation()!;
    chromeStub.tabs.sendMessage.mockImplementation(
      async (tabId: number, message: { type: string }, opts?: { frameId?: number }) => {
        if (opts?.frameId === 1 && message.type === MESSAGE_TYPES.EXTRACT_IMAGES) {
          // Duplicate `shared.jpg` to exercise the cross-frame dedupe.
          return { images: [{ url: 'shared.jpg' }, { url: 'frame1-only.jpg' }] };
        }
        if (opts?.frameId === 3 && message.type === MESSAGE_TYPES.EXTRACT_IMAGES) {
          return { images: [{ url: 'frame3-only.jpg' }] };
        }
        return originalSend(tabId, message);
      }
    );

    const result = (await getImagesFromTab(10, {
      searchAllFrames: true,
    })) as unknown as Array<Record<string, unknown>>;
    const urls = result.map((i) => i.url);

    // Pin: cross-frame dedupe keeps the FIRST occurrence (main frame's
    // shared.jpg), NOT the sub-frame one. Without the Set-based filter,
    // popular images appearing on both main + iframe would double up.
    expect(urls.filter((u) => u === 'shared.jpg')).toHaveLength(1);
    expect(urls).toEqual(
      expect.arrayContaining(['shared.jpg', 'main-only.jpg', 'frame1-only.jpg', 'frame3-only.jpg'])
    );
    // restricted frame 2 and main frame 0 are filtered — neither
    // contributes per-frame EXTRACT_IMAGES calls. (Filter by message
    // type because injectIntoAllFrames ALSO fires per-frame PINGs
    // as part of its own job; those PINGs are a separate concern
    // pinned by tests/background-injector.test.ts.)
    const extractFrameIdsHit = chromeStub.tabs.sendMessage.mock.calls
      .filter((c) => (c[1] as { type: string }).type === MESSAGE_TYPES.EXTRACT_IMAGES)
      .map((c) => (c[2] as { frameId?: number } | undefined)?.frameId)
      .filter((f): f is number => f != null && f !== 0);
    expect(extractFrameIdsHit.sort()).toEqual([1, 3]);

    // Pin: sub-frame images carry fromFrame=true + frameUrl. The
    // sidepanel uses these for the "from iframe" badge + grouping.
    const frame1 = result.find((i) => i.url === 'frame1-only.jpg');
    expect(frame1).toMatchObject({ fromFrame: true, frameUrl: 'https://iframe-a.com/' });
    // Main-frame image gets NO fromFrame flag (stays undefined).
    const mainOnly = result.find((i) => i.url === 'main-only.jpg');
    expect(mainOnly?.fromFrame).toBeUndefined();
  });

  it('sub-frame sendMessage rejects → silently skipped, does NOT abort the loop', async () => {
    chromeStub = installChromeStub([
      { id: 20, title: 'M', url: 'https://m.com', images: [{ url: 'main.jpg' }] },
    ]);
    chromeStub.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 1, url: 'https://flaky.com/' },
      { frameId: 2, url: 'https://good.com/' },
    ]);

    const originalSend = chromeStub.tabs.sendMessage.getMockImplementation()!;
    chromeStub.tabs.sendMessage.mockImplementation(
      async (tabId: number, message: { type: string }, opts?: { frameId?: number }) => {
        if (opts?.frameId === 1 && message.type === MESSAGE_TYPES.EXTRACT_IMAGES) {
          throw new Error('content script not ready in flaky frame');
        }
        if (opts?.frameId === 2 && message.type === MESSAGE_TYPES.EXTRACT_IMAGES) {
          return { images: [{ url: 'good-frame.jpg' }] };
        }
        return originalSend(tabId, message);
      }
    );

    const result = (await getImagesFromTab(20, { searchAllFrames: true })) as unknown as Array<
      Record<string, unknown>
    >;
    // Pin: flaky frame's throw is swallowed per-iteration — the good
    // frame's image still makes it through. Without the per-frame
    // try/catch, a single unreachable iframe would kill the whole
    // all-frames scan.
    expect(result.map((i) => i.url).sort()).toEqual(['good-frame.jpg', 'main.jpg']);
  });

  it('chrome.webNavigation.getAllFrames rejects → console.warn + still returns main-frame images', async () => {
    chromeStub = installChromeStub([
      { id: 30, title: 'N', url: 'https://n.com', images: [{ url: 'n.jpg' }] },
    ]);
    chromeStub.webNavigation.getAllFrames.mockRejectedValue(new Error('permission revoked'));

    const result = await getImagesFromTab(30, { searchAllFrames: true });
    expect(result).toHaveLength(1);
    expect((result[0] as unknown as { url: string }).url).toBe('n.jpg');
    // Pin: the outer try/catch around the sub-frame block warns but
    // preserves whatever the main frame already collected. A
    // regression re-throwing here would present "scan failed" even
    // when 100% of the user's intent (main frame images) succeeded.
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to extract from sub-frames:',
      expect.any(Error)
    );
  });

  it('getAllFrames returns null → treated as empty array (no per-frame calls)', async () => {
    chromeStub = installChromeStub([
      { id: 40, title: 'P', url: 'https://p.com', images: [{ url: 'p.jpg' }] },
    ]);
    chromeStub.webNavigation.getAllFrames.mockResolvedValue(null);

    const result = await getImagesFromTab(40, { searchAllFrames: true });
    expect(result).toHaveLength(1);
  });
});

describe('getImagesFromTab — liveMonitoring message routing', () => {
  it('liveMonitoring=true (default) → sends START_LIVE_MONITOR with debounceMs=500', async () => {
    chromeStub = installChromeStub([
      { id: 1, title: 'T', url: 'https://t.com', images: [{ url: 't.jpg' }] },
    ]);

    await getImagesFromTab(1);

    // Pin: START_LIVE_MONITOR carries { debounceMs: 500 } config. A
    // regression dropping the debounce would cause the monitor to
    // fire a scan on every single DOM mutation — killing performance
    // on SPA-heavy pages like Twitter / Instagram feeds.
    const liveStart = chromeStub.tabs.sendMessage.mock.calls.find(
      (c) => (c[1] as { type: string }).type === MESSAGE_TYPES.START_LIVE_MONITOR
    );
    expect(liveStart?.[1]).toMatchObject({
      type: MESSAGE_TYPES.START_LIVE_MONITOR,
      config: { debounceMs: 500 },
    });
    expect(liveStart?.[2]).toEqual({ frameId: 0 });
  });

  it('liveMonitoring=false → sends STOP_LIVE_MONITOR (opposite branch)', async () => {
    chromeStub = installChromeStub([
      { id: 2, title: 'T', url: 'https://t.com', images: [{ url: 't.jpg' }] },
    ]);

    await getImagesFromTab(2, { liveMonitoring: false });

    // Pin: the explicit STOP message is needed because the content
    // script doesn't know when the sidepanel decides to go quiet.
    // Without this, a user who disables live-monitor in settings
    // would keep paying the observer's CPU cost until page reload.
    const liveStop = chromeStub.tabs.sendMessage.mock.calls.find(
      (c) => (c[1] as { type: string }).type === MESSAGE_TYPES.STOP_LIVE_MONITOR
    );
    expect(liveStop).toBeDefined();
    expect(liveStop?.[2]).toEqual({ frameId: 0 });
    // Symmetric: no START message in this branch.
    const liveStart = chromeStub.tabs.sendMessage.mock.calls.find(
      (c) => (c[1] as { type: string }).type === MESSAGE_TYPES.START_LIVE_MONITOR
    );
    expect(liveStart).toBeUndefined();
  });

  it('live-monitor sendMessage rejection → silently swallowed, does NOT fail the whole extraction', async () => {
    chromeStub = installChromeStub([
      { id: 3, title: 'T', url: 'https://t.com', images: [{ url: 't.jpg' }] },
    ]);
    // Make the live-monitor call reject, but keep EXTRACT_IMAGES working.
    const originalSend = chromeStub.tabs.sendMessage.getMockImplementation()!;
    chromeStub.tabs.sendMessage.mockImplementation(
      async (tabId: number, message: { type: string }, opts?: unknown) => {
        if (
          message.type === MESSAGE_TYPES.START_LIVE_MONITOR ||
          message.type === MESSAGE_TYPES.STOP_LIVE_MONITOR
        ) {
          throw new Error('content script not ready for live monitor');
        }
        return originalSend(tabId, message, opts);
      }
    );

    // Pin: the final try/catch around live-monitor. Extraction
    // results MUST surface even if live-monitor setup fails — the
    // user sees their images; live-monitor just never arms.
    const result = await getImagesFromTab(3);
    expect(result).toHaveLength(1);
  });
});

describe('getImagesFromTab — EXTRACT_IMAGES response handling', () => {
  it('undefined response.images → treated as empty list (no crash)', async () => {
    chromeStub = installChromeStub([
      { id: 99, title: 'Empty', url: 'https://empty.com', images: [] },
    ]);
    // Override EXTRACT_IMAGES to return undefined payload.
    const originalSend = chromeStub.tabs.sendMessage.getMockImplementation()!;
    chromeStub.tabs.sendMessage.mockImplementation(
      async (tabId: number, message: { type: string }, opts?: unknown) => {
        if (message.type === MESSAGE_TYPES.EXTRACT_IMAGES) {
          return undefined; // no images field at all
        }
        return originalSend(tabId, message, opts);
      }
    );

    // Pin: the `response?.images || []` fallback. A regression
    // removing the nullish guard would throw TypeError on
    // `undefined.images` and the whole extraction would fail even
    // though the content script returned cleanly (just empty).
    const result = await getImagesFromTab(99);
    expect(result).toEqual([]);
  });
});
