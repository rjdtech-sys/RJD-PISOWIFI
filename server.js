require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const si = require('systeminformation');
const db = require('./lib/db');
const { initGPIO, updateGPIO, registerSlotCallback, unregisterSlotCallback, setRelayState } = require('./lib/gpio');
const NodeMCUListener = require('./lib/nodemcu-listener');
const { getNodeMCULicenseManager } = require('./lib/nodemcu-license');
const network = require('./lib/network');
const { verifyPassword, hashPassword } = require('./lib/auth');
const crypto = require('crypto');
const multer = require('multer');
const edgeSync = require('./lib/edge-sync');
const settings = require('./lib/settings');
const AdmZip = require('adm-zip');
const { generatePPPoEInvoicePdf } = require('./lib/pppoe-billing');
const { generatePPPoEUserFormPdf } = require('./lib/pppoe-user-form');
const { generatePPPoESaleReceiptPdf } = require('./lib/pppoe-sale-receipt');
const mikrotikReadonly = require('./lib/mikrotik-readonly');

const PPPoE_BILLING_DIR = path.resolve(__dirname, 'data', 'billing', 'pppoe');
const PPPoE_FORMS_DIR = path.resolve(__dirname, 'data', 'forms', 'pppoe');
const PPPoE_RECEIPTS_DIR = path.resolve(__dirname, 'data', 'receipts', 'pppoe');

let pppoeExpiredPool = null;
let pppoeExpiredRedirectIp = '';

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function getClientIpV4(req) {
  const raw = (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : req.socket?.remoteAddress) || '';
  const ip = String(raw).trim();
  const m = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return m ? m[1] : null;
}

function isIpInRange(ip, start, end) {
  const n = ipToInt(ip);
  const a = ipToInt(start);
  const b = ipToInt(end);
  if (n === null || a === null || b === null) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return n >= lo && n <= hi;
}

function isValidIpv4(ip) {
  const s = String(ip || '').trim();
  if (!s) return false;
  const m = s.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!m) return false;
  return s.split('.').every(p => {
    const n = parseInt(p, 10);
    return n >= 0 && n <= 255;
  });
}

function getPppoeExpiredPortalUrl() {
  if (isValidIpv4(pppoeExpiredRedirectIp)) return `http://${pppoeExpiredRedirectIp}/error.html`;
  return '/error.html';
}

async function refreshPPPoEExpiredSettings() {
  try {
    const poolIdRow = await db.get('SELECT value FROM config WHERE key = ?', ['pppoe_expired_pool_id']).catch(() => null);
    const redirectIpRow = await db.get('SELECT value FROM config WHERE key = ?', ['pppoe_expired_redirect_ip']).catch(() => null);
    pppoeExpiredRedirectIp = redirectIpRow?.value ? String(redirectIpRow.value).trim() : '';
    const poolId = poolIdRow?.value ? parseInt(String(poolIdRow.value), 10) : null;
    if (!poolId || Number.isNaN(poolId)) {
      pppoeExpiredPool = null;
      return;
    }
    const pool = await db.get('SELECT * FROM pppoe_pools WHERE id = ?', [poolId]).catch(() => null);
    if (!pool) {
      pppoeExpiredPool = null;
      return;
    }
    pppoeExpiredPool = { id: pool.id, ip_pool_start: pool.ip_pool_start, ip_pool_end: pool.ip_pool_end, name: pool.name };
  } catch (e) {
    pppoeExpiredPool = null;
    pppoeExpiredRedirectIp = '';
  }
}

// PREVENT PROCESS TERMINATION ON TERMINAL DISCONNECT
process.on('SIGHUP', () => {
  console.log('[SYSTEM] Received SIGHUP. Ignoring to prevent process termination on disconnect.');
});

// GLOBAL ERROR HANDLERS TO PREVENT CRASHES
process.on('uncaughtException', (err) => {
  console.error('[SYSTEM] Uncaught Exception:', err);
  // Ignore ECONNRESET and other network errors that shouldn't crash the server
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT') {
    console.warn(`[SYSTEM] Network error (${err.code}) ignored to maintain uptime.`);
    return;
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SYSTEM] Unhandled Rejection at:', promise, 'reason:', reason);
  // No exit here, just log
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UNAUTH_LOG_TTL_MS = 5 * 60 * 1000;
const unauthSeen = new Map();
const AUTO_RESTORE_TTL_MS = 10 * 1000;
const autoRestoreSeen = new Map();

function getSessionToken(req) {
  const headerToken = req.headers['x-session-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.split(' ')[1];
    if (t && t.trim()) return t.trim();
  }
  const cookieToken = getCookie(req, 'ajc_session_token');
  return cookieToken || null;
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map(s => s.trim());
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > -1) {
      const k = part.substring(0, eq);
      const v = part.substring(eq + 1);
      if (k === name) return v;
    }
  }
  return null;
}

// DEBUG LOGGING MIDDLEWARE
app.use(express.json()); // Ensure JSON body parsing is early
app.post('/api/debug/log', (req, res) => {
  const { message, level = 'INFO', component = 'Frontend' } = req.body;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
  
  // ANSI Colors
  const colors = {
    INFO: '\x1b[36m', // Cyan
    WARN: '\x1b[33m', // Yellow
    ERROR: '\x1b[31m', // Red
    SUCCESS: '\x1b[32m', // Green
    RESET: '\x1b[0m'
  };

  const color = colors[level.toUpperCase()] || colors.INFO;
  console.log(`${color}[${timestamp}] [${component}] ${message}${colors.RESET}`);
  
  res.status(200).send('Logged');
});

io.on('connection', (socket) => {
  socket.on('join_chat', (data) => {
    if (data && data.id) {
      socket.join(data.id);
    }
  });

  socket.on('send_message', async (data) => {
    const { sender, recipient, message } = data;
    const timestamp = new Date().toISOString();
    const msgData = { ...data, timestamp };

    try {
      await db.run(
        'INSERT INTO chat_messages (sender, recipient, message, timestamp) VALUES (?, ?, ?, ?)',
        [sender, recipient, message, timestamp]
      );
      
      // Emit to specific recipient
      io.to(recipient).emit('receive_message', msgData);
      
      // Emit back to sender (so they see their own message)
      socket.emit('receive_message', msgData);
      
      // If user sends to admin, notify all admins
      if (recipient === 'admin') {
        io.to('admin').emit('receive_message', msgData);
      }
      
      // If broadcast, emit to everyone
      if (recipient === 'broadcast') {
        io.emit('receive_message', msgData);
      }
    } catch (err) {
      console.error('Error saving chat message:', err);
    }
  });

  socket.on('fetch_messages', async (data) => {
    const { user_id } = data; // MAC address of the user
    try {
      // Fetch messages between this user and admin, PLUS broadcasts
      const messages = await db.all(
        `SELECT * FROM chat_messages 
         WHERE (sender = ? AND recipient = 'admin') 
            OR (sender = 'admin' AND recipient = ?) 
            OR recipient = 'broadcast' 
         ORDER BY timestamp ASC`,
        [user_id, user_id]
      );
      socket.emit('chat_history', messages);
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  });
  
  // Admin fetches list of users who have chatted
  socket.on('fetch_chat_users', async () => {
    try {
      const users = await db.all(
        `SELECT DISTINCT sender as mac, MAX(timestamp) as last_message 
         FROM chat_messages 
         WHERE sender != 'admin' 
         GROUP BY sender 
         ORDER BY last_message DESC`
      );
      socket.emit('chat_users', users);
    } catch (err) {
      console.error('Error fetching chat users:', err);
    }
  });
});

const COINSLOT_LOCK_TTL_MS = 60 * 1000;
const coinSlotLocks = new Map();

function normalizeCoinSlot(slot) {
  if (!slot || typeof slot !== 'string') return null;
  if (slot === 'main') return 'main';
  return slot.trim().toUpperCase();
}

function cleanupExpiredCoinSlotLocks() {
  const now = Date.now();
  for (const [slot, lock] of coinSlotLocks.entries()) {
    if (!lock || typeof lock.expiresAt !== 'number' || lock.expiresAt <= now) {
      if (slot === 'main') {
        try { setRelayState(false); } catch (e) {}
      }
      coinSlotLocks.delete(slot);
    }
  }
}

setInterval(cleanupExpiredCoinSlotLocks, 30_000).unref?.();

// Configure Multer for Audio Uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/audio/';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, name + '_' + Date.now() + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  }
});

// Configure Multer for Firmware Updates
const firmwareStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/firmware/';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, 'firmware_' + Date.now() + '.bin');
  }
});

const uploadFirmware = multer({ 
  storage: firmwareStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for firmware
});

// Configure Multer for System Backups/Updates
const backupStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/backups/';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, 'restore_' + Date.now() + '.nxs');
  }
});

const uploadBackup = multer({ 
  storage: backupStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.nxs')) {
      cb(null, true);
    } else {
      cb(new Error('Only .nxs files are allowed!'), false);
    }
  }
});

const NODEMCU_D_PIN_TO_GPIO = {
  D0: 16,
  D1: 5,
  D2: 4,
  D3: 0,
  D4: 2,
  D5: 14,
  D6: 12,
  D7: 13,
  D8: 15
};

const NODEMCU_GPIO_TO_D_PIN = Object.fromEntries(
  Object.entries(NODEMCU_D_PIN_TO_GPIO).map(([dPin, gpio]) => [String(gpio), dPin])
);

function normalizeNodeMcuDPinLabel(label) {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim().toUpperCase();
  return NODEMCU_D_PIN_TO_GPIO[trimmed] !== undefined ? trimmed : null;
}

function nodeMcuDPinLabelToGpio(label) {
  const normalized = normalizeNodeMcuDPinLabel(label);
  if (!normalized) return null;
  return NODEMCU_D_PIN_TO_GPIO[normalized];
}

function nodeMcuGpioToDPinLabel(gpio) {
  const key = String(gpio);
  return NODEMCU_GPIO_TO_D_PIN[key] || null;
}

async function pushNodeMCUPinsToDevice(device, { coinPinGpio, relayPinGpio }) {
  if (!device?.ipAddress) {
    return { ok: false, error: 'Device IP address not found' };
  }

  const http = require('http');
  const body = new URLSearchParams({
    key: String(device.authenticationKey || ''),
    coinPin: String(coinPinGpio),
    relayPin: String(relayPinGpio)
  }).toString();

  return await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: device.ipAddress,
        port: 80,
        path: '/api/pins',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 4000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: `Device rejected pin update (${res.statusCode || 0}) ${data}`.trim() });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Pin push timed out'));
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err?.message || String(err) });
    });
    req.write(body);
    req.end();
  });
}

app.use(express.json());

