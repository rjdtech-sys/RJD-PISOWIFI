// This module simulates the GPIO interactions required for real hardware.
// In a production Node.js environment, this would use 'onoff' or 'orange-pi-gpio'.

const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Extract the Orange Pi CPU serial number from /proc/cpuinfo
 * This is a hardware-unique identifier that cannot be changed
 * @returns {string|null} The CPU serial number or null if not found
 */
function getHardwareSerial() {
  try {
    // ======= Source 1: /proc/cpuinfo Serial field (Raspberry Pi) =======
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
      
      // Look for Serial field (Raspberry Pi style)
      const serialMatch = cpuInfo.match(/^Serial\s*:\s*([0-9a-fA-F]+)$/m);
      if (serialMatch && serialMatch[1]) {
        return serialMatch[1].trim();
      }
      
      // Look for Hardware field combined with Revision (Orange Pi fallback)
      const hardwareMatch = cpuInfo.match(/^Hardware\s*:\s*(.+)$/m);
      const revisionMatch = cpuInfo.match(/^Revision\s*:\s*([0-9a-fA-F]+)$/m);
      
      if (hardwareMatch && revisionMatch) {
        return `${hardwareMatch[1].trim()}-${revisionMatch[1].trim()}`;
      }
    }
    
    // ======= Source 2: Device tree serial number (ARM boards) =======
    const dtPaths = [
      '/sys/firmware/devicetree/base/serial-number',
      '/proc/device-tree/serial-number'
    ];
    for (const dtPath of dtPaths) {
      if (fs.existsSync(dtPath)) {
        try {
          const serial = fs.readFileSync(dtPath, 'utf-8').replace(/\0/g, '').trim();
          if (serial && /^[0-9a-fA-F]+$/.test(serial)) {
            return serial;
          }
        } catch (e) {}
      }
    }

    // ======= Source 3: DMI product UUID (x86 / Chromebox) =======
    const dmiPath = '/sys/class/dmi/id/product_uuid';
    if (fs.existsSync(dmiPath)) {
      try {
        const uuid = fs.readFileSync(dmiPath, 'utf-8').trim();
        if (uuid && uuid !== 'None' && uuid !== 'To Be Filled By O.E.M.') {
          return uuid.replace(/-/g, '');
        }
      } catch (e) {
        // DMI product_uuid requires root — try board serial instead
      }
    }
    // Try DMI board serial as alternative
    const dmiBoardPath = '/sys/class/dmi/id/board_serial';
    if (fs.existsSync(dmiBoardPath)) {
      try {
        const serial = fs.readFileSync(dmiBoardPath, 'utf-8').trim();
        if (serial && serial !== 'None' && serial !== 'To Be Filled By O.E.M.' && serial !== 'Default string') {
          return serial.replace(/-/g, '');
        }
      } catch (e) {}
    }

    // ======= Source 4: Sunxi SID (Orange Pi Allwinner boards) =======
    const sunxiPaths = [
      '/sys/bus/sunxi_info/devices/sunxi_info/serial',
      '/sys/class/sunxi_info/sys_info'
    ];
    for (const sunxiPath of sunxiPaths) {
      if (fs.existsSync(sunxiPath)) {
        try {
          const content = fs.readFileSync(sunxiPath, 'utf-8').trim();
          const sidMatch = content.match(/([0-9a-fA-F]{16,})/);
          if (sidMatch) return sidMatch[1];
        } catch (e) {}
      }
    }

    console.warn('[Hardware] Could not extract serial from any source');
    return null;
  } catch (error) {
    console.error('[Hardware] Error extracting hardware serial:', error);
    return null;
  }
}

/**
 * Get a unique hardware identifier for this device
 * Falls back to MAC address if CPU serial is unavailable
 */
async function getUniqueHardwareId() {
  const serial = getHardwareSerial();
  if (serial) {
    return `CPU-${serial}`;
  }
  
  // Fallback to MAC address of primary network interface
  try {
    // Windows fallback
    if (process.platform === 'win32') {
      const output = execSync('getmac /fo csv /nh', { encoding: 'utf-8' });
      const firstMac = output.split('\n')[0].split(',')[0].replace(/"/g, '');
      if (firstMac) return `WIN-${firstMac.replace(/-/g, '')}`;
    }

    const output = execSync(`ip -o link show | awk '/link\\/ether/ {print $2 " " $17}'`, {
      encoding: 'utf-8'
    });
    const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const iface = (parts[0] || '').replace(':', '');
      const mac = parts[1] || '';
      if (!iface || ['lo', 'ifb0'].includes(iface) || iface.startsWith('docker') || iface.startsWith('veth')) continue;
      if (/^[0-9a-fA-F:]{17}$/.test(mac) && mac !== '00:00:00:00:00:00') {
        return `MAC-${mac.replace(/:/g, '')}`;
      }
    }
  } catch (error) {
    console.error('[Hardware] Error extracting MAC address:', error);
  }

  // Last-resort fallback only. machine-id can be cloned with an OS image, so never prefer it
  // over CPU serial or MAC address for licensing/trial identity.
  const machineIdPaths = [
    '/etc/machine-id',
    '/var/lib/dbus/machine-id'
  ];
  for (const mIdPath of machineIdPaths) {
    if (fs.existsSync(mIdPath)) {
      try {
        const mId = fs.readFileSync(mIdPath, 'utf-8').trim();
        if (mId && mId.length >= 32) {
          return `MID-${mId}`;
        }
      } catch (e) {}
    }
  }
  
  throw new Error('Unable to determine unique hardware identifier');
}

class HardwareController {
  constructor() {
    this.coinPulses = 0;
    this.onPulseCallback = () => {};
    console.log('Hardware Controller Initialized (GPIO Pin 3)');
  }

  // Simulate a hardware interrupt from the coin slot
  // In real Node: gpio.on('interrupt', (val) => { ... })
  simulateCoinInsert(pesos) {
    const pulses = pesos === 1 ? 1 : pesos === 5 ? 5 : 10;
    this.coinPulses += pulses;
    this.onPulseCallback(pesos);
  }

  onCreditDetected(callback) {
    this.onPulseCallback = callback;
  }

  resetPulses() {
    this.coinPulses = 0;
  }

  getStatus() {
    return {
      board: 'Raspberry Pi / Orange Pi',
      pin: 3,
      mode: 'Input',
      pull: 'Up'
    };
  }
}

const hardware = new HardwareController();

module.exports.getHardwareSerial = getHardwareSerial;
module.exports.getUniqueHardwareId = getUniqueHardwareId;
module.exports.HardwareController = HardwareController;
module.exports.hardware = hardware;
