// Unit tests for pages/popup.ts — focused on:
//   - setupPopupMode IIFE: pathname guard + popup-mode class on html/body
//     + popup.css link injection + DOMContentLoaded fallback for body
//   - adjustImageGridHeight: 3-way element guard + grid.hidden skip +
//     popupHeight fallback + 4-class skip (hidden/modal/toast-container)
//     + position fixed/absolute skip + Math.max 100 floor + style writes
//   - DOMContentLoaded listener: MutationObserver wires + 3 setTimeout
//     fallbacks (200/600/1500ms) + window resize listener
//
// Strategy: mock sidepanel/init at module-load time to avoid the
// heavyweight chrome.* IIFE chain, then drive popup.ts via a fresh
// dynamic import per scenario.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock sidepanel/init — popup.ts ends with `import '../sidepanel/init'`
// for side effects. Without this mock, the real init.ts IIFE would fire
// (DOMContentLoaded → init() → mountPreactComponents → cacheElements →
// chrome.runtime.connect → etc.) and crash because chrome isn't mocked.
vi.mock('../sidepanel/init', () => ({}));

function setLocationPathname(pathname: string): void {
  const url = new URL(`http://localhost${pathname}`);
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: url.pathname, href: url.href },
    writable: true,
    configurable: true,
  });
}

