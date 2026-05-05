// Unit tests for background/utils.ts — the background service worker's
// shared helper module. Until now the entire background/ directory had
// ZERO unit coverage (e2e tests exercise it indirectly, but the small
// pure helpers are never asserted in isolation).
//
// Strategy:
//   - arrayBufferToBase64 is pure; no stubbing.
//   - broadcastToPopup walks an exported `uiPorts` Set and silently
//     drops dead ports. We feed in fake ports with a postMessage that
//     either succeeds or throws.
//   - getAccessibleTabId calls chrome.tabs.query + chrome.tabs.get.
//     Stub both via globalThis.chrome.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Install a minimal chrome.tabs stub BEFORE importing the module under
// test (background/utils re-uses chrome.tabs at module level only via
// the function bodies, so order isn't strictly required, but doing it
// first matches the pattern in license.test.ts).
interface ChromeTabsStub {
  query: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
}

function installChromeTabsStub(): ChromeTabsStub {
  const stub: ChromeTabsStub = {
    query: vi.fn(),
    get: vi.fn(),
    sendMessage: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = { tabs: stub };
  return stub;
}

const { arrayBufferToBase64, broadcastToPopup, getAccessibleTabId, uiPorts } =
  await import('../background/utils');

let tabs: ChromeTabsStub;

beforeEach(() => {
  tabs = installChromeTabsStub();
  // Wipe the module-scoped uiPorts Set between tests so broadcasts
  // don't leak port objects between cases.
  uiPorts.clear();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  uiPorts.clear();
});

describe('arrayBufferToBase64', () => {
  it('encodes a simple 4-byte buffer', () => {
    // [0x41, 0x42, 0x43, 0x44] = "ABCD" → base64 "QUJDRA=="
    const buf = new Uint8Array([0x41, 0x42, 0x43, 0x44]).buffer;
    expect(arrayBufferToBase64(buf)).toBe('QUJDRA==');
  });

  it('returns "" for an empty buffer', () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('');
  });

  it('handles bytes that span the full 0-255 range', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const result = arrayBufferToBase64(bytes.buffer);
    // Round-trip via atob to verify byte fidelity.
    const decoded = atob(result);
    expect(decoded.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(decoded.charCodeAt(i)).toBe(i);
  });
});

describe('broadcastToPopup', () => {
  it('forwards the message to every connected port', () => {
    const sent: unknown[] = [];
    const portA = {
      postMessage: vi.fn((msg: unknown) => {
        sent.push({ port: 'A', msg });
      }),
    };
    const portB = {
      postMessage: vi.fn((msg: unknown) => {
        sent.push({ port: 'B', msg });
      }),
    };
    uiPorts.add(portA as unknown as chrome.runtime.Port);
    uiPorts.add(portB as unknown as chrome.runtime.Port);

    broadcastToPopup({ type: 'PING', n: 1 });

    expect(portA.postMessage).toHaveBeenCalledWith({ type: 'PING', n: 1 });
    expect(portB.postMessage).toHaveBeenCalledWith({ type: 'PING', n: 1 });
    expect(sent).toHaveLength(2);
  });

  it('drops ports that throw on postMessage (dead-port cleanup)', () => {
    const live = { postMessage: vi.fn() };
    const dead = {
      postMessage: vi.fn(() => {
        throw new Error('Attempting to use a disconnected port');
      }),
    };
    uiPorts.add(live as unknown as chrome.runtime.Port);
    uiPorts.add(dead as unknown as chrome.runtime.Port);
    expect(uiPorts.size).toBe(2);

    broadcastToPopup({ type: 'PING' });

    // Live port still subscribed, dead port evicted.
    expect(uiPorts.has(live as unknown as chrome.runtime.Port)).toBe(true);
    expect(uiPorts.has(dead as unknown as chrome.runtime.Port)).toBe(false);
    expect(uiPorts.size).toBe(1);
    // Live port still got the message even though dead one threw.
    expect(live.postMessage).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the port set is empty', () => {
    expect(uiPorts.size).toBe(0);
    expect(() => broadcastToPopup({ type: 'PING' })).not.toThrow();
  });
});

describe('getAccessibleTabId', () => {
  it('returns the active tab id when its url is an accessible http(s) page', async () => {
    tabs.query.mockResolvedValue([{ id: 42 }]);
    tabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/page' });

    expect(await getAccessibleTabId()).toBe(42);
    expect(tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(tabs.get).toHaveBeenCalledWith(42);
  });

  it('honors an explicit tabId, skipping the chrome.tabs.query lookup', async () => {
    tabs.get.mockResolvedValue({ id: 99, url: 'https://example.com/page' });

    expect(await getAccessibleTabId(99)).toBe(99);
    expect(tabs.query).not.toHaveBeenCalled();
    expect(tabs.get).toHaveBeenCalledWith(99);
  });

  it('returns null when the active-tab lookup yields no id', async () => {
    tabs.query.mockResolvedValue([]);

    expect(await getAccessibleTabId()).toBeNull();
    expect(tabs.get).not.toHaveBeenCalled();
  });

  it('returns null for a restricted URL (chrome://, chrome-extension://, etc)', async () => {
    tabs.query.mockResolvedValue([{ id: 7 }]);
    tabs.get.mockResolvedValue({ id: 7, url: 'chrome://settings' });

    expect(await getAccessibleTabId()).toBeNull();
  });

  it('returns null when chrome.tabs.get rejects', async () => {
    tabs.query.mockResolvedValue([{ id: 7 }]);
    tabs.get.mockRejectedValue(new Error('No tab with id 7'));

    expect(await getAccessibleTabId()).toBeNull();
  });

  it('returns null when chrome.tabs.query rejects', async () => {
    tabs.query.mockRejectedValue(new Error('Permission denied'));

    expect(await getAccessibleTabId()).toBeNull();
  });
});
