const crypto = require('crypto');
const db = require('./db');
const { RouterOSClient } = require('routeros-api');

async function getOrCreateSecret() {
  const row = await db.get('SELECT value FROM config WHERE key = ?', ['mikrotik_secret_key']).catch(() => null);
  const existing = row?.value ? String(row.value) : '';
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString('base64');
  await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['mikrotik_secret_key', secret]);
  return secret;
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

async function encryptText(plain) {
  const key = deriveKey(await getOrCreateSecret());
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
}

async function decryptText(payload) {
  const raw = String(payload || '');
  const [ivB64, dataB64, tagB64] = raw.split(':');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Invalid encrypted payload');
  const key = deriveKey(await getOrCreateSecret());
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

async function withRouterClient(router, fn, timeoutMs = 10000) {
  const password = await decryptText(router.password_encrypted);
  const api = new RouterOSClient({
    host: String(router.host),
    user: String(router.username),
    password: String(password),
    port: Number(router.port) || 8728
  });

  let client;
  const connectPromise = api.connect().then((c) => {
    client = c;
    return c;
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
  );

  await Promise.race([connectPromise, timeoutPromise]);

  try {
    return await fn(client);
  } finally {
    try { api.close(); } catch (e) {}
  }
}

async function listRouters() {
  const rows = await db.all(
    'SELECT id, name, host, port, username, status, last_checked_at, created_at, updated_at FROM mikrotik_routers ORDER BY created_at DESC'
  );
  return rows || [];
}

async function createRouter(payload) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordEncrypted = await encryptText(payload.password);
  await db.run(
    'INSERT INTO mikrotik_routers (id, name, host, port, username, password_encrypted, status, last_checked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      String(payload.name),
      String(payload.host),
      Number(payload.port) || 8728,
      String(payload.username),
      passwordEncrypted,
      'disconnected',
      null,
      now,
      now
    ]
  );
  const row = await db.get(
    'SELECT id, name, host, port, username, status, last_checked_at, created_at, updated_at FROM mikrotik_routers WHERE id = ?',
    [id]
  );
  return row;
}

async function updateRouter(id, payload) {
  const fields = [];
  const values = [];
  if (payload.name !== undefined) { fields.push('name = ?'); values.push(String(payload.name)); }
  if (payload.host !== undefined) { fields.push('host = ?'); values.push(String(payload.host)); }
  if (payload.port !== undefined) { fields.push('port = ?'); values.push(Number(payload.port) || 8728); }
  if (payload.username !== undefined) { fields.push('username = ?'); values.push(String(payload.username)); }
  if (payload.password !== undefined) { fields.push('password_encrypted = ?'); values.push(await encryptText(payload.password)); }
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(String(id));

  if (fields.length === 0) throw new Error('No fields to update');
  await db.run(`UPDATE mikrotik_routers SET ${fields.join(', ')} WHERE id = ?`, values);
  const row = await db.get(
    'SELECT id, name, host, port, username, status, last_checked_at, created_at, updated_at FROM mikrotik_routers WHERE id = ?',
    [String(id)]
  );
  return row;
}

async function deleteRouter(id) {
  await db.run('DELETE FROM mikrotik_routers WHERE id = ?', [String(id)]);
  return { success: true };
}

async function getRouterRecord(id) {
  const row = await db.get('SELECT * FROM mikrotik_routers WHERE id = ?', [String(id)]);
  if (!row) throw new Error('Router not found');
  return row;
}

function normalizeSnapshot(identityRow, resourceRow) {
  const identity = identityRow && typeof identityRow === 'object' ? identityRow.name || identityRow.identity : undefined;
  const version = resourceRow && typeof resourceRow === 'object' ? resourceRow.version : undefined;
  const board_name = resourceRow && typeof resourceRow === 'object' ? resourceRow['board-name'] || resourceRow.board_name : undefined;
  const uptime = resourceRow && typeof resourceRow === 'object' ? resourceRow.uptime : undefined;
  const cpu_load = resourceRow && typeof resourceRow === 'object' ? Number(resourceRow['cpu-load'] || resourceRow.cpu_load) : undefined;
  const free_memory = resourceRow && typeof resourceRow === 'object' ? Number(resourceRow['free-memory'] || resourceRow.free_memory) : undefined;
  const total_memory = resourceRow && typeof resourceRow === 'object' ? Number(resourceRow['total-memory'] || resourceRow.total_memory) : undefined;
  return { identity, uptime, version, board_name, cpu_load, free_memory, total_memory };
}

async function testRouter(id) {
  const router = await getRouterRecord(id);
  const now = new Date().toISOString();

  try {
    const snapshot = await withRouterClient(router, async (client) => {
      const [identityRow, resourceRow] = await Promise.all([
        client.menu('/system identity').getOnly().catch(() => ({})),
        client.menu('/system resource').getOnly().catch(() => ({}))
      ]);
      return normalizeSnapshot(identityRow, resourceRow);
    });

    await db.run(
      "UPDATE mikrotik_routers SET status = 'connected', last_checked_at = ?, updated_at = ? WHERE id = ?",
      [now, now, String(id)]
    );

    return { success: true, snapshot };
  } catch (e) {
    await db.run(
      "UPDATE mikrotik_routers SET status = 'error', last_checked_at = ?, updated_at = ? WHERE id = ?",
      [now, now, String(id)]
    ).catch(() => {});
    return { success: false, error: e?.message || String(e) };
  }
}

async function fetchBillingData(id) {
  const router = await getRouterRecord(id);
  const now = new Date().toISOString();

  try {
    const data = await withRouterClient(router, async (client) => {
      const [identityRow, resourceRow, profiles, secrets, actives] = await Promise.all([
        client.menu('/system identity').getOnly().catch(() => ({})),
        client.menu('/system resource').getOnly().catch(() => ({})),
        client.menu('/ppp profile').get().catch(() => []),
        client.menu('/ppp secret').get().catch(() => []),
        client.menu('/ppp active').get().catch(() => [])
      ]);

      return {
        snapshot: normalizeSnapshot(identityRow, resourceRow),
        ppp_profiles: Array.isArray(profiles) ? profiles : [],
        ppp_secrets: Array.isArray(secrets) ? secrets : [],
        ppp_actives: Array.isArray(actives) ? actives : []
      };
    }, 15000);

    await db.run(
      "UPDATE mikrotik_routers SET status = 'connected', last_checked_at = ?, updated_at = ? WHERE id = ?",
      [now, now, String(id)]
    );

    return data;
  } catch (e) {
    await db.run(
      "UPDATE mikrotik_routers SET status = 'error', last_checked_at = ?, updated_at = ? WHERE id = ?",
      [now, now, String(id)]
    ).catch(() => {});

    const err = new Error(e?.message || String(e));
    err.code = 'MIKROTIK_FETCH_FAILED';
    throw err;
  }
}

module.exports = {
  listRouters,
  createRouter,
  updateRouter,
  deleteRouter,
  testRouter,
  fetchBillingData
};

