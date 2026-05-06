// Unit tests for the Sprint 3.4 batch URL copy feature.
//
// Two surfaces under test:
//   1. actions.copyImageUrls + getSelectedOrFilteredUrls — the pure
//      orchestration layer (clipboard + telemetry + Pro guard + selection
//      fallback). DOM-light; covered with vitest + a clipboard stub.
//   2. <BatchUrlCopyButton/> — the toolbar Preact component. Renders into
//      jsdom; we assert the label/disabled state derives from the store
//      and that clicks call into actions.copyImageUrls.
//
// Why not import actions in the component test? We mock the actions module
// for the component test so we can assert "click → copyImageUrls(urls)"
// without coupling the assertion to the real clipboard/telemetry chain.
// The actions tests below cover the real implementation directly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, cleanup } from '@testing-library/preact';

// ── Mocks for actions.ts dependencies ────────────────────────────────────
// Same pattern as tests/sidepanel-actions.test.tsx — keep DOM/IPC neighbors
// out of the import graph so the test stays focused on the unit.
vi.mock('../sidepanel/render', () => ({ renderImages: vi.fn() }));
vi.mock('../sidepanel/settings', () => ({ showProUpgradeModal: vi.fn() }));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
  showProgress: vi.fn(),
  hideProgress: vi.fn(),
  updateProgress: vi.fn(),
  showConfirmDialog: vi.fn(),
}));

import { copyImageUrls, getSelectedOrFilteredUrls } from '../sidepanel/actions';
import { showProUpgradeModal } from '../sidepanel/settings';
import { showToast } from '../sidepanel/ui';
import { state, store } from '../sidepanel/state';
import { FREE_LIMITS } from '../shared/constants';
import type { ImageItem } from '../shared/types';

interface ChromeStub {
  storage: { local: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
  i18n: { getUILanguage: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  store.reset();
  document.body.innerHTML = '';
  // Minimal chrome stub so shared/i18n.ts initializers don't throw.
  const chromeStub: ChromeStub = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    i18n: { getUILanguage: vi.fn(() => 'en') },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = chromeStub;
  // Clipboard stub — actions.copyImageUrls awaits writeText; record calls.
  const calls: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async (s: string) => {
        calls.push(s);
      }),
    },
  });
  // Stash for assertion access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__clipboardCalls = calls;
});

afterEach(() => {
  cleanup();
  store.reset();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__clipboardCalls;
});

function makeImg(id: string, url: string): ImageItem {
  return { id, url, format: 'jpg' } as ImageItem;
}
function getClipboardCalls(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).__clipboardCalls as string[];
}

