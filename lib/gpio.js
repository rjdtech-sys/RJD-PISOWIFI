// This module handles GPIO for RPi/OPi and Serial for x64/NodeMCU
const fs = require('fs');
const path = require('path');
let Gpio;
let SerialPort;

try {
  Gpio = require('onoff').Gpio;
} catch (e) {
  console.warn('[GPIO] Native onoff not available. Normal on non-Linux/x64.');
}

try {
  SerialPort = require('serialport').SerialPort;
} catch (e) {
  console.warn('[SERIAL] SerialPort not available.');
}

let coinInput = null;
let serialBridge = null;
let currentPulseCallback = null;
let multiSlotCallbacks = {};
let simulationTimer = null;
let relayOutput = null;
let relayActiveHigh = true;

const { getOpPin } = require('./opi_pinout');
const { getRpiPin } = require('./rpi_pinout');

// Mapping for standard RPi header
function getPhysicalPin(bcm) {
  const mapping = { 2: 3, 3: 5, 4: 7, 17: 11, 27: 13, 22: 15, 10: 19, 9: 21, 11: 23, 5: 29, 6: 31, 13: 33, 19: 35, 26: 37, 14: 8, 15: 10 };
  return mapping[bcm] || 'Unknown';
}

// Non-blocking Promise-based delay (replaces busy-waiting sleepSync)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function findCorrectGpioBase() {
  const gpioDir = '/sys/class/gpio';
  if (!fs.existsSync(gpioDir)) return 0;

  try {
    const chips = fs.readdirSync(gpioDir).filter(f => f.startsWith('gpiochip'));
    for (const chip of chips) {
      const chipPath = path.join(gpioDir, chip);
      const ngpioPath = path.join(chipPath, 'ngpio');
      const basePath = path.join(chipPath, 'base');

      if (fs.existsSync(ngpioPath) && fs.existsSync(basePath)) {
        const lines = parseInt(fs.readFileSync(ngpioPath, 'utf8').trim());
        const base = parseInt(fs.readFileSync(basePath, 'utf8').trim());
        
        // Raspberry Pi usually has a chip with ~54 lines (BCM2835) or similar
        // Orange Pi H3 often has multiple chips. We use this as fallback.
        if (lines >= 50 && lines <= 200) { 
          // Relaxed check to include OPi chips if possible, but mainly for RPi
          // console.log(`[GPIO] Detected SOC Header Chip: ${chip} (Base: ${base}, Lines: ${lines})`);
          return base;
        }
      }
    }
  } catch (e) {
    console.error('[GPIO] Error probing gpiochips:', e.message);
  }
  return 0;
}

// Allwinner H6 port order and expected bases (port-based numbering)
const ALLWINNER_H6_PORTS = [
  { port: 'PA', expectedBase: 0 },
  { port: 'PC', expectedBase: 64 },
  { port: 'PD', expectedBase: 96 },
  { port: 'PF', expectedBase: 160 },
  { port: 'PG', expectedBase: 192 },
  { port: 'PH', expectedBase: 224 },
  { port: 'PL', expectedBase: 352 }
];

/**
 * Dynamically correct Orange Pi GPIO numbers based on actual kernel gpiochip bases.
 * The opi_pinout.js uses port-based numbering (e.g., PD26 = 96 + 26 = 122).
 * But some kernels register gpiochips sequentially (PA=0, PC=32, PD=64, etc.)
 * This function reads the actual bases and adjusts the number accordingly.
 */
