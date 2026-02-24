/**
 * NodeMCU Listener Service
 * Handles incoming connections from NodeMCU devices and processes coin pulse events
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const { initGPIO, updateGPIO } = require('./gpio');
const { getNodeMCULicenseManager } = require('./nodemcu-license');
const edgeSync = require('./edge-sync');

class NodeMCUListener {
  constructor(io) {
    this.io = io;
    this.devices = new Map(); // Map of device MAC addresses to device info
    this.server = null;
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.licenseManager = getNodeMCULicenseManager();
    this.socketIo = new Server(this.httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize routes
    this.setupRoutes();
    
    // Setup Socket.IO listeners
    this.setupSocketListeners();
  }

  setupRoutes() {
    // Endpoint for NodeMCU devices to report coin pulses
    this.app.post('/api/nodemcu/pulse', express.json(), async (req, res) => {
      try {
        const { macAddress, slotId, denomination, deviceId } = req.body;

        if (!macAddress || !slotId || !denomination) {
          return res.status(400).json({ error: 'Missing required fields: macAddress, slotId, denomination' });
        }

        // Verify device is registered and authenticated
        const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
        const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
        
        const device = devices.find(d => d.macAddress === macAddress);
        if (!device || device.status !== 'accepted') {
          return res.status(403).json({ error: 'Device not found or not authorized' });
        }

        // Sync device first to ensure it exists in Cloud for license check
        await this.syncDeviceToCloud({
             ...device,
             totalPulses: (device.totalPulses || 0) + denomination,
             totalRevenue: (device.totalRevenue || 0) + denomination,
             lastSeen: new Date().toISOString()
        });

        // --- LICENSE CHECK ---
        const license = await this.licenseManager.verifyLicense(macAddress);
        if (!license.isValid) {
          console.warn(`[NODEMCU] Pulse REJECTED for ${macAddress} - No valid license/trial.`);
          return res.status(403).json({ 
            error: 'YOUR COINSLOT MACHINE IS DISABLED', 
            message: 'YOUR COINSLOT MACHINE IS DISABLED' 
          });
        }
        // ---------------------

        // Update device stats locally
        const updatedDevice = {
          ...device,
          totalPulses: (device.totalPulses || 0) + denomination,
          totalRevenue: (device.totalRevenue || 0) + denomination,
          lastSeen: new Date().toISOString()
        };

        const updatedDevices = devices.map(d => {
          if (d.macAddress === macAddress) {
            return updatedDevice;
          }
          return d;
        });

        await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);

        // Sync Sale to Cloud with UPDATED device
        this.syncSaleToCloud(updatedDevice, slotId, denomination);

        // Emit pulse event to front-end
        this.io.emit('nodemcu-pulse', {
          deviceId: device.id,
          deviceName: device.name,
          slotId,
          denomination,
          macAddress,
          timestamp: new Date().toISOString()
        });

        // REMOVED: Traditional coin-pulse event to prevent double recording in main sales logs
        // this.io.emit('coin-pulse', { pesos: denomination });

        res.json({ success: true, message: 'Pulse recorded' });
      } catch (err) {
        console.error('Error processing NodeMCU pulse:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // Health check endpoint
    this.app.get('/api/nodemcu/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  setupSocketListeners() {
    // Listen for connections from NodeMCU devices (via HTTP polling or WebSocket)
    this.socketIo.on('connection', (socket) => {
      console.log('NodeMCU device connected:', socket.id);

      // Device authentication
      socket.on('authenticate', async (data, callback) => {
        try {
          const { macAddress, authenticationKey } = data;

          if (!macAddress || !authenticationKey) {
            callback({ success: false, error: 'Missing authentication data' });
            return;
          }

          // Verify device credentials
          const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
          const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
          
          const device = devices.find(d => d.macAddress === macAddress);
          if (!device) {
            callback({ success: false, error: 'Device not found' });
            return;
          }

          if (device.authenticationKey !== authenticationKey) {
            callback({ success: false, error: 'Invalid authentication key' });
            return;
          }

          // Sync device first to ensure it exists in Cloud for license check
          await this.syncDeviceToCloud({ ...device, status: 'connected', lastSeen: new Date().toISOString() });

          // --- LICENSE CHECK ---
          const license = await this.licenseManager.verifyLicense(macAddress);
          if (!license.isValid) {
            console.warn(`[NODEMCU] Authentication REJECTED for ${macAddress} - No valid license/trial.`);
            callback({ 
              success: false, 
              error: 'YOUR COINSLOT MACHINE IS DISABLED', 
              message: 'YOUR COINSLOT MACHINE IS DISABLED' 
            });
            return;
          }
          // ---------------------

          // Update device status and last seen
          const updatedDevices = devices.map(d => 
            d.macAddress === macAddress 
              ? { ...d, lastSeen: new Date().toISOString(), status: 'connected' } 
              : d
          );
          
          await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);

          // Store device info with socket
          this.devices.set(macAddress, { socketId: socket.id, ...device });

          // Sync Status to Cloud
          this.syncDeviceToCloud({ ...device, status: 'connected' });

          callback({ 
            success: true, 
            device: { ...device, status: 'connected' },
            message: 'Authentication successful'
          });
        } catch (err) {
          console.error('Authentication error:', err);
          callback({ success: false, error: err.message });
        }
      });

      // Coin pulse reporting from NodeMCU
      socket.on('coin-pulse', async (data, callback) => {
        try {
          const { macAddress, slotId, denomination } = data;

          if (!macAddress || !slotId || !denomination) {
            callback({ success: false, error: 'Missing pulse data' });
            return;
          }

          // Verify device is authenticated
          if (!this.devices.has(macAddress)) {
            callback({ success: false, error: 'Device not authenticated' });
            return;
          }

          // Get device from database to verify it's accepted
          const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
          const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
          
          const device = devices.find(d => d.macAddress === macAddress);
          if (!device || device.status !== 'accepted') {
            callback({ success: false, error: 'Device not authorized' });
            return;
          }

          // Sync device first to ensure it exists in Cloud for license check
          await this.syncDeviceToCloud({
               ...device,
               totalPulses: (device.totalPulses || 0) + denomination,
               totalRevenue: (device.totalRevenue || 0) + denomination,
               lastSeen: new Date().toISOString()
          });

          // --- LICENSE CHECK ---
          const license = await this.licenseManager.verifyLicense(macAddress);
          if (!license.isValid) {
            console.warn(`[NODEMCU] Pulse REJECTED for ${macAddress} - No valid license/trial.`);
            callback({ 
              success: false, 
              error: 'YOUR COINSLOT MACHINE IS DISABLED', 
              message: 'YOUR COINSLOT MACHINE IS DISABLED' 
            });
            return;
          }
          // ---------------------

          // Update device stats locally
          const updatedDevice = {
            ...device,
            totalPulses: (device.totalPulses || 0) + denomination,
            totalRevenue: (device.totalRevenue || 0) + denomination,
            lastSeen: new Date().toISOString()
          };

          const updatedDevices = devices.map(d => {
            if (d.macAddress === macAddress) {
              return updatedDevice;
            }
            return d;
          });

          await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);

          // Sync Sale to Cloud using UPDATED device object to ensure revenue is correct
          this.syncSaleToCloud(updatedDevice, slotId, denomination);

          // Emit pulse event
          this.io.emit('nodemcu-pulse', {
            deviceId: device.id,
            deviceName: device.name,
            slotId,
            denomination,
            macAddress,
            timestamp: new Date().toISOString()
          });

          // REMOVED: Traditional coin-pulse event to prevent double recording in main sales logs
          // this.io.emit('coin-pulse', { pesos: denomination });

          callback({ success: true, message: 'Pulse recorded' });
        } catch (err) {
          console.error('Error processing coin pulse:', err);
          callback({ success: false, error: err.message });
        }
      });

      socket.on('disconnect', () => {
        console.log('NodeMCU device disconnected:', socket.id);
        
        // Find and update device status to disconnected
        for (let [mac, deviceInfo] of this.devices) {
          if (deviceInfo.socketId === socket.id) {
            this.updateDeviceStatus(mac, 'disconnected');
            this.devices.delete(mac);
            break;
          }
        }
      });
    });
  }

  async updateDeviceStatus(macAddress, status) {
    try {
      const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
      const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
      
      const updatedDevices = devices.map(d => 
        d.macAddress === macAddress 
          ? { ...d, status, lastSeen: new Date().toISOString() } 
          : d
      );
      
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);

      // Sync status to cloud
      const device = devices.find(d => d.macAddress === macAddress);
      if (device) {
          this.syncDeviceToCloud({ ...device, status });
      }

    } catch (err) {
      console.error('Error updating device status:', err);
    }
  }

  // --- Cloud Sync Methods ---

  async syncDeviceToCloud(device) {
    // Delegate to edge-sync module to centralize logic
    return await edgeSync.syncNodeMCUDevice(device);
  }

  async syncSaleToCloud(device, slotId, amount) {
       if (!edgeSync.supabase || !edgeSync.machineId || !edgeSync.vendorId) return;

       // Ensure device is synced and we have its ID
       const cloudId = await this.syncDeviceToCloud(device);
       
       if (!cloudId) {
           console.warn(`[NodeMCU Sync] Cannot sync sale - Device ${device.macAddress} not synced to cloud.`);
           return;
       }

       try {
           const { error } = await edgeSync.supabase
               .from('nodemcu_sales')
               .insert({
                   vendor_id: edgeSync.vendorId,
                   machine_id: edgeSync.machineId,
                   device_id: cloudId,
                   slot_id: slotId,
                   amount: amount,
                   created_at: new Date().toISOString()
               });
            
           if (error) {
               console.error('[NodeMCU Sync] Error recording sale:', error.message);
           } else {
               console.log(`[NodeMCU Sync] Sale recorded for ${device.macAddress}: ${amount}`);
           }
       } catch (e) {
           console.error('[NodeMCU Sync] Exception syncing sale:', e);
       }
  }

  // Start the listener service
  start(port = 8081) {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(port, () => {
        console.log(`[NODEMCU LISTENER] Service running on port ${port}`);
        console.log(`[NODEMCU LISTENER] Ready to receive connections from NodeMCU devices`);
        resolve();
      });

      this.httpServer.on('error', (err) => {
        console.error('[NODEMCU LISTENER] Server error:', err);
        reject(err);
      });
    });
  }

  // Stop the listener service
  async stop() {
    if (this.httpServer) {
      this.httpServer.close(() => {
        console.log('[NODEMCU LISTENER] Service stopped');
      });
    }
  }
}

module.exports = NodeMCUListener;
