// License-key management for Image Harvest.
import {
  LICENSE_API_URL,
  LICENSE_STATUS,
  LICENSE_CHECK_INTERVAL,
  LICENSE_GRACE_PERIOD,
} from './constants';
import type {
  LicenseActivationResult,
  LicenseData,
  LicenseValidationResult,
  ProUserInfo,
} from './types';
import { verifyLicenseSignature } from './license-verify';

/** 3-day grace period after trial expiry (mirrors trial.ts constant). */
const TRIAL_EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
import { track, setEnvelopeMeta, flushNow } from './telemetry';
import { EVENTS } from './telemetry-events';

interface DeactivationResult {
  success: boolean;
  error?: string;
}

/** Stable per-installation identifier; created on first call, persisted. */
export async function getOrCreateInstanceId(): Promise<string> {
  // Retry up to 3 times with a short delay to ride out transient storage
  // failures (e.g. extension context briefly invalid after an update).
  const maxRetries = 3;
  const retryDelayMs = 200;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await chrome.storage.local.get('instanceId');
      if (result.instanceId) return result.instanceId as string;

      const id =
        'inst_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
      await chrome.storage.local.set({ instanceId: id });
      return id;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      console.error('Failed to get/create instance ID after retries:', error);
      return 'inst_fallback_' + Date.now();
    }
  }
  // Unreachable, but satisfies TypeScript's control-flow analysis.
  return 'inst_fallback_' + Date.now();
}

export async function saveLicenseData(data: LicenseData): Promise<boolean> {
  try {
    await chrome.storage.local.set({ licenseData: data });
    return true;
  } catch (error) {
    console.error('Failed to save license data:', error);
    return false;
  }
}

export async function getLicenseData(): Promise<LicenseData | null> {
  try {
    const result = await chrome.storage.local.get('licenseData');
    return (result.licenseData as LicenseData) || null;
  } catch (error) {
    console.error('Failed to get license data:', error);
    return null;
  }
}

export async function clearLicenseData(): Promise<boolean> {
  try {
    await chrome.storage.local.remove('licenseData');
    return true;
  } catch (error) {
    console.error('Failed to clear license data:', error);
    return false;
  }
}

/**
 * Hit the verify endpoint.
 *
 * Contract:
 *   - Resolves with the parsed `LicenseValidationResult` only when the server
 *     returned a well-formed response. The license may still be invalid, but
 *     the *answer* came from the source of truth.
 *   - Throws on transport-level failures (offline, DNS, TLS, 5xx, malformed
 *     JSON). This distinction matters: callers like `isProUser()` use the
 *     thrown case to engage the offline grace period instead of immediately
 *     marking a paying customer as expired.
 */
export async function validateLicenseRemote(licenseKey: string): Promise<LicenseValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(LICENSE_API_URL + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('License verify failed: HTTP ' + response.status);
    }

    const data = await response.json();
    return sanitizeLicenseResult(data);
  } finally {
    clearTimeout(timeout);
  }
}

const VALID_PLANS = ['monthly', 'yearly', 'lifetime', 'trial'];

function sanitizeLicenseResult(data: unknown): LicenseValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid response format' };
  }
  const obj = data as Record<string, unknown>;
  const plan = typeof obj.plan === 'string' && VALID_PLANS.includes(obj.plan) ? obj.plan : null;

  // expiresAt: accept number (epoch ms) directly, or parse ISO string as fallback.
  // The server should return epoch ms, but we handle string defensively in case
  // an older backend version returns the raw ISO date from PostgreSQL.
  let expiresAt: number | null = null;
  if (typeof obj.expiresAt === 'number') {
    expiresAt = obj.expiresAt;
  } else if (typeof obj.expiresAt === 'string') {
    const parsed = new Date(obj.expiresAt).getTime();
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  }

  return {
    valid: Boolean(obj.valid),
    status: typeof obj.status === 'string' ? obj.status : undefined,
    plan,
    expiresAt,
    error: typeof obj.error === 'string' ? obj.error : undefined,
    signature: typeof obj.signature === 'string' ? obj.signature : undefined,
    signedAt: typeof obj.signedAt === 'number' ? obj.signedAt : undefined,
  };
}