function correctOpiGpioNumber(rawGpio) {
  const gpioDir = '/sys/class/gpio';
  try {
    if (!fs.existsSync(gpioDir)) return rawGpio;
    
    const chips = fs.readdirSync(gpioDir).filter(f => f.startsWith('gpiochip'));
    if (chips.length === 0) return rawGpio;
    
    // Read all chip info and sort by base
    const chipInfo = chips.map(chip => {
      const basePath = path.join(gpioDir, chip, 'base');
      const ngpioPath = path.join(gpioDir, chip, 'ngpio');
      const base = fs.existsSync(basePath) ? parseInt(fs.readFileSync(basePath, 'utf8').trim()) : 0;
      const ngpio = fs.existsSync(ngpioPath) ? parseInt(fs.readFileSync(ngpioPath, 'utf8').trim()) : 32;
      return { chip, base, ngpio };
    }).sort((a, b) => a.base - b.base);
    
    // Find which expected port the raw number belongs to
    let expectedPort = null;
    let pinOffset = 0;
    for (let i = ALLWINNER_H6_PORTS.length - 1; i >= 0; i--) {
      if (rawGpio >= ALLWINNER_H6_PORTS[i].expectedBase) {
        expectedPort = ALLWINNER_H6_PORTS[i];
        pinOffset = rawGpio - expectedPort.expectedBase;
        break;
      }
    }
    
    if (!expectedPort) return rawGpio;
    
    // Find the port index (0=PA, 1=PC, 2=PD, etc.)
    const portIndex = ALLWINNER_H6_PORTS.findIndex(p => p.port === expectedPort.port);
    if (portIndex === -1 || portIndex >= chipInfo.length) return rawGpio;
    
    const actualChip = chipInfo[portIndex];
    const corrected = actualChip.base + pinOffset;
    
    if (corrected !== rawGpio) {
      console.log(`[GPIO] Corrected ${expectedPort.port}${pinOffset}: ${rawGpio} -> ${corrected} (chip ${actualChip.chip} base=${actualChip.base})`);
    }
    
    return corrected;
  } catch (e) {
    return rawGpio;
  }
}

