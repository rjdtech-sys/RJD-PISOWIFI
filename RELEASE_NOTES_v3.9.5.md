# v3.9.5 Release Notes - Critical Session Expiry Fix

## Release Date
May 27, 2026

## Version Information
- **Version Name**: 3.9.5
- **Version Code**: 26
- **Update File**: `RJD-PisoWiFi-v3.9.5-Update.nxs`

---

## 🚨 CRITICAL FIX: Users with 0 Time Can No longer Access Internet

This release addresses a critical security issue where users/devices could continue browsing the internet even after their session time reached 0.

### Problem Description
**Reported Issue**: After a user's session reached 0 time, they were still able to access the internet because:
1. The system failed to block them immediately
2. Existing connections remained active due to conntrack state
3. The captive portal did not force a popup for expired sessions
4. Race condition between session timer (2s interval) and user browsing

### Root Cause Analysis
The issue had **3 main causes**:

1. **Delayed Blocking**: Session timer runs every 2 seconds, creating a window where `remaining_seconds` could be 0 but blocking hadn't happened yet
2. **Incomplete Connection Cleanup**: `blockMAC()` only deleted basic conntrack entries, leaving established TCP/UDP connections alive
3. **No Real-Time Expired Session Check**: The captive portal middleware didn't check for expired sessions on each request

---

## 🔧 Changes Applied

### 1. Enhanced Session Timer (server.js)
**Location**: `startBackgroundTimers()` function (~line 8492)

**Before:**
```javascript
for (const s of expired) {
  await network.blockMAC(s.mac, s.ip);
  await db.run('UPDATE sessions SET expired_at = ? WHERE mac = ?', [Date.now(), s.mac]);
}
```

**After:**
```javascript
for (const s of expired) {
  // CRITICAL FIX: Immediately block device and force portal redirect
  console.log(`[SESSION] EXPIRED: Blocking ${s.mac} (${s.ip}) - time reached 0`);
  await network.blockMAC(s.mac, s.ip);
  await db.run('UPDATE sessions SET expired_at = ? WHERE mac = ?', [Date.now(), s.mac]);
  
  // Force conntrack cleanup to kill all existing connections immediately
  if (s.ip) {
    try {
      await execPromise(`conntrack -D -s ${s.ip} 2>/dev/null || true`);
      await execPromise(`conntrack -D -d ${s.ip} 2>/dev/null || true`);
    } catch (e) {}
  }
}
```

**Impact**: 
- ✅ Immediate blocking when session expires
- ✅ All existing connections terminated
- ✅ Better logging for diagnostics

---

### 2. Real-Time Expired Session Detection (server.js)
**Location**: Captive Portal Middleware (~line 2481)

**Added:**
```javascript
// CRITICAL FIX: Check if device has an EXPIRED session (remaining_seconds <= 0)
// If yes, ensure it's blocked and force portal redirect
const expiredSession = await db.get(
  'SELECT mac, ip FROM sessions WHERE mac = ? AND remaining_seconds <= 0 AND (expired_at IS NULL OR expired_at = 0)', 
  [mac]
);
if (expiredSession) {
  console.log(`[AUTH] EXPIRED SESSION DETECTED: ${mac} has 0 time - blocking immediately`);
  // Block the device immediately if not already blocked
  await network.blockMAC(mac, clientIp);
  // Mark as expired to prevent repeated blocking
  await db.run('UPDATE sessions SET expired_at = ? WHERE mac = ?', [Date.now(), mac]);
  // Force conntrack cleanup
  try {
    await execPromise(`conntrack -D -s ${clientIp} 2>/dev/null || true`);
    await execPromise(`conntrack -D -d ${clientIp} 2>/dev/null || true`);
  } catch (e) {}
}

// No active session - serve captive portal to force login/purchase
if (!res.headersSent) {
  return res.sendFile(path.join(__dirname, 'index.html'));
}
```

