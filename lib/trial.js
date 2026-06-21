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
    const localKey = String(licenseInfo?.license_key || '');
    const cloudKey = String(cloudStatus?.licenseKey || '');
    const isTrialLicense = Boolean(
      licenseInfo?.trial_expires_at ||
      cloudStatus?.isTrial ||
      cloudStatus?.licenseType === 'trial' ||
      localKey.startsWith('RJD-TRIAL-') ||
      cloudKey.startsWith('RJD-TRIAL-')
    );
    const hasHadLicense = Boolean(
      (licenseInfo?.license_key || cloudStatus?.licenseKey) && !isTrialLicense
    );

    if (isRevoked) {
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

    if (isTrialLicense) {
      const rawExpiresAt = licenseInfo?.trial_expires_at ||
        licenseInfo?.expires_at ||
        cloudStatus?.expiresAt ||
        null;
      const expiresAt = rawExpiresAt ? new Date(rawExpiresAt) : null;
      const expiresAtMs = expiresAt?.getTime();

      if (expiresAt && Number.isFinite(expiresAtMs)) {
        const timeRemaining = expiresAtMs - Date.now();
        const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));

        if (licenseInfo && !licenseInfo.trial_expires_at) {
          await db.run(
            `UPDATE license_info
             SET trial_started_at = COALESCE(trial_started_at, activated_at, ?),
                 trial_expires_at = ?
             WHERE hardware_id = ?`,
            [new Date().toISOString(), expiresAt.toISOString(), hardwareId]
          );
        }

        return {
          isTrialActive: timeRemaining > 0,
          trialEnded: timeRemaining <= 0,
          isRevoked: false,
          hasHadLicense: false,
          daysRemaining: timeRemaining > 0 ? Math.max(0, daysRemaining) : 0,
          expiresAt
        };
      }
    }

    if (hasHadLicense) {
      return {
        isTrialActive: false,
        trialEnded: false,
        isRevoked: false,
        hasHadLicense: true,
        daysRemaining: 0,
        expiresAt: null
      };
    }

    // Trials are assigned only after an RJD website account is verified during setup.
    if (!licenseInfo) {
      return {
        isTrialActive: false,
        trialEnded: false,
        isRevoked: false,
        hasHadLicense: false,
        daysRemaining: 0,
        expiresAt: null
      };
    }

    // If a paid license is active, trial is not relevant.
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

    // An incomplete row remains inactive until account-bound setup finishes.
    if (!licenseInfo.license_key && !licenseInfo.is_revoked) {
      return {
        isTrialActive: false,
        trialEnded: false,
        isRevoked: false,
        hasHadLicense: false,
        daysRemaining: 0,
        expiresAt: null
      };
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
