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
const { getUniqueHardwareId } = require('./hardware');
const db = require('./db');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SALES_SYNC_ENABLED = true;

// Status sync interval (60 seconds)
const STATUS_SYNC_INTERVAL = 60000;

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
    this.isInitialized = false;

    this.loadQueue();
    this.loadLocalIdentity();
    
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
    }, STATUS_SYNC_INTERVAL);

    console.log('[EdgeSync] Status sync started (every 60s)');
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
          }
          // Vendor has been assigned, process queued sales
          this.processQueue();
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

      // Validate vendor exists in cloud to avoid FK constraint errors
      try {
        const { data: vendorRealtime, error: vendorRealtimeError } = await this.supabase
          .from('vendor_dashboard_realtime')
          .select('vendor_id')
          .eq('vendor_id', vendorId)
          .limit(1);
        if (vendorRealtimeError) {
          console.warn('[EdgeSync] Vendor validation failed (realtime check error). Queuing sale.');
          this.queueSync('sale', saleData);
          return false;
        }
        if (!vendorRealtime || vendorRealtime.length === 0) {
          console.warn('[EdgeSync] Vendor ID not found in realtime table. Machine likely not linked. Queuing sale.');
          this.queueSync('sale', saleData);
          return false;
        }
      } catch (e) {
        console.warn('[EdgeSync] Vendor validation exception. Queuing sale.');
        this.queueSync('sale', saleData);
        return false;
      }

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

      if (error) throw error;

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

  /**
   * Get Sync Stats for Dashboard
   */
  getSyncStats() {
    return {
      configured: !!(this.supabase && this.machineId),
      machineId: this.machineId || 'Not Registered',
      vendorId: this.vendorId || 'Pending Activation',
      statusSyncActive: !!this.statusSyncInterval,
      queuedSyncs: this.queue.length
    };
  }
}

// Singleton instance
const edgeSync = new EdgeSync();
module.exports = edgeSync;