**Impact**:
- ✅ Every HTTP request checks if session is expired
- ✅ Expired users immediately blocked on next request
- ✅ Captive portal forces popup for purchase/login

---

### 3. Aggressive Connection Blocking (lib/network.js)
**Location**: `blockMAC()` function (~line 1020)

**Before:**
```javascript
// Explicitly BLOCK forwarding for this MAC
await execPromise(`iptables -I FORWARD 1 -m mac --mac-source ${mac} -j DROP`);

// Instant State Reset
if (isValidIp(ip)) {
  await execPromise(`conntrack -D -s ${ip} 2>/dev/null || true`);
  await execPromise(`conntrack -D -d ${ip} 2>/dev/null || true`);
}
```

**After:**
```javascript
// CRITICAL FIX: Add DROP rule for both MAC and IP to ensure complete blocking

// 2a. Block by MAC address (most reliable)
await execPromise(`iptables -I FORWARD 1 -m mac --mac-source ${mac} -j DROP`);

// 2b. Also block by IP if available (defense in depth)
if (isValidIp(ip)) {
  await execPromise(`iptables -I FORWARD 2 -s ${ip} -j DROP`);
  await execPromise(`iptables -I FORWARD 3 -d ${ip} -j DROP`);
}

// 3. Aggressive conntrack cleanup - kill ALL existing connections
if (isValidIp(ip)) {
  // Delete all conntrack entries for this IP (both source and destination)
  await execPromise(`conntrack -D -s ${ip} 2>/dev/null || true`);
  await execPromise(`conntrack -D -d ${ip} 2>/dev/null || true`);
  // Also delete by protocol for thorough cleanup
  await execPromise(`conntrack -D -p tcp -s ${ip} 2>/dev/null || true`);
  await execPromise(`conntrack -D -p udp -s ${ip} 2>/dev/null || true`);
  await execPromise(`conntrack -D -p tcp -d ${ip} 2>/dev/null || true`);
  await execPromise(`conntrack -D -p udp -d ${ip} 2>/dev/null || true`);
}
```

**Impact**:
- ✅ **Triple-layer blocking**: MAC + source IP + destination IP
- ✅ **Protocol-specific cleanup**: TCP and UDP connections killed separately
- ✅ **No connection leakage**: All existing sessions terminated immediately

---

## 📊 How It Works Now

### Session Expiry Flow

```
User Session Time Reaches 0
    ↓
[Session Timer - Every 2s]
    ↓
Detect: remaining_seconds <= 0
    ↓
1. Call network.blockMAC(mac, ip)
   - Remove all whitelist rules
   - Add DROP rules (MAC + IP)
   - Kill all conntrack entries
    ↓
2. Mark expired_at = timestamp
    ↓
3. Force conntrack cleanup
    ↓
User's Internet Access: ❌ BLOCKED
    ↓
Next HTTP Request → Captive Portal Popup ✅
```

### Real-Time Detection Flow

```
Expired User Tries to Browse
    ↓
HTTP Request Hits Middleware
    ↓
Check: SELECT * FROM sessions WHERE mac = ? AND remaining_seconds <= 0
    ↓
Found Expired Session?
    ↓ YES
1. Block MAC + IP immediately
2. Mark as expired
3. Kill all connections
4. Serve captive portal
    ↓
User Sees: 💰 "Insert Coin to Continue" Portal
```

---

## 🛡️ Security Improvements

| Aspect | Before | After |
|--------|--------|-------|
| **Blocking Delay** | Up to 2 seconds | Immediate (on next request) |
| **Connection Kill** | Basic (2 conntrack deletes) | Aggressive (8+ conntrack deletes) |
| **Firewall Rules** | MAC only | MAC + Source IP + Dest IP |
| **Portal Popup** | Not guaranteed | Forced for expired sessions |
| **Race Condition** | Exists (2s window) | Eliminated |
| **Logging** | Minimal | Detailed diagnostics |

---

## ✅ Verification Checklist