async function initGPIO(
  onPulse,
  boardType = 'none',
  pin = 2,
  boardModel = null,
  espIpAddress = '192.168.4.1',
  espPort = 80,
  coinSlots = [],
  nodemcuDevices = [],
  relayPin = null,
  relayActiveMode = 'high'
) {
  currentPulseCallback = onPulse;
  multiSlotCallbacks = {};
  
  let sysPin = -1;
  let physPin = 'Unknown';
  let isSimulated = false;
  let relaySysPin = -1;
  let relayPhysPin = 'Unknown';

  // Cleanup existing GPIO
  if (coinInput) {
    try {
      // Clear polling interval if in polling mode (Orange Pi H6 fallback)
      if (coinInput.__pollInterval) {
        clearInterval(coinInput.__pollInterval);
        coinInput.__pollInterval = null;
      }
      coinInput.unwatchAll();
      coinInput.unexport();
    } catch (e) {}
    coinInput = null;
  }

  // Cleanup Serial
  if (serialBridge) {
    try {
      serialBridge.close();
    } catch (e) {}
    serialBridge = null;
  }

  if (relayOutput) {
    try {
      relayOutput.writeSync(0);
      relayOutput.unexport();
    } catch (e) {}
    relayOutput = null;
  }

  // Cleanup Simulation
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }

  if (boardType === 'none') {
    isSimulated = true;
    physPin = getPhysicalPin(pin);
    console.log(`[GPIO] Simulation Mode. Target: Pin ${pin} (Physical ${physPin})`);
    
    simulationTimer = setInterval(() => {
      console.log('[GPIO SIMULATION] Generating test pulse (1 peso)');
      if (currentPulseCallback) currentPulseCallback(1);
      
      if (coinSlots && coinSlots.length > 0) {
        const firstSlot = coinSlots.find(s => s.enabled);
        if (firstSlot && multiSlotCallbacks[firstSlot.id]) {
           // console.log(`[GPIO SIMULATION] Generating multi-slot pulse for Slot ${firstSlot.id}`);
           multiSlotCallbacks[firstSlot.id](firstSlot.denomination);
        }
      }
    }, 5000);
    if (simulationTimer.unref) simulationTimer.unref();
    return;
  }

  if (boardType === 'nodemcu_esp') {
    // Handle WiFi communication with ESP board
    console.log(`[WIFI] Connecting to ESP at ${espIpAddress}:${espPort}`);
    
    // For WiFi connection, we'll use HTTP requests or WebSocket
    // This is a placeholder for the actual implementation
    // The actual WiFi communication logic would be implemented here
    
    // Simulate connection for now
    setTimeout(() => {
      console.log(`[WIFI] Connected to ESP at ${espIpAddress}:${espPort}`);
      
      // Send configuration to ESP board
      if (coinSlots && coinSlots.length > 0) {
        const configMsg = `CONFIG:${JSON.stringify(coinSlots.map(slot => ({
          id: slot.id,
          pin: slot.pin,
          denomination: slot.denomination,
          enabled: slot.enabled
        })))}`;
        console.log(`[WIFI] Would send multi-slot config to ESP: ${configMsg}`);
        // In real implementation, send this over WiFi using HTTP POST or WebSocket
      }
    }, 2000); // Wait for "connection" to establish
    
    return;
  }
  
  if (boardType === 'x64_pc') {
    // Use NodeMCU wireless functionality for x64 PC board selection
    console.log(`[NODEMCU WIRELESS] Setting up wireless communication for x64 PC`);
    console.log(`[NODEMCU WIRELESS] ESP IP: ${espIpAddress}:${espPort}`);
    
    // Handle WiFi communication with NodeMCU/ESP board
    // This replaces the serial bridge with wireless communication
    
    // Simulate connection for now (same as nodemcu_esp functionality)
    setTimeout(() => {
      console.log(`[NODEMCU WIRELESS] Connected to ESP at ${espIpAddress}:${espPort}`);
      
      // Send configuration to ESP board
      if (coinSlots && coinSlots.length > 0) {
        const configMsg = `CONFIG:${JSON.stringify(coinSlots.map(slot => ({
          id: slot.id,
          pin: slot.pin,
          denomination: slot.denomination,
          enabled: slot.enabled
        })))}`;
        console.log(`[NODEMCU WIRELESS] Sending multi-slot config to ESP: ${configMsg}`);
        // In real implementation, send this over WiFi using HTTP POST or WebSocket
      }
    }, 2000); // Wait for "connection" to establish
    
    return;
  }

  if (boardType === 'orange_pi') {
    if (boardModel) {
      const mapped = getOpPin(boardModel, pin);
      if (mapped !== undefined && mapped !== null) {
        // Apply dynamic base correction for boards with different gpiochip registration
        sysPin = correctOpiGpioNumber(mapped);
        physPin = pin; // In OPi mode, 'pin' is the physical pin number
        console.log(`[GPIO] OPi ${boardModel}: Physical Pin ${pin} -> raw=${mapped} -> sysfs=${sysPin}`);
      } else {
        console.warn(`[GPIO] No mapping for ${boardModel} Pin ${pin}. GPIO will not be initialized.`);
        return;
      }
    } else {
      // Legacy/Generic Orange Pi fallback
      const base = findCorrectGpioBase();
      sysPin = base + pin;
      physPin = `? (Input ${pin})`;
    }
  } else if (boardType === 'raspberry_pi') {
    if (boardModel) {
      const mapped = getRpiPin(boardModel, pin);
      if (mapped !== undefined && mapped !== null) {
        const base = findCorrectGpioBase();
        sysPin = base + mapped; // BCM GPIO number + base
        physPin = pin; // Physical pin number for display
        console.log(`[GPIO] RPi ${boardModel}: Physical Pin ${pin} mapped to BCM ${mapped} (System GPIO ${sysPin})`);
      } else {
        console.warn(`[GPIO] No mapping for ${boardModel} Pin ${pin}. GPIO will not be initialized.`);
        return;
      }
    } else {
      // Legacy fallback (no boardModel) - treat pin as BCM GPIO number for backward compat
      const base = findCorrectGpioBase();
      sysPin = base + pin;
      physPin = getPhysicalPin(pin);
    }
  } else {
    // Unknown board - fallback
    const base = findCorrectGpioBase();
    sysPin = base + pin;
    physPin = pin;
  }

  if (
    typeof relayPin === 'number' &&
    boardType !== 'none' &&
    boardType !== 'nodemcu_esp' &&
    boardType !== 'x64_pc'
  ) {
    if (boardType === 'orange_pi') {
      if (boardModel) {
        const relayMapped = getOpPin(boardModel, relayPin);
        if (relayMapped !== undefined && relayMapped !== null) {
          relaySysPin = correctOpiGpioNumber(relayMapped);
          relayPhysPin = relayPin;
          console.log(
            `[GPIO] OPi ${boardModel}: Relay Physical Pin ${relayPin} -> raw=${relayMapped} -> sysfs=${relaySysPin}`
          );
        } else {
          console.warn(
            `[GPIO] No mapping for ${boardModel} Relay Pin ${relayPin}. Relay output disabled.`
          );
        }
      } else {
        const relayBase = findCorrectGpioBase();
        relaySysPin = relayBase + relayPin;
        relayPhysPin = `? (Relay ${relayPin})`;
      }
    } else if (boardType === 'raspberry_pi') {
      if (boardModel) {
        const relayMapped = getRpiPin(boardModel, relayPin);
        if (relayMapped !== undefined && relayMapped !== null) {
          const relayBase = findCorrectGpioBase();
          relaySysPin = relayBase + relayMapped;
          relayPhysPin = relayPin;
          console.log(
            `[GPIO] RPi ${boardModel}: Relay Physical Pin ${relayPin} mapped to BCM ${relayMapped} (System GPIO ${relaySysPin})`
          );
        } else {
          console.warn(
            `[GPIO] No mapping for ${boardModel} Relay Pin ${relayPin}. Relay output disabled.`
          );
        }
      } else {
        // Legacy fallback - treat relayPin as BCM GPIO number
        const relayBase = findCorrectGpioBase();
        relaySysPin = relayBase + relayPin;
        relayPhysPin = getPhysicalPin(relayPin);
      }
    } else {
      const relayBase = findCorrectGpioBase();
      relaySysPin = relayBase + relayPin;
      relayPhysPin = relayPin;
    }
  }

  if (Gpio && sysPin !== -1) {
    try {
      // DIAGNOSTICS: Log all available gpiochips
      try {
        const gpioDir = '/sys/class/gpio';
        if (fs.existsSync(gpioDir)) {
          const chips = fs.readdirSync(gpioDir).filter(f => f.startsWith('gpiochip'));
          console.log(`[GPIO] Available gpiochips: ${chips.join(', ')}`);
          for (const chip of chips) {
            const basePath = path.join(gpioDir, chip, 'base');
            const labelPath = path.join(gpioDir, chip, 'label');
            const ngpioPath = path.join(gpioDir, chip, 'ngpio');
            const base = fs.existsSync(basePath) ? fs.readFileSync(basePath, 'utf8').trim() : '?';
            const ngpio = fs.existsSync(ngpioPath) ? fs.readFileSync(ngpioPath, 'utf8').trim() : '?';
            const label = fs.existsSync(labelPath) ? fs.readFileSync(labelPath, 'utf8').trim() : 'unknown';
            console.log(`[GPIO]   ${chip}: base=${base}, ngpio=${ngpio}, label=${label}`);
          }
        }
      } catch (diagErr) {}
      
      const gpioPath = `/sys/class/gpio/gpio${sysPin}`;
      
      // Manual export first - gives us better error info
      try {
        if (fs.existsSync(gpioPath)) {
          fs.writeFileSync('/sys/class/gpio/unexport', sysPin.toString());
          // Wait a moment for unexport to complete (non-blocking)
          let retries = 10;
          while (fs.existsSync(gpioPath) && retries-- > 0) {
            await sleep(50);
          }
        }
        fs.writeFileSync('/sys/class/gpio/export', sysPin.toString());
        // Wait for export to complete (non-blocking)
        let retries = 20;
        while (!fs.existsSync(gpioPath) && retries-- > 0) {
          await sleep(50);
        }
        if (!fs.existsSync(gpioPath)) {
          throw new Error(`GPIO ${sysPin} export failed - directory did not appear after export`);
        }
        console.log(`[GPIO] Manual export of GPIO ${sysPin} succeeded`);
      } catch (exportErr) {
        console.error(`[GPIO] Manual export FAILED for GPIO ${sysPin}: ${exportErr.message}`);
        console.error(`[GPIO] This usually means GPIO ${sysPin} is not valid on this board/kernel.`);
        throw exportErr;
      }
      
      // Check if edge file exists
      const edgePath = `${gpioPath}/edge`;
      const hasEdge = fs.existsSync(edgePath);
      console.log(`[GPIO] GPIO ${sysPin} edge file exists: ${hasEdge}`);

      console.log(`[GPIO] Configuring GPIO ${sysPin} (Physical Pin ${physPin})...`);
      
      // Try edge interrupt mode first (best for RPi and most OPi boards)
      let usePolling = false;
      try {
        if (hasEdge) {
          coinInput = new Gpio(sysPin, 'in', 'rising', { debounceTimeout: 25 });
          console.log(`[GPIO] Using interrupt mode (rising edge)`);
        } else {
          throw new Error('edge file missing');
        }
      } catch (edgeErr) {
        if (edgeErr.message && (edgeErr.message.includes('edge') || edgeErr.message.includes('ENOENT'))) {
          // Edge file missing - common on Orange Pi H6 and newer kernels
          console.warn(`[GPIO] Edge interrupt not supported for GPIO ${sysPin}, falling back to polling mode`);
          coinInput = new Gpio(sysPin, 'in', 'none', { debounceTimeout: 25 });
          usePolling = true;
          console.log(`[GPIO] Using polling mode (edge: none)`);
        } else {
          throw edgeErr;
        }
      }
      
      let pulseCount = 0;
      let pulseTimer = null;

      // Track last pulse time to prevent flooding from electrical noise
      let lastGPIOPulseTime = 0;
      const MIN_GPIO_PULSE_INTERVAL = 50; // Optimized: Reduced from 100ms to 50ms for faster detection
      
      if (usePolling) {
        // Manual polling for boards that don't support edge interrupts (e.g. Orange Pi 3 LTS H6)
        // OPTIMIZED: Use 20ms interval instead of 10ms to reduce I/O load by 50%
        // This still reliably detects ~50ms coin pulses (2-3 samples per pulse)
        let lastValue = 0;
        let consecutiveSameCount = 0;
        const pollInterval = setInterval(async () => {
          try {
            if (!coinInput) { clearInterval(pollInterval); return; }
            const val = coinInput.readSync();
            
            // Detect rising edge (0 -> 1 transition)
            if (val === 1 && lastValue === 0) {
              const now = Date.now();
              if (now - lastGPIOPulseTime >= MIN_GPIO_PULSE_INTERVAL) {
                lastGPIOPulseTime = now;
                pulseCount++;
                if (pulseTimer) clearTimeout(pulseTimer);
                pulseTimer = setTimeout(() => {
                  handlePulses(pulseCount);
                  pulseCount = 0;
                }, 250);
              }
            }
            lastValue = val;
            consecutiveSameCount = 0;
          } catch (pollErr) {
            consecutiveSameCount++;
            // If we hit 50 consecutive errors, stop polling to prevent resource waste
            if (consecutiveSameCount >= 50) {
              clearInterval(pollInterval);
              console.error('[GPIO] Polling stopped due to consecutive errors');
            }
          }
        }, 20); // Optimized: 20ms interval (50Hz) - balances I/O load vs pulse detection accuracy
        
        // Store interval reference for cleanup
        coinInput.__pollInterval = pollInterval;
        
        console.log(`[GPIO] SUCCESS: GPIO ${sysPin} is now ACTIVE (polling mode at 50Hz).`);
      } else {
        // Standard interrupt-based watching
        coinInput.watch((err, value) => {
          if (err) return console.error('[GPIO] Watch error:', err);
          
          // Only count pulse if minimum interval has passed
          const now = Date.now();
          if (now - lastGPIOPulseTime < MIN_GPIO_PULSE_INTERVAL) {
            return; // Skip if too frequent (electrical noise)
          }
          
          pulseCount++;
          lastGPIOPulseTime = now;
          if (pulseTimer) clearTimeout(pulseTimer);
          pulseTimer = setTimeout(() => {
            handlePulses(pulseCount);
            pulseCount = 0;
          }, 250); // Optimized: Reduced from 500ms to 250ms for faster response
        });

        console.log(`[GPIO] SUCCESS: GPIO ${sysPin} is now ACTIVE (interrupt mode).`);
      }
    } catch (e) {
      console.error(`[GPIO] EXPORT FAILED (System ${sysPin}): ${e.message}`);
      if (e.message && e.message.includes('EINVAL')) {
        console.error('DIAGNOSTICS: Invalid Argument. The GPIO number may be wrong for this board.');
      }
      if (e.message && e.message.includes('ENOENT')) {
        console.error('DIAGNOSTICS: GPIO path not found. Check /sys/class/gpio/ for available lines.');
      }
    }
  }

  if (Gpio && relaySysPin !== -1) {
    try {
      const relayGpioPath = `/sys/class/gpio/gpio${relaySysPin}`;
      if (fs.existsSync(relayGpioPath)) {
        try {
          fs.writeFileSync('/sys/class/gpio/unexport', relaySysPin.toString());
        } catch (e) {}
      }

      relayActiveHigh = relayActiveMode !== 'low';
      console.log(
        `[GPIO] Exporting RELAY GPIO ${relaySysPin} (Physical Pin ${relayPhysPin}) with active-${
          relayActiveHigh ? 'HIGH' : 'LOW'
        }...`
      );

      relayOutput = new Gpio(relaySysPin, 'out');
      const initialValue = relayActiveHigh ? 1 : 0;
      relayOutput.writeSync(initialValue);

      console.log(`[GPIO] SUCCESS: Relay GPIO ${relaySysPin} is now READY.`);
    } catch (e) {
      console.error(
        `[GPIO] RELAY EXPORT FAILED (System ${relaySysPin}): ${e.message}`
      );
    }
  }
}

