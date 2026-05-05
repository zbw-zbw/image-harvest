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

interface DeactivationResult {
  success: boolean;
  error?: string;
}

/** Stable per-installation identifier; created on first call, persisted. */
export async function getOrCreateInstanceId(): Promise<string> {
  try {
    const result = await chrome.storage.local.get('instanceId');
    if (result.instanceId) return result.instanceId as string;

    const id =
      'inst_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    await chrome.storage.local.set({ instanceId: id });
    return id;
  } catch (error) {
    console.error('Failed to get/create instance ID:', error);
    return 'inst_fallback_' + Date.now();
  }
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
  const response = await fetch(LICENSE_API_URL + '/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey }),
  });

  if (!response.ok) {
    throw new Error('License verify failed: HTTP ' + response.status);
  }

  return (await response.json()) as LicenseValidationResult;
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
    return { valid: false, error: 'Network error. Please check your connection.' };
  }
}

interface RemoteActivationResponse {
  success: boolean;
  plan?: string | null;
  expiresAt?: number | null;
  error?: string;
}

export async function activateLicenseRemote(
  licenseKey: string,
  instanceId: string
): Promise<RemoteActivationResponse> {
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        instanceId,
        action: 'activate',
      }),
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    return (await response.json()) as RemoteActivationResponse;
  } catch (error) {
    console.error('Failed to activate license remotely:', error);
    return { success: false, error: 'Network error. Please check your connection.' };
  }
}

export async function deactivateLicenseRemote(
  licenseKey: string,
  instanceId: string
): Promise<DeactivationResult> {
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        instanceId,
        action: 'deactivate',
      }),
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    return (await response.json()) as DeactivationResult;
  } catch (error) {
    console.error('Failed to deactivate license remotely:', error);
    return { success: false, error: 'Network error. Please check your connection.' };
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
      error: validation.error || validation.status || 'Invalid license key',
    };
  }

  const activation = await activateLicenseRemote(normalizedKey, instanceId);
  if (!activation.success) {
    return {
      success: false,
      error: activation.error || 'Activation failed',
    };
  }

  const licenseData: LicenseData = {
    licenseKey: normalizedKey,
    status: LICENSE_STATUS.ACTIVE,
    plan: activation.plan ?? validation.plan ?? null,
    expiresAt: activation.expiresAt ?? validation.expiresAt ?? null,
    lastVerified: Date.now(),
    instanceId,
  };

  await saveLicenseData(licenseData);

  return {
    success: true,
    plan: licenseData.plan,
    expiresAt: licenseData.expiresAt,
  };
}

export async function deactivateLicense(): Promise<{ success: true }> {
  const licenseData = await getLicenseData();
  if (!licenseData) return { success: true };

  await deactivateLicenseRemote(licenseData.licenseKey, licenseData.instanceId);
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
    return {
      isPro: true,
      plan: licenseData.plan,
      expiresAt: licenseData.expiresAt,
      status: LICENSE_STATUS.ACTIVE,
    };
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
      await saveLicenseData(licenseData);

      return {
        isPro: true,
        plan: licenseData.plan,
        expiresAt: licenseData.expiresAt,
        status: LICENSE_STATUS.ACTIVE,
      };
    }

    // Server reachable AND said "not valid" → license really is expired.
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
        return {
          isPro: true,
          plan: licenseData.plan,
          expiresAt: licenseData.expiresAt,
          status: LICENSE_STATUS.ACTIVE,
        };
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
