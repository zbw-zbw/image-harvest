// Popup-mode entry: applies popup-specific class hooks + dynamic height
// adjustment, then loads the shared sidepanel business logic.
//
// The actual app logic lives in `sidepanel/init.ts`; this file only wires
// up popup-specific layout fixes that don't apply to side-panel mode.

// ============================================
// Popup mode setup: add classes + load popup.css
// ============================================
(function setupPopupMode(): void {
  if (!window.location.pathname.endsWith('popup.html')) return;

  // Add popup-mode class to html for CSS targeting
  document.documentElement.classList.add('popup-mode');
  if (document.body) {
    document.body.classList.add('popup-mode');
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        document.body.classList.add('popup-mode');
      },
      { once: true }
    );
  }

  // Dynamically load popup.css
  const popupStyleLink = document.createElement('link');
  popupStyleLink.rel = 'stylesheet';
  popupStyleLink.href = 'popup.css';
  document.head.appendChild(popupStyleLink);
})();

/**
 * In Chrome extension popup, CSS flex layout does not reliably constrain
 * the height of a `display: grid` child element. This causes .image-grid
 * to expand beyond the popup viewport instead of scrolling.
 *
 * Fix: dynamically compute the available height for .image-grid by
 * subtracting all visible sibling fixed-height elements from the popup height,
 * then set an explicit pixel height so overflow-y: auto can trigger.
 */
function adjustImageGridHeight(): void {
  const app = document.getElementById('app');
  const gridWrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
  const grid = document.getElementById('image-grid');
  if (!app || !gridWrapper || !grid) return;

  // Skip if grid is hidden (loading/empty state)
  if (grid.classList.contains('hidden')) return;

  const popupHeight = document.documentElement.clientHeight || 600;
  let usedHeight = 0;

  for (const child of Array.from(app.children) as HTMLElement[]) {
    // Skip the grid wrapper — we're calculating space FOR it
    if (child === gridWrapper) continue;
    // Skip hidden elements, modals, toast container
    if (child.classList.contains('hidden')) continue;
    if (child.classList.contains('modal')) continue;
    if (child.classList.contains('toast-container')) continue;
    // Skip elements with position: fixed/absolute (they don't take flow space)
    const style = window.getComputedStyle(child);
    if (style.position === 'fixed' || style.position === 'absolute') continue;

    usedHeight += child.offsetHeight;
  }

  const availableHeight = Math.max(popupHeight - usedHeight, 100);
  // Set height on the wrapper so it fills the remaining space
  gridWrapper.style.height = availableHeight + 'px';
  gridWrapper.style.maxHeight = availableHeight + 'px';
  gridWrapper.style.minHeight = '0';
  gridWrapper.style.flex = 'none';
  // Inner grid scrolls within the wrapper
  grid.style.height = '100%';
  grid.style.maxHeight = '100%';
  grid.style.minHeight = '0';
  grid.style.flex = '1';
  grid.style.overflowY = 'auto';
}

// Use a MutationObserver on #app to detect when children change visibility
// (e.g., loading-state hidden, image-grid shown, images rendered)
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (!app) return;

  // Observe all child visibility/content changes in #app
  const observer = new MutationObserver(() => {
    requestAnimationFrame(adjustImageGridHeight);
  });
  observer.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });

  // Also run on multiple delays to catch async rendering from sidepanel init()
  setTimeout(adjustImageGridHeight, 200);
  setTimeout(adjustImageGridHeight, 600);
  setTimeout(adjustImageGridHeight, 1500);

  // Re-adjust on window resize
  window.addEventListener('resize', adjustImageGridHeight);
});

// Load the shared sidepanel business logic. Importing for side effects only —
// init.ts attaches its own DOMContentLoaded listener.
import '../sidepanel/init';
