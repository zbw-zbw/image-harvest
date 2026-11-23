// Regression guard for the install-time onboarding arm.
//
// Unit tests mock the module graph, so they stayed green while every real
// install threw "ReferenceError: window is not defined" from Vite's
// __vitePreload() helper (a dynamic import() inside the service worker).
// This test runs the real bundle, so it fails if the arm ever goes back to
// an import chain that cannot execute in a service worker.
import { expect, test } from '@playwright/test';
import { launchExtension } from './_helpers/launchExtension';

test('install writes the onboarding arm flag from inside the service worker', async () => {
  const { context, serviceWorker } = await launchExtension();
  try {
    await expect
      .poll(
        () =>
          serviceWorker.evaluate(async () => {
            const { onboardingState } = await chrome.storage.local.get('onboardingState');
            return Boolean(onboardingState?.active);
          }),
        { timeout: 10_000 }
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});
