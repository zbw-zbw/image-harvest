// License Key management for Image Harvest (ES Module version)
import { LICENSE_API_URL, LICENSE_STATUS, LICENSE_CHECK_INTERVAL, LICENSE_GRACE_PERIOD } from './constants.mjs';

/**
 * Generate a unique instance ID for this browser installation.
 */
export async function getOrCreateInstanceId() {
  try {
    const result = await chrome.storage.local.get('instanceId');
    if (result.instanceId) {
      return result.instanceId;
    }
    const id = 'inst_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    await chrome.storage.local.set({ instanceId: id });
    return id;
  } catch (error) {
    console.error('Failed to get/create instance ID:', error);
    return 'inst_fallback_' + Date.now();
  }
}

/**
 * Save license data to chrome.storage.local
 */
export async function saveLicenseData(data) {
  try {
    await chrome.storage.local.set({ licenseData: data });
    return true;
  } catch (error) {
    console.error('Failed to save license data:', error);
    return false;
  }
}

/**
 * Get license data from chrome.storage.local
 */
export async function getLicenseData() {
  try {
    const result = await chrome.storage.local.get('licenseData');
    return result.licenseData || null;
  } catch (error) {
    console.error('Failed to get license data:', error);
    return null;
  }
}

/**
 * Clear license data from chrome.storage.local
 */
export async function clearLicenseData() {
  try {
    await chrome.storage.local.remove('licenseData');
    return true;
  } catch (error) {
    console.error('Failed to clear license data:', error);
    return false;
  }
}

/**
 * Validate a license key against the remote API
 */
export async function validateLicenseRemote(licenseKey) {
  try {
    const response = await fetch(LICENSE_API_URL + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: licenseKey })
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to validate license remotely:', error);
    return { valid: false, error: 'Network error. Please check your connection.' };
  }
}

/**
 * Activate a license key on this device via the remote API
 */
export async function activateLicenseRemote(licenseKey, instanceId) {
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: licenseKey,
        instanceId: instanceId,
        action: 'activate'
      })
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to activate license remotely:', error);
    return { success: false, error: 'Network error. Please check your connection.' };
  }
}

/**
 * Deactivate a license key on this device via the remote API
 */
export async function deactivateLicenseRemote(licenseKey, instanceId) {
  try {
    const response = await fetch(LICENSE_API_URL + '/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: licenseKey,
        instanceId: instanceId,
        action: 'deactivate'
      })
    });

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to deactivate license remotely:', error);
    return { success: false, error: 'Network error. Please check your connection.' };
  }
}

/**
 * Activate a license key: validate remotely, activate on this device, and cache locally
 */
export async function activateLicense(licenseKey) {
  const normalizedKey = licenseKey.trim().toUpperCase();
  const instanceId = await getOrCreateInstanceId();

  const validation = await validateLicenseRemote(normalizedKey);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || validation.status || 'Invalid license key'
    };
  }

  const activation = await activateLicenseRemote(normalizedKey, instanceId);
  if (!activation.success) {
    return {
      success: false,
      error: activation.error || 'Activation failed'
    };
  }

  const licenseData = {
    licenseKey: normalizedKey,
    status: LICENSE_STATUS.ACTIVE,
    plan: activation.plan || validation.plan,
    expiresAt: activation.expiresAt || validation.expiresAt || null,
    lastVerified: Date.now(),
    instanceId: instanceId
  };

  await saveLicenseData(licenseData);

  return {
    success: true,
    plan: licenseData.plan,
    expiresAt: licenseData.expiresAt
  };
}

/**
 * Deactivate the current license and clear local data
 */
export async function deactivateLicense() {
  const licenseData = await getLicenseData();
  if (!licenseData) {
    return { success: true };
  }

  await deactivateLicenseRemote(licenseData.licenseKey, licenseData.instanceId);
  await clearLicenseData();

  return { success: true };
}

/**
 * Check if the current user is a Pro user.
 */
export async function isProUser() {
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
      status: LICENSE_STATUS.ACTIVE
    };
  }

  try {
    const validation = await validateLicenseRemote(licenseData.licenseKey);

    if (validation.valid) {
      licenseData.status = LICENSE_STATUS.ACTIVE;
      licenseData.plan = validation.plan || licenseData.plan;
      licenseData.expiresAt = validation.expiresAt !== undefined ? validation.expiresAt : licenseData.expiresAt;
      licenseData.lastVerified = Date.now();
      await saveLicenseData(licenseData);

      return {
        isPro: true,
        plan: licenseData.plan,
        expiresAt: licenseData.expiresAt,
        status: LICENSE_STATUS.ACTIVE
      };
    } else {
      licenseData.status = LICENSE_STATUS.EXPIRED;
      licenseData.lastVerified = Date.now();
      await saveLicenseData(licenseData);

      return {
        isPro: false,
        plan: licenseData.plan,
        status: LICENSE_STATUS.EXPIRED
      };
    }
  } catch (error) {
    if (licenseData.status === LICENSE_STATUS.ACTIVE) {
      const isWithinGracePeriod = timeSinceLastCheck < LICENSE_GRACE_PERIOD;
      if (isWithinGracePeriod) {
        return {
          isPro: true,
          plan: licenseData.plan,
          expiresAt: licenseData.expiresAt,
          status: LICENSE_STATUS.ACTIVE
        };
      }
    }

    return {
      isPro: false,
      plan: licenseData.plan,
      status: LICENSE_STATUS.EXPIRED
    };
  }
}

/**
 * Get the current license info (without re-validating)
 */
export async function getLicenseInfo() {
  const licenseData = await getLicenseData();
  if (!licenseData) {
    return { hasLicense: false };
  }

  return {
    hasLicense: true,
    licenseKey: licenseData.licenseKey,
    status: licenseData.status,
    plan: licenseData.plan,
    expiresAt: licenseData.expiresAt,
    lastVerified: licenseData.lastVerified,
    instanceId: licenseData.instanceId
  };
}

/**
 * Perform a periodic license check (called by background alarm)
 */
export async function periodicLicenseCheck() {
  const licenseData = await getLicenseData();
  if (!licenseData || !licenseData.licenseKey) {
    return { isPro: false };
  }

  return isProUser();
}