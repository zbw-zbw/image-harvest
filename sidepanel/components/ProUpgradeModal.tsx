// Pro Upgrade modal. Replaces the imperative show/closeProUpgradeModal in
// settings.ts. Key constraints worth noting:
//
//   - The input + activate button + error <p> + "Get Pro" link are bound by
//     bindLicenseEvents() using getElementById, so we MUST keep their ids
//     stable and the DOM node identity stable across re-renders. Preact's
//     reconciliation does that for us as long as we don't remount the
//     subtree (we toggle visibility via the `hidden` class instead).
//
//   - The activation flow surfaces a one-line error string; we read it from
//     state.proUpgradeModalState.errorText and render it conditionally.
//     settings.ts will be updated to push errors into the store rather than
//     directly twiddling the <p>'s textContent (that was the old pattern).
import { useStoreSelector } from './storeHook';
import { state } from '../state';

function close(): void {
  // Clear errorText on close so the next open starts clean.
  state.proUpgradeModalState = { open: false, errorText: '' };
}

export function ProUpgradeModal() {
  const ms = useStoreSelector((s) => s.proUpgradeModalState);
  return (
    <div id="pro-upgrade-modal" class={`modal${ms.open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div class="modal-content pro-upgrade-content">
        <div class="modal-header">
          <h2>
            <svg
              class="modal-title-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
              <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </svg>
            Upgrade to Pro
          </h2>
          <button id="btn-pro-upgrade-close" class="icon-btn" onClick={close}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="pro-upgrade-hero">
            <p class="pro-upgrade-desc">Unlock all premium features with a License Key.</p>
          </div>
          <div class="pro-upgrade-input-section">
            <div class="license-input-row">
              {/* Input + activate button keep their original ids so
                  bindLicenseEvents() in settings.ts continues to work. */}
              <input
                type="text"
                id="pro-modal-key-input"
                class="license-input"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                maxlength={19}
                spellcheck={false}
                autocomplete="off"
              />
              <button id="btn-pro-modal-activate" class="btn btn-primary btn-sm">
                Activate
              </button>
            </div>
            <p id="pro-modal-error" class={`license-error${ms.errorText ? '' : ' hidden'}`}>
              {ms.errorText}
            </p>
            <p class="setting-desc license-hint">
              {`Don't have a key? `}
              <a id="link-pro-modal-get" href="#" class="license-link">
                Get Pro →
              </a>
            </p>
          </div>
          <div class="pro-upgrade-features">
            <h4>Pro Features</h4>
            <ul class="pro-feature-list">
              <ProFeatureItem
                title="Similar & Duplicate Detection"
                desc="Automatically find and group visually similar or duplicate images using perceptual hashing."
              />
              <ProFeatureItem
                title="Color Extraction & Filtering"
                desc="Extract dominant colors from each image and filter by color palette."
              />
              <ProFeatureItem
                title="Reverse Image Search"
                desc="Search any image across Google, TinEye, Baidu, and Yandex with one click."
              />
              <ProFeatureItem
                title="Image Collection"
                desc="Save favorite images to a persistent collection across browsing sessions."
              />
              <ProFeatureItem
                title="Multi-Tab Extraction"
                desc="Extract images from multiple open tabs simultaneously and merge results."
              />
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FeatureProps {
  title: string;
  desc: string;
}

function ProFeatureItem({ title, desc }: FeatureProps) {
  return (
    <li>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <div>
        <strong>{title}</strong>
        <p>{desc}</p>
      </div>
    </li>
  );
}
