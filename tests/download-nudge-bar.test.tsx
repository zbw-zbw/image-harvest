// Tests for sidepanel/components/DownloadNudgeBar.tsx — the prominent
// "N images ready to download" CTA strip shown above the image grid after
// a completed scan (2026-10-13 growth experiment #1).
//
// Scope:
//   - Hidden while no images / mid-scan / after dismissal
//   - Renders with the image count and fires download_nudge_shown once
//   - CTA fires download_nudge_cta_clicked and calls downloadSelectedAsZip
//     with the FULL filtered list (selection-free by design)
//   - Close fires download_nudge_dismissed and flips the store flag
//
// Out of scope (covered elsewhere):
//   - The dismissal lifecycle (scan.ts reset / actions.ts completion /
//     tab-lifecycle.ts tab switch) — plain state assignments asserted by
//     the integration paths below via the store flag.
//   - The download pipeline itself (tests/sidepanel-actions.test.tsx).
//
// Strategy: mock shared/telemetry and sidepanel/actions (the latter would
// otherwise drag the full chrome-API surface into jsdom); drive the real
// store by direct assignment, same pattern as the other banner tests.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import type { ImageItem } from '../shared/types';

const mockTrack = vi.fn(() => Promise.resolve());
const mockDownloadSelectedAsZip = vi.fn(() => Promise.resolve());

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
}));
vi.mock('../sidepanel/actions', () => ({
  downloadSelectedAsZip: mockDownloadSelectedAsZip,
}));

import { state } from '../sidepanel/state';
import { EVENTS } from '../shared/telemetry-events';

let DownloadNudgeBar: (typeof import('../sidepanel/components/DownloadNudgeBar'))['DownloadNudgeBar'];

beforeAll(async () => {
  ({ DownloadNudgeBar } = await import('../sidepanel/components/DownloadNudgeBar'));
});

function img(id: string): ImageItem {
  return { url: `https://example.com/${id}.png`, id } as ImageItem;
}

function resetState(): void {
  state.filteredImages = [];
  state.uiScreen = 'images';
  state.downloadNudgeDismissed = false;
  state.isFetching = false;
  state.isScanning = false;
  state.isDeepScanning = false;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

afterEach(() => {
  cleanup();
  resetState();
});

describe('<DownloadNudgeBar>', () => {
  it('renders nothing when there are no images (the common pre-scan case)', () => {
    const { container } = render(<DownloadNudgeBar />);
    expect(container.querySelector('.download-nudge-bar')).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('renders when a scan leaves images on screen and fires download_nudge_shown once with the count', () => {
    state.filteredImages = [img('a'), img('b'), img('c')];
    const { container } = render(<DownloadNudgeBar />);
    expect(container.querySelector('.download-nudge-bar')).not.toBeNull();
    expect(container.textContent).toContain('3');
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.DOWNLOAD_NUDGE_SHOWN, { count: 3 });
  });

  it('renders nothing while a scan is running', () => {
    state.filteredImages = [img('a')];
    state.isFetching = true;
    state.isScanning = true;
    const { container } = render(<DownloadNudgeBar />);
    expect(container.querySelector('.download-nudge-bar')).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('renders nothing once the user dismissed (downloaded or closed) this session', () => {
    state.filteredImages = [img('a')];
    state.downloadNudgeDismissed = true;
    const { container } = render(<DownloadNudgeBar />);
    expect(container.querySelector('.download-nudge-bar')).toBeNull();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('CTA fires download_nudge_cta_clicked and downloads ALL filtered images selection-free', () => {
    const images = [img('a'), img('b')];
    state.filteredImages = images;
    const { container } = render(<DownloadNudgeBar />);
    const btn = container.querySelector('#btn-download-nudge') as HTMLElement | null;
    expect(btn).not.toBeNull();

    fireEvent.click(btn as HTMLElement);

    expect(mockTrack).toHaveBeenCalledWith(EVENTS.DOWNLOAD_NUDGE_CTA_CLICKED, { count: 2 });
    expect(mockDownloadSelectedAsZip).toHaveBeenCalledTimes(1);
    // null target format + the full filtered list — the whole point of the
    // nudge is removing the selection step between intent and action.
    expect(mockDownloadSelectedAsZip).toHaveBeenCalledWith(null, images);
  });

  it('close button fires download_nudge_dismissed and hides the bar via the store flag', () => {
    state.filteredImages = [img('a')];
    const { container } = render(<DownloadNudgeBar />);
    const close = container.querySelector('.download-nudge-close') as HTMLElement | null;
    expect(close).not.toBeNull();

    fireEvent.click(close as HTMLElement);

    expect(mockTrack).toHaveBeenCalledWith(EVENTS.DOWNLOAD_NUDGE_DISMISSED, { count: 1 });
    expect(state.downloadNudgeDismissed).toBe(true);
    // The store flag drives visibility — the next render hides the bar.
    expect(container.querySelector('.download-nudge-bar')).toBeNull();
  });
});
