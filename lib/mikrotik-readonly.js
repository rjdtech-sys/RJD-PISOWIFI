const crypto = require('crypto');
const db = require('./db');
const { RouterOSClient } = require('routeros-api');

function normalizeConnectionType(value, port) {
  const v = String(value || '').toLowerCase();
  if (v === 'rest') return 'rest';
  if (v === 'api') return 'api';
  const p = Number(port);
  if (p === 80 || p === 443) return 'rest';
  return 'api';
}

function normalizeRestScheme(value, port) {
  const v = String(value || '').toLowerCase();
  if (v === 'https') return 'https';
  if (v === 'http') return 'http';
  const p = Number(port);
  if (p === 443) return 'https';
  return 'http';
}

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

async function restGetJson({ host, port, username, password, scheme }, restPath, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const baseUrl = `${scheme || 'http'}://${host}:${Number(port) || 80}`;
  const url = `${baseUrl}${restPath.startsWith('/') ? '' : '/'}${restPath}`;
  const auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      signal: controller.signal
    });

    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }

    if (!res.ok) {
      const msg = (json && (json.detail || json.error || json.message))
        ? String(json.detail || json.error || json.message)
        : (text ? String(text).slice(0, 200) : `HTTP ${res.status}`);
      throw new Error(msg);
    }

    return json;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Connection timeout');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSnapshotRest(identityJson, resourceJson) {
  const identityRow = Array.isArray(identityJson) ? identityJson[0] : identityJson;
  const resourceRow = Array.isArray(resourceJson) ? resourceJson[0] : resourceJson;
  return normalizeSnapshot(identityRow || {}, resourceRow || {});
}

async function listRouters() {
  const rows = await db.all(
    'SELECT id, name, host, port, connection_type, rest_scheme, username, status, last_checked_at, created_at, updated_at FROM mikrotik_routers ORDER BY created_at DESC'
  );
  return rows || [];
}

