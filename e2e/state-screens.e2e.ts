// e2e: the <StateScreens> component (sidepanel/components/StateScreens.tsx)
// renders one of three mutually exclusive screens — empty / error /
// restricted — based on the state.uiScreen discriminator. The
// production callers are showError / showEmpty / showRestricted in
// sidepanel/ui.ts, which set both uiScreen AND the per-screen info
// payload (errorInfo, emptyInfo) before flipping uiScreen.
//
// We drive uiScreen + the info payloads directly through the store
// to pin the <StateScreens> contract without going through ui.ts —
// the unit tests in tests/store.test.ts already cover ui.ts's
// hideAll/info-mutation logic, and the screens are the leaf that
// nothing else covers end-to-end.
//
// Four cases (one per visible screen variant + the recovery path
// that flips back to 'images'):
//   1. Error screen: errorInfo {code, message, workaround} → all
//      three render with the right text; .hidden goes away.
//   2. Empty 'no results' (filtered to nothing): button label flips
//      to 'Reset Filters', description is the filter-tuned copy.
//   3. Empty 'no images at all': button label flips to 'Rescan
//      Images', description is the page-tuned copy.
//   4. Recovery: setting uiScreen back to 'images' re-hides every
//      screen.
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

test('error screen: errorInfo + uiScreen=error → #error-state visible with code/message/workaround; reset hides it', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Sanity: with a successful scan the error screen is hidden.
  await expect(sidepanel.locator('#error-state')).toHaveClass(/hidden/);

  // Push errorInfo + flip uiScreen.
  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('errorInfo', {
      code: 'EXTRACT_FAILED',
      message: 'The page denied script injection.',
      workaround: 'Try refreshing or open a different page.',
    });
    w.__IH__.store.set('uiScreen', 'error');
  });

  await expect(sidepanel.locator('#error-state')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  await expect(sidepanel.locator('#error-title')).toHaveText('EXTRACT_FAILED');
  await expect(sidepanel.locator('#error-message')).toHaveText('The page denied script injection.');
  await expect(sidepanel.locator('#error-workaround')).toContainText(
    'Try refreshing or open a different page.'
  );
  // Other screens stay hidden — mutual exclusion contract.
  await expect(sidepanel.locator('#empty-state')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#restricted-state')).toHaveClass(/hidden/);

  // Recovery: flipping uiScreen back to 'images' tears down the error screen.
  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('uiScreen', 'images');
  });
  await expect(sidepanel.locator('#error-state')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });
});

test('empty screen — isNoResults=true → "Reset Filters" + filter-tuned copy', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('emptyInfo', { isNoResults: true });
    w.__IH__.store.set('uiScreen', 'empty');
  });

  await expect(sidepanel.locator('#empty-state')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  await expect(sidepanel.locator('.empty-state-title')).toHaveText('No images found');
  await expect(sidepanel.locator('.empty-state-desc')).toContainText('adjusting your filter');
  await expect(sidepanel.locator('#btn-reset-filters span')).toHaveText('Reset Filters');
});

test('empty screen — isNoResults=false → "Rescan Images" + page-tuned copy', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('emptyInfo', { isNoResults: false });
    w.__IH__.store.set('uiScreen', 'empty');
  });

  await expect(sidepanel.locator('#empty-state')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  await expect(sidepanel.locator('.empty-state-desc')).toContainText('No images were detected');
  await expect(sidepanel.locator('#btn-reset-filters span')).toHaveText('Rescan Images');
});

test('restricted screen: uiScreen=restricted → #restricted-state visible; recovery shows it again', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await expect(sidepanel.locator('#restricted-state')).toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('uiScreen', 'restricted');
  });
  await expect(sidepanel.locator('#restricted-state')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  // Static marketing card — pin a couple of stable elements.
  await expect(sidepanel.locator('.restricted-title')).toContainText('Image Harvest');
  // The other two screens stay hidden.
  await expect(sidepanel.locator('#empty-state')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#error-state')).toHaveClass(/hidden/);

  // Recovery.
  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('uiScreen', 'images');
  });
  await expect(sidepanel.locator('#restricted-state')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });
});
