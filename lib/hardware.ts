
// This module simulates the GPIO interactions required for real hardware.
// In a production Node.js environment, this would use 'onoff' or 'orange-pi-gpio'.

import { execSync } from 'child_process';
import * as fs from 'fs';

/**
 * Extract the Orange Pi CPU serial number from /proc/cpuinfo
 * This is a hardware-unique identifier that cannot be changed
 * @returns The CPU serial number or null if not found
 */
export function getHardwareSerial(): string | null {
  try {
    // ======= Source 1: /proc/cpuinfo Serial field (Raspberry Pi) =======
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
      
      // Look for Serial field (Raspberry Pi style)
      const serialMatch = cpuInfo.match(/^Serial\s*:\s*([0-9a-fA-F]+)$/m);
      if (serialMatch && serialMatch[1]) {
        return serialMatch[1].trim();
      }
      
    }
    
    // ======= Source 2: Device tree serial number (ARM boards) =======
    const dtPaths = [
      '/sys/firmware/devicetree/base/serial-number',
      '/proc/device-tree/serial-number',
      '/sys/devices/soc0/serial_number'
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

    // ======= Source 5: machine-id (universal Linux fallback) =======
    const machineIdPaths = [
      '/etc/machine-id',
      '/var/lib/dbus/machine-id'
    ];
    for (const mIdPath of machineIdPaths) {
      if (fs.existsSync(mIdPath)) {
        try {
          const mId = fs.readFileSync(mIdPath, 'utf-8').trim();
          if (mId && mId.length >= 32) {
            return mId;
          }
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
export async function getUniqueHardwareId(): Promise<string> {
  const serial = getHardwareSerial();
  if (serial) {
    return `CPU-${serial}`;
  }
  
  // Fallback to MAC address of primary network interface
  try {
    const output = execSync('ip link show | grep "link/ether" | head -1', { 
      encoding: 'utf-8' 
    });
    const macMatch = output.match(/([0-9a-fA-F:]{17})/);
    if (macMatch && macMatch[1]) {
      return `MAC-${macMatch[1].replace(/:/g, '')}`;
    }
  } catch (error) {
    console.error('[Hardware] Error extracting MAC address:', error);
  }
  
  throw new Error('Unable to determine unique hardware identifier');
}

export class HardwareController {
  private coinPulses: number = 0;
  private onPulseCallback: (credits: number) => void = () => {};

  constructor() {
    console.log('Hardware Controller Initialized (GPIO Pin 3)');
  }

  // Simulate a hardware interrupt from the coin slot
  // In real Node: gpio.on('interrupt', (val) => { ... })
  public simulateCoinInsert(pesos: 1 | 5 | 10) {
    const pulses = pesos === 1 ? 1 : pesos === 5 ? 5 : 10;
    this.coinPulses += pulses;
    this.onPulseCallback(pesos);
  }

  public onCreditDetected(callback: (amount: number) => void) {
    this.onPulseCallback = callback;
  }

  public resetPulses() {
    this.coinPulses = 0;
  }

  public getStatus() {
    return {
      board: 'Raspberry Pi / Orange Pi',
      pin: 3,
      mode: 'Input',
      pull: 'Up'
    };
  }
}

export const hardware = new HardwareController();
