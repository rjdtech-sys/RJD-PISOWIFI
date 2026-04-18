
const mappings = {
  'raspberry_pi_2b_3b': {
    name: "Raspberry Pi 2B / 3B / 3B+",
    pins: {
      3: 2,    // SDA1
      5: 3,    // SCL1
      7: 4,    // GPCLK0
      8: 14,   // TXD0
      10: 15,  // RXD0
      11: 17,
      12: 18,  // PCM_CLK / PWM0
      13: 27,
      15: 22,
      16: 23,
      18: 24,
      19: 10,  // MOSI
      21: 9,   // MISO
      22: 25,
      23: 11,  // SCLK
      24: 8,   // CE0
      26: 7,   // CE1
      27: 0,   // ID_SD (EEPROM)
      28: 1,   // ID_SC (EEPROM)
      29: 5,
      31: 6,
      32: 12,  // PWM0
      33: 13,  // PWM1
      35: 19,  // MISO1
      36: 16,  // CE2
      37: 26,
      38: 20,  // MOSI1
      40: 21   // SCLK1
    }
  },
  'raspberry_pi_4b': {
    name: "Raspberry Pi 4B",
    pins: {
      3: 2,    // SDA1
      5: 3,    // SCL1
      7: 4,    // GPCLK0
      8: 14,   // TXD0
      10: 15,  // RXD0
      11: 17,
      12: 18,  // PCM_CLK / PWM0
      13: 27,
      15: 22,
      16: 23,
      18: 24,
      19: 10,  // MOSI
      21: 9,   // MISO
      22: 25,
      23: 11,  // SCLK
      24: 8,   // CE0
      26: 7,   // CE1
      27: 0,   // ID_SD (EEPROM)
      28: 1,   // ID_SC (EEPROM)
      29: 5,
      31: 6,
      32: 12,  // PWM0
      33: 13,  // PWM1
      35: 19,  // MISO1
      36: 16,  // CE2
      37: 26,
      38: 20,  // MOSI1
      40: 21   // SCLK1
    }
  },
  'raspberry_pi_5': {
    name: "Raspberry Pi 5",
    pins: {
      3: 2,    // SDA1
      5: 3,    // SCL1
      7: 4,    // GPCLK0
      8: 14,   // TXD0
      10: 15,  // RXD0
      11: 17,
      12: 18,  // PCM_CLK / PWM0
      13: 27,
      15: 22,
      16: 23,
      18: 24,
      19: 10,  // MOSI
      21: 9,   // MISO
      22: 25,
      23: 11,  // SCLK
      24: 8,   // CE0
      26: 7,   // CE1
      27: 0,   // ID_SD
      28: 1,   // ID_SC
      29: 5,
      31: 6,
      32: 12,  // PWM0
      33: 13,  // PWM1
      35: 19,
      36: 16,
      37: 26,
      38: 20,
      40: 21
    }
  },
  'raspberry_pi_zero': {
    name: "Raspberry Pi Zero / Zero W",
    pins: {
      3: 2,    // SDA1
      5: 3,    // SCL1
      7: 4,    // GPCLK0
      8: 14,   // TXD0
      10: 15,  // RXD0
      11: 17,
      12: 18,
      13: 27,
      15: 22,
      16: 23,
      18: 24,
      19: 10,  // MOSI
      21: 9,   // MISO
      22: 25,
      23: 11,  // SCLK
      24: 8,   // CE0
      26: 7,   // CE1
      27: 0,   // ID_SD
      28: 1,   // ID_SC
      29: 5,
      31: 6,
      32: 12,
      33: 13,
      35: 19,
      36: 16,
      37: 26,
      38: 20,
      40: 21
    }
  }
};

// Reverse mapping: BCM GPIO → physical pin (for backward compatibility with old configs)
function buildReverseMap() {
  const reverse = {};
  for (const [modelKey, modelData] of Object.entries(mappings)) {
    reverse[modelKey] = {};
    for (const [physPin, bcmGpio] of Object.entries(modelData.pins)) {
      reverse[modelKey][bcmGpio] = parseInt(physPin, 10);
    }
  }
  return reverse;
}

const reverseMappings = buildReverseMap();

function getRpiPin(model, physicalPin) {
  if (!mappings[model]) return null;
  return mappings[model].pins[physicalPin] ?? null;
}

function bcmToPhysicalPin(model, bcmGpio) {
  if (!reverseMappings[model]) return null;
  return reverseMappings[model][bcmGpio] ?? null;
}

module.exports = { mappings, getRpiPin, bcmToPhysicalPin };
