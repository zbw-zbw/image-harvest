// License Key management for Image Harvest
// Depends on: constants.js (LICENSE_API_URL, LICENSE_STATUS, LICENSE_CHECK_INTERVAL, LICENSE_GRACE_PERIOD)
// These must be loaded via <script> tags before this file.

/**
 * Generate a unique instance ID for this browser installation.
 * Stored in chrome.storage.local and persists across sessions.
 */
async function getOrCreateInstanceId() {
  try {
    const result = await chrome.storage.local.get('instanceId');
    if (result.instanceId) {
      return result.instanceId;
    }
    // Generate a new instance ID
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
async function saveLicenseData(data) {
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
async function getLicenseData() {
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
async function clearLicenseData() {
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
async function validateLicenseRemote(licenseKey) {
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
async function activateLicenseRemote(licenseKey, instanceId) {
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
async function deactivateLicenseRemote(licenseKey, instanceId) {
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
 * Returns { success, error?, plan?, expiresAt? }
 */
async function activateLicense(licenseKey) {
  const normalizedKey = licenseKey.trim().toUpperCase();
  const instanceId = await getOrCreateInstanceId();

  // First validate the key
  const validation = await validateLicenseRemote(normalizedKey);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || validation.status || 'Invalid license key'
    };
  }

  // Then activate on this device
  const activation = await activateLicenseRemote(normalizedKey, instanceId);
  if (!activation.success) {
    return {
      success: false,
      error: activation.error || 'Activation failed'
    };
  }

  // Cache the license data locally
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
async function deactivateLicense() {
  const licenseData = await getLicenseData();
  if (!licenseData) {
    return { success: true };
  }

  // Try to deactivate remotely (best effort)
  await deactivateLicenseRemote(licenseData.licenseKey, licenseData.instanceId);

  // Clear local data regardless of remote result
  await clearLicenseData();

  return { success: true };
}

/**
 * Check if the current user is a Pro user.
 * Uses cached data first, then validates remotely if cache is stale.
 * Returns { isPro, plan?, expiresAt?, status? }
 */
async function isProUser() {
  const licenseData = await getLicenseData();

  // No license data - not a Pro user
  if (!licenseData || !licenseData.licenseKey) {
    return { isPro: false, status: LICENSE_STATUS.INACTIVE };
  }

  // Check if cached data is still fresh (within check interval)
  const timeSinceLastCheck = Date.now() - (licenseData.lastVerified || 0);
  const isCacheFresh = timeSinceLastCheck < LICENSE_CHECK_INTERVAL;

  if (isCacheFresh && licenseData.status === LICENSE_STATUS.ACTIVE) {
    // Cache is fresh and license was active - trust the cache
    return {
      isPro: true,
      plan: licenseData.plan,
      expiresAt: licenseData.expiresAt,
      status: LICENSE_STATUS.ACTIVE
    };
  }

  // Cache is stale - try to validate remotely
  try {
    const validation = await validateLicenseRemote(licenseData.licenseKey);

    if (validation.valid) {
      // Update cache with fresh data
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
      // License is no longer valid
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
    // Network error - use grace period
    if (licenseData.status === LICENSE_STATUS.ACTIVE) {
      const isWithinGracePeriod = timeSinceLastCheck < LICENSE_GRACE_PERIOD;
      if (isWithinGracePeriod) {
        // Within grace period - still allow Pro access
        return {
          isPro: true,
          plan: licenseData.plan,
          expiresAt: licenseData.expiresAt,
          status: LICENSE_STATUS.ACTIVE
        };
      }
    }

    // Grace period expired or license was already expired
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
async function getLicenseInfo() {
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
 * Returns the updated Pro status
 */
async function periodicLicenseCheck() {
  const licenseData = await getLicenseData();
  if (!licenseData || !licenseData.licenseKey) {
    return { isPro: false };
  }

  // Force a remote validation
  return isProUser();
}