// ─────────────────────────────────────────────────────────────────────
// getSelectedOrFilteredUrls
// ─────────────────────────────────────────────────────────────────────
describe('getSelectedOrFilteredUrls', () => {
  it('returns selected images when selection is non-empty', () => {
    state.filteredImages = [
      makeImg('a', 'https://x/a.jpg'),
      makeImg('b', 'https://x/b.jpg'),
      makeImg('c', 'https://x/c.jpg'),
    ];
    state.selectedImages = new Set(['a', 'c']);
    expect(getSelectedOrFilteredUrls()).toEqual(['https://x/a.jpg', 'https://x/c.jpg']);
  });

  it('falls back to ALL filtered images when selection is empty', () => {
    state.filteredImages = [makeImg('a', 'https://x/a.jpg'), makeImg('b', 'https://x/b.jpg')];
    state.selectedImages = new Set();
    expect(getSelectedOrFilteredUrls()).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
  });

  it('returns empty array when nothing is filtered', () => {
    state.filteredImages = [];
    expect(getSelectedOrFilteredUrls()).toEqual([]);
  });

  it('preserves filteredImages order even when selection sequence differs', () => {
    state.filteredImages = [
      makeImg('a', 'https://x/a.jpg'),
      makeImg('b', 'https://x/b.jpg'),
      makeImg('c', 'https://x/c.jpg'),
    ];
    // Selection order shouldn't matter — we always render in grid order.
    state.selectedImages = new Set(['c', 'a']);
    expect(getSelectedOrFilteredUrls()).toEqual(['https://x/a.jpg', 'https://x/c.jpg']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// copyImageUrls
// ─────────────────────────────────────────────────────────────────────
describe('copyImageUrls', () => {
  it('writes newline-joined URLs and shows the count toast', async () => {
    state.isProUser = true;
    const result = await copyImageUrls(['https://x/a.jpg', 'https://x/b.jpg']);
    expect(result).toBe(true);
    expect(getClipboardCalls()).toEqual(['https://x/a.jpg\nhttps://x/b.jpg']);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('2 URLs copied to clipboard'),
      'success'
    );
  });

  it('short-circuits with an empty-state toast when given no URLs', async () => {
    const result = await copyImageUrls([]);
    expect(result).toBe(false);
    expect(getClipboardCalls()).toEqual([]);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Select images first'), 'error');
  });

  it('blocks free users beyond the FREE_LIMITS cap and surfaces the upgrade modal', async () => {
    state.isProUser = false;
    const urls = Array.from(
      { length: FREE_LIMITS.MAX_BATCH_COPY_URLS + 1 },
      (_, i) => `https://x/${i}.jpg`
    );
    const result = await copyImageUrls(urls);
    expect(result).toBe(false);
    expect(getClipboardCalls()).toEqual([]);
    expect(showProUpgradeModal).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining(`up to ${FREE_LIMITS.MAX_BATCH_COPY_URLS} URLs`),
      'warning'
    );
  });

  it('allows free users at or below the FREE_LIMITS cap', async () => {
    state.isProUser = false;
    const urls = Array.from(
      { length: FREE_LIMITS.MAX_BATCH_COPY_URLS },
      (_, i) => `https://x/${i}.jpg`
    );
    const result = await copyImageUrls(urls);
    expect(result).toBe(true);
    expect(getClipboardCalls()).toHaveLength(1);
    expect(showProUpgradeModal).not.toHaveBeenCalled();
  });

  it('returns false and shows an error toast when the clipboard write rejects', async () => {
    state.isProUser = true;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    const result = await copyImageUrls(['https://x/a.jpg']);
    expect(result).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to copy URL'), 'error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// <BatchUrlCopyButton/> — Preact component contract
// ─────────────────────────────────────────────────────────────────────
// The component imports copyImageUrls / getSelectedOrFilteredUrls from
// sidepanel/actions. We CAN'T use vi.mock(...) at the top of this file
// because the hoisted mock would replace the real implementations the
// "copyImageUrls" describe block above relies on. Instead we:
//   1. Import the real BatchUrlCopyButton + an actions namespace
//   2. Use vi.spyOn(actions, 'copyImageUrls').mockResolvedValue(true)
//      INSIDE this describe's beforeEach so the spy is reset per-test
//      and never pollutes the actions block above.
// jsdom-friendly: spies installed on a module namespace are scoped per
// test and undone in afterEach via vi.restoreAllMocks().
import { BatchUrlCopyButton } from '../sidepanel/components/BatchUrlCopyButton';
import * as actionsModule from '../sidepanel/actions';

describe('<BatchUrlCopyButton/>', () => {
  beforeEach(() => {
    vi.spyOn(actionsModule, 'copyImageUrls').mockResolvedValue(true);
    vi.spyOn(actionsModule, 'getSelectedOrFilteredUrls').mockReturnValue([
      'https://x/a.jpg',
      'https://x/b.jpg',
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables itself when there are no images to copy', () => {
    state.filteredImages = [];
    state.selectedImages = new Set();
    const { container } = render(<BatchUrlCopyButton />);
    const btn = container.querySelector<HTMLButtonElement>('#btn-batch-copy-urls');
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toContain('Select images first');
  });

  it('enables itself and shows just the base label when nothing is selected but images are filtered', () => {
    state.filteredImages = [makeImg('a', 'https://x/a.jpg'), makeImg('b', 'https://x/b.jpg')];
    state.selectedImages = new Set();
    const { container } = render(<BatchUrlCopyButton />);
    const btn = container.querySelector<HTMLButtonElement>('#btn-batch-copy-urls');
    expect(btn!.disabled).toBe(false);
    expect(btn!.querySelector('.select-all-text')!.textContent).toBe('Copy URLs');
  });

  it('shows the selection count in the label when images are selected', () => {
    state.filteredImages = [
      makeImg('a', 'https://x/a.jpg'),
      makeImg('b', 'https://x/b.jpg'),
      makeImg('c', 'https://x/c.jpg'),
    ];
    state.selectedImages = new Set(['a', 'c']);
    const { container } = render(<BatchUrlCopyButton />);
    const label = container.querySelector('.select-all-text')!;
    expect(label.textContent).toBe('Copy URLs (2)');
  });

  it('invokes copyImageUrls with the URLs from getSelectedOrFilteredUrls on click', () => {
    state.filteredImages = [makeImg('a', 'https://x/a.jpg')];
    state.selectedImages = new Set();
    const { container } = render(<BatchUrlCopyButton />);
    const btn = container.querySelector<HTMLButtonElement>('#btn-batch-copy-urls')!;
    fireEvent.click(btn);
    expect(actionsModule.getSelectedOrFilteredUrls).toHaveBeenCalled();
    expect(actionsModule.copyImageUrls).toHaveBeenCalledWith([
      'https://x/a.jpg',
      'https://x/b.jpg', // spy return value
    ]);
  });

  it('does not invoke copyImageUrls when the button is disabled', () => {
    state.filteredImages = [];
    state.selectedImages = new Set();
    const { container } = render(<BatchUrlCopyButton />);
    const btn = container.querySelector<HTMLButtonElement>('#btn-batch-copy-urls')!;
    // jsdom dispatches click events even on disabled buttons; the
    // component's handler must short-circuit.
    fireEvent.click(btn);
    expect(actionsModule.copyImageUrls).not.toHaveBeenCalled();
  });
});
