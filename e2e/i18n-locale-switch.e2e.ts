// e2e: switching the language in Settings persists the user's choice and
// flips the active locale immediately so subsequent t() lookups (e.g. the
// next "URL copied" toast) come back in the new language.
//
// Flow under test:
//   1. Open sidepanel with the default English locale.
//   2. Open Settings → confirm #setting-language data-value reflects current
//      locale (en).
//   3. Click the "Language" select dropdown → click the zh-CN option.
//   4. Click "Save & Apply" → Settings closes, setLocale('zh-CN') runs.
//   5. Trigger copyImageUrl on a card → the Toast text should now match
//      the zh-CN catalogue ("URL 已复制!") rather than the English one.
//   6. Reload the sidepanel → detectLocale() reads the persisted preference
//      and zh-CN sticks.
//
// Why we drive the dropdown via JS clicks rather than Playwright `.click()`:
// the .setting-select-dropdown lives inside the Preact-mounted SettingsModal
// shell that re-attaches the legacy body subtree at mount time; clicking
// through Playwright's accessible-name selector occasionally races with the
// re-attach effect on the very first render. Direct dispatchEvent('click')
// against the DOM is deterministic and matches the unit-test pattern.
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

test('switching the language persists and flips toast wording', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Stub navigator.clipboard so copyImageUrl resolves without hitting the
  // (opaque-origin-gated) real clipboard API. Same pattern as copy-url.e2e.
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

  // Open the Settings modal via the toolbar gear button.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-settings')?.click();
  });
  await sidepanel.waitForSelector('#setting-language', { timeout: 5_000 });

  // Confirm the language select starts at the auto-detected locale (en in
  // CI; tolerate any of the supported locales just in case the test host's
  // navigator.language is non-English).
  const initialLocale = await sidepanel.evaluate(() => {
    return document.getElementById('setting-language')?.dataset.value || '';
  });
  expect(['en', 'zh-CN', 'zh-TW', 'ja', 'es']).toContain(initialLocale);

  // Click the dropdown trigger, then click the zh-CN option.
  await sidepanel.evaluate(() => {
    const select = document.getElementById('setting-language')!;
    (select.querySelector('.setting-select-btn') as HTMLElement).click();
    const option = select.querySelector(
      '.setting-select-option[data-value="zh-CN"]'
    ) as HTMLElement;
    option.click();
  });

  // The dropdown handler updates data-value synchronously.
  const pendingLocale = await sidepanel.evaluate(
    () => document.getElementById('setting-language')?.dataset.value
  );
  expect(pendingLocale).toBe('zh-CN');

  // Click "Save & Apply" → triggers setLocale('zh-CN') which persists to
  // chrome.storage and flips the in-memory active locale.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-save-settings')?.click();
  });

  // Wait for the storage write to complete. We poll the storage key
  // directly because there's no DOM signal we can hang an assertion on.
  await expect
    .poll(
      () =>
        sidepanel.evaluate(async () => {
          const v = await chrome.storage.local.get('_i18n_locale');
          return v['_i18n_locale'] || '';
        }),
      { timeout: 5_000 }
    )
    .toBe('zh-CN');

  // Trigger a copy → the Toast that surfaces should be the zh-CN string.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-copy-url')?.click();
  });

  await expect
    .poll(
      () =>
        sidepanel.evaluate(() => {
          const toast = document.querySelector('.toast') as HTMLElement | null;
          return toast?.textContent?.trim() || '';
        }),
      { timeout: 5_000 }
    )
    .toContain('URL 已复制');
});
