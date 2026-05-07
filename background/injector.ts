// Content script injection with fallback strategies.
//
// In the Vite + crxjs build, the content script is declared in
// `manifest.config.ts` and is automatically injected by Chrome when matching
// pages load. This module exists to handle the edge cases where automatic
// injection didn't happen — e.g. tabs already open BEFORE the extension was
// installed/reloaded, or sub-frames that didn't get reached.
//
// We resolve the *actual* bundled content-script path at runtime from the
// manifest, so we never need to hardcode hashed asset filenames.
import { MESSAGE_TYPES, ERROR_CODES } from '../shared/constants';
import { isRestrictedUrl, sendMessageToTabWithTimeout } from './utils';

interface InjectionSuccess {
  success: true;
}

interface InjectionFailure {
  success: false;
  error: (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
  message: string;
  workaround?: string;
}

export type InjectionResult = InjectionSuccess | InjectionFailure;

interface InjectOptions {
  allFrames?: boolean;
}

/**
 * Resolve the bundled content-script entry path(s) from the running manifest.
 * crxjs emits hashed filenames like `assets/main.ts-loader-D_DFWWWV.js` — we
 * read whatever Chrome itself is using so we always inject the same files
 * that the static `content_scripts` declaration would have injected.
 */
function getContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  const declared = manifest.content_scripts?.[0]?.js;
  if (declared && declared.length > 0) return declared;
  // Fallback for the unlikely case the manifest is missing the declaration:
  // try the conventional crxjs loader naming (won't include the hash, so
  // injection will likely 404 — but at least the failure is loud).
  return ['assets/main.ts-loader.js'];
}

/** Inject the content script bundle into a tab, with several fallback paths. */
export async function injectContentScript(
  tabId: number,
  options: InjectOptions = {}
): Promise<InjectionResult> {
  const { allFrames = false } = options;

  try {
    // 1) Already injected? PING the main frame.
    try {
      await sendMessageToTabWithTimeout(tabId, { type: MESSAGE_TYPES.PING }, 2000, { frameId: 0 });
      if (allFrames) await injectIntoAllFrames(tabId);
      return { success: true };
    } catch {
      // PING failed — proceed to injection.
    }

    // 2) Bail early on restricted / unloaded tabs.
    try {
      const tabInfo = await chrome.tabs.get(tabId);
      if (isRestrictedUrl(tabInfo.url) || tabInfo.status === 'unloaded') {
        return {
          success: false,
          error: ERROR_CODES.INJECTION_FAILED,
          message: 'Cannot access this page: browser internal or error pages are not supported',
        };
      }
    } catch {
      // If tab info is unavailable, fall through to injection.
    }

    // 3) Inject the content script into the main frame only.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: getContentScriptFiles(),
    });

    // 4) Wait for the content script's onMessage listener to be ready.
    const maxPingAttempts = 3;
    const pingDelayMs = 150;
    let scriptReady = false;
    for (let attempt = 0; attempt < maxPingAttempts; attempt++) {
      try {
        await sendMessageToTabWithTimeout(tabId, { type: MESSAGE_TYPES.PING }, 1500, {
          frameId: 0,
        });
        scriptReady = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, pingDelayMs));
      }
    }

    if (!scriptReady) {
      return {
        success: false,
        error: ERROR_CODES.INJECTION_FAILED,
        message: 'Content script injected but failed to respond to PING',
      };
    }

    if (allFrames) await injectIntoAllFrames(tabId);

    return { success: true };
  } catch (error) {
    console.error('Injection failed:', error);
    const message = (error as Error).message ?? '';

    if (
      message.includes('Cannot access a chrome') ||
      message.includes('Cannot access') ||
      message.includes('prohibited') ||
      message.includes('error page') ||
      message.includes('showing error')
    ) {
      return {
        success: false,
        error: ERROR_CODES.INJECTION_FAILED,
        message: 'Cannot access this page: browser internal or error pages are not supported',
      };
    }

    if (message.includes('CSP') || message.includes('content script')) {
      return {
        success: false,
        error: ERROR_CODES.CSP_BLOCKED,
        message: 'Page security policy prevents extension access',
        workaround: 'Right-click images and select "Open in new tab" to download manually',
      };
    }

    return {
      success: false,
      error: ERROR_CODES.INJECTION_FAILED,
      message,
    };
  }
}

/** Inject the content script bundle into every sub-frame of a tab. */
export async function injectIntoAllFrames(tabId: number): Promise<void> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames) return;
    const subFrames = frames.filter((frame) => frame.frameId !== 0 && !isRestrictedUrl(frame.url));

    for (const frame of subFrames) {
      try {
        await chrome.tabs.sendMessage(
          tabId,
          { type: MESSAGE_TYPES.PING },
          { frameId: frame.frameId }
        );
      } catch {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frame.frameId] },
            files: getContentScriptFiles(),
          });
        } catch (injError) {
          console.warn(
            `Could not inject into frame ${frame.frameId} (${frame.url}):`,
            (injError as Error).message
          );
        }
      }
    }
  } catch (error) {
    console.warn('Failed to enumerate frames for all-frames injection:', error);
  }
}