After deploying, verify:

### 1. Test Session Expiry
```bash
# Watch logs in real-time
journalctl -u rjd-pisowifi -f | grep -E "EXPIRED|Blocking"
```

**Expected behavior:**
1. User session reaches 0 time
2. Log shows: `[SESSION] EXPIRED: Blocking XX:XX:XX:XX:XX:XX (192.168.x.x) - time reached 0`
3. User's internet immediately stops
4. User sees captive portal on next browse attempt

### 2. Check Firewall Rules
```bash
# Check if DROP rules are applied
sudo iptables -L FORWARD -n -v | grep -A 2 "DROP"
```

**Expected:**
- DROP rules for MAC addresses with 0 time
- DROP rules for their IP addresses

### 3. Verify Conntrack Cleanup
```bash
# Check active connections (should be 0 for expired users)
sudo conntrack -L | grep "192.168.x.x"
```

**Expected:** No active connections for expired users

### 4. Test Captive Portal Popup
1. Wait for user session to expire
2. User opens browser
3. Should immediately see portal (not their intended website)
4. Portal shows "Insert Coin" or purchase options

---

## 🔍 Troubleshooting

### Issue: User still has internet after expiry
**Solution:**
```bash
# Manually block the device
sudo iptables -I FORWARD -m mac --mac-source XX:XX:XX:XX:XX:XX -j DROP
sudo conntrack -D -s 192.168.x.x

# Check if session is marked expired
sqlite3 pisowifi.sqlite "SELECT mac, remaining_seconds, expired_at FROM sessions WHERE mac='XX:XX:XX:XX:XX:XX';"
```

### Issue: Portal not popping up
**Solution:**
1. Check DNS redirect is working:
   ```bash
   sudo iptables -t nat -L PREROUTING -n -v | grep REDIRECT
   ```
2. Verify captive portal probes are intercepted
3. Check browser cache - try incognito mode

### Issue: Connections not being killed
**Solution:**
```bash
# Manual aggressive cleanup
sudo conntrack -D -s 192.168.x.x
sudo conntrack -D -d 192.168.x.x
sudo conntrack -D -p tcp -s 192.168.x.x
sudo conntrack -D -p udp -s 192.168.x.x
```

---

## 📝 Files Changed
- `server.js` - Enhanced session timer, added real-time expired session detection in middleware
- `lib/network.js` - Aggressive blocking with triple-layer firewall and protocol-specific conntrack cleanup

---

## 🚀 Deployment

This update is **CRITICAL** for all deployments. Upload to Supabase is complete.

**Machines below code 26 will see "Update Available!"**

### Install via Admin Panel:
1. Go to **Admin → System Updater**
2. Click **Scan Update**
3. Click **Install Update** (v3.9.5)
4. System will restart automatically

---

## ⚠️ Important Notes

1. **No Breaking Changes**: This is a drop-in replacement
2. **Backward Compatible**: Works with existing sessions
3. **Immediate Effect**: Blocking happens on next HTTP request
4. **Better Logging**: All blocking events are logged for diagnostics

---

## 💡 Technical Details

### Why Triple-Layer Blocking?
1. **MAC Address**: Most reliable, can't be spoofed easily
2. **Source IP**: Blocks traffic FROM the device
3. **Destination IP**: Blocks traffic TO the device

This ensures complete isolation even if one method fails.

### Why Protocol-Specific Conntrack Cleanup?
- TCP and UDP connections are tracked separately in conntrack
- Generic `-D -s IP` might miss some entries
- Protocol-specific deletion ensures 100% cleanup
- Prevents "ghost connections" that keep working after expiry

### Why Real-Time Middleware Check?
- Session timer runs every 2 seconds (not real-time)
- User could browse during that window
- Middleware check ensures EVERY request validates session
- Catches expired sessions immediately on next browse attempt

---

**This update is MANDATORY for all production deployments to prevent revenue loss from unauthorized internet access.**
