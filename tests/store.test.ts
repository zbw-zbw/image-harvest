// Tests for the reactive store wrapper around sidepanel/state.ts.
// We exercise the Proxy-based mutation tracking, per-field subscriptions,
// selector subscriptions with default + custom equality, batched setMany,
// the wildcard "subscribeAll" channel, and reset().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, store } from '../sidepanel/state';

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  store.reset();
});

describe('direct mutation via Proxy', () => {
  it('still allows `state.foo = bar` and notifies subscribers', () => {
    const spy = vi.fn();
    store.subscribe('isScanning', spy);
    state.isScanning = true;
    expect(state.isScanning).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true, false);
  });

  it('does not fire subscribers for unrelated fields', () => {
    const spy = vi.fn();
    store.subscribe('isScanning', spy);
    state.isFetching = true;
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('store.set / store.get', () => {
  it('write/read round-trip via the explicit API', () => {
    store.set('isFetching', true);
    expect(store.get('isFetching')).toBe(true);
    expect(state.isFetching).toBe(true);
  });
});

describe('subscribe (per-field)', () => {
  it('returns an unsubscribe function', () => {
    const spy = vi.fn();
    const unsub = store.subscribe('isScanning', spy);
    state.isScanning = true;
    unsub();
    state.isScanning = false;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('passes (next, prev) to listeners', () => {
    const spy = vi.fn();
    store.subscribe('scanDiscoveredCount', spy);
    state.scanDiscoveredCount = 5;
    state.scanDiscoveredCount = 10;
    expect(spy).toHaveBeenNthCalledWith(1, 5, 0);
    expect(spy).toHaveBeenNthCalledWith(2, 10, 5);
  });
});

describe('subscribeSelector', () => {
  it('fires only when the selected value changes', () => {
    const spy = vi.fn();
    store.subscribeSelector((s) => s.allImages.length, spy);

    state.allImages = [];
    expect(spy).not.toHaveBeenCalled();

    state.allImages = [{ id: 'a', url: 'u' } as never];
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1, 0);
  });

  it('honors a custom equality function', () => {
    const spy = vi.fn();
    // Always equal → listener should never fire
    store.subscribeSelector(
      (s) => s.scanDiscoveredCount,
      spy,
      () => true
    );
    state.scanDiscoveredCount = 1;
    state.scanDiscoveredCount = 2;
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function', () => {
    const spy = vi.fn();
    const unsub = store.subscribeSelector((s) => s.isScanning, spy);
    state.isScanning = true;
    unsub();
    state.isScanning = false;
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeAll', () => {
  it('fires for every field mutation with (key, next, prev)', () => {
    const spy = vi.fn();
    store.subscribeAll(spy);
    state.isScanning = true;
    state.isFetching = true;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'isScanning', true, false);
    expect(spy).toHaveBeenNthCalledWith(2, 'isFetching', true, false);
  });
});

describe('setMany (batched)', () => {
  it('applies every key and notifies after the batch', () => {
    const isScanningSpy = vi.fn();
    const isFetchingSpy = vi.fn();
    const allSpy = vi.fn();

    store.subscribe('isScanning', isScanningSpy);
    store.subscribe('isFetching', isFetchingSpy);
    store.subscribeAll(allSpy);

    store.setMany({ isScanning: true, isFetching: true });

    expect(state.isScanning).toBe(true);
    expect(state.isFetching).toBe(true);
    expect(isScanningSpy).toHaveBeenCalledTimes(1);
    expect(isFetchingSpy).toHaveBeenCalledTimes(1);
    expect(allSpy).toHaveBeenCalledTimes(2);
  });

  it('fires selector subscribers exactly once per batch when output changes', () => {
    const spy = vi.fn();
    store.subscribeSelector(
      (s) => ({ scanning: s.isScanning, fetching: s.isFetching }),
      spy,
      // Shallow equality so the new object reference doesn't fool us
      (a, b) => a.scanning === b.scanning && a.fetching === b.fetching
    );

    store.setMany({ isScanning: true, isFetching: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('reset', () => {
  it('restores every field to its initial value', () => {
    state.isScanning = true;
    state.scanDiscoveredCount = 42;
    state.allImages = [{ id: 'a', url: 'u' } as never];

    store.reset();

    expect(state.isScanning).toBe(false);
    expect(state.scanDiscoveredCount).toBe(0);
    expect(state.allImages).toEqual([]);
  });

  it('notifies subscribers of changes that happen during reset', () => {
    state.isScanning = true;
    const spy = vi.fn();
    store.subscribe('isScanning', spy);
    store.reset();
    expect(spy).toHaveBeenCalledWith(false, true);
  });
});
