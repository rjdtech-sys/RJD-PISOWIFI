const db = require('./db');

const TRIAL_DURATION_DAYS = 7;

async function startTrialForHardware(hardwareId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db.run(
    `INSERT INTO license_info (hardware_id, is_active, is_revoked, trial_started_at, trial_expires_at)
     VALUES (?, 0, 0, ?, ?)
     ON CONFLICT(hardware_id) DO UPDATE SET
       is_active = 0,
       is_revoked = 0,
       trial_started_at = excluded.trial_started_at,
       trial_expires_at = excluded.trial_expires_at`,
    [hardwareId, now.toISOString(), expiresAt.toISOString()]
  );

  console.log(`[Trial] Trial started for hardware ${hardwareId}. Expires: ${expiresAt.toISOString()}`);

  return {
    isTrialActive: true,
    trialEnded: false,
    isRevoked: false,
    hasHadLicense: false,
    daysRemaining: TRIAL_DURATION_DAYS,
    expiresAt
  };
}

/**
 * Initialize or check trial status for the hardware
 * @param {string} hardwareId - The unique hardware identifier
 * @param {object} cloudStatus - Optional verification status from cloud
 * @returns {Promise<{isTrialActive: boolean, trialEnded: boolean, daysRemaining: number, expiresAt: Date|null}>}
 */
async function checkTrialStatus(hardwareId, cloudStatus = null) {
  try {
    // If license info exists for this hardware
    const licenseInfo = await db.get(
      'SELECT * FROM license_info WHERE hardware_id = ?',
      [hardwareId]
    );

    const isRevoked = Boolean((licenseInfo && licenseInfo.is_revoked) || (cloudStatus && cloudStatus.isRevoked));
    const hasHadLicense = Boolean((licenseInfo && licenseInfo.license_key) || (cloudStatus && cloudStatus.licenseKey));

    if (isRevoked || hasHadLicense) {
      if (isRevoked) {
        if (licenseInfo) {
          await db.run('UPDATE license_info SET is_revoked = 1, is_active = 0 WHERE hardware_id = ?', [hardwareId]);
        } else {
          await db.run(
            'INSERT INTO license_info (hardware_id, is_active, is_revoked, trial_started_at, trial_expires_at) VALUES (?, 0, 1, NULL, NULL)',
            [hardwareId]
          );
        }
      }

      return {
        isTrialActive: false,
        trialEnded: true,
        isRevoked,
        hasHadLicense,
        daysRemaining: 0,
        expiresAt: null
      };
    }

    // If no record exists, this is first run - start trial
    if (!licenseInfo) {
      return startTrialForHardware(hardwareId);
    }

    // If license is active, trial is not relevant
    if (licenseInfo.is_active && licenseInfo.license_key) {
      return {
        isTrialActive: false,
        trialEnded: false,
        isRevoked: false,
        daysRemaining: 0,
        expiresAt: null
      };
    }

    // Check trial expiration
    if (licenseInfo.trial_expires_at) {
      const expiresAt = new Date(licenseInfo.trial_expires_at);
      const now = new Date();
      const timeRemaining = expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));

      if (timeRemaining > 0) {
        return {
          isTrialActive: true,
          trialEnded: false,
          isRevoked: false,
          daysRemaining: Math.max(0, daysRemaining),
          expiresAt: expiresAt
        };
      } else {
        return {
          isTrialActive: false,
          trialEnded: true,
          isRevoked: false,
          daysRemaining: 0,
          expiresAt: expiresAt
        };
      }
    }

    // Existing row with no license and no trial dates is an incomplete first-run row.
    // Repair it by starting the first 7-day trial instead of treating a new install as expired.
    if (!licenseInfo.license_key && !licenseInfo.is_revoked) {
      return startTrialForHardware(hardwareId);
    }

    return {
      isTrialActive: false,
      trialEnded: true,
      isRevoked: false,
      hasHadLicense,
      daysRemaining: 0,
      expiresAt: null
    };

  } catch (error) {
    console.error('[Trial] Error checking trial status:', error);
    throw error;
  }
}

/**
 * Store local license activation
 * @param {string} hardwareId 
 * @param {string} licenseKey 
 */
async function activateLicense(hardwareId, licenseKey) {
  try {
    await db.run(
      `INSERT INTO license_info (hardware_id, license_key, is_active, activated_at) 
       VALUES (?, ?, 1, ?) 
       ON CONFLICT(hardware_id) DO UPDATE SET 
       license_key = ?, is_active = 1, is_revoked = 0, activated_at = ?`,
      [hardwareId, licenseKey, new Date().toISOString(), licenseKey, new Date().toISOString()]
    );
    console.log(`[License] Local license activated for hardware ${hardwareId}`);
  } catch (error) {
    console.error('[License] Error storing license activation:', error);
    throw error;
  }
}

/**
 * Get license info for hardware
 */
async function getLicenseInfo(hardwareId) {
  try {
    return await db.get(
      'SELECT * FROM license_info WHERE hardware_id = ?',
      [hardwareId]
    );
  } catch (error) {
    console.error('[Trial] Error getting license info:', error);
    return null;
  }
}

module.exports = {
  checkTrialStatus,
  activateLicense,
  getLicenseInfo,
  startTrialForHardware,
  TRIAL_DURATION_DAYS
};
