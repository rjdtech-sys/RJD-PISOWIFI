const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./auth');

const dbPath = path.resolve(__dirname, '../pisowifi.sqlite');
const db = new sqlite3.Database(dbPath);

// Database files configuration
const DATA_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILES = {
  sales: path.join(DATA_DIR, 'sales.sqlite'),
  network: path.join(DATA_DIR, 'network.sqlite'),
  devices: path.join(DATA_DIR, 'devices.sqlite'),
  hardware: path.join(DATA_DIR, 'hardware.sqlite')
};

// Table to Database Mapping
// If a table is not listed here, it stays in 'main' (pisowifi.sqlite)
const TABLE_MAPPING = {
  // Sales & Vouchers
  'sales': 'sales',
  'vouchers': 'sales',
  'rates': 'sales',
  'pppoe_sales': 'sales',

  // Network
  'vlans': 'network',
  'bridges': 'network',
  'multi_wan_config': 'network',
  'pppoe_server': 'network',
  'pppoe_users': 'network',
  'pppoe_profiles': 'network',
  'pppoe_billing_profiles': 'network',
  'pppoe_pools': 'network',
  'pppoe_invoices': 'network',
  'gaming_rules': 'network',

  // Devices & Sessions
  'wifi_devices': 'devices',
  'device_sessions': 'devices',
  'sessions': 'devices',

  // Hardware
  'wireless_settings': 'hardware',
  'hotspots': 'hardware',
};