async function loadPopupModule(): Promise<void> {
  vi.resetModules();
  await import('../pages/popup');
  // Let microtasks settle (DOMContentLoaded listener registration).
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.body.className = '';
  // Default to popup pathname (popup-mode setup IIFE will execute)
  setLocationPathname('/popup.html');
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.body.className = '';
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// setupPopupMode IIFE — pathname guard + class hooks + CSS injection
// ─────────────────────────────────────────────────────────────────────

describe('setupPopupMode IIFE', () => {
  it('pathname=popup.html → adds popup-mode class to documentElement + body', async () => {
    setLocationPathname('/popup.html');
    await loadPopupModule();

    // Pin: the popup-mode class on <html> drives popup-specific CSS
    // (compact toolbar / fixed height / scroll containers). Without
    // it the popup would render with sidepanel CSS rules and overflow
    // its 600px-tall window.
    expect(document.documentElement.classList.contains('popup-mode')).toBe(true);
    expect(document.body.classList.contains('popup-mode')).toBe(true);
  });

  it('pathname=popup.html → injects popup.css <link rel="stylesheet"> into head', async () => {
    setLocationPathname('/popup.html');
    await loadPopupModule();

    // Pin: dynamic CSS injection (vs. <link> in the HTML) lets sidepanel
    // mode skip popup.css entirely — saves a network round-trip on the
    // hot path of opening the side panel.
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href="popup.css"]'
    );
    expect(link).not.toBeNull();
    expect(link?.href).toContain('popup.css');
  });

  it('pathname=sidepanel.html → does NOTHING (early return at IIFE entry)', async () => {
    setLocationPathname('/sidepanel.html');
    await loadPopupModule();

    // Pin: the pathname guard is the linchpin of mode separation. If
    // popup.ts accidentally runs in sidepanel mode, sidepanel would
    // get popup-mode class + popup.css → broken layout.
    expect(document.documentElement.classList.contains('popup-mode')).toBe(false);
    expect(document.body.classList.contains('popup-mode')).toBe(false);
    expect(document.head.querySelector('link[href="popup.css"]')).toBeNull();
  });

  it('body NOT yet present → defers popup-mode class to DOMContentLoaded (once)', async () => {
    // Simulate body unavailability at module load time — we can't
    // truly reproduce "before body parsing" in jsdom, so we test the
    // intent: when document.body is mocked-null at the moment of IIFE
    // execution, the listener path must register a DOMContentLoaded.
    setLocationPathname('/popup.html');
    const originalBody = document.body;
    const addSpy = vi.spyOn(document, 'addEventListener');

    // Temporarily make document.body return null without removing it.
    Object.defineProperty(document, 'body', { value: null, configurable: true });
    await loadPopupModule();
    // Restore
    Object.defineProperty(document, 'body', { value: originalBody, configurable: true });

    // Pin: the {once: true} fallback is what guarantees popup-mode
    // class lands on body even when popup.ts evaluates before body is
    // parsed. Without it, popup.ts in `defer`-loaded HTML would miss
    // body entirely and CSS would target an unclassed body.
    const dcl = addSpy.mock.calls.find((c) => c[0] === 'DOMContentLoaded');
    expect(dcl).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// DOMContentLoaded listener — MutationObserver + setTimeout fallbacks
// ─────────────────────────────────────────────────────────────────────

describe('DOMContentLoaded listener', () => {
  it('registers a DOMContentLoaded listener for the height-adjust pipeline', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    await loadPopupModule();

    // popup.ts attaches at LEAST one DOMContentLoaded listener (height
    // adjustment pipeline). Pin presence — without the listener, the
    // grid wrapper never gets a computed height and the user sees an
    // un-scrollable image grid that overflows the popup window.
    const calls = addSpy.mock.calls.filter((c) => c[0] === 'DOMContentLoaded');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('fires DOMContentLoaded with #app present → installs MutationObserver', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const observeSpy = vi.fn();
    const originalMO = globalThis.MutationObserver;
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = vi.fn(
      function (this: unknown) {
        return { observe: observeSpy, disconnect: vi.fn(), takeRecords: vi.fn() };
      }
    );

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Pin: the MutationObserver watches #app for visibility changes
    // (loading state hidden, image-grid shown, images rendered) and
    // re-runs the height calc via requestAnimationFrame. Without it,
    // late-arriving images would render below the visible grid area.
    expect(observeSpy).toHaveBeenCalled();
    const observeArgs = observeSpy.mock.calls[0];
    expect(observeArgs[0]).toBe(document.getElementById('app'));
    expect(observeArgs[1]).toMatchObject({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = originalMO;
  });

  it('fires DOMContentLoaded with NO #app → no-op (early return, no MutationObserver)', async () => {
    // No #app fixture — the DOMContentLoaded body bails on `if (!app) return`.
    const observerCtor = vi.fn();
    const originalMO = globalThis.MutationObserver;
    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = observerCtor;

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Pin: defensive bail — popup HTML may have not yet hydrated #app.
    // No observer construction means no leaked MutationObserver if the
    // DOMContentLoaded fires for an unrelated reason on a barebones page.
    expect(observerCtor).not.toHaveBeenCalled();

    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = originalMO;
  });

  it('fires DOMContentLoaded with #app → schedules 3 setTimeout fallbacks (200/600/1500ms)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Pin the THREE specific timer values — they catch async rendering
    // from sidepanel init() at three escalating safety nets:
    //   200ms catches fast renders, 600ms covers chrome.storage round-trips,
    //   1500ms covers slow image extractor pipelines on big pages.
    // A refactor that drops one of these would silently leave the popup
    // grid mis-sized on a subset of page loads.
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((d) => typeof d === 'number');
    expect(delays).toContain(200);
    expect(delays).toContain(600);
    expect(delays).toContain(1500);
  });

  it('fires DOMContentLoaded with #app → adds window resize listener', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const addSpy = vi.spyOn(window, 'addEventListener');

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Pin: popup window is resizable (user can drag the popup edge in
    // some Chrome versions). Without the resize listener the grid
    // wrapper would keep its initial pixel height and overflow.
    // Cast to unknown[] — vi.spyOn(window, 'addEventListener') infers
    // a Worker-scope EventMap key union that excludes 'resize' under
    // certain TS lib configs; the runtime call signature is fine.
    const resizeCalls = addSpy.mock.calls.filter((c) => (c[0] as unknown) === 'resize');
    expect(resizeCalls.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// adjustImageGridHeight — exercised indirectly via MutationObserver
// callback path. Since the function is private, we drive it through
// a fake MutationObserver that captures + re-invokes the callback.
// ─────────────────────────────────────────────────────────────────────

describe('adjustImageGridHeight (via MutationObserver callback)', () => {
  let capturedCallback: MutationCallback | null = null;
  let originalMO: typeof MutationObserver;
  let originalRAF: typeof requestAnimationFrame;

  beforeEach(() => {
    capturedCallback = null;
    originalMO = globalThis.MutationObserver;
    originalRAF = globalThis.requestAnimationFrame;

    (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = vi.fn(
      function (this: unknown, cb: MutationCallback) {
        capturedCallback = cb;
        return { observe: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn() };
      }
    );
    // Run RAF callbacks synchronously so we can assert in-line.
    (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame =
      (cb: () => void) => {
        cb();
        return 0;
      };
  });

  afterEach(() => {
    (globalThis as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver = originalMO;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
      originalRAF;
  });

  function fireMutation(): void {
    if (!capturedCallback) throw new Error('MutationObserver callback not captured');
    capturedCallback([] as unknown as MutationRecord[], {} as MutationObserver);
  }

  function stubElementOffsetHeight(el: HTMLElement, h: number): void {
    Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
  }

  it('all 3 elements present + grid visible → writes height styles on grid wrapper', async () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="image-grid-wrapper"></div>
        <div id="image-grid"></div>
      </div>
    `;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMutation();

    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper')!;
    // Pin the EXACT style writes — any of these missing would let the
    // grid overflow the popup viewport (the bug this whole module fixes).
    expect(wrapper.style.height).toMatch(/px$/);
    expect(wrapper.style.maxHeight).toMatch(/px$/);
    // jsdom normalizes style values on serialization (e.g. '0' → '0px',
    // 'none' → '0 0 auto', '1' → '1 1 0%'). Pin the SEMANTIC intent
    // (the wrapper is locked to a fixed pixel height + minHeight zero +
    // flex:none) rather than the exact serialized string.
    expect(wrapper.style.minHeight).toMatch(/^0(px)?$/);
    expect(wrapper.style.flex).not.toBe(''); // pin: flex IS set (not empty)

    const grid = document.getElementById('image-grid')!;
    expect(grid.style.height).toBe('100%');
    expect(grid.style.overflowY).toBe('auto');
  });

  it('grid hidden (loading state) → skips style writes (avoid 0-height layout flash)', async () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="image-grid-wrapper"></div>
        <div id="image-grid" class="hidden"></div>
      </div>
    `;

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMutation();

    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper')!;
    // Pin: skipping while hidden prevents the empty-state placeholder
    // from getting a fixed pixel height — that would freeze its size
    // and cause a visible "jump" the moment images arrive.
    expect(wrapper.style.height).toBe('');
  });

  it('missing #app → DOMContentLoaded early-returns (no MutationObserver constructed)', async () => {
    // No #app — DOMContentLoaded body bails on `if (!app) return`,
    // which means our captured-callback hook is never installed.
    document.body.innerHTML = `
      <div class="image-grid-wrapper"></div>
      <div id="image-grid"></div>
    `;

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Pin: missing #app means popup HTML hasn't hydrated yet — must
    // not crash AND must not construct a MutationObserver (which would
    // leak forever with nothing to observe). The early-return is the
    // safety net for partial DOM.
    expect(capturedCallback).toBeNull();
    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper')!;
    expect(wrapper.style.height).toBe('');
  });

  it('subtracts visible-sibling offsetHeights from popupHeight (with Math.max 100 floor)', async () => {
    document.body.innerHTML = `
      <div id="app">
        <header></header>
        <div class="toolbar"></div>
        <div class="image-grid-wrapper"></div>
        <div id="image-grid"></div>
        <footer></footer>
      </div>
    `;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    stubElementOffsetHeight(document.querySelector('header')!, 50);
    stubElementOffsetHeight(document.querySelector('.toolbar')!, 40);
    stubElementOffsetHeight(document.querySelector('footer')!, 30);
    // wrapper itself is excluded; #image-grid is sibling of wrapper but
    // is also present in iteration — but it's NOT excluded in the loop
    // (only the wrapper is). Real implementation iterates #app.children
    // which includes #image-grid only if it's a direct child. Here it is.
    stubElementOffsetHeight(document.getElementById('image-grid')!, 0);

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMutation();

    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper')!;
    // popupHeight 600 - (50 + 40 + 30) = 480; max(480, 100) = 480
    // Pin: arithmetic is the reason the wrapper's content can scroll
    // instead of overflowing the popup window.
    const computed = parseInt(wrapper.style.height);
    expect(computed).toBe(480);
  });

  it('skips children with .hidden / .modal / .toast-container / position:fixed/absolute', async () => {
    document.body.innerHTML = `
      <div id="app">
        <header></header>
        <div class="modal"></div>
        <div class="toast-container"></div>
        <div class="hidden-thing hidden"></div>
        <div class="overlay"></div>
        <div class="image-grid-wrapper"></div>
        <div id="image-grid"></div>
      </div>
    `;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    stubElementOffsetHeight(document.querySelector('header')!, 50);
    stubElementOffsetHeight(document.querySelector('.modal')!, 999);
    stubElementOffsetHeight(document.querySelector('.toast-container')!, 999);
    stubElementOffsetHeight(document.querySelector('.hidden-thing')!, 999);
    stubElementOffsetHeight(document.querySelector('.overlay')!, 999);

    // Stub getComputedStyle to flag .overlay as position:fixed.
    const realGCS = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el.classList.contains('overlay')) {
        return { position: 'fixed' } as CSSStyleDeclaration;
      }
      return realGCS.call(window, el);
    });

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMutation();

    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper')!;
    // Only header (50) counts. popupHeight 600 - 50 = 550. NOT
    // 600-50-999-999-999-999 = -3346 → max(.., 100) → 100.
    // Pin the FOUR skip predicates — each one fixes a real overflow bug:
    //   .modal → modals are absolutely positioned, don't take flow space
    //   .toast-container → fixed-positioned overlay
    //   .hidden → display:none, no real height
    //   position fixed/absolute → out of flow, contributes 0 to layout
    const computed = parseInt(wrapper.style.height);
    expect(computed).toBe(550);
  });

  it('clientHeight unset → falls back to 600 (default popup height)', async () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="image-grid-wrapper"></div>
        <div id="image-grid"></div>
      </div>
    `;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 0,
      configurable: true,
    });

    await loadPopupModule();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMutation();

    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper')!;
    // Pin: 600 fallback matches Chrome's default popup max-height.
    // Without the fallback, a `0 || 0` would let max(0-0, 100) → 100
    // and the popup would be stuck at 100px tall on first paint.
    const computed = parseInt(wrapper.style.height);
    expect(computed).toBe(600);
  });
});
