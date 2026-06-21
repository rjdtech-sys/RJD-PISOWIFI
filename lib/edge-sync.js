/**
 * Edge Sync Module
 * 
 * Handles syncing local Orange Pi data to Supabase cloud.
 * This runs on the edge device and pushes sales/status to cloud database.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const { getUniqueHardwareId } = require('./hardware');
const db = require('./db');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SALES_SYNC_ENABLED = true;

// Status sync interval (120 seconds - reduced from 60s for egress optimization)
const STATUS_SYNC_INTERVAL = 120000;

const CLOUD_WIFI_DEVICES_PULL_INTERVAL = 300000; // 300s (5 min) - reduced frequency for egress optimization

// Retry queue for failed syncs
const RETRY_QUEUE_PATH = path.join(__dirname, '../data/sync-queue.json');

class EdgeSync {
  constructor() {
    this.supabase = null;
    this.statusSyncInterval = null;
    this.cloudDevicePullInterval = null;
    this.queue = [];
    this.cloudDeviceSyncInFlight = false;
    this.cloudDeviceSyncFailCount = 0;
    this.cloudDeviceSyncBackoffUntil = 0;
    this.lastWifiDeviceSyncTime = null;
    this.lastClientSyncState = new Map(); // Track last synced state to reduce egress
    
    // Machine Identity
    this.hardwareId = null;
    this.machineId = null;
    this.vendorId = null;
    this.centralizedKey = null;
    this.syncEnabled = false; // Default to false to prevent unwanted sync before config load
    this.isInitialized = false;

    this.loadQueue();
    
    // Bind methods to preserve 'this' context when destructured
    this.recordSale = this.recordSale.bind(this);
    this.syncSaleToCloud = this.recordSale.bind(this); // Alias for compatibility
    this.getSyncStats = this.getSyncStats.bind(this);
    this.getIdentity = this.getIdentity.bind(this);
    
    this.init();
  }

  async getPreferredLocalInterfaceForDevices() {
    try {
      if (this._preferredDeviceIface && this._preferredDeviceIfaceTs && (Date.now() - this._preferredDeviceIfaceTs) < 60000) {
        return this._preferredDeviceIface;
      }

      const hotspot = await db.get('SELECT interface FROM hotspots WHERE enabled = 1 LIMIT 1');
      if (hotspot && hotspot.interface) {
        this._preferredDeviceIface = hotspot.interface;
        this._preferredDeviceIfaceTs = Date.now();
        return hotspot.interface;
      }

      const bridge = await db.get('SELECT members FROM bridges LIMIT 1');
      if (bridge && bridge.members) {
        try {
          const members = JSON.parse(bridge.members);
          if (Array.isArray(members) && members.length > 0 && typeof members[0] === 'string' && members[0].trim()) {
            this._preferredDeviceIface = members[0].trim();
            this._preferredDeviceIfaceTs = Date.now();
            return this._preferredDeviceIface;
          }
        } catch (e) {}
      }

      this._preferredDeviceIface = 'wlan0';
      this._preferredDeviceIfaceTs = Date.now();
      return this._preferredDeviceIface;
    } catch (e) {
      return 'wlan0';
    }
  }

  async syncCloudWifiDevicesToLocal() {
    if (!this.supabase || !this.vendorId) return;
    if (!this.syncEnabled) return;
    if (this.cloudDeviceSyncInFlight) return;
    if (this.cloudDeviceSyncBackoffUntil && Date.now() < this.cloudDeviceSyncBackoffUntil) return;

    this.cloudDeviceSyncInFlight = true;
    try {
      const syncFrom = this.lastWifiDeviceSyncTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: devices, error } = await this.supabase
        .from('wifi_devices')
        .select('mac_address, device_name, ip_address, signal_strength, connected_ssid, is_connected, last_heartbeat, updated_at')
        .eq('vendor_id', this.vendorId)
        .gt('updated_at', syncFrom)
        .order('updated_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      if (!Array.isArray(devices) || devices.length === 0) return;

      const defaultIface = await this.getPreferredLocalInterfaceForDevices();

      await db.run('BEGIN');
      for (const d of devices) {
        const mac = typeof d.mac_address === 'string' ? d.mac_address.toUpperCase() : '';
        if (!mac) continue;

        const cloudIp = typeof d.ip_address === 'string' && d.ip_address.trim() ? d.ip_address.trim() : null;
        const cloudName = typeof d.device_name === 'string' && d.device_name.trim() ? d.device_name.trim() : null;
        const cloudSsid = typeof d.connected_ssid === 'string' && d.connected_ssid.trim() ? d.connected_ssid.trim() : null;
        const cloudSignal = Number.isFinite(Number(d.signal_strength)) ? Math.floor(Number(d.signal_strength)) : null;
        const cloudActive = d.is_connected === true ? 1 : 0;

        let lastSeen = Date.now();
        const ts = d.last_heartbeat || d.updated_at;
        if (ts) {
          const parsed = new Date(ts).getTime();
          if (Number.isFinite(parsed) && parsed > 0) lastSeen = parsed;
        }

        const existing = await db.get('SELECT id, custom_name, hostname, ip, interface, connected_at FROM wifi_devices WHERE mac = ? LIMIT 1', [mac]);
        if (existing && existing.id) {
          const hostnameShouldUpdate = !existing.custom_name && (!existing.hostname || existing.hostname === 'Unknown');
          const newHostname = hostnameShouldUpdate ? cloudName : null;

          await db.run(
            `UPDATE wifi_devices
             SET ip = COALESCE(?, ip),
                 hostname = COALESCE(?, hostname),
                 ssid = COALESCE(?, ssid),
                 signal = COALESCE(?, signal),
                 last_seen = ?,
                 is_active = ?,
                 interface = COALESCE(NULLIF(interface, ''), ?)
             WHERE id = ?`,
            [cloudIp, newHostname, cloudSsid, cloudSignal, lastSeen, cloudActive, defaultIface, existing.id]
          );
        } else {
          const id = `cloud_${mac.replace(/[^A-F0-9]/g, '')}`;
          await db.run(
            `INSERT INTO wifi_devices
              (id, mac, ip, hostname, interface, ssid, signal, connected_at, last_seen, is_active)
             VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              mac,
              cloudIp || '0.0.0.0',
              cloudName || 'Unknown',
              defaultIface,
              cloudSsid || null,
              cloudSignal || 0,
              lastSeen,
              lastSeen,
              cloudActive
            ]
          );
        }
      }
      await db.run('COMMIT');

      this.lastWifiDeviceSyncTime = new Date().toISOString();
      this.cloudDeviceSyncFailCount = 0;
      this.cloudDeviceSyncBackoffUntil = 0;
    } catch (e) {
      try { await db.run('ROLLBACK'); } catch (rollbackErr) {}
      this.cloudDeviceSyncFailCount = (this.cloudDeviceSyncFailCount || 0) + 1;
      const backoffMs = Math.min(5 * 60 * 1000, Math.pow(2, Math.min(10, this.cloudDeviceSyncFailCount)) * 1000);
      this.cloudDeviceSyncBackoffUntil = Date.now() + backoffMs;
      console.error('[EdgeSync] Error syncing cloud wifi_devices to local:', e && e.message ? e.message : e);
    } finally {
      this.cloudDeviceSyncInFlight = false;
    }
  }

  /**
   * Helper to get hostname from dnsmasq/dhcp leases
   */
  getHostnameFromLeases(mac) {
    try {
      const leaseFiles = ['/tmp/dhcp.leases', '/var/lib/dnsmasq/dnsmasq.leases', '/var/lib/dhcp/dhcpd.leases', '/var/lib/misc/dnsmasq.leases'];
      for (const leaseFile of leaseFiles) {
        if (fs.existsSync(leaseFile)) {
          const leaseContent = fs.readFileSync(leaseFile, 'utf8');
          const lines = leaseContent.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(mac.toLowerCase())) {
              const parts = line.split(/\s+/);
              if (parts.length >= 4) {
                const hostname = parts[3];
                // Ignore placeholder hostname '*'
                if (hostname && hostname !== '*') {
                    return hostname;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return null;
  }

  /**
   * Initialize Supabase client and Machine Identity
   */
  async init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('[EdgeSync] Supabase credentials not configured. Cloud sync disabled.');
      return;
    }

    try {
      await this.loadLocalIdentity();
      await this.loadCentralizedKey();
    } catch (e) {}

    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[EdgeSync] Connected to Supabase');

    try {
      this.hardwareId = await getUniqueHardwareId();
      console.log(`[EdgeSync] Hardware ID: ${this.hardwareId}`);
      
      await this.registerOrFetchMachine();
      this.isInitialized = true;
      
      // Start sync if not already started
      if (!this.statusSyncInterval) {
        this.startStatusSync();
      }
    } catch (err) {
      console.error('[EdgeSync] Failed to initialize machine identity:', err);
    }
  }

  /**
   * Register machine or fetch existing identity
   */
  async registerOrFetchMachine() {
    if (!this.supabase || !this.hardwareId) return;

    try {
      // Check if machine exists
      const { data, error } = await this.supabase
        .from('vendors')
        .select('id, hardware_id, vendor_id') // Include vendor_id
        .eq('hardware_id', this.hardwareId)
        .maybeSingle(); 
      
      if (error) {
        console.error('[EdgeSync] Supabase select error:', error);
        throw error;
      }

      if (data) {
        // Machine exists
        this.machineId = data.id;
        console.log(`[EdgeSync] Machine identified: ${this.machineId}`);
        
        if (data.vendor_id) {
          this.vendorId = data.vendor_id;
          this.saveLocalVendorId(data.vendor_id);
        }
        
      } else {
        // Register new machine (Pending Activation)
        const newMachinePayload = {
            hardware_id: this.hardwareId,
            machine_name: `New Machine (${this.hardwareId.substring(0, 8)})`,
            vendor_id: null, // NULL for pending activation
            status: 'offline' // Start as offline until vendor claims it
        };
        console.log('[EdgeSync] Registering new machine with payload:', JSON.stringify(newMachinePayload, null, 2));

        const { data: newData, error: insertError } = await this.supabase
          .from('vendors')
          .insert(newMachinePayload)
          .select()
          .single();

        if (insertError) {
          console.error('[EdgeSync] Supabase insert error:', insertError);
          throw insertError;
        }

        if (newData) {
          this.machineId = newData.id;
          console.log(`[EdgeSync] New machine registered: ${this.machineId}`);
        }
      }
    } catch (err) {
      console.error('[EdgeSync] Error registering/fetching machine:', err.message);
    }
  }

  /**
   * Start periodic status sync
   */
  startStatusSync() {
    if (!this.supabase) {
      // Retry init if not ready
      if (!this.isInitialized) {
        this.init();
        return;
      }
      console.warn('[EdgeSync] Cannot start status sync - Supabase not initialized');
      return;
    }

    // Send initial online status
    this.syncMachineStatus('online');
    this.syncClientsToCloud();
    this.syncRoamingSessions();
    this.syncCloudWifiDevicesToLocal();

    // Start periodic heartbeat
    this.statusSyncInterval = setInterval(() => {
      this.syncMachineStatus('online');
      this.syncClientsToCloud();
      this.syncRoamingSessions(); // Pull updates from cloud
    }, STATUS_SYNC_INTERVAL);
    if (this.statusSyncInterval.unref) this.statusSyncInterval.unref();

    console.log('[EdgeSync] Status sync started (every 120s)');

    this.syncCloudWifiDevicesToLocal();
    if (!this.cloudDevicePullInterval) {
      this.cloudDevicePullInterval = setInterval(() => {
        this.syncCloudWifiDevicesToLocal();
      }, CLOUD_WIFI_DEVICES_PULL_INTERVAL);
      if (this.cloudDevicePullInterval.unref) this.cloudDevicePullInterval.unref();
    }
    
    // Subscribe to Realtime updates for seamless roaming
    this.subscribeToRoaming();
    
    // Subscribe to remote commands (System Updates, Reboot, etc.)
    this.subscribeToCommands();
    
    // Check for any pending commands that were missed while offline
    this.checkPendingCommands();
  }

  /**
   * Stop status sync
   */
  stopStatusSync() {
    if (this.statusSyncInterval) {
      clearInterval(this.statusSyncInterval);
      this.statusSyncInterval = null;
      console.log('[EdgeSync] Status sync stopped');
    }
    if (this.cloudDevicePullInterval) {
      clearInterval(this.cloudDevicePullInterval);
      this.cloudDevicePullInterval = null;
    }
  }

  /**
   * Get System Metrics
   */
  async getMetrics() {
    let cpuTemp = 0;
    try {
        // Try reading standard thermal zone
        if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
            const tempStr = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
            cpuTemp = parseInt(tempStr) / 1000;
        }
    } catch (e) { /* ignore */ }

    const uptime = Math.floor(os.uptime());
    
    let activeSessions = 0;
    try {
        const row = await db.get('SELECT count(*) as count FROM sessions WHERE remaining_seconds > 0');
        activeSessions = Math.floor(row?.count || 0);
    } catch (e) { /* ignore */ }

    return { cpuTemp, uptime, activeSessions };
  }

  /**
   * Sync machine status to cloud
   */
  async syncMachineStatus(status) {
    if (!this.supabase || !this.machineId) {
        // If machine ID missing, try to fetch it again (maybe it was just registered)
        if (this.isInitialized && !this.machineId) {
            await this.registerOrFetchMachine();
        }
        if (!this.machineId) return false;
    }

    try {
      const metrics = await this.getMetrics();
      const licenseInfo = await db.get('SELECT trial_started_at, trial_expires_at FROM license_info WHERE hardware_id = ? LIMIT 1', [this.hardwareId]).catch(() => null);
      
      const updatePayload = {
        status, 
        last_seen: new Date().toISOString(),
        cpu_temp: metrics.cpuTemp, 
        uptime_seconds: metrics.uptime, 
        active_sessions_count: metrics.activeSessions,
        trial_started_at: licenseInfo?.trial_started_at || null,
        trial_expires_at: licenseInfo?.trial_expires_at || null,
        trial_active: Boolean(licenseInfo?.trial_expires_at && new Date(licenseInfo.trial_expires_at).getTime() > Date.now())
      };

      const { error } = await this.supabase
        .from('vendors')
        .update(updatePayload)
        .eq('id', this.machineId);

      if (error) {
        const message = String(error.message || '');
        if (message.includes('column') || message.includes('schema cache')) {
          const fallbackPayload = {
            status,
            last_seen: new Date().toISOString()
          };
          const { error: fallbackError } = await this.supabase
            .from('vendors')
            .update(fallbackPayload)
            .eq('id', this.machineId);
          if (fallbackError) throw fallbackError;
        } else {
          throw error;
        }
      }
      
      // Check if vendor_id has been assigned now (in case machine was claimed by vendor)
      // and if so, try to process queued sales
      try {
        const { data: vendorData } = await this.supabase
          .from('vendors')
          .select('vendor_id')
          .eq('id', this.machineId)
          .single();
          
        if (vendorData && vendorData.vendor_id) {
          if (this.vendorId !== vendorData.vendor_id) {
            console.log(`[EdgeSync] Machine claimed by vendor: ${vendorData.vendor_id}`);
            this.vendorId = vendorData.vendor_id;
            this.saveLocalVendorId(vendorData.vendor_id);
            // DO NOT immediately process queue to prevent race conditions with self-healing logic
            // The next regular sync or sale attempt will handle it
          }
        } else if (this.vendorId) {
            // Vendor ID was removed remotely (unlinked), update local state
            console.log('[EdgeSync] Machine unlinked remotely. Clearing local vendor ID.');
            this.vendorId = null;
            this.saveLocalVendorId(null);
        }
      } catch (e) {
        // Ignore error when checking for vendor assignment
      }
      
      // Also process queue if we are online
      if (status === 'online') {
        this.processQueue();
      }
      
      return true;
    } catch (err) {
      console.error('[EdgeSync] Error syncing status:', err.message);
      return false;
    }
  }

  /**
   * Record a sale to cloud
   */
  async recordSale(saleData) {
    if (!SALES_SYNC_ENABLED) {
      return false;
    }
    if (!this.supabase || !this.machineId) {
      // Queue sale if offline or not linked
      this.queueSync('sale', saleData);
      return false;
    }

    try {
      let vendorId = this.vendorId;

      // If we don't have vendorId yet, try to fetch it
      if (!vendorId) {
        const { data: vendorData, error: vendorError } = await this.supabase
          .from('vendors')
          .select('vendor_id')
          .eq('id', this.machineId)
          .single();

        if (vendorError) {
          console.error('[EdgeSync] Error fetching vendor_id:', vendorError.message);
          this.queueSync('sale', saleData);
          return false;
        }

        if (vendorData && vendorData.vendor_id) {
          vendorId = vendorData.vendor_id;
          this.vendorId = vendorId;
          this.saveLocalVendorId(vendorId);
        }
      }

      if (!vendorId) {
        console.warn('[EdgeSync] Cannot record sale - machine not claimed by vendor yet (vendor_id is null)');
        // Queue sale to try again later when vendor_id becomes available
        this.queueSync('sale', saleData);
        return false;
      }

      // Ensure vendor exists in realtime table to prevent FK errors in triggers
      /* 
      // DISABLED: Checking realtime table explicitly causes more noise if it's broken.
      // We will handle the FK error in the sales insert catch block instead.
      try {
        const { data: vendorRealtime } = await this.supabase
          .from('vendor_dashboard_realtime')
          .select('vendor_id')
          .eq('vendor_id', vendorId)
          .maybeSingle();

        if (!vendorRealtime) {
          // ...
        }
      } catch (e) {
        console.warn('[EdgeSync] Realtime table check failed:', e.message);
      }
      */

      // 1. Record sale in sales_logs table
      const { error } = await this.supabase
        .from('sales_logs')
        .insert({
          vendor_id: vendorId,
          machine_id: this.machineId,
          amount: saleData.amount,
          transaction_type: saleData.transaction_type || 'coin_insert',
          created_at: new Date().toISOString(),
          session_duration: saleData.session_duration || null,
          customer_mac: saleData.customer_mac || null,
          notes: typeof saleData.metadata === 'object' ? JSON.stringify(saleData.metadata) : saleData.metadata || null
        });

      if (error) {
          // If error is FK constraint on vendor_dashboard_realtime, it means the vendor exists 
          // but the realtime dashboard entry is missing. We should try to create it.
          if (error.message.includes('vendor_dashboard_realtime_vendor_id_fkey')) {
             // Avoid infinite loop if self-healing fails
             if (saleData._healAttempted) {
                 console.warn(`[EdgeSync] Self-healing already attempted for vendor ${vendorId} but failed. Queueing.`);
                 this.queueSync('sale', saleData);
                 return false;
             }

             console.warn(`[EdgeSync] Missing realtime dashboard entry for vendor ${vendorId}. Attempting to create it...`);
             
             try {
                 // Try to insert the missing realtime entry using MACHINE ID (as required by FK)
                 // The table name is confusing, but the FK points to vendors(id), which is the Machine ID.
                 const { error: insertError } = await this.supabase
                    .from('vendor_dashboard_realtime')
                    .insert({ 
                        vendor_id: this.machineId, 
                        total_sales: 0,
                        order_count: 0,
                        last_updated: new Date().toISOString()
                    });
                    
                 if (!insertError) {
                     console.log('[EdgeSync] Successfully created missing realtime dashboard entry.');
                 } else if (insertError.code === '23505') { // Duplicate key error code
                     console.log('[EdgeSync] Realtime dashboard entry already exists (Duplicate Key). Proceeding to retry.');
                 } else {
                     console.error('[EdgeSync] Failed to create realtime entry:', insertError.message);
                 }

                 // Retry the sale insert immediately with flag
                 // Even if create failed (e.g. duplicate), we retry because the entry might exist now.
                 const retryData = { ...saleData, _healAttempted: true };
                 const success = await this.recordSale(retryData);
                 
                 if (!success) {
                     console.error('[EdgeSync] CRITICAL: Retry failed even after ensuring dashboard entry exists.');
                     console.error('[EdgeSync] This indicates a Server-Side Trigger Bug. The database trigger is likely trying to insert/update using the wrong ID (User ID instead of Machine ID).');
                     console.error('[EdgeSync] Please run the provided fix_realtime_trigger.sql in your Supabase SQL Editor.');
                 }
                 
                 return success;

             } catch (healErr) {
                 console.error('[EdgeSync] Exception during self-healing:', healErr.message);
             }
             
             // If we failed to heal (or retry failed), queue it for later
              if (!saleData._healAttempted) {
                  this.queueSync('sale', saleData);
              }
              return false; 
          } else {
              throw error;
          }
      }

      // 2. Update total_revenue in vendors table
      // (Disabled as total_revenue column is not visible in screenshot)
      /*
      // Fetch current revenue first to ensure accuracy
      const { data: machine, error: fetchError } = await this.supabase
        .from('vendors')
        .select('total_revenue')
        .eq('id', this.machineId)
        .single();

      if (!fetchError && machine) {
        const currentRevenue = parseFloat(machine.total_revenue) || 0;
        const newRevenue = currentRevenue + parseFloat(saleData.amount);
        
        await this.supabase
          .from('vendors')
          .update({ total_revenue: newRevenue })
          .eq('id', this.machineId);
      }
      */

      return true;
    } catch (err) {
      console.error('[EdgeSync] Error recording sale:', err.message);
      this.queueSync('sale', saleData);
      return false;
    }
  }

  /**
   * Queue sync item for later
   */
  queueSync(type, data) {
    if (type === 'sale' && !SALES_SYNC_ENABLED) {
      return;
    }
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      type,
      data,
      timestamp: new Date().toISOString(),
      retries: 0
    };
    
    this.queue.push(item);
    this.saveQueue();
    if (type !== 'sale') {
      console.log(`[EdgeSync] Queued ${type} (Queue size: ${this.queue.length})`);
    }
  }

  /**
   * Process retry queue
   */
  async processQueue() {
    if (!SALES_SYNC_ENABLED) {
      return;
    }
    if (this.queue.length === 0) return;

    const itemsToProcess = [...this.queue]; // Copy array
    this.queue = []; // Clear queue temporarily (items will be re-added if they fail)
    
    for (const item of itemsToProcess) {
      let success = false;
      
      try {
        if (item.type === 'sale') {
            success = await this.recordSale(item.data);
        }
      } catch (e) { /* ignore */ }
      
      if (!success) {
        item.retries++;
        if (item.retries < 50) { // Max 50 retries
            this.queue.push(item);
        }
      }
    }
    
    this.saveQueue();
  }

  loadQueue() {
    try {
      if (fs.existsSync(RETRY_QUEUE_PATH)) {
        const data = fs.readFileSync(RETRY_QUEUE_PATH, 'utf-8');
        this.queue = JSON.parse(data);
      }
    } catch (e) {
      this.queue = [];
    }
  }

  saveQueue() {
    try {
      const dir = path.dirname(RETRY_QUEUE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(RETRY_QUEUE_PATH, JSON.stringify(this.queue));
    } catch (e) {
      console.error('[EdgeSync] Failed to save queue:', e);
    }
  }

  async loadLocalIdentity() {
    try {
        const row = await db.get('SELECT value FROM config WHERE key = ?', ['cloud_vendor_id']);
        if (row && row.value) {
            this.vendorId = row.value;
            console.log(`[EdgeSync] Loaded local vendor ID: ${this.vendorId}`);
        }
    } catch (e) { /* ignore */ }
  }

  async loadCentralizedKey() {
    try {
        const row = await db.get('SELECT value FROM config WHERE key = ?', ['centralizedKey']);
        const syncEnabledRow = await db.get('SELECT value FROM config WHERE key = ?', ['centralizedSyncEnabled']);
        
        if (row && row.value) {
            this.centralizedKey = row.value;
            console.log(`[EdgeSync] Loaded centralized key: ${this.centralizedKey}`);
        }
        
        // Default to enabled (true) if not set or '1'
        this.syncEnabled = syncEnabledRow ? syncEnabledRow.value !== '0' : true;
        console.log(`[EdgeSync] Sync enabled: ${this.syncEnabled}`);
        
    } catch (e) { /* ignore */ }
  }

  async checkCentralizedKey(key) {
      this.centralizedKey = key;
      await this.syncClientsToCloud();
  }

  async forceSyncClient(payload) {
      if (!this.supabase || !this.syncEnabled) return; // Respect sync toggle
      try {
          // 1. Try to nuke any OTHER row holding this token (stale session owner)
          // IMPORTANT: Remove machine_id check to clear conflicts from ANY machine if using centralized key
          const { error: delError } = await this.supabase
              .from('wifi_devices')
              .delete()
              .eq('session_token', payload.session_token)
              .neq('mac_address', payload.mac_address);
              // .eq('machine_id', this.machineId); // DISABLED: Allow clearing token from previous machine

          if (delError) {
             console.error(`[EdgeSync] Force sync delete failed:`, delError.message);
          }

          // 2. Upsert our payload
          // We use mac_address key because we want to update THIS device
          const { error } = await this.supabase
              .from('wifi_devices')
              .upsert(payload, { onConflict: 'mac_address, machine_id' });
              
          if (error) {
             // 3. Last Resort: If duplicate key still exists, it means the (mac, machine) tuple is fine, 
             // but the session_token is conflicting with ITSELF or another record that wasn't caught.
             // Usually this means 'mac_address' + 'machine_id' exists but with a DIFFERENT session_token,
             // and we are trying to update it to a session_token that is already taken by SOMEONE ELSE.
             
             if (error.code === '23505' || error.message.includes('unique constraint')) {
                 // Nuke the target row completely and re-insert
                 await this.supabase
                    .from('wifi_devices')
                    .delete()
                    .eq('mac_address', payload.mac_address)
                    .eq('machine_id', this.machineId);
                    
                 const { error: finalError } = await this.supabase
                    .from('wifi_devices')
                    .insert(payload);
                    
                 if (finalError) console.error(`[EdgeSync] Final force sync failed for ${payload.mac_address}:`, finalError.message);
             } else {
                 console.error(`[EdgeSync] Force sync failed for ${payload.mac_address}:`, error.message);
             }
          }
      } catch (e) {
          console.error(`[EdgeSync] Force sync exception for ${payload.mac_address}:`, e.message);
      }
  }

  async syncClientsToCloud() {
      if (!this.supabase || !this.machineId || !this.vendorId) return;
      
      if (!this.centralizedKey) {
          // console.log('[EdgeSync] Skipping client sync: No Centralized Key configured.');
          return;
      }

      if (!this.syncEnabled) {
          // console.log('[EdgeSync] Skipping client sync: Sync is disabled.');
          return;
      }

      try {
          // Get active sessions from local DB, plus recently updated inactive sessions (to sync 0 time)
          // Also join with wifi_devices to get hostname/custom_name
          const sessions = await db.all(`
            SELECT 
              s.mac, s.ip, s.token, s.remaining_seconds, s.total_paid, s.connected_at, s.updated_at,
              wd.hostname, wd.custom_name
            FROM sessions s
            LEFT JOIN wifi_devices wd ON s.mac = wd.mac
            WHERE s.remaining_seconds > 0 OR s.updated_at > datetime('now', '-5 minutes')
          `);

          if (!sessions || sessions.length === 0) return;

          // Prepare payload for Supabase wifi_devices table
          // Use a Map to deduplicate by session_token to prevent "ON CONFLICT DO UPDATE command cannot affect row a second time" error
          const updatesMap = new Map();
          
          for (const session of sessions) {
              // Ensure we have a unique session token for this device on this machine
              const sessionToken = session.token || `fallback-${this.machineId}-${session.mac}`;
              
              // Skip if we already have an entry for this session token (keep the first one)
              if (updatesMap.has(sessionToken)) {
                  continue;
              }
              
              // Get hostname from DB or leases
              // Prioritize: custom_name > leaseHostname > stored hostname > Unknown
              const leaseHostname = this.getHostnameFromLeases(session.mac);
              const finalHostname = session.custom_name || leaseHostname || session.hostname || 'Unknown';

              updatesMap.set(sessionToken, {
                  mac_address: session.mac,
                  session_token: sessionToken,
                  machine_id: this.machineId,
                  vendor_id: this.vendorId,
                  ip_address: session.ip,
                  device_name: finalHostname,
                  last_heartbeat: new Date().toISOString(),
                  is_connected: session.remaining_seconds > 0,
                  total_paid: session.total_paid || 0,
                  remaining_seconds: session.remaining_seconds,
                  updated_at: new Date().toISOString()
              });
          }
          
          const updates = Array.from(updatesMap.values());

          // Filter: only sync if state has meaningfully changed since last sync
          const nowMs = Date.now();
          const filteredUpdates = updates.filter(update => {
              const key = update.mac_address;
              const last = this.lastClientSyncState.get(key);
              
              // Always sync if we haven't synced this MAC before
              if (!last) return true;
              
              // Sync if remaining_seconds changed by more than 60
              const remainingChanged = Math.abs((last.remaining_seconds || 0) - (update.remaining_seconds || 0)) > 60;
              
              // Sync if total_paid changed
              const paidChanged = (last.total_paid || 0) !== (update.total_paid || 0);
              
              // Sync if connection state flipped
              const connectedChanged = last.is_connected !== update.is_connected;
              
              // Sync at least every 10 minutes to keep heartbeat alive
              const stale = !last.syncedAt || (nowMs - last.syncedAt) > 10 * 60 * 1000;
              
              return remainingChanged || paidChanged || connectedChanged || stale;
          });
          
          if (filteredUpdates.length === 0) return;

          // Upsert to Supabase
          try {
              // Attempt 1: Try upserting by session_token (preferred unique identifier)
              const { error } = await this.supabase
                  .from('wifi_devices')
                  .upsert(filteredUpdates, { onConflict: 'session_token' }); 

              if (!error) {
                  // Success! Update local timestamps to prevent "old time" restoration loop
                  // We update updated_at to now() so that syncRoamingSessions knows our local data is fresh
                  try {
                      const nowIso = new Date().toISOString();
                      const macs = sessions.map(s => `'${s.mac}'`).join(',');
                      if (macs) {
                          await db.run(`UPDATE sessions SET updated_at = ? WHERE mac IN (${macs})`, [nowIso]);
                      }
                  } catch (updateErr) {
                      console.error('[EdgeSync] Failed to update local timestamps after sync:', updateErr.message);
                  }
                  
                  // Update sync state tracking
                  for (const update of filteredUpdates) {
                      this.lastClientSyncState.set(update.mac_address, {
                          remaining_seconds: update.remaining_seconds,
                          total_paid: update.total_paid,
                          is_connected: update.is_connected,
                          syncedAt: nowMs
                      });
                  }
              }

              if (error) {
                  // Attempt 2: If we hit a duplicate key error (usually "wifi_devices_mac_address_machine_id_key"),
                  // it means we are trying to insert a NEW session_token for a (mac, machine) pair that already exists.
                  // We should fallback to updating based on that composite key.
                  if (error.code === '23505' || error.message.includes('unique constraint')) {
                      // console.warn('[EdgeSync] Conflict on unique key. Retrying with onConflict: mac_address, machine_id');
                      
                      const { error: retryError } = await this.supabase
                          .from('wifi_devices')
                          .upsert(filteredUpdates, { onConflict: 'mac_address, machine_id' }); 
                          
                      if (retryError) {
                          // If we still have conflicts (likely session_token collision due to device swapping),
                          // we need to handle them one by one.
                          if (retryError.code === '23505' || retryError.message.includes('unique constraint')) {
                              // console.warn('[EdgeSync] Batch sync failed due to complex conflicts. Switching to sequential force-sync.');
                              for (const update of filteredUpdates) {
                                  await this.forceSyncClient(update);
                              }
                          } else {
                              console.error('[EdgeSync] Retry sync failed:', retryError.message);
                          }
                      }
                  } else {
                      console.error('[EdgeSync] Failed to sync clients to wifi_devices:', error.message);
                  }
              }
          } catch (upsertErr) {
               console.error('[EdgeSync] Exception during upsert:', upsertErr.message);
          }

      } catch (e) {
          console.error('[EdgeSync] Error in syncClientsToCloud:', e);
      }
  }

  async subscribeToRoaming() {
      if (!this.supabase || !this.vendorId) return;

      if (!this.centralizedKey) {
          // console.log('[EdgeSync] Skipping roaming subscription: No Centralized Key configured.');
          return;
      }
      
      console.log('[EdgeSync] Subscribing to roaming updates...');
      
      this.supabase
        .channel('roaming-sessions')
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'wifi_devices',
            filter: `vendor_id=eq.${this.vendorId}`
        }, payload => {
            this.handleRoamingUpdate(payload.new);
        })
        .subscribe();
  }
  
  async handleRoamingUpdate(remoteDevice) {
      if (!remoteDevice || !remoteDevice.mac_address) return;
      
      // Ignore updates from this machine to prevent loops
      if (remoteDevice.machine_id === this.machineId) return;
      
      try {
          // Check if we have this device locally
          const localSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [remoteDevice.mac_address]);
          
          if (localSession) {
              // We have a local session. If remote has LESS time (consumed elsewhere), update local.
              // Logic: Sync to the lowest remaining time to account for usage on other machines.
              // BUT, user might have topped up on another machine. 
              // Better Logic: Trust the "updated_at" timestamp.
              
              const localUpdated = new Date(localSession.updated_at || 0).getTime(); // Assuming we add updated_at to sessions
              const remoteUpdated = new Date(remoteDevice.updated_at).getTime();
              
              if (remoteUpdated > localUpdated) {
                  console.log(`[EdgeSync] Roaming update for ${remoteDevice.mac_address}: ${remoteDevice.remaining_seconds}s remaining`);
                  
                  await db.run(
                      'UPDATE sessions SET remaining_seconds = ?, total_paid = ?, updated_at = ? WHERE mac = ?',
                      [remoteDevice.remaining_seconds, remoteDevice.total_paid, new Date().toISOString(), remoteDevice.mac_address]
                  );
                  
                  // If expired, ensure we kill it locally
                  if (remoteDevice.remaining_seconds <= 0) {
                      // Logic to kick user is usually handled by other loop, but updating DB is step 1.
                  }
              }
          }
      } catch (e) {
          console.error('[EdgeSync] Error handling roaming update:', e);
      }
  }
  
  async syncRoamingSessions() {
      // Periodically pull latest sessions for our vendor to catch up
      if (!this.supabase || !this.vendorId) return;

      if (!this.centralizedKey) {
          // console.log('[EdgeSync] Skipping roaming sync: No Centralized Key configured.');
          return;
      }
      
      try {
           // Only fetch roaming data for MACs that currently have local sessions
           // This avoids downloading every active device across the vendor's entire fleet
           const localSessions = await db.all(
               "SELECT mac, remaining_seconds, updated_at FROM sessions WHERE remaining_seconds > 0"
           );
           if (!localSessions || localSessions.length === 0) return;
           
           const localMacs = localSessions.map(s => s.mac);
           
           // Batch in groups of 50 to avoid overly long IN clauses
           const BATCH_SIZE = 50;
           for (let i = 0; i < localMacs.length; i += BATCH_SIZE) {
               const batchMacs = localMacs.slice(i, i + BATCH_SIZE);
               const { data: devices, error } = await this.supabase
                   .from('wifi_devices')
                   .select('mac_address, remaining_seconds, total_paid, updated_at')
                   .eq('vendor_id', this.vendorId)
                   .in('mac_address', batchMacs)
                   .gt('remaining_seconds', 0);
                   
               if (error) throw error;
               
               if (devices && devices.length > 0) {
                   for (const dev of devices) {
                       // Check if we have this user locally
                       const local = await db.get('SELECT remaining_seconds, updated_at FROM sessions WHERE mac = ?', [dev.mac_address]);
                       if (local) {
                           // Update local if remote is different (simplified sync)
                           // TRUST remote updated_at
                           const localUpdated = new Date(local.updated_at || 0).getTime();
                           const remoteUpdated = new Date(dev.updated_at).getTime();
                           
                           if (remoteUpdated > localUpdated && Math.abs(local.remaining_seconds - dev.remaining_seconds) > 30) {
                               await db.run(
                                   'UPDATE sessions SET remaining_seconds = ?, updated_at = ? WHERE mac = ?', 
                                   [dev.remaining_seconds, dev.updated_at, dev.mac_address]
                               );
                           }
                       }
                   }
               }
           }
      } catch (e) {
          console.error('[EdgeSync] Error syncing roaming sessions:', e.message);
      }
  }

  async checkRoamingForMac(mac) {
      if (!this.supabase || !this.vendorId || !mac) return null;

      if (!this.centralizedKey) {
          // console.log('[EdgeSync] Skipping checkRoamingForMac: No Centralized Key configured.');
          return null;
      }
      
      try {
          const { data: rows, error } = await this.supabase
            .from('wifi_devices')
            .select('mac_address, remaining_seconds, total_paid, updated_at')
            .eq('vendor_id', this.vendorId)
            .eq('mac_address', mac)
            .gt('remaining_seconds', 0)
            .order('updated_at', { ascending: false })
            .limit(1);
            
          if (error) {
              console.error(`[EdgeSync] checkRoamingForMac Supabase error:`, error.message);
              return null;
          }
          
          const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          if (data && data.remaining_seconds > 0) {
              console.log(`[EdgeSync] Found roaming session for ${mac}: ${data.remaining_seconds}s`);
              
              // Create local session immediately to allow access
              const existing = await db.get('SELECT mac, updated_at FROM sessions WHERE mac = ?', [mac]);
              
              if (existing) {
                  // If local is newer, ignore remote
                  const localUpdated = new Date(existing.updated_at || 0).getTime();
                  const remoteUpdated = new Date(data.updated_at).getTime();
                  
                  if (localUpdated >= remoteUpdated) {
                       console.log(`[EdgeSync] Local session is newer/same for ${mac}, ignoring remote.`);
                       return null;
                  }

                  await db.run(
                      'UPDATE sessions SET remaining_seconds = ?, total_paid = ?, updated_at = ? WHERE mac = ?',
                      [data.remaining_seconds, data.total_paid || 0, new Date().toISOString(), mac]
                  );
              } else {
                   // We need IP, but this function is called before we might know it fully if checking via API
                   // But usually we have it from ARP
                   // Insert with 0.0.0.0 placeholder if needed, but the caller usually has IP context
                   // For now, we just insert. The main loop will update IP later.
                   try {
                       await db.run(
                           'INSERT INTO sessions (mac, remaining_seconds, total_paid, connected_at, updated_at, is_paused) VALUES (?, ?, ?, ?, ?, 0)',
                           [mac, data.remaining_seconds, data.total_paid || 0, new Date().toISOString(), new Date().toISOString()]
                       );
                   } catch (insertErr) {
                       console.error('[EdgeSync] Failed to insert roaming session:', insertErr.message);
                   }
              }
              return data;
          }
      } catch (e) {
          console.error(`[EdgeSync] Failed checkRoamingForMac(${mac}):`, e.message);
      }
      return null;
  }

  async checkRoamingForToken(sessionToken, mac, ipAddress = null) {
      if (!this.supabase || !this.vendorId || !sessionToken) return null;

      if (!this.centralizedKey) {
          return null;
      }

      try {
          const { data: rows, error } = await this.supabase
            .from('wifi_devices')
            .select('mac_address, remaining_seconds, total_paid, updated_at, session_token')
            .eq('vendor_id', this.vendorId)
            .eq('session_token', sessionToken)
            .gt('remaining_seconds', 0)
            .order('updated_at', { ascending: false })
            .limit(1);

          if (error) {
              console.error(`[EdgeSync] checkRoamingForToken Supabase error:`, error.message);
              return null;
          }

          const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          if (!data || !(data.remaining_seconds > 0)) return null;

          const nowIso = new Date().toISOString();
          const finalMac = mac || data.mac_address;
          if (!finalMac) return null;

          if (data.mac_address && mac && data.mac_address !== mac) {
              try {
                  const { data: macRows, error: macErr } = await this.supabase
                    .from('wifi_devices')
                    .select('session_token, remaining_seconds, updated_at')
                    .eq('vendor_id', this.vendorId)
                    .eq('mac_address', mac)
                    .order('updated_at', { ascending: false })
                    .limit(1);

                  if (macErr) throw macErr;

                  const existingMacRow = Array.isArray(macRows) && macRows.length > 0 ? macRows[0] : null;
                  const canRebind = !existingMacRow || existingMacRow.session_token === sessionToken || !(existingMacRow.remaining_seconds > 0);

                  if (canRebind) {
                      const updatePayload = {
                          mac_address: mac,
                          updated_at: nowIso,
                          last_heartbeat: nowIso,
                          is_connected: true
                      };

                      if (typeof ipAddress === 'string' && ipAddress.trim()) {
                          updatePayload.ip_address = ipAddress.trim();
                      }

                      const { error: bindErr } = await this.supabase
                        .from('wifi_devices')
                        .update(updatePayload)
                        .eq('vendor_id', this.vendorId)
                        .eq('session_token', sessionToken);

                      if (bindErr) {
                          console.error(`[EdgeSync] Failed to bind MAC to token:`, bindErr.message);
                      } else {
                          data.mac_address = mac;
                          data.updated_at = nowIso;
                      }
                  }
              } catch (e) {
                  console.error(`[EdgeSync] Failed binding MAC to token:`, e.message);
              }
          }

          const existing = await db.get('SELECT mac, updated_at FROM sessions WHERE mac = ?', [finalMac]);
          if (existing) {
              const localUpdated = new Date(existing.updated_at || 0).getTime();
              const remoteUpdated = new Date(data.updated_at || 0).getTime();

              if (localUpdated >= remoteUpdated) {
                  return null;
              }

              await db.run(
                  'UPDATE sessions SET ip = COALESCE(?, ip), remaining_seconds = ?, total_paid = ?, token = ?, updated_at = ? WHERE mac = ?',
                  [ipAddress, data.remaining_seconds, data.total_paid || 0, sessionToken, nowIso, finalMac]
              );
          } else {
              try {
                  await db.run(
                      'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at, updated_at, token, is_paused) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
                      [finalMac, ipAddress, data.remaining_seconds, data.total_paid || 0, nowIso, nowIso, sessionToken]
                  );
              } catch (insertErr) {
                  console.error('[EdgeSync] Failed to insert roaming session (token):', insertErr.message);
                  return null;
              }
          }

          return { ...data, mac_address: finalMac };
      } catch (e) {
          console.error(`[EdgeSync] Failed checkRoamingForToken(${sessionToken}):`, e.message);
      }
      return null;
  }
  
  // Explicitly sync a single device status to cloud
  async syncDeviceToCloud(mac, remainingSeconds, totalPaid = 0) {
      if (!this.supabase || !this.machineId || !this.vendorId) return;

      if (!this.centralizedKey) {
          // console.log('[EdgeSync] Skipping device sync: No Centralized Key configured.');
          return;
      }
      
      if (!this.syncEnabled) {
          return;
      }
      
      try {
          // Try to find session token or create a fallback
          const session = await db.get('SELECT token, ip FROM sessions WHERE mac = ?', [mac]);
          const sessionToken = session?.token || `fallback-${this.machineId}-${mac}`;
          const ip = session?.ip || '0.0.0.0';
          
          // Get hostname (try leases first)
          const leaseHostname = this.getHostnameFromLeases(mac);
          const hostname = session?.hostname || leaseHostname || 'Unknown';

          const updatePayload = {
              mac_address: mac,
              session_token: sessionToken,
              machine_id: this.machineId,
              vendor_id: this.vendorId,
              ip_address: ip,
              device_name: hostname,
              last_heartbeat: new Date().toISOString(),
              is_connected: remainingSeconds > 0,
              total_paid: totalPaid,
              remaining_seconds: remainingSeconds,
              updated_at: new Date().toISOString()
          };

          const { error } = await this.supabase
              .from('wifi_devices')
              .upsert(updatePayload, { onConflict: 'session_token' });
              
          if (error) {
              // Retry with mac/machine key if token conflict
              if (error.code === '23505' || error.message.includes('unique constraint')) {
                  await this.supabase
                      .from('wifi_devices')
                      .upsert(updatePayload, { onConflict: 'mac_address, machine_id' });
              } else {
                  console.error('[EdgeSync] Failed to sync single device:', error.message);
              }
          } else {
              console.log(`[EdgeSync] Synced device ${mac} to cloud: ${remainingSeconds}s`);
          }
      } catch (e) {
          console.error('[EdgeSync] Error in syncDeviceToCloud:', e);
      }
  }

  async saveLocalVendorId(vendorId) {
    try {
        await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['cloud_vendor_id', vendorId]);
    } catch (e) {
        console.error('[EdgeSync] Failed to save local vendor ID:', e);
    }
  }
  
  getIdentity() {
    return {
        hardwareId: this.hardwareId,
        machineId: this.machineId,
        vendorId: this.vendorId,
        isInitialized: this.isInitialized
    };
  }

  async syncNodeMCUDevice(device) {
      if (!this.supabase || !this.machineId || !this.vendorId) {
          if (!this.isInitialized) return null; // Not ready
          if (!this.supabase || !this.machineId || !this.vendorId) return null;
      }
  
      try {
          // First try to find by mac_address to get the ID
          let { data: existingDevice, error: findError } = await this.supabase
              .from('nodemcu_devices')
              .select('id')
              .eq('mac_address', device.macAddress)
              .maybeSingle();
  
          if (findError) {
               console.error('[NodeMCU Sync] Error finding device:', findError.message);
               return null;
          }
  
          let cloudId = existingDevice?.id;
  
          // Prepare update payload including last_coins_out_* fields
          const updatePayload = {
              status: device.status || 'connected',
              total_pulses: device.totalPulses,
              total_revenue: device.totalRevenue,
              last_seen: new Date().toISOString(),
              machine_id: this.machineId, 
              vendor_id: this.vendorId
          };

          // Add coins out fields if present
          if (device.lastCoinsOutDate) updatePayload.last_coins_out_date = device.lastCoinsOutDate;
          if (device.lastCoinsOutGross !== undefined) updatePayload.last_coins_out_gross = device.lastCoinsOutGross;
          if (device.lastCoinsOutNet !== undefined) updatePayload.last_coins_out_net = device.lastCoinsOutNet;
  
          if (cloudId) {
               // Update existing
               await this.supabase
                  .from('nodemcu_devices')
                  .update(updatePayload)
                  .eq('id', cloudId);
          } else {
               // Insert new
               const insertPayload = {
                   ...updatePayload,
                   mac_address: device.macAddress,
                   name: device.name || `NodeMCU-${device.macAddress.replace(/:/g, '').substring(0, 6)}`,
                   created_at: new Date().toISOString()
               };

               const { data: newDevice, error: insertError } = await this.supabase
                  .from('nodemcu_devices')
                  .insert(insertPayload)
                  .select()
                  .single();
               
               if (insertError) {
                   console.error('[NodeMCU Sync] Error inserting device:', insertError.message);
                   return null;
               }
               cloudId = newDevice.id;
          }
          return cloudId;
      } catch (e) {
          console.error('[NodeMCU Sync] Exception syncing device:', e);
          return null;
      }
  }

  /**
   * Record a "Coins Out" event to history
   */
  async recordNodeMCUCoinsOut(device, gross, net, date) {
      if (!this.supabase || !this.machineId || !this.vendorId) {
           // Not connected, but we'll try to sync if initialized
           if (!this.isInitialized) return false;
      }

      // Ensure device is synced first to get its ID
      const cloudId = await this.syncNodeMCUDevice(device);
      if (!cloudId) return false;

      try {
          // Insert into nodemcu_sales with negative amount (or just as a record)
          // We use slot_id = -1 to indicate "Coins Out"
          // The trigger should be updated to NOT modify revenue for 'coins_out' type
          const { error } = await this.supabase
            .from('nodemcu_sales')
            .insert({
                vendor_id: this.vendorId,
                machine_id: this.machineId,
                device_id: cloudId,
                slot_id: -1, // Convention for Coins Out
                amount: -Math.abs(gross), // Negative to indicate withdrawal in charts if simply summed
                net_amount: net, // New column
                transaction_type: 'coins_out', // New column
                created_at: date || new Date().toISOString()
            });

          if (error) {
              console.error('[NodeMCU Sync] Error recording coins out history:', error.message);
              return false;
          }
          
          console.log(`[NodeMCU Sync] Recorded coins out for ${device.macAddress}: Gross ${gross}, Net ${net}`);
          return true;
      } catch (e) {
          console.error('[NodeMCU Sync] Exception recording coins out:', e);
          return false;
      }
  }

  /**
   * Record a "Coins Out" event for the MAIN MACHINE to history
   */
  async recordMainCoinsOut(gross, net, date) {
      if (!this.supabase || !this.machineId || !this.vendorId) {
           if (!this.isInitialized) return false;
      }

      try {
          // Use sales_logs table for main machine
          // We use transaction_type='coins_out' and negative amount
          
          const { error } = await this.supabase
            .from('sales_logs')
            .insert({
                vendor_id: this.vendorId,
                machine_id: this.machineId,
                amount: -Math.abs(gross), // Negative to indicate withdrawal
                transaction_type: 'coins_out',
                created_at: date || new Date().toISOString(),
                notes: JSON.stringify({ net_amount: net, type: 'manual_reset' })
            });

          if (error) {
              console.error('[EdgeSync] Error recording main coins out history:', error.message);
              return false;
          }
          
          // Also update the main machine total_revenue (resetting it or adjusting it)
          // Ideally, the total_revenue column in vendors table is a running total of LIFETIME revenue.
          // If the user wants to "Reset" the view, it's usually a local view thing.
          // BUT if the user expects the cloud dashboard to show 0, we might need to update a 'current_cycle_revenue' or similar.
          // However, based on the NodeMCU implementation, we are just logging the event.
          // The local display will handle the "reset" look by subtracting the last coins out.
          
          console.log(`[EdgeSync] Recorded main coins out: Gross ${gross}, Net ${net}`);
          return true;
      } catch (e) {
          console.error('[EdgeSync] Exception recording main coins out:', e);
          return false;
      }
  }

  /**
   * Get Sync Stats for Dashboard
   */
  getSyncStats() {
    return {
      configured: !!(this.supabase && this.machineId),
      machineId: this.machineId || 'Not Registered',
      vendorId: this.vendorId || 'Pending Activation',
      statusSyncActive: !!this.statusSyncInterval,
      queuedSyncs: this.queue.length,
      hasCentralizedKey: !!this.centralizedKey,
      syncEnabled: this.syncEnabled !== false // Default true
    };
  }

  /**
    * Subscribe to remote commands from 'machine_commands' table
    */
   async subscribeToCommands() {
     if (!this.supabase || !this.machineId) return;

     console.log('[EdgeSync] Subscribing to remote commands...');

     this.supabase
       .channel('machine-commands')
       .on('postgres_changes', {
           event: 'INSERT',
           schema: 'public',
           table: 'machine_commands',
           filter: `machine_id=eq.${this.machineId}`
       }, payload => {
           console.log('[EdgeSync] Received remote command:', payload.new);
           this.handleRemoteCommand(payload.new);
       })
       .subscribe();
   }

   /**
    * Check for pending commands (missed while offline)
    */
   async checkPendingCommands() {
       if (!this.supabase || !this.machineId) return;

       try {
           const { data, error } = await this.supabase
               .from('machine_commands')
               .select('*')
               .eq('machine_id', this.machineId)
               .eq('status', 'pending')
               .order('created_at', { ascending: true });

           if (error) {
               const message = String(error.message || '');
               if (message.includes('machine_commands') || message.includes('schema cache')) {
                   if (!this._machineCommandsMissingLogged) {
                       console.warn('[EdgeSync] Remote commands disabled: machine_commands table is missing in Supabase.');
                       this._machineCommandsMissingLogged = true;
                   }
                   return;
               }
               console.error('[EdgeSync] Error checking pending commands:', error.message);
               return;
           }

           if (data && data.length > 0) {
               console.log(`[EdgeSync] Found ${data.length} pending commands.`);
               for (const command of data) {
                   await this.handleRemoteCommand(command);
               }
           }
       } catch (err) {
           console.error('[EdgeSync] Exception checking pending commands:', err.message);
       }
   }

   /**
    * Handle incoming remote command
    */
   async handleRemoteCommand(command) {
       if (!command || !command.id) return;

       console.log(`[EdgeSync] Processing command ${command.id}: ${command.command_type || command.command}`);
       
       // Mark as processing
       await this.updateCommandStatus(command.id, 'processing', 'Started processing command...');

       try {
           const type = command.command_type || command.command; // Support both naming conventions
           
           if (type === 'system_update' || type === 'update' || type === 'update_firmware') {
                // Instead of executing immediately, we save it as pending acceptance
                console.log(`[EdgeSync] Update command received. Waiting for user acceptance.`);
                this.savePendingUpdate(command);
                await this.updateCommandStatus(command.id, 'waiting_acceptance', 'Update available. Waiting for user approval.');
           } else if (type === 'reboot') {
                await this.runShellCommand('sudo reboot');
                await this.updateCommandStatus(command.id, 'completed', 'Reboot initiated');
           } else if (type === 'shell') {
                // DANGEROUS: Only enable if strictly required and secured
                // const output = await this.runShellCommand(command.payload?.cmd || command.cmd);
                // await this.updateCommandStatus(command.id, 'completed', output);
                await this.updateCommandStatus(command.id, 'failed', 'Shell command execution not enabled for security');
           } else {
                await this.updateCommandStatus(command.id, 'failed', `Unknown command type: ${type}`);
           }
       } catch (err) {
           console.error(`[EdgeSync] Command ${command.id} failed:`, err);
           await this.updateCommandStatus(command.id, 'failed', err.message);
       }
   }

   /**
    * Save pending update command to local file for UI to detect
    */
   savePendingUpdate(command) {
       const updatePath = path.join(__dirname, '../data/pending_update.json');
       try {
           fs.writeFileSync(updatePath, JSON.stringify(command, null, 2));
           console.log('[EdgeSync] Pending update saved to disk.');
       } catch (err) {
           console.error('[EdgeSync] Failed to save pending update:', err);
       }
   }

   /**
    * Execute System Update Sequence
    * 1. Download file
    * 2. Unzip/Extract
    * 3. npm install
    * 4. npm run build
    * 5. sudo reboot
    */
   async performSystemUpdate(command) {
       let url = command.payload?.url || command.url;
       const fileName = command.payload?.file_name;
       
       // If no direct URL but we have a filename, try to resolve it from Supabase Storage
       if (!url && fileName) {
           console.log(`[EdgeSync] No URL provided, resolving ${fileName} from storage...`);
           
           // Try 'UPDATE FILE' bucket first (User's specific bucket)
           const { data: publicUrlData } = this.supabase
               .storage
               .from('UPDATE FILE')
               .getPublicUrl(fileName);
               
           if (publicUrlData && publicUrlData.publicUrl) {
               url = publicUrlData.publicUrl;
               console.log(`[EdgeSync] Resolved URL (UPDATE FILE bucket): ${url}`);
           } else {
               // Fallback to 'firmware' bucket
               const { data: publicUrlData2 } = this.supabase
                   .storage
                   .from('firmware')
                   .getPublicUrl(fileName);
                   
               if (publicUrlData2 && publicUrlData2.publicUrl) {
                   url = publicUrlData2.publicUrl;
                   console.log(`[EdgeSync] Resolved URL (firmware bucket): ${url}`);
               }
           }
       }
       
       if (!url) {
           throw new Error('No download URL provided in command payload and could not resolve file_name');
       }

       await this.updateCommandStatus(command.id, 'processing', 'Downloading update package...');
       
       // 1. Download
       console.log(`[EdgeSync] Downloading update from ${url}...`);
       const response = await fetch(url);
       if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
       
       const arrayBuffer = await response.arrayBuffer();
       const buffer = Buffer.from(arrayBuffer);
       
       const tempPath = path.join(os.tmpdir(), fileName || 'update_pkg.zip');
       fs.writeFileSync(tempPath, buffer);
       console.log(`[EdgeSync] Update downloaded to ${tempPath}`);

       // 2. Extract
       await this.updateCommandStatus(command.id, 'processing', 'Extracting files...');
       console.log('[EdgeSync] Extracting update...');
       const zip = new AdmZip(tempPath);
       // Extract to current working directory (project root)
       zip.extractAllTo(process.cwd(), true); 
       console.log('[EdgeSync] Extraction complete');

       // 3. npm install
       await this.updateCommandStatus(command.id, 'processing', 'Running npm install...');
       console.log('[EdgeSync] Running npm install...');
       await this.runShellCommand('npm install');

       // 4. npm run build
       await this.updateCommandStatus(command.id, 'processing', 'Running npm run build...');
       console.log('[EdgeSync] Running build process...');
       await this.runShellCommand('npm run build');

       // 5. Mark complete before rebooting
       await this.updateCommandStatus(command.id, 'completed', 'Update successful. Rebooting system...');
       
       // 6. Reboot
       console.log('[EdgeSync] Rebooting system...');
       await this.runShellCommand('sudo reboot');
   }

  /**
   * Helper to run shell commands promisified
   */
  runShellCommand(cmd) {
      return new Promise((resolve, reject) => {
          exec(cmd, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => { // 5MB buffer
              if (error) {
                  console.warn(`[EdgeSync] Command error (${cmd}):`, stderr || error.message);
                  reject(error);
              } else {
                  resolve(stdout);
              }
          });
      });
  }

  /**
   * Update command status in Supabase
   */
  async updateCommandStatus(commandId, status, logs = null) {
      if (!this.supabase) return;
      
      const updateData = { 
          status: status,
          updated_at: new Date().toISOString()
      };
      
      if (logs) {
          updateData.logs = logs; // Assuming 'logs' column exists, otherwise it might be ignored or error
      }

      await this.supabase
          .from('machine_commands')
          .update(updateData)
          .eq('id', commandId);
  }
}

// Singleton instance
const edgeSync = new EdgeSync();
module.exports = edgeSync;
