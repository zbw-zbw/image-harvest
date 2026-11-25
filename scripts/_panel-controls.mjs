/**
 * Side-panel controls shared by the store-screenshot and hero-video scripts.
 *
 * Both drive the real extension through Playwright, so the "get the panel into a
 * presentable state" steps (unlock Pro, clear first-run chrome, wait for
 * thumbnails) have to behave identically or the video and the stills disagree.
 */

/**
 * Unlock Pro without a licence server. The panel re-validates on open, so the
 * message handler is stubbed as well as the store flag — otherwise the panel
 * drops back to Free a moment after the shot is taken.
 */
export async function enablePro(panel) {
  await panel.waitForFunction(() => Boolean(window.__IH__), undefined, { timeout: 10_000 });
  await panel.evaluate(() => {
    const chromeApi = window.chrome;
    const original = chromeApi.runtime.sendMessage.bind(chromeApi.runtime);
    chromeApi.runtime.sendMessage = (request, ...rest) => {
      if (request && request.type === 'VALIDATE_LICENSE') {
        return Promise.resolve({ isPro: true, expiresAt: null });
      }
      return original(request, ...rest);
    };
    window.__IH__.store.set('isProUser', true);
  });
}

/**
 * First-run chrome (referral banner, "N images ready to download" bar, the
 * 3-step coach mark) is designed to be dismissed on first use. Every real
 * screenshot of a working session has it out of the way already.
 */
export async function dismissNudges(panel) {
  for (const selector of [
    '.referral-banner-close',
    '.download-nudge-close',
    '.onboarding-coach-close',
  ]) {
    const button = panel.locator(selector).first();
    if ((await button.count()) && (await button.isVisible())) {
      await button.click({ timeout: 2_000 }).catch(() => {});
      await panel.waitForTimeout(200);
    }
  }
}

/** Wait until every on-screen thumbnail has decoded, so nothing catches a blank card. */
export async function waitForThumbnails(panel) {
  await panel.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('#image-grid .card-thumb img')];
      const visible = imgs.filter((img) => {
        const box = img.getBoundingClientRect();
        return box.top < window.innerHeight && box.bottom > 0;
      });
      // Lazy thumbnails below the fold never decode, so only on-screen ones are
      // part of the contract.
      return visible.length > 0 && visible.every((img) => img.complete && img.naturalWidth > 0);
    },
    undefined,
    { timeout: 15_000 }
  );
}

/** Toasts ("Found 9 images", "Downloaded 5 files") auto-fade; wait them out. */
export async function waitForToastsToClear(panel) {
  await panel
    .waitForFunction(
      () => document.querySelectorAll('#toast-container .toast').length === 0,
      undefined,
      { timeout: 8_000 }
    )
    .catch(() => {});
}

/**
 * Reset both scroll positions. `#image-grid` is its own scroll container, so
 * window.scrollTo() alone leaves the grid wherever the last clicked card was.
 */
export async function scrollToTop(panel) {
  await panel.evaluate(() => {
    window.scrollTo(0, 0);
    document.getElementById('image-grid')?.scrollTo(0, 0);
  });
}

/**
 * Selecting a card dims the page to 50% black and outlines the matching image —
 * the extension's "show me this one on the page" view. It is the right
 * behaviour in use, but it leaves the page half of a still frame looking muddy,
 * so a click on empty page space exits it and keeps the selection intact.
 */
export async function dismissPageHighlight(page, pageWidth) {
  const dimmed = await page.evaluate(() =>
    Boolean(document.querySelector('.image-harvest-overlay'))
  );
  if (!dimmed) return;
  await page.mouse.click(pageWidth - 120, 110);
  await page.waitForTimeout(250);
}