// Prevent caching of API responses
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ADMIN AUTHENTICATION
const requireAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const session = await db.get('SELECT * FROM admin_sessions WHERE token = ?', [token]);
    
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    // Robust date comparison in JS to avoid SQLite datetime mismatches
    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    
    if (expiresAt < now) {
      // Clean up expired session
      await db.run('DELETE FROM admin_sessions WHERE token = ?', [token]);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    req.adminUser = session.username;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// SUPERADMIN AUTHENTICATION (for license generation and other admin functions)
const requireSuperadmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const session = await db.get('SELECT * FROM admin_sessions WHERE token = ?', [token]);
    
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    // Robust date comparison in JS to avoid SQLite datetime mismatches
    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    
    if (expiresAt < now) {
      // Clean up expired session
      await db.run('DELETE FROM admin_sessions WHERE token = ?', [token]);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    // Check if user is superadmin (for now, we'll use a simple check)
    // In production, you might want to add a role field to admin_sessions table
    const isSuperadmin = session.username === 'admin' || session.username === 'superadmin';
    
    if (!isSuperadmin) {
      return res.status(403).json({ error: 'Superadmin access required' });
    }
    
    req.adminUser = session.username;
    next();
  } catch (err) {
    console.error('Superadmin auth error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await db.get('SELECT * FROM admin WHERE username = ?', [username]);
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (verifyPassword(password, admin.salt, admin.password_hash)) {
      const token = crypto.randomBytes(32).toString('hex');
      // Set expiration to 24 hours
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      await db.run('INSERT INTO admin_sessions (token, username, expires_at) VALUES (?, ?, ?)', 
        [token, username, expiresAt]);
        
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    await db.run('DELETE FROM admin_sessions WHERE token = ?', [token]);
  }
  res.json({ success: true });
});

app.get('/api/admin/check-auth', requireAdmin, (req, res) => {
  res.json({ authenticated: true, username: req.adminUser });
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  
  if (!newPassword || newPassword.length < 5) {
    return res.status(400).json({ error: 'New password must be at least 5 characters long' });
  }

  try {
    const admin = await db.get('SELECT * FROM admin WHERE username = ?', [req.adminUser]);
    
    if (verifyPassword(oldPassword, admin.salt, admin.password_hash)) {
      const { salt, hash } = hashPassword(newPassword);
      await db.run('UPDATE admin SET password_hash = ?, salt = ? WHERE username = ?', [hash, salt, req.adminUser]);
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Current password incorrect' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// THEME MANAGEMENT API
app.get('/api/admin/theme', async (req, res) => {
  try {
    const result = await db.get('SELECT value FROM config WHERE key = ?', ['admin_theme']);
    res.json({ theme: result ? result.value : 'default' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/theme', requireAdmin, async (req, res) => {
  const { theme } = req.body;
  if (!theme) {
    return res.status(400).json({ error: 'Theme ID is required' });
  }
  try {
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['admin_theme', theme]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/custom-themes', async (req, res) => {
  try {
    const result = await db.get('SELECT value FROM config WHERE key = ?', ['admin_custom_themes']);
    res.json({ themes: result ? JSON.parse(result.value) : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/custom-themes', requireAdmin, async (req, res) => {
  const { themes } = req.body;
  if (!Array.isArray(themes)) {
    return res.status(400).json({ error: 'Themes must be an array' });
  }
  try {
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['admin_custom_themes', JSON.stringify(themes)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// COMPANY SETTINGS API
const brandingStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/branding/';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, 'logo-' + Date.now() + ext);
  }
});

const uploadBranding = multer({ storage: brandingStorage });

app.get('/api/settings/company', async (req, res) => {
  try {
    const data = await settings.getCompanySettings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/company', requireAdmin, uploadBranding.single('logo'), async (req, res) => {
  try {
    const { companyName } = req.body;
    let logoPath = null;
    
    if (req.file) {
      logoPath = '/uploads/branding/' + req.file.filename;
    }
    
    const data = await settings.updateCompanySettings(companyName, logoPath);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mikrotik/routers', requireAdmin, async (req, res) => {
  try {
    const rows = await mikrotikReadonly.listRouters();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mikrotik/routers', requireAdmin, async (req, res) => {
  try {
    const { name, host, port, username, password, connection_type, rest_scheme } = req.body || {};
    if (!name || !host || !username || !password) {
      return res.status(400).json({ error: 'name, host, username, and password are required' });
    }
    const row = await mikrotikReadonly.createRouter({ name, host, port, username, password, connection_type, rest_scheme });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mikrotik/routers/:id', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const row = await mikrotikReadonly.updateRouter(id, req.body || {});
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mikrotik/routers/:id', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const result = await mikrotikReadonly.deleteRouter(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mikrotik/routers/:id/test', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const result = await mikrotikReadonly.testRouter(id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mikrotik/routers/test', requireAdmin, async (req, res) => {
  try {
    const { host, port, username, password, connection_type, rest_scheme } = req.body || {};
    if (!host || !username || !password) {
      return res.status(400).json({ error: 'host, username, and password are required' });
    }
    const result = await mikrotikReadonly.testRouterDraft({ host, port, username, password, connection_type, rest_scheme });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mikrotik/routers/:id/billing', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const data = await mikrotikReadonly.fetchBillingData(id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PPPoE Secrets CRUD
app.post('/api/mikrotik/routers/:id/secrets', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    
    console.log('[MikroTik] Creating secret for router:', routerId, 'with data:', req.body);
    
    const result = await mikrotikReadonly.createSecret(routerId, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[MikroTik] Error creating secret:', err);
    res.status(500).json({ error: err.message || 'Failed to create secret' });
  }
});

app.put('/api/mikrotik/routers/:id/secrets/:secretId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const secretId = String(req.params.secretId || '');
    if (!routerId || !secretId) return res.status(400).json({ error: 'Invalid ids' });
    const result = await mikrotikReadonly.updateSecret(routerId, secretId, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mikrotik/routers/:id/secrets/:secretId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const secretId = String(req.params.secretId || '');
    if (!routerId || !secretId) return res.status(400).json({ error: 'Invalid ids' });
    const result = await mikrotikReadonly.deleteSecret(routerId, secretId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PPPoE Profiles CRUD
// PPPoE Profiles CRUD
app.get('/api/mikrotik/routers/:id/profiles', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    
    const router = await db.get('SELECT * FROM mikrotik_routers WHERE id = ?', [routerId]);
    if (!router) return res.status(404).json({ error: 'Router not found' });
    
    const profiles = await mikrotikReadonly.getProfiles(routerId);
    res.json(profiles || []);
  } catch (err) {
    console.error('[MikroTik] Error fetching profiles:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mikrotik/routers/:id/profiles', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    const result = await mikrotikReadonly.createProfile(routerId, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mikrotik/routers/:id/profiles/:profileId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const profileId = String(req.params.profileId || '');
    if (!routerId || !profileId) return res.status(400).json({ error: 'Invalid ids' });
    const result = await mikrotikReadonly.updateProfile(routerId, profileId, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mikrotik/routers/:id/profiles/:profileId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const profileId = String(req.params.profileId || '');
    if (!routerId || !profileId) return res.status(400).json({ error: 'Invalid ids' });
    const result = await mikrotikReadonly.deleteProfile(routerId, profileId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PPPoE Active Sessions
app.delete('/api/mikrotik/routers/:id/active/:activeId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const activeId = String(req.params.activeId || '');
    if (!routerId || !activeId) return res.status(400).json({ error: 'Invalid ids' });
    const result = await mikrotikReadonly.disconnectActive(routerId, activeId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Billing Plans CRUD
app.get('/api/mikrotik/routers/:id/billing-plans', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    const plans = await db.all(
      'SELECT * FROM mikrotik_billing_plans WHERE router_id = ? ORDER BY created_at DESC',
      [routerId]
    );
    res.json(plans || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mikrotik/routers/:id/billing-plans', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    
    const { plan_name, pppoe_profile, price, currency, is_active } = req.body || {};
    if (!plan_name || !pppoe_profile || price === undefined) {
      return res.status(400).json({ error: 'Plan name, PPPoE profile, and price are required' });
    }
    
    const id = require('crypto').randomUUID();
    await db.run(
      'INSERT INTO mikrotik_billing_plans (id, router_id, plan_name, pppoe_profile, price, currency, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, routerId, plan_name, pppoe_profile, price, currency || 'PHP', is_active !== undefined ? is_active : 1]
    );
    
    const plan = await db.get('SELECT * FROM mikrotik_billing_plans WHERE id = ?', [id]);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mikrotik/routers/:id/billing-plans/:planId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const planId = String(req.params.planId || '');
    if (!routerId || !planId) return res.status(400).json({ error: 'Invalid ids' });
    
    const { plan_name, pppoe_profile, price, currency, is_active } = req.body || {};
    const fields = [];
    const values = [];
    
    if (plan_name !== undefined) { fields.push('plan_name = ?'); values.push(plan_name); }
    if (pppoe_profile !== undefined) { fields.push('pppoe_profile = ?'); values.push(pppoe_profile); }
    if (price !== undefined) { fields.push('price = ?'); values.push(price); }
    if (currency !== undefined) { fields.push('currency = ?'); values.push(currency); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(planId);
    
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    
    await db.run(`UPDATE mikrotik_billing_plans SET ${fields.join(', ')} WHERE id = ? AND router_id = ?`, [...values, routerId]);
    const plan = await db.get('SELECT * FROM mikrotik_billing_plans WHERE id = ?', [planId]);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mikrotik/routers/:id/billing-plans/:planId', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    const planId = String(req.params.planId || '');
    if (!routerId || !planId) return res.status(400).json({ error: 'Invalid ids' });
    
    await db.run('DELETE FROM mikrotik_billing_plans WHERE id = ? AND router_id = ?', [planId, routerId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment Processing
app.post('/api/mikrotik/routers/:id/process-payment', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    
    const { 
      secret_id, 
      username, 
      billing_plan_id, 
      plan_name, 
      amount,
      original_amount,
      num_months,
      discount_days,
      discount_amount,
      currency,
      payment_date,
      next_duedate,
      expired_profile,
      payment_method,
      notes 
    } = req.body || {};
    
    if (!secret_id || !username || !amount || !payment_date || !next_duedate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = require('crypto').randomUUID();
    
    console.log('[MikroTik Payment] Processing payment:', {
      id,
      routerId,
      username,
      amount,
      num_months,
      payment_date,
      next_duedate
    });
    
    // Save payment record with discount info
    await db.run(
      'INSERT INTO mikrotik_sales (id, router_id, secret_id, username, billing_plan_id, plan_name, amount, original_amount, num_months, discount_days, discount_amount, currency, payment_date, next_duedate, expired_profile, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, routerId, secret_id, username, billing_plan_id, plan_name, amount, original_amount || amount, num_months || 1, discount_days || 0, discount_amount || 0, currency || 'PHP', payment_date, next_duedate, expired_profile, payment_method || 'cash', notes || '']
    );
    
    console.log('[MikroTik Payment] Payment record saved to database');
    
    // Update or insert due date in mikrotik_secret_duedates
    const dueDateId = require('crypto').randomUUID();
    await db.run(
      'INSERT OR REPLACE INTO mikrotik_secret_duedates (id, router_id, secret_id, username, duedate, expired_profile) VALUES (?, ?, ?, ?, ?, ?)',
      [dueDateId, routerId, secret_id, username, next_duedate, expired_profile || '']
    ).catch(err => console.error('[MikroTik] Failed to update due date:', err));
    console.log('[MikroTik Payment] Due date updated for:', username);
    
    // Update PPPoE secret profile back to billing plan profile
    await mikrotikReadonly.updateSecret(routerId, secret_id, {
      profile: req.body.pppoe_profile,
      disabled: 'false'
    });
    
    // Update or create scheduler with new due date
    const schedulerName = `expire_${username}`;
    
    // Try to delete existing scheduler first
    try {
      await mikrotikReadonly.deleteScheduler(routerId, schedulerName);
    } catch (err) {
      console.log('[MikroTik] Scheduler not found or already deleted:', schedulerName);
    }
    
    // Create new scheduler with new due date
    if (next_duedate && expired_profile) {
      await mikrotikReadonly.createScheduler(routerId, schedulerName, username, expired_profile, next_duedate);
    }
    
    const sale = await db.get('SELECT * FROM mikrotik_sales WHERE id = ?', [id]);
    res.json({ success: true, data: sale });
  } catch (err) {
    console.error('[MikroTik] Payment processing error:', err);
    res.status(500).json({ error: err.message || 'Failed to process payment' });
  }
});

// Sales Report
app.get('/api/mikrotik/routers/:id/sales', requireAdmin, async (req, res) => {
  try {
    const routerId = String(req.params.id || '');
    if (!routerId) return res.status(400).json({ error: 'Invalid router id' });
    
    console.log('[MikroTik Sales] Fetching sales for router:', routerId);
    
    const { start_date, end_date } = req.query;
    
    let query = 'SELECT * FROM mikrotik_sales WHERE router_id = ?';
    const params = [routerId];
    
    if (start_date) {
      query += ' AND payment_date >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      query += ' AND payment_date <= ?';
      params.push(end_date);
    }
    
    query += ' ORDER BY payment_date DESC';
    
    console.log('[MikroTik Sales] Query:', query, 'Params:', params);
    
    const sales = await db.all(query, params);
    console.log('[MikroTik Sales] Found', sales ? sales.length : 0, 'sales');
    
    res.json(sales || []);
  } catch (err) {
    console.error('[MikroTik Sales] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update Sales Record
app.put('/api/mikrotik/sales/:saleId', requireAdmin, async (req, res) => {
  try {
    const saleId = String(req.params.saleId || '');
    if (!saleId) return res.status(400).json({ error: 'Invalid sale id' });
    
    const {
      username,
      plan_name,
      amount,
      original_amount,
      num_months,
      discount_days,
      discount_amount,
      payment_date,
      next_duedate,
      payment_method,
      notes
    } = req.body || {};
    
    console.log('[MikroTik Sales] Updating sale:', saleId);
    
    await db.run(
      'UPDATE mikrotik_sales SET username = ?, plan_name = ?, amount = ?, original_amount = ?, num_months = ?, discount_days = ?, discount_amount = ?, payment_date = ?, next_duedate = ?, payment_method = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [username, plan_name, amount, original_amount, num_months, discount_days, discount_amount, payment_date, next_duedate, payment_method, notes, saleId]
    );
    
    // Also update the duedate in mikrotik_secret_duedates if username exists
    if (username && next_duedate) {
      const sale = await db.get('SELECT router_id, secret_id, expired_profile FROM mikrotik_sales WHERE id = ?', [saleId]);
      if (sale) {
        const dueDateId = require('crypto').randomUUID();
        await db.run(
          'INSERT OR REPLACE INTO mikrotik_secret_duedates (id, router_id, secret_id, username, duedate, expired_profile) VALUES (?, ?, ?, ?, ?, ?)',
          [dueDateId, sale.router_id, sale.secret_id, username, next_duedate, sale.expired_profile || '']
        ).catch(err => console.error('[MikroTik] Failed to update due date:', err));
      }
    }
    
    const updatedSale = await db.get('SELECT * FROM mikrotik_sales WHERE id = ?', [saleId]);
    res.json({ success: true, data: updatedSale });
  } catch (err) {
    console.error('[MikroTik Sales] Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete Sales Record
app.delete('/api/mikrotik/sales/:saleId', requireAdmin, async (req, res) => {
  try {
    const saleId = String(req.params.saleId || '');
    if (!saleId) return res.status(400).json({ error: 'Invalid sale id' });
    
    console.log('[MikroTik Sales] Deleting sale:', saleId);
    
    await db.run('DELETE FROM mikrotik_sales WHERE id = ?', [saleId]);
    
    res.json({ success: true, message: 'Sale record deleted' });
  } catch (err) {
    console.error('[MikroTik Sales] Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get Single Sale Record
app.get('/api/mikrotik/sales/:saleId', requireAdmin, async (req, res) => {
  try {
    const saleId = String(req.params.saleId || '');
    if (!saleId) return res.status(400).json({ error: 'Invalid sale id' });
    
    const sale = await db.get('SELECT * FROM mikrotik_sales WHERE id = ?', [saleId]);
    
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    res.json(sale);
  } catch (err) {
    console.error('[MikroTik Sales] Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// LICENSE MANAGEMENT API
app.get('/api/license/status', async (req, res) => {
  try {
    if (!systemHardwareId) {
      systemHardwareId = await getUniqueHardwareId();
    }

    const verification = await licenseManager.verifyLicense();
    const trialStatus = await checkTrialStatus(systemHardwareId, verification);

    const isLicensed = verification.isValid && verification.isActivated;
    const isRevoked = verification.isRevoked || trialStatus.isRevoked;
    const canOperate = (isLicensed || trialStatus.isTrialActive) && !isRevoked;

    res.json({
      hardwareId: systemHardwareId,
      isLicensed,
      isRevoked,
      hasHadLicense: trialStatus.hasHadLicense || false,
      licenseKey: verification.licenseKey,
      trial: {
        isActive: trialStatus.isTrialActive,
        hasEnded: trialStatus.trialEnded,
        daysRemaining: trialStatus.daysRemaining,
        expiresAt: trialStatus.expiresAt
      },
      canOperate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/license/activate', async (req, res) => {
  const { licenseKey } = req.body;
  
  if (!licenseKey || licenseKey.trim().length === 0) {
    return res.status(400).json({ error: 'License key is required' });
  }

  try {
    if (!systemHardwareId) {
      systemHardwareId = await getUniqueHardwareId();
    }

    // Activate on cloud (Supabase)
    const result = await licenseManager.activateDevice(licenseKey.trim());
    
    if (result.success) {
      // Store locally for offline verification
      await storeLocalLicense(systemHardwareId, licenseKey.trim());
      
      res.json({ 
        success: true, 
        message: result.message,
        hardwareId: systemHardwareId
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.message 
      });
    }
  } catch (err) {
    console.error('[License] Activation error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Activation failed: ' + err.message 
    });
  }
});

app.get('/api/license/hardware-id', async (req, res) => {
  try {
    const registrationKeyResult = await db.get('SELECT value FROM config WHERE key = ?', ['registrationKey']);
    // Default to '7B3F1A9' if not set, same as in /api/nodemcu/register
    const key = registrationKeyResult?.value || '7B3F1A9';
    res.json({ hardwareId: key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/license/hardware-id', requireAdmin, async (req, res) => {
  const { hardwareId } = req.body;
  
  if (!hardwareId || !hardwareId.trim()) {
    return res.status(400).json({ error: 'System Auth Key is required' });
  }

  if (hardwareId.length > 63) {
    return res.status(400).json({ error: 'System Auth Key must be 63 characters or less' });
  }

  try {
    // Save to config as 'registrationKey' to match NodeMCU registration logic
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['registrationKey', hardwareId.trim()]);
    
    console.log(`[License] Updated System Auth Key (registrationKey) to: ${hardwareId.trim()}`);
    
    res.json({ 
      success: true, 
      message: 'System Auth Key updated successfully', 
      hardwareId: hardwareId.trim() 
    });
  } catch (err) {
    console.error('[License] Failed to save System Auth Key:', err);
    res.status(500).json({ error: 'Failed to save System Auth Key' });
  }
});

// CLOUD UPDATE MANAGEMENT
app.get('/api/system/updates/pending', requireAdmin, (req, res) => {
  const pendingUpdatePath = path.join(__dirname, 'data/pending_update.json');
  
  if (fs.existsSync(pendingUpdatePath)) {
    try {
      const updateData = JSON.parse(fs.readFileSync(pendingUpdatePath, 'utf8'));
      return res.json({ available: true, update: updateData });
    } catch (e) {
      console.error('Error reading pending update file:', e);
    }
  }
  
  res.json({ available: false });
});

app.post('/api/system/updates/accept', requireAdmin, async (req, res) => {
  const pendingUpdatePath = path.join(__dirname, 'data/pending_update.json');
  
  if (!fs.existsSync(pendingUpdatePath)) {
    return res.status(404).json({ error: 'No pending update found' });
  }

  try {
    const updateCommand = JSON.parse(fs.readFileSync(pendingUpdatePath, 'utf8'));
    
    // Trigger the update process in background
    // We import edgeSync instance and call performSystemUpdate
    // Note: performSystemUpdate is async, but we might want to return immediately
    // or wait a bit to ensure it started.
    
    console.log('[System] User accepted update:', updateCommand.id);
    
    // Delete the pending file so it doesn't show up again
    fs.unlinkSync(pendingUpdatePath);
    
    // Execute update
    edgeSync.performSystemUpdate(updateCommand).catch(err => {
        console.error('[System] Update execution failed:', err);
    });
    
    res.json({ success: true, message: 'Update process started. The system will reboot when finished.' });
    
  } catch (e) {
    console.error('Error accepting update:', e);
    res.status(500).json({ error: 'Failed to start update: ' + e.message });
  }
});

app.post('/api/system/updates/reject', requireAdmin, async (req, res) => {
    const pendingUpdatePath = path.join(__dirname, 'data/pending_update.json');
    
    if (fs.existsSync(pendingUpdatePath)) {
        try {
            const updateCommand = JSON.parse(fs.readFileSync(pendingUpdatePath, 'utf8'));
            // Update status to rejected
             await edgeSync.updateCommandStatus(updateCommand.id, 'rejected', 'User rejected the update from local dashboard.');
             
             fs.unlinkSync(pendingUpdatePath);
             res.json({ success: true });
        } catch(e) {
            res.status(500).json({ error: e.message });
        }
    } else {
        res.json({ success: true }); // Already gone
    }
});

// NodeMCU License Management APIs
const { initializeNodeMCULicenseManager } = require('./lib/nodemcu-license');
const nodeMCULicenseManager = initializeNodeMCULicenseManager();

// NodeMCU License Status Check (with automatic trial assignment)
app.get('/api/nodemcu/license/status/:macAddress', requireAdmin, async (req, res) => {
  try {
    const { macAddress } = req.params;
    console.log(`[NodeMCU License] Checking status for device: ${macAddress}`);
    
    // 1. Always try Supabase first for license verification and automatic trial
    const verification = await nodeMCULicenseManager.verifyLicense(macAddress);
    
    // 2. If valid or activated via Supabase, return it
    if (verification.isValid || verification.isActivated) {
      console.log(`[NodeMCU License] Device ${macAddress} found in Supabase:`, verification);
      return res.json(verification);
    }
    
    // 3. Fallback: Check Local Config for Trial REMOVED - We only support cloud licenses
    /*
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    const device = devices.find(d => d.macAddress === macAddress);
    
    if (device && device.localLicense && device.localLicense.type === 'trial') {
      const now = Date.now();
      const expiresAt = new Date(device.localLicense.expiresAt).getTime();
      const isValid = now < expiresAt;
      const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      
      console.log(`[NodeMCU License] Device ${macAddress} has local trial:`, {
        isValid, daysRemaining, expiresAt: new Date(expiresAt)
      });
      
      return res.json({
        isValid,
        isActivated: true,
        isExpired: !isValid,
        licenseType: 'trial',
        canStartTrial: false,
        expiresAt: new Date(expiresAt),
        daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
        isLocalTrial: true
      });
    }
    */
    
    // 4. If no license found anywhere and can start trial, attempt automatic trial
    if (verification.canStartTrial) {
      console.log(`[NodeMCU License] Device ${macAddress} not found, attempting automatic trial...`);
      
      // Try to start trial automatically
      const trialResult = await nodeMCULicenseManager.startTrial(macAddress);
      
      if (trialResult.success && trialResult.trialInfo) {
        console.log(`[NodeMCU License] Automatic trial started for ${macAddress}`);
        return res.json({
          isValid: true,
          isActivated: true,
          isExpired: false,
          licenseType: 'trial',
          expiresAt: trialResult.trialInfo.expiresAt,
          daysRemaining: trialResult.trialInfo.daysRemaining,
          canStartTrial: false,
          isAutoTrial: true
        });
      }
    }
    
    console.log(`[NodeMCU License] Device ${macAddress} - no license found, trial not available`);
    res.json(verification);
  } catch (err) {
    console.error('[NodeMCU License] Status check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU License Activation
app.post('/api/nodemcu/license/activate', requireAdmin, async (req, res) => {
  try {
    let { licenseKey, macAddress, vendorId } = req.body;
    
    if (!licenseKey || !macAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'License key and MAC address are required' 
      });
    }

    // If vendorId is not provided, try to get it from the machine's identity (EdgeSync)
    let machineId = null;
    const identity = edgeSync.getIdentity();
    
    if (identity) {
      machineId = identity.machineId;
      if (!vendorId && identity.vendorId) {
        vendorId = identity.vendorId;
        console.log(`[NodeMCU License] Using machine vendor ID: ${vendorId}`);
      }
    }

    if (!vendorId) {
      console.warn('[NodeMCU License] Warning: No vendor ID provided and machine is not bound to a vendor.');
    }
    
    console.log(`[NodeMCU License] Activating license ${licenseKey} for ${macAddress} (Vendor: ${vendorId || 'Auth Context'}, Machine: ${machineId || 'Unknown'})`);

    const result = await nodeMCULicenseManager.activateLicense(licenseKey.trim(), macAddress, vendorId, machineId);
    res.json(result);
  } catch (err) {
    console.error('[NodeMCU License] Activation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU License Revocation
app.post('/api/nodemcu/license/revoke', requireAdmin, async (req, res) => {
  try {
    let { licenseKey, vendorId } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'License key is required' 
      });
    }

    // If vendorId is not provided, try to get it from the machine's identity (EdgeSync)
    if (!vendorId) {
      const identity = edgeSync.getIdentity();
      if (identity && identity.vendorId) {
        vendorId = identity.vendorId;
      }
    }

    console.log(`[NodeMCU License] Revoking license ${licenseKey} (Vendor: ${vendorId || 'Auth Context'})`);
    
    const result = await nodeMCULicenseManager.revokeLicense(licenseKey, vendorId);
    res.json(result);
  } catch (err) {
    console.error('[NodeMCU License] Revocation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU Trial Start (Automatic Trial Assignment)
app.post('/api/nodemcu/license/trial', requireAdmin, async (req, res) => {
  try {
    const { macAddress } = req.body;
    
    if (!macAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'MAC address is required' 
      });
    }
    
    console.log(`[NodeMCU License] Starting trial for device: ${macAddress}`);
    
    // 1. Always try Supabase first for automatic trial assignment
    if (nodeMCULicenseManager.isConfigured()) {
      try {
        const result = await nodeMCULicenseManager.startTrial(macAddress);
        
        if (result.success) {
          console.log(`[NodeMCU License] Automatic trial started via Supabase for ${macAddress}`);
          return res.json(result);
        } else {
          console.log(`[NodeMCU License] Supabase trial failed for ${macAddress}:`, result.message);
        }
      } catch (supabaseError) {
        console.error(`[NodeMCU License] Supabase trial error for ${macAddress}:`, supabaseError);
      }
    } else {
      console.log('[NodeMCU License] Supabase not configured, using local fallback');
    }
    
    // 2. Fallback: Start Local Trial if Supabase failed or not configured
    // LOCAL TRIAL FEATURE REMOVED
    console.log('[NodeMCU License] Local trial fallback is disabled. Cloud license required.');
    
    return res.status(403).json({
      success: false,
      message: 'Local trials are disabled. Please register your device in the cloud dashboard to activate a license.'
    });
    
  } catch (err) {
    console.error('[NodeMCU License] Trial start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU License Revocation
app.post('/api/nodemcu/license/revoke', requireAdmin, async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'License key is required' 
      });
    }
    
    const result = await nodeMCULicenseManager.revokeLicense(licenseKey);
    res.json(result);
  } catch (err) {
    console.error('[NodeMCU License] Revocation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU License Generation (Superadmin only)
app.post('/api/nodemcu/license/generate', requireSuperadmin, async (req, res) => {
  try {
    const { count = 1, licenseType = 'standard', expirationMonths } = req.body;
    
    const licenses = await nodeMCULicenseManager.generateLicenses(count, licenseType, expirationMonths);
    res.json({ success: true, licenses });
  } catch (err) {
    console.error('[NodeMCU License] Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU Vendor Licenses
app.get('/api/nodemcu/license/vendor', requireAdmin, async (req, res) => {
  try {
    const cloudLicenses = await nodeMCULicenseManager.getVendorLicenses();

    // Local licenses merging REMOVED - We only show cloud licenses now
    /*
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];

    const localLicenses = devices
      .filter(d => d && d.macAddress && d.localLicense && d.localLicense.type === 'trial')
      .map(d => {
        const expiresAt = d.localLicense.expiresAt;
        return {
          id: `local_trial_${String(d.macAddress).toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
          license_key: `LOCAL-TRIAL-${String(d.macAddress).toUpperCase()}`,
          device_id: d.id,
          device_name: d.name,
          mac_address: d.macAddress,
          is_active: true,
          license_type: 'trial',
          activated_at: d.localLicense.startedAt || null,
          expires_at: expiresAt || null,
          days_remaining: expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null,
          isLocalTrial: true
        };
      });

    const merged = [...(cloudLicenses || [])];
    for (const local of localLicenses) {
      const exists = merged.some(cl => (cl.mac_address || cl.macAddress) === local.mac_address && (cl.license_type || cl.licenseType) === 'trial' && cl.is_active);
      if (!exists) merged.push(local);
    }
    */

    res.json({ success: true, licenses: cloudLicenses || [] });
  } catch (err) {
    console.error('[NodeMCU License] Vendor licenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU Device License Verification (No Auth Required - for NodeMCU devices)
app.post('/api/nodemcu/device/verify', async (req, res) => {
  try {
    const { macAddress, deviceId } = req.body;
    
    if (!macAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'MAC address is required' 
      });
    }
    
    console.log(`[NodeMCU Device] License verification request from: ${macAddress}`);
    
    // Always try Supabase first for license verification and automatic trial
    const verification = await nodeMCULicenseManager.verifyLicense(macAddress);
    
    // If valid or activated, return success
    if (verification.isValid || verification.isActivated) {
      console.log(`[NodeMCU Device] License verified for ${macAddress}:`, {
        isValid: verification.isValid,
        licenseType: verification.licenseType,
        daysRemaining: verification.daysRemaining
      });
      
      return res.json({
        success: true,
        licensed: true,
        licenseType: verification.licenseType,
        expiresAt: verification.expiresAt,
        daysRemaining: verification.daysRemaining,
        isTrial: verification.licenseType === 'trial',
        message: verification.licenseType === 'trial' ? 'Trial mode active' : 'License active'
      });
    }
    
    // If no license found, attempt automatic trial
    if (verification.canStartTrial) {
      console.log(`[NodeMCU Device] No license found for ${macAddress}, attempting automatic trial...`);
      
      const trialResult = await nodeMCULicenseManager.startTrial(macAddress);
      
      if (trialResult.success && trialResult.trialInfo) {
        console.log(`[NodeMCU Device] Automatic trial started for ${macAddress}`);
        return res.json({
          success: true,
          licensed: true,
          licenseType: 'trial',
          expiresAt: trialResult.trialInfo.expiresAt,
          daysRemaining: trialResult.trialInfo.daysRemaining,
          isTrial: true,
          isAutoTrial: true,
          message: 'Automatic 7-day trial started'
        });
      }
    }
    
    // No license and trial not available
    console.log(`[NodeMCU Device] No license available for ${macAddress}`);
    return res.json({
      success: false,
      licensed: false,
      message: 'No valid license found and trial not available',
      canStartTrial: verification.canStartTrial
    });
    
  } catch (err) {
    console.error('[NodeMCU Device] License verification error:', err);
    res.status(500).json({ 
      success: false, 
      licensed: false,
      error: err.message 
    });
  }
});

// CLOUD SYNC STATUS API
app.get('/api/sync/status', requireAdmin, async (req, res) => {
  try {
    const stats = getSyncStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// License Management
const { initializeLicenseManager } = require('./lib/license');
const { checkTrialStatus, activateLicense: storeLocalLicense } = require('./lib/trial');
const { getUniqueHardwareId } = require('./lib/hardware');

// Edge Sync (Cloud Data Sync)
const { syncSaleToCloud, getSyncStats } = require('./lib/edge-sync');

// ZeroTier Installation State (in-memory)
const zeroTierInstallState = {
  running: false,
  progress: 0,
  success: null,
  error: null,
  logs: [],
  startedAt: null,
  finishedAt: null,
  lastUpdateAt: null
};

let zeroTierInstallProcess = null;

function resetZeroTierInstallState() {
  zeroTierInstallState.running = false;
  zeroTierInstallState.progress = 0;
  zeroTierInstallState.success = null;
  zeroTierInstallState.error = null;
  zeroTierInstallState.logs = [];
  zeroTierInstallState.startedAt = null;
  zeroTierInstallState.finishedAt = null;
  zeroTierInstallState.lastUpdateAt = null;
}

function appendZeroTierLog(message) {
  if (!message) return;
  const lines = message.toString().split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    zeroTierInstallState.logs.push(trimmed);
  }
  // Keep only the last 200 lines to avoid unbounded growth
  if (zeroTierInstallState.logs.length > 200) {
    zeroTierInstallState.logs = zeroTierInstallState.logs.slice(-200);
  }
  zeroTierInstallState.lastUpdateAt = Date.now();
}

async function getZeroTierStatus() {
  // Step 1: Detect if zerotier-cli binary exists
  let cliExists = false;
  try {
    const { stdout } = await execPromise('which zerotier-cli');
    if (stdout && stdout.trim()) {
      cliExists = true;
    }
  } catch (e) {
    // which failed - treat as not installed
  }

  if (!cliExists) {
    return {
      installed: false,
      serviceRunning: false,
      version: null,
      nodeId: null,
      online: false,
      networks: [],
      error: null
    };
  }

  const status = {
    installed: true,
    serviceRunning: false,
    version: null,
    nodeId: null,
    online: false,
    networks: [],
    error: null
  };

  // Step 2: Query service info
  try {
    const { stdout } = await execPromise('zerotier-cli -j info');
    const info = JSON.parse(stdout);
    status.serviceRunning = true;
    status.version = info.version || null;
    status.nodeId = info.address || null;
    status.online = Boolean(info.online);
  } catch (e) {
    const stderr = e && e.stderr ? String(e.stderr) : '';
    const message = e && e.message ? String(e.message) : '';
    const combined = stderr || message || 'Unknown ZeroTier info error';

    status.serviceRunning = false;
    status.error = combined;

    // If the error clearly indicates the CLI is missing, override installed flag
    if (combined.includes('not found') || combined.includes('command not found')) {
      status.installed = false;
    }

    // If service is not running or token is missing, we still consider the CLI installed
    return status;
  }

  // Step 3: Query joined networks and IP assignments
  try {
    const { stdout } = await execPromise('zerotier-cli -j listnetworks');
    const networksRaw = JSON.parse(stdout);
    const networks = Array.isArray(networksRaw) ? networksRaw : [];

    status.networks = networks.map((n) => {
      const assigned =
        Array.isArray(n.assignedAddresses) ? n.assignedAddresses :
        Array.isArray(n.ipAssignments) ? n.ipAssignments :
        Array.isArray(n.ips) ? n.ips :
        [];

      return {
        id: n.nwid || n.id || '',
        name: n.name || '',
        status: n.status || '',
        type: n.type || '',
        mac: n.mac || '',
        deviceName: n.portDeviceName || n.dev || '',
        assignedIps: assigned
      };
    });
  } catch (e) {
    const stderr = e && e.stderr ? String(e.stderr) : '';
    const message = e && e.message ? String(e.message) : '';
    const combined = stderr || message;
    if (combined) {
      status.error = status.error || combined;
    }
  }

  return status;
}

// Initialize license manager (will use env variables if available)
const licenseManager = initializeLicenseManager();
let systemHardwareId = null;

// Initialize hardware ID on startup
(async () => {
  try {
    // 1. Check for custom hardware ID in config
    const customHwId = await db.get('SELECT value FROM config WHERE key = ?', ['custom_hardware_id']);
    
    if (customHwId && customHwId.value) {
      systemHardwareId = customHwId.value;
      console.log(`[License] Using Custom Hardware ID: ${systemHardwareId}`);
    } else {
      // 2. Fallback to auto-generated ID
      systemHardwareId = await getUniqueHardwareId();
      console.log(`[License] Hardware ID: ${systemHardwareId}`);
    }

    // Attempt to sync license from cloud on startup
    await licenseManager.fetchAndCacheLicense(systemHardwareId);
  } catch (error) {
    console.error('[License] Failed to get hardware ID:', error);
  }
})();

// Helper: Get MAC from IP using ARP table and DHCP leases
async function getMacFromIp(ip) {
  if (ip === '::1' || ip === '127.0.0.1' || !ip) return null;
  
  // 1. Try to ping the IP to ensure it's in the ARP table (fast check)
  try { await execPromise(`ping -c 1 -W 1 ${ip}`); } catch (e) {}

  // 2. Check ip neigh (modern ARP)
  try {
    const { stdout } = await execPromise(`ip neigh show ${ip}`);
    // Output: 10.0.0.5 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
    const match = stdout.match(/lladdr\s+([a-fA-F0-9:]+)/);
    if (match && match[1]) return match[1].toUpperCase();
  } catch (e) {}

  // 3. Fallback to /proc/net/arp
  try {
    const arpData = fs.readFileSync('/proc/net/arp', 'utf8');
    const lines = arpData.split('\n');
    for (const line of lines) {
      if (line.includes(ip)) {
        const parts = line.split(/\s+/);
        if (parts[3] && parts[3] !== '00:00:00:00:00:00') {
           return parts[3].toUpperCase();
        }
      }
    }
  } catch (e) {}

  // 4. Check DHCP Leases (dnsmasq) - essential for clients that block ping
  try {
    const leaseFiles = ['/tmp/dhcp.leases', '/var/lib/dnsmasq/dnsmasq.leases', '/var/lib/dhcp/dhcpd.leases', '/var/lib/misc/dnsmasq.leases'];
    for (const file of leaseFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        // dnsmasq lease format: <timestamp> <mac> <ip> <hostname> <client-id>
        const lines = content.split('\n');
        for (const line of lines) {
           const parts = line.split(' ');
           // Check for IP match (usually 3rd column)
           if (parts.length >= 3 && parts[2] === ip) {
             return parts[1].toUpperCase();
           }
        }
      }
    }
  } catch (e) {}

  try {
    const session = await db.get('SELECT mac FROM sessions WHERE ip = ? AND remaining_seconds > 0', [ip]);
    if (session && session.mac) {
      return session.mac.toUpperCase();
    }
  } catch (e) {
    console.error(`[MAC-Resolve] DB Fallback error for ${ip}:`, e.message);
  }

  return null;
}

async function applyRewardsForPurchase(mac, clientIp, pesos) {
  try {
    if (!mac) return;
    const amount = typeof pesos === 'number' ? Math.floor(pesos) : 0;
    if (!amount || amount <= 0) return;

    const row = await db.get("SELECT value FROM config WHERE key = 'rewards_config'");
    if (!row || !row.value) return;

    let cfg;
    try {
      cfg = JSON.parse(row.value);
    } catch (e) {
      return;
    }

    if (!cfg || !cfg.enabled) return;

    const threshold = parseInt(cfg.thresholdPesos, 10);
    const rewardCredit = parseInt(cfg.rewardCreditPesos, 10);

    if (!threshold || threshold <= 0 || !rewardCredit || rewardCredit <= 0) return;

    const units = Math.floor(amount / threshold);
    if (!units || units <= 0) return;

    const bonusPesos = units * rewardCredit;

    const existing = await db.get('SELECT id, credit_pesos, credit_minutes FROM wifi_devices WHERE mac = ?', [mac]);
    if (existing) {
      await db.run(
        'UPDATE wifi_devices SET credit_pesos = credit_pesos + ?, last_seen = ? WHERE id = ?',
        [bonusPesos, Date.now(), existing.id]
      );
    } else {
      const id = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.run(
        'INSERT INTO wifi_devices (id, mac, ip, hostname, interface, ssid, signal, connected_at, last_seen, is_active, custom_name, credit_pesos, credit_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, mac, clientIp || '', '', '', '', 0, Date.now(), Date.now(), 0, '', bonusPesos, 0]
      );
    }

    console.log(
      `[REWARDS] Granted bonus credit for ${mac} | ₱${bonusPesos} from ₱${amount}`
    );
  } catch (e) {
    console.error('[REWARDS] Failed to apply rewards:', e);
  }
}

// Explicitly serve tailwind.js to fix 404 issues
app.get('/dist/tailwind.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/tailwind.js'));
});

app.use('/dist', express.static(path.join(__dirname, 'dist')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname));

function sendExpiredPortalProbe(res) {
  const target = getPppoeExpiredPortalUrl();
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login Required</title>
  <meta http-equiv="refresh" content="0;url=${target}">
  <style>body{font-family:Arial,sans-serif;padding:18px}</style>
</head>
<body>
  <p>Login required. Redirecting...</p>
  <p><a href="${target}">Open Portal</a></p>
  <script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`);
}

app.get(['/generate_204', '/gen_204', '/hotspot-detect.html', '/connecttest.txt', '/ncsi.txt'], (req, res, next) => {
  try {
    if (!pppoeExpiredPool || !pppoeExpiredPool.ip_pool_start || !pppoeExpiredPool.ip_pool_end) return next();
    const ip = getClientIpV4(req);
    if (!ip) return next();
    if (!isIpInRange(ip, pppoeExpiredPool.ip_pool_start, pppoeExpiredPool.ip_pool_end)) return next();
    return sendExpiredPortalProbe(res);
  } catch (e) {
    return next();
  }
});

app.get('/api/pppoe/expired-info', async (req, res) => {
  try {
    if (!pppoeExpiredPool || !pppoeExpiredPool.ip_pool_start || !pppoeExpiredPool.ip_pool_end) {
      return res.status(404).json({ error: 'Expired pool not configured' });
    }
    const ip = getClientIpV4(req);
    if (!ip) return res.status(400).json({ error: 'Client IP not detected' });
    if (!isIpInRange(ip, pppoeExpiredPool.ip_pool_start, pppoeExpiredPool.ip_pool_end)) {
      return res.status(403).json({ error: 'Not in expired pool' });
    }

    const user = await db.get(
      `SELECT id, username, account_number, billing_profile_id, expires_at, expired_at, last_offline_at
       FROM pppoe_users
       WHERE ip_address = ?
       ORDER BY id DESC
       LIMIT 1`,
      [ip]
    ).catch(() => null);

    let billing = null;
    if (user?.billing_profile_id) {
      billing = await db.get(
        `SELECT bp.id as billing_profile_id, bp.name as billing_profile_name, bp.price as price, p.name as profile_name
         FROM pppoe_billing_profiles bp
         LEFT JOIN pppoe_profiles p ON p.id = bp.profile_id
         WHERE bp.id = ?`,
        [user.billing_profile_id]
      ).catch(() => null);
    }

    const nowRow = await db.get("SELECT datetime('now','localtime') as now").catch(() => null);
    const serverNow = nowRow?.now || new Date().toISOString();

    const expiredRow = user?.expires_at
      ? await db.get("SELECT 1 as ok WHERE datetime(replace(?,'T',' ')) <= datetime('now','localtime')", [user.expires_at]).catch(() => null)
      : null;
    const isExpired = !!(user?.expired_at || expiredRow);

    res.json({
      ip,
      server_time: serverNow,
      expired: isExpired,
      account: user
        ? {
            id: user.id,
            username: user.username,
            account_number: user.account_number || null,
            expires_at: user.expires_at || null,
            expired_at: user.expired_at || null,
            last_offline_at: user.last_offline_at || null
          }
        : null,
      billing: billing
        ? {
            billing_profile_id: billing.billing_profile_id,
            billing_profile_name: billing.billing_profile_name || null,
            profile_name: billing.profile_name || null,
            price: Number(billing.price || 0)
          }
        : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(async (req, res, next) => {
  try {
    if (!pppoeExpiredPool || !pppoeExpiredPool.ip_pool_start || !pppoeExpiredPool.ip_pool_end) return next();
    const ip = getClientIpV4(req);
    if (!ip) return next();
    if (!isIpInRange(ip, pppoeExpiredPool.ip_pool_start, pppoeExpiredPool.ip_pool_end)) return next();
    const p = req.path || '/';
    if (p.startsWith('/api/') || p.startsWith('/socket.io') || p.startsWith('/dist/') || p.startsWith('/uploads/')) return next();
    if (p === '/error.html') return res.status(200).sendFile(path.join(__dirname, 'error.html'));
    return res.status(200).sendFile(path.join(__dirname, 'error.html'));
  } catch (e) {
    return next();
  }
});

// AUDIO UPLOAD ENDPOINT
app.post('/api/admin/upload-audio', requireAdmin, upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Return web-accessible path
  const webPath = '/uploads/audio/' + req.file.filename;
  res.json({
    success: true,
    path: webPath
  });
});

// GET UPLOADED AUDIO FILES LIST
app.get('/api/admin/audio-files', requireAdmin, (req, res) => {
  const audioDir = path.join(__dirname, 'uploads', 'audio');

  fs.readdir(audioDir, (err, files) => {
    if (err) {
      console.error('Error reading audio directory:', err);
      return res.json({ files: [] });
    }

    const audioFiles = files
      .filter(file => file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.ogg') || file.endsWith('.m4a'))
      .map(file => {
        const stats = fs.statSync(path.join(audioDir, file));
        return {
          name: file,
          path: '/uploads/audio/' + file,
          size: stats.size,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());

    res.json({ files: audioFiles });
  });
});

// SUCCESS PAGE TO TRIGGER CAPTIVE PORTAL EXIT
app.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Internet Connected</title>
      <meta http-equiv="refresh" content="3;url=http://www.google.com">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .check { color: #4CAF50; font-size: 48px; }
        h1 { color: #333; }
      </style>
    </head>
    <body>
      <div class="check">✓</div>
      <h1>Internet Connected Successfully!</h1>
      <p>Redirecting to Google in 3 seconds...</p>
      <script>
        // Try to trigger OS captive portal detection
        setTimeout(() => {
          fetch('http://www.google.com/generate_204')
            .then(() => window.location.href = 'http://www.google.com')
            .catch(() => window.location.href = 'http://www.google.com');
        }, 1000);
      </script>
    </body>
    </html>
  `);
});

async function tryRoamingAuthorize(mac, clientIp, sessionToken) {
  try {
    if (!mac || !clientIp) return false;
    if (!edgeSync || !edgeSync.vendorId) return false;
    let roamingSession = await edgeSync.checkRoamingForMac(mac);
    if (!roamingSession && sessionToken) {
      roamingSession = await edgeSync.checkRoamingForToken(sessionToken, mac, clientIp);
    }
    if (!roamingSession) return false;
    try {
      await db.run('UPDATE sessions SET ip = ? WHERE mac = ?', [clientIp, mac]);
    } catch (e) {}
    if (sessionToken) {
      try {
        await db.run('UPDATE sessions SET token = ? WHERE mac = ? AND (token IS NULL OR token = "")', [sessionToken, mac]);
      } catch (e) {}
    }
    try {
      await network.whitelistMAC(mac, clientIp);
    } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

// CAPTIVE PORTAL DETECTION ENDPOINTS
app.get('/generate_204', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  if (mac) {
    const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
    if (session) {
      return res.status(204).send();
    }
    
    // Roaming Check: If no local session, try to pull from cloud via EdgeSync
    // This allows seamless roaming when user moves between APs
    try {
        if (edgeSync && edgeSync.vendorId) {
             // We do this check only if we are "online" and configured
             const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
             if (ok) {
                 return res.status(204).send();
             }
        }
    } catch(e) {
        // Fallback to captive portal if roaming check fails
    }
  }
  
  // Not authorized - serve portal directly
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/hotspot-detect.html', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  if (mac) {
    const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
    if (session) {
      return res.type('text/plain').send('Success');
    }
    const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
    if (ok) {
      return res.type('text/plain').send('Success');
    }
  }
  
  // Not authorized - serve portal directly
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ncsi.txt', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  if (mac) {
    const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
    if (session) {
      return res.type('text/plain').send('Microsoft NCSI');
    }
    const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
    if (ok) {
      return res.type('text/plain').send('Microsoft NCSI');
    }
  }
  
  // Not authorized - serve portal directly
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/connecttest.txt', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  if (mac) {
    const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
    if (session) {
      return res.type('text/plain').send('Success');
    }
    const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
    if (ok) {
      return res.type('text/plain').send('Success');
    }
  }
  
  // Not authorized - serve portal directly
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/success.txt', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  if (mac) {
    const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
    if (session) {
      return res.type('text/plain').send('Success');
    }
    const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
    if (ok) {
      return res.type('text/plain').send('Success');
    }
  }
  
  // Not authorized - serve portal directly
  return res.sendFile(path.join(__dirname, 'index.html'));
});

// Apple-specific captive portal detection
app.get('/library/test/success.html', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  if (mac) {
    const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
    if (session) {
      return res.type('text/plain').send('Success');
    }
    const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
    if (ok) {
      return res.type('text/plain').send('Success');
    }
  }
  
  // Not authorized - serve portal directly
  return res.sendFile(path.join(__dirname, 'index.html'));
});

// DNS REDIRECT HANDLING FOR CAPTIVE PORTAL
app.use(async (req, res, next) => {
  const host = req.headers.host || '';
  const url = req.url.toLowerCase();
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';

  // Check if this is a DNS-based captive portal probe
  if (host === 'captive.apple.com' || host === 'www.msftconnecttest.com' || host === 'connectivitycheck.gstatic.com') {
    // Allow API and static resources to pass through
    if (url.startsWith('/api') || url.startsWith('/dist') || url.startsWith('/assets')) {
      return next();
    }

    const mac = await getMacFromIp(clientIp);
    if (mac) {
      const session = await db.get('SELECT mac FROM sessions WHERE mac = ? AND remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)', [mac]);
      if (session) {
        // Authorized client - return success
        if (url.includes('/generate_204') || url.includes('/connecttest.txt')) {
          return res.status(204).send();
        }
        if (url.includes('/redirect')) {
          return res.redirect('http://www.apple.com');
        }
        return res.status(204).send();
      }
      const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
      if (ok) {
        if (url.includes('/generate_204') || url.includes('/connecttest.txt')) {
          return res.status(204).send();
        }
        if (url.includes('/redirect')) {
          return res.redirect('http://www.apple.com');
        }
        return res.status(204).send();
      }
    }
    // Not authorized - serve portal directly to avoid redirect loops
    // Apple/Android expects 200 OK with non-success content to trigger portal
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
  
  next();
});

// CAPTIVE PORTAL REDIRECTION MIDDLEWARE
app.use(async (req, res, next) => {
  const host = req.headers.host || '';
  const url = req.url.toLowerCase();
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';

  if (url.startsWith('/api') || url.startsWith('/dist') || url.startsWith('/assets') || url.startsWith('/admin') || host.includes('localhost') || host.includes('127.0.0.1')) {
    return next();
  }

  const portalProbes = [
    '/generate_204', '/hotspot-detect.html', '/ncsi.txt', 
    '/connecttest.txt', '/success.txt', '/kindle-wifi',
    '/library/test/success.html'
  ];
  const isProbe = portalProbes.some(p => url.includes(p));

  const mac = await getMacFromIp(clientIp);
  if (mac) {
    const session = await db.get('SELECT mac, ip, remaining_seconds FROM sessions WHERE mac = ? AND remaining_seconds > 0', [mac]);
    if (session) {
      // If IP has changed, update the whitelist rule
      if (session.ip !== clientIp) {
        console.log(`[NET] Client ${mac} moved from IP ${session.ip} to ${clientIp} (likely different SSID). Re-applying limits...`);
        // Block and clean up old IP (removes TC rules from old VLAN interface)
        await network.blockMAC(mac, session.ip);
        // Add extra delay to ensure complete cleanup
        await new Promise(r => setTimeout(r, 300));
        // Whitelist and re-apply limits on new IP (applies TC rules to new VLAN interface)
        await network.whitelistMAC(mac, clientIp);
        // Update session with new IP
        await db.run('UPDATE sessions SET ip = ? WHERE mac = ?', [clientIp, mac]);
        console.log(`[NET] Session limits re-applied for ${mac} on new interface`);
      }
      
      // Handle captive portal probe requests for authorized clients
      if (isProbe) {
        if (url.includes('/generate_204')) {
          return res.status(204).send();
        }
        if (url.includes('/success.txt') || url.includes('/connecttest.txt')) {
          return res.type('text/plain').send('Success');
        }
        if (url.includes('/ncsi.txt')) {
          return res.type('text/plain').send('Microsoft NCSI');
        }
        if (url.includes('/hotspot-detect.html') || url.includes('/library/test/success.html')) {
             return res.type('text/plain').send('Success');
        }
      }
      
      return next();
    }
    const ok = await tryRoamingAuthorize(mac, clientIp, getSessionToken(req));
    if (ok) {
      if (isProbe) {
        if (url.includes('/generate_204')) {
          return res.status(204).send();
        }
        if (url.includes('/success.txt') || url.includes('/connecttest.txt')) {
          return res.type('text/plain').send('Success');
        }
        if (url.includes('/ncsi.txt')) {
          return res.type('text/plain').send('Microsoft NCSI');
        }
        if (url.includes('/hotspot-detect.html') || url.includes('/library/test/success.html')) {
          return res.type('text/plain').send('Success');
        }
      }
      return next();
    }
  }

  // FORCE REDIRECT to common domain for session sharing (localStorage)
  const PORTAL_DOMAIN = 'portal.ajcpisowifi.com';

  if (isProbe) {
      // Probes get the file directly to satisfy the CNA
      return res.sendFile(path.join(__dirname, 'index.html'));
  }

  // If we are NOT on the portal domain (and not localhost), redirect.
  // This catches IP address access (10.0.0.1) and forces it to the domain.
  if (host !== PORTAL_DOMAIN && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return res.redirect(`http://${PORTAL_DOMAIN}/`);
  }
  
  next();
});

// SESSIONS API
app.get('/api/whoami', async (req, res) => {
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  const mac = await getMacFromIp(clientIp);
  
  let isRevoked = false;
  let canOperate = true;
  let canInsertCoin = true;
  
  try {
    if (!systemHardwareId) systemHardwareId = await getUniqueHardwareId();
    const verification = await licenseManager.verifyLicense();
    const trialStatus = await checkTrialStatus(systemHardwareId, verification);
    const isLicensed = verification.isValid && verification.isActivated;
    isRevoked = verification.isRevoked || trialStatus.isRevoked;

    canOperate = (isLicensed || trialStatus.isTrialActive) && !isRevoked;

    if (!canOperate && !isRevoked) {
      canInsertCoin = false;
    }
    
    if (trialStatus.isTrialActive && !isLicensed) {
      console.log(`[License] Trial Mode - ${trialStatus.daysRemaining} days remaining`);
      console.log(`[License] Trial expires: ${trialStatus.expiresAt}`);
    } else if (!trialStatus.isTrialActive && !isLicensed && !isRevoked) {
      if (trialStatus.hasHadLicense) {
        console.warn('[License] Trial mode disabled - System has had a license previously.');
      } else {
        console.warn('[License] Trial mode expired.');
      }
    }
    
    if (isRevoked) {
       // If revoked, only 1 device can use insert coin
       // Check if any other MAC has an active session
       // EXEMPT NodeMCU devices from blocking others
       const nodemcuResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
       const nodemcuMacs = nodemcuResult?.value ? JSON.parse(nodemcuResult.value).map(d => d.macAddress.toUpperCase()) : [];

       const activeSessions = await db.all('SELECT mac FROM sessions WHERE remaining_seconds > 0');
       const clientSessions = activeSessions.filter(s => !nodemcuMacs.includes(s.mac.toUpperCase()));

       if (clientSessions.length > 0) {
         // If there's an active client session, only that device can "add more time"
         const isMySessionActive = clientSessions.some(s => s.mac === mac);
         if (!isMySessionActive) {
           canInsertCoin = false;
         }
       }
     }
  } catch (e) {
    console.error('[WhoAmI] License check error:', e);
  }

  let creditPesos = 0;
  let creditMinutes = 0;
  try {
    let lookupMac = mac;
    if (lookupMac) {
      const device = await db.get('SELECT credit_pesos, credit_minutes FROM wifi_devices WHERE mac = ?', [lookupMac]);
      if (device) {
        creditPesos = device.credit_pesos || 0;
        creditMinutes = device.credit_minutes || 0;
      }
    }

    if (creditPesos <= 0 && creditMinutes <= 0) {
      const tokenForCredit = getSessionToken(req);
      if (tokenForCredit) {
        const sessionForCredit = await db.get('SELECT mac FROM sessions WHERE token = ?', [tokenForCredit]);
        if (sessionForCredit && sessionForCredit.mac && sessionForCredit.mac !== mac) {
          const deviceBySessionMac = await db.get('SELECT credit_pesos, credit_minutes FROM wifi_devices WHERE mac = ?', [sessionForCredit.mac]);
          if (deviceBySessionMac) {
            creditPesos = deviceBySessionMac.credit_pesos || 0;
            creditMinutes = deviceBySessionMac.credit_minutes || 0;
          }
        }
      }
    }
  } catch (e) {
    console.error('[WhoAmI] Credit lookup error:', e);
  }

  let vlanId = null;
  try {
    const { stdout } = await execPromise(`ip route get ${clientIp}`);
    const match = stdout.match(/dev\s+(\S+)/);
    if (match && match[1]) {
      const iface = match[1];
      const vlanMatch = iface.match(/\.([0-9]+)$/);
      if (vlanMatch) {
        vlanId = parseInt(vlanMatch[1], 10);
      }
    }
  } catch (e) {
    console.error('[WhoAmI] VLAN detection error:', e.message);
  }

  let recommendedNodeMCU = null;
  if (vlanId !== null) {
    try {
      const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
      const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
      if (Array.isArray(devices) && devices.length > 0) {
        const nowTs = Date.now();
        const nodeLicenseManager = getNodeMCULicenseManager();
        let bestDevice = null;

        // Iterate all accepted devices to find the best match
        for (const d of devices) {
          if (d.status !== 'accepted') continue;

          // 1. Check Online Status first to avoid expensive checks on offline devices
          const lastSeenTs = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
          const isOnline = lastSeenTs && (nowTs - lastSeenTs) < 15000;
          if (!isOnline) continue;

          // 2. Check License
          let license = null;
          try {
            license = await nodeLicenseManager.verifyLicense(d.macAddress);
          } catch (e) {}
          
          if (!license || !license.isValid) continue;

          // 3. Check VLAN Match
          let isMatch = false;
          
          // A. Explicit VLAN ID match
          if (d.vlanId == vlanId) {
            isMatch = true;
          }
          
          // B. Implicit Network Match (if not already matched)
          // Check if the device is reachable via the same VLAN interface
          if (!isMatch && d.ipAddress) {
             try {
               const { stdout } = await execPromise(`ip route get ${d.ipAddress}`);
               // Output: "10.0.22.104 dev br-lan.22 src 10.0.22.1 ..."
               const match = stdout.match(/dev\s+(\S+)/);
               if (match && match[1]) {
                 const iface = match[1];
                 const vlanMatch = iface.match(/\.([0-9]+)$/);
                 // If the interface has the same VLAN tag as the client
                 if (vlanMatch && parseInt(vlanMatch[1], 10) == vlanId) {
                   isMatch = true;
                 }
               }
             } catch (e) {
               // Ignore route errors
             }
          }

          if (isMatch) {
            bestDevice = d;
            break; // Found a valid, online, licensed, VLAN-matched device.
          }
        }

        if (bestDevice) {
          recommendedNodeMCU = {
            id: bestDevice.id,
            macAddress: bestDevice.macAddress,
            name: bestDevice.name || ''
          };
        }
      }
    } catch (e) {
      console.error('[WhoAmI] NodeMCU recommendation error:', e);
    }
  }

  const token = getSessionToken(req);
  let roamingRestored = false;
  let localRestored = false;

  try {
    if (mac) {
      const session = await db.get('SELECT remaining_seconds FROM sessions WHERE mac = ?', [mac]);
      if (!session || !session.remaining_seconds || session.remaining_seconds <= 0) {
        const ok = await tryRoamingAuthorize(mac, clientIp, token);
        if (ok) roamingRestored = true;
      }
    }
  } catch (e) {}

  try {
    if (token && mac) {
      const now = Date.now();
      const last = autoRestoreSeen.get(token);
      const canAttempt = !last || (now - last) > AUTO_RESTORE_TTL_MS;
      if (canAttempt) {
        autoRestoreSeen.set(token, now);
        const sessionByToken = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
        if (sessionByToken && sessionByToken.mac !== mac) {
          const targetSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
          let extraTime = 0;
          let extraPaid = 0;
          if (targetSession) {
            extraTime = targetSession.remaining_seconds || 0;
            extraPaid = targetSession.total_paid || 0;
            await db.run('DELETE FROM sessions WHERE mac = ?', [mac]);
          }
          await db.run('DELETE FROM sessions WHERE mac = ?', [sessionByToken.mac]);
          await db.run(
            'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at, download_limit, upload_limit, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [mac, clientIp, (sessionByToken.remaining_seconds || 0) + extraTime, (sessionByToken.total_paid || 0) + extraPaid, sessionByToken.connected_at, sessionByToken.download_limit, sessionByToken.upload_limit, token]
          );
          await network.blockMAC(sessionByToken.mac, sessionByToken.ip);
          await network.whitelistMAC(mac, clientIp);
          try {
            res.cookie('ajc_session_token', token, { path: '/', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
          } catch (e) {}
          localRestored = true;
          console.log(`[AUTH] Auto-restore triggered: Session ID=${token} moved from ${sessionByToken.mac} to ${mac}`);
        }
      }
    }
  } catch (e) {}

  try {
    if (mac) {
      const session = await db.get('SELECT remaining_seconds FROM sessions WHERE mac = ?', [mac]);
      const now = Date.now();
      const last = unauthSeen.get(mac);
      const shouldLog = !last || (now - last) > UNAUTH_LOG_TTL_MS;
      if (shouldLog && (!session || !session.remaining_seconds || session.remaining_seconds <= 0)) {
        unauthSeen.set(mac, now);
        console.log(`[AUTH] Device with no active time detected: MAC=${mac} | Session ID=${token || 'NONE'}`);
      }
    }
  } catch (e) {}

  res.json({ 
    ip: clientIp, 
    mac: mac || 'unknown',
    isRevoked,
    canOperate,
    canInsertCoin,
    creditPesos,
    creditMinutes,
    vlanId,
    recommendedNodeMCU,
    roamingRestored,
    localRestored
  });
});

app.post('/api/coinslot/reserve', async (req, res) => {
  cleanupExpiredCoinSlotLocks();

  const slot = normalizeCoinSlot(req.body?.slot);
  if (!slot) {
    return res.status(400).json({ success: false, error: 'Invalid coinslot.' });
  }

  // Enforce License Check for NodeMCU devices
  if (slot !== 'main') {
    const license = await nodeMCULicenseManager.verifyLicense(slot);
    if (!license.isValid) {
      return res.status(403).json({ 
        success: false, 
        error: 'YOUR COINSLOT MACHINE IS DISABLED' 
      });
    }
  }

  let clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  if (clientIp === '::1') clientIp = '127.0.0.1';
  let mac = await getMacFromIp(clientIp);
  if (!mac && clientIp === '127.0.0.1') mac = 'DEV-LOCALHOST';
  if (!mac) return res.status(400).json({ success: false, error: 'Could not identify your device MAC.' });

  const token = getSessionToken(req);
  const now = Date.now();
  const existing = coinSlotLocks.get(slot);
  if (existing && existing.expiresAt > now) {
    if (existing.ownerMac === mac || (token && existing.ownerToken === token)) {
      existing.expiresAt = now + COINSLOT_LOCK_TTL_MS;
      return res.json({ success: true, slot, lockId: existing.lockId, expiresAt: existing.expiresAt });
    }
    return res.status(409).json({
      success: false,
      code: 'COINSLOT_BUSY',
      slot,
      busyUntil: existing.expiresAt,
      error: 'JUST WAIT SOMEONE IS PAYING.'
    });
  }

  const lockId = crypto.randomBytes(16).toString('hex');
  const expiresAt = now + COINSLOT_LOCK_TTL_MS;
  coinSlotLocks.set(slot, { lockId, ownerMac: mac, ownerIp: clientIp, ownerToken: token || null, createdAt: now, expiresAt });
  
  if (slot === 'main') {
    try { setRelayState(true); } catch (e) {}
  }
  
  res.json({ success: true, slot, lockId, expiresAt });
});

app.post('/api/coinslot/heartbeat', async (req, res) => {
  cleanupExpiredCoinSlotLocks();

  const slot = normalizeCoinSlot(req.body?.slot);
  const lockId = req.body?.lockId;
  if (!slot || !lockId) {
    return res.status(400).json({ success: false, error: 'Invalid request.' });
  }

  let clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  if (clientIp === '::1') clientIp = '127.0.0.1';
  let mac = await getMacFromIp(clientIp);
  if (!mac && clientIp === '127.0.0.1') mac = 'DEV-LOCALHOST';
  if (!mac) return res.status(400).json({ success: false, error: 'Could not identify your device MAC.' });

  const token = getSessionToken(req);
  const existing = coinSlotLocks.get(slot);
  if (!existing || existing.lockId !== lockId || (existing.ownerMac !== mac && (!token || existing.ownerToken !== token))) {
    return res.status(409).json({ success: false, code: 'COINSLOT_NOT_OWNED', error: 'Coinslot reservation expired.' });
  }

  existing.expiresAt = Date.now() + COINSLOT_LOCK_TTL_MS;
  res.json({ success: true, slot, expiresAt: existing.expiresAt });
});

app.post('/api/coinslot/release', async (req, res) => {
  cleanupExpiredCoinSlotLocks();

  const slot = normalizeCoinSlot(req.body?.slot);
  const lockId = req.body?.lockId;
  if (!slot || !lockId) {
    return res.status(400).json({ success: false, error: 'Invalid request.' });
  }

  const existing = coinSlotLocks.get(slot);
  if (existing && existing.lockId === lockId) {
    if (slot === 'main') {
      try { setRelayState(false); } catch (e) {}
    }
    coinSlotLocks.delete(slot);
  }

  res.json({ success: true });
});

app.post('/api/credits/add', async (req, res) => {
  try {
    let clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
    if (clientIp === '::1') clientIp = '127.0.0.1';
    let mac = await getMacFromIp(clientIp);
    if (!mac && clientIp === '127.0.0.1') mac = 'DEV-LOCALHOST';
    if (!mac) {
      return res.status(400).json({ success: false, error: 'Could not identify your device MAC.' });
    }

    const { pesos, minutes } = req.body || {};
    const safePesos = typeof pesos === 'number' && pesos > 0 ? Math.floor(pesos) : 0;
    const safeMinutes = typeof minutes === 'number' && minutes > 0 ? Math.floor(minutes) : 0;

    if (!safePesos) {
      return res.status(400).json({ success: false, error: 'Invalid credit values.' });
    }

    const existing = await db.get('SELECT id, credit_pesos, credit_minutes FROM wifi_devices WHERE mac = ?', [mac]);
    if (existing) {
      await db.run(
        'UPDATE wifi_devices SET credit_pesos = credit_pesos + ?, credit_minutes = credit_minutes + ?, last_seen = ? WHERE id = ?',
        [safePesos, safeMinutes, Date.now(), existing.id]
      );
    } else {
      const id = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.run(
        'INSERT INTO wifi_devices (id, mac, ip, hostname, interface, ssid, signal, connected_at, last_seen, is_active, custom_name, credit_pesos, credit_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, mac, clientIp, '', '', '', 0, Date.now(), Date.now(), 0, '', safePesos, safeMinutes]
      );
    }

    const token = getSessionToken(req);
    if (safeMinutes > 0) {
      console.log(`[CREDIT] Added credit for ${mac} | Session ID=${token || 'NONE'} | ₱${safePesos}, ${safeMinutes}m`);
    } else {
      console.log(`[CREDIT] Added credit for ${mac} | Session ID=${token || 'NONE'} | ₱${safePesos}`);
    }
    try {
      await applyRewardsForPurchase(mac, clientIp, safePesos);
    } catch (e) {}

    res.json({ success: true });
  } catch (err) {
    console.error('[CREDIT] Error adding credit:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/credits/use', async (req, res) => {
  try {
    let clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
    if (clientIp === '::1') clientIp = '127.0.0.1';
    let mac = await getMacFromIp(clientIp);
    if (!mac && clientIp === '127.0.0.1') mac = 'DEV-LOCALHOST';

    if (!mac) {
      return res.status(400).json({ success: false, error: 'Could not identify your device MAC.' });
    }

    const { pesos: rawPesos } = req.body || {};
    const requestedPesos = typeof rawPesos === 'number' ? Math.floor(rawPesos) : 0;
    if (!requestedPesos || requestedPesos <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid credit amount.' });
    }

    const device = await db.get('SELECT id, credit_pesos, credit_minutes FROM wifi_devices WHERE mac = ?', [mac]);
    if (!device || ((!device.credit_minutes || device.credit_minutes <= 0) && (!device.credit_pesos || device.credit_pesos <= 0))) {
      return res.status(400).json({ success: false, error: 'No saved credit available for this device.' });
    }
    if (!device.credit_pesos || requestedPesos > device.credit_pesos) {
      return res.status(400).json({ success: false, error: 'Not enough credit available.' });
    }

    if (!systemHardwareId) systemHardwareId = await getUniqueHardwareId();
    const verification = await licenseManager.verifyLicense();
    const trialStatus = await checkTrialStatus(systemHardwareId, verification);
    const isLicensed = verification.isValid && verification.isActivated;
    const isRevoked = verification.isRevoked || trialStatus.isRevoked;
    const canOperate = (isLicensed || trialStatus.isTrialActive) && !isRevoked;

    if (!canOperate && !isRevoked) {
      return res.status(403).json({ success: false, error: 'System License Expired: Activation required.' });
    }

    if (isRevoked) {
      const nodemcuResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
      const nodemcuMacs = nodemcuResult?.value ? JSON.parse(nodemcuResult.value).map(d => d.macAddress.toUpperCase()) : [];

      if (!nodemcuMacs.includes(mac.toUpperCase())) {
        const activeSessions = await db.all('SELECT mac FROM sessions WHERE remaining_seconds > 0 AND mac != ?', [mac]);
        const activeClients = activeSessions.filter(s => !nodemcuMacs.includes(s.mac.toUpperCase()));
        if (activeClients.length > 0) {
          return res.status(403).json({ success: false, error: 'System License Revoked: Only 1 device allowed at a time.' });
        }
      }
    }

    const totalCreditPesos = device.credit_pesos || 0;
    const totalCreditMinutes = device.credit_minutes || 0;

    let minutes = 0;
    if (totalCreditPesos > 0 && totalCreditMinutes > 0) {
      const perPeso = totalCreditMinutes / totalCreditPesos;
      minutes = Math.floor(perPeso * requestedPesos);
    } else if (totalCreditMinutes > 0 && totalCreditPesos === 0) {
      minutes = totalCreditMinutes;
    }

    if (minutes <= 0) {
      const rateRows = await db.all('SELECT pesos, minutes FROM rates');
      let derivedMinutes = 0;

      if (rateRows && rateRows.length > 0) {
        const exactRate = rateRows.find(r => r.pesos === requestedPesos);
        if (exactRate && exactRate.minutes > 0) {
          derivedMinutes = exactRate.minutes;
        } else {
          let bestMinutesPerPeso = 0;
          for (const rate of rateRows) {
            if (rate.pesos > 0 && rate.minutes > 0) {
              const mpp = rate.minutes / rate.pesos;
              if (mpp > bestMinutesPerPeso) {
                bestMinutesPerPeso = mpp;
              }
            }
          }
          if (bestMinutesPerPeso > 0) {
            derivedMinutes = Math.floor(bestMinutesPerPeso * requestedPesos);
          }
        }
      }

      if (!derivedMinutes) {
        derivedMinutes = requestedPesos * 10;
      }

      minutes = derivedMinutes;
    }

    if (minutes <= 0) {
      return res.status(400).json({ success: false, error: 'Cannot convert credit to time.' });
    }

    const pesos = requestedPesos;
    const seconds = minutes * 60;

    let rate = await db.get('SELECT * FROM rates WHERE pesos = ? AND minutes = ?', [pesos, minutes]);
    if (!rate && pesos > 0) {
      rate = await db.get('SELECT * FROM rates WHERE pesos = ?', [pesos]);
    }
    if (!rate) {
      rate = await db.get('SELECT * FROM rates WHERE minutes = ?', [minutes]);
    }

    const downloadLimit = rate ? (rate.download_limit || 0) : 0;
    const uploadLimit = rate ? (rate.upload_limit || 0) : 0;
    const pausable = rate && typeof rate.is_pausable === 'number' ? rate.is_pausable : 1;

    const requestedToken = getSessionToken(req);
    let migratedOldMac = null;
    let migratedOldIp = null;

    let session = null;
    let tokenToUse = null;

    if (requestedToken) {
      const sessionByToken = await db.get('SELECT * FROM sessions WHERE token = ?', [requestedToken]);
      if (sessionByToken) {
        session = sessionByToken;
        tokenToUse = requestedToken;
        if (sessionByToken.mac !== mac) {
          migratedOldMac = sessionByToken.mac;
          migratedOldIp = sessionByToken.ip;
        }
      }
    }

    if (!session) {
      const sessionByMac = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
      if (sessionByMac) {
        session = sessionByMac;
        tokenToUse = sessionByMac.token || requestedToken || tokenToUse;
      }
    }

    if (!tokenToUse) {
      tokenToUse = requestedToken || crypto.randomBytes(16).toString('hex');
    }

    if (session) {
      if (session.token === tokenToUse) {
        await db.run(
          `UPDATE sessions 
           SET mac = ?, 
               ip = ?, 
               remaining_seconds = remaining_seconds + ?, 
               total_paid = total_paid + ?, 
               download_limit = COALESCE(download_limit, ?), 
               upload_limit = COALESCE(upload_limit, ?),
               is_paused = 0,
               pausable = COALESCE(pausable, ?)
           WHERE token = ?`,
          [mac, clientIp, seconds, pesos, downloadLimit, uploadLimit, pausable, tokenToUse]
        );
      } else if (session.mac === mac) {
        await db.run(
          `UPDATE sessions 
           SET remaining_seconds = remaining_seconds + ?, 
               total_paid = total_paid + ?, 
               ip = ?, 
               download_limit = COALESCE(download_limit, ?), 
               upload_limit = COALESCE(upload_limit, ?),
               is_paused = 0,
               pausable = COALESCE(pausable, ?),
               token = ?
           WHERE mac = ?`,
          [seconds, pesos, clientIp, downloadLimit, uploadLimit, pausable, tokenToUse, mac]
        );
      } else {
        await db.run(
          `UPDATE sessions 
           SET mac = ?, 
               ip = ?, 
               remaining_seconds = remaining_seconds + ?, 
               total_paid = total_paid + ?, 
               download_limit = COALESCE(download_limit, ?), 
               upload_limit = COALESCE(upload_limit, ?),
               is_paused = 0,
               pausable = COALESCE(pausable, ?),
               token = ?
           WHERE token = ?`,
          [mac, clientIp, seconds, pesos, downloadLimit, uploadLimit, pausable, tokenToUse, session.token]
        );
      }
    } else {
      await db.run(
        `INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at, is_paused, download_limit, upload_limit, pausable, token)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [mac, clientIp, seconds, pesos, Date.now(), downloadLimit, uploadLimit, pausable, tokenToUse]
      );
    }

    const remainingPesos = Math.max(0, totalCreditPesos - requestedPesos);
    const remainingMinutes = Math.max(0, totalCreditMinutes - minutes);
    await db.run(
      'UPDATE wifi_devices SET credit_pesos = ?, credit_minutes = ?, last_seen = ? WHERE id = ?',
      [remainingPesos, remainingMinutes, Date.now(), device.id]
    );

    try {
      await network.whitelistMAC(mac, clientIp);
      if (migratedOldMac && migratedOldIp && (migratedOldMac !== mac || migratedOldIp !== clientIp)) {
        await network.blockMAC(migratedOldMac, migratedOldIp);
      }
    } catch (e) {
      console.error('[CREDIT] Failed to update firewall on useCredit:', e);
    }

    res.cookie('ajc_session_token', tokenToUse, {
      httpOnly: false,
      sameSite: 'lax'
    });

    console.log(
      `[CREDIT] Used credit for ${mac} | Session ID=${tokenToUse || 'NONE'} | ₱${pesos}, ${minutes}m (remaining ₱${remainingPesos}, ${remainingMinutes}m)`
    );

    try {
      await applyRewardsForPurchase(mac, clientIp, pesos);
    } catch (e) {}

    res.json({ success: true, remainingMinutes: remainingMinutes });
  } catch (err) {
    console.error('[CREDIT] Error using credit:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT mac, ip, remaining_seconds as remainingSeconds, total_paid as totalPaid, connected_at as connectedAt, is_paused as isPaused, token, pausable as isPausable FROM sessions WHERE remaining_seconds > 0'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/sessions', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT mac, ip, remaining_seconds as remainingSeconds, total_paid as totalPaid, connected_at as connectedAt, is_paused as isPaused, token, pausable as isPausable FROM sessions WHERE total_paid > 0 ORDER BY connected_at DESC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales/history', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM sales ORDER BY timestamp DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Get comprehensive sales data for Sales Inventory page
app.get('/api/sales/inventory', requireAdmin, async (req, res) => {
  try {
    const { from, to, coinslot, type } = req.query;
    
    // Build the WHERE clause
    let whereClause = 'WHERE type != "coins_out"'; // Exclude coins_out transactions
    const params = [];
    
    if (from) {
      whereClause += ' AND date(timestamp) >= date(?)';
      params.push(from);
    }
    if (to) {
      whereClause += ' AND date(timestamp) <= date(?)';
      params.push(to);
    }
    if (coinslot && coinslot !== 'all') {
      whereClause += ' AND machine_id = ?';
      params.push(coinslot);
    }
    if (type && type !== 'all') {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    
    // Get sales records
    const salesQuery = `SELECT 
      id,
      mac,
      ip,
      amount,
      minutes,
      type,
      timestamp as createdAt,
      machine_id as machineId
    FROM sales 
    ${whereClause}
    ORDER BY timestamp DESC`;
    
    const sales = await db.all(salesQuery, params);
    
    // Get unique coinslots (machine_ids)
    const coinslotsQuery = `SELECT DISTINCT machine_id as machineId FROM sales WHERE machine_id IS NOT NULL ORDER BY machine_id`;
    const coinslots = await db.all(coinslotsQuery);
    
    // Calculate totals per coinslot (all time)
    const totalsQuery = `SELECT 
      machine_id as machineId,
      SUM(amount) as totalAmount,
      COUNT(*) as transactionCount
    FROM sales 
    WHERE type != "coins_out"
    GROUP BY machine_id`;
    const totals = await db.all(totalsQuery);
    
    // Calculate grand total (all time)
    const grandTotalQuery = `SELECT 
      SUM(amount) as grandTotal,
      COUNT(*) as totalTransactions
    FROM sales 
    WHERE type != "coins_out"`;
    const grandTotal = await db.get(grandTotalQuery);
    
    // Calculate today's total (regardless of date filter)
    const todayTotalQuery = `SELECT 
      SUM(amount) as todayTotal,
      COUNT(*) as todayCount
    FROM sales 
    WHERE type != "coins_out" AND date(timestamp) = date('now')`;
    const todayTotal = await db.get(todayTotalQuery);
    
    res.json({
      sales,
      coinslots: coinslots.map(c => c.machineId),
      totals: totals.reduce((acc, t) => {
        acc[t.machineId] = {
          amount: t.totalAmount || 0,
          count: t.transactionCount || 0
        };
        return acc;
      }, {}),
      grandTotal: {
        amount: grandTotal?.grandTotal || 0,
        count: grandTotal?.totalTransactions || 0
      },
      todayTotal: {
        amount: todayTotal?.todayTotal || 0,
        count: todayTotal?.todayCount || 0
      }
    });
  } catch (err) { 
    console.error('[Sales Inventory API Error]:', err);
    res.status(500).json({ error: err.message }); 
  }
});

// COINS OUT API for MAIN MACHINE
app.post('/api/admin/coinsout', requireAdmin, async (req, res) => {
  try {
    const { gross, net, date } = req.body;
    
    // 1. Reset main machine revenue stats in config (if stored there) or just log it
    // Currently, main machine total revenue is often calculated from sales logs or a config value
    // Let's check if we have a 'total_revenue' config. If not, we might need to create one or just rely on logs.
    // For now, we will save the "Last Coins Out" stats to config so they can be displayed.
    
    const coinsOutData = {
      lastCoinsOutGross: gross,
      lastCoinsOutNet: net,
      lastCoinsOutDate: date || new Date().toISOString()
    };
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['main_coins_out_stats', JSON.stringify(coinsOutData)]);
    
    // 2. Record the Coins Out event in the sales table for history
    // We use a negative amount or a specific type to indicate coins out
    // Using 'coins_out' type is cleaner if the table supports it, otherwise use convention
    // The sales table schema is: (mac, ip, amount, minutes, type, machine_id)
    // We'll use type='coins_out' and amount=-gross
    
    try {
        await db.run(
          'INSERT INTO sales (mac, ip, amount, minutes, type, machine_id) VALUES (?, ?, ?, ?, ?, ?)',
          ['ADMIN', '127.0.0.1', -Math.abs(gross), 0, 'coins_out', 'main']
        );
    } catch (e) {
        console.error('[SALES] Failed to record coins out in local DB:', e);
    }

    // 3. Sync to cloud (Supabase)
    try {
      if (edgeSync) {
        // We need to implement a similar function for main machine coins out in edge-sync
        // For now, we can reuse the recordNodeMCUCoinsOut logic but adapting it for the main machine
        // Or create a specific one. Let's assume we'll add `recordMainCoinsOut` to edgeSync later.
        // For now, let's just log it.
        if (edgeSync.recordMainCoinsOut) {
            await edgeSync.recordMainCoinsOut(gross, net, date);
        } else {
             // Fallback: If no specific function, maybe we can use the generic sales sync with a special flag?
             // Actually, we should probably add the method to edge-sync.js first.
             // But to avoid breaking, we'll skip for now if not exists.
        }
      }
    } catch (e) {
      console.error('Failed to sync main coins-out to cloud:', e);
    }

    res.json({ success: true, stats: coinsOutData });
  } catch (err) {
    console.error('Error processing main coins-out:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/start', async (req, res) => {
  const { minutes, pesos, slot: requestedSlot, lockId } = req.body;
  let clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  if (clientIp === '::1') clientIp = '127.0.0.1';
  let mac = await getMacFromIp(clientIp);
  if (!mac && clientIp === '127.0.0.1') mac = 'DEV-LOCALHOST';

  if (!mac) {
    console.error(`[AUTH] Failed to resolve MAC for IP: ${clientIp}`);
    return res.status(400).json({ error: 'Could not identify your device MAC. Please try reconnecting.' });
  }

  cleanupExpiredCoinSlotLocks();
  const slot = normalizeCoinSlot(requestedSlot);
  if (!slot || !lockId) {
    return res.status(400).json({ error: 'Coinslot lock required. Please press Insert Coin again.' });
  }
  const slotLock = coinSlotLocks.get(slot);
  if (!slotLock || slotLock.lockId !== lockId || slotLock.ownerMac !== mac) {
    if (slotLock && slotLock.expiresAt > Date.now() && slotLock.ownerMac !== mac) {
      return res.status(409).json({ error: 'JUST WAIT SOMEONE IS PAYING.' });
    }
    return res.status(409).json({ error: 'Coinslot reservation expired. Please press Insert Coin again.' });
  }

  try {
    // Enforce 1-device limit if revoked
    if (!systemHardwareId) systemHardwareId = await getUniqueHardwareId();
    const verification = await licenseManager.verifyLicense();
    const trialStatus = await checkTrialStatus(systemHardwareId, verification);
    const isLicensed = verification.isValid && verification.isActivated;
    const isRevoked = verification.isRevoked || trialStatus.isRevoked;
    const canOperate = (isLicensed || trialStatus.isTrialActive) && !isRevoked;

    if (!canOperate && !isRevoked) {
      return res.status(403).json({ error: 'System License Expired: Activation required.' });
    }

    if (isRevoked) {
      const nodemcuResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
      const nodemcuMacs = nodemcuResult?.value ? JSON.parse(nodemcuResult.value).map(d => d.macAddress.toUpperCase()) : [];

      // Only apply limit if the CURRENT user is NOT a NodeMCU (which they shouldn't be)
      if (!nodemcuMacs.includes(mac.toUpperCase())) {
        const activeSessions = await db.all('SELECT mac FROM sessions WHERE remaining_seconds > 0 AND mac != ?', [mac]);
        const activeClients = activeSessions.filter(s => !nodemcuMacs.includes(s.mac.toUpperCase()));
        
        if (activeClients.length > 0) {
          return res.status(403).json({ error: 'System License Revoked: Only 1 device allowed at a time.' });
        }
      }
    }

    // Check if slot is NodeMCU
    let rate = null;
    let isNodeMCU = false;
    
    // Try to find if requestedSlot is a NodeMCU MAC
    // NodeMCU slots usually pass MAC address as slot ID
    if (requestedSlot && typeof requestedSlot === 'string' && requestedSlot.includes(':')) {
       const nodemcuResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
       const nodemcuDevices = nodemcuResult?.value ? JSON.parse(nodemcuResult.value) : [];
       const nodeDevice = nodemcuDevices.find(d => d.macAddress === requestedSlot);
       
       if (nodeDevice && nodeDevice.rates && nodeDevice.rates.length > 0) {
          isNodeMCU = true;
          // Match rate by pesos and minutes (since minutes is passed from frontend selection)
          rate = nodeDevice.rates.find(r => r.pesos === pesos && r.minutes === minutes);
          if (!rate) {
             rate = nodeDevice.rates.find(r => r.pesos === pesos);
          }
          if (rate) {
             console.log(`[AUTH] Using NodeMCU specific rate for ${nodeDevice.name}: ${pesos} PHP -> ${rate.minutes} mins, Pausable: ${rate.is_pausable}`);
          }
       }
    }

    if (!rate && !isNodeMCU) {
      // Lookup matching rate to apply speed limits
      // Prioritize exact match on pesos and minutes, then fallback to pesos
      rate = await db.get('SELECT * FROM rates WHERE pesos = ? AND minutes = ?', [pesos, minutes]);
      if (!rate) {
        rate = await db.get('SELECT * FROM rates WHERE pesos = ?', [pesos]);
      }
    }

    const downloadLimit = rate ? (rate.download_limit || 0) : 0;
    const uploadLimit = rate ? (rate.upload_limit || 0) : 0;
    const pausable = rate && typeof rate.is_pausable !== 'undefined' ? rate.is_pausable : 1;
    const seconds = minutes * 60;

    let requestedToken = getSessionToken(req);
    let tokenToUse = requestedToken || null;
    let migratedOldMac = null;
    let migratedOldIp = null;

    const existingSessionForMac = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
    if (existingSessionForMac && (existingSessionForMac.remaining_seconds || 0) > 0) {
      if (existingSessionForMac.token && requestedToken && existingSessionForMac.token !== requestedToken) {
        requestedToken = existingSessionForMac.token;
        tokenToUse = existingSessionForMac.token;
      } else if (!requestedToken && existingSessionForMac.token) {
        requestedToken = existingSessionForMac.token;
        tokenToUse = existingSessionForMac.token;
      }
    }

    if (requestedToken) {
      const sessionByToken = await db.get('SELECT * FROM sessions WHERE token = ?', [requestedToken]);
      if (sessionByToken) {
        if (sessionByToken.mac === mac) {
          await db.run(
            'UPDATE sessions SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + ?, ip = ?, download_limit = ?, upload_limit = ? WHERE token = ?',
            [seconds, pesos, clientIp, downloadLimit, uploadLimit, requestedToken]
          );
          tokenToUse = requestedToken;
        } else {
          const targetSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
          let extraTime = 0;
          let extraPaid = 0;
          if (targetSession) {
            extraTime = targetSession.remaining_seconds || 0;
            extraPaid = targetSession.total_paid || 0;
            await db.run('DELETE FROM sessions WHERE mac = ?', [mac]);
          }
          await db.run('DELETE FROM sessions WHERE mac = ?', [sessionByToken.mac]);
          await db.run(
            'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at, download_limit, upload_limit, token, pausable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              mac,
              clientIp,
              (sessionByToken.remaining_seconds || 0) + extraTime + seconds,
              (sessionByToken.total_paid || 0) + extraPaid + pesos,
              sessionByToken.connected_at,
              downloadLimit,
              uploadLimit,
              requestedToken,
              sessionByToken.pausable != null ? sessionByToken.pausable : pausable
            ]
          );
          migratedOldMac = sessionByToken.mac;
          migratedOldIp = sessionByToken.ip;
          tokenToUse = requestedToken;
        }
      } else {
        const existingByMac = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
        if (existingByMac) {
          const existingToken = existingByMac.token;
          const hasTime = (existingByMac.remaining_seconds || 0) > 0;
          const canonicalToken = hasTime && existingToken ? existingToken : (existingToken || requestedToken);
          await db.run(
            'UPDATE sessions SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + ?, ip = ?, download_limit = ?, upload_limit = ?, token = ? WHERE mac = ?',
            [seconds, pesos, clientIp, downloadLimit, uploadLimit, canonicalToken, mac]
          );
          tokenToUse = canonicalToken;
        } else {
          await db.run(
            'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, download_limit, upload_limit, token, pausable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [mac, clientIp, seconds, pesos, downloadLimit, uploadLimit, requestedToken, pausable]
          );
          tokenToUse = requestedToken;
        }
      }
    }

    if (!tokenToUse) {
      const existingSession = await db.get('SELECT token FROM sessions WHERE mac = ?', [mac]);
      tokenToUse = (existingSession && existingSession.token) ? existingSession.token : crypto.randomBytes(16).toString('hex');
      await db.run(
        'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, download_limit, upload_limit, token, pausable) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mac) DO UPDATE SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + ?, ip = ?, download_limit = ?, upload_limit = ?, token = ?',
        [mac, clientIp, seconds, pesos, downloadLimit, uploadLimit, tokenToUse, pausable, seconds, pesos, clientIp, downloadLimit, uploadLimit, tokenToUse]
      );
    }
    
    await network.whitelistMAC(mac, clientIp);
    if (migratedOldMac && migratedOldIp) {
      await network.blockMAC(migratedOldMac, migratedOldIp);
    }
    
    console.log(`[AUTH] Session started for ${mac} (${clientIp}) - ${seconds}s, ₱${pesos}, Limits: ${downloadLimit}/${uploadLimit} Mbps`);
    console.log(`[AUTH] New user connected: MAC=${mac} | Session ID=${tokenToUse}`);
    
    // Record local sale
    try {
      await db.run(
        'INSERT INTO sales (mac, ip, amount, minutes, type, machine_id) VALUES (?, ?, ?, ?, ?, ?)',
        [mac, clientIp, pesos, minutes, 'coin', requestedSlot || 'main']
      );
    } catch (e) {
      console.error('[SALES] Failed to record local sale:', e);
    }

    // Only sync sale to MAIN sales_logs if NOT a NodeMCU device (to avoid double counting)
    if (!isNodeMCU) {
      syncSaleToCloud({
        amount: pesos,
        session_duration: seconds,
        customer_mac: mac,
        transaction_type: 'coin_insert'
      }).catch(err => {
        console.error('[Sync] Failed to sync sale to cloud:', err);
      });
    } else {
      console.log(`[AUTH] Skipping main sales log for NodeMCU device (Handled by NodeMCU Listener)`);
    }

    await applyRewardsForPurchase(mac, clientIp, pesos);
    
    // Release relay if main coinslot
    if (slot === 'main') {
      try { setRelayState(false); } catch (e) {}
    }
    coinSlotLocks.delete(slot);
    try {
      res.cookie('ajc_session_token', tokenToUse, { path: '/', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    } catch (e) {}
    res.json({ success: true, mac, token: tokenToUse, message: 'Internet access granted. Please refresh your browser or wait a moment for connection to activate.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sessions/restore', async (req, res) => {
  let token = req.body.token || getSessionToken(req);
  const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
  let mac = await getMacFromIp(clientIp);
  if (!mac) {
    for (let i = 0; i < 5 && !mac; i++) {
      try { await execPromise(`ping -c 1 -W 1 ${clientIp}`); } catch (e) {}
      await new Promise(r => setTimeout(r, 400));
      mac = await getMacFromIp(clientIp);
    }
  }
  
  if (!token || !mac) return res.status(400).json({ error: 'Invalid request' });

  try {
    const session = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    if (session.mac === mac) {
       // Same device, just update IP if changed and ensure whitelisted
       if (session.ip !== clientIp) {
         await db.run('UPDATE sessions SET ip = ? WHERE mac = ?', [clientIp, mac]);
         await network.whitelistMAC(mac, clientIp);
       }
       return res.json({ success: true, remainingSeconds: session.remaining_seconds, isPaused: session.is_paused === 1 });
    }

    console.log(`[AUTH] Restoring session ${token} from ${session.mac} to ${mac}`);

    // Check if the target MAC already has a session
    const targetSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
    let extraTime = 0;
    let extraPaid = 0;
    
    if (targetSession) {
      // Merge existing time from the target MAC if any
      extraTime = targetSession.remaining_seconds;
      extraPaid = targetSession.total_paid;
      await db.run('DELETE FROM sessions WHERE mac = ?', [mac]);
    }

    // Delete the old session record
    await db.run('DELETE FROM sessions WHERE mac = ?', [session.mac]);
    
    // Insert new record with merged data
    await db.run(
      'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at, download_limit, upload_limit, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [mac, clientIp, session.remaining_seconds + extraTime, session.total_paid + extraPaid, session.connected_at, session.download_limit, session.upload_limit, token]
    );
    
    // Switch whitelist
    await network.blockMAC(session.mac, session.ip); // Block old
    await network.whitelistMAC(mac, clientIp); // Allow new
    
    try {
      res.cookie('ajc_session_token', token, { path: '/', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    } catch (e) {}
    console.log(`[AUTH] User session restored on new MAC: MAC=${mac} | Session ID=${token}`);
    res.json({ success: true, migrated: true, remainingSeconds: session.remaining_seconds + extraTime, isPaused: session.is_paused === 1 });
  } catch (err) { 
    console.error('[AUTH] Restore error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

app.post('/api/sessions/pause', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const session = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.pausable === 0) {
      return res.status(400).json({ error: 'This session is not pausable' });
    }

    await db.run('UPDATE sessions SET is_paused = 1 WHERE token = ?', [token]);
    await network.blockMAC(session.mac, session.ip);

    console.log(`[AUTH] Session paused for ${session.mac}`);
    res.json({ success: true, message: 'Time paused. Internet access suspended.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sessions/resume', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const session = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    await db.run('UPDATE sessions SET is_paused = 0 WHERE token = ?', [token]);
    
    // Use forceNetworkRefresh to ensure internet returns properly
    await network.forceNetworkRefresh(session.mac, session.ip);

    console.log(`[AUTH] Session resumed for ${session.mac}`);
    res.json({ success: true, message: 'Time resumed. Internet access restored.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RATES API
app.get('/api/rates', async (req, res) => {
  try { res.json(await db.all('SELECT * FROM rates')); } catch (err) { res.json([]); }
});

app.post('/api/rates', requireAdmin, async (req, res) => {
  try { 
    const { pesos, minutes, expiration_hours, mode } = req.body;
    const isPausable = mode === 'consumable' ? 0 : 1;
    const effectiveExpiration = mode === 'consumable' ? null : (expiration_hours || null);

    await db.run(
      'INSERT INTO rates (pesos, minutes, expiration_hours, is_pausable) VALUES (?, ?, ?, ?)', 
      [pesos, minutes, effectiveExpiration, isPausable]
    ); 
    res.json({ success: true }); 
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/rates/:id', requireAdmin, async (req, res) => {
  try { await db.run('DELETE FROM rates WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// NETWORK REFRESH API - Help devices reconnect after session creation
app.post('/api/network/refresh', async (req, res) => {
  try {
    const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
    const mac = await getMacFromIp(clientIp);
    
    if (!mac) {
      return res.status(400).json({ success: false, error: 'Could not identify your device' });
    }
    
    // Force network refresh for the requesting device
    await network.forceNetworkRefresh(mac, clientIp);
    
    res.json({ 
      success: true, 
      message: 'Network connection refreshed. Try accessing a website now.' 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// INTERNET STATUS API - Board/System internet connectivity for portal landing page
app.get('/api/network/internet-status', async (req, res) => {
  try {
    const target = '1.1.1.1';
    try {
      await execPromise(`ping -c 1 -W 1 ${target}`);
      return res.json({ online: true, target });
    } catch (e) {
      return res.json({ online: false, target });
    }
  } catch (err) {
    return res.status(500).json({ online: false, error: err.message });
  }
});

app.get('/api/config/qos', requireAdmin, async (req, res) => {
  try {
    const result = await db.get("SELECT value FROM config WHERE key = 'qos_discipline'");
    res.json({ discipline: result ? result.value : 'cake' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/config/qos', requireAdmin, async (req, res) => {
  const { discipline } = req.body;
  if (!['cake', 'fq_codel'].includes(discipline)) {
    return res.status(400).json({ error: 'Invalid discipline' });
  }
  try {
    await db.run("INSERT INTO config (key, value) VALUES ('qos_discipline', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [discipline, discipline]);
    
    // Re-init QoS on the active LAN interface immediately
    try {
      const lan = await network.getLanInterface();
      if (lan) {
        console.log(`[API] Re-initializing QoS (${discipline}) on ${lan}...`);
        await network.initQoS(lan, discipline);
        
        // Restore limits for all active devices/sessions because initQoS wipes TC classes
        const activeDevices = await db.all('SELECT mac, ip FROM wifi_devices WHERE is_active = 1');
        const activeSessions = await db.all('SELECT mac, ip FROM sessions WHERE remaining_seconds > 0');
        
        // Merge list to avoid duplicates
        const devicesToRestore = new Map();
        activeDevices.forEach(d => { if(d.mac && d.ip) devicesToRestore.set(d.mac, d.ip); });
        activeSessions.forEach(s => { if(s.mac && s.ip) devicesToRestore.set(s.mac, s.ip); });
        
        console.log(`[API] Restoring limits for ${devicesToRestore.size} devices...`);
        for (const [mac, ip] of devicesToRestore) {
          // whitelistMAC applies both Firewall rules and Traffic Control limits
          await network.whitelistMAC(mac, ip);
        }
      }
    } catch (e) {
      console.error('[API] Failed to re-init QoS:', e.message);
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GAMING PRIORITY API
app.get('/api/gaming/config', requireAdmin, async (req, res) => {
  try {
    const enabled = await db.get("SELECT value FROM config WHERE key = 'gaming_priority_enabled'");
    const percentage = await db.get("SELECT value FROM config WHERE key = 'gaming_priority_percentage'");
    res.json({
      enabled: enabled?.value === '1',
      percentage: parseInt(percentage?.value || '20')
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gaming/config', requireAdmin, async (req, res) => {
  const { enabled, percentage } = req.body;
  try {
    await db.run("INSERT INTO config (key, value) VALUES ('gaming_priority_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [enabled ? '1' : '0', enabled ? '1' : '0']);
    await db.run("INSERT INTO config (key, value) VALUES ('gaming_priority_percentage', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [percentage, percentage]);
    
    // Apply changes
    const lan = await network.getLanInterface();
    if (lan) {
      await network.applyGamingPriority(lan, enabled, percentage);
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gaming/rules', requireAdmin, async (req, res) => {
  try {
    const rules = await db.all("SELECT * FROM gaming_rules");
    res.json(rules);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gaming/rules', requireAdmin, async (req, res) => {
  const { name, protocol, port_start, port_end } = req.body;
  if (!name || !protocol || !port_start || !port_end) return res.status(400).json({ error: 'Missing fields' });
  
  try {
    await db.run("INSERT INTO gaming_rules (name, protocol, port_start, port_end, enabled) VALUES (?, ?, ?, ?, 1)", 
      [name, protocol, port_start, port_end]);
    
    // Re-apply rules
    const enabled = (await db.get("SELECT value FROM config WHERE key = 'gaming_priority_enabled'"))?.value === '1';
    const percentage = parseInt((await db.get("SELECT value FROM config WHERE key = 'gaming_priority_percentage'"))?.value || '20');
    
    if (enabled) {
      const lan = await network.getLanInterface();
      if (lan) {
        await network.applyGamingPriority(lan, true, percentage);
      }
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/gaming/rules/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.run("DELETE FROM gaming_rules WHERE id = ?", [id]);
    
    // Re-apply rules
    const enabled = (await db.get("SELECT value FROM config WHERE key = 'gaming_priority_enabled'"))?.value === '1';
    const percentage = parseInt((await db.get("SELECT value FROM config WHERE key = 'gaming_priority_percentage'"))?.value || '20');
    
    if (enabled) {
      const lan = await network.getLanInterface();
      if (lan) {
        await network.applyGamingPriority(lan, true, percentage);
      }
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rewards/config', requireAdmin, async (req, res) => {
  try {
    const row = await db.get("SELECT value FROM config WHERE key = 'rewards_config'");
    let cfg = {
      enabled: false,
      thresholdPesos: 20,
      rewardCreditPesos: 1
    };

    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (typeof parsed.enabled === 'boolean') {
          cfg.enabled = parsed.enabled;
        }
        const t = parseInt(parsed.thresholdPesos, 10);
        if (!isNaN(t) && t > 0) {
          cfg.thresholdPesos = t;
        }
        const r = parseInt(parsed.rewardCreditPesos, 10);
        if (!isNaN(r) && r >= 0) {
          cfg.rewardCreditPesos = r;
        }
      } catch (e) {}
    }

    res.json(cfg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rewards/config', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const enabled = !!body.enabled;
    const threshold = parseInt(body.thresholdPesos, 10);
    const reward = parseInt(body.rewardCreditPesos, 10);

    if (!threshold || threshold <= 0 || isNaN(threshold) || isNaN(reward) || reward < 0) {
      return res.status(400).json({ error: 'Invalid reward configuration.' });
    }

    const payload = JSON.stringify({
      enabled,
      thresholdPesos: threshold,
      rewardCreditPesos: reward
    });

    await db.run(
      "INSERT INTO config (key, value) VALUES ('rewards_config', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      [payload, payload]
    );

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SYSTEM & CONFIG API
app.get('/api/system/stats', requireAdmin, async (req, res) => {
  try {
    const [cpuLoad, cpuInfo, mem, drive, temp, netStats] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.cpuTemperature(),
      si.networkStats()
    ]);
    
    res.json({
      cpu: {
        manufacturer: cpuInfo.manufacturer,
        brand: cpuInfo.brand,
        speed: cpuInfo.speed,
        cores: cpuInfo.cores,
        load: Math.round(cpuLoad.currentLoad),
        temp: temp.main || 0
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        active: mem.active,
        available: mem.available,
        percentage: Math.round((mem.used / mem.total) * 100)
      },
      storage: {
        total: drive[0].size,
        used: drive[0].used,
        percentage: Math.round(drive[0].use)
      },
      temp: temp.main || 0,
      network: netStats.map(iface => ({
        iface: iface.iface,
        rx_bytes: iface.rx_bytes,
        tx_bytes: iface.tx_bytes,
        rx_sec: iface.rx_sec,
        tx_sec: iface.tx_sec
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/interfaces', requireAdmin, async (req, res) => {
  try {
    const interfaces = await si.networkInterfaces();
    // Return just the interface names to keep it light
    const interfaceNames = interfaces.map(iface => iface.iface);
    // Also include any interfaces from networkStats that might be missing (unlikely but safe)
    const netStats = await si.networkStats();
    const activeInterfaces = netStats.map(n => n.iface);
    
    const allInterfaces = [...new Set([...interfaceNames, ...activeInterfaces])];
    
    res.json(allInterfaces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/info', requireAdmin, async (req, res) => {
  try {
    const [system, os] = await Promise.all([
      si.system(),
      si.osInfo()
    ]);
    
    res.json({
      manufacturer: system.manufacturer,
      model: system.model,
      distro: os.distro,
      arch: os.arch,
      platform: os.platform
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/machine/status', requireAdmin, async (req, res) => {
  try {
    const identity = edgeSync.getIdentity();
    const metrics = await edgeSync.getMetrics();
    
    // Check if pending activation (no vendor_id)
    const status = !identity.vendorId ? 'pending_activation' : 'active';
    
    res.json({
      ...identity,
      status,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', requireAdmin, async (req, res) => {
  try {
    const board = await db.get('SELECT value FROM config WHERE key = ?', ['boardType']);
    const pin = await db.get('SELECT value FROM config WHERE key = ?', ['coinPin']);
    const model = await db.get('SELECT value FROM config WHERE key = ?', ['boardModel']);
    const coinSlots = await db.get('SELECT value FROM config WHERE key = ?', ['coinSlots']);
    const espIpAddress = await db.get('SELECT value FROM config WHERE key = ?', ['espIpAddress']);
    const espPort = await db.get('SELECT value FROM config WHERE key = ?', ['espPort']);
    const nodemcuDevices = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const registrationKey = await db.get('SELECT value FROM config WHERE key = ?', ['registrationKey']);
    const centralPortalIpEnabled = await db.get('SELECT value FROM config WHERE key = ?', ['centralPortalIpEnabled']);
    const centralPortalIp = await db.get('SELECT value FROM config WHERE key = ?', ['centralPortalIp']);
    const relayPin = await db.get('SELECT value FROM config WHERE key = ?', ['relayPin']);
    const relayActiveMode = await db.get('SELECT value FROM config WHERE key = ?', ['relayActiveMode']);
    const mainCoinsOutStats = await db.get('SELECT value FROM config WHERE key = ?', ['main_coins_out_stats']);
    
    res.json({ 
      boardType: board?.value || 'none', 
      coinPin: parseInt(pin?.value || '2'),
      boardModel: model?.value || null,
      espIpAddress: espIpAddress?.value || '192.168.4.1',
      espPort: parseInt(espPort?.value || '80'),
      coinSlots: coinSlots?.value ? JSON.parse(coinSlots.value) : [],
      nodemcuDevices: nodemcuDevices?.value ? JSON.parse(nodemcuDevices.value) : [],
      registrationKey: registrationKey?.value || '7B3F1A9',
      centralPortalIpEnabled: centralPortalIpEnabled?.value === '1' || centralPortalIpEnabled?.value === 'true',
      centralPortalIp: centralPortalIp?.value || '',
      relayPin: relayPin?.value ? parseInt(relayPin.value, 10) : null,
      relayActiveMode: relayActiveMode?.value === 'low' ? 'low' : 'high',
      mainCoinsOutStats: mainCoinsOutStats?.value ? JSON.parse(mainCoinsOutStats.value) : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/config', requireAdmin, async (req, res) => {
  try {
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['boardType', req.body.boardType]);
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['coinPin', req.body.coinPin]);
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['boardModel', req.body.boardModel]);
    
    if (req.body.registrationKey) {
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['registrationKey', req.body.registrationKey]);
    }
    
    if (typeof req.body.centralPortalIpEnabled !== 'undefined') {
      await db.run(
        'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
        ['centralPortalIpEnabled', req.body.centralPortalIpEnabled ? '1' : '0']
      );
    }

    if (typeof req.body.centralPortalIp !== 'undefined') {
      await db.run(
        'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
        ['centralPortalIp', req.body.centralPortalIp || '']
      );
    }

    if (typeof req.body.relayPin !== 'undefined') {
      const relayPinValue = req.body.relayPin === null ? '' : String(req.body.relayPin);
      await db.run(
        'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
        ['relayPin', relayPinValue]
      );
    }

    if (typeof req.body.relayActiveMode !== 'undefined') {
      const mode = req.body.relayActiveMode === 'low' ? 'low' : 'high';
      await db.run(
        'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
        ['relayActiveMode', mode]
      );
    }

    // Handle NodeMCU ESP configuration
    if (req.body.boardType === 'nodemcu_esp') {
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['espIpAddress', req.body.espIpAddress || '192.168.4.1']);
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['espPort', req.body.espPort || '80']);
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['coinSlots', JSON.stringify(req.body.coinSlots || [])]);
      updateGPIO(
        req.body.boardType,
        req.body.coinPin,
        req.body.boardModel,
        req.body.espIpAddress,
        req.body.espPort,
        req.body.coinSlots,
        req.body.nodemcuDevices,
        req.body.relayPin,
        req.body.relayActiveMode
      );
    } else {
      updateGPIO(
        req.body.boardType,
        req.body.coinPin,
        req.body.boardModel,
        null,
        null,
        null,
        req.body.nodemcuDevices,
        req.body.relayPin,
        req.body.relayActiveMode
      );
    }
    
    // Handle multi-NodeMCU devices
    if (req.body.nodemcuDevices !== undefined) {
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(req.body.nodemcuDevices)]);
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/config/central-portal', requireAdmin, async (req, res) => {
  try {
    const enabledRow = await db.get('SELECT value FROM config WHERE key = ?', ['centralPortalIpEnabled']);
    const ipRow = await db.get('SELECT value FROM config WHERE key = ?', ['centralPortalIp']);
    res.json({
      enabled: enabledRow?.value === '1' || enabledRow?.value === 'true',
      ip: ipRow?.value || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/central-portal', requireAdmin, async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const ip = req.body.ip || '';
    await db.run(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['centralPortalIpEnabled', enabled ? '1' : '0']
    );
    await db.run(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['centralPortalIp', ip]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Centralized Key API
app.get('/api/config/centralized-key', requireAdmin, async (req, res) => {
  try {
    const keyRow = await db.get('SELECT value FROM config WHERE key = ?', ['centralizedKey']);
    const syncEnabledRow = await db.get('SELECT value FROM config WHERE key = ?', ['centralizedSyncEnabled']);
    
    res.json({ 
        key: keyRow?.value || '',
        syncEnabled: syncEnabledRow?.value !== '0' // Default to true if not set or '1'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/centralized-key', requireAdmin, async (req, res) => {
  try {
    const { key, syncEnabled } = req.body;
    
    if (typeof key !== 'undefined') {
        await db.run(
          'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
          ['centralizedKey', key]
        );
    }

    if (typeof syncEnabled !== 'undefined') {
        await db.run(
          'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
          ['centralizedSyncEnabled', syncEnabled ? '1' : '0']
        );
    }
    
    // Update EdgeSync instance configuration immediately
    if (edgeSync) {
        if (typeof key !== 'undefined') edgeSync.centralizedKey = key;
        if (typeof syncEnabled !== 'undefined') edgeSync.syncEnabled = syncEnabled;
        
        // Trigger a sync check in background if enabled and key exists
        if (edgeSync.centralizedKey && edgeSync.syncEnabled) {
             try {
                edgeSync.checkCentralizedKey(edgeSync.centralizedKey);
            } catch(e) {
                console.error('Failed to trigger key check:', e);
            }
        }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NODEMCU DEVICE REGISTRATION API
app.post('/api/nodemcu/register', async (req, res) => {
  try {
    const { macAddress, ipAddress, authenticationKey } = req.body;
    
    if (!macAddress || !ipAddress || !authenticationKey) {
      return res.status(400).json({ error: 'Missing required fields: macAddress, ipAddress, authenticationKey' });
    }

    // Validate Registration Key
    const registrationKeyResult = await db.get('SELECT value FROM config WHERE key = ?', ['registrationKey']);
    const serverRegistrationKey = registrationKeyResult?.value || '7B3F1A9'; // Default key if not set

    if (authenticationKey !== serverRegistrationKey) {
       return res.status(401).json({ error: 'Invalid Registration Key' });
    }
    
    // Load existing devices
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    // Check if device already exists (case-insensitive)
    const existingDeviceIndex = existingDevices.findIndex(d => d.macAddress.toUpperCase() === macAddress.toUpperCase());
    if (existingDeviceIndex !== -1) {
       // Update existing device info (e.g. IP might have changed)
       const updatedDevices = [...existingDevices];
       updatedDevices[existingDeviceIndex] = {
         ...updatedDevices[existingDeviceIndex],
         ipAddress,
         lastSeen: new Date().toISOString()
       };
       await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
       
       console.log(`[NODEMCU] Device Heartbeat | Name: ${updatedDevices[existingDeviceIndex].name} | IP: ${ipAddress} | Status: ${updatedDevices[existingDeviceIndex].status}`);

       // Sync heartbeat to cloud immediately
       edgeSync.syncNodeMCUDevice(updatedDevices[existingDeviceIndex]).catch(e => console.error('[NODEMCU] Failed to sync heartbeat:', e));

       const licenseStatus = await nodeMCULicenseManager.verifyLicense(macAddress);
       
       return res.json({
         success: true,
         device: updatedDevices[existingDeviceIndex],
         licensed: Boolean(licenseStatus && licenseStatus.isValid),
         licenseType: licenseStatus?.licenseType || null,
         expiresAt: licenseStatus?.expiresAt || null,
         daysRemaining: licenseStatus?.daysRemaining ?? null,
         frozen: Boolean(licenseStatus && licenseStatus.isValid === false),
         message: 'Device updated'
       });
    }
    
    // Create new pending device
    const newDevice = {
      id: `nodemcu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `NodeMCU-${macAddress.replace(/[:]/g, '').substring(0, 6)}`,
      ipAddress,
      macAddress,
      pin: 12,
      coinPinLabel: 'D6',
      coinPin: 12,
      relayPinLabel: 'D5',
      relayPin: 14,
      status: 'pending',
      vlanId: 13, // Default VLAN, can be changed later
      lastSeen: new Date().toISOString(),
      authenticationKey, // Store the key used for auth (or generate a new specific one?) 
                         // For now, keep using the registration key or generate a session key. 
                         // The user requirement says "validates ... using the Key". 
                         // Usually we'd issue a token, but let's stick to simple key auth for now.
      createdAt: new Date().toISOString(),
      rates: [],
      totalPulses: 0,
      totalRevenue: 0
    };
    
    // Add to devices list
    const updatedDevices = [...existingDevices, newDevice];
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
    
    res.json({
      success: true,
      device: newDevice,
      licensed: false,
      licenseType: null,
      expiresAt: null,
      daysRemaining: null,
      frozen: true
    });
  } catch (err) {
    console.error('Error registering NodeMCU device:', err);
    res.status(500).json({ error: err.message });
  }
});

// NodeMCU device authentication
app.post('/api/nodemcu/authenticate', async (req, res) => {
  try {
    const { macAddress, authenticationKey } = req.body;
    
    if (!macAddress || !authenticationKey) {
      return res.status(400).json({ error: 'Missing required fields: macAddress, authenticationKey' });
    }
    
    // Load existing devices
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    // Find device by MAC address
    const device = existingDevices.find(d => d.macAddress === macAddress);
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Check authentication key
    if (device.authenticationKey !== authenticationKey) {
      return res.status(401).json({ error: 'Invalid authentication key' });
    }
    
    // Update last seen timestamp
    const updatedDevices = existingDevices.map(d => 
      d.macAddress === macAddress 
        ? { ...d, lastSeen: new Date().toISOString() } 
        : d
    );
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
    
    // Log heartbeat if it was previously offline
    const now = new Date().getTime();
    const lastSeen = new Date(device.lastSeen).getTime();
    if ((now - lastSeen) > 15000) {
       console.log(`[NODEMCU] Device RECONNECTED | Name: ${device.name} | MAC: ${macAddress}`);
    }

    res.json({ success: true, device: { ...device, status: device.status } });
  } catch (err) {
    console.error('Error authenticating NodeMCU device:', err);
    res.status(500).json({ error: err.message });
  }
});

// Background task to monitor NodeMCU health
const deviceStatusCache = new Map();

setInterval(async () => {
  try {
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    if (!devicesResult?.value) return;
    
    const devices = JSON.parse(devicesResult.value);
    const now = new Date().getTime();
    const OFFLINE_THRESHOLD = 15000; // Lowered to 15 seconds for faster detection (1.5x heartbeat)

    devices.forEach(device => {
      if (device.status !== 'accepted') return;

      const lastSeen = new Date(device.lastSeen).getTime();
      const isOnline = (now - lastSeen) < OFFLINE_THRESHOLD;
      const previousStatus = deviceStatusCache.get(device.macAddress);

      if (previousStatus === 'online' && !isOnline) {
        console.warn(`[NODEMCU] CRITICAL: Device DISCONNECTED | Name: ${device.name} | MAC: ${device.macAddress} | Last Seen: ${new Date(device.lastSeen).toLocaleTimeString()}`);
        io.emit('nodemcu-status-change', { macAddress: device.macAddress, status: 'offline' });
      } else if (previousStatus === 'offline' && isOnline) {
        console.log(`[NODEMCU] SUCCESS: Device BACK ONLINE | Name: ${device.name} | MAC: ${device.macAddress}`);
        io.emit('nodemcu-status-change', { macAddress: device.macAddress, status: 'online' });
      }

      deviceStatusCache.set(device.macAddress, isOnline ? 'online' : 'offline');
    });
  } catch (err) {
    // Silent fail for background task
  }
}, 5000); // Check every 5 seconds

// NodeMCU pulse reporting API
app.post('/api/nodemcu/pulse', async (req, res) => {
  try {
    const { macAddress, slotId, denomination } = req.body;

    if (!macAddress || !denomination) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Load existing devices
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    // Find device by MAC address (case-insensitive)
    const device = existingDevices.find(d => d.macAddress.toUpperCase() === macAddress.toUpperCase());
    
    if (!device || device.status !== 'accepted') {
      return res.status(403).json({ error: 'Device not authorized' });
    }

    const licenseStatus = await nodeMCULicenseManager.verifyLicense(macAddress);
    if (!licenseStatus || licenseStatus.isValid !== true) {
      return res.status(403).json({
        error: 'YOUR COINSLOT MACHINE IS DISABLED',
        frozen: true,
        licenseType: licenseStatus?.licenseType || null,
        message: 'YOUR COINSLOT MACHINE IS DISABLED'
      });
    }

    // Update device stats
    const updatedDevices = existingDevices.map(d => {
      if (d.macAddress.toUpperCase() === macAddress.toUpperCase()) {
        return {
          ...d,
          totalPulses: (d.totalPulses || 0) + denomination,
          totalRevenue: (d.totalRevenue || 0) + denomination,
          lastSeen: new Date().toISOString()
        };
      }
      return d;
    });

    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);

    // Log to terminal for debugging (similar to local GPIO logs)
    console.log(`[NODEMCU] Pulse Detected | Source: ${device.name} | MAC: ${macAddress} | Amount: ₱${denomination}`);

    // Emit pulse event to all connected clients (Admin and Portal)
    io.emit('nodemcu-pulse', {
      deviceId: device.id,
      deviceName: device.name,
      slotId: slotId || 1,
      denomination,
      macAddress,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error processing NodeMCU pulse:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to accept/reject NodeMCU device
app.post('/api/nodemcu/:deviceId/status', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { status, name, vlanId } = req.body;
    
    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be pending, accepted, or rejected' });
    }
    
    // Load existing devices
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    // Find and update device
    const deviceIndex = existingDevices.findIndex(d => d.id === deviceId);
    if (deviceIndex === -1) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const updatedDevices = [...existingDevices];
    updatedDevices[deviceIndex] = { 
      ...updatedDevices[deviceIndex], 
      status,
      ...(name && { name }),
      ...(vlanId && { vlanId: parseInt(vlanId) })
    };
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
    
    res.json({ success: true, device: updatedDevices[deviceIndex] });
  } catch (err) {
    console.error('Error updating NodeMCU device status:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update NodeMCU device rates
app.post('/api/nodemcu/:deviceId/rates', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { rates } = req.body;
    
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    const deviceIndex = existingDevices.findIndex(d => d.id === deviceId);
    if (deviceIndex === -1) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const updatedDevices = [...existingDevices];
    updatedDevices[deviceIndex] = { ...updatedDevices[deviceIndex], rates };
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
    
    res.json({ success: true, device: updatedDevices[deviceIndex] });
  } catch (err) {
    console.error('Error updating NodeMCU device rates:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update NodeMCU coins-out stats
app.post('/api/nodemcu/:deviceId/coinsout', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { gross, net, share, date } = req.body;
    
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    const deviceIndex = existingDevices.findIndex(d => d.id === deviceId);
    if (deviceIndex === -1) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const updatedDevices = [...existingDevices];
    updatedDevices[deviceIndex] = { 
      ...updatedDevices[deviceIndex], 
      totalRevenue: 0,
      lastCoinsOutGross: gross,
      lastCoinsOutNet: net,
      lastCoinsOutDate: date || new Date().toISOString()
    };
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
    
    // Sync to cloud if needed (optional but recommended)
    try {
      if (edgeSync) {
        // Record history and sync state
        await edgeSync.recordNodeMCUCoinsOut(
            updatedDevices[deviceIndex],
            gross,
            net,
            date || new Date().toISOString()
        );
      }
    } catch (e) {
      console.error('Failed to sync coins-out update to cloud:', e);
    }

    res.json({ success: true, device: updatedDevices[deviceIndex] });
  } catch (err) {
    console.error('Error updating NodeMCU coins-out:', err);
    res.status(500).json({ error: err.message });
  }
});

// List NodeMCU devices
app.get('/api/nodemcu/devices', requireAdmin, async (req, res) => {
  try {
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    res.json(devices);
  } catch (err) {
    console.error('Error fetching NodeMCU devices:', err);
    res.status(500).json({ error: err.message });
  }
});

// Public endpoint for portal to get accepted devices
app.get('/api/nodemcu/available', async (req, res) => {
  try {
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    // Filter only accepted devices and calculate online status
    const now = new Date().getTime();
    const licenseManager = getNodeMCULicenseManager();

    const availableDevices = await Promise.all(devices
      .filter(d => d.status === 'accepted')
      .map(async d => {
        const lastSeen = new Date(d.lastSeen).getTime();
        const isOnline = (now - lastSeen) < 15000; // Online if seen in last 15 seconds
        
        // License Check
        let license = await licenseManager.verifyLicense(d.macAddress);

        // Fallback: Check Local Config for Trial
        if (!license.isValid && d.localLicense && d.localLicense.type === 'trial') {
           const expiresAt = new Date(d.localLicense.expiresAt).getTime();
           if (now < expiresAt) {
             license = {
               isValid: true,
               isActivated: true,
               isExpired: false,
               licenseType: 'trial',
               canStartTrial: false
             };
           }
        }

        return {
          id: d.id,
          name: d.name,
          macAddress: d.macAddress,
          isOnline,
          vlanId: d.vlanId,
          rates: d.rates || [],
          license: {
            isValid: license.isValid,
            isTrial: license.licenseType === 'trial',
            isExpired: license.isExpired,
            error: license.error
          }
        };
      }));
      
    res.json(availableDevices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific NodeMCU status
app.get('/api/nodemcu/status/:mac', async (req, res) => {
  try {
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    const device = devices.find(d => d.macAddress.toUpperCase() === req.params.mac.toUpperCase());
    
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    const now = new Date().getTime();
    const lastSeen = new Date(device.lastSeen).getTime();
    const isOnline = (now - lastSeen) < 15000;
    
    // License Check
    const licenseManager = getNodeMCULicenseManager();
    let license = await licenseManager.verifyLicense(device.macAddress);

    // Fallback: Check Local Config for Trial if Supabase verification failed or returned invalid
    if (!license.isValid && device.localLicense && device.localLicense.type === 'trial') {
      const nowTs = Date.now();
      const expiresAt = new Date(device.localLicense.expiresAt).getTime();
      const isValid = nowTs < expiresAt;
      
      if (isValid) {
        license = {
          isValid: true,
          isActivated: true,
          isExpired: false,
          licenseType: 'trial',
          canStartTrial: false
        };
      }
    }

    res.json({ 
      online: isOnline, 
      lastSeen: device.lastSeen,
      license: {
        isValid: license.isValid,
        isTrial: license.licenseType === 'trial',
        isExpired: license.isExpired,
        error: license.error
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single NodeMCU device
app.get('/api/nodemcu/:deviceId', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    const device = devices.find(d => d.id === deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(device);
  } catch (err) {
    console.error('Error fetching NodeMCU device:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update NodeMCU device config (name, VLAN, pin)
app.post('/api/nodemcu/:deviceId/config', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, vlanId, pin, coinPinLabel, coinPin, relayPinLabel, relayPin } = req.body;
    
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    const deviceIndex = existingDevices.findIndex(d => d.id === deviceId);
    if (deviceIndex === -1) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const previousDevice = existingDevices[deviceIndex];

    const requestedCoinLabel = normalizeNodeMcuDPinLabel(coinPinLabel);
    const requestedRelayLabel = normalizeNodeMcuDPinLabel(relayPinLabel);

    if (coinPinLabel !== undefined && requestedCoinLabel === null) {
      return res.status(400).json({ error: 'Invalid coinPinLabel. Use D0-D8.' });
    }

    if (requestedCoinLabel === 'D0') {
      return res.status(400).json({ error: 'Coin pin cannot be D0 on ESP8266 (no interrupt).' });
    }

    if (relayPinLabel !== undefined && requestedRelayLabel === null) {
      return res.status(400).json({ error: 'Invalid relayPinLabel. Use D0-D8.' });
    }

    const requestedCoinGpio =
      typeof coinPin === 'number' ? coinPin :
      typeof pin === 'number' ? pin :
      requestedCoinLabel ? nodeMcuDPinLabelToGpio(requestedCoinLabel) :
      null;

    const requestedRelayGpio =
      typeof relayPin === 'number' ? relayPin :
      requestedRelayLabel ? nodeMcuDPinLabelToGpio(requestedRelayLabel) :
      null;

    if (typeof requestedCoinGpio === 'number' && nodeMcuGpioToDPinLabel(requestedCoinGpio) === null) {
      return res.status(400).json({ error: 'Invalid coinPin GPIO for NodeMCU. Use D0-D8 mapping.' });
    }

    if (typeof requestedCoinGpio === 'number' && requestedCoinGpio === 16) {
      return res.status(400).json({ error: 'Coin pin cannot be D0/GPIO16 on ESP8266 (no interrupt).' });
    }

    if (typeof requestedRelayGpio === 'number' && nodeMcuGpioToDPinLabel(requestedRelayGpio) === null) {
      return res.status(400).json({ error: 'Invalid relayPin GPIO for NodeMCU. Use D0-D8 mapping.' });
    }

    const nextCoinGpio = typeof requestedCoinGpio === 'number' ? requestedCoinGpio : (previousDevice.coinPin ?? previousDevice.pin ?? 12);
    const nextRelayGpio = typeof requestedRelayGpio === 'number' ? requestedRelayGpio : (previousDevice.relayPin ?? 14);

    const nextCoinLabel = requestedCoinLabel || previousDevice.coinPinLabel || nodeMcuGpioToDPinLabel(nextCoinGpio) || 'D6';
    const nextRelayLabel = requestedRelayLabel || previousDevice.relayPinLabel || nodeMcuGpioToDPinLabel(nextRelayGpio) || 'D5';

    const updatedDevices = [...existingDevices];
    updatedDevices[deviceIndex] = {
      ...previousDevice,
      name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : previousDevice.name,
      vlanId: typeof vlanId === 'number' ? vlanId : previousDevice.vlanId,
      pin: nextCoinGpio,
      coinPin: nextCoinGpio,
      coinPinLabel: nextCoinLabel,
      relayPin: nextRelayGpio,
      relayPinLabel: nextRelayLabel
    };
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);

    const prevCoinGpio = previousDevice.coinPin ?? previousDevice.pin ?? 12;
    const prevRelayGpio = previousDevice.relayPin ?? 14;
    const prevCoinLabel = previousDevice.coinPinLabel || nodeMcuGpioToDPinLabel(prevCoinGpio) || 'D6';
    const prevRelayLabel = previousDevice.relayPinLabel || nodeMcuGpioToDPinLabel(prevRelayGpio) || 'D5';

    const pinsChanged = (nextCoinGpio !== prevCoinGpio) || (nextRelayGpio !== prevRelayGpio) || (nextCoinLabel !== prevCoinLabel) || (nextRelayLabel !== prevRelayLabel);

    let deviceApply = null;
    if (pinsChanged) {
      deviceApply = await pushNodeMCUPinsToDevice(updatedDevices[deviceIndex], {
        coinPinGpio: nextCoinGpio,
        relayPinGpio: nextRelayGpio
      });
    }

    res.json({ success: true, device: updatedDevices[deviceIndex], applied: deviceApply });
  } catch (err) {
    console.error('Error updating NodeMCU device config:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete NodeMCU device
app.delete('/api/nodemcu/:deviceId', requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const existingDevices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    
    const updatedDevices = existingDevices.filter(d => d.id !== deviceId);
    
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['nodemcuDevices', JSON.stringify(updatedDevices)]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting NodeMCU device:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update NodeMCU Firmware
app.post('/api/nodemcu/:deviceId/update', requireAdmin, uploadFirmware.single('firmware'), async (req, res) => {
  try {
    const { deviceId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No firmware file uploaded' });
    }

    const devicesResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    const devices = devicesResult?.value ? JSON.parse(devicesResult.value) : [];
    const device = devices.find(d => d.id === deviceId);

    if (!device) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Device not found' });
    }

    if (!device.ipAddress) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Device IP address not found. Make sure it has registered recently.' });
    }

    const formData = new FormData();
    const fileBuffer = fs.readFileSync(req.file.path);
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append('update', blob, 'firmware.bin');

    console.log(`Updating NodeMCU ${device.macAddress} at ${device.ipAddress}...`);
    
    const response = await fetch(`http://${device.ipAddress}/update`, {
      method: 'POST',
      body: formData
    });

    // Clean up temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    if (response.ok) {
      res.json({ success: true, message: 'Firmware update started successfully' });
    } else {
      const errorText = await response.text();
      res.status(response.status).json({ error: `Update failed: ${errorText}` });
    }
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Error updating NodeMCU firmware:', err);
    res.status(500).json({ error: err.message });
  }
});

// PORTAL CONFIG API
app.get('/api/portal/config', async (req, res) => {
  try {
    const config = await db.get('SELECT value FROM config WHERE key = ?', ['portal_config']);
    res.json(config?.value ? JSON.parse(config.value) : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/portal/config', requireAdmin, async (req, res) => {
  try {
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['portal_config', JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/system/reset', requireAdmin, async (req, res) => {
  try {
    await db.factoryResetDB();
    await network.cleanupAllNetworkSettings();
    
    // Clear uploads directory
    const uploadsDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadsDir)) {
        console.log('[System] Cleaning uploads directory...');
        try {
            fs.rmSync(uploadsDir, { recursive: true, force: true });
            fs.mkdirSync(path.join(uploadsDir, 'audio'), { recursive: true });
        } catch (e) {
            console.error('[System] Failed to clean uploads:', e.message);
        }
    }

    // Additional System Cleanup for Image Preparation
    try {
        console.log('[System] Performing deep system cleanup...');
        
        // 1. PM2 and Logs
        await execPromise('pm2 flush').catch(() => {});
        await execPromise('journalctl --vacuum-time=1s').catch(() => {});
        await execPromise('rm -rf ~/.pm2/logs/*').catch(() => {});
        
        // 2. Shell History (for all users)
        await execPromise('rm -f /root/.bash_history').catch(() => {});
        await execPromise('rm -f /home/*/.bash_history').catch(() => {});
        
        // 3. ZeroTier Identity (so cloned images get new IDs)
        if (fs.existsSync('/var/lib/zerotier-one')) {
             await execPromise('rm -f /var/lib/zerotier-one/identity.secret').catch(() => {});
             await execPromise('rm -f /var/lib/zerotier-one/identity.public').catch(() => {});
             await execPromise('rm -rf /var/lib/zerotier-one/networks.d/*').catch(() => {});
        }

        // 4. DHCP Client Leases (if any)
        await execPromise('rm -f /var/lib/dhcp/*').catch(() => {});
        await execPromise('rm -f /var/lib/dhcpcd/*').catch(() => {});
        
    } catch (e) {
        console.error('[System] Cleanup warning:', e.message);
    }

    // Send success response first
    res.json({ success: true, message: 'System reset complete. Rebooting now...' });
    
    // Trigger reboot to ensure fresh state
    console.log('[System] Factory reset completed. Initiating reboot...');
    setTimeout(() => {
        exec('sudo reboot', (error) => {
            if (error) {
                console.error(`[System] Reboot failed: ${error.message}`);
            }
        });
    }, 3000);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/backup', requireAdmin, async (req, res) => {
  try {
    const zip = new AdmZip();
    const exclude = ['node_modules', '.git', '.next', 'dist', 'uploads', 'package-lock.json'];
    
    // Add files from root
    const rootFiles = fs.readdirSync(__dirname);
    for (const file of rootFiles) {
      if (exclude.includes(file)) continue;
      
      const filePath = path.join(__dirname, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
         zip.addLocalFolder(filePath, file);
      } else {
        zip.addLocalFile(filePath);
      }
    }
    
    // Special handling for uploads (only audio)
    if (fs.existsSync(path.join(__dirname, 'uploads/audio'))) {
        zip.addLocalFolder(path.join(__dirname, 'uploads/audio'), 'uploads/audio');
    }

    const buffer = zip.toBuffer();
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.nxs`;
    
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename=${filename}`);
    res.set('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Backup failed:', err);
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

app.post('/api/system/restore', requireAdmin, uploadBackup.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
    // Attempt to close DB to avoid lock issues on Windows
    try {
        await db.close();
    } catch (e) {
        console.warn('Could not close DB:', e);
    }

    const zip = new AdmZip(req.file.path);
    // Extract everything, overwriting existing files
    zip.extractAllTo(__dirname, true);
    
    // Cleanup
    fs.unlinkSync(req.file.path);
    
    res.json({ success: true, message: 'System restored successfully. Restarting...' });
    
    // Restart logic
    setTimeout(() => {
        process.exit(0); // PM2 should restart it
    }, 2000);
  } catch (err) {
    console.error('Restore failed:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// SYSTEM UPDATE UTILITY FUNCTION
async function applyUpdate(filePath, res) {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    // Extract each entry unless it's the database
    zipEntries.forEach((entry) => {
        if (entry.entryName !== 'pisowifi.sqlite' && !entry.entryName.includes('pisowifi.sqlite')) {
            zip.extractEntryTo(entry, __dirname, true, true);
        }
    });
    
    // Cleanup uploaded update package
    fs.unlinkSync(filePath);
    
    // Run dependency install and build, then reboot entire system
    res.json({ success: true, message: 'System update applied. Running npm install, build, and rebooting...' });
    
    setTimeout(async () => {
        try {
            await execPromise('npm install --unsafe-perm --no-audit --no-fund --build-from-source', {
                cwd: __dirname
            });
        } catch (e) {
            console.error('[System Update] npm install failed:', e.message || e);
        }

        try {
            await execPromise('npm run build', {
                cwd: __dirname
            });
        } catch (e) {
            console.error('[System Update] npm run build failed:', e.message || e);
        }

        try {
            await execPromise('sync').catch(() => {});
        } catch (_) {}

        try {
            exec('sudo reboot').unref();
        } catch (e) {
            console.error('[System Update] Reboot command failed:', e.message || e);
            try {
                process.exit(0);
            } catch (_) {}
        }
    }, 2000);
  } catch (err) {
    console.error('Update failed:', err);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
}

app.post('/api/system/update', requireAdmin, uploadBackup.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  await applyUpdate(req.file.path, res);
});

// CLOUD UPDATE API
app.get('/api/system/available-updates', requireAdmin, async (req, res) => {
    try {
        if (!edgeSync.supabase) {
             return res.status(503).json({ error: 'Cloud sync not configured' });
        }
        
        // List files in 'UPDATE FILE' bucket (as requested by user)
        // We prioritize this bucket name, but fall back to 'updates' and 'firmware'
        const primaryBucket = 'UPDATE FILE';
        
        const { data, error } = await edgeSync.supabase.storage
            .from(primaryBucket)
            .list('', {
                limit: 10,
                offset: 0,
                sortBy: { column: 'created_at', order: 'desc' },
            });
            
        if (error) {
            console.warn(`[Cloud Update] Primary bucket '${primaryBucket}' error:`, error.message);
            
            // Fallback 1: 'updates'
            const { data: updatesData, error: updatesError } = await edgeSync.supabase.storage
                .from('updates')
                .list('', { limit: 10, sortBy: { column: 'created_at', order: 'desc' } });
                
            if (!updatesError && updatesData) {
                const updates = updatesData.filter(f => f.name.endsWith('.nxs'));
                return res.json(updates.map(u => ({ ...u, bucket: 'updates' })));
            }
            
            // Fallback 2: 'firmware'
            const { data: fwData, error: fwError } = await edgeSync.supabase.storage
                .from('firmware')
                .list('', { limit: 10, sortBy: { column: 'created_at', order: 'desc' } });
                
            if (!fwError && fwData) {
                const updates = fwData.filter(f => f.name.endsWith('.nxs'));
                return res.json(updates.map(u => ({ ...u, bucket: 'firmware' })));
            }
            
            // If all fail, throw the original error or a generic one
            throw error || updatesError || new Error('No update buckets found');
        }
        
        // Filter for .nxs files
        const updates = data.filter(f => f.name.endsWith('.nxs'));
        res.json(updates.map(u => ({ ...u, bucket: primaryBucket })));
    } catch (err) {
        console.error('[Cloud Update] Failed to list updates:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/system/download-and-update', requireAdmin, async (req, res) => {
    const { filename, bucket } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });
    // Default to 'UPDATE FILE' if not specified, as requested by user
    const bucketName = bucket || 'UPDATE FILE';

    try {
        if (!edgeSync.supabase) {
             return res.status(503).json({ error: 'Cloud sync not configured' });
        }

        console.log(`[System Update] Downloading ${filename} from bucket ${bucketName}...`);
        
        const { data, error } = await edgeSync.supabase.storage
            .from(bucketName)
            .download(filename);

        if (error) throw error;
        
        // Save to temp file
        const tempPath = path.join(__dirname, 'uploads/backups', `cloud_update_${Date.now()}.nxs`);
        
        // Ensure directory exists
        const dir = path.dirname(tempPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Convert Blob/File to Buffer
        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        fs.writeFileSync(tempPath, buffer);
        console.log(`[System Update] Downloaded to ${tempPath}`);
        
        // Apply update
        await applyUpdate(tempPath, res);
        
    } catch (err) {
        console.error('[System Update] Cloud update failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// NETWORK API
app.get('/api/interfaces', requireAdmin, async (req, res) => {
  try { res.json(await network.getInterfaces()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hotspots', requireAdmin, async (req, res) => {
  try { res.json(await db.all('SELECT * FROM hotspots')); } catch (err) { res.json([]); }
});

app.get('/api/network/wireless', requireAdmin, async (req, res) => {
  try { res.json(await db.all('SELECT * FROM wireless_settings')); } catch (err) { res.json([]); }
});

app.post('/api/network/wireless', requireAdmin, async (req, res) => {
  try {
    await db.run('INSERT OR REPLACE INTO wireless_settings (interface, ssid, password, bridge) VALUES (?, ?, ?, ?)', [req.body.interface, req.body.ssid, req.body.password, req.body.bridge]);
    await network.configureWifiAP(req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/hotspots', requireAdmin, async (req, res) => {
  try {
    const bw = Number.isFinite(Number(req.body.bandwidth_limit)) ? Number(req.body.bandwidth_limit) : null;
    await db.run(
      'INSERT OR REPLACE INTO hotspots (interface, ip_address, dhcp_range, bandwidth_limit, enabled) VALUES (?, ?, ?, ?, 1)',
      [req.body.interface, req.body.ip_address, req.body.dhcp_range, bw]
    );
    await network.setupHotspot(req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/hotspots/:interface', requireAdmin, async (req, res) => {
  try {
    await network.removeHotspot(req.params.interface);
    await db.run('DELETE FROM hotspots WHERE interface = ?', [req.params.interface]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/vlans', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM vlans');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/vlan', requireAdmin, async (req, res) => {
  try {
    const { parent, id } = req.body;
    if (!parent || !id) {
      return res.status(400).json({ error: 'Parent interface and VLAN ID are required' });
    }
    const createdName = await network.createVlan(req.body);
    await db.run('INSERT OR REPLACE INTO vlans (name, parent, id) VALUES (?, ?, ?)', 
      [createdName, parent, id]);
    res.json({ success: true, name: createdName });
  } catch (err) { 
    console.error('[VLAN] Create Error:', err);
    res.status(500).json({ error: err.message }); 
  }
});

app.post('/api/network/vlans/bulk', requireAdmin, async (req, res) => {
  const makeSafeVlanName = (parent, id) => {
    const base = String(parent || '').split('.')[0];
    const suffix = `.${id}`;
    const maxLen = 15;
    const candidate = `${base}${suffix}`;
    if (candidate.length <= maxLen) return candidate;
    const allowed = maxLen - suffix.length;
    if (allowed <= 0) return `v${id}`;
    return `${base.slice(0, allowed)}${suffix}`;
  };

  const computeHotspotConfigForVlanId = (vlanId, netmask, bandwidthLimit) => {
    const x = Math.max(0, Number(vlanId) - 1);
    const oct2 = Math.floor(x / 254);
    const oct3 = (x % 254) + 1;
    const ipBase = `10.${oct2}.${oct3}`;
    return {
      ip_address: `${ipBase}.1`,
      dhcp_range: `${ipBase}.50,${ipBase}.250`,
      netmask: String(netmask || '255.255.255.0'),
      bandwidth_limit: Number.isFinite(Number(bandwidthLimit)) ? Number(bandwidthLimit) : 10
    };
  };

  try {
    const parent = String(req.body?.parent || '');
    const createHotspots = Boolean(req.body?.createHotspots);
    const netmask = req.body?.netmask || '255.255.255.0';
    const bandwidthLimit = req.body?.bandwidth_limit;

    if (!parent) return res.status(400).json({ error: 'Parent interface is required' });

    let ids = [];
    if (Array.isArray(req.body?.ids)) {
      ids = req.body.ids;
    } else if (req.body?.range && (req.body.range.start || req.body.range.start === 0) && (req.body.range.end || req.body.range.end === 0)) {
      const start = Number(req.body.range.start);
      const end = Number(req.body.range.end);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return res.status(400).json({ error: 'Range start/end must be integers' });
      }
      if (end < start) return res.status(400).json({ error: 'Range end must be >= start' });
      ids = Array.from({ length: (end - start) + 1 }, (_, i) => start + i);
    } else {
      return res.status(400).json({ error: 'Provide ids[] or range{start,end}' });
    }

    const normalized = Array.from(
      new Set(
        ids
          .map(n => Number(n))
          .filter(n => Number.isInteger(n) && n >= 1 && n <= 4094)
      )
    ).sort((a, b) => a - b);

    if (normalized.length === 0) return res.status(400).json({ error: 'No valid VLAN IDs provided (1-4094)' });
    if (normalized.length > 512) return res.status(400).json({ error: 'Too many VLAN IDs (max 512 per request)' });

    const results = [];
    let hotspotsConfigured = 0;
    let hotspotsSkipped = 0;

    for (const id of normalized) {
      const vlanName = makeSafeVlanName(parent, id);
      const existingVlan = await db.get('SELECT name FROM vlans WHERE name = ?', [vlanName]).catch(() => null);
      try {
        const createdName = await network.createVlan({ parent, id, name: vlanName });
        await db.run('INSERT OR REPLACE INTO vlans (name, parent, id) VALUES (?, ?, ?)', [createdName, parent, id]);

        let hotspot = { status: 'skipped' };
        if (createHotspots) {
          const existingHotspot = await db.get('SELECT interface FROM hotspots WHERE interface = ?', [createdName]).catch(() => null);
          if (existingHotspot) {
            hotspot = { status: 'exists' };
            hotspotsSkipped += 1;
          } else {
            const hs = computeHotspotConfigForVlanId(id, netmask, bandwidthLimit);
            await db.run(
              'INSERT OR REPLACE INTO hotspots (interface, ip_address, dhcp_range, bandwidth_limit, enabled) VALUES (?, ?, ?, ?, 1)',
              [createdName, hs.ip_address, hs.dhcp_range, hs.bandwidth_limit]
            );
            await network.setupHotspot({ interface: createdName, ip_address: hs.ip_address, dhcp_range: hs.dhcp_range, netmask: hs.netmask, bandwidth_limit: hs.bandwidth_limit }, true);
            hotspot = { status: 'created', ip_address: hs.ip_address, dhcp_range: hs.dhcp_range };
            hotspotsConfigured += 1;
          }
        }

        results.push({
          id,
          name: createdName,
          status: existingVlan ? 'exists' : 'created',
          hotspot
        });
      } catch (e) {
        results.push({
          id,
          name: vlanName,
          status: 'failed',
          error: e.message || String(e)
        });
      }
    }

    let dnsmasqRestarted = false;
    let dnsmasqRestartError = null;
    if (createHotspots && hotspotsConfigured > 0) {
      try {
        await network.restartDnsmasq();
        dnsmasqRestarted = true;
      } catch (e) {
        dnsmasqRestartError = e.message || String(e);
      }
    }

    const summary = results.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === 'created') acc.created += 1;
        else if (r.status === 'exists') acc.exists += 1;
        else acc.failed += 1;
        return acc;
      },
      { total: 0, created: 0, exists: 0, failed: 0, hotspots_created: hotspotsConfigured, hotspots_exists: hotspotsSkipped }
    );

    res.json({ success: true, parent, ids: normalized, createHotspots, summary, dnsmasqRestarted, dnsmasqRestartError, results });
  } catch (err) {
    console.error('[VLAN] Bulk Create Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/network/vlan/:name', requireAdmin, async (req, res) => {
  try {
    await network.deleteVlan(req.params.name);
    await db.run('DELETE FROM vlans WHERE name = ?', [req.params.name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/bridges', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM bridges');
    // Parse members JSON
    const bridges = rows.map(b => ({
      ...b,
      members: JSON.parse(b.members),
      stp: Boolean(b.stp)
    }));
    res.json(bridges);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/bridge', requireAdmin, async (req, res) => {
  try {
    const output = await network.createBridge(req.body);
    await db.run('INSERT OR REPLACE INTO bridges (name, members, stp) VALUES (?, ?, ?)', 
      [req.body.name, JSON.stringify(req.body.members), req.body.stp ? 1 : 0]);
    res.json({ success: true, output });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/network/bridge/:name', requireAdmin, async (req, res) => {
  try {
    await network.deleteBridge(req.params.name);
    await db.run('DELETE FROM bridges WHERE name = ?', [req.params.name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ZEROTIER API
app.get('/api/zerotier/status', requireAdmin, async (req, res) => {
  try {
    const status = await getZeroTierStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/zerotier/install', requireAdmin, async (req, res) => {
  try {
    if (zeroTierInstallState.running) {
      return res.status(400).json({
        error: 'ZeroTier installation is already in progress',
        status: zeroTierInstallState
      });
    }

    const currentStatus = await getZeroTierStatus();
    if (currentStatus.installed) {
      return res.status(400).json({
        error: 'ZeroTier is already installed',
        status: currentStatus
      });
    }

    resetZeroTierInstallState();
    zeroTierInstallState.running = true;
    zeroTierInstallState.progress = 5;
    zeroTierInstallState.startedAt = Date.now();
    zeroTierInstallState.lastUpdateAt = Date.now();

    // Use official install script. The AJC service is expected to run with sufficient privileges.
    const installCommand = 'curl -s https://install.zerotier.com | bash';

    zeroTierInstallProcess = spawn('bash', ['-c', installCommand], {
      env: process.env
    });

    appendZeroTierLog('[Installer] Starting ZeroTier installation...');

    zeroTierInstallProcess.stdout.on('data', (data) => {
      appendZeroTierLog(data);
      if (zeroTierInstallState.progress < 90) {
        zeroTierInstallState.progress = Math.min(90, zeroTierInstallState.progress + 3);
      }
    });

    zeroTierInstallProcess.stderr.on('data', (data) => {
      appendZeroTierLog('[stderr] ' + data.toString());
      if (zeroTierInstallState.progress < 90) {
        zeroTierInstallState.progress = Math.min(90, zeroTierInstallState.progress + 2);
      }
    });

    zeroTierInstallProcess.on('error', (err) => {
      appendZeroTierLog('[Installer] Failed to start: ' + err.message);
      zeroTierInstallState.running = false;
      zeroTierInstallState.success = false;
      zeroTierInstallState.error = err.message;
      zeroTierInstallState.finishedAt = Date.now();
    });

    zeroTierInstallProcess.on('close', async (code) => {
      zeroTierInstallProcess = null;
      zeroTierInstallState.running = false;
      zeroTierInstallState.finishedAt = Date.now();

      if (code === 0) {
        zeroTierInstallState.success = true;
        zeroTierInstallState.progress = 100;
        appendZeroTierLog('[Installer] ZeroTier installation completed successfully.');

        // Refresh status to ensure CLI and service are visible
        try {
          const status = await getZeroTierStatus();
          appendZeroTierLog(`[Installer] Detected ZeroTier node ${status.nodeId || 'unknown'} (online=${status.online}).`);
        } catch (e) {
          appendZeroTierLog('[Installer] Post-install status check failed: ' + (e && e.message ? e.message : String(e)));
        }
      } else {
        zeroTierInstallState.success = false;
        zeroTierInstallState.error = `Installer exited with code ${code}`;
        if (zeroTierInstallState.progress < 100) {
          zeroTierInstallState.progress = Math.max(zeroTierInstallState.progress, 50);
        }
        appendZeroTierLog(`[Installer] ZeroTier installation failed with exit code ${code}.`);
      }
    });

    res.json({
      success: true,
      message: 'ZeroTier installation started',
      status: zeroTierInstallState
    });
  } catch (err) {
    zeroTierInstallState.running = false;
    zeroTierInstallState.success = false;
    zeroTierInstallState.error = err.message;
    zeroTierInstallState.finishedAt = Date.now();
    appendZeroTierLog('[Installer] Error while starting installation: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/zerotier/install-status', requireAdmin, async (req, res) => {
  try {
    res.json(zeroTierInstallState);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/zerotier/join', requireAdmin, async (req, res) => {
  try {
    const networkId = (req.body && typeof req.body.networkId === 'string') ? req.body.networkId.trim() : '';
    if (!networkId) {
      return res.status(400).json({ error: 'Network ID is required' });
    }

    if (!/^[0-9a-fA-F]{16}$/.test(networkId)) {
      return res.status(400).json({ error: 'Network ID must be a 16-character hexadecimal string' });
    }

    const status = await getZeroTierStatus();
    if (!status.installed) {
      return res.status(400).json({ error: 'ZeroTier is not installed' });
    }

    const { stdout, stderr } = await execPromise(`zerotier-cli join ${networkId}`);
    const output = (stdout || '').toString().trim();
    const errorOutput = (stderr || '').toString().trim();

    if (errorOutput && !output) {
      return res.status(500).json({
        error: 'ZeroTier join failed',
        details: errorOutput
      });
    }

    res.json({
      success: true,
      message: 'Join command sent to ZeroTier',
      output,
      details: errorOutput
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/zerotier/leave', requireAdmin, async (req, res) => {
  try {
    const networkId = (req.body && typeof req.body.networkId === 'string') ? req.body.networkId.trim() : '';
    if (!networkId) {
      return res.status(400).json({ error: 'Network ID is required' });
    }

    if (!/^[0-9a-fA-F]{16}$/.test(networkId)) {
      return res.status(400).json({ error: 'Network ID must be a 16-character hexadecimal string' });
    }

    const status = await getZeroTierStatus();
    if (!status.installed) {
      return res.status(400).json({ error: 'ZeroTier is not installed' });
    }

    const { stdout, stderr } = await execPromise(`zerotier-cli leave ${networkId}`);
    const output = (stdout || '').toString().trim();
    const errorOutput = (stderr || '').toString().trim();

    if (errorOutput && !output) {
      return res.status(500).json({
        error: 'ZeroTier leave failed',
        details: errorOutput
      });
    }

    res.json({
      success: true,
      message: 'Leave command sent to ZeroTier',
      output,
      details: errorOutput
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NODEMCU FLASHER API
app.get('/api/system/usb-devices', requireAdmin, async (req, res) => {
  try {
    const devices = [];
    
    // Try using serialport if available
    try {
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      ports.forEach(port => {
        // Filter for likely candidates (USB/ACM)
        if (port.path.includes('USB') || port.path.includes('ACM') || port.path.includes('COM')) {
             devices.push({
               path: port.path,
               manufacturer: port.manufacturer,
               serialNumber: port.serialNumber,
               pnpId: port.pnpId
             });
        }
      });
    } catch (e) {
      // Fallback to fs listing of /dev/
      try {
        const files = await fs.promises.readdir('/dev');
        const serialPorts = files.filter(f => f.startsWith('ttyUSB') || f.startsWith('ttyACM'));
        serialPorts.forEach(port => {
          devices.push({
            path: `/dev/${port}`,
            manufacturer: 'Unknown',
            serialNumber: 'Unknown'
          });
        });
      } catch (err) {
        // Ignore fs errors (e.g. on Windows without /dev)
      }
    }
    
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/flash-nodemcu', requireAdmin, async (req, res) => {
  const { port } = req.body;
  if (!port) return res.status(400).json({ error: 'Port is required' });

  const firmwarePath = '/opt/ajc-pisowifi/firmware/NodeMCU_ESP8266/build/esp8266.esp8266.huzzah/NodeMCU_ESP8266.ino.bin';
  
  // Verify firmware exists
  if (!fs.existsSync(firmwarePath)) {
    // For dev/test on Windows, we might accept a local path or skip check if hardcoded
    // But for production as requested:
    return res.status(404).json({ error: 'Firmware binary not found at ' + firmwarePath });
  }

  // Construct command
  // esptool.py --port /dev/ttyUSB0 --baud 115200 write_flash 0x00000 <firmware>
  // We assume esptool is in PATH or we can call it. 
  
  const cmd = `esptool --port ${port} --baud 115200 write_flash -fm dio -fs 4MB 0x00000 "${firmwarePath}"`;
  
  console.log(`[Flasher] Executing: ${cmd}`);
  
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Flasher] Error: ${error.message}`);
      return res.status(500).json({ success: false, error: error.message, details: stderr });
    }
    console.log(`[Flasher] Success: ${stdout}`);
    res.json({ success: true, message: 'Flash complete', output: stdout });
  });
});

// BANDWIDTH MANAGEMENT API ENDPOINTS
app.get('/api/bandwidth/settings', requireAdmin, async (req, res) => {
  try {
    // Get default bandwidth settings
    const defaultDL = await db.get("SELECT value FROM config WHERE key = 'default_download_limit'");
    const defaultUL = await db.get("SELECT value FROM config WHERE key = 'default_upload_limit'");
    const autoApply = await db.get("SELECT value FROM config WHERE key = 'auto_apply_bandwidth'");
    
    res.json({
      defaultDownloadLimit: defaultDL ? parseInt(defaultDL.value) : 5,
      defaultUploadLimit: defaultUL ? parseInt(defaultUL.value) : 5,
      autoApplyToNew: autoApply ? autoApply.value === '1' : true
    });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

app.post('/api/bandwidth/settings', requireAdmin, async (req, res) => {
  try { 
    const { defaultDownloadLimit, defaultUploadLimit, autoApplyToNew } = req.body;
    
    // Validate inputs
    if (typeof defaultDownloadLimit !== 'number' || typeof defaultUploadLimit !== 'number') {
      return res.status(400).json({ error: 'Download and upload limits must be numbers' });
    }
    
    if (defaultDownloadLimit < 0 || defaultUploadLimit < 0) {
      return res.status(400).json({ error: 'Limits cannot be negative' });
    }
    
    // Save settings to database
    await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('default_download_limit', ?)", [defaultDownloadLimit.toString()]);
    await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('default_upload_limit', ?)", [defaultUploadLimit.toString()]);
    await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('auto_apply_bandwidth', ?)", [autoApplyToNew ? '1' : '0']);
    
    res.json({ success: true }); 
  }
  catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// PPPoE SERVER API ENDPOINTS
app.get('/api/network/pppoe/status', requireAdmin, async (req, res) => {
  try {
    const status = await network.getPPPoEServerStatus();
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/start', requireAdmin, async (req, res) => {
  try {
    const { interface: iface, local_ip, ip_pool_start, ip_pool_end, dns1, dns2, service_name } = req.body;
    
    if (!iface || !local_ip || !ip_pool_start || !ip_pool_end) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const result = await network.startPPPoEServer({
      interface: iface,
      local_ip,
      ip_pool_start,
      ip_pool_end,
      dns1,
      dns2,
      service_name
    });
    
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/stop', requireAdmin, async (req, res) => {
  try {
    const { interface: iface } = req.body || {};
    const result = await network.stopPPPoEServer(iface || '');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/sessions', requireAdmin, async (req, res) => {
  try {
    const sessions = await network.getPPPoESessions();
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/users', requireAdmin, async (req, res) => {
  try {
    const users = await network.getPPPoEUsers();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/users/:id/form.pdf', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(String(req.params.id), 10);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid id' });

    const user = await db.get(
      `SELECT u.*, bp.name as billing_profile_name, bp.price as amount, p.name as profile_name
       FROM pppoe_users u
       LEFT JOIN pppoe_billing_profiles bp ON bp.id = u.billing_profile_id
       LEFT JOIN pppoe_profiles p ON p.id = bp.profile_id
       WHERE u.id = ?`,
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const safeBase = String(user.account_number || user.username || `user_${userId}`)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    const outputPath = path.join(PPPoE_FORMS_DIR, `${safeBase}.pdf`);

    const generated_at = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const generatedText = `${generated_at.getFullYear()}-${pad(generated_at.getMonth() + 1)}-${pad(generated_at.getDate())} ${pad(generated_at.getHours())}:${pad(generated_at.getMinutes())}:${pad(generated_at.getSeconds())}`;

    const company = await settings.getCompanySettings().catch(() => ({ companyName: 'AJC PISOWIFI' }));
    const companyName = company?.companyName ? String(company.companyName) : 'AJC PISOWIFI';
    const pdfPath = await generatePPPoEUserFormPdf({ outputPath, user: { ...user, company_name: companyName, generated_at: generatedText } });
    if (!pdfPath) return res.status(500).json({ error: 'PDF generation unavailable' });

    await db.run('UPDATE pppoe_users SET form_pdf_path = ? WHERE id = ?', [pdfPath, userId]).catch(() => {});

    const resolved = path.resolve(pdfPath);
    const allowed = path.resolve(PPPoE_FORMS_DIR);
    if (!resolved.startsWith(allowed)) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'PDF not found' });

    const download = String(req.query.download || '') === '1';
    const filename = `${safeBase}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(resolved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, billing_profile_id, expires_at, full_name, address, contact_number, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const result = await network.addPPPoEUser(username, password, billing_profile_id, expires_at, { full_name, address, contact_number, email });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/sales', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM pppoe_sales ORDER BY paid_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/sales/:id/receipt.pdf', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const sale = await db.get('SELECT * FROM pppoe_sales WHERE id = ?', [id]);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    const user = await db.get(
      'SELECT full_name, address, contact_number, email FROM pppoe_users WHERE id = ?',
      [sale.user_id]
    ).catch(() => null);

    const company = await settings.getCompanySettings().catch(() => ({ companyName: 'AJC PISOWIFI' }));
    const companyName = company?.companyName ? String(company.companyName) : 'AJC PISOWIFI';

    const safeBase = `AR-PPPOE-${sale.id}-${String(sale.username || '').trim() || 'user'}`
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 90);
    const outputPath = path.join(PPPoE_RECEIPTS_DIR, `${safeBase}.pdf`);

    const receiptNo = `AR-PPPOE-${sale.id}`;
    const pdfPath = await generatePPPoESaleReceiptPdf({
      outputPath,
      receipt: {
        company_name: companyName,
        receipt_no: receiptNo,
        paid_at: sale.paid_at || null,
        payment_method: sale.payment_method || 'cash',
        notes: sale.notes || null,
        username: sale.username,
        account_number: sale.account_number || null,
        billing_profile_name: sale.billing_profile_name || null,
        profile_name: sale.profile_name || null,
        gross_amount: sale.gross_amount || sale.amount || 0,
        discount_days: sale.discount_days || 0,
        net_amount: sale.net_amount || sale.amount || 0,
        prev_expires_at: sale.prev_expires_at || null,
        new_expires_at: sale.new_expires_at || null,
        full_name: user?.full_name || null,
        address: user?.address || null,
        contact_number: user?.contact_number || null,
        email: user?.email || null
      }
    });
    if (!pdfPath) return res.status(500).json({ error: 'PDF generation unavailable' });

    const resolved = path.resolve(pdfPath);
    const allowed = path.resolve(PPPoE_RECEIPTS_DIR);
    if (!resolved.startsWith(allowed)) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'PDF not found' });

    const download = String(req.query.download || '') === '1';
    const filename = `${safeBase}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(resolved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/network/pppoe/sales/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const existing = await db.get('SELECT id FROM pppoe_sales WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Sale not found' });
    await db.run('DELETE FROM pppoe_sales WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/sales', requireAdmin, async (req, res) => {
  try {
    const { user_id, billing_profile_id, payment_method, notes, discount_days, apply_renewal } = req.body || {};
    const userId = user_id ? parseInt(String(user_id), 10) : null;
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user_id' });

    const user = await db.get('SELECT id, username, account_number, billing_profile_id, expires_at, expired_at, billing_start_at, billing_cycle_day, last_offline_at, is_online FROM pppoe_users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bpId = billing_profile_id ? parseInt(String(billing_profile_id), 10) : (user.billing_profile_id ? parseInt(String(user.billing_profile_id), 10) : null);
    if (!bpId || Number.isNaN(bpId)) return res.status(400).json({ error: 'User has no billing profile' });

    const billing = await db.get(
      `SELECT bp.id as billing_profile_id, bp.name as billing_profile_name, bp.price as price, p.name as profile_name
       FROM pppoe_billing_profiles bp
       JOIN pppoe_profiles p ON p.id = bp.profile_id
       WHERE bp.id = ?`,
      [bpId]
    );
    if (!billing) return res.status(404).json({ error: 'Billing profile not found' });

    const grossAmount = Number(billing.price || 0);
    const method = payment_method ? String(payment_method).trim() : 'cash';
    const noteText = notes ? String(notes).trim() : null;
    const discountDays = discount_days ? parseInt(String(discount_days), 10) : 0;
    const normalizedDiscountDays = (!Number.isNaN(discountDays) && discountDays > 0) ? discountDays : 0;

    const daysInCycle = 30;
    const discountValue = Math.min(grossAmount, (grossAmount / daysInCycle) * normalizedDiscountDays);
    const netAmount = Math.max(0, grossAmount - discountValue);

    const now = new Date();
    const toLocalIso = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const parseDbDate = (s) => {
      const raw = String(s || '').trim();
      if (!raw) return null;
      const normalized = raw.includes('T') ? raw.replace('T', ' ') : raw;
      const d = new Date(normalized.replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const addOneMonthSameDay = (anchorDate, cycleDay) => {
      const day = Math.max(1, Math.min(31, cycleDay || anchorDate.getDate()));
      const y = anchorDate.getFullYear();
      const m = anchorDate.getMonth();
      const next = new Date(y, m + 1, 1, anchorDate.getHours(), anchorDate.getMinutes(), anchorDate.getSeconds());
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
      return next;
    };

    const shouldApplyRenewal = apply_renewal !== false;
    const prevExpiresAt = String(user.expires_at || '').trim() || null;
    let newExpiresAt = null;
    let billingStartAt = user.billing_start_at ? String(user.billing_start_at) : null;
    let billingCycleDay = user.billing_cycle_day ? parseInt(String(user.billing_cycle_day), 10) : null;

    if (shouldApplyRenewal) {
      const start = parseDbDate(user.billing_start_at) || now;
      if (!billingCycleDay || Number.isNaN(billingCycleDay)) billingCycleDay = start.getDate();
      const nextExp = addOneMonthSameDay(start, billingCycleDay);
      newExpiresAt = toLocalIso(nextExp);

      if (!user.billing_start_at) {
        billingStartAt = toLocalIso(start);
      }
    }

    const result = await db.run(
      `INSERT INTO pppoe_sales
        (user_id, account_number, username, billing_profile_id, billing_profile_name, profile_name, amount, gross_amount, discount_days, net_amount, currency, prev_expires_at, new_expires_at, payment_method, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PHP', ?, ?, ?, ?)`,
      [
        user.id,
        user.account_number || null,
        user.username,
        billing.billing_profile_id,
        billing.billing_profile_name,
        billing.profile_name,
        netAmount,
        grossAmount,
        normalizedDiscountDays,
        netAmount,
        prevExpiresAt,
        newExpiresAt,
        method,
        noteText
      ]
    );

    if (shouldApplyRenewal) {
      const fields = [];
      const values = [];
      if (newExpiresAt) { fields.push('expires_at = ?'); values.push(newExpiresAt); }
      fields.push('expired_at = NULL');
      if (billingStartAt) { fields.push('billing_start_at = COALESCE(billing_start_at, ?)'); values.push(billingStartAt); }
      if (billingCycleDay) { fields.push('billing_cycle_day = COALESCE(billing_cycle_day, ?)'); values.push(billingCycleDay); }
      values.push(user.id);
      await db.run(`UPDATE pppoe_users SET ${fields.join(', ')} WHERE id = ?`, values);
      await network.syncPPPoESecrets().catch(() => {});
      await network.disconnectPPPoEUser(user.username).catch(() => {});
    }

    res.json({ success: true, id: result.lastID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PPPoE Profiles API
app.get('/api/network/pppoe/profiles', requireAdmin, async (req, res) => {
  try { res.json(await db.all('SELECT * FROM pppoe_profiles ORDER BY created_at DESC')); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/profiles', requireAdmin, async (req, res) => {
  const { name, rate_limit_dl, rate_limit_ul } = req.body;
  try {
    await db.run('INSERT INTO pppoe_profiles (name, rate_limit_dl, rate_limit_ul) VALUES (?, ?, ?)', [name, rate_limit_dl, rate_limit_ul]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/network/pppoe/profiles/:id', requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM pppoe_profiles WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PPPoE Billing Profiles API
app.get('/api/network/pppoe/billing-profiles', requireAdmin, async (req, res) => {
  try { 
    const rows = await db.all(`
      SELECT bp.*, p.name as profile_name, p.rate_limit_dl, p.rate_limit_ul 
      FROM pppoe_billing_profiles bp
      JOIN pppoe_profiles p ON bp.profile_id = p.id
      ORDER BY bp.created_at DESC
    `);
    res.json(rows); 
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/billing-profiles', requireAdmin, async (req, res) => {
  const { profile_id, name, price } = req.body;
  try {
    await db.run('INSERT INTO pppoe_billing_profiles (profile_id, name, price) VALUES (?, ?, ?)', [profile_id, name, price]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/network/pppoe/billing-profiles/:id', requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM pppoe_billing_profiles WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PPPoE IP Pool API
app.get('/api/network/pppoe/pools', requireAdmin, async (req, res) => {
  try {
    const pools = await db.all('SELECT * FROM pppoe_pools ORDER BY created_at DESC');
    res.json(pools);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/pools', requireAdmin, async (req, res) => {
  const { name, ip_pool_start, ip_pool_end, description } = req.body;
  if (!name || !ip_pool_start || !ip_pool_end) {
    return res.status(400).json({ error: 'Name, pool start, and pool end are required' });
  }
  try {
    const result = await db.run(
      'INSERT INTO pppoe_pools (name, ip_pool_start, ip_pool_end, description) VALUES (?, ?, ?, ?)',
      [name, ip_pool_start, ip_pool_end, description || null]
    );
    res.json({ success: true, id: result.lastID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/network/pppoe/pools/:id', requireAdmin, async (req, res) => {
  try {
    const poolId = parseInt(req.params.id);
    const { name, ip_pool_start, ip_pool_end, description } = req.body || {};
    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (ip_pool_start !== undefined) { fields.push('ip_pool_start = ?'); values.push(ip_pool_start); }
    if (ip_pool_end !== undefined) { fields.push('ip_pool_end = ?'); values.push(ip_pool_end); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(poolId);
    await db.run(`UPDATE pppoe_pools SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/network/pppoe/pools/:id', requireAdmin, async (req, res) => {
  try {
    const poolId = parseInt(req.params.id);
    await db.run('DELETE FROM pppoe_pools WHERE id = ?', [poolId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PPPoE Logs API
app.post('/api/network/pppoe/restart', requireAdmin, async (req, res) => {
  try {
    const config = await db.get('SELECT * FROM pppoe_server WHERE enabled = 1');
    if (!config) {
      return res.status(404).json({ error: 'No active PPPoE server config found to restart' });
    }
    await network.stopPPPoEServer(config.interface);
    await network.startPPPoEServer(config);
    res.json({ success: true, message: 'PPPoE Server restarted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/logs', requireAdmin, async (req, res) => {
  try {
    // Priority log files
    const logFiles = [
      '/var/log/pppd.log', 
      '/var/log/pppoe-server.log',
      '/var/log/messages', 
      '/var/log/syslog'
    ];
    
    let allLogs = [];
    
    for (const file of logFiles) {
      if (fs.existsSync(file)) {
        try {
          const { stdout } = await execPromise(`tail -n 50 ${file}`).catch(() => ({ stdout: '' }));
          if (stdout) {
            const lines = stdout.split('\n')
              .filter(l => l.trim())
              .map(l => `[${path.basename(file)}] ${l}`);
            allLogs = [...allLogs, ...lines];
          }
        } catch (e) {}
      }
    }
    
    // Return the last 50 lines
    const result = allLogs.slice(-50);
    
    if (result.length === 0) {
      res.json(["No active PPPoE logs found. Wait for client connection..."]);
    } else {
      res.json(result);
    }
  } catch (err) {
    res.json(["Error reading logs: " + err.message]);
  }
});

app.get('/api/network/pppoe/expired-settings', requireAdmin, async (req, res) => {
  try {
    await refreshPPPoEExpiredSettings();
    res.json({
      pool: pppoeExpiredPool,
      redirect_ip: pppoeExpiredRedirectIp
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/pppoe/expired-settings', requireAdmin, async (req, res) => {
  try {
    const { pool_id, redirect_ip } = req.body || {};
    const poolId = pool_id ? parseInt(String(pool_id), 10) : null;
    const redirectIp = redirect_ip ? String(redirect_ip).trim() : '';

    if (poolId && Number.isNaN(poolId)) {
      return res.status(400).json({ error: 'Invalid pool_id' });
    }

    if (redirectIp && !/^\d{1,3}(\.\d{1,3}){3}$/.test(redirectIp)) {
      return res.status(400).json({ error: 'Invalid redirect_ip' });
    }

    if (poolId) {
      const pool = await db.get('SELECT * FROM pppoe_pools WHERE id = ?', [poolId]);
      if (!pool) return res.status(404).json({ error: 'Pool not found' });
      await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('pppoe_expired_pool_id', ?)", [String(poolId)]);
    } else {
      await db.run("DELETE FROM config WHERE key = 'pppoe_expired_pool_id'").catch(() => {});
    }

    if (redirectIp) {
      await db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('pppoe_expired_redirect_ip', ?)", [redirectIp]);
    } else {
      await db.run("DELETE FROM config WHERE key = 'pppoe_expired_redirect_ip'").catch(() => {});
    }

    await refreshPPPoEExpiredSettings();
    await network.initFirewall().catch(() => {});
    await network.syncPPPoESecrets().catch(() => {});

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/network/pppoe/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const updates = req.body;
    const current = await db.get('SELECT username FROM pppoe_users WHERE id = ?', [userId]).catch(() => null);
    console.log(`[PPPoE-EDIT] Save requested | id=${userId} | current="${current?.username || ''}" | updates=${JSON.stringify(Object.keys(updates || {}))}`);
    const result = await network.updatePPPoEUser(userId, updates);
    const usernameToKick = (updates && updates.username) ? String(updates.username) : (current && current.username) ? String(current.username) : '';
    if (usernameToKick) {
      console.log(`[PPPoE-EDIT] Kicking active connection for "${usernameToKick}"...`);
      const kickResult = await network.disconnectPPPoEUser(usernameToKick).catch(() => null);
      console.log(`[PPPoE-EDIT] Kick result for "${usernameToKick}":`, kickResult);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/network/pppoe/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const result = await network.deletePPPoEUser(userId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/invoices', requireAdmin, async (req, res) => {
  try {
    const { user_id, username } = req.query || {};
    const filters = [];
    const values = [];
    if (user_id) { filters.push('user_id = ?'); values.push(parseInt(String(user_id), 10)); }
    if (username) { filters.push('username = ?'); values.push(String(username)); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await db.all(`SELECT * FROM pppoe_invoices ${where} ORDER BY generated_at DESC`, values);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/pppoe/invoices/:id/pdf', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await db.get('SELECT * FROM pppoe_invoices WHERE id = ?', [id]);
    if (!row || !row.pdf_path) return res.status(404).json({ error: 'PDF not found' });
    const resolved = path.resolve(String(row.pdf_path));
    const base = path.resolve(PPPoE_BILLING_DIR);
    if (!resolved.startsWith(base)) return res.status(403).json({ error: 'Invalid PDF path' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'PDF file missing on disk' });
    res.sendFile(resolved);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DEVICE MANAGEMENT API ENDPOINTS
app.get('/api/devices', requireAdmin, async (req, res) => {
  try {
    // Fetch allowed interfaces (hotspots and their bridge members)
    const hotspotRows = await db.all('SELECT interface FROM hotspots WHERE enabled = 1');
    const bridgeRows = await db.all('SELECT * FROM bridges');
    
    const allowedInterfaces = new Set();
    hotspotRows.forEach(h => allowedInterfaces.add(h.interface));
    
    bridgeRows.forEach(b => {
      if (allowedInterfaces.has(b.name)) {
        try {
          const members = JSON.parse(b.members);
          members.forEach(m => allowedInterfaces.add(m));
        } catch (e) {}
      }
    });

    // Get all devices with their current session information
    const devices = await db.all('SELECT * FROM wifi_devices ORDER BY connected_at DESC');
    
    // Get all active sessions
    const sessions = await db.all('SELECT mac, ip, remaining_seconds as remainingSeconds, total_paid as totalPaid, connected_at as connectedAt, is_paused as isPaused FROM sessions WHERE remaining_seconds > 0');
    
    // Create a map of sessions by MAC for quick lookup
    const sessionMap = new Map();
    sessions.forEach(session => {
      sessionMap.set(session.mac.toUpperCase(), session);
    });
    
    // Merge device data with session data
    const formattedDevices = devices
      .filter(device => allowedInterfaces.size === 0 || allowedInterfaces.has(device.interface))
      .map(device => {
      const deviceMac = device.mac.toUpperCase();
      const session = sessionMap.get(deviceMac);
      
      return {
        id: device.id || '',
        mac: device.mac || 'Unknown',
        ip: device.ip || 'Unknown',
        hostname: device.hostname || 'Unknown',
        interface: device.interface || 'Unknown',
        ssid: device.ssid || 'Unknown',
        signal: device.signal || 0,
        connectedAt: session ? session.connectedAt : (device.connected_at || Date.now()),
        lastSeen: device.last_seen || Date.now(),
        isActive: Boolean(session), // Device is active if it has an active session
        customName: device.custom_name || '',
        sessionTime: session ? session.remainingSeconds : 0, // Real remaining time from session
        totalPaid: session ? session.totalPaid : 0,
        downloadLimit: device.download_limit || 0,
        uploadLimit: device.upload_limit || 0
      };
    });

    // Add devices that have active sessions but were not found in the scan/db
    sessions.forEach(session => {
      const sessionMac = session.mac.toUpperCase();
      if (!formattedDevices.find(d => d.mac.toUpperCase() === sessionMac)) {
        formattedDevices.push({
          id: `session_${sessionMac}`,
          mac: session.mac,
          ip: session.ip || 'Unknown',
          hostname: 'Unknown', // Could try to lookup in wifi_devices history if needed, but 'Unknown' is safe
          interface: 'Unknown',
          ssid: 'Unknown',
          signal: 0,
          connectedAt: session.connectedAt,
          lastSeen: Date.now(),
          isActive: true,
          customName: '',
          sessionTime: session.remainingSeconds,
          totalPaid: session.totalPaid
        });
      }
    });
    
    res.json(formattedDevices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Firmware download endpoint (Binary)
app.get('/api/firmware/nodemcu/bin', requireAdmin, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Explicitly target the binary file in the build directory
    const firmwarePath = path.join(__dirname, 'firmware', 'NodeMCU_ESP8266', 'build', 'esp8266.esp8266.huzzah', 'NodeMCU_ESP8266.ino.bin');
    
    if (!fs.existsSync(firmwarePath)) {
      console.error(`[Firmware] Binary not found at: ${firmwarePath}`);
      return res.status(404).json({ error: 'Firmware binary not found on server' });
    }
    
    // Set headers for binary file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="NodeMCU_ESP8266.bin"');
    
    const fileStream = fs.createReadStream(firmwarePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('Error streaming firmware file:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to download firmware' });
    });
    
  } catch (err) {
    console.error('Error downloading firmware:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/devices/scan', requireAdmin, async (req, res) => {
  try {
    const scannedDevices = await network.scanWifiDevices();
    const now = Date.now();
    
    // Get current active sessions to sync with
    const activeSessions = await db.all('SELECT mac, ip, remaining_seconds as remainingSeconds, total_paid as totalPaid, connected_at as connectedAt FROM sessions WHERE remaining_seconds > 0');
    const sessionMap = new Map();
    activeSessions.forEach(session => {
      sessionMap.set(session.mac.toUpperCase(), session);
    });
    
    // Update or insert scanned devices
    for (const device of scannedDevices) {
      const existingDevice = await db.get('SELECT * FROM wifi_devices WHERE mac = ?', [device.mac]);
      const session = sessionMap.get(device.mac.toUpperCase());
      
      if (existingDevice) {
        // Update existing device - preserve session data if device has active session
        await db.run(
          'UPDATE wifi_devices SET ip = ?, hostname = ?, interface = ?, ssid = ?, signal = ?, last_seen = ?, is_active = ? WHERE mac = ?',
          [device.ip, device.hostname, device.interface, device.ssid, device.signal, now, session ? 1 : 0, device.mac]
        );
      } else {
        // Insert new device - mark as active if it has a session
        const id = `device_${now}_${Math.random().toString(36).substr(2, 9)}`;
        await db.run(
          'INSERT INTO wifi_devices (id, mac, ip, hostname, interface, ssid, signal, connected_at, last_seen, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, device.mac, device.ip, device.hostname, device.interface, device.ssid, device.signal, session ? session.connectedAt : now, now, session ? 1 : 0]
        );
      }
    }
    
    // Mark devices that weren't found as inactive, but preserve session status for active sessions
    const scannedMacs = scannedDevices.map(d => d.mac);
    if (scannedMacs.length > 0) {
      const placeholders = scannedMacs.map(() => '?').join(',');
      // Only mark as inactive if device doesn't have an active session
      await db.run(`UPDATE wifi_devices SET is_active = 0 WHERE mac NOT IN (${placeholders}) AND mac NOT IN (SELECT mac FROM sessions WHERE remaining_seconds > 0)`, scannedMacs);
    }
    
    // Return updated device list with session data merged
    const devices = await db.all('SELECT * FROM wifi_devices ORDER BY connected_at DESC');
    
    // Merge with session data for accurate remaining time
    const formattedDevices = devices.map(device => {
      const deviceMac = device.mac.toUpperCase();
      const session = sessionMap.get(deviceMac);
      
      return {
        id: device.id || '',
        mac: device.mac || 'Unknown',
        ip: device.ip || 'Unknown',
        hostname: device.hostname || 'Unknown',
        interface: device.interface || 'Unknown',
        ssid: device.ssid || 'Unknown',
        signal: device.signal || 0,
        connectedAt: session ? session.connectedAt : (device.connected_at || Date.now()),
        lastSeen: device.last_seen || Date.now(),
        isActive: Boolean(session), // Device is active if it has an active session
        customName: device.custom_name || '',
        sessionTime: session ? session.remainingSeconds : 0, // Real remaining time from session
        totalPaid: session ? session.totalPaid : 0,
        creditPesos: device.credit_pesos || 0,
        creditMinutes: device.credit_minutes || 0
      };
    });
    
    res.json(formattedDevices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    const device = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [req.params.id]);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices', requireAdmin, async (req, res) => {
  try {
    const { mac, ip, hostname, interface: iface, ssid, signal, customName } = req.body;
    const id = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    
    await db.run(
      'INSERT INTO wifi_devices (id, mac, ip, hostname, interface, ssid, signal, connected_at, last_seen, is_active, custom_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, mac.toUpperCase(), ip, hostname || '', iface, ssid || '', signal || 0, now, now, 1, customName || '']
    );
    
    const newDevice = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [id]);
    res.json(newDevice);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    const { customName, sessionTime, creditPesos, creditMinutes, downloadLimit, uploadLimit } = req.body;
    const updates = [];
    const values = [];
    
    if (customName !== undefined) {
      updates.push('custom_name = ?');
      values.push(customName);
    }
    if (sessionTime !== undefined) {
      updates.push('session_time = ?');
      values.push(sessionTime);
    }
    if (creditPesos !== undefined) {
      updates.push('credit_pesos = ?');
      values.push(creditPesos);
    }
    if (creditMinutes !== undefined) {
      updates.push('credit_minutes = ?');
      values.push(creditMinutes);
    }
    if (downloadLimit !== undefined) {
      updates.push('download_limit = ?');
      values.push(downloadLimit);
    }
    if (uploadLimit !== undefined) {
      updates.push('upload_limit = ?');
      values.push(uploadLimit);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    values.push(req.params.id);
    await db.run(`UPDATE wifi_devices SET ${updates.join(', ')} WHERE id = ?`, values);
    
    const updatedDevice = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [req.params.id]);
    
    // If session time is being set, also update the active session if device is connected
    if (sessionTime !== undefined && updatedDevice.ip && updatedDevice.mac) {
      const session = await db.get('SELECT * FROM sessions WHERE mac = ?', [updatedDevice.mac]);
      if (session) {
        // Update session with new time and ensure limits are synced
        const newSessionUpdates = ['remaining_seconds = ?', 'updated_at = ?'];
        const newSessionValues = [sessionTime, new Date().toISOString()];
        
        // Sync device limits to session
        if (downloadLimit !== undefined || updatedDevice.download_limit) {
          newSessionUpdates.push('download_limit = ?');
          newSessionValues.push(downloadLimit !== undefined ? downloadLimit : updatedDevice.download_limit);
        }
        if (uploadLimit !== undefined || updatedDevice.upload_limit) {
          newSessionUpdates.push('upload_limit = ?');
          newSessionValues.push(uploadLimit !== undefined ? uploadLimit : updatedDevice.upload_limit);
        }
        
        newSessionValues.push(updatedDevice.mac);
        await db.run(`UPDATE sessions SET ${newSessionUpdates.join(', ')} WHERE mac = ?`, newSessionValues);
        
        console.log(`[ADMIN] Updated session for ${updatedDevice.mac}: time=${sessionTime}s, DL=${downloadLimit || updatedDevice.download_limit}, UL=${uploadLimit || updatedDevice.upload_limit}`);

        // FORCE SYNC TO CLOUD IMMEDIATELY if time is set to 0 or any update
        if (edgeSync) {
            edgeSync.syncDeviceToCloud(updatedDevice.mac, sessionTime, session.total_paid || 0);
        }
      }
    }
    
    // Always reapply QoS limits if device is connected (whether time, download, or upload changed)
    if (updatedDevice.ip && updatedDevice.mac && (sessionTime !== undefined || downloadLimit !== undefined || uploadLimit !== undefined)) {
      await network.whitelistMAC(updatedDevice.mac, updatedDevice.ip);
    }

    res.json(updatedDevice);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/devices/:id', requireAdmin, async (req, res) => {
  try {
    const result = await db.run('DELETE FROM wifi_devices WHERE id = ?', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/:id/connect', requireAdmin, async (req, res) => {
  try {
    const device = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [req.params.id]);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    // Whitelist the device MAC and IP (real network operation)
    await network.whitelistMAC(device.mac, device.ip);
    
    // Update device status
    await db.run('UPDATE wifi_devices SET is_active = 1, last_seen = ? WHERE id = ?', [Date.now(), req.params.id]);
    
    // Create or update session - use device session_time if set, otherwise default
    const existingSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [device.mac]);
    const sessionTime = device.session_time || 3600; // Default 1 hour
    
    if (existingSession) {
      // Update existing session
      await db.run(
        'UPDATE sessions SET remaining_seconds = remaining_seconds + ?, ip = ? WHERE mac = ?',
        [sessionTime, device.ip, device.mac]
      );
    } else {
      // Create new session
      await db.run(
        'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at) VALUES (?, ?, ?, ?, ?)',
        [device.mac, device.ip, sessionTime, 0, Date.now()]
      );
    }
    
    res.json({ success: true, sessionTime });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/:id/disconnect', requireAdmin, async (req, res) => {
  try {
    const device = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [req.params.id]);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    // Block the device MAC and IP (real network operation)
    await network.blockMAC(device.mac, device.ip);
    
    // Update device status
    await db.run('UPDATE wifi_devices SET is_active = 0 WHERE id = ?', [req.params.id]);
    
    // Remove session if it exists
    const existingSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [device.mac]);
    if (existingSession) {
      // FORCE SYNC TO CLOUD AS 0 TIME BEFORE DELETING
      if (edgeSync) {
         await edgeSync.syncDeviceToCloud(device.mac, 0, existingSession.total_paid || 0);
      }

      await db.run('DELETE FROM sessions WHERE mac = ?', [device.mac]);
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/devices/:id/sessions', requireAdmin, async (req, res) => {
  try {
    const device = await db.get('SELECT mac FROM wifi_devices WHERE id = ?', [req.params.id]);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    const sessions = await db.all('SELECT * FROM device_sessions WHERE device_id = ? ORDER BY start_time DESC', [req.params.id]);
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/:id/refresh', requireAdmin, async (req, res) => {
  try {
    const device = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [req.params.id]);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    // Try to get updated IP and hostname
    let newIp = device.ip;
    let newHostname = device.hostname;
    
    // Get updated IP from ARP table
    try {
      const arpCommands = [
        `ip neigh show | grep -i ${device.mac}`,
        `arp -n | grep -i ${device.mac}`,
        `cat /proc/net/arp | grep -i ${device.mac}`
      ];
      
      for (const cmd of arpCommands) {
        try {
          const { stdout: arpOutput } = await execPromise(cmd).catch(() => ({ stdout: '' }));
          const arpMatch = arpOutput.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (arpMatch && arpMatch[1]) {
            newIp = arpMatch[1];
            break;
          }
        } catch (e) {}
      }
    } catch (e) {}
    
    // Get updated hostname from DHCP leases
    try {
      const leaseFiles = ['/tmp/dhcp.leases', '/var/lib/dnsmasq/dnsmasq.leases', '/var/lib/dhcp/dhcpd.leases'];
      for (const leaseFile of leaseFiles) {
        if (fs.existsSync(leaseFile)) {
          const leaseContent = fs.readFileSync(leaseFile, 'utf8');
          const lines = leaseContent.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(device.mac.toLowerCase())) {
              const parts = line.split(/\s+/);
              if (parts.length >= 4) {
                newHostname = parts[3] || device.hostname;
                break;
              }
            }
          }
          if (newHostname !== device.hostname) break;
        }
      }
    } catch (e) {}

    if (newIp !== device.ip || newHostname !== device.hostname) {
      await db.run('UPDATE wifi_devices SET ip = ?, hostname = ?, last_seen = ? WHERE id = ?', 
        [newIp, newHostname, Date.now(), req.params.id]);
    }
    
    // Get current session data for this device
    const session = await db.get('SELECT mac, ip, remaining_seconds as remainingSeconds, total_paid as totalPaid, connected_at as connectedAt FROM sessions WHERE mac = ?', [device.mac]);
    
    // Return updated device with session data
    const updatedDevice = await db.get('SELECT * FROM wifi_devices WHERE id = ?', [req.params.id]);
    const deviceWithSession = {
      ...updatedDevice,
      id: updatedDevice.id || '',
      mac: updatedDevice.mac || 'Unknown',
      ip: updatedDevice.ip || 'Unknown',
      hostname: updatedDevice.hostname || 'Unknown',
      interface: updatedDevice.interface || 'Unknown',
      ssid: updatedDevice.ssid || 'Unknown',
      signal: updatedDevice.signal || 0,
      connectedAt: session ? session.connectedAt : (updatedDevice.connected_at || Date.now()),
      lastSeen: updatedDevice.last_seen || Date.now(),
      isActive: Boolean(session),
      customName: updatedDevice.custom_name || '',
      sessionTime: session ? session.remainingSeconds : 0,
      totalPaid: session ? session.totalPaid : 0
    };
    
    res.json(deviceWithSession);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// System Management APIs
app.post('/api/system/restart', requireAdmin, async (req, res) => {
  try {
    const { type } = req.body || {};
    console.log(`[System] Restart requested (Type: ${type || 'soft'})`);
    
    await execPromise('sync');

    if (type === 'hard') {
        res.json({ success: true, message: 'System rebooting (Hard Restart)...' });
        setTimeout(() => {
            exec('sudo reboot').unref();
        }, 1000);
    } else {
        res.json({ success: true, message: 'Application restarting (Soft Restart)...' });
        setTimeout(async () => {
             try {
                 await execPromise('pm2 restart all');
             } catch (e) {
                 console.log('PM2 restart failed, falling back to process.exit', e.message);
                 process.exit(0);
             }
        }, 1000);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/system/clear-logs', requireAdmin, async (req, res) => {
  try {
    console.log('[System] Clearing logs...');
    await execPromise('truncate -s 0 /var/log/syslog').catch(() => {});
    await execPromise('truncate -s 0 /var/log/messages').catch(() => {});
    res.json({ success: true, message: 'Logs cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/system/export-db', requireAdmin, (req, res) => {
  const dbPath = path.resolve(__dirname, 'pisowifi.sqlite');
  if (fs.existsSync(dbPath)) {
      res.download(dbPath, 'pisowifi_backup.sqlite');
  } else {
      res.status(404).json({ error: 'Database file not found' });
  }
});

app.get('/api/system/kernel-check', requireAdmin, async (req, res) => {
  try {
    const { stdout } = await execPromise('uname -r');
    res.json({ success: true, kernel: stdout.trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/system/sync', requireAdmin, async (req, res) => {
  try {
    console.log('[System] Syncing filesystem...');
    
    // SYNC WLAN0 CONFIG BACK TO DB (As requested by user)
    // This ensures manual file edits are saved to SQLite
    const wlanConfigPath = '/etc/hostapd/hostapd_wlan0.conf';
    if (fs.existsSync(wlanConfigPath)) {
        try {
            const content = fs.readFileSync(wlanConfigPath, 'utf8');
            const ssidMatch = content.match(/^ssid=(.+)$/m);
            const passMatch = content.match(/^wpa_passphrase=(.+)$/m);
            
            if (ssidMatch) {
                const ssid = ssidMatch[1].trim();
                const pass = passMatch ? passMatch[1].trim() : '';
                
                const bridgeMatch = content.match(/^bridge=(.+)$/m);
                const bridge = bridgeMatch ? bridgeMatch[1].trim() : 'br0';
                
                console.log(`[System] Syncing wlan0 config to DB: SSID=${ssid}`);
                await db.run('INSERT OR REPLACE INTO wireless_settings (interface, ssid, password, bridge) VALUES (?, ?, ?, ?)', 
                  ['wlan0', ssid, pass, bridge]);
            }
        } catch (e) {
            console.error('[System] Failed to sync wlan0 config:', e.message);
        }
    }

    await execPromise('sync');
    res.json({ success: true, message: 'Filesystem and Settings synced' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/system/logs', requireAdmin, async (req, res) => {
  try {
    const { stdout } = await execPromise('tail -n 100 /var/log/syslog || tail -n 100 /var/log/messages').catch(() => ({ stdout: 'No logs available' }));
    res.json({ logs: stdout || 'No logs found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Multi-WAN Configuration API
app.get('/api/multiwan/config', requireAdmin, async (req, res) => {
  try {
    const config = await db.get('SELECT * FROM multi_wan_config WHERE id = 1');
    if (config) {
      config.interfaces = JSON.parse(config.interfaces || '[]');
      config.enabled = !!config.enabled;
    }
    res.json({ success: true, config });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/multiwan/config', requireAdmin, async (req, res) => {
  try {
    const { enabled, mode, pcc_method, interfaces } = req.body;
    await db.run(
      'UPDATE multi_wan_config SET enabled = ?, mode = ?, pcc_method = ?, interfaces = ? WHERE id = 1',
      [enabled ? 1 : 0, mode, pcc_method, JSON.stringify(interfaces)]
    );
    
    // Apply changes
    await applyMultiWanConfig({ enabled, mode, pcc_method, interfaces });
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function applyMultiWanConfig(config) {
    try {
        console.log('[MultiWAN] Applying configuration...', config.mode);
        
        const run = async (cmd) => {
            try { await execPromise(cmd); } catch (e) { /* ignore */ }
        };

        // 1. Cleanup existing rules
        await run('iptables -t mangle -F AJC_MULTIWAN');
        await run('iptables -t mangle -D PREROUTING -j AJC_MULTIWAN');
        
        // If disabled, stop here
        if (!config.enabled || !config.interfaces || config.interfaces.length < 2) {
             return;
        }

        // 2. Initialize Chain
        await run('iptables -t mangle -N AJC_MULTIWAN');
        await run('iptables -t mangle -I PREROUTING -j AJC_MULTIWAN');

        const ifaces = config.interfaces;
        
        if (config.mode === 'pcc') {
            // Restore Connmark
            await run('iptables -t mangle -A AJC_MULTIWAN -j CONNMARK --restore-mark');
            await run('iptables -t mangle -A AJC_MULTIWAN -m mark ! --mark 0 -j RETURN');
            
            ifaces.forEach(async (iface, idx) => {
                 const mark = idx + 1;
                 const every = ifaces.length;
                 const packet = idx;
                 
                 // Apply Mark using Nth statistic (Simulating Load Balancing)
                 // This covers "Both Addresses" intent by balancing connections
                 const currentEvery = every - idx;
                 
                 // Note: In a real environment, we would use HMARK for true src/dst hashing if available
                 // For now, we use statistic nth which is robust and available
                 await run(`iptables -t mangle -A AJC_MULTIWAN -m statistic --mode nth --every ${currentEvery} --packet 0 -j MARK --set-mark ${mark}`);
                 await run(`iptables -t mangle -A AJC_MULTIWAN -m mark --mark ${mark} -j CONNMARK --save-mark`);
                 
                 // Routing Rules
                 const tableId = 100 + mark;
                 // Clean up old rules for this table/mark to avoid dups
                 while (true) {
                    try { await execPromise(`ip rule del fwmark ${mark} table ${tableId}`); } catch(e) { break; }
                 }
                 await run(`ip rule add fwmark ${mark} table ${tableId}`);
                 await run(`ip route add default via ${iface.gateway} dev ${iface.interface} table ${tableId}`);
            });
            
        } else {
            // ECMP Logic
            let routeCmd = 'ip route replace default scope global';
            ifaces.forEach(iface => {
                routeCmd += ` nexthop via ${iface.gateway} dev ${iface.interface} weight ${iface.weight}`;
            });
            await run(routeCmd);
        }
        
        await run('ip route flush cache');
        
    } catch (e) {
        console.error('[MultiWAN] Apply failed:', e.message);
    }
}



// Background Timer has been moved inside server.listen to ensure DB initialization

// TC cleanup moved inside server.listen

async function bootupRestore(isRestricted = false) {
  console.log(`[AJC] Starting System Restoration (Mode: ${isRestricted ? 'RESTRICTED' : 'NORMAL'})...`);
  
  // Auto-Provision Interfaces & Bridge if needed
  await network.autoProvisionNetwork();

  await network.initFirewall();
  
  // 0. Restore VLANs
  try {
    const vlans = await db.all('SELECT * FROM vlans');
    for (const v of vlans) {
      console.log(`[AJC] Restoring VLAN ${v.name} on ${v.parent} ID ${v.id}...`);
      await network.createVlan(v).catch(e => console.error(`[AJC] VLAN Restore Failed: ${e.message}`));
    }
  } catch (e) { console.error('[AJC] Failed to load VLANs from DB', e); }

  // 1. Restore Bridges
  try {
    const bridges = await db.all('SELECT * FROM bridges');
    for (const b of bridges) {
      console.log(`[AJC] Restoring Bridge ${b.name}...`);
      await network.createBridge({
        name: b.name,
        members: JSON.parse(b.members),
        stp: Boolean(b.stp)
      }).catch(e => console.error(`[AJC] Bridge Restore Failed: ${e.message}`));
    }
  } catch (e) { console.error('[AJC] Failed to load bridges from DB', e); }

  // 2. Restore Hotspots (DNS/DHCP)
  try {
    const hotspots = await db.all('SELECT * FROM hotspots WHERE enabled = 1');
    const processedInterfaces = new Set();
    
    for (const h of hotspots) {
      // Resolve actual target interface (in case of bridge)
      // We can't easily know the master here without shelling out, 
      // but network.setupHotspot handles redirection.
      // However, we can track the INPUT interface to avoid blatant duplicates in DB
      if (processedInterfaces.has(h.interface)) {
        console.log(`[AJC] Skipping duplicate hotspot config for ${h.interface}`);
        continue;
      }
      processedInterfaces.add(h.interface);

      console.log(`[AJC] Restoring Hotspot on ${h.interface}...`);
      await network.setupHotspot(h, true).catch(e => console.error(`[AJC] Hotspot Restore Failed: ${e.message}`));
    }
    
    // Final dnsmasq restart after all hotspot configs are restored
    if (hotspots.length > 0) {
      console.log('[AJC] Finalizing DNS/DHCP configuration...');
      await network.restartDnsmasq().catch(e => console.error(`[AJC] Global dnsmasq restart failed: ${e.message}`));
    }
  } catch (e) { console.error('[AJC] Failed to load hotspots from DB'); }

  // 3. Restore Wireless APs
  try {
    const wireless = await db.all('SELECT * FROM wireless_settings');
    for (const w of wireless) {
      console.log(`[AJC] Restoring Wi-Fi AP on ${w.interface}...`);
      await network.configureWifiAP(w).catch(e => console.error(`[AJC] AP Restore Failed: ${e.message}`));
    }
  } catch (e) { console.error('[AJC] Failed to load wireless settings from DB'); }

  // 3.1 Restore Multi-WAN
  try {
    const mwConfig = await db.get('SELECT * FROM multi_wan_config WHERE id = 1');
    if (mwConfig && mwConfig.enabled) {
      mwConfig.interfaces = JSON.parse(mwConfig.interfaces || '[]');
      mwConfig.enabled = !!mwConfig.enabled;
      console.log('[AJC] Restoring Multi-WAN Configuration...');
      await applyMultiWanConfig(mwConfig);
    }
  } catch (e) { console.error('[AJC] Multi-WAN Restore Failed:', e.message); }

  // 3.2 Restore PPPoE Server
  try {
    const pppoeServers = await db.all('SELECT * FROM pppoe_server WHERE enabled = 1');
    for (const s of pppoeServers) {
      console.log(`[AJC] Restoring PPPoE Server on ${s.interface}...`);
      await network.startPPPoEServer(s).catch(e => console.error(`[AJC] PPPoE Restore Failed: ${e.message}`));
    }
  } catch (e) { console.error('[AJC] Failed to load PPPoE server config from DB', e); }

  // 4. Restore GPIO & Hardware
  const board = await db.get('SELECT value FROM config WHERE key = ?', ['boardType']);
  const pin = await db.get('SELECT value FROM config WHERE key = ?', ['coinPin']);
  const model = await db.get('SELECT value FROM config WHERE key = ?', ['boardModel']);
  const espIpAddress = await db.get('SELECT value FROM config WHERE key = ?', ['espIpAddress']);
  const espPort = await db.get('SELECT value FROM config WHERE key = ?', ['espPort']);
  const coinSlots = await db.get('SELECT value FROM config WHERE key = ?', ['coinSlots']);
  const nodemcuDevices = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
  const relayPinRow = await db.get('SELECT value FROM config WHERE key = ?', ['relayPin']);
  const relayActiveModeRow = await db.get('SELECT value FROM config WHERE key = ?', ['relayActiveMode']);
  
  const coinCallback = (pesos) => {
    console.log(`[MAIN GPIO] Pulse Detected | Amount: ₱${pesos}`);
    io.emit('coin-pulse', { pesos });
    // Also emit multi-slot event for tracking
    io.emit('multi-coin-pulse', { denomination: pesos, slot_id: null });
  };
  
  initGPIO(
    coinCallback, 
    board?.value || 'none', 
    parseInt(pin?.value || '2'), 
    model?.value,
    espIpAddress?.value,
    parseInt(espPort?.value || '80'),
    coinSlots?.value ? JSON.parse(coinSlots.value) : [],
    nodemcuDevices?.value ? JSON.parse(nodemcuDevices.value) : [],
    relayPinRow?.value ? parseInt(relayPinRow.value, 10) : null,
    relayActiveModeRow?.value === 'low' ? 'low' : 'high'
  );
  
  // Register callbacks for individual slots (if multi-slot)
  if (board?.value === 'nodemcu_esp' && coinSlots?.value) {
    const slots = JSON.parse(coinSlots.value);
    slots.forEach(slot => {
      if (slot.enabled) {
        registerSlotCallback(slot.id, (denomination) => {
          io.emit('multi-coin-pulse', { 
            denomination, 
            slot_id: slot.id,
            slot_name: slot.name || `Slot ${slot.id}`
          });
        });
      }
    });
  }
  
  // 5. Restore Active Sessions
  // Initialize QoS on LAN interface before restoring sessions
  const lan = await network.getLanInterface();
  const qosDiscipline = await db.get("SELECT value FROM config WHERE key = 'qos_discipline'");
  if (lan) {
    await network.initQoS(lan, qosDiscipline?.value || 'cake');
  }

  // NodeMCU Exemption: Get NodeMCU MACs to ensure they are whitelisted even if revoked
  let nodemcuMacs = [];
  try {
    const nodemcuResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    if (nodemcuResult?.value) {
      const devices = JSON.parse(nodemcuResult.value);
      nodemcuMacs = devices.map(d => d.macAddress.toUpperCase());
    }
  } catch (e) {
    console.warn('[AJC] Failed to load NodeMCU devices for whitelisting:', e.message);
  }

  const sessions = await db.all('SELECT mac, ip FROM sessions WHERE remaining_seconds > 0 ORDER BY connected_at DESC');
  
  // NodeMCU Exemption: Whitelist all NodeMCU devices regardless of sessions
  try {
    const nodemcuResult = await db.get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    if (nodemcuResult?.value) {
      const devices = JSON.parse(nodemcuResult.value);
      for (const d of devices) {
        if (d.macAddress && d.ipAddress && d.ipAddress !== 'unknown') {
          console.log(`[AJC] Whitelisting NodeMCU infrastructure: ${d.name} (${d.macAddress} @ ${d.ipAddress})`);
          await network.whitelistMAC(d.macAddress, d.ipAddress);
        }
      }
    }
  } catch (e) {
    console.warn('[AJC] Failed to whitelist NodeMCU devices:', e.message);
  }

  if (isRestricted) {
    console.log('[AJC] System is REVOKED. Limiting client sessions to 1.');
    let clientWhitelistedCount = 0;
    
    for (const s of sessions) {
      const mac = s.mac.toUpperCase();
      const isNodeMCU = nodemcuMacs.includes(mac);
      
      // NodeMCUs are already whitelisted above, but we skip them here for the 1-client limit
      if (isNodeMCU) {
        await network.whitelistMAC(s.mac, s.ip);
        continue;
      }

      if (clientWhitelistedCount < 1) {
        console.log(`[AJC] Whitelisting primary client: ${mac}`);
        await network.whitelistMAC(s.mac, s.ip);
        clientWhitelistedCount++;
      } else {
        console.log(`[AJC] Blocking secondary client due to revocation: ${mac}`);
        await network.blockMAC(s.mac, s.ip);
      }
    }
  } else {
    for (const s of sessions) await network.whitelistMAC(s.mac, s.ip);
  }
  
  console.log('[AJC] System Restoration Complete.');
}

// VOUCHER API ENDPOINTS
// Generate new vouchers (admin only)
app.post('/api/vouchers/generate', requireAdmin, async (req, res) => {
  try {
    const { amount, time_minutes, count = 1 } = req.body;
    
    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    
    if (!time_minutes || time_minutes <= 0) {
      return res.status(400).json({ error: 'Time minutes must be a positive number' });
    }
    
    if (!count || count <= 0 || count > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }
    
    const vouchers = [];
    const adminUser = req.adminUser || 'admin';
    
    // Generate unique voucher codes
    const generatedCodes = new Set();
    
    for (let i = 0; i < count; i++) {
      let code;
      let attempts = 0;
      const maxAttempts = 10;
      
      // Ensure unique code generation
      do {
        code = `V${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        attempts++;
        
        if (attempts > maxAttempts) {
          throw new Error('Failed to generate unique voucher codes after maximum attempts');
        }
      } while (generatedCodes.has(code));
      
      generatedCodes.add(code);
      
      await db.run(
        'INSERT INTO vouchers (code, amount, time_minutes, created_by) VALUES (?, ?, ?, ?)',
        [code, amount, time_minutes, adminUser]
      );
      
      vouchers.push({
        code,
        amount,
        time_minutes,
        created_at: new Date().toISOString()
      });
    }
    
    res.status(201).json({ 
      success: true, 
      vouchers, 
      message: `Successfully generated ${count} voucher(s)`,
      count: vouchers.length
    });
  } catch (err) {
    console.error('[VOUCHER] Generate error:', err);
    res.status(500).json({ 
      error: 'Failed to generate vouchers',
      message: err.message 
    });
  }
});

// Get all vouchers (admin only)
app.get('/api/vouchers', async (req, res) => {
  try {
    const vouchers = await db.all(
      'SELECT id, code, amount, time_minutes, created_at, used_at, used_by_mac, used_by_ip, is_used, created_by FROM vouchers ORDER BY created_at DESC'
    );
    res.json(vouchers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete voucher (admin only)
app.delete('/api/vouchers/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if voucher exists and is unused
    const voucher = await db.get('SELECT * FROM vouchers WHERE id = ? AND is_used = 0', [id]);
    if (!voucher) {
      return res.status(404).json({ error: 'Voucher not found or already used' });
    }
    
    await db.run('DELETE FROM vouchers WHERE id = ?', [id]);
    res.json({ success: true, message: 'Voucher deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activate voucher (public endpoint)
app.post('/api/vouchers/activate', async (req, res) => {
  try {
    const { code } = req.body;
    const clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
    const mac = await getMacFromIp(clientIp);
    let requestedToken = getSessionToken(req);
    
    // Validation
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ 
        error: 'Voucher code is required',
        message: 'Please provide a valid voucher code'
      });
    }
    
    if (!mac) {
      return res.status(400).json({ 
        error: 'Device identification failed',
        message: 'Could not identify your device. Please try again or contact support.'
      });
    }
    
    // Find unused voucher
    const voucher = await db.get('SELECT * FROM vouchers WHERE code = ? AND is_used = 0', [code.toUpperCase().trim()]);
    if (!voucher) {
      return res.status(404).json({ 
        error: 'Invalid voucher',
        message: 'Invalid or already used voucher code. Please check the code and try again.'
      });
    }
    
    const seconds = voucher.time_minutes * 60;
    const amount = voucher.amount;
    
    const existingSessionForMac = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
    if (existingSessionForMac && (existingSessionForMac.remaining_seconds || 0) > 0) {
      if (existingSessionForMac.token && requestedToken && existingSessionForMac.token !== requestedToken) {
        requestedToken = existingSessionForMac.token;
      } else if (!requestedToken && existingSessionForMac.token) {
        requestedToken = existingSessionForMac.token;
      }
    }
    
    let tokenToUse = requestedToken || null;
    let migratedOldMac = null;
    let migratedOldIp = null;
    if (requestedToken) {
      const sessionByToken = await db.get('SELECT * FROM sessions WHERE token = ?', [requestedToken]);
      if (sessionByToken) {
        if (sessionByToken.mac === mac) {
          await db.run(
            'UPDATE sessions SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + ?, ip = ? WHERE token = ?',
            [seconds, amount, clientIp, requestedToken]
          );
          tokenToUse = requestedToken;
        } else {
          const targetSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
          let extraTime = 0;
          let extraPaid = 0;
          if (targetSession) {
            extraTime = targetSession.remaining_seconds || 0;
            extraPaid = targetSession.total_paid || 0;
            await db.run('DELETE FROM sessions WHERE mac = ?', [mac]);
          }
          await db.run('DELETE FROM sessions WHERE mac = ?', [sessionByToken.mac]);
          await db.run(
            'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, connected_at, token) VALUES (?, ?, ?, ?, ?, ?)',
            [mac, clientIp, (sessionByToken.remaining_seconds || 0) + extraTime + seconds, (sessionByToken.total_paid || 0) + extraPaid + amount, sessionByToken.connected_at, requestedToken]
          );
          migratedOldMac = sessionByToken.mac;
          migratedOldIp = sessionByToken.ip;
          tokenToUse = requestedToken;
        }
      } else {
        const existingByMac = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
        if (existingByMac) {
          const existingToken = existingByMac.token;
          const hasTime = (existingByMac.remaining_seconds || 0) > 0;
          const canonicalToken = hasTime && existingToken ? existingToken : (existingToken || requestedToken);
          await db.run(
            'UPDATE sessions SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + ?, ip = ?, token = ? WHERE mac = ?',
            [seconds, amount, clientIp, canonicalToken, mac]
          );
          tokenToUse = canonicalToken;
        } else {
          await db.run(
            'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, token) VALUES (?, ?, ?, ?, ?)',
            [mac, clientIp, seconds, amount, requestedToken]
          );
          tokenToUse = requestedToken;
        }
      }
    }

    // Fallback: get existing token by current MAC or generate a new one
    if (!tokenToUse) {
      const existingSession = await db.get('SELECT token FROM sessions WHERE mac = ?', [mac]);
      tokenToUse = existingSession && existingSession.token ? existingSession.token : crypto.randomBytes(16).toString('hex');
      await db.run(
        'INSERT INTO sessions (mac, ip, remaining_seconds, total_paid, token) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mac) DO UPDATE SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + ?, ip = ?, token = ?',
        [mac, clientIp, seconds, amount, tokenToUse, seconds, amount, clientIp, tokenToUse]
      );
    }
    
    // Whitelist the device in firewall and, if migrated, block the old MAC
    await network.whitelistMAC(mac, clientIp);
    if (migratedOldMac && migratedOldIp) {
      await network.blockMAC(migratedOldMac, migratedOldIp);
    }
    
    // Mark voucher as used
    await db.run(
      'UPDATE vouchers SET is_used = 1, used_at = CURRENT_TIMESTAMP, used_by_mac = ?, used_by_ip = ? WHERE id = ?',
      [mac, clientIp, voucher.id]
    );
    
    console.log(`[VOUCHER] Voucher ${code} activated for ${mac} (${clientIp}) - ${seconds}s, ₱${amount}`);
    
    const afterSession = await db.get('SELECT remaining_seconds FROM sessions WHERE mac = ?', [mac]);
    const totalSeconds = afterSession?.remaining_seconds || seconds;
    const totalMinutes = Math.floor(totalSeconds / 60);
    console.log(`[VOUCHER] Total time now: ${totalMinutes}m (${totalSeconds}s) | Session ID: ${tokenToUse}`);
    
    try {
      res.cookie('ajc_session_token', tokenToUse, { path: '/', maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    } catch (e) {}
    res.status(200).json({ 
      success: true, 
      mac, 
      token: tokenToUse, 
      time_minutes: voucher.time_minutes,
      amount: voucher.amount,
      message: 'Internet access granted! Your session will start shortly. Please refresh your browser if connection is not established.'
    });
  } catch (err) {
    console.error('[VOUCHER] Activation error:', err);
    res.status(500).json({ 
      error: 'Activation failed',
      message: 'An error occurred while activating your voucher. Please try again or contact support.'
    });
  }
});

function startBackgroundTimers() {
  setInterval(() => { refreshPPPoEExpiredSettings(); }, 30000);
  refreshPPPoEExpiredSettings();

  setInterval(async () => {
    try {
      await db.run(
        'UPDATE sessions SET remaining_seconds = remaining_seconds - 1 WHERE remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)'
      );

      const expired = await db.all(
        'SELECT mac, ip FROM sessions WHERE remaining_seconds <= 0 AND (expired_at IS NULL OR expired_at = 0)'
      );
      for (const s of expired) {
        await network.blockMAC(s.mac, s.ip);
        await db.run('UPDATE sessions SET expired_at = ? WHERE mac = ?', [Date.now(), s.mac]);
      }
    } catch (e) { console.error(e); }
  }, 1000);

  setInterval(async () => {
    try {
      const inactiveSessions = await db.all('SELECT mac, ip FROM sessions WHERE remaining_seconds <= 0');
      for (const session of inactiveSessions) {
        await network.removeSpeedLimit(session.mac, session.ip);
      }
      const activeSessions = await db.all('SELECT ip FROM sessions WHERE remaining_seconds > 0');
      const activeIPs = new Set(activeSessions.map(s => s.ip));
      const { stdout: interfacesOutput } = await execPromise(`ip link show | grep -E "eth|wlan|br|vlan" | awk '{print $2}' | sed 's/:$//'`).catch(() => ({ stdout: '' }));
      const interfaces = interfacesOutput.trim().split('\n').filter(i => i);
      for (const iface of interfaces) {
        try {
          const { stdout: downloadFilters } = await execPromise(`tc filter show dev ${iface} parent 1:0 2>/dev/null || echo ""`).catch(() => ({ stdout: '' }));
          const downloadIPs = downloadFilters.match(/\d+\.\d+\.\d+\.\d+/g) || [];
          for (const ip of downloadIPs) {
            if (!activeIPs.has(ip)) {
              await execPromise(`tc filter del dev ${iface} parent 1:0 protocol ip prio 1 u32 match ip dst ${ip} 2>/dev/null || true`).catch(() => {});
            }
          }
          const { stdout: uploadFilters } = await execPromise(`tc filter show dev ${iface} parent ffff: 2>/dev/null || echo ""`).catch(() => ({ stdout: '' }));
          const uploadIPs = uploadFilters.match(/\d+\.\d+\.\d+\.\d+/g) || [];
          for (const ip of uploadIPs) {
            if (!activeIPs.has(ip)) {
              await execPromise(`tc filter del dev ${iface} parent ffff: protocol ip prio 1 u32 match ip src ${ip} 2>/dev/null || true`).catch(() => {});
            }
          }
        } catch (e) {}
      }
    } catch (e) { console.error('[CLEANUP] Periodic TC cleanup error:', e.message); }
  }, 30000);

  const processExpiredPPPoEUsers = async () => {
    try {
      const expiredUsers = await db.all(
        "SELECT * FROM pppoe_users WHERE enabled = 1 AND (expired_at IS NULL OR expired_at = '') AND expires_at IS NOT NULL AND expires_at != '' AND datetime(replace(expires_at,'T',' ')) <= datetime('now','localtime')"
      );
      if (!expiredUsers.length) return;

      console.log(`[PPPoE-Expire] Found ${expiredUsers.length} expired users. Expired pool mode: ${pppoeExpiredPool ? 'ON' : 'OFF'}`);

      const company = await settings.getCompanySettings().catch(() => ({ companyName: 'AJC PISOWIFI' }));
      const companyName = company?.companyName ? String(company.companyName) : 'AJC PISOWIFI';

      if (!fs.existsSync(PPPoE_BILLING_DIR)) {
        fs.mkdirSync(PPPoE_BILLING_DIR, { recursive: true });
      }

      for (const u of expiredUsers) {
        try {
          await db.run(
            "UPDATE pppoe_users SET expired_at = COALESCE(expired_at, CURRENT_TIMESTAMP) WHERE id = ?",
            [u.id]
          );

          // Sync secrets BEFORE kicking to ensure user can't reconnect with valid credentials
          await network.syncPPPoESecrets().catch(() => {});

          console.log(`[PPPoE-Expire] Kicking active connection for expired user "${u.username}"...`);
          await network.disconnectPPPoEUser(u.username).catch(() => {});
          
          // Clear the user's IP address so they get a new one on reconnect
          await db.run('UPDATE pppoe_users SET ip_address = NULL WHERE id = ?', [u.id]).catch(() => {});

          const existingInvoice = await db.get(
            'SELECT id FROM pppoe_invoices WHERE user_id = ? AND expires_at = ? LIMIT 1',
            [u.id, u.expires_at]
          );
          if (existingInvoice) continue;

          let billing = null;
          if (u.billing_profile_id) {
            billing = await db.get(
              `SELECT bp.id, bp.name as billing_profile_name, bp.price, p.name as profile_name
               FROM pppoe_billing_profiles bp
               LEFT JOIN pppoe_profiles p ON p.id = bp.profile_id
               WHERE bp.id = ?`,
              [u.billing_profile_id]
            );
          }

          const generatedAt = new Date().toISOString();
          const invoiceNo = `INV-PPPOE-${u.account_number || u.id}-${Date.now()}`;
          const amount = billing?.price || 0;
          const periodStart = u.last_billed_at || u.created_at || null;
          const periodEnd = u.expires_at || generatedAt;

          const insert = await db.run(
            `INSERT INTO pppoe_invoices
              (invoice_no, user_id, account_number, username, billing_profile_id, billing_profile_name, profile_name, amount, currency, period_start, period_end, expires_at, generated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PHP', ?, ?, ?, ?)`,
            [
              invoiceNo,
              u.id,
              u.account_number || null,
              u.username,
              u.billing_profile_id || null,
              billing?.billing_profile_name || null,
              billing?.profile_name || null,
              amount,
              periodStart,
              periodEnd,
              u.expires_at || null,
              generatedAt
            ]
          );

          const pdfPath = path.join(PPPoE_BILLING_DIR, `${invoiceNo}.pdf`);
          const generatedPdf = await generatePPPoEInvoicePdf({
            outputPath: pdfPath,
            invoice: {
              company_name: companyName,
              invoice_no: invoiceNo,
              generated_at: generatedAt,
              account_number: u.account_number || '',
              username: u.username,
              billing_profile_name: billing?.billing_profile_name || '',
              profile_name: billing?.profile_name || '',
              amount,
              period_start: periodStart || '',
              period_end: periodEnd || '',
              expires_at: u.expires_at || ''
            }
          });
          if (generatedPdf) {
            await db.run('UPDATE pppoe_invoices SET pdf_path = ? WHERE id = ?', [pdfPath, insert.lastID]);
          }

          await db.run('UPDATE pppoe_users SET last_billed_at = ? WHERE id = ?', [periodEnd, u.id]);
        } catch (e) {
          console.error('[PPPoE-Expire] Per-user processing failed:', e.message);
        }
      }

      // Final sync to ensure all expired users are properly handled
      await network.syncPPPoESecrets().catch(() => {});
    } catch (e) {
      console.error('[PPPoE-Expire] Job failed:', e.message);
    }
  };

  setInterval(() => { processExpiredPPPoEUsers(); }, 15000);
  processExpiredPPPoEUsers();

  // Periodic refresh of iptables rules for expired users (when no expired pool is configured)
  const refreshExpiredUserFirewallRules = async () => {
    try {
      const { pool } = await network.getPPPoEExpiredSettings().catch(() => ({ pool: null }));
      // Only apply if no expired pool is configured (we handle this via iptables)
      if (!pool || !pool.ip_pool_start || !pool.ip_pool_end) {
        await network.initFirewall().catch(() => {});
      }
    } catch (e) {
      console.error('[PPPoE-Expire] Firewall refresh failed:', e.message);
    }
  };
  setInterval(refreshExpiredUserFirewallRules, 30000);
  refreshExpiredUserFirewallRules();

  const syncPPPoEUserPresence = async () => {
    try {
      const sessions = await network.getPPPoESessions().catch(() => []);
      const active = new Map();
      const activeIfaceByUsername = new Map();
      for (const s of sessions) {
        const uname = String(s?.username || '').trim();
        if (!uname || uname.toLowerCase() === 'unknown') continue;
        const ip = String(s?.ip || '').trim();
        active.set(uname, ip);
        const ifn = String(s?.interface || '').trim();
        if (ifn) activeIfaceByUsername.set(uname, ifn);
      }

      const rateRows = await db.all(
        `SELECT u.username as username, p.rate_limit_dl as rate_limit_dl, p.rate_limit_ul as rate_limit_ul
         FROM pppoe_users u
         LEFT JOIN pppoe_billing_profiles bp ON bp.id = u.billing_profile_id
         LEFT JOIN pppoe_profiles p ON p.id = bp.profile_id`
      ).catch(() => []);
      const rateByUsername = new Map();
      for (const r of rateRows || []) {
        const uname = String(r.username || '').trim();
        if (!uname) continue;
        rateByUsername.set(uname, {
          dl: Number(r.rate_limit_dl || 0),
          ul: Number(r.rate_limit_ul || 0)
        });
      }

      const ifacesApplied = new Set();
      for (const [uname, ifn] of activeIfaceByUsername.entries()) {
        if (!ifn || ifacesApplied.has(ifn)) continue;
        ifacesApplied.add(ifn);
        const rate = rateByUsername.get(uname) || { dl: 0, ul: 0 };
        await network.applyPPPoERateLimit(ifn, rate.dl, rate.ul).catch(() => {});
      }

      const users = await db.all('SELECT id, username, is_online, ip_address FROM pppoe_users');
      const now = new Date().toISOString();

      for (const u of users) {
        const uname = String(u.username || '').trim();
        if (!uname) continue;
        const activeIp = active.get(uname) || '';
        const shouldBeOnline = active.has(uname) ? 1 : 0;
        const wasOnline = u.is_online ? 1 : 0;

        if (shouldBeOnline) {
          const updates = [];
          const values = [];
          if (!wasOnline) {
            updates.push('is_online = 1', 'last_online_at = ?');
            values.push(now);
          }
          if (activeIp && activeIp !== 'N/A' && activeIp !== u.ip_address) {
            updates.push('ip_address = ?');
            values.push(activeIp);
          }
          if (updates.length) {
            values.push(u.id);
            await db.run(`UPDATE pppoe_users SET ${updates.join(', ')} WHERE id = ?`, values);
          }
        } else {
          if (wasOnline) {
            await db.run('UPDATE pppoe_users SET is_online = 0, last_offline_at = ? WHERE id = ?', [now, u.id]);
          }
        }
      }
    } catch (e) {}
  };

  setInterval(() => { syncPPPoEUserPresence(); }, 15000);
  syncPPPoEUserPresence();
}

(async () => {
  try {
    await db.init();
  } catch (e) {
    console.error('[AJC] Critical DB Init Error:', e);
    process.exit(1);
  }

  startBackgroundTimers();

  server.listen(80, '0.0.0.0', async () => {
    console.log('[AJC] System Engine Online @ Port 80');
  
  // License Gatekeeper - Check if system can operate
  console.log('[License] Checking license and trial status...');
  try {
    if (!systemHardwareId) {
      systemHardwareId = await getUniqueHardwareId();
    }

    const verification = await licenseManager.verifyLicense();
    const trialStatus = await checkTrialStatus(systemHardwareId, verification);
    
    const isLicensed = verification.isValid && verification.isActivated;
    const isRevoked = verification.isRevoked || trialStatus.isRevoked;
    const canOperate = (isLicensed || trialStatus.isTrialActive) && !isRevoked;

    console.log(`[License] Hardware ID: ${systemHardwareId}`);
    console.log(`[License] Licensed: ${isLicensed ? 'YES' : 'NO'}`);
    console.log(`[License] Trial Active: ${trialStatus.isTrialActive ? 'YES' : 'NO'}`);
    console.log(`[License] Revoked: ${isRevoked ? 'YES' : 'NO'}`);
    
    if (isRevoked) {
      console.warn('[License] System in restricted mode (Revoked)');
    } else if (!canOperate) {
      console.warn('[License] System in restricted mode (Expired)');
    } else {
      console.log('[License] ✓ License verification passed - Starting services...');
    }
  } catch (error) {
    console.error('[License] Error during license check:', error);
    console.warn('[License] Proceeding with caution...');
  }
  
  // Display cloud sync status
  const syncStats = getSyncStats();
  console.log('[EdgeSync] Configuration:', syncStats.configured ? '✓ Connected' : '✗ Not configured');
  if (syncStats.configured) {
    console.log(`[EdgeSync] Machine ID: ${syncStats.machineId}`);
    console.log(`[EdgeSync] Vendor ID: ${syncStats.vendorId}`);
    console.log(`[EdgeSync] Status sync: ${syncStats.statusSyncActive ? 'Active (60s interval)' : 'Inactive'}`);
    if (syncStats.queuedSyncs > 0) {
      console.log(`[EdgeSync] Queued syncs: ${syncStats.queuedSyncs} (will retry)`);
    }
  } else {
    console.warn('[EdgeSync] Cloud sync disabled - MACHINE_ID or VENDOR_ID not set in .env');
  }

  // Voucher APIs and Timers moved to top level

  
  // Always call bootupRestore but pass revocation status if needed
  // We can fetch it inside bootupRestore or pass it
  const verificationStatus = await licenseManager.verifyLicense();
  const trialStatusInfo = await checkTrialStatus(systemHardwareId, verificationStatus);
  const isLicensedNow = verificationStatus.isValid && verificationStatus.isActivated;
  const isRevokedNow = verificationStatus.isRevoked || trialStatusInfo.isRevoked;
  const canOperateNow = (isLicensedNow || trialStatusInfo.isTrialActive) && !isRevokedNow;
  await bootupRestore(!canOperateNow);
  });
})();

// ==========================================
// FREE INTERNET FEATURE API
// ==========================================

// Get free internet config (public)
app.get('/api/free-internet/config', async (req, res) => {
  try {
    const config = await db.get('SELECT value FROM config WHERE key = ?', ['free_internet_config']);
    const defaultConfig = { enabled: false, minutes: 0, message: '', cooldownDays: 1 };
    res.json(config?.value ? JSON.parse(config.value) : defaultConfig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update free internet config (admin only)
app.post('/api/free-internet/config', requireAdmin, async (req, res) => {
  try {
    const { enabled, minutes, message, cooldownDays } = req.body;
    const config = {
      enabled: enabled === true,
      minutes: parseInt(minutes, 10) || 0,
      message: message || '',
      cooldownDays: Math.max(1, parseInt(cooldownDays, 10) || 1)
    };
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['free_internet_config', JSON.stringify(config)]);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claim free internet (public)
app.post('/api/free-internet/claim', async (req, res) => {
  try {
    // Get free internet config
    const config = await db.get('SELECT value FROM config WHERE key = ?', ['free_internet_config']);
    const freeConfig = config?.value ? JSON.parse(config.value) : { enabled: false, minutes: 0, cooldownDays: 1 };

    if (!freeConfig.enabled || freeConfig.minutes <= 0) {
      return res.status(400).json({ error: 'Free internet is not available at this time.' });
    }

    // Get client MAC address
    let clientIp = req.ip ? req.ip.replace('::ffff:', '') : '';
    if (clientIp === '::1') clientIp = '127.0.0.1';
    let mac = await getMacFromIp(clientIp);
    if (!mac && clientIp === '127.0.0.1') mac = 'DEV-LOCALHOST';

    if (!mac) {
      return res.status(400).json({ error: 'Could not identify your device. Please reconnect to WiFi.' });
    }

    // Check cooldown: look up last claim timestamp for this MAC
    const cooldownDays = Math.max(1, freeConfig.cooldownDays || 1);
    const lastClaimKey = `free_internet_last_claim_${mac.toUpperCase()}`;
    const lastClaimRow = await db.get('SELECT value FROM config WHERE key = ?', [lastClaimKey]);

    if (lastClaimRow && lastClaimRow.value) {
      const lastClaimTime = parseInt(lastClaimRow.value, 10);
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      const nextAvailableTime = lastClaimTime + cooldownMs;
      const now = Date.now();

      if (now < nextAvailableTime) {
        const remainingMs = nextAvailableTime - now;
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
        let waitMessage = '';
        if (remainingDays > 1) {
          waitMessage = `You can claim free internet again in ${remainingDays} days.`;
        } else {
          waitMessage = `You can claim free internet again in ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}.`;
        }
        return res.status(400).json({
          error: waitMessage,
          nextAvailableAt: nextAvailableTime,
          cooldownDays: cooldownDays
        });
      }
    }

    // Create session for free internet
    const token = crypto.randomBytes(16).toString('hex');
    const seconds = freeConfig.minutes * 60;

    // Check if device exists
    const existingDevice = await db.get('SELECT id FROM wifi_devices WHERE mac = ?', [mac]);
    if (!existingDevice) {
      await db.run(
        'INSERT INTO wifi_devices (id, mac, ip, hostname, interface, ssid, signal, connected_at, last_seen, is_active, custom_name, credit_pesos, credit_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [mac, mac, clientIp, 'FreeInternet', 'wlan0', 'FreeInternet', 0, Date.now(), Date.now(), 1, '', 0, 0]
      );
    }

    // Check for existing session
    const existingSession = await db.get('SELECT * FROM sessions WHERE mac = ?', [mac]);
    
    if (existingSession) {
      // Add time to existing session
      await db.run(
        'UPDATE sessions SET remaining_seconds = remaining_seconds + ?, total_paid = total_paid + 0 WHERE mac = ?',
        [seconds, mac]
      );
    } else {
      // Create new session
      await db.run(
        'INSERT INTO sessions (mac, ip, token, remaining_seconds, total_paid, connected_at, download_limit, upload_limit, is_paused, pausable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [mac, clientIp, token, seconds, 0, Date.now(), 0, 0, 0, 1]
      );
    }

    // Mark as claimed - store timestamp per MAC
    await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [lastClaimKey, String(Date.now())]);

    res.json({
      success: true,
      minutes: freeConfig.minutes,
      message: freeConfig.message || 'Enjoy your free internet!',
      token: existingSession ? existingSession.token : token,
      cooldownDays: cooldownDays
    });
  } catch (err) {
    console.error('[FreeInternet] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// DHCP LEASES API
// ==========================================

// Get all DHCP leases from dnsmasq/dhcpd lease files
app.get('/api/dhcp-leases', requireAdmin, async (req, res) => {
  try {
    const leaseFiles = [
      '/tmp/dhcp.leases',
      '/var/lib/dnsmasq/dnsmasq.leases',
      '/var/lib/misc/dnsmasq.leases',
      '/var/lib/dhcp/dhcpd.leases'
    ];

    const leases = [];

    for (const file of leaseFiles) {
      try {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 4) continue;

          // dnsmasq lease format: <timestamp> <mac> <ip> <hostname> <client-id>
          // dhcpd lease format is different - detect by first field
          const maybeTimestamp = parseInt(parts[0], 10);
          const maybeMac = parts[1];

          if (!Number.isNaN(maybeTimestamp) && maybeMac && maybeMac.match(/^[a-fA-F0-9:]{17}$/)) {
            // dnsmasq format
            const expiry = maybeTimestamp;
            const mac = maybeMac.toUpperCase();
            const ip = parts[2];
            const hostname = parts[3] && parts[3] !== '*' ? parts[3] : '';
            const clientId = parts[4] || '';

            // Avoid duplicates (same MAC)
            if (!leases.find(l => l.mac === mac)) {
              leases.push({
                mac,
                ip,
                hostname,
                clientId,
                expiry: expiry > 0 ? new Date(expiry * 1000).toISOString() : null,
                source: file
              });
            }
          }
        }
      } catch (e) {
        // Skip files that can't be read
      }
    }

    // Also try parsing dnsmasq.leases with IPv6 or extended format
    // and try ip neigh as a supplement for currently active devices
    try {
      const { stdout } = await execPromise('ip neigh show').catch(() => ({ stdout: '' }));
      const neighLines = String(stdout || '').split('\n').filter(l => l.trim());
      for (const line of neighLines) {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+dev\s+(\S+)\s+lladdr\s+([a-fA-F0-9:]+)\s+(\S+)/);
        if (match) {
          const ip = match[1];
          const iface = match[2];
          const mac = match[3].toUpperCase();
          const state = match[4];

          // Only add if not already in leases (from DHCP file)
          if (!leases.find(l => l.mac === mac)) {
            leases.push({
              mac,
              ip,
              hostname: '',
              clientId: '',
              expiry: null,
              interface: iface,
              state: state,
              source: 'arp'
            });
          } else {
            // Enrich existing lease with interface/state info
            const existing = leases.find(l => l.mac === mac);
            if (existing) {
              existing.interface = iface;
              existing.state = state;
            }
          }
        }
      }
    } catch (e) {}

    // Sort by IP address numerically
    leases.sort((a, b) => {
      const aParts = a.ip.split('.').map(Number);
      const bParts = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });

    res.json({ leases, total: leases.length });
  } catch (err) {
    console.error('[DHCP] Error reading leases:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SPEEDTEST (Ookla CLI) API
// ==========================================

const { execFile } = require('child_process');

// Check if Ookla Speedtest CLI is installed
app.get('/api/speedtest/status', requireAdmin, async (req, res) => {
  try {
    const speedtestPath = '/usr/bin/speedtest';
    const speedtestAltPath = '/usr/local/bin/speedtest';
    const fsSync = require('fs');

    let installed = false;
    let cliPath = '';
    for (const p of [speedtestPath, speedtestAltPath]) {
      try {
        await fsSync.promises.access(p, fsSync.constants.X_OK);
        installed = true;
        cliPath = p;
        break;
      } catch {}
    }

    // Check if terms are accepted
    let termsAccepted = false;
    if (installed) {
      try {
        const { execSync } = require('child_process');
        // If speedtest --accept-license works without error, terms are accepted or not needed
        const result = execSync(`${cliPath} --accept-license --version 2>&1`, { timeout: 5000 }).toString();
        termsAccepted = true;
      } catch (e) {
        // If it fails, terms may not be accepted
        termsAccepted = false;
      }
    }

    res.json({ installed, cliPath, termsAccepted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept Ookla Speedtest terms/license
app.post('/api/speedtest/accept-terms', requireAdmin, async (req, res) => {
  try {
    const speedtestPath = '/usr/bin/speedtest';
    const speedtestAltPath = '/usr/local/bin/speedtest';
    const fsSync = require('fs');

    let cliPath = '';
    for (const p of [speedtestPath, speedtestAltPath]) {
      try {
        await fsSync.promises.access(p, fsSync.constants.X_OK);
        cliPath = p;
        break;
      } catch {}
    }

    if (!cliPath) {
      return res.status(400).json({ error: 'Speedtest CLI is not installed. Install it first: https://www.speedtest.net/apps/cli' });
    }

    const { execSync } = require('child_process');
    // Run with --accept-license and --accept-gdpr to accept terms
    execSync(`${cliPath} --accept-license --accept-gdpr --version 2>&1`, { timeout: 10000 });
    res.json({ success: true, message: 'Ookla Speedtest terms accepted successfully.' });
  } catch (err) {
    console.error('[Speedtest] Accept terms error:', err.message);
    res.status(500).json({ error: 'Failed to accept terms: ' + err.message });
  }
});

// Run speedtest (server-side, tests WAN of the machine)
app.post('/api/speedtest/run', requireAdmin, async (req, res) => {
  try {
    const speedtestPath = '/usr/bin/speedtest';
    const speedtestAltPath = '/usr/local/bin/speedtest';
    const fsSync = require('fs');

    let cliPath = '';
    for (const p of [speedtestPath, speedtestAltPath]) {
      try {
        await fsSync.promises.access(p, fsSync.constants.X_OK);
        cliPath = p;
        break;
      } catch {}
    }

    if (!cliPath) {
      return res.status(400).json({ error: 'Speedtest CLI is not installed. Install it from https://www.speedtest.net/apps/cli' });
    }

    // Run speedtest with JSON output, accept license & GDPR
    execFile(cliPath, ['--accept-license', '--accept-gdpr', '--format=json'], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[Speedtest] Run error:', err.message);
        return res.status(500).json({ error: 'Speedtest failed: ' + err.message });
      }

      try {
        const result = JSON.parse(stdout);
        res.json({
          success: true,
          ping: result.ping?.latency ?? null,
          jitter: result.ping?.jitter ?? null,
          download: result.download?.bandwidth ?? null,   // bytes/sec
          upload: result.upload?.bandwidth ?? null,        // bytes/sec
          server: result.server?.name ?? null,
          serverId: result.server?.id ?? null,
          serverLocation: result.server?.location ?? null,
          ip: result.interface?.externalIp ?? null,
          timestamp: result.timestamp ?? new Date().toISOString(),
          resultUrl: result.result?.url ?? null
        });
      } catch (parseErr) {
        console.error('[Speedtest] Parse error:', parseErr.message);
        // Return raw output if JSON parse fails
        res.json({ success: true, raw: stdout });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Install Ookla Speedtest CLI (Debian/Ubuntu)
app.post('/api/speedtest/install', requireAdmin, async (req, res) => {
  try {
    const { execSync } = require('child_process');

    // Check if already installed
    try {
      execSync('which speedtest 2>/dev/null || true', { timeout: 5000 });
      const checkResult = execSync('which speedtest 2>/dev/null', { timeout: 5000 }).toString().trim();
      if (checkResult) {
        return res.json({ success: true, message: 'Speedtest CLI is already installed at: ' + checkResult });
      }
    } catch {}

    // Install Ookla Speedtest CLI
    const commands = [
      'apt-get update -y',
      'apt-get install -y curl',
      'curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash',
      'apt-get install -y speedtest'
    ];

    for (const cmd of commands) {
      try {
        execSync(cmd, { timeout: 120000 });
      } catch (cmdErr) {
        console.warn(`[Speedtest] Install step failed: ${cmd}`, cmdErr.message);
      }
    }

    // Verify installation
    try {
      const verifyPath = execSync('which speedtest 2>/dev/null', { timeout: 5000 }).toString().trim();
      if (verifyPath) {
        return res.json({ success: true, message: 'Speedtest CLI installed successfully at: ' + verifyPath });
      }
    } catch {}

    res.status(500).json({ error: 'Failed to install Speedtest CLI. Please install manually.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SSH TERMINAL API (Local Machine CLI)
// ==========================================

// Execute SSH command on the local machine
app.post('/api/terminal/exec', requireAdmin, async (req, res) => {
  try {
    const { command } = req.body;
    
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'Command is required' });
    }

    // Security: Block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+\//i,
      />\s*\/dev\/null/i,
      /mkfs\./i,
      /dd\s+if=/i,
      /:\(\)\s*\{\s*:\|:\s*&\s*\};/i, // Fork bomb
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return res.status(403).json({ 
          error: 'Command blocked for security reasons',
          stdout: '',
          stderr: 'This command is not allowed',
          exitCode: 1
        });
      }
    }

    // Execute command with timeout
    const { stdout, stderr } = await execPromise(command, { 
      timeout: 30000,
      maxBuffer: 1024 * 1024 // 1MB buffer
    });

    res.json({
      success: true,
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
      command: command
    });
  } catch (err) {
    // Command failed but we still return the output
    res.json({
      success: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
      command: req.body.command
    });
  }
});

// Get system info for terminal (hostname, user, pwd)
app.get('/api/terminal/info', requireAdmin, async (req, res) => {
  try {
    const hostname = require('os').hostname();
    const username = process.env.USER || process.env.USERNAME || 'root';
    
    let cwd = '/';
    try {
      cwd = process.cwd();
    } catch (e) {}

    res.json({
      hostname,
      username,
      cwd,
      shell: process.env.SHELL || '/bin/bash'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route for frontend (must be last)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/dist')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'index.html'));
});
