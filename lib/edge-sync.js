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

// Status sync interval (10 seconds)
const STATUS_SYNC_INTERVAL = 10000;

// Retry queue for failed syncs
const RETRY_QUEUE_PATH = path.join(__dirname, '../data/sync-queue.json');

class EdgeSync {
  constructor() {
    this.supabase = null;
    this.statusSyncInterval = null;
    this.queue = [];
    
    // Machine Identity
    this.hardwareId = null;
    this.machineId = null;
    this.vendorId = null;
    this.centralizedKey = null;
    this.isInitialized = false;

    this.loadQueue();
    this.loadLocalIdentity();
    this.loadCentralizedKey();
    
    // Bind methods to preserve 'this' context when destructured
    this.recordSale = this.recordSale.bind(this);
    this.syncSaleToCloud = this.recordSale.bind(this); // Alias for compatibility
    this.getSyncStats = this.getSyncStats.bind(this);
    this.getIdentity = this.getIdentity.bind(this);
    
    this.init();
  }

  /**
   * Initialize Supabase client and Machine Identity
   */
  async init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('[EdgeSync] Supabase credentials not configured. Cloud sync disabled.');
      return;
    }

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

    // Start periodic heartbeat
    this.statusSyncInterval = setInterval(() => {
      this.syncMachineStatus('online');
      this.syncClientsToCloud();
      this.syncRoamingSessions(); // Pull updates from cloud
    }, STATUS_SYNC_INTERVAL);

    console.log('[EdgeSync] Status sync started (every 30s)');
    
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
      
      const updatePayload = {
        status, 
        last_seen: new Date().toISOString(),
        cpu_temp: metrics.cpuTemp, 
        uptime_seconds: metrics.uptime, 
        active_sessions_count: metrics.activeSessions 
      };

      const { error } = await this.supabase
        .from('vendors')
        .update(updatePayload)
        .eq('id', this.machineId);

      if (error) throw error;
      
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
          const sessions = await db.all("SELECT mac, ip, token, remaining_seconds, total_paid, connected_at, updated_at FROM sessions WHERE remaining_seconds > 0 OR updated_at > datetime('now', '-5 minutes')");

          if (!sessions || sessions.length === 0) return;

          // Prepare payload for Supabase wifi_devices table
          const updates = sessions.map(session => {
              // Ensure we have a unique session token for this device on this machine
              const sessionToken = session.token || `fallback-${this.machineId}-${session.mac}`;
              
              return {
                  mac_address: session.mac,
                  session_token: sessionToken,
                  machine_id: this.machineId,
                  vendor_id: this.vendorId,
                  ip_address: session.ip,
                  last_heartbeat: new Date().toISOString(),
                  is_connected: true,
                  total_paid: session.total_paid || 0,
                  remaining_seconds: session.remaining_seconds,
                  updated_at: new Date().toISOString()
              };
          });

          // Upsert to Supabase
          try {
              // Attempt 1: Try upserting by session_token (preferred unique identifier)
              const { error } = await this.supabase
                  .from('wifi_devices')
                  .upsert(updates, { onConflict: 'session_token' }); 

              if (error) {
                  // Attempt 2: If we hit a duplicate key error (usually "wifi_devices_mac_address_machine_id_key"),
                  // it means we are trying to insert a NEW session_token for a (mac, machine) pair that already exists.
                  // We should fallback to updating based on that composite key.
                  if (error.code === '23505' || error.message.includes('unique constraint')) {
                      // console.warn('[EdgeSync] Conflict on unique key. Retrying with onConflict: mac_address, machine_id');
                      
                      const { error: retryError } = await this.supabase
                          .from('wifi_devices')
                          .upsert(updates, { onConflict: 'mac_address, machine_id' }); 
                          
                      if (retryError) {
                          // If we still have conflicts (likely session_token collision due to device swapping),
                          // we need to handle them one by one.
                          if (retryError.code === '23505' || retryError.message.includes('unique constraint')) {
                              // console.warn('[EdgeSync] Batch sync failed due to complex conflicts. Switching to sequential force-sync.');
                              for (const update of updates) {
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
           const { data: devices, error } = await this.supabase
            .from('wifi_devices')
            .select('mac_address, remaining_seconds, total_paid, updated_at')
            .eq('vendor_id', this.vendorId)
            .gt('remaining_seconds', 0); // Only care about active ones
            
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
          const { data, error } = await this.supabase
            .from('wifi_devices')
            .select('mac_address, remaining_seconds, total_paid, updated_at')
            .eq('vendor_id', this.vendorId)
            .eq('mac_address', mac)
            .maybeSingle();
            
          if (error) {
              console.error(`[EdgeSync] checkRoamingForMac Supabase error:`, error.message);
              return null;
          }
          
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

          const updatePayload = {
              mac_address: mac,
              session_token: sessionToken,
              machine_id: this.machineId,
              vendor_id: this.vendorId,
              ip_address: ip,
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