function handlePulses(count) {
  if (count > 0 && currentPulseCallback) {
    currentPulseCallback(count);
  }
}

function handleMultiSlotPulse(slotId, denomination) {
  console.log(`[MULTI-SLOT] Slot ${slotId} detected: ${denomination} pesos`);
  
  // Call the main pulse callback with denomination
  if (currentPulseCallback) {
    currentPulseCallback(denomination);
  }
  
  // Call slot-specific callback if registered
  if (multiSlotCallbacks[slotId]) {
    multiSlotCallbacks[slotId](denomination);
  }
}

function setRelayState(isOn) {
  if (!relayOutput) return;
  
  // LOGIC REQUESTED BY USER:
  // If Active High Setup:
  // - Trigger (isOn=true) -> Active Low (0)
  // - Normal (isOn=false) -> Active High (1)
  // If Active Low Setup:
  // - Trigger (isOn=true) -> Active High (1)
  // - Normal (isOn=false) -> Active Low (0)
  
  let value;
  if (relayActiveHigh) {
    // Active High Setup
    value = isOn ? 0 : 1;
  } else {
    // Active Low Setup
    value = isOn ? 1 : 0;
  }

  try {
    relayOutput.writeSync(value);
  } catch (e) {
    console.error('[GPIO] Failed to set relay state:', e.message);
  }
}

