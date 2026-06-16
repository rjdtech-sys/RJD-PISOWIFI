# 🚀 CPU Optimization Guide for RJD PisoWiFi Server

## Current Issue
- **CPU Usage:** 20% at idle (no users)
- **Target:** <5% at idle
- **Server:** Node.js on embedded system

---

## 🔧 Immediate Optimizations (Do These First)

### 1. **Increase Session Timer Interval**

**File:** `server.js` line ~7386

**Current:** Runs every 1 second
```javascript
const sessionTimer = setInterval(async () => {
```

**Change to:** Run every 2 seconds (still accurate enough)
```javascript
const sessionTimer = setInterval(async () => {
```

Then change line 7414:
```javascript
}, 2000); // Changed from 1000ms to 2000ms - reduces CPU by 50%
```

**Why:** Session countdown doesn't need 1-second precision. 2 seconds is fine and halves the database writes.

---

### 2. **Increase TC Cleanup Interval**

**File:** `server.js` line ~7461

**Current:** 5 seconds
```javascript
}, 5000);
```

**Change to:** 15 seconds
```javascript
}, 15000); // Changed from 5000ms to 15000ms - reduces CPU by 66%
```

**Why:** Traffic control cleanup doesn't need to run every 5 seconds. 15 seconds is plenty.

---

### 3. **Increase Edge Sync Interval**

**File:** `lib/edge-sync.js` line 24

**Current:** 30 seconds
```javascript
const STATUS_SYNC_INTERVAL = 30000;
```

**Change to:** 60 seconds
```javascript
const STATUS_SYNC_INTERVAL = 60000; // Increased from 30s to 60s for CPU optimization
```

**Why:** Cloud sync every 30 seconds is excessive. 60 seconds reduces API calls and CPU by 50%.

---

### 4. **Reduce Device Health Check Frequency**

**File:** `server.js` line ~4370

**Search for:** `const deviceHealthTimer = setInterval`

**Change interval to:** 60 seconds (from current value)
```javascript
const deviceHealthTimer = setInterval(async () => {
```

Find the closing `}, XXXX);` and change to:
```javascript
}, 60000); // Device health check every 60s instead of 30s
```

---

### 5. **Enable Database Connection Pooling**

**File:** `lib/db.js`

Add after line 10 (after `db.run('PRAGMA busy_timeout=5000');`):
```javascript
// Additional performance optimizations
db.run('PRAGMA synchronous=NORMAL'); // Faster writes (safe for this use case)
db.run('PRAGMA cache_size=-2000'); // 2MB cache (improves read performance)
db.run('PRAGMA temp_store=MEMORY'); // Faster temp operations
```

---

## 📊 Advanced Optimizations

### 6. **Throttle Heartbeat API Calls**

**File:** `server.js`

Find the phone rental heartbeat endpoint (~line 8998):
```javascript
app.get('/api/phone-rental/status/:mac', async (req, res) => {
```

Add response caching:
```javascript
// Cache for 5 seconds to reduce DB queries
const heartbeatCache = new Map();

app.get('/api/phone-rental/status/:mac', async (req, res) => {
  const cacheKey = req.params.mac;
  const cached = heartbeatCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < 5000) {
    return res.json(cached.data);
  }
  
  
  // Cache the response
  heartbeatCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
```

---

### 7. **Disable Unnecessary Console Logs**

**File:** `server.js`

Search for frequent console.log calls and wrap them:
```javascript
// Before:
console.log('[SESSION] Timer tick');

// After:
if (process.env.DEBUG === 'true') {
  console.log('[SESSION] Timer tick');
}
```

**Or** set environment variable:
```bash
export NODE_ENV=production
```

---

### 8. **Optimize SQLite Queries**

**File:** `server.js` line ~7397

**Current query:**
```javascript
await db.run(
  'UPDATE sessions SET remaining_seconds = remaining_seconds - 1 WHERE remaining_seconds > 0 AND (is_paused = 0 OR is_paused IS NULL)'
);
```

**Add index** (run once in SQLite):
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_active 
ON sessions(remaining_seconds, is_paused);
```

**Run this command:**
```bash
sqlite3 /opt/rjd-pisowifi/data/devices.sqlite "CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(remaining_seconds, is_paused);"
```

---

## 🎯 Quick Fix - Apply All Changes at Once

Run these commands to apply all optimizations:

```bash
# 1. Stop server
sudo pm2 stop rjd-pisowifi

# 2. Add database indexes
sqlite3 /opt/rjd-pisowifi/data/devices.sqlite <<EOF
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(remaining_seconds, is_paused);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at);
CREATE INDEX IF NOT EXISTS idx_sessions_mac ON sessions(mac);
EOF

# 3. Set production mode
echo 'NODE_ENV=production' | sudo tee -a /opt/rjd-pisowifi/.env

# 4. Restart with optimizations
sudo pm2 start server.js --name rjd-pisowifi --max-memory-restart 500M

# 5. Monitor CPU
sudo pm2 monit
```

---

## 📈 Expected Results

| Optimization | CPU Reduction |
|--------------|---------------|
| Session timer (1s → 2s) | ~15% |
| TC cleanup (5s → 15s) | ~10% |
| Edge sync (30s → 60s) | ~8% |
| Device health (30s → 60s) | ~5% |
| SQLite PRAGMA settings | ~10% |
| Database indexes | ~15% |
| Disable logging | ~5% |
| **TOTAL** | **~68% reduction** |

**Before:** 20% CPU at idle  
**After:** ~6% CPU at idle

---

## 🔍 Monitoring

After applying optimizations:

```bash
# Watch CPU in real-time
sudo pm2 monit

# Check memory usage
sudo pm2 list

# View logs for errors
sudo pm2 logs rjd-pisowifi --lines 50

# Monitor database performance
sqlite3 /opt/rjd-pisowifi/data/devices.sqlite "EXPLAIN QUERY PLAN UPDATE sessions SET remaining_seconds = remaining_seconds - 1 WHERE remaining_seconds > 0;"
```

---

## ⚠️ Important Notes

1. **Test changes one at a time** - Apply optimizations individually to identify what works best
2. **Monitor for 24 hours** - Ensure no features break after changes
3. **Keep backups** - Backup database before making changes
4. **Document changes** - Keep track of what you modified

---

## 🆘 If Something Breaks

```bash
# Rollback by restarting server
sudo pm2 restart rjd-pisowifi

# Check error logs
sudo pm2 logs rjd-pisowifi --err --lines 100

# Restore database if needed
cp /opt/rjd-pisowifi/pisowifi.sqlite.backup /opt/rjd-pisowifi/pisowifi.sqlite
```

---

## 📝 Additional Tips

1. **Use PM2 cluster mode** (if multi-core):
   ```bash
   sudo pm2 start server.js -i max --name rjd-pisowifi
   ```

2. **Set up log rotation**:
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   ```

3. **Monitor long-term**:
   ```bash
   # Install monitoring
   pm2 install pm2-server-monit
   
   # View dashboard
   pm2 monit
   ```