async function createRouter(payload) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordEncrypted = await encryptText(payload.password);
  const connection_type = normalizeConnectionType(payload.connection_type, payload.port);
  const rest_scheme = normalizeRestScheme(payload.rest_scheme, payload.port);
  await db.run(
    'INSERT INTO mikrotik_routers (id, name, host, port, connection_type, rest_scheme, username, password_encrypted, status, last_checked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      String(payload.name),
      String(payload.host),
      Number(payload.port) || 8728,
      connection_type,
      rest_scheme,
      String(payload.username),
      passwordEncrypted,
      'disconnected',
      null,
      now,
      now
    ]
  );
  const row = await db.get(
    'SELECT id, name, host, port, connection_type, rest_scheme, username, status, last_checked_at, created_at, updated_at FROM mikrotik_routers WHERE id = ?',
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
  if (payload.connection_type !== undefined) { fields.push('connection_type = ?'); values.push(normalizeConnectionType(payload.connection_type, payload.port)); }
  if (payload.rest_scheme !== undefined) { fields.push('rest_scheme = ?'); values.push(normalizeRestScheme(payload.rest_scheme, payload.port)); }
  if (payload.username !== undefined) { fields.push('username = ?'); values.push(String(payload.username)); }
  if (payload.password !== undefined) { fields.push('password_encrypted = ?'); values.push(await encryptText(payload.password)); }
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(String(id));

  if (fields.length === 0) throw new Error('No fields to update');
  await db.run(`UPDATE mikrotik_routers SET ${fields.join(', ')} WHERE id = ?`, values);
  const row = await db.get(
    'SELECT id, name, host, port, connection_type, rest_scheme, username, status, last_checked_at, created_at, updated_at FROM mikrotik_routers WHERE id = ?',
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

  const connectionType = normalizeConnectionType(router.connection_type, router.port);
  const restScheme = normalizeRestScheme(router.rest_scheme, router.port);

  try {
    const snapshot = connectionType === 'rest'
      ? await (async () => {
          const password = await decryptText(router.password_encrypted);
          const [identityJson, resourceJson] = await Promise.all([
            restGetJson({
              host: String(router.host),
              port: Number(router.port) || 80,
              username: String(router.username),
              password: String(password),
              scheme: restScheme
            }, '/rest/system/identity', 10000).catch(() => ({})),
            restGetJson({
              host: String(router.host),
              port: Number(router.port) || 80,
              username: String(router.username),
              password: String(password),
              scheme: restScheme
            }, '/rest/system/resource', 10000).catch(() => ({}))
          ]);
          return normalizeSnapshotRest(identityJson, resourceJson);
        })()
      : await withRouterClient(router, async (client) => {
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

async function testRouterDraft(payload) {
  const connectionType = normalizeConnectionType(payload.connection_type, payload.port);
  const restScheme = normalizeRestScheme(payload.rest_scheme, payload.port);
  const router = {
    host: String(payload.host),
    port: Number(payload.port) || (connectionType === 'rest' ? 80 : 8728),
    username: String(payload.username)
  };

  try {
    const snapshot = connectionType === 'rest'
      ? await (async () => {
          const [identityJson, resourceJson] = await Promise.all([
            restGetJson({ host: router.host, port: router.port, username: router.username, password: String(payload.password), scheme: restScheme }, '/rest/system/identity', 10000).catch(() => ({})),
            restGetJson({ host: router.host, port: router.port, username: router.username, password: String(payload.password), scheme: restScheme }, '/rest/system/resource', 10000).catch(() => ({}))
          ]);
          return normalizeSnapshotRest(identityJson, resourceJson);
        })()
      : await (async () => {
          const api = new RouterOSClient({
            host: router.host,
            user: router.username,
            password: String(payload.password),
            port: router.port
          });

          let client;
          const connectPromise = api.connect().then((c) => {
            client = c;
            return c;
          });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), 10000)
          );
          await Promise.race([connectPromise, timeoutPromise]);
          try {
            const [identityRow, resourceRow] = await Promise.all([
              client.menu('/system identity').getOnly().catch(() => ({})),
              client.menu('/system resource').getOnly().catch(() => ({}))
            ]);
            return normalizeSnapshot(identityRow, resourceRow);
          } finally {
            try { api.close(); } catch (e) {}
          }
        })();

    return { success: true, snapshot };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function fetchBillingData(id) {
  const router = await getRouterRecord(id);
  const now = new Date().toISOString();

  const connectionType = normalizeConnectionType(router.connection_type, router.port);
  const restScheme = normalizeRestScheme(router.rest_scheme, router.port);

  try {
    const data = connectionType === 'rest'
      ? await (async () => {
          const password = await decryptText(router.password_encrypted);
          const req = {
            host: String(router.host),
            port: Number(router.port) || 80,
            username: String(router.username),
            password: String(password),
            scheme: restScheme
          };

          const [identityJson, resourceJson, profilesJson, secretsJson, activesJson] = await Promise.all([
            restGetJson(req, '/rest/system/identity', 15000).catch(() => ({})),
            restGetJson(req, '/rest/system/resource', 15000).catch(() => ({})),
            restGetJson(req, '/rest/ppp/profile', 15000).catch(() => ([])),
            restGetJson(req, '/rest/ppp/secret', 15000).catch(() => ([])),
            restGetJson(req, '/rest/ppp/active', 15000).catch(() => ([]))
          ]);

          return {
            snapshot: normalizeSnapshotRest(identityJson, resourceJson),
            ppp_profiles: Array.isArray(profilesJson) ? profilesJson : [],
            ppp_secrets: Array.isArray(secretsJson) ? secretsJson : [],
            ppp_actives: Array.isArray(activesJson) ? activesJson : []
          };
        })()
      : await withRouterClient(router, async (client) => {
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
  testRouterDraft,
  fetchBillingData
};
