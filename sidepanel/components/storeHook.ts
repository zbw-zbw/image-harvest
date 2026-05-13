// Bridge between the Proxy-backed `store` (sidepanel/state.ts) and Preact.
// Call `useStoreSelector(s => s.foo)` and the component re-renders when (and
// only when) the selector output changes.
//
// Implementation note: we used to import `useSyncExternalStore` from
// `preact/compat`, which dragged the entire React compat layer (~6.6 KB) into
// the main sidepanel bundle. The hook below is functionally equivalent — it
// runs the selector once for the snapshot, subscribes via the store's own
// `subscribeSelector` (which already does change detection with the supplied
// equality fn), and bumps a local counter to trigger a re-render. No SSR
// concerns because extensions never SSR.
import { useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import { store, type EqualityFn, type Selector, type SidepanelState } from '../state';

const defaultEquality = <T>(a: T, b: T): boolean => Object.is(a, b);

/**
 * Subscribe to a derived value from the store. Re-renders when the selector
 * output changes; uses Object.is by default. Pass a custom comparator for
 * arrays / objects to avoid spurious re-renders when references change but
 * shallow content does not.
 */
export function useStoreSelector<T>(selector: Selector<T>, equalityFn?: EqualityFn<T>): T {
  // Force-update tick. We avoid useState(value) because we don't want
  // Preact's bail-out heuristics to skip updates when the new value is ===
  // the old one by reference but the underlying store has actually changed
  // (rare, but possible with custom equality fns). The reducer ignores its
  // action — we only care about the increment side-effect.
  const [, forceRender] = useReducer<number, void>((n) => n + 1, 0);

  // Keep the latest selector / equalityFn in a ref so we never re-subscribe
  // when the parent re-renders with new closures. Subscriptions are torn
  // down/recreated only when the store identity itself changes (never).
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equalityFn);
  selectorRef.current = selector;
  equalityRef.current = equalityFn;

  // Track the snapshot value read during render so we can detect if the
  // store changed between render and subscription registration.
  const snapshotRef = useRef<T>(selector(store.state));
  snapshotRef.current = selector(store.state);

  // useLayoutEffect (not useEffect) so the subscription is registered
  // synchronously after Preact commits the DOM — before the browser paints.
  // Combined with the stale-check below, this closes the window where store
  // mutations fired between render and subscription would be silently lost.
  useLayoutEffect(() => {
    const unsub = store.subscribeSelector(
      (s) => selectorRef.current(s),
      () => forceRender(),
      equalityRef.current
    );

    // The store may have changed between the render snapshot and now (the
    // subscription registration moment). This happens when init code
    // mutates the store synchronously after mountPreactComponents() but
    // before Preact runs effects. If the value drifted, force an immediate
    // re-render so the component doesn't stay stuck on stale data.
    const eq = equalityRef.current || defaultEquality;
    const fresh = selectorRef.current(store.state);
    if (!eq(fresh, snapshotRef.current)) {
      forceRender();
    }

    return unsub;
  }, []);

  // Snapshot read on every render — cheap, and guarantees the value matches
  // the current store state even if a store mutation occurred between
  // subscribe-time and the first paint.
  return selector(store.state);
}

/** Read a single field reactively. Shorthand for useStoreSelector. */
export function useStoreField<K extends keyof SidepanelState>(key: K): SidepanelState[K] {
  return useStoreSelector((s) => s[key]);
}
