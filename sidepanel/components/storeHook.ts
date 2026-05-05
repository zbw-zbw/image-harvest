// Bridge between the Proxy-backed `store` (sidepanel/state.ts) and Preact's
// `useSyncExternalStore`. This is the only place new component code needs to
// touch state — call `useStoreSelector(s => s.foo)` and the component
// re-renders when (and only when) the selector output changes.
//
// Note: Preact's `useSyncExternalStore` only accepts (subscribe, getSnapshot)
// — it has no SSR `getServerSnapshot` parameter like React's version, since
// extensions never SSR.
import { useSyncExternalStore } from 'preact/compat';
import { store, type EqualityFn, type Selector, type SidepanelState } from '../state';

/**
 * Subscribe to a derived value from the store. Re-renders when the selector
 * output changes; uses Object.is by default. Pass a custom comparator for
 * arrays / objects to avoid spurious re-renders when references change but
 * shallow content does not.
 */
export function useStoreSelector<T>(selector: Selector<T>, equalityFn?: EqualityFn<T>): T {
  return useSyncExternalStore(
    (onChange) => store.subscribeSelector(selector, onChange, equalityFn),
    () => selector(store.state)
  );
}

/** Read a single field reactively. Shorthand for useStoreSelector. */
export function useStoreField<K extends keyof SidepanelState>(key: K): SidepanelState[K] {
  return useStoreSelector((s) => s[key]);
}