/**
 * Same as `validateLicenseRemote` but never throws — used by the activation
 * flow where the user is actively waiting for a UI message and a network
 * error should surface as a friendly result, not an exception.
 */
async function validateLicenseRemoteSafe(licenseKey: string): Promise<LicenseValidationResult> {
  try {
    return await validateLicenseRemote(licenseKey);
  } catch (error) {
    console.error('Failed to validate license remotely:', error);
    return { valid: false, error: 'license_error_network' };
  }
}

interface RemoteActivationResponse {
  success: boolean;
  plan?: string | null;
  expiresAt?: number | null;
  error?: string;
  signature?: string;
  signedAt?: number;
}

export async function activateLicenseRemote(
  licenseKey: string,
  instanceId: string
): Promise<RemoteActivationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        instanceId,
        action: 'activate',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    const data = (await response.json()) as Record<string, unknown>;
    // Sanitize expiresAt — server returns epoch ms, but handle string defensively.
    let expiresAt: number | null = null;
    if (typeof data.expiresAt === 'number') {
      expiresAt = data.expiresAt;
    } else if (typeof data.expiresAt === 'string') {
      const parsed = new Date(data.expiresAt).getTime();
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    }
    return {
      success: Boolean(data.success),
      plan: typeof data.plan === 'string' ? data.plan : null,
      expiresAt,
      error: typeof data.error === 'string' ? data.error : undefined,
      signature: typeof data.signature === 'string' ? data.signature : undefined,
      signedAt: typeof data.signedAt === 'number' ? data.signedAt : undefined,
    };
  } catch (error) {
    console.error('Failed to activate license remotely:', error);
    return { success: false, error: 'license_error_network' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function deactivateLicenseRemote(
  licenseKey: string,
  instanceId: string
): Promise<DeactivationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        instanceId,
        action: 'deactivate',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    return (await response.json()) as DeactivationResult;
  } catch (error) {
    console.error('Failed to deactivate license remotely:', error);
    return { success: false, error: 'license_error_network' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Activate a license key end-to-end: validate, claim, and persist locally.
 */
export async function activateLicense(licenseKey: string): Promise<LicenseActivationResult> {
  const normalizedKey = licenseKey.trim().toUpperCase();
  const instanceId = await getOrCreateInstanceId();

  // Activation is user-initiated; surface network errors as friendly results
  // instead of letting them bubble out as unhandled rejections.
  const validation = await validateLicenseRemoteSafe(normalizedKey);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || validation.status || 'license_error_invalid_key',
    };
  }

  const activation = await activateLicenseRemote(normalizedKey, instanceId);
  if (!activation.success) {
    return {
      success: false,
      error: activation.error || 'license_error_activation_failed',
    };
  }

  const licenseData: LicenseData = {
    licenseKey: normalizedKey,
    status: LICENSE_STATUS.ACTIVE,
    plan: activation.plan ?? validation.plan ?? null,
    expiresAt: activation.expiresAt ?? validation.expiresAt ?? null,
    lastVerified: Date.now(),
    instanceId,
    // Prefer the activation signature; fall back to the verify signature.
    signature: activation.signature ?? validation.signature,
    signedAt: activation.signedAt ?? validation.signedAt,
  };

  await saveLicenseData(licenseData);

  // Telemetry: this is the FINAL conversion event in the funnel — every
  // success here is a real paid customer. Update envelope plan first so
  // downstream events in this session carry the correct plan, then fire
  // the activation event and flush immediately (don't wait for the 5s
  // batch window — the user may close the panel right after).
  try {
    setEnvelopeMeta({ plan: licenseData.plan || 'pro' });
    await track(EVENTS.LICENSE_ACTIVATED, { plan: licenseData.plan || 'pro' });
    await flushNow();
  } catch {
    /* telemetry must never block activation success */
  }

  return {
    success: true,
    plan: licenseData.plan,
    expiresAt: licenseData.expiresAt,
  };
}

/**
 * Self-serve unbind (P2-3): release ALL devices bound to this license key on the
 * server. Used when the user hits the max-instances limit on a NEW device and
 * no longer has the old device to deactivate from. Never needs an instanceId.
 */
export async function resetLicenseInstancesRemote(
  licenseKey: string
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: licenseKey.trim().toUpperCase(),
        action: 'reset',
      }),
      signal: controller.signal,
    });

    // The reset endpoint returns 400 (not ok) with a coded error body on
    // expected failures (e.g. cooldown); parse those. Only treat other
    // non-2xx as transport failures.
    if (!response.ok && response.status !== 400) {
      throw new Error('API request failed: ' + response.status);
    }

    return (await response.json()) as { success: boolean; error?: string };
  } catch (error) {
    console.error('Failed to reset license instances remotely:', error);
    return { success: false, error: 'license_error_network' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Self-serve unbind + re-activate on THIS device in one step: release all bound
 * devices server-side, then run the normal activation flow. Surfaces the reset
 * error (e.g. cooldown) if the release fails.
 */
export async function resetAndActivateLicense(
  licenseKey: string
): Promise<LicenseActivationResult> {
  const reset = await resetLicenseInstancesRemote(licenseKey);
  if (!reset.success) {
    return { success: false, error: reset.error || 'license_error_reset_failed' };
  }
  return activateLicense(licenseKey);
}

export async function deactivateLicense(): Promise<{ success: boolean; error?: string }> {
  const licenseData = await getLicenseData();
  if (!licenseData) return { success: true };

  // Trial licenses live in a separate `trials` table on the server.
  // The /api/license/activate endpoint only knows about paid licenses; routing a trial key
  // through it would 404 and surface a confusing error to the user
  // who's just trying to revoke their own trial. Skip the remote
  // call — the local sentinel in shared/trial.ts already prevents
  // re-redemption, and the trial expires server-side regardless.
  if (licenseData.plan !== 'trial') {
    const result = await deactivateLicenseRemote(licenseData.licenseKey, licenseData.instanceId);
    if (!result.success) {
      // Remote deactivation failed — do NOT clear local data to prevent
      // permanently leaking an activation slot on the server. The user
      // can retry later.
      return { success: false, error: result.error || 'license_error_deactivation_failed' };
    }
  }
  await clearLicenseData();

  return { success: true };
}

/**
 * Check if the current user is a Pro user. Honors the local cache (24h) and
 * a 7-day offline grace period before falling back to non-Pro.
 */
export async function isProUser(): Promise<ProUserInfo> {
  const licenseData = await getLicenseData();

  if (!licenseData || !licenseData.licenseKey) {
    return { isPro: false, status: LICENSE_STATUS.INACTIVE };
  }

  const timeSinceLastCheck = Date.now() - (licenseData.lastVerified || 0);
  const isCacheFresh = timeSinceLastCheck < LICENSE_CHECK_INTERVAL;

  if (isCacheFresh && licenseData.status === LICENSE_STATUS.ACTIVE) {
    // Trust the cache unless the signature is present but INVALID (tampering).
    // 'unsigned' (legacy/trial or no signing key) still trusts the cache, so
    // existing users and trials are unaffected.
    const sig = await verifyLicenseSignature(licenseData);
    if (sig !== 'invalid') {
      return {
        isPro: true,
        plan: licenseData.plan,
        expiresAt: licenseData.expiresAt,
        status: LICENSE_STATUS.ACTIVE,
      };
    }
    console.warn('License signature invalid — forcing remote verification.');
  }

  // Remote verify path. We deliberately let `validateLicenseRemote` throw on
  // transport-level failures (offline / 5xx / malformed JSON) so the catch
  // block below can engage the offline grace period instead of treating an
  // outage as proof of cancellation.
  try {
    const validation = await validateLicenseRemote(licenseData.licenseKey);

    if (validation.valid) {
      licenseData.status = LICENSE_STATUS.ACTIVE;
      licenseData.plan = validation.plan ?? licenseData.plan;
      licenseData.expiresAt =
        validation.expiresAt !== undefined ? validation.expiresAt : licenseData.expiresAt;
      licenseData.lastVerified = Date.now();
      // Refresh the tamper-evidence signature from the authoritative response.
      licenseData.signature = validation.signature;
      licenseData.signedAt = validation.signedAt;
      await saveLicenseData(licenseData);

      return {
        isPro: true,
        plan: licenseData.plan,
        expiresAt: licenseData.expiresAt,
        status: LICENSE_STATUS.ACTIVE,
      };
    }

    // Server reachable AND said "not valid" → license really is expired.
    // For trial licenses, allow a 3-day grace period where Pro features
    // are still accessible but a banner urges the user to upgrade.
    if (licenseData.plan === 'trial' && licenseData.expiresAt) {
      const elapsed = Date.now() - licenseData.expiresAt;
      if (elapsed >= 0 && elapsed <= TRIAL_EXPIRY_GRACE_MS) {
        licenseData.status = LICENSE_STATUS.EXPIRED;
        licenseData.lastVerified = Date.now();
        await saveLicenseData(licenseData);
        return {
          isPro: true,
          plan: licenseData.plan,
          expiresAt: licenseData.expiresAt,
          status: LICENSE_STATUS.EXPIRED,
          inGracePeriod: true,
        };
      }
    }

    // Persist so we don't keep re-asking the network on every check.
    licenseData.status = LICENSE_STATUS.EXPIRED;
    licenseData.lastVerified = Date.now();
    await saveLicenseData(licenseData);

    return {
      isPro: false,
      plan: licenseData.plan,
      status: LICENSE_STATUS.EXPIRED,
    };
  } catch (error) {
    // Network/transport error. Fall back to the offline grace period: as long
    // as we previously saw the license as ACTIVE within the last
    // LICENSE_GRACE_PERIOD, keep treating the user as Pro. Crucially we do
    // NOT bump `lastVerified` here — that would silently extend the grace
    // window forever during a long outage.
    console.warn('License verify unreachable, falling back to grace period:', error);
    if (licenseData.status === LICENSE_STATUS.ACTIVE) {
      const isWithinGracePeriod = timeSinceLastCheck < LICENSE_GRACE_PERIOD;
      if (isWithinGracePeriod) {
        // Don't extend the grace period to a tampered record: a present-but-
        // invalid signature means the cached fields were edited offline.
        const sig = await verifyLicenseSignature(licenseData);
        if (sig !== 'invalid') {
          return {
            isPro: true,
            plan: licenseData.plan,
            expiresAt: licenseData.expiresAt,
            status: LICENSE_STATUS.ACTIVE,
          };
        }
        console.warn('License signature invalid during offline grace — denying Pro.');
      }
    }

    return {
      isPro: false,
      plan: licenseData.plan,
      status: LICENSE_STATUS.EXPIRED,
    };
  }
}

/** Get the cached license info without re-validating against the server. */
export async function getLicenseInfo(): Promise<
  | { hasLicense: false }
  | (Omit<LicenseData, 'status'> & { hasLicense: true; status: LicenseData['status'] })
> {
  const licenseData = await getLicenseData();
  if (!licenseData) return { hasLicense: false };

  return {
    hasLicense: true,
    licenseKey: licenseData.licenseKey,
    status: licenseData.status,
    plan: licenseData.plan,
    expiresAt: licenseData.expiresAt,
    lastVerified: licenseData.lastVerified,
    instanceId: licenseData.instanceId,
  };
}

/** Periodic background check; safe to call from an alarm handler. */
export async function periodicLicenseCheck(): Promise<ProUserInfo | { isPro: false }> {
  const licenseData = await getLicenseData();
  if (!licenseData || !licenseData.licenseKey) {
    return { isPro: false };
  }
  return isProUser();
}