const run = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const all = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const get = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const close = () => {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Helper to get qualified table name (e.g., 'sales.vouchers')
const getQualifiedTableName = (tableName) => {
  const targetDb = TABLE_MAPPING[tableName] || 'main';
  return targetDb === 'main' ? tableName : `${targetDb}.${tableName}`;
};

async function createTable(tableName, schemaBody) {
  const targetDb = TABLE_MAPPING[tableName] || 'main';
  const qualifiedName = getQualifiedTableName(tableName);
  
  // Migration Logic: Check if table exists in MAIN but belongs to ATTACHED
  if (targetDb !== 'main') {
    try {
      const mainExists = await get(`SELECT name FROM main.sqlite_master WHERE type='table' AND name='${tableName}'`);
      if (mainExists) {
        console.log(`[DB] Migrating table '${tableName}' from main to '${targetDb}'...`);
        
        // 1. Create table in target DB
        await run(`CREATE TABLE IF NOT EXISTS ${qualifiedName} ${schemaBody}`);
        
        // 2. Copy data
        // Check if table is empty before copying to avoid duplicates if migration partially failed before
        const targetCount = await get(`SELECT count(*) as count FROM ${qualifiedName}`);
        if (targetCount.count === 0) {
           await run(`INSERT INTO ${qualifiedName} SELECT * FROM main.${tableName}`);
           console.log(`[DB] Data copied for '${tableName}'`);
        } else {
           console.log(`[DB] Target table '${qualifiedName}' not empty, skipping data copy.`);
        }
        
        // 3. Drop from main
        // await run(`DROP TABLE main.${tableName}`); // DISABLED for safety during first run, user can delete manually or we uncomment later
        // Actually, we should rename it to backup just in case
        await run(`ALTER TABLE main.${tableName} RENAME TO backup_${tableName}_migrated`);
        console.log(`[DB] Original table renamed to 'backup_${tableName}_migrated'`);
        return;
      }
    } catch (e) {
      console.error(`[DB] Migration check failed for ${tableName}:`, e.message);
    }
  }
  
  await run(`CREATE TABLE IF NOT EXISTS ${qualifiedName} ${schemaBody}`);
}

async function factoryResetDB() {
  const tables = [
    'rates', 'sessions', 'config', 'hotspots', 'wireless_settings', 
    'wifi_devices', 'device_sessions', 'vlans', 'bridges', 
    'pppoe_server', 'pppoe_users', 'pppoe_profiles', 'pppoe_billing_profiles', 'pppoe_pools',
    'chat_messages', 'gaming_rules', 'vouchers', 'license_info', 'multi_wan_config', 'admin',
    'sales'
  ];
  
  // Truncate admin_sessions instead of dropping
  try {
    await run('DELETE FROM admin_sessions');
  } catch (e) {}

  for (const table of tables) {
    const qualified = getQualifiedTableName(table);
    await run(`DROP TABLE IF EXISTS ${qualified}`);
  }
  await init();
}

async function init() {
  console.log('[DB] Initializing database system...');
  
  // 1. Attach Databases
  for (const [alias, filePath] of Object.entries(DB_FILES)) {
    try {
      // Check if file exists, if not sqlite creates it
      await run(`ATTACH DATABASE '${filePath}' AS ${alias}`);
    } catch (e) {
      if (!e.message.includes('already in use')) {
        console.error(`[DB] Failed to attach ${alias}:`, e.message);
      }
    }
  }

  // 2. Create Tables (Using helper for migration support)
  
  // --- SALES DB ---
  await createTable('rates', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pesos INTEGER,
    minutes INTEGER,
    expiration_hours INTEGER,
    is_pausable INTEGER DEFAULT 1,
    download_limit INTEGER DEFAULT 0,
    upload_limit INTEGER DEFAULT 0
  )`);

  await createTable('sales', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT,
    ip TEXT,
    amount INTEGER,
    minutes INTEGER,
    type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    machine_id TEXT
  )`);

  await createTable('pppoe_sales', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_number TEXT,
    username TEXT NOT NULL,
    billing_profile_id INTEGER,
    billing_profile_name TEXT,
    profile_name TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'PHP',
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT
  )`);

  await createTable('vouchers', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    time_minutes INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    used_by_mac TEXT,
    used_by_ip TEXT,
    is_used INTEGER DEFAULT 0,
    created_by TEXT
  )`);
  
  // --- DEVICES DB ---
  await createTable('sessions', `(
    mac TEXT PRIMARY KEY,
    ip TEXT,
    remaining_seconds INTEGER,
    total_paid INTEGER,
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    download_limit INTEGER DEFAULT 0,
    upload_limit INTEGER DEFAULT 0,
    token TEXT,
    is_paused INTEGER DEFAULT 0,
    pausable INTEGER DEFAULT 1,
    expired_at DATETIME,
    updated_at DATETIME
  )`);

  await createTable('wifi_devices', `(
    id TEXT PRIMARY KEY,
    mac TEXT NOT NULL,
    ip TEXT NOT NULL,
    hostname TEXT,
    interface TEXT NOT NULL,
    ssid TEXT,
    signal INTEGER DEFAULT 0,
    connected_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    session_time INTEGER,
    is_active INTEGER DEFAULT 0,
    custom_name TEXT,
    credit_pesos INTEGER DEFAULT 0,
    credit_minutes INTEGER DEFAULT 0,
    download_limit INTEGER DEFAULT 0,
    upload_limit INTEGER DEFAULT 0
  )`);

  await createTable('device_sessions', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER DEFAULT 0,
    data_used INTEGER DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES wifi_devices(id)
  )`);

  // --- HARDWARE DB ---
  await createTable('hotspots', `(
    interface TEXT PRIMARY KEY,
    ip_address TEXT,
    dhcp_range TEXT,
    bandwidth_limit INTEGER,
    enabled INTEGER DEFAULT 0
  )`);

  await createTable('wireless_settings', `(
    interface TEXT PRIMARY KEY,
    ssid TEXT,
    password TEXT,
    channel INTEGER DEFAULT 1,
    hw_mode TEXT DEFAULT 'g',
    bridge TEXT
  )`);

  // --- NETWORK DB ---
  await createTable('vlans', `(
    name TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    id INTEGER NOT NULL
  )`);

  await createTable('bridges', `(
    name TEXT PRIMARY KEY,
    members TEXT NOT NULL, -- JSON array of interface names
    stp INTEGER DEFAULT 0
  )`);

  await createTable('multi_wan_config', `(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'pcc', -- 'pcc' or 'ecmp'
    pcc_method TEXT DEFAULT 'both_addresses', -- 'both_addresses', 'both_addresses_ports'
    interfaces TEXT DEFAULT '[]' -- JSON array of interfaces
  )`);

  await createTable('gaming_rules', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL, -- 'tcp', 'udp', 'both'
    port_start INTEGER NOT NULL,
    port_end INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1
  )`);

  await createTable('pppoe_server', `(
    interface TEXT PRIMARY KEY,
    local_ip TEXT NOT NULL,
    ip_pool_start TEXT NOT NULL,
    ip_pool_end TEXT NOT NULL,
    dns1 TEXT DEFAULT '8.8.8.8',
    dns2 TEXT DEFAULT '8.8.4.4',
    service_name TEXT DEFAULT '',
    enabled INTEGER DEFAULT 0
  )`);

  await createTable('pppoe_users', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_number TEXT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    ip_address TEXT,
    billing_profile_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('pppoe_profiles', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rate_limit_dl INTEGER DEFAULT 0,
    rate_limit_ul INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('pppoe_billing_profiles', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES pppoe_profiles(id)
  )`);

  await createTable('pppoe_pools', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_pool_start TEXT NOT NULL,
    ip_pool_end TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('pppoe_invoices', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    account_number TEXT,
    username TEXT NOT NULL,
    billing_profile_id INTEGER,
    billing_profile_name TEXT,
    profile_name TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'PHP',
    period_start DATETIME,
    period_end DATETIME,
    expires_at DATETIME,
    pdf_path TEXT,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- MAIN DB (System) ---
  await createTable('config', `(
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  await createTable('admin', `(
    username TEXT PRIMARY KEY,
    password_hash TEXT,
    salt TEXT
  )`);

  await createTable('admin_sessions', `(
    token TEXT PRIMARY KEY,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  )`);

  await createTable('chat_messages', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    recipient TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  )`);

  await createTable('license_info', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hardware_id TEXT UNIQUE NOT NULL,
    license_key TEXT,
    is_active INTEGER DEFAULT 0,
    is_revoked INTEGER DEFAULT 0,
    activated_at DATETIME,
    expires_at DATETIME,
    trial_started_at DATETIME,
    trial_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 3. Post-Creation Migrations (Column additions for existing tables)
  // Helper to safely run ALTER TABLE on correct DB
  const safeAlter = async (tableName, sqlSuffix) => {
    const qualified = getQualifiedTableName(tableName);
    try {
      await run(`ALTER TABLE ${qualified} ${sqlSuffix}`);
    } catch (e) {
      // Ignore "duplicate column name" error
    }
  };

  // Rates
  await safeAlter('rates', "ADD COLUMN expiration_hours INTEGER");

  await safeAlter('pppoe_users', "ADD COLUMN expires_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN expired_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN last_billed_at DATETIME");
  await safeAlter('rates', "ADD COLUMN is_pausable INTEGER DEFAULT 1");
  await safeAlter('rates', "ADD COLUMN download_limit INTEGER DEFAULT 0");
  await safeAlter('rates', "ADD COLUMN upload_limit INTEGER DEFAULT 0");

  // Sessions
  await safeAlter('sessions', "ADD COLUMN token TEXT");
  await safeAlter('sessions', "ADD COLUMN pausable INTEGER DEFAULT 1");
  await safeAlter('sessions', "ADD COLUMN is_paused INTEGER DEFAULT 0");
  await safeAlter('sessions', "ADD COLUMN expired_at DATETIME");
  await safeAlter('sessions', "ADD COLUMN updated_at DATETIME");
  await safeAlter('sessions', "ADD COLUMN download_limit INTEGER DEFAULT 0");
  await safeAlter('sessions', "ADD COLUMN upload_limit INTEGER DEFAULT 0");

  // Wifi Devices
  await safeAlter('wifi_devices', "ADD COLUMN credit_pesos INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN credit_minutes INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN download_limit INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN upload_limit INTEGER DEFAULT 0");

  // Wireless Settings
  await safeAlter('wireless_settings', "ADD COLUMN bridge TEXT");

  // License Info
  await safeAlter('license_info', "ADD COLUMN is_revoked INTEGER DEFAULT 0");
  await safeAlter('license_info', "ADD COLUMN expires_at DATETIME");

  // PPPoE Users
  await safeAlter('pppoe_users', "ADD COLUMN billing_profile_id INTEGER");
  await safeAlter('pppoe_users', "ADD COLUMN account_number TEXT");
  await safeAlter('pppoe_users', "ADD COLUMN is_online INTEGER DEFAULT 0");
  await safeAlter('pppoe_users', "ADD COLUMN last_online_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN last_offline_at DATETIME");

  // 4. Seeding Defaults
  const gamingRulesCount = await get(`SELECT COUNT(*) as count FROM ${getQualifiedTableName('gaming_rules')}`);
  if (gamingRulesCount.count === 0) {
    console.log('[DB] Seeding default gaming rules...');
    const defaultRules = [
      { name: 'Mobile Legends', protocol: 'both', port_start: 30000, port_end: 30300 },
      { name: 'Mobile Legends (Voice)', protocol: 'udp', port_start: 5000, port_end: 5200 },
      { name: 'Call of Duty Mobile', protocol: 'udp', port_start: 7000, port_end: 9000 },
      { name: 'PUBG Mobile', protocol: 'udp', port_start: 10000, port_end: 20000 },
      { name: 'League of Legends: Wild Rift', protocol: 'both', port_start: 10001, port_end: 10010 },
      { name: 'Roblox', protocol: 'udp', port_start: 49152, port_end: 65535 }
    ];

    for (const rule of defaultRules) {
      await run(`INSERT INTO ${getQualifiedTableName('gaming_rules')} (name, protocol, port_start, port_end, enabled) VALUES (?, ?, ?, ?, ?)`, 
        [rule.name, rule.protocol, rule.port_start, rule.port_end, 1]);
    }
  }

  // Create Admin
  const { salt, hash } = hashPassword('admin');
  await run(`INSERT OR IGNORE INTO admin (username, password_hash, salt) VALUES (?, ?, ?)`, ['admin', hash, salt]);

  // Seed Config
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('boardType', 'raspberry_pi')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('coinPin', '2')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('qos_discipline', 'cake')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('serialPort', '/dev/ttyUSB0')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('espIpAddress', '192.168.4.1')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('espPort', '80')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('coinSlots', '[]')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('nodemcuDevices', '[]')`);
  await run(`INSERT OR IGNORE INTO multi_wan_config (id, enabled, mode, pcc_method, interfaces) VALUES (1, 0, 'pcc', 'both_addresses', '[]')`);

  // Indexes for Vouchers (qualified)
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_code ON vouchers(code)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_is_used ON vouchers(is_used)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_created_at ON vouchers(created_at)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_used_at ON vouchers(used_at)`);
  } catch (e) {
    // console.log(e);
  }

  console.log('[DB] Initialization complete.');
}

module.exports = { run, all, get, factoryResetDB, init, close };