function simulateCoinPulse(count = 1) {
  const pulses = Math.max(1, Math.min(100, parseInt(count, 10) || 1));
  if (currentPulseCallback) {
    currentPulseCallback(pulses);
    return true;
  }
  return false;
}

function registerSlotCallback(slotId, callback) {
  multiSlotCallbacks[slotId] = callback;
}

function unregisterSlotCallback(slotId) {
  delete multiSlotCallbacks[slotId];
}

async function updateGPIO(
  boardType,
  pin,
  boardModel,
  espIpAddress,
  espPort,
  coinSlots,
  nodemcuDevices,
  relayPin = null,
  relayActiveMode = 'high'
) {
  console.log(`[HARDWARE] Reconfiguring: ${boardType} (${boardModel || 'Generic'}), Pin ${pin}`);
  if (boardType === 'nodemcu_esp') {
    console.log(`[HARDWARE] Multi-slot config: ${coinSlots ? coinSlots.length : 0} slots, WiFi: ${espIpAddress}:${espPort || 'default'}`);
  }
  if (nodemcuDevices) {
    console.log(`[HARDWARE] Multi-NodeMCU config: ${nodemcuDevices.length} devices`);
  }
  if (relayPin !== null) {
    console.log(
      `[HARDWARE] Relay config: Pin ${relayPin}, active-${relayActiveMode === 'low' ? 'LOW' : 'HIGH'}`
    );
  }
  await initGPIO(
    currentPulseCallback,
    boardType,
    pin,
    boardModel,
    espIpAddress,
    espPort,
    coinSlots,
    nodemcuDevices,
    relayPin,
    relayActiveMode
  );
}

module.exports = { initGPIO, updateGPIO, registerSlotCallback, unregisterSlotCallback, setRelayState, simulateCoinPulse };
