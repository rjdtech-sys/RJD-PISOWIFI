import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getUniqueHardwareId } from './hardware';
import * as db from './db';

interface LicenseRecord {
  id: string;
  license_key: string;
  hardware_id: string | null;
  vendor_id: string | null;
  is_active: boolean;
  max_online_users?: number | null;
  activated_at: string | null;
  created_at: string;
}

interface LicenseVerification {
  isValid: boolean;
  isActivated: boolean;
  maxOnlineUsers?: number | null;
  expiresAt?: Date;
  error?: string;
}

export class LicenseManager {
  private supabase: SupabaseClient | null = null;
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    // Allow configuration via environment variables or constructor
    this.supabaseUrl = supabaseUrl || process.env.SUPABASE_URL || '';
    this.supabaseKey = supabaseKey || process.env.SUPABASE_ANON_KEY || '';

    if (this.supabaseUrl && this.supabaseKey) {
      this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
      console.log('[License] Supabase client initialized');
    } else {
      console.warn('[License] Supabase credentials not provided. License verification disabled.');
    }
  }

  private normalizeMaxOnlineUsers(value: unknown): number | null {
    const parsed = parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  /**
   * Activate a license key by binding it to the current hardware
   * @param licenseKey The license key to activate
   * @returns Success status and message
   */
  async activateDevice(licenseKey: string): Promise<{ success: boolean; message: string; license?: LicenseRecord }> {
    if (!this.supabase) {
      // If Supabase isn't configured, try to activate using local database only
      try {
        const hardwareId = await getUniqueHardwareId();
        console.log(`[License] Attempting local activation with hardware ID: ${hardwareId}`);
        
        // Check if this hardware is already activated locally
        const existingLocal = await db.get('SELECT * FROM license_info WHERE hardware_id = ?', [hardwareId]);
        
        if (existingLocal) {
          if (existingLocal.license_key === licenseKey) {
            return { 
              success: true, 
              message: 'Device already activated with this license key.',
              license: { 
                id: existingLocal.id,
                license_key: existingLocal.license_key,
                hardware_id: existingLocal.hardware_id,
                vendor_id: existingLocal.vendor_id || null,
                is_active: existingLocal.is_active,
                max_online_users: this.normalizeMaxOnlineUsers(existingLocal.max_online_users),
                activated_at: existingLocal.activated_at,
                created_at: existingLocal.created_at
              }
            };
          } else {
            return { 
              success: false, 
              message: 'This device is already bound to a different license key. Contact support for reassignment.' 
            };
          }
        }
        
        // Check if the license key exists in local database and is available
        const localLicense = await db.get('SELECT * FROM license_info WHERE license_key = ? AND hardware_id IS NULL', [licenseKey]);
        
        if (!localLicense) {
          // Try to add this license key to local database (for offline activation)
          try {
            await db.run(
              'INSERT INTO license_info (hardware_id, license_key, is_active, activated_at) VALUES (?, ?, 1, ?)', 
              [hardwareId, licenseKey, new Date().toISOString()]
            );
            
            console.log('[License] Local license activated successfully');
            return { 
              success: true, 
              message: 'License activated successfully! Your device is now authorized.',
              license: { 
                id: null,
                license_key: licenseKey,
                hardware_id: hardwareId,
                vendor_id: null,
                is_active: true,
                max_online_users: null,
                activated_at: new Date().toISOString(),
                created_at: new Date().toISOString()
              }
            };
          } catch (insertErr: any) {
            console.error('[License] Error inserting local license:', insertErr);
            return { success: false, message: 'Failed to activate license locally.' };
          }
        } else {
          // License exists locally but is not active
          try {
            await db.run('UPDATE license_info SET hardware_id = ?, is_active = 1, activated_at = ? WHERE license_key = ?', 
              [hardwareId, new Date().toISOString(), licenseKey]);
            
            console.log('[License] Local license activated successfully');
            return { 
              success: true, 
              message: 'License activated successfully! Your device is now authorized.',
              license: { 
                id: localLicense.id,
                license_key: licenseKey,
                hardware_id: hardwareId,
                vendor_id: localLicense.vendor_id || null,
                is_active: true,
                max_online_users: this.normalizeMaxOnlineUsers(localLicense.max_online_users),
                activated_at: new Date().toISOString(),
                created_at: localLicense.created_at
              }
            };
          } catch (updateErr: any) {
            console.error('[License] Error updating local license:', updateErr);
            return { success: false, message: 'Failed to activate license locally.' };
          }
        }
      } catch (localError: any) {
        console.error('[License] Local activation error:', localError);
        return { 
          success: false, 
          message: localError.message || 'An unexpected error occurred during local activation.' 
        };
      }
    }

    try {
      // Get hardware ID
      const hardwareId = await getUniqueHardwareId();
      console.log(`[License] Attempting activation with hardware ID: ${hardwareId}`);

      // Check if this hardware is already activated
      const { data: existingHardware, error: hwError } = await this.supabase
        .from('licenses')
        .select('*')
        .eq('hardware_id', hardwareId)
        .maybeSingle();

      if (hwError) {
        console.error('[License] Error checking existing hardware:', hwError);
        return { success: false, message: `Database error: ${hwError.message}` };
      }

      if (existingHardware) {
        if (existingHardware.license_key === licenseKey) {
          // Also update local database
          await db.run(
            'INSERT OR REPLACE INTO license_info (hardware_id, license_key, is_active, max_online_users, activated_at, created_at) VALUES (?, ?, 1, ?, ?, ?)', 
            [hardwareId, existingHardware.license_key, this.normalizeMaxOnlineUsers(existingHardware.max_online_users), existingHardware.activated_at || new Date().toISOString(), existingHardware.created_at]
          );
          
          return { 
            success: true, 
            message: 'Device already activated with this license key.',
            license: existingHardware 
          };
        } else {
          return { 
            success: false, 
            message: 'This device is already bound to a different license key. Contact support for reassignment.' 
          };
        }
      }

      // Check if the license key exists and is available
      const { data: license, error: licenseError } = await this.supabase
        .from('licenses')
        .select('*')
        .eq('license_key', licenseKey)
        .maybeSingle();

      if (licenseError) {
        console.error('[License] Error fetching license:', licenseError);
        return { success: false, message: `Database error: ${licenseError.message}` };
      }

      if (!license) {
        // The license key doesn't exist in Supabase, but we'll try to add it locally for offline usage
        console.log('[License] License key not found in Supabase, adding locally for offline use');
        
        try {
          await db.run(
            'INSERT OR REPLACE INTO license_info (hardware_id, license_key, is_active, activated_at) VALUES (?, ?, 1, ?)', 
            [hardwareId, licenseKey, new Date().toISOString()]
          );
          
          console.log('[License] Local license activated for offline use');
          return { 
            success: true, 
            message: 'License activated successfully for offline use! Your device is now authorized.',
            license: { 
              id: null,
              license_key: licenseKey,
              hardware_id: hardwareId,
              vendor_id: null,
              is_active: true,
              max_online_users: null,
              activated_at: new Date().toISOString(),
              created_at: new Date().toISOString()
            }
          };
        } catch (localErr: any) {
          console.error('[License] Error storing local license:', localErr);
          return { success: false, message: 'License not found and failed to store locally.' };
        }
      }

      if (license.hardware_id !== null) {
        return { 
          success: false, 
          message: 'This license key is already activated on another device. Contact vendor for additional licenses.' 
        };
      }

      // Activate the license by binding hardware_id
      const { data: updatedLicense, error: updateError } = await this.supabase
        .from('licenses')
        .update({ 
          hardware_id: hardwareId, 
          is_active: true,
          activated_at: new Date().toISOString()
        })
        .eq('license_key', licenseKey)
        .select()
        .single();

      if (updateError) {
        console.error('[License] Error activating license:', updateError);
        return { success: false, message: `Activation failed: ${updateError.message}` };
      }

      // Store the activation in local database as well for offline access
      await db.run(
        'INSERT OR REPLACE INTO license_info (hardware_id, license_key, is_active, max_online_users, activated_at, created_at) VALUES (?, ?, 1, ?, ?, ?)', 
        [hardwareId, updatedLicense.license_key, this.normalizeMaxOnlineUsers(updatedLicense.max_online_users), updatedLicense.activated_at, updatedLicense.created_at]
      );

      console.log('[License] Device activated successfully');
      return { 
        success: true, 
        message: 'License activated successfully! Your device is now authorized.',
        license: updatedLicense 
      };

    } catch (error: any) {
      console.error('[License] Activation error:', error);
      return { 
        success: false, 
        message: error.message || 'An unexpected error occurred during activation.' 
      };
    }
  }

  /**
   * Verify if the current device has a valid license
   * @returns License verification status
   */
  async verifyLicense(): Promise<LicenseVerification> {
    if (!this.supabase) {
      // If Supabase isn't configured, try local database
      try {
        const hardwareId = await getUniqueHardwareId();
        
        const localLicense = await db.get('SELECT * FROM license_info WHERE hardware_id = ? AND is_active = 1', [hardwareId]);
        
        if (localLicense) {
          console.log('[License] Valid local license found');
          return { 
            isValid: true, 
            isActivated: true,
            maxOnlineUsers: this.normalizeMaxOnlineUsers(localLicense.max_online_users),
            expiresAt: localLicense.activated_at ? new Date(localLicense.activated_at) : undefined
          };
        } else {
          console.warn('[License] No local license found');
          return { 
            isValid: false, 
            isActivated: false, 
            error: 'No active license found for this device' 
          };
        }
      } catch (localError: any) {
        console.error('[License] Local verification error:', localError);
        return { 
          isValid: false, 
          isActivated: false, 
          error: localError.message 
        };
      }
    }

    try {
      const hardwareId = await getUniqueHardwareId();
      
      const { data: license, error } = await this.supabase
        .from('licenses')
        .select('*')
        .eq('hardware_id', hardwareId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('[License] Remote verification error:', error);
        
        // If remote verification fails, try local database as fallback
        try {
          const localLicense = await db.get('SELECT * FROM license_info WHERE hardware_id = ? AND is_active = 1', [hardwareId]);
          
          if (localLicense) {
            console.log('[License] Fallback: Valid local license found');
            return { 
              isValid: true, 
              isActivated: true,
              maxOnlineUsers: this.normalizeMaxOnlineUsers(localLicense.max_online_users),
              expiresAt: localLicense.activated_at ? new Date(localLicense.activated_at) : undefined
            };
          }
        } catch (fallbackError: any) {
          console.error('[License] Fallback verification also failed:', fallbackError);
        }
        
        return { 
          isValid: false, 
          isActivated: false, 
          error: error.message 
        };
      }

      if (!license) {
        // If no license found remotely, try local database
        try {
          const localLicense = await db.get('SELECT * FROM license_info WHERE hardware_id = ? AND is_active = 1', [hardwareId]);
          
          if (localLicense) {
            console.log('[License] Fallback: Valid local license found');
            return { 
              isValid: true, 
              isActivated: true,
              maxOnlineUsers: this.normalizeMaxOnlineUsers(localLicense.max_online_users),
              expiresAt: localLicense.activated_at ? new Date(localLicense.activated_at) : undefined
            };
          }
        } catch (fallbackError: any) {
          console.error('[License] Local fallback check failed:', fallbackError);
        }
        
        return { 
          isValid: false, 
          isActivated: false, 
          error: 'No active license found for this device' 
        };
      }

      // License is valid and activated
      return { 
        isValid: true, 
        isActivated: true,
        maxOnlineUsers: this.normalizeMaxOnlineUsers(license.max_online_users),
        expiresAt: license.activated_at ? new Date(license.activated_at) : undefined
      };

    } catch (error: any) {
      console.error('[License] Verification error:', error);
      
      // Try local database as ultimate fallback
      try {
        const hardwareId = await getUniqueHardwareId();
        const localLicense = await db.get('SELECT * FROM license_info WHERE hardware_id = ? AND is_active = 1', [hardwareId]);
        
        if (localLicense) {
          console.log('[License] Ultimate fallback: Valid local license found');
          return { 
            isValid: true, 
            isActivated: true,
            maxOnlineUsers: this.normalizeMaxOnlineUsers(localLicense.max_online_users),
            expiresAt: localLicense.activated_at ? new Date(localLicense.activated_at) : undefined
          };
        }
      } catch (ultimateFallbackError: any) {
        console.error('[License] Ultimate fallback also failed:', ultimateFallbackError);
      }
      
      return { 
        isValid: false, 
        isActivated: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get the hardware ID of the current device
   */
  async getDeviceHardwareId(): Promise<string> {
    return await getUniqueHardwareId();
  }

  /**
   * Check if Supabase is configured
   */
  isConfigured(): boolean {
    return this.supabase !== null;
  }
}

// Singleton instance
let licenseManager: LicenseManager | null = null;

export function initializeLicenseManager(supabaseUrl?: string, supabaseKey?: string): LicenseManager {
  if (!licenseManager) {
    licenseManager = new LicenseManager(supabaseUrl, supabaseKey);
  }
  return licenseManager;
}

export function getLicenseManager(): LicenseManager {
  if (!licenseManager) {
    licenseManager = new LicenseManager();
  }
  return licenseManager;
}
