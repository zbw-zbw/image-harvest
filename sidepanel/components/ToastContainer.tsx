// Toast notifications. Replaces the imperative `showToast` body in
// sidepanel/ui.ts that built a `<div class="toast">` and appended it to
// `#toast-container`. The new flow:
//   1. `showToast(msg, type)` pushes a ToastItem onto state.toasts
//   2. <ToastContainer> re-renders the list reactively
//   3. After 2.5s the item is marked `fadingOut` so CSS can animate it
//   4. After 3.0s it's removed from state.toasts entirely
//
// Only one toast is ever visible at a time (matches the legacy behavior of
// clearing the container before each push); `showToast` enforces that by
// replacing state.toasts wholesale rather than appending.
import { useStoreSelector } from './storeHook';

export function ToastContainer() {
  const toasts = useStoreSelector((s) => s.toasts);
  return (
    <div id="toast-container" class="toast-container">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.type}${t.fadingOut ? ' fade-out' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
