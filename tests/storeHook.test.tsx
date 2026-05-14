// Tests for the useStoreSelector hook (sidepanel/components/storeHook.ts).
//
// Key scenarios:
//   1. Basic reactivity — store mutation triggers re-render
//   2. Stale-check on mount — if the store changes between render and
//      useLayoutEffect registration, the component still picks up the new value
//   3. No spurious re-renders when value is unchanged
//   4. Unsubscribes on unmount
//   5. Custom equality function is honored
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { state, store } from '../sidepanel/state';
import { useStoreSelector } from '../sidepanel/components/storeHook';

vi.mock('virtua', () => ({
  Virtualizer: vi.fn(),
}));

vi.mock('../sidepanel/init', () => ({
  isWithinTabSwitchGrace: vi.fn(() => false),
}));

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  store.reset();
});

function TestComponent({
  selector,
  equalityFn,
}: {
  selector: (s: typeof state) => unknown;
  equalityFn?: (a: unknown, b: unknown) => boolean;
}) {
  const value = useStoreSelector(selector as never, equalityFn as never);
  return <div data-testid="value">{JSON.stringify(value)}</div>;
}

describe('useStoreSelector – basic reactivity', () => {
  it('renders the current store value on mount', () => {
    state.isScanning = true;
    const { getByTestId } = render(<TestComponent selector={(s) => s.isScanning} />);
    expect(getByTestId('value').textContent).toBe('true');
  });

  it('re-renders when the subscribed value changes', () => {
    const { getByTestId } = render(<TestComponent selector={(s) => s.filteredImages.length} />);
    expect(getByTestId('value').textContent).toBe('0');

    act(() => {
      state.filteredImages = [{ id: 'a', url: 'u' }] as never;
    });
    expect(getByTestId('value').textContent).toBe('1');
  });

  it('does not re-render when an unrelated field changes', () => {
    const renderSpy = vi.fn();
    function SpyComponent() {
      const val = useStoreSelector((s) => s.isScanning);
      renderSpy(val);
      return <div>{String(val)}</div>;
    }
    render(<SpyComponent />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    act(() => {
      state.isFetching = true;
    });
    // Should not re-render — isFetching is unrelated
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    const renderSpy = vi.fn();
    function SpyComponent() {
      const val = useStoreSelector((s) => s.isScanning);
      renderSpy(val);
      return <div>{String(val)}</div>;
    }
    const { unmount } = render(<SpyComponent />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      state.isScanning = true;
    });
    // Should not re-render after unmount
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useStoreSelector – stale-check on mount', () => {
  it('picks up store changes that happen during the same microtask as mount', async () => {
    // Simulate the real bug: component mounts with filteredImages=[],
    // then the store is mutated SYNCHRONOUSLY after render() returns
    // but before the browser paints. The stale-check in useLayoutEffect
    // should catch this and trigger a re-render.
    const { getByTestId } = render(<TestComponent selector={(s) => s.filteredImages.length} />);
    // Initial render sees empty
    expect(getByTestId('value').textContent).toBe('0');

    // Mutate synchronously — simulates what loadCurrentTab does
    act(() => {
      state.filteredImages = Array.from({ length: 5 }, (_, i) => ({
        id: `img-${i}`,
        url: `https://example.com/${i}.png`,
      })) as never;
    });

    // Should have re-rendered with the new value
    expect(getByTestId('value').textContent).toBe('5');
  });

  it('handles multiple rapid mutations correctly', () => {
    const { getByTestId } = render(<TestComponent selector={(s) => s.filteredImages.length} />);

    act(() => {
      state.filteredImages = Array.from({ length: 3 }, (_, i) => ({
        id: `a-${i}`,
        url: `u${i}`,
      })) as never;
    });
    expect(getByTestId('value').textContent).toBe('3');

    act(() => {
      state.filteredImages = Array.from({ length: 10 }, (_, i) => ({
        id: `b-${i}`,
        url: `u${i}`,
      })) as never;
    });
    expect(getByTestId('value').textContent).toBe('10');

    act(() => {
      state.filteredImages = [];
    });
    expect(getByTestId('value').textContent).toBe('0');
  });
});

describe('useStoreSelector – custom equality', () => {
  it('skips re-render when custom equality returns true', () => {
    const renderSpy = vi.fn();
    function SpyComponent() {
      const val = useStoreSelector(
        (s) => s.filteredImages.length,
        () => true // always equal
      );
      renderSpy(val);
      return <div>{String(val)}</div>;
    }
    render(<SpyComponent />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    act(() => {
      state.filteredImages = [{ id: 'x', url: 'u' }] as never;
    });
    // Custom equality says "always equal" so no re-render
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useStoreSelector – simulated init flow (main rendering pipeline)', () => {
  // This test simulates the exact bug scenario:
  // 1. Preact mounts ImageGrid (filteredImages = [])
  // 2. init() synchronously runs loadCurrentTab → applyFilters
  // 3. applyFilters sets state.filteredImages = [...35 images]
  // 4. Component must re-render with the new images
  it('component sees store mutations that happen right after mount in the same task', () => {
    // Start with empty
    state.filteredImages = [];

    function ImageCounter() {
      const images = useStoreSelector((s) => s.filteredImages);
      return <div data-testid="count">{images.length}</div>;
    }

    const { getByTestId } = render(<ImageCounter />);
    expect(getByTestId('count').textContent).toBe('0');

    // Simulate init → loadCurrentTab → applyFilters setting images
    act(() => {
      state.filteredImages = Array.from({ length: 35 }, (_, i) => ({
        id: `img-${i}`,
        url: `https://example.com/photo-${i}.png`,
        naturalWidth: 800,
        naturalHeight: 600,
      })) as never;
    });

    expect(getByTestId('count').textContent).toBe('35');
  });

  it('component recovers when filteredImages is replaced multiple times during init', () => {
    state.filteredImages = [];

    function ImageCounter() {
      const images = useStoreSelector((s) => s.filteredImages);
      return <div data-testid="count">{images.length}</div>;
    }

    const { getByTestId } = render(<ImageCounter />);

    // Simulate: fetchImages clears → then restores
    act(() => {
      state.allImages = [];
      state.filteredImages = [];
    });
    expect(getByTestId('count').textContent).toBe('0');

    act(() => {
      state.allImages = Array.from({ length: 20 }, (_, i) => ({
        id: `img-${i}`,
        url: `u${i}`,
      })) as never;
      state.filteredImages = Array.from({ length: 18 }, (_, i) => ({
        id: `img-${i}`,
        url: `u${i}`,
      })) as never;
    });
    expect(getByTestId('count').textContent).toBe('18');
  });
});
