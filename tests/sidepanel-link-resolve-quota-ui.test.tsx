// Tests for the link-resolve soft-upsell touchpoints added alongside the
// website/pricing link-penetration rollout:
//   1. GalleryResolveBar — after a successful resolve, FREE users get a
//      success toast that carries the remaining monthly linkResolve count
//      (or the "quota used up — Pro is unlimited" variant on the last one).
//      The quota budget ticking down is the conversion nudge; Pro users keep
//      the plain success toast. feature-quota runs REAL here (backed by a
//      mocked chrome.storage.local) so the increment→remaining chain is the
//      production one.
//   2. QuotaDisplay — the settings quota table now includes the linkResolve
//      row on the fallback path (no remote copy config): label, free limit
//      (3/mo), Pro "Unlimited", and the remaining counter wired to the
//      feature-quota storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../sidepanel/filter', () => ({ applyFilters: vi.fn() }));
vi.mock('../sidepanel/scan', () => ({ processImageExtras: vi.fn() }));
vi.mock('../sidepanel/injected-items', () => ({ persistInjectedItems: vi.fn() }));
vi.mock('../sidepanel/settings', () => ({ showProUpgradeModal: vi.fn() }));
vi.mock('../sidepanel/ui', () => ({
  showToast: vi.fn(),
  showProgress: vi.fn(),
  updateProgress: vi.fn(),
  hideProgress: vi.fn(),
}));

import { GalleryResolveBar } from '../sidepanel/components/GalleryResolveBar';
import { QuotaDisplay } from '../sidepanel/components/QuotaDisplay';
import { state } from '../sidepanel/state';
import * as ui from '../sidepanel/ui';
import { __test as telemetryTest } from '../shared/telemetry';

// ── chrome stub ────────────────────────────────────────────────────────────

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function makeStorageQuota(linkResolveUsed: number): Record<string, unknown> {
  return {
    monthly: {
      [monthKey()]: {
        multiTab: 0,
        dedup: 0,
        formatConvert: 0,
        liveMonitor: 0,
        colorCopy: 0,
        linkResolve: linkResolveUsed,
      },
    },
    daily: {},
  };
}

let storageData: Map<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  storageData = new Map();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageData.get(key) })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storageData.set(k, v);
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn(),
    },
    tabs: {
      get: vi.fn(async () => ({
        url: 'https://example.com/gallery.html',
        title: 'Gallery',
        index: 0,
      })),
    },
  };
  // Telemetry fire-and-forget calls must not hit the network.
  telemetryTest.reset();
  const noopFetch: typeof fetch = (async () =>
    new Response('{"ok":true}', { status: 200 })) as typeof fetch;
  telemetryTest.setFetch(noopFetch);

  // Fresh sidepanel state for every test.
  state.galleryLinks = [];
  state.isResolvingGallery = false;
  state.isProUser = false;
  state.allImages = [];
  state.currentTabId = null;
  state.currentTabTitle = '';
});

afterEach(() => {
  cleanup();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  telemetryTest.reset();
});

// ── GalleryResolveBar — post-resolve quota toasts ─────────────────────────

describe('GalleryResolveBar — post-resolve quota toasts', () => {
  const LINKS = [
    'https://example.com/gallery-detail-1.html',
    'https://example.com/gallery-detail-2.html',
  ];

  function mockResolveSuccess(): void {
    (
      globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }
    ).chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      images: [
        { url: 'https://example.com/orig-1.png', type: 'link-resolved' },
        { url: 'https://example.com/orig-2.png', type: 'link-resolved' },
      ],
      results: [
        { url: LINKS[0], status: 'resolved' },
        { url: LINKS[1], status: 'resolved' },
      ],
      resolved: 2,
      failed: 0,
    });
  }

  function clickResolve(container: Element): void {
    const btn = container.querySelector('#btn-gallery-resolve') as HTMLElement | null;
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
  }

  it('free user, fresh quota → success toast carries the remaining count', async () => {
    state.galleryLinks = [...LINKS];
    mockResolveSuccess();

    const { container } = render(<GalleryResolveBar />);
    clickResolve(container);

    // used 0/3 → after increment 1/3 → 2 left.
    await waitFor(() =>
      expect(ui.showToast).toHaveBeenCalledWith(
        'Added 2 original images · 2 link resolves left this month',
        'success'
      )
    );
  });

  it('free user, quota 2/3 used → last-resolve toast names Pro as unlimited', async () => {
    storageData.set('featureQuota', makeStorageQuota(2));
    state.galleryLinks = [...LINKS];
    mockResolveSuccess();

    const { container } = render(<GalleryResolveBar />);
    clickResolve(container);

    // used 2/3 → after increment 3/3 → 0 left → the "quota used up" variant.
    await waitFor(() =>
      expect(ui.showToast).toHaveBeenCalledWith(
        'Added 2 original images · monthly link-resolve quota used up — Pro is unlimited',
        'success'
      )
    );
  });

  it('Pro user keeps the plain success toast (no quota messaging)', async () => {
    state.isProUser = true;
    state.galleryLinks = [...LINKS];
    mockResolveSuccess();

    const { container } = render(<GalleryResolveBar />);
    clickResolve(container);

    await waitFor(() =>
      expect(ui.showToast).toHaveBeenCalledWith('Added 2 original images', 'success')
    );
    const calls = (ui.showToast as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([msg]) => String(msg).includes('left this month'))).toBe(false);
  });
});

// ── QuotaDisplay — linkResolve row on the fallback copy path ──────────────

describe('QuotaDisplay — linkResolve row (fallback copy)', () => {
  it('free user sees the Link Resolve row with free limit and remaining count', async () => {
    // No remote copy config installed → buildFallbackRows path.
    storageData.set('featureQuota', makeStorageQuota(1));

    render(<QuotaDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Link Resolve')).toBeTruthy();
    });
    // Free limit "3/mo", Pro "Unlimited" (both color-copy and link-resolve
    // rows show it), remaining "2 left" (1 of 3 used).
    expect(screen.getByText('3/mo')).toBeTruthy();
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2 left')).toBeTruthy();
  });

  it('exhausted quota marks the Link Resolve remaining counter as exhausted', async () => {
    storageData.set('featureQuota', makeStorageQuota(3));

    render(<QuotaDisplay />);

    await waitFor(() => {
      expect(screen.getByText('0 left')).toBeTruthy();
    });
    // The exhausted flag drives the .exhausted CSS class — assert via the
    // inline remaining span sitting next to the Link Resolve label.
    const label = screen.getByText('Link Resolve');
    const cell = label.closest('.quota-cell-feature') as HTMLElement | null;
    expect(cell).toBeTruthy();
    expect(cell!.querySelector('.quota-inline-remaining.exhausted')).toBeTruthy();
  });
});
