// ImageGrid Preact component tests.
//
// Strategy: stub the heavy <ImageCard> dependency (which would otherwise
// pull in actions / pro-features / chrome.* APIs) to a tiny presentational
// mock — we're testing the GRID behavior here (flat vs grouped vs virtualized,
// skeleton append, collapsed groups), not the cards themselves.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

// Replace ImageCard with a lightweight marker so we can count rendered cards
// without dragging in the heavy dependency tree.
vi.mock('../sidepanel/components/ImageCard', () => ({
  ImageCard: ({ img }: { img: { id: string; url: string } }) => (
    <div class="mock-image-card" data-id={img.id} data-url={img.url} />
  ),
}));

// virtua's <Virtualizer> normally relies on a scroll container with a real
// layout. jsdom doesn't lay out, so we stub it to a transparent passthrough
// that just renders its children — enough to assert that the
// "should-virtualize" branch is taken without depending on virtua internals.
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children: preact.ComponentChildren }) => (
    <div data-testid="virtualizer">{children}</div>
  ),
}));

import { ImageGrid } from '../sidepanel/components/ImageGrid';
import { state, store } from '../sidepanel/state';
import { makeImage, makeImages } from './_helpers/imageFixtures';

beforeEach(() => {
  store.reset();
});

describe('ImageGrid – flat mode (groupMode=none)', () => {
  it('renders one card per filtered image', () => {
    state.filteredImages = makeImages(3);
    state.currentGroupMode = 'none';
    state.currentViewMode = 'list';
    const { container } = render(<ImageGrid />);
    expect(container.querySelectorAll('.mock-image-card').length).toBe(3);
  });

  it('renders nothing when filteredImages is empty', () => {
    state.filteredImages = [];
    state.currentGroupMode = 'none';
    const { container } = render(<ImageGrid />);
    expect(container.querySelectorAll('.mock-image-card').length).toBe(0);
    expect(container.querySelectorAll('.skeleton-card').length).toBe(0);
  });

  it('appends trailing skeletons matching scanSkeletonsToShow', () => {
    state.filteredImages = makeImages(2);
    state.currentGroupMode = 'none';
    state.scanSkeletonsToShow = 4;
    const { container } = render(<ImageGrid />);
    expect(container.querySelectorAll('.mock-image-card').length).toBe(2);
    expect(container.querySelectorAll('.skeleton-card').length).toBe(4);
  });

  it('does NOT virtualize below the threshold (50 cards, list view)', () => {
    state.filteredImages = makeImages(40);
    state.currentGroupMode = 'none';
    state.currentViewMode = 'list';
    const { container } = render(<ImageGrid />);
    expect(container.querySelector('[data-testid=virtualizer]')).toBeNull();
    expect(container.querySelectorAll('.mock-image-card').length).toBe(40);
  });

  it('virtualizes above the threshold in list view', () => {
    state.filteredImages = makeImages(60);
    state.currentGroupMode = 'none';
    state.currentViewMode = 'list';
    const { container } = render(<ImageGrid />);
    expect(container.querySelector('[data-testid=virtualizer]')).toBeInTheDocument();
    // All cards still rendered through the (stubbed) Virtualizer
    expect(container.querySelectorAll('.mock-image-card').length).toBe(60);
  });

  it('does NOT virtualize in grid view even with many cards', () => {
    state.filteredImages = makeImages(60);
    state.currentGroupMode = 'none';
    state.currentViewMode = 'grid';
    const { container } = render(<ImageGrid />);
    expect(container.querySelector('[data-testid=virtualizer]')).toBeNull();
  });
});

describe('ImageGrid – grouped mode', () => {
  it('renders one .image-group block per domain group', () => {
    state.filteredImages = [
      makeImage({ id: 'a1', url: 'https://a.example/1.png' }),
      makeImage({ id: 'a2', url: 'https://a.example/2.png' }),
      makeImage({ id: 'b1', url: 'https://b.example/1.png' }),
    ];
    state.currentGroupMode = 'domain';
    state.currentViewMode = 'list';
    const { container } = render(<ImageGrid />);
    const groups = container.querySelectorAll('.image-group');
    expect(groups.length).toBe(2);
  });

  it('renders the count badge for each group', () => {
    state.filteredImages = [
      makeImage({ id: 'a1', url: 'https://a.example/1.png' }),
      makeImage({ id: 'a2', url: 'https://a.example/2.png' }),
      makeImage({ id: 'a3', url: 'https://a.example/3.png' }),
    ];
    state.currentGroupMode = 'domain';
    const { container } = render(<ImageGrid />);
    const counts = Array.from(container.querySelectorAll('.group-count')).map(
      (el) => el.textContent
    );
    expect(counts).toContain('3');
  });

  it('applies the .collapsed class when the group is in collapsedGroups', () => {
    state.filteredImages = [makeImage({ id: 'g1', url: 'https://example.com/1.png' })];
    state.currentGroupMode = 'domain';
    state.collapsedGroups = new Set(['example.com']);
    const { container } = render(<ImageGrid />);
    expect(container.querySelector('.group-header.collapsed')).toBeInTheDocument();
    expect(container.querySelector('.group-content.collapsed')).toBeInTheDocument();
  });

  it('toggles collapse on group header click', () => {
    state.filteredImages = [makeImage({ id: 'g1', url: 'https://example.com/1.png' })];
    state.currentGroupMode = 'domain';
    expect(state.collapsedGroups.has('example.com')).toBe(false);

    const { container } = render(<ImageGrid />);
    fireEvent.click(container.querySelector('.group-header')!);
    expect(state.collapsedGroups.has('example.com')).toBe(true);
  });

  it('appends trailing skeletons after groups', () => {
    state.filteredImages = [makeImage({ id: 's1', url: 'https://x.test/1.png' })];
    state.currentGroupMode = 'domain';
    state.scanSkeletonsToShow = 2;
    const { container } = render(<ImageGrid />);
    expect(container.querySelectorAll('.image-group').length).toBe(1);
    expect(container.querySelectorAll('.skeleton-card').length).toBe(2);
  });
});
