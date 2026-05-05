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

const { processMultiTabExtract } = await import('../background/extractor');
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
