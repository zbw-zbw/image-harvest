// Onboarding coach marks — Phase 2a activation flow.
//
// Why this exists: over 90 days only ~2.6% of installs ever completed a
// download (925 of 5,845 installs even ran a scan). The welcome page told
// people to "click the toolbar icon" and closed itself, leaving them to
// figure out the panel alone. This component walks the user through the three
// actions that constitute the product's core value, inside the panel, right
// after the welcome page opens it on its own demo gallery.
//
// Steps advance from OBSERVED STATE, not from clicking "next" — the user is
// doing the real thing, not reading a tour:
//   1. scan   → satisfied once images are on screen
//   2. select → satisfied once at least one image is selected
//   3. download → satisfied by actions.ts calling markOnboardingDownload()
//
// Only rendered for bucket b of onboarding_flow_v1 (the welcome CTA arms
// shared/onboarding-state.ts). Dismissible at any time; resolved forever
// after the first download so it never reappears.

import { useEffect, useState } from 'preact/hooks';
import { isOnboardingActive, resolveOnboarding } from '../../shared/onboarding-state';
import { track, flushNow } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { EXPERIMENTS, getExperimentBucket } from '../../shared/ab-experiment';
import { t } from '../../shared/i18n';
import { useStoreSelector } from './storeHook';

type Step = 'scan' | 'select' | 'download';

export function OnboardingCoach() {
  const [visible, setVisible] = useState(false);
  const imageCount = useStoreSelector((s) => s.allImages.length);
  const selectedCount = useStoreSelector((s) => s.selectedImages.size);
  // Bumped by actions.ts on every successful download (also drives the
  // rating prompt's delight-moment re-check).
  const downloadTick = useStoreSelector((s) => s.ratingCheckTick);
  // Re-render on language switch so t() picks up the new catalogue.
  useStoreSelector((s) => s.localeTick);

  // Gate: only show when the welcome CTA armed the flow.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const active = await isOnboardingActive();
      if (!cancelled && active) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A download completed while the coach was up → the activation funnel's
  // terminal event. Report it once, then retire the coach for good.
  useEffect(() => {
    if (!visible || downloadTick === 0) return;
    void (async () => {
      const bucket = await getExperimentBucket(EXPERIMENTS.ONBOARDING_FLOW).catch(() => 'b');
      void track(EVENTS.ONBOARDING_DOWNLOAD_DONE, { bucket });
      void flushNow();
      await resolveOnboarding();
    })();
    setVisible(false);
  }, [visible, downloadTick]);

  // First scan that produced images — the mid-funnel signal.
  useEffect(() => {
    if (!visible || imageCount === 0) return;
    void (async () => {
      const bucket = await getExperimentBucket(EXPERIMENTS.ONBOARDING_FLOW).catch(() => 'b');
      void track(EVENTS.ONBOARDING_SCAN_DONE, { bucket });
    })();
    // Intentionally keyed on "has any image at all" rather than the exact
    // count, so a re-scan doesn't re-fire the event.
  }, [visible, imageCount > 0]);

  function dismiss(): void {
    void resolveOnboarding();
    setVisible(false);
  }

  if (!visible) return null;

  const step: Step = imageCount === 0 ? 'scan' : selectedCount === 0 ? 'select' : 'download';
  const stepIndex = step === 'scan' ? 1 : step === 'select' ? 2 : 3;

  return (
    <div id="onboarding-coach" class="onboarding-coach" role="status" aria-live="polite">
      <div class="onboarding-coach-head">
        <span class="onboarding-coach-step">
          {t('onboarding_step_counter', { n: String(stepIndex) })}
        </span>
        <button
          type="button"
          class="onboarding-coach-close icon-btn"
          aria-label={t('onboarding_dismiss')}
          title={t('onboarding_dismiss')}
          onClick={dismiss}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p class="onboarding-coach-text">{t(`onboarding_tip_${step}`)}</p>
      <div class="onboarding-coach-dots" aria-hidden="true">
        {([1, 2, 3] as const).map((i) => (
          <span key={i} class={`onboarding-coach-dot${i <= stepIndex ? ' is-active' : ''}`} />
        ))}
      </div>
    </div>
  );
}
