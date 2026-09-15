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
import type { VNode } from 'preact';
import type { ToastType } from '../state';
import { useStoreSelector } from './storeHook';

/** Semantic 14px stroke icons per toast type (currentColor = white label). */
const TOAST_ICONS: Record<ToastType, VNode> = {
  success: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  error: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

export function ToastContainer() {
  const toasts = useStoreSelector((s) => s.toasts);
  return (
    <div id="toast-container" class="toast-container">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.type}${t.fadingOut ? ' fade-out' : ''}`}>
          <span class="toast-icon">{TOAST_ICONS[t.type] ?? TOAST_ICONS.info}</span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
