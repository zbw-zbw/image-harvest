// e2e: clicking the toolbar "Copy URLs" button (Sprint 3.4) writes ALL
// currently-selected image URLs to the clipboard, newline-separated, and
// surfaces a count toast.
//
// Component contract under test (BatchUrlCopyButton.tsx + actions.copyImageUrls):
//   1. With nothing selected: button label = "Copy URLs", clicking copies
//      the full filtered list (Download All parity).
//   2. With selection: label becomes "Copy URLs (N)", clicking copies only
//      the selected ones in grid order.
//   3. Pro guard: free user past FREE_LIMITS.MAX_BATCH_COPY_URLS triggers
//      the upgrade modal — covered in unit tests; not duplicated here
//      because the e2e fixture only seeds 3 cards.
//
// Same clipboard-stub pattern as e2e/copy-url.e2e.ts; the real clipboard
// API is unreachable from chrome-extension:// origins under Playwright.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type LaunchedExtension,
} from './_helpers/launchExtension';

let ext: LaunchedExtension;
let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
  await fixtureServer?.close();
});

test('toolbar "Copy URLs" copies all filtered URLs newline-joined and toasts the count', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Install the same clipboard stub as copy-url.e2e.ts so writeText() is
  // captured into a global array we can assert against.
  await sidepanel.evaluate(() => {
    interface ClipboardWindow extends Window {
      __IH_CLIPBOARD_CALLS__?: string[];
    }
    const w = window as ClipboardWindow;
    w.__IH_CLIPBOARD_CALLS__ = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__IH_CLIPBOARD_CALLS__!.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  // Snapshot the URLs we expect to be copied. We use the actual rendered
  // <img src="..."> values — same source the component reads through
  // state.filteredImages — so the assertion is robust to fixture changes.
  const allUrls = await sidepanel.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLImageElement>('#image-grid .image-card img'))
      .map((img) => img.src)
      .filter(Boolean);
  });
  expect(allUrls.length).toBeGreaterThan(0);

  // Click the batch-copy button (no selection → falls back to "all
  // filtered", matching Download All UX).
  await sidepanel.waitForSelector('#btn-batch-copy-urls', { timeout: 5_000 });
  await sidepanel.evaluate(() => {
    document.getElementById('btn-batch-copy-urls')?.click();
  });

  // The component awaits copyImageUrls → clipboard.writeText → pushes the
  // joined string into __IH_CLIPBOARD_CALLS__.
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as Window & { __IH_CLIPBOARD_CALLS__?: string[] };
          return w.__IH_CLIPBOARD_CALLS__ ?? [];
        }),
      { timeout: 5_000 }
    )
    .toEqual([allUrls.join('\n')]);

  // The success toast surfaces the count — same wording as t('toast.url_copied.batch').
  await expect
    .poll(
      () =>
        sidepanel.evaluate(() => {
          const toast = document.querySelector('.toast') as HTMLElement | null;
          return toast?.textContent?.trim() || '';
        }),
      { timeout: 5_000 }
    )
    .toContain(`${allUrls.length} URLs copied`);
});

test('selecting a subset and clicking "Copy URLs" copies only the selected URLs', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.evaluate(() => {
    interface ClipboardWindow extends Window {
      __IH_CLIPBOARD_CALLS__?: string[];
    }
    const w = window as ClipboardWindow;
    w.__IH_CLIPBOARD_CALLS__ = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__IH_CLIPBOARD_CALLS__!.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  // Toggle selection on the FIRST card via its checkbox change event,
  // which is the same path real users hit through ImageCard.handleCheckboxChange.
  const firstUrl = await sidepanel.evaluate(() => {
    const card = document.querySelector<HTMLElement>('#image-grid .image-card');
    const cb = card?.querySelector<HTMLInputElement>('.card-checkbox input');
    if (!cb) return '';
    cb.click();
    const img = card?.querySelector<HTMLImageElement>('img');
    return img?.src ?? '';
  });
  expect(firstUrl).toBeTruthy();

  // Wait for the label to reflect the count → guarantees the store
  // subscription has flushed before we click.
  await expect
    .poll(
      () =>
        sidepanel.evaluate(() => {
          const label = document.querySelector('#btn-batch-copy-urls .select-all-text');
          return label?.textContent || '';
        }),
      { timeout: 3_000 }
    )
    .toContain('(1)');

  // Click the batch-copy button → only the selected URL should be copied.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-batch-copy-urls')?.click();
  });

  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as Window & { __IH_CLIPBOARD_CALLS__?: string[] };
          return w.__IH_CLIPBOARD_CALLS__ ?? [];
        }),
      { timeout: 5_000 }
    )
    .toEqual([firstUrl]);
});
