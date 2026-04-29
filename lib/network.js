const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('node:path');
const db = require('./db');
const execPromise = util.promisify(exec);

const isValidIp = (ip) => {
  if (!ip || ip === 'AUTO' || ip === 'unknown') return false;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Regex.test(ip);
};

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function intToIp(n) {
  const x = Number(n) >>> 0;
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

async function getDefaultRouteInterface() {
  try {
    const { stdout } = await execPromise('ip -j route show default').catch(() => ({ stdout: '' }));
    const routes = JSON.parse(String(stdout || '[]'));
    const dev = routes && routes[0] && routes[0].dev ? String(routes[0].dev).trim() : '';
    return dev || null;
  } catch (e) {}
  try {
    const { stdout } = await execPromise(`ip route show default | awk '{print $5}' | head -n 1`).catch(() => ({ stdout: '' }));
    const dev = String(stdout || '').trim();
    return dev || null;
  } catch (e) {
    return null;
  }
}

const PPPoE_EXPIRED_DNS_PORT = 5353;
const PPPoE_EXPIRED_DNS_PID = '/var/run/dnsmasq_pppoe_expired.pid';

async function stopPPPoEExpiredDns() {
  try {
    if (fs.existsSync(PPPoE_EXPIRED_DNS_PID)) {
      const pidStr = fs.readFileSync(PPPoE_EXPIRED_DNS_PID, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (pid && !Number.isNaN(pid)) {
        await execPromise(`kill -9 ${pid}`).catch(() => {});
      }
      fs.unlinkSync(PPPoE_EXPIRED_DNS_PID);
    }
  } catch (e) {}
  await execPromise(`pkill -f "dnsmasq.*--pid-file=${PPPoE_EXPIRED_DNS_PID.replace(/\//g, '\\/')}"`).catch(() => {});
}

async function startPPPoEExpiredDns(redirectIp) {
  const ip = String(redirectIp || '').trim();
  if (!isValidIp(ip)) {
    await stopPPPoEExpiredDns();
    return;
  }

  await stopPPPoEExpiredDns();
  await execPromise('mkdir -p /var/run').catch(() => {});

  const cmd = [
    'nohup dnsmasq',
    `--port=${PPPoE_EXPIRED_DNS_PORT}`,
    `--address=/#/${ip}`,
    '--no-resolv',
    '--no-hosts',
    `--pid-file=${PPPoE_EXPIRED_DNS_PID}`,
    '--log-facility=/var/log/dnsmasq-pppoe-expired.log',
    '> /dev/null 2>&1 &'
  ].join(' ');
  await execPromise(cmd).catch(() => {});
}

async function getPPPoEExpiredSettings() {
  try {
    const poolIdRow = await db.get('SELECT value FROM config WHERE key = ?', ['pppoe_expired_pool_id']).catch(() => null);
    const redirectIpRow = await db.get('SELECT value FROM config WHERE key = ?', ['pppoe_expired_redirect_ip']).catch(() => null);
    const poolId = poolIdRow?.value ? parseInt(String(poolIdRow.value), 10) : null;
    const redirectIp = redirectIpRow?.value ? String(redirectIpRow.value).trim() : '';
    if (!poolId || Number.isNaN(poolId)) return { pool: null, redirectIp };
    const pool = await db.get('SELECT * FROM pppoe_pools WHERE id = ?', [poolId]).catch(() => null);
    return { pool: pool || null, redirectIp };
  } catch (e) {
    return { pool: null, redirectIp: '' };
  }
}

function isVirtualInterfaceName(name) {
  const n = String(name || '').toLowerCase();
  return (
    n === 'lo' ||
    n.startsWith('ppp') ||
    n.startsWith('zt') ||
    n.startsWith('tun') ||
    n.startsWith('tap') ||
    n.startsWith('wg') ||
    n.startsWith('docker') ||
    n.startsWith('veth') ||
    n.startsWith('virbr') ||
    n.startsWith('vmnet') ||
    n.startsWith('ifb')
  );
}

async function getInterfaces() {
  try {
    const { stdout } = await execPromise('ip -j addr show');
    const data = JSON.parse(stdout);
    return data.map(iface => {
      const ifname = (iface.ifname || iface.name || '').toLowerCase();
      const linkType = (iface.link_type || '').toLowerCase();
      const operstate = (iface.operstate || '').toLowerCase();
      let type = 'ethernet';
      if (ifname.startsWith('wlan') || ifname.startsWith('ap') || ifname.startsWith('ra')) {
        type = 'wifi';
      } else if (linkType === 'loopback' || ifname === 'lo') {
        type = 'loopback';
      } else if (ifname.startsWith('br') || linkType === 'bridge') {
        type = 'bridge';
      } else if (ifname.includes('.') || linkType === 'vlan') {
        type = 'vlan';
      }
      const status = (operstate === 'up' || operstate === 'unknown') ? 'up' : 'down';
      return {
        name: iface.ifname || iface.name,
        type: type,
        status: status,
        ip: ((iface.addr_info || []).find(a => a.family === 'inet')?.local) || null,
        mac: iface.address,
        isLoopback: ifname === 'lo'
      };
    });
  } catch (err) {
    console.error('Error getting interfaces:', err);
    return [];
  }
}

/**
 * Smartly detects which interface is WAN and which are LAN candidates.
 * WAN Priority:
 * 1. Interface with valid external IP (not 10.0.0.1/24)
 * 2. Interface with status 'up'
 * 3. Onboard interface names (eno*, enp*)
 * 4. Fallback to first ethernet found
 */
function classifyInterfaces(interfaces) {
  const ethernet = interfaces.filter(i => i.type === 'ethernet' && !i.isLoopback && !isVirtualInterfaceName(i.name));
  const wifi = interfaces.filter(i => i.type === 'wifi');
  
  // Find WAN
  let wan = null;
  
  // 1. Check for any active IP on an UP ethernet
  const withIp = ethernet.find(i => i.ip && i.status === 'up');
  
  if (withIp) {
    wan = withIp;
  } else {
    // 2. Check for active link status
    const activeLinks = ethernet.filter(i => i.status === 'up');
    
    if (activeLinks.length > 0) {
      // Prefer onboard names if multiple are up
      const onboard = activeLinks.find(i => i.name.startsWith('en') || i.name.startsWith('eth0'));
      wan = onboard || activeLinks[0];
    } else {
      // 3. Fallback to name heuristic
      wan = ethernet.find(i => i.name.startsWith('en') || i.name === 'eth0') || ethernet[0];
    }
  }

  // Fallback if absolutely no ethernet found
  const wanName = wan ? wan.name : 'eth0';

  // LAN Candidates: All OTHER ethernet interfaces + Primary Wifi
  const lanMembers = [];
  
  // Add Wifi
  const wlan0 = wifi.find(i => i.name === 'wlan0') || wifi[0];
  if (wlan0) lanMembers.push(wlan0.name);
  
  // Add other ethernets (USB adapters, secondary ports)
  ethernet.forEach(e => {
    if (e.name !== wanName) {
      lanMembers.push(e.name);
    }
  });

  return { wanName, lanMembers };
}

/**
 * WAN DHCP Recovery — ensures the WAN interface obtains an IP address on boot.
 * Fixes Chromebox/x64 Debian issue where the NIC does not get a DHCP lease
 * until the RJ45 cable is physically unplugged and replugged.
 * Root cause: DHCP client starts before link is fully up, then gives up.
 *
 * Strategy:
 * 1. Detect the WAN interface
 * 2. If it has no IP, wait for link (up to 30s) then force DHCP renew
 * 3. Retry up to 3 times with escalating delays
 */
async function ensureWanDhcp() {
  console.log('[NET-WAN] Starting WAN DHCP recovery check...');
  try {
    const ifaces = await getInterfaces();
    const defaultWan = await getDefaultRouteInterface();
    const safeDefaultWan = (defaultWan && !isVirtualInterfaceName(defaultWan)) ? defaultWan : null;
    const { wanName } = classifyInterfaces(ifaces);
    const wan = safeDefaultWan || wanName;

    if (!wan) {
      console.warn('[NET-WAN] No WAN interface detected, skipping DHCP recovery.');
      return { success: false, error: 'No WAN interface detected' };
    }

    // Check if WAN already has a valid external IP
    const wanIface = ifaces.find(i => i.name === wan);
    const hasIp = wanIface && wanIface.ip && isValidIp(wanIface.ip) && !wanIface.ip.startsWith('10.0.');

    if (hasIp) {
      console.log(`[NET-WAN] WAN interface ${wan} already has IP ${wanIface.ip}. No recovery needed.`);
      return { success: true, wan, ip: wanIface.ip };
    }

    console.log(`[NET-WAN] WAN interface ${wan} has no valid IP. Starting recovery...`);

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[NET-WAN] Attempt ${attempt}/${MAX_RETRIES}: Waiting for link on ${wan}...`);

      // Step 1: Wait for link (carrier) — up to 30 seconds
      let linkUp = false;
      for (let i = 0; i < 30; i++) {
        try {
          const { stdout } = await execPromise(`cat /sys/class/net/${wan}/carrier 2>/dev/null || echo 0`);
          if (stdout.trim() === '1') {
            linkUp = true;
            console.log(`[NET-WAN] Link detected on ${wan} after ${i + 1}s.`);
            break;
          }
        } catch (e) {
          // carrier file may not exist yet
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!linkUp) {
        console.warn(`[NET-WAN] No link on ${wan} after 30s. Forcing interface down/up...`);
        // Force link renegotiation
        await execPromise(`ip link set dev ${wan} down`).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        await execPromise(`ip link set dev ${wan} up`).catch(() => {});
        // Wait again for link after toggle
        for (let i = 0; i < 15; i++) {
          try {
            const { stdout } = await execPromise(`cat /sys/class/net/${wan}/carrier 2>/dev/null || echo 0`);
            if (stdout.trim() === '1') {
              linkUp = true;
              console.log(`[NET-WAN] Link detected on ${wan} after toggle (${i + 1}s).`);
              break;
            }
          } catch (e) {}
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (!linkUp) {
        console.warn(`[NET-WAN] Still no link on ${wan}. Retrying...`);
        continue;
      }

      // Step 2: Force DHCP renew
      // Try dhclient first (most common on Debian)
      console.log(`[NET-WAN] Forcing DHCP renew on ${wan}...`);

      // Kill any existing dhclient for this interface
      await execPromise(`kill $(cat /var/run/dhclient.${wan}.pid 2>/dev/null) 2>/dev/null; pkill -f "dhclient.*${wan}" 2>/dev/null`).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));

      // Release any existing lease
      await execPromise(`dhclient -r ${wan} 2>/dev/null`).catch(() => {});
      await new Promise(r => setTimeout(r, 500));

      // Request new lease with extended timeout
      const dhclientResult = await execPromise(`timeout 30 dhclient -1 -v ${wan} 2>&1`).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));
      console.log(`[NET-WAN] dhclient output: ${String(dhclientResult.stdout || '').trim().split('\n').pop()}`);

      // Also try with dhcpcd as fallback (some Debian installations use it)
      if (await execPromise(`which dhcpcd 2>/dev/null`).then(r => r.stdout.trim()).catch(() => '') !== '') {
        await execPromise(`dhcpcd -n ${wan} 2>/dev/null`).catch(() => {});
      }

      // Step 3: Verify IP obtained
      await new Promise(r => setTimeout(r, 2000));
      try {
        const { stdout } = await execPromise(`ip -j addr show dev ${wan} 2>/dev/null`);
        const addrs = JSON.parse(stdout || '[]');
        const addr = addrs && addrs[0] && addrs[0].addr_info;
        const inetAddr = addr && addr.find(a => a.family === 'inet' && a.scope === 'global');
        if (inetAddr && inetAddr.local) {
          console.log(`[NET-WAN] SUCCESS: ${wan} obtained IP ${inetAddr.local}/${inetAddr.prefixlen}`);
          return { success: true, wan, ip: inetAddr.local };
        }
      } catch (e) {
        // Fallback to plain ip addr check
        try {
          const { stdout } = await execPromise(`ip addr show dev ${wan} 2>/dev/null`);
          const match = stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
          if (match && !match[1].startsWith('10.0.')) {
            console.log(`[NET-WAN] SUCCESS: ${wan} obtained IP ${match[1]}`);
            return { success: true, wan, ip: match[1] };
          }
        } catch (e2) {}
      }

      console.warn(`[NET-WAN] Attempt ${attempt} failed: No IP obtained on ${wan}.`);
      // Wait before retrying
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 5000;
        console.log(`[NET-WAN] Waiting ${delay / 1000}s before next attempt...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.error(`[NET-WAN] FAILED: Could not obtain DHCP IP on ${wan} after ${MAX_RETRIES} attempts.`);
    return { success: false, wan, error: `No DHCP IP after ${MAX_RETRIES} attempts` };
  } catch (e) {
    console.error('[NET-WAN] Recovery error:', e.message);
    return { success: false, error: e.message };
  }
}

async function initFirewall() {
  console.log('[NET] Overhauling Firewall (DNS-Control Mode)...');
  try {
    await execPromise('sysctl -w net.ipv4.ip_forward=1');
    
    // 1. Reset Everything
    await execPromise('iptables -F').catch(() => {});
    await execPromise('iptables -X').catch(() => {});
    await execPromise('iptables -t nat -F').catch(() => {});
    await execPromise('iptables -t nat -X').catch(() => {});
    await execPromise('iptables -t mangle -F').catch(() => {});

    // 2. Default Policies
    await execPromise('iptables -P INPUT ACCEPT').catch(() => {});
    await execPromise('iptables -P FORWARD DROP').catch(() => {}); // Block external traffic by default
    await execPromise('iptables -P OUTPUT ACCEPT').catch(() => {});

    const ifaces = await getInterfaces();
    const defaultWan = await getDefaultRouteInterface();
    const safeDefaultWan = (defaultWan && !isVirtualInterfaceName(defaultWan)) ? defaultWan : null;
    const { wanName } = classifyInterfaces(ifaces);
    const wan = safeDefaultWan || wanName;
    console.log(`[NET] Detected WAN Interface: ${wan}${defaultWan ? ` (default-route=${defaultWan})` : ''}`);

    // 3. Masquerade for internet access
    await execPromise(`iptables -t nat -A POSTROUTING -o ${wan} -j MASQUERADE`).catch(() => {});

    // 4. Global Allowed Traffic (Internal)
    // Allow everything to the portal itself (Assets/UI)
    // Prefer bridge interface if available as it handles aggregated traffic
    const bridge = ifaces.find(i => i.type === 'bridge' && i.status === 'up');
    const actualLan = bridge ? bridge.name : (ifaces.find(i => i.type === 'wifi')?.name || 'wlan0');
    
    try {
      const { pool, redirectIp } = await getPPPoEExpiredSettings();
      if (pool && pool.ip_pool_start && pool.ip_pool_end) {
        const start = String(pool.ip_pool_start).trim();
        const end = String(pool.ip_pool_end).trim();
        console.log(`[PPPoE-Expired] Enforcing expired pool ${start}-${end}`);

        await execPromise('modprobe xt_iprange').catch(() => {});
        await execPromise('modprobe ipt_iprange').catch(() => {});

        const applyWithMatch = async (match) => {
          await execPromise(`iptables -t nat -I PREROUTING 1 -i ppp+ ${match} -p udp --dport 53 -j REDIRECT --to-ports ${PPPoE_EXPIRED_DNS_PORT}`).catch(() => {});
          await execPromise(`iptables -t nat -I PREROUTING 1 -i ppp+ ${match} -p tcp --dport 53 -j REDIRECT --to-ports ${PPPoE_EXPIRED_DNS_PORT}`).catch(() => {});
          await execPromise(`iptables -t nat -I PREROUTING 1 -i ppp+ ${match} -p tcp --dport 80 -j REDIRECT --to-ports 80`).catch(() => {});
          await execPromise(`iptables -I FORWARD 1 -i ppp+ ${match} -j DROP`).catch(() => {});
        };

        let applied = false;
        try {
          await applyWithMatch(`-m iprange --src-range ${start}-${end}`);
          applied = true;
        } catch (e) {
          console.error('[PPPoE-Expired] Failed to apply iprange rules:', e.message);
        }

        if (!applied) {
          const startParts = start.split('.');
          const endParts = end.split('.');
          if (startParts.length === 4 && endParts.length === 4 && startParts.slice(0, 3).join('.') === endParts.slice(0, 3).join('.')) {
            const cidr = `${startParts.slice(0, 3).join('.')}.0/24`;
            console.warn(`[PPPoE-Expired] Falling back to CIDR match ${cidr}`);
            await applyWithMatch(`-s ${cidr}`);
            applied = true;
          }
        }

        if (applied) {
          console.log('[PPPoE-Expired] Expired pool rules applied (iprange).');
        }

        if (redirectIp && isValidIp(redirectIp)) {
          await startPPPoEExpiredDns(redirectIp);
          const active = await db.get('SELECT * FROM pppoe_server WHERE enabled = 1 LIMIT 1').catch(() => null);
          const pppoeIface = active?.interface ? String(active.interface).trim() : '';
          if (pppoeIface) {
            const { stdout: addrCheck } = await execPromise(`ip addr show dev ${pppoeIface}`).catch(() => ({ stdout: '' }));
            if (!String(addrCheck).includes(redirectIp)) {
              await execPromise(`ip addr add ${redirectIp}/32 dev ${pppoeIface}`).catch(() => {});
            }
          }
        } else {
          await stopPPPoEExpiredDns();
        }
      }
    } catch (e) {}

    // 4.0 Explicitly bypass PPPoE from ANY redirection or blocking
    // PPPoE users have their own authentication and should be fully open once connected
    await execPromise(`iptables -t nat -A PREROUTING -i ppp+ -j ACCEPT`).catch(() => {});

    await execPromise(`iptables -A INPUT -i ${actualLan} -j ACCEPT`).catch(() => {});
    
    // Allow established connections
    await execPromise('iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT').catch(() => {});

    // 4.1 Allow PPPoE traffic to WAN (Authenticated Users)
    // Ensure authenticated PPPoE clients have full access
    await execPromise(`iptables -A FORWARD -i ppp+ -j ACCEPT`).catch(() => {});
    await execPromise(`iptables -A INPUT -i ppp+ -j ACCEPT`).catch(() => {});
    
    // 4.2 MSS Clamping for ALL Traffic (Crucial for combined stability)
    await execPromise(`iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu`).catch(() => {});

    // 4.3 Redirect unauthorized DNS to local resolver (DNS Hijacking)
    // This ensures that even if a user manually sets 8.8.8.8, they are forced to use our DNS
    // which resolves to the captive portal IP.
    if (actualLan) {
      await execPromise(`iptables -t nat -A PREROUTING -i ${actualLan} -p udp --dport 53 -j REDIRECT --to-ports 53`).catch(() => {});
      await execPromise(`iptables -t nat -A PREROUTING -i ${actualLan} -p tcp --dport 53 -j REDIRECT --to-ports 53`).catch(() => {});

      // 4.4 STRICT BLOCKING: Ensure NO DNS traffic leaks to the internet for unauthorized users
      // If the redirection above fails or is bypassed, these rules act as a hard wall.
      // Whitelisted users bypass these because their ACCEPT rules are inserted at the top.
      await execPromise(`iptables -A FORWARD -i ${actualLan} -p udp --dport 53 -j DROP`).catch(() => {});
      await execPromise(`iptables -A FORWARD -i ${actualLan} -p tcp --dport 53 -j DROP`).catch(() => {});
      
      // Explicitly block access to common Public DNS IPs to prevent any tunneling attempts
      const publicDns = ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9'];
      for (const dnsIp of publicDns) {
        await execPromise(`iptables -A FORWARD -i ${actualLan} -d ${dnsIp} -j DROP`).catch(() => {});
      }
    }

    // 5. Captive Portal Redirect (HTTP Port 80)
    // Non-authorized clients hit this to see the portal
    await execPromise(`iptables -t nat -A PREROUTING -i ${actualLan} -p tcp --dport 80 -j REDIRECT --to-ports 80`).catch(() => {});
    
    console.log(`[NET] Firewall ready. LAN: ${actualLan}, WAN: ${wan}. Authorized users will use 8.8.8.8.`);
  } catch (e) {
    console.error('[NET] Firewall overhaul error:', e.message);
  }
}

async function getInterfaceForIp(ip) {
  try {
    const { stdout } = await execPromise(`ip route get ${ip}`);
    // Output format: "10.0.13.57 dev eth0.13 src 10.0.13.1 uid 0"
    const match = stdout.match(/dev\s+(\S+)/);
    return match ? match[1] : null;
  } catch (e) {
    console.error(`[NET] Error finding interface for IP ${ip}:`, e.message);
    return null;
  }
}

async function getParentInterface(iface) {
  // For VLAN interfaces like eth0.13, return the parent (eth0)
  // For regular interfaces, return as-is
  if (iface && iface.includes('.')) {
    return iface.split('.')[0];
  }
  return iface;
}

// Helper function to check if TC rules exist for a given IP
async function checkTcRulesExist(ip) {
  try {
    const lan = await getInterfaceForIp(ip);
    if (!lan) return { download: false, upload: false, interface: null };
    
    // Check for download rule (ip dst match)
    const downloadCheck = await execPromise(`tc filter show dev ${lan} parent 1:0 | grep -q "match ip dst ${ip}" && echo "found" || echo "not_found"`).catch(() => "error");
    const uploadCheck = await execPromise(`tc filter show dev ${lan} parent ffff: | grep -q "match ip src ${ip}" && echo "found" || echo "not_found"`).catch(() => "error");
    
    return {
      download: downloadCheck.trim() === "found",
      upload: uploadCheck.trim() === "found",
      interface: lan
    };
  } catch (e) {
    return { download: false, upload: false, interface: null, error: e.message };
  }
}

async function setSpeedLimit(mac, ip, downloadMbps, uploadMbps) {
  if (!mac || !ip) return;
  
  // Dynamically find the correct interface for this client IP (e.g., VLAN interface)
  const lan = await getInterfaceForIp(ip);
  if (!lan) {
    console.error(`[QoS] Could not determine interface for IP ${ip}, aborting limit.`);
    return;
  }

  const discipline = (await db.get("SELECT value FROM config WHERE key = 'qos_discipline'"))?.value || 'cake';
  
  console.log(`[QoS] Setting limit for ${mac} (${ip}) on ${lan}: DL=${downloadMbps}M, UL=${uploadMbps}M`);
  
  const ipParts = ip.split('.');
  const classId = parseInt(ipParts[3]);
  const dlHandle = `1:${classId}0`; // Download class: 1:1600, etc.
  const ulHandle = `1:${classId}1`; // Upload class: 1:1601, etc.
  const markValue = `0x${classId}00`;
  
  // More thorough cleanup with increased delay
  await removeSpeedLimit(mac, ip);
  
  // Give system more time to clean up completely
  await new Promise(r => setTimeout(r, 200));
  
  // Double-check cleanup by removing any lingering rules
  try {
    await execPromise(`tc filter del dev ${lan} parent 1:0 protocol ip prio 1 u32 match ip dst ${ip} 2>/dev/null || true`).catch(() => {});
    await execPromise(`tc filter del dev ${lan} parent ffff: protocol ip prio 1 u32 match ip src ${ip} 2>/dev/null || true`).catch(() => {});
    await new Promise(r => setTimeout(r, 50));
  } catch (e) {
    // Ignore cleanup errors
  }
  
  // Ensure QoS root exists on this specific interface
  try {
    await execPromise(`tc qdisc show dev ${lan} | grep -q "parent 1:10"`);
    console.log(`[QoS] ${discipline} already active on ${lan}`);
  } catch (e) {
    // Root qdisc missing or different, initialize it
    console.log(`[QoS] Applying ${discipline} discipline to ${lan}`);
    await initQoS(lan, discipline);
  }

  // Download Limiting (traffic destined to the device - match ip dst)
  if (downloadMbps > 0) {
    try {
      // Add or replace class
      await execPromise(`tc class add dev ${lan} parent 1: classid ${dlHandle} htb rate ${downloadMbps}mbit ceil ${downloadMbps}mbit 2>/dev/null || tc class replace dev ${lan} parent 1: classid ${dlHandle} htb rate ${downloadMbps}mbit ceil ${downloadMbps}mbit`);
      
      // Remove old qdisc and add new one
      await execPromise(`tc qdisc del dev ${lan} parent ${dlHandle} 2>/dev/null || true`).catch(() => {});
      await new Promise(r => setTimeout(r, 10));
      const qdiscArgs = String(discipline || 'cake').trim() === 'fq_codel'
        ? 'fq_codel'
        : `${discipline} bandwidth ${downloadMbps}mbit`;
      await execPromise(`tc qdisc add dev ${lan} parent ${dlHandle} handle ${classId}0: ${qdiscArgs}`);
      
      // Remove and re-add filter
      await execPromise(`tc filter show dev ${lan} parent 1:0 | grep -q "match ip dst ${ip}" && tc filter del dev ${lan} parent 1:0 protocol ip u32 match ip dst ${ip} 2>/dev/null || true`).catch(() => {});
      await new Promise(r => setTimeout(r, 10));
      await execPromise(`tc filter add dev ${lan} protocol ip parent 1:0 prio 1 u32 match ip dst ${ip} flowid ${dlHandle}`);
      
      console.log(`[QoS] Download class created with ${discipline} qdisc: ${dlHandle} @ ${downloadMbps}Mbps on ${lan}`);
    } catch (e) {
      console.error(`[QoS] Download Limit error:`, e.message);
    }
  }
  
  // Upload Limiting using ingress qdisc with police action
  // Police action directly rate-limits traffic without needing IFB
  if (uploadMbps > 0) {
    try {
      // Set up ingress qdisc on the LAN interface if not already present
      try {
        await execPromise(`tc qdisc show dev ${lan} | grep -q "ingress"`);
      } catch (e) {
        // Ingress qdisc doesn't exist, create it
        await execPromise(`tc qdisc add dev ${lan} ingress`);
        console.log(`[QoS] Added ingress qdisc to ${lan}`);
      }
      
      // Remove ALL old ingress filters for this IP (multiple attempts to ensure cleanup)
      await execPromise(`tc filter del dev ${lan} parent ffff: protocol ip u32 match ip src ${ip} 2>/dev/null || true`).catch(() => {});
      await execPromise(`tc filter show dev ${lan} parent ffff: | grep -q "${ip}" && tc filter del dev ${lan} parent ffff: prio 1 2>/dev/null || true`).catch(() => {});
      
      // Wait a moment for cleanup
      await new Promise(r => setTimeout(r, 50));
      
      // Add ingress filter with police action to limit upload speed
      // This directly limits packets from this IP at the configured rate
      const uploadBurst = uploadMbps * 128; // Burst size in KB
      
      const filterCmd = `tc filter add dev ${lan} parent ffff: protocol ip prio 1 u32 match ip src ${ip} police rate ${uploadMbps}mbit burst ${uploadBurst}k drop flowid :1`;
      
      await execPromise(filterCmd);
      
      console.log(`[QoS] Upload limit set for ${ip} using ingress police: ${uploadMbps}Mbps, burst ${uploadBurst}k`);
    } catch (e) {
      console.error(`[QoS] Upload Limit error:`, e.message);
    }
  }
}

async function removeSpeedLimit(mac, ip) {
  if (!ip) return;
  const lan = await getInterfaceForIp(ip); // Use dynamic interface lookup

  const ipParts = ip.split('.');
  const classId = parseInt(ipParts[3]);
  const dlHandle = `1:${classId}0`; // Download class
  
  try {
    // If we found the interface, remove from there
    if (lan) {
      // Remove download filters and classes from VLAN interface (egress)
      await execPromise(`tc filter del dev ${lan} parent 1:0 protocol ip prio 1 u32 match ip dst ${ip} 2>/dev/null || true`).catch(() => {});
      await execPromise(`tc qdisc del dev ${lan} parent ${dlHandle} 2>/dev/null || true`).catch(() => {});
      await execPromise(`tc class del dev ${lan} parent 1: classid ${dlHandle} 2>/dev/null || true`).catch(() => {});
      
      // Remove upload filter from ingress (police action)
      await execPromise(`tc filter del dev ${lan} parent ffff: protocol ip u32 match ip src ${ip} 2>/dev/null || true`).catch(() => {});
    } else {
      // IP not found in current routing table - likely moved to different VLAN
      // Try to remove from all VLAN interfaces to ensure cleanup
      console.log(`[QoS] IP ${ip} not found in routing table, searching all VLAN interfaces...`);
      try {
        const { stdout } = await execPromise(`ip link show | grep -E "eth|end" | grep -E "\\.[0-9]+" | awk '{print $2}' | sed 's/:$//'`).catch(() => ({ stdout: '' }));
        const vlans = stdout.trim().split('\n').filter(v => v && v.includes('.'));
        
        for (const vlan of vlans) {
          await execPromise(`tc filter del dev ${vlan} parent 1:0 protocol ip prio 1 u32 match ip dst ${ip} 2>/dev/null || true`).catch(() => {});
          await execPromise(`tc qdisc del dev ${vlan} parent ${dlHandle} 2>/dev/null || true`).catch(() => {});
          await execPromise(`tc class del dev ${vlan} parent 1: classid ${dlHandle} 2>/dev/null || true`).catch(() => {});
          await execPromise(`tc filter del dev ${vlan} parent ffff: protocol ip u32 match ip src ${ip} 2>/dev/null || true`).catch(() => {});
        }
        console.log(`[QoS] Cleaned up TC rules for ${ip} from all VLAN interfaces`);
      } catch (e) {
        console.log(`[QoS] Fallback cleanup for ${ip}: ${e.message}`);
      }
    }
    
    // Additional cleanup: Remove any remaining rules that might be lingering on all interfaces
    try {
      const allInterfaces = await execPromise(`ip link show | grep -E "eth|wlan|br|vlan" | awk '{print $2}' | sed 's/:$//'`).catch(() => ({ stdout: '' }));
      const interfaces = allInterfaces.stdout.trim().split('\n').filter(i => i);
      
      for (const iface of interfaces) {
        // Clean up any remaining download filters
        await execPromise(`tc filter show dev ${iface} parent 1:0 | grep -q "${ip}" && tc filter del dev ${iface} parent 1:0 protocol ip u32 match ip dst ${ip} 2>/dev/null || true`).catch(() => {});
        // Clean up any remaining upload filters
        await execPromise(`tc filter show dev ${iface} parent ffff: | grep -q "${ip}" && tc filter del dev ${iface} parent ffff: protocol ip u32 match ip src ${ip} 2>/dev/null || true`).catch(() => {});
      }
    } catch (e) {
      // Ignore additional cleanup errors
    }
    
  } catch (e) {
    // Ignore errors if objects don't exist
    console.log(`[QoS] Cleanup for ${ip}: ${e.message}`);
  }
}

async function whitelistMAC(mac, ip) {
  if (!mac) return;
  console.log(`[NET] Unblocking Device (Forcing 8.8.8.8 DNS): ${mac}`);
  try {
    const ipFilter = isValidIp(ip) ? `-s ${ip}` : '';
    
    // 1. Clean up ANY existing rules first to prevent duplicates
    // We try to delete multiple times just in case
    for (let i = 0; i < 3; i++) {
        await execPromise(`iptables -D FORWARD -m mac --mac-source ${mac} -j ACCEPT`).catch(() => {});
        await execPromise(`iptables -D FORWARD -m mac --mac-source ${mac} -j DROP`).catch(() => {});
        await execPromise(`iptables -t nat -D PREROUTING -m mac --mac-source ${mac} -j ACCEPT`).catch(() => {});
        await execPromise(`iptables -t nat -D PREROUTING -m mac --mac-source ${mac} -p udp --dport 53 -j DNAT --to-destination 8.8.8.8:53`).catch(() => {});
        await execPromise(`iptables -t nat -D PREROUTING -m mac --mac-source ${mac} -p tcp --dport 53 -j DNAT --to-destination 8.8.8.8:53`).catch(() => {});
    }

    // 2. Allow all traffic in FORWARD chain
    await execPromise(`iptables -I FORWARD 1 -m mac --mac-source ${mac} -j ACCEPT`).catch(() => {});
    
    // 3. Bypass Portal Redirection
    await execPromise(`iptables -t nat -I PREROUTING 1 -m mac --mac-source ${mac} -j ACCEPT`).catch(() => {});

    // 4. Force DNS to 8.8.8.8 for this authorized client
    await execPromise(`iptables -t nat -I PREROUTING 1 -m mac --mac-source ${mac} -p udp --dport 53 -j DNAT --to-destination 8.8.8.8:53`).catch(() => {});
    await execPromise(`iptables -t nat -I PREROUTING 2 -m mac --mac-source ${mac} -p tcp --dport 53 -j DNAT --to-destination 8.8.8.8:53`).catch(() => {});

    // 5. Instant State Reset
    if (isValidIp(ip)) {
      // Clear all possible conntrack states for this IP
      await execPromise(`conntrack -D -s ${ip} 2>/dev/null || true`).catch(() => {});
      await execPromise(`conntrack -D -d ${ip} 2>/dev/null || true`).catch(() => {});
      await execPromise(`conntrack -D -p tcp -s ${ip} 2>/dev/null || true`).catch(() => {});
      await execPromise(`conntrack -D -p udp -s ${ip} 2>/dev/null || true`).catch(() => {});
      
      // Give it a tiny moment to settle
      await new Promise(r => setTimeout(r, 100));
      
      // Try to wake up the device by pinging it
      execPromise(`ping -c 1 -W 1 ${ip} 2>/dev/null || true`).catch(() => {});
      
      // Apply Speed Limit
      // Priority: Device Limit (Manual Override) > Session Limit (Plan) > Default Bandwidth Settings
      const device = await db.get('SELECT download_limit, upload_limit FROM wifi_devices WHERE mac = ?', [mac]);
      const session = await db.get('SELECT download_limit, upload_limit FROM sessions WHERE mac = ?', [mac]);
      
      // Load default bandwidth settings from config
      const defaultDlRow = await db.get("SELECT value FROM config WHERE key = 'default_download_limit'");
      const defaultUlRow = await db.get("SELECT value FROM config WHERE key = 'default_upload_limit'");
      
      const defaultDl = defaultDlRow ? parseInt(defaultDlRow.value) : 5; // Default to 5Mbps
      const defaultUl = defaultUlRow ? parseInt(defaultUlRow.value) : 5; // Default to 5Mbps
      
      let dl = 0, ul = 0;
      
      // Download: Use device limit if set (>0), otherwise use session limit (>0), otherwise ALWAYS use default
      if (device && device.download_limit > 0) {
        dl = device.download_limit;
      } else if (session && session.download_limit > 0) {
        dl = session.download_limit;
      } else {
        dl = defaultDl;
      }
      
      // Upload: Use device limit if set (>0), otherwise use session limit (>0), otherwise ALWAYS use default
      if (device && device.upload_limit > 0) {
        ul = device.upload_limit;
      } else if (session && session.upload_limit > 0) {
        ul = session.upload_limit;
      } else {
        ul = defaultUl;
      }
      
      if (dl > 0 || ul > 0) {
        await setSpeedLimit(mac, ip, dl, ul);
      }
      
      // Sync applied limits back to device record so UI shows actual applied limits
      try {
        // Check if device exists in wifi_devices table
        const existingDevice = await db.get('SELECT id, ip, download_limit, upload_limit FROM wifi_devices WHERE mac = ?', [mac]);
        const lanInterface = await getInterfaceForIp(ip) || 'unknown';
        
        if (existingDevice) {
          // Update existing device - sync applied limits if they were defaulting (0/null)
          // so the UI reflects reality, but don't overwrite explicit user-set limits
          const updates = ['interface = ?', 'ip = ?', 'last_seen = ?'];
          const values = [lanInterface, ip, Date.now()];
          
          if ((existingDevice.download_limit === 0 || existingDevice.download_limit === null) && dl > 0) {
            updates.push('download_limit = ?');
            values.push(dl);
          }
          if ((existingDevice.upload_limit === 0 || existingDevice.upload_limit === null) && ul > 0) {
            updates.push('upload_limit = ?');
            values.push(ul);
          }
          
          values.push(mac);
          await db.run(`UPDATE wifi_devices SET ${updates.join(', ')} WHERE mac = ?`, values);
        } else {
          // Insert new device with the ACTUAL applied limits so UI shows correct values
          const deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await db.run(
            'INSERT INTO wifi_devices (id, mac, ip, interface, download_limit, upload_limit, connected_at, last_seen, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, mac, ip, lanInterface, dl, ul, Date.now(), Date.now(), 1]
          );
        }
      } catch (e) {
        console.log(`[QoS] Failed to sync limits to device record: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`[NET] Whitelist error:`, e.message);
  }
}

async function blockMAC(mac, ip) {
  if (!mac) return;
  console.log(`[NET] Blocking Device (Redirecting to Portal): ${mac}`);
  try {
    const ipFilter = isValidIp(ip) ? `-s ${ip}` : '';
    
    // Remove Speed Limit
    await removeSpeedLimit(mac, ip);

    // 1. Clean up whitelist rules
    await execPromise(`iptables -D FORWARD -m mac --mac-source ${mac} -j ACCEPT`).catch(() => {});
    await execPromise(`iptables -D FORWARD -m mac --mac-source ${mac} -j DROP`).catch(() => {});
    await execPromise(`iptables -t nat -D PREROUTING -m mac --mac-source ${mac} -j ACCEPT`).catch(() => {});
    await execPromise(`iptables -t nat -D PREROUTING -m mac --mac-source ${mac} -p udp --dport 53 -j DNAT --to-destination 8.8.8.8:53`).catch(() => {});
    await execPromise(`iptables -t nat -D PREROUTING -m mac --mac-source ${mac} -p tcp --dport 53 -j DNAT --to-destination 8.8.8.8:53`).catch(() => {});

    // 2. Redirect DNS to Portal IP (Captive Portal Trigger)
    // We let the default PREROUTING REDIRECT handle HTTP
    // And let the default FORWARD DROP handle the rest
    
    // Explicitly BLOCK forwarding for this MAC to kill established connections
    await execPromise(`iptables -I FORWARD 1 -m mac --mac-source ${mac} -j DROP`).catch(() => {});
    
    // 3. Instant State Reset
    if (isValidIp(ip)) {
      await execPromise(`conntrack -D -s ${ip} 2>/dev/null || true`).catch(() => {});
      await execPromise(`conntrack -D -d ${ip} 2>/dev/null || true`).catch(() => {});
    }
  } catch (e) {
    console.error(`[NET] Block error:`, e.message);
  }
}

function makeSafeVlanName(parent, id) {
  const base = (parent || '').split('.')[0];
  const suffix = `.${id}`;
  const maxLen = 15;
  const candidate = `${base}${suffix}`;
  if (candidate.length <= maxLen) return candidate;
  const allowed = maxLen - suffix.length;
  if (allowed <= 0) return `v${id}`;
  return `${base.slice(0, allowed)}${suffix}`;
}

async function createVlan({ parent, id, name }) {
  if (!parent || !id) throw new Error('Parent interface and VLAN ID are required');
  
  // Basic validation
  if (!/^[a-zA-Z0-9_.-]+$/.test(parent)) throw new Error('Invalid parent interface name');
  if (isNaN(parseInt(id))) throw new Error('Invalid VLAN ID');

  const finalName = makeSafeVlanName(parent, id);
  console.log(`[NET] Creating VLAN ${finalName} on ${parent} ID ${id}`);
  
  // Try to load module just in case
  try { await execPromise('modprobe 8021q'); } catch (e) {} 

  try {
    // Check if parent exists
    await execPromise(`ip link show ${parent}`);
  } catch (e) {
    throw new Error(`Parent interface '${parent}' does not exist or is down`);
  }

  try {
    await execPromise(`ip link add link ${parent} name ${finalName} type vlan id ${id}`);
    await execPromise(`ip link set dev ${finalName} up`);
  } catch (e) { 
    if (e.message.includes('File exists')) {
      console.log(`[NET] VLAN ${finalName} already exists, ensuring it is up.`);
      await execPromise(`ip link set dev ${finalName} up`).catch(() => {});
    } else {
      throw new Error(`Failed to create VLAN: ${e.message} ${e.stderr || ''}`);
    }
  }
  return finalName;
}

async function deleteVlan(name) {
  console.log(`[NET] Deleting VLAN ${name}`);
  try {
    // Flush IP address first
    await execPromise(`ip addr flush dev ${name} 2>/dev/null`).catch(() => {});
    // Set down
    await execPromise(`ip link set dev ${name} down 2>/dev/null`).catch(() => {});
    // Remove from any bridge
    await execPromise(`ip link set dev ${name} nomaster 2>/dev/null`).catch(() => {});
    // Delete the VLAN interface
    await execPromise(`ip link delete dev ${name}`);
    console.log(`[NET] VLAN ${name} deleted successfully.`);
  } catch (e) {
    // If ip link delete fails, try alternate syntax
    try {
      await execPromise(`ip link delete ${name}`);
      console.log(`[NET] VLAN ${name} deleted (alternate syntax).`);
    } catch (e2) {
      console.error(`[NET] Failed to delete VLAN ${name}:`, e2.message);
      throw e2;
    }
  }
}

async function createBridge({ name, members, stp }) {
  const list = Array.isArray(members) ? members : [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  console.log(`[NET] Creating Bridge ${name} with members: ${list.join(', ')}`);
  try {
    const addBridgeWithIp = async () => {
      await execPromise(`ip link add name ${name} type bridge`).catch(() => {});
    };
    const addBridgeWithBrctl = async () => {
      await execPromise(`brctl addbr ${name}`).catch(() => {});
    };
    await addBridgeWithIp();
    await addBridgeWithBrctl();

    for (const member of list) {
      let exists = false;
      for (let i = 0; i < 10; i++) {
        try {
          await execPromise(`ip link show ${member}`);
          exists = true;
          break;
        } catch (e) {
          await sleep(1000);
        }
      }

      if (!exists) {
        console.warn(`[NET] Bridge member not found: ${member}`);
        continue;
      }

      await execPromise(`ip link set dev ${member} down`).catch(() => {});
      await execPromise(`ip link set dev ${member} nomaster`).catch(() => {});
      await execPromise(`ip link set dev ${member} master ${name}`).catch(async () => {
        await execPromise(`brctl addif ${name} ${member}`).catch(() => {});
      });
      await execPromise(`ip link set dev ${member} up`).catch(() => {});
    }

    if (stp) {
      await execPromise(`ip link set dev ${name} type bridge stp_state 1`).catch(async () => {
        await execPromise(`brctl stp ${name} on`).catch(() => {});
      });
    }

    await execPromise(`ip link set dev ${name} up`);
    return `Bridge ${name} active.`;
  } catch (e) { throw e; }
}

async function deleteBridge(name) {
  console.log(`[NET] Deleting Bridge ${name}`);
  try {
    await execPromise(`ip link set dev ${name} down`);
    await execPromise(`brctl delbr ${name}`);
  } catch (e) { throw e; }
}

async function dnsmasqTest() {
  try {
    await execPromise('dnsmasq --test');
    return true;
  } catch (e) {
    console.error('[DNS] Configuration test failed:', e.message);
    return false;
  }
}

async function restartDnsmasq() {
  console.log('[DNS] Restarting dnsmasq...');
  try {
    // 1. Check if configuration is valid before restarting
    const isValid = await dnsmasqTest();
    if (!isValid) {
      console.error('[DNS] Configuration is invalid, attempting to fix common issues...');
      
      // Try to fix port 53 conflict with systemd-resolved if it exists
      try {
        const { stdout: resolvedStatus } = await execPromise('systemctl is-active systemd-resolved').catch(() => ({ stdout: 'inactive' }));
        if (resolvedStatus.trim() === 'active') {
          console.log('[DNS] Detected systemd-resolved conflict. Disabling it...');
          await execPromise('systemctl stop systemd-resolved || true');
          await execPromise('systemctl disable systemd-resolved || true');
          // Update /etc/resolv.conf if it's a symlink to systemd-resolved
          await execPromise('rm -f /etc/resolv.conf && echo "nameserver 8.8.8.8" > /etc/resolv.conf').catch(() => {});
        }
      } catch (e) {}
      
      // Test again
      if (!(await dnsmasqTest())) {
        console.error('[DNS] dnsmasq configuration is still invalid after attempted fixes.');
        // We still try to restart, but it will likely fail
      }
    }

    // 2. Restart the service
    await execPromise('systemctl restart dnsmasq');
    console.log('[DNS] dnsmasq restarted successfully');
  } catch (e) {
    console.error('[DNS] Failed to restart dnsmasq:', e.message);
    // Provide more diagnostics
    try {
      const { stdout } = await execPromise('journalctl -u dnsmasq -n 20 --no-pager').catch(() => ({ stdout: 'Could not get logs' }));
      console.error('[DNS] Recent Logs:\n', stdout);
    } catch (err) {}
    throw e;
  }
}

async function setupHotspot(config, skipRestart = false) {
  let { interface, ip_address, dhcp_range } = config;
  try {
    const defaultWan = await getDefaultRouteInterface();
    if (defaultWan && String(interface) === String(defaultWan)) {
      throw new Error(`Refusing to configure hotspot on WAN interface: ${interface}`);
    }

    const ipMatch = String(ip_address || '').match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    const ipv4 = ipMatch ? ipMatch[1] : null;
    if (!ipv4) throw new Error('Invalid IPv4 address');
    // Check if interface is bridged (slave)
    try {
      const { stdout } = await execPromise(`ip -j link show ${interface}`);
      const linkInfo = JSON.parse(stdout)[0];
      if (linkInfo && linkInfo.master) {
        console.log(`[HOTSPOT] Interface ${interface} is bridged to ${linkInfo.master}. Redirecting config to bridge.`);
        // Flush IP on the slave interface to avoid conflicts
        if (!(defaultWan && String(interface) === String(defaultWan))) {
          await execPromise(`ip addr flush dev ${interface}`).catch(() => {});
        }
        // Use the bridge interface instead
        interface = linkInfo.master;
      }
    } catch (e) {}

    if (defaultWan && String(interface) === String(defaultWan)) {
      throw new Error(`Refusing to configure hotspot on WAN interface: ${interface}`);
    }

    await execPromise(`ip link set ${interface} up`);
    await execPromise(`ip addr flush dev ${interface}`);
    const nm = String(config.netmask || '255.255.255.0');
    const parts = nm.split('.').map(n => parseInt(n, 10));
    const countBits = (n) => ((n & 128 ? 1 : 0) + (n & 64 ? 1 : 0) + (n & 32 ? 1 : 0) + (n & 16 ? 1 : 0) + (n & 8 ? 1 : 0) + (n & 4 ? 1 : 0) + (n & 2 ? 1 : 0) + (n & 1 ? 1 : 0));
    const prefix = parts.length === 4 ? parts.reduce((a, b) => a + countBits(b), 0) : 20;
    await execPromise(`ip addr add ${ipv4}/${prefix} dev ${interface}`);
    await execPromise(`iptables -t nat -A PREROUTING -i ${interface} -p tcp --dport 80 -j REDIRECT --to-ports 80`).catch(() => {});

    // Use bind-dynamic for better reliability on Linux with changing interfaces
    const dnsConfig = `interface=${interface}
bind-dynamic
dhcp-range=${dhcp_range},12h
dhcp-option=3,${ipv4}
dhcp-option=6,${ipv4}
dhcp-authoritative
address=/#/${ipv4}`;
    try { if (!fs.existsSync('/etc/dnsmasq.d')) fs.mkdirSync('/etc/dnsmasq.d', { recursive: true }); } catch (e) {}
    fs.writeFileSync(`/etc/dnsmasq.d/ajc_${interface}.conf`, dnsConfig);
    
    if (!skipRestart) {
      await restartDnsmasq();
    }
    console.log(`[HOTSPOT] Segment Live on ${interface}`);
  } catch (e) { throw e; }
}

async function removeHotspot(interface, skipRestart = false) {
  try {
    let targetInterface = interface;
    // Check if interface is bridged to find the correct target
    try {
      const { stdout } = await execPromise(`ip -j link show ${interface}`);
      const linkInfo = JSON.parse(stdout)[0];
      if (linkInfo && linkInfo.master) {
         targetInterface = linkInfo.master;
      }
    } catch (e) {}

    // Clean up possible config files (bridge or direct)
    const filesToCheck = [
      `/etc/dnsmasq.d/ajc_${targetInterface}.conf`,
      `/etc/dnsmasq.d/ajc_${interface}.conf`
    ];
    
    for (const file of filesToCheck) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    // Clean up iptables rules for both potentially
    await execPromise(`iptables -t nat -D PREROUTING -i ${targetInterface} -p tcp --dport 80 -j REDIRECT --to-ports 80`).catch(() => {});
    if (targetInterface !== interface) {
      await execPromise(`iptables -t nat -D PREROUTING -i ${interface} -p tcp --dport 80 -j REDIRECT --to-ports 80`).catch(() => {});
    }

    if (!skipRestart) {
      await restartDnsmasq();
    }
  } catch (e) { throw e; }
}

async function configureWifiAP(config) {
  const { interface, ssid, password, bridge } = config;
  try {
    await execPromise(`ip link set ${interface} up`);
    const hostapdConfig = `interface=${interface}
${bridge ? `bridge=${bridge}` : ''}
driver=nl80211
ssid=${ssid}
hw_mode=g
channel=1
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
${password ? `wpa=2
wpa_passphrase=${password}
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP` : ''}`;
    
    const configPath = `/etc/hostapd/hostapd_${interface}.conf`;
    
    // Check if configuration has changed and if hostapd is running
    let shouldRestart = true;
    if (fs.existsSync(configPath)) {
      const currentConfig = fs.readFileSync(configPath, 'utf8');
      if (currentConfig === hostapdConfig) {
        try {
          // Check if hostapd is running for this specific config
          await execPromise(`pgrep -f "hostapd -B ${configPath}"`);
          console.log(`[WIFI] Hostapd already running with active config on ${interface}. Skipping restart.`);
          shouldRestart = false;
        } catch (e) {
          // Not running, proceed with restart
        }
      }
    }

    if (shouldRestart) {
      fs.writeFileSync(configPath, hostapdConfig);
      
      // Ensure interface is not managed by wpa_supplicant and kill existing hostapd
      await execPromise(`systemctl stop hostapd || true`);
      await execPromise(`killall hostapd || true`);
      await execPromise(`nmcli device set ${interface} managed no || true`);
      await execPromise(`rfkill unblock wifi || true`);
      
      await execPromise(`hostapd -B ${configPath}`);
      console.log(`[WIFI] Broadcast started on ${interface}: ${ssid}`);
    }
  } catch (e) { 
    console.error(`[WIFI] Failed to deploy AP on ${interface}:`, e.message);
    throw e; 
  }
}

// ARP and DHCP lease caches for scanWifiDevices optimization
let _arpCache = null;
let _arpCacheTs = 0;
const ARP_CACHE_TTL = 5000; // 5s ARP cache

let _dhcpLeaseCache = null;
let _dhcpLeaseCacheTs = 0;
const DHCP_LEASE_CACHE_TTL = 5000; // 5s DHCP lease cache

function _parseArpOutput(stdout) {
  const map = new Map(); // mac (upper) -> ip
  if (!stdout) return map;
  for (const line of stdout.split('\n')) {
    const match = line.match(/^(\S+)\s+dev\s+(\S+)\s+(?:lladdr\s+)?([0-9a-fA-F:]{17})\s+(\S+)/);
    if (match) {
      const ip = match[1];
      const mac = match[3].toUpperCase();
      const state = match[4].toUpperCase();
      const validStates = ['REACHABLE', 'STALE', 'DELAY', 'PROBE'];
      if (validStates.includes(state)) {
        map.set(mac, { ip, iface: match[2], state });
      }
    }
  }
  return map;
}

function _parseDhcpLeases() {
  const map = new Map(); // mac (upper) -> hostname
  const leaseFiles = ['/tmp/dhcp.leases', '/var/lib/dnsmasq/dnsmasq.leases', '/var/lib/dhcp/dhcpd.leases', '/var/lib/misc/dnsmasq.leases'];
  for (const leaseFile of leaseFiles) {
    try {
      if (fs.existsSync(leaseFile)) {
        const content = fs.readFileSync(leaseFile, 'utf8');
        for (const line of content.split('\n')) {
          const parts = line.split(/\s+/);
          if (parts.length >= 4) {
            const mac = parts[1] ? parts[1].toUpperCase() : '';
            const h = parts[3];
            if (mac && h && h !== '*' && h !== 'Unknown') {
              if (!map.has(mac)) map.set(mac, h);
            }
          }
        }
      }
    } catch (e) {}
  }
  return map;
}

async function scanWifiDevices() {
  console.log('[WIFI] Scanning for connected WiFi devices...');
  const devices = [];
  
  try {
    // Build hostname map from system logs (only on full scan, not cached)
    const hostnamesFromLogs = await (async () => {
      const sources = [];
      try {
        const { stdout } = await execPromise('journalctl -u dnsmasq -n 500 --no-pager');
        sources.push(stdout);
      } catch (e) {}
      const files = ['/var/log/syslog', '/var/log/messages', '/var/log/daemon.log'];
      for (const file of files) {
        try {
          if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            sources.push(content);
          }
        } catch (e) {}
      }
      const map = new Map();
      for (const content of sources) {
        const lines = String(content || '').split('\n');
        for (const line of lines) {
          if (!/dnsmasq.*DHCPACK/i.test(line)) continue;
          const m = line.match(/DHCPACK.*\)\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{17})\s+([^\s]+)/);
          if (m) {
            const mac = m[2].toUpperCase();
            const host = m[3];
            if (host && host !== '*' && host !== 'Unknown') {
              if (!map.has(mac)) map.set(mac, host);
            }
          }
        }
      }
      return map;
    })();
    
    // Build ARP cache (single exec call, reused for all MAC lookups)
    const now = Date.now();
    if (!_arpCache || (now - _arpCacheTs) > ARP_CACHE_TTL) {
      try {
        const { stdout } = await execPromise('ip neigh show').catch(() => ({ stdout: '' }));
        _arpCache = _parseArpOutput(stdout);
        _arpCacheTs = now;
      } catch (e) {
        _arpCache = new Map();
      }
    }

    // Build DHCP lease cache (single file read, reused for all MAC lookups)
    if (!_dhcpLeaseCache || (now - _dhcpLeaseCacheTs) > DHCP_LEASE_CACHE_TTL) {
      _dhcpLeaseCache = _parseDhcpLeases();
      _dhcpLeaseCacheTs = now;
    }

    // Get allowed interfaces (hotspots and their bridge members)
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

    // Get all interfaces
    const interfaces = await getInterfaces();
    const wifiInterfaces = interfaces.filter(iface => 
      iface.type === 'wifi' && 
      iface.status === 'up' &&
      allowedInterfaces.has(iface.name)
    );
    
    for (const wifiInterface of wifiInterfaces) {
      try {
        // Get associated stations using iw
        const { stdout: stationsOutput } = await execPromise(`iw dev ${wifiInterface.name} station dump`).catch(() => ({ stdout: '' }));
        
        if (stationsOutput) {
          const stations = stationsOutput.split('\n\n').filter(station => station.trim());
          
          for (const station of stations) {
            const macMatch = station.match(/^Station ([a-fA-F0-9:]{17})/);
            if (macMatch) {
              const mac = macMatch[1].toUpperCase();
              
              // Get signal strength
              const signalMatch = station.match(/signal:\s*(-?\d+)/);
              const signal = signalMatch ? parseInt(signalMatch[1]) : -50;
              
              // Get IP from cached ARP table (no exec call per device)
              const arpEntry = _arpCache.get(mac);
              const ip = arpEntry ? arpEntry.ip : 'Unknown';
              
              // Get hostname from cached DHCP leases (no file read per device)
              let hostname = _dhcpLeaseCache.get(mac) || 'Unknown';
              
              if (hostnamesFromLogs.has(mac)) {
                hostname = hostnamesFromLogs.get(mac);
              }
              
              devices.push({
                mac,
                ip: ip || 'Unknown',
                hostname: hostname || 'Unknown',
                interface: wifiInterface.name,
                ssid: wifiInterface.name,
                signal,
                connectedAt: Date.now(),
                lastSeen: Date.now(),
                isActive: true
              });
            }
          }
        }
      } catch (e) {
        console.error(`[WIFI] Error scanning interface ${wifiInterface.name}:`, e.message);
      }
    }
    
    // Also scan for devices in ARP table that might be on WiFi bridges
    // Uses the already-cached ARP data instead of another exec call
    const foundMacs = new Set(devices.map(d => d.mac));
    for (const [mac, arpEntry] of _arpCache.entries()) {
      // Skip if already found in iw dump
      if (foundMacs.has(mac)) continue;

      // Check if this interface is relevant (WiFi, Bridge, VLAN, or Ethernet) AND is allowed
      const relevantInterface = interfaces.find(i => 
        (i.name === arpEntry.iface) && 
        (i.type === 'wifi' || i.type === 'bridge' || i.type === 'vlan' || i.type === 'ethernet') &&
        allowedInterfaces.has(i.name)
      );
      
      if (relevantInterface) {
        // Get hostname from cached DHCP leases
        let hostname = _dhcpLeaseCache.get(mac) || 'Unknown';

        if (hostnamesFromLogs.has(mac)) {
          hostname = hostnamesFromLogs.get(mac);
        }

        devices.push({
          mac,
          ip: arpEntry.ip,
          hostname,
          interface: arpEntry.iface,
          ssid: relevantInterface.type === 'vlan' ? 'VLAN' : 'Bridge/Wired',
          signal: -60, // Dummy signal for bridged devices
          connectedAt: Date.now(),
          lastSeen: Date.now(),
          isActive: true
        });
      }
    }
    
    console.log(`[WIFI] Found ${devices.length} WiFi devices`);
    return devices;
  } catch (err) {
    console.error('[WIFI] Error scanning for devices:', err.message);
    return [];
  }
}

async function restoreNetworkConfig() {
  console.log('[NET] Restoring Network Configuration...');
  try {
    const defaultWan = await getDefaultRouteInterface();
    const safeDefaultWan = (defaultWan && !isVirtualInterfaceName(defaultWan)) ? defaultWan : null;
    if (safeDefaultWan) {
      await execPromise(`ip link set dev ${safeDefaultWan} nomaster`).catch(() => {});
    }
    // 1. Restore VLANs (skip orphans whose parent doesn't exist)
    const vlans = await db.all('SELECT * FROM vlans');
    const currentIfaces = await getInterfaces();
    const currentIfaceNames = new Set(currentIfaces.map(i => i.name));
    
    for (const vlan of vlans) {
      // If parent interface doesn't exist, auto-delete orphaned VLAN
      if (!currentIfaceNames.has(vlan.parent)) {
        console.warn(`[NET] Orphaned VLAN during restore: ${vlan.name} (parent '${vlan.parent}' not found). Auto-deleting...`);
        await deleteVlan(vlan.name).catch(() => {});
        await db.run('DELETE FROM hotspots WHERE interface = ?', [vlan.name]).catch(() => {});
        await db.run('DELETE FROM vlans WHERE name = ?', [vlan.name]).catch(() => {});
        try {
          const dnsmasqConf = `/etc/dnsmasq.d/ajc_${vlan.name}.conf`;
          if (fs.existsSync(dnsmasqConf)) fs.unlinkSync(dnsmasqConf);
        } catch (e) {}
        continue;
      }
      try {
        await createVlan(vlan);
      } catch (e) {
        // Ignore "File exists" error
        if (!e.message.includes('File exists')) {
          console.error(`[NET] Failed to restore VLAN ${vlan.name}:`, e.message);
        }
      }
    }

    // 2. Restore Bridges
    const bridges = await db.all('SELECT * FROM bridges');
    for (const bridge of bridges) {
      try {
        let members = JSON.parse(bridge.members);
        if (safeDefaultWan) members = members.filter(m => String(m) !== String(safeDefaultWan));
        await createBridge({ ...bridge, members });
      } catch (e) {
        if (!e.message.includes('File exists')) {
          console.error(`[NET] Failed to restore Bridge ${bridge.name}:`, e.message);
        }
      }
    }
    
    // 3. Restore Hotspots
    const hotspots = await db.all('SELECT * FROM hotspots WHERE enabled = 1');
    for (const hotspot of hotspots) {
      try {
        if (safeDefaultWan && String(hotspot.interface) === String(safeDefaultWan)) continue;
        await setupHotspot(hotspot, true); // Skip restart in loop
      } catch (e) {
         console.error(`[NET] Failed to restore Hotspot ${hotspot.interface}:`, e.message);
      }
    }

    // Restart dnsmasq ONCE after all hotspot configs are restored
    if (hotspots.length > 0) {
      try {
        await restartDnsmasq();
      } catch (e) {
        console.error(`[NET] Global dnsmasq restart failed during restore:`, e.message);
      }
    }

    // 4. Restore Wireless APs
    const wireless = await db.all('SELECT * FROM wireless_settings');
    for (const wifi of wireless) {
      try {
        await configureWifiAP(wifi);
      } catch (e) {
         console.error(`[NET] Failed to restore WiFi ${wifi.interface}:`, e.message);
      }
    }
    
    // 5. Restore PPPoE Server
    const pppoeServer = await db.get('SELECT * FROM pppoe_server WHERE enabled = 1');
    if (pppoeServer) {
      try {
        console.log(`[NET] Restoring PPPoE Server on ${pppoeServer.interface}...`);
        await startPPPoEServer(pppoeServer);
      } catch (e) {
        console.error(`[NET] Failed to restore PPPoE Server:`, e.message);
      }
    }
    
    // 6. Initialize Firewall
    await initFirewall();

  } catch (err) {
    console.error('[NET] Restore error:', err.message);
  }
}

async function autoProvisionNetwork() {
  console.log('[NET] Starting Auto-Provisioning...');
  try {
    const interfaces = await getInterfaces();
    
    // 1. Detect Interfaces using Smart Classification
    const defaultWan = await getDefaultRouteInterface();
    const classified = classifyInterfaces(interfaces);
    const safeDefaultWan = (defaultWan && !isVirtualInterfaceName(defaultWan)) ? defaultWan : null;
    const wanName = safeDefaultWan || classified.wanName;
    const lanMembers = (classified.lanMembers || []).filter(m => String(m) !== String(wanName));
    
    // --- Cleanup Orphaned VLANs (parent interface doesn't exist) ---
    // This fixes the cloned-system issue: when a system is cloned to a different
    // PC with a different WAN name, VLANs 13 and 22 from the original PC still
    // exist in the DB but their parent interface no longer exists.
    try {
      const allVlans = await db.all('SELECT * FROM vlans');
      const availableIfaces = new Set(interfaces.map(i => i.name));
      
      for (const vlan of allVlans) {
        const parentExists = availableIfaces.has(vlan.parent);
        // Also check if VLAN interface itself exists in OS but parent doesn't
        if (!parentExists) {
          console.warn(`[NET] Orphaned VLAN detected: ${vlan.name} (parent '${vlan.parent}' does not exist). Auto-deleting...`);
          
          // Delete from OS if it exists
          try {
            await execPromise(`ip link show dev ${vlan.name} 2>/dev/null`);
            await deleteVlan(vlan.name);
          } catch (e) {
            // VLAN interface doesn't exist in OS either, that's fine
            console.log(`[NET] VLAN ${vlan.name} not found in OS, cleaning DB only.`);
          }
          
          // Delete associated hotspot config
          try {
            await db.run('DELETE FROM hotspots WHERE interface = ?', [vlan.name]);
          } catch (e) {}
          
          // Delete from DB
          try {
            await db.run('DELETE FROM vlans WHERE name = ?', [vlan.name]);
          } catch (e) {}
          
          // Also clean dnsmasq config for this VLAN
          try {
            const dnsmasqConf = `/etc/dnsmasq.d/ajc_${vlan.name}.conf`;
            if (fs.existsSync(dnsmasqConf)) {
              fs.unlinkSync(dnsmasqConf);
              console.log(`[NET] Removed dnsmasq config: ${dnsmasqConf}`);
            }
          } catch (e) {}
          
          console.log(`[NET] Orphaned VLAN ${vlan.name} (parent: ${vlan.parent}) cleaned up.`);
        }
      }
    } catch (e) {
      console.error('[NET] Orphaned VLAN cleanup error:', e.message);
    }

    // --- Cleanup OS-level orphaned VLANs (exist in OS but not in DB) ---
    // These are leftover from cloned systems where the VLAN was created at OS level
    // but the DB was updated with a different WAN name
    try {
      const dbVlans = await db.all('SELECT * FROM vlans');
      const dbVlanNames = new Set(dbVlans.map(v => v.name));
      
      // Find all VLAN interfaces in the OS
      const { stdout: linkShow } = await execPromise('ip -j link show 2>/dev/null').catch(() => ({ stdout: '[]' }));
      const osLinks = JSON.parse(String(linkShow || '[]'));
      
      for (const link of osLinks) {
        const ifname = link.ifname || link.name || '';
        // Check if this is a VLAN interface (contains a dot like eno1.13 or enp3s0.22)
        if (!ifname.includes('.') || ifname.startsWith('br-') || ifname.startsWith('docker')) continue;
        
        // Verify it's actually a VLAN by checking link_info
        const isVlan = link.link_info && link.link_info.info_kind === 'vlan';
        if (!isVlan && !/^e[nnt][0-9os]*\.\d+$/.test(ifname)) continue; // skip non-VLAN dotted names
        
        // If this VLAN exists in OS but not in DB, it's orphaned
        if (!dbVlanNames.has(ifname)) {
          console.warn(`[NET] OS-level orphaned VLAN: ${ifname} (not in DB). Auto-deleting...`);
          await deleteVlan(ifname).catch(e => console.error(`[NET] Failed to delete OS VLAN ${ifname}:`, e.message));
          // Also clean dnsmasq config
          try {
            const dnsmasqConf = `/etc/dnsmasq.d/ajc_${ifname}.conf`;
            if (fs.existsSync(dnsmasqConf)) fs.unlinkSync(dnsmasqConf);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('[NET] OS-level VLAN cleanup error:', e.message);
    }

    // --- Auto-Configure VLANs on WAN ---
    if (wanName) {
      console.log(`[NET] Checking VLAN configuration for WAN (${wanName})...`);
      const vlanConfigs = [
        { id: 13, ip: '10.0.13.1' },
        { id: 22, ip: '10.0.22.1' }
      ];
      
      for (const vlan of vlanConfigs) {
        try {
          // Check if VLAN exists in DB first
          const vlanName = makeSafeVlanName(wanName, vlan.id);
          const existingVlan = await db.get('SELECT * FROM vlans WHERE name = ?', [vlanName]);
          
          if (!existingVlan) {
            console.log(`[NET] Auto-provisioning missing VLAN: ${vlanName}`);
            
            // Create VLAN (ignore if exists)
            const createdName = await createVlan({ parent: wanName, id: vlan.id, name: vlanName }).catch(() => vlanName);
            
            // Set IP
            await execPromise(`ip addr flush dev ${createdName}`);
            await execPromise(`ip addr add ${vlan.ip}/24 dev ${createdName}`);
            
            // Ensure UP and Independent (Not Bridged)
            await execPromise(`ip link set dev ${createdName} up`);
            await execPromise(`ip link set dev ${createdName} nomaster`).catch(() => {});
            
            // Persist to DB
            await db.run('INSERT OR REPLACE INTO vlans (name, parent, id) VALUES (?, ?, ?)', 
              [createdName, wanName, vlan.id]);

            // Configure as independent Hotspot Segment
            const parts = vlan.ip.split('.');
            parts.pop(); // remove last octet
            const prefix = parts.join('.');
            const dhcpStart = `${prefix}.50`;
            const dhcpEnd = `${prefix}.250`;
            const dhcpRange = `${dhcpStart},${dhcpEnd}`;

            await db.run('INSERT OR REPLACE INTO hotspots (interface, ip_address, dhcp_range, enabled) VALUES (?, ?, ?, 1)', 
              [createdName, vlan.ip, dhcpRange]);
              
            console.log(`[NET] Configured ${createdName} with IP ${vlan.ip} as independent Hotspot segment.`);
          } else {
             console.log(`[NET] VLAN ${vlanName} already configured in DB. Skipping auto-provision.`);
          }
        } catch (e) {
          console.error(`[NET] Failed to configure VLAN ${vlan.id}:`, e.message);
        }
      }
    }

    console.log(`[NET] Auto-Provision: WAN=${wanName}, LAN/Bridge Candidates=[${lanMembers.join(', ')}]`);
    
    if (lanMembers.length === 0) {
      console.log('[NET] No suitable LAN/Wifi interfaces found for auto-provisioning.');
      return;
    }

    const bridgeName = 'br0';
    
    // Check if Bridge exists in DB
    const existingBridge = await db.get('SELECT * FROM bridges WHERE name = ?', [bridgeName]);
    
    if (!existingBridge) {
        console.log(`[NET] Auto-provisioning bridge ${bridgeName} with members: ${lanMembers.join(', ')}`);

        // 2. Create Bridge
        await createBridge({ name: bridgeName, members: lanMembers, stp: false });
        // Update DB to persist
        await db.run('INSERT OR REPLACE INTO bridges (name, members, stp) VALUES (?, ?, ?)', 
          [bridgeName, JSON.stringify(lanMembers), 0]);

        // 3. Configure Hotspot (IP/DHCP) on Bridge
        const hotspotIP = '10.0.0.1';
        const dhcpRange = '10.0.0.50,10.0.0.250';
        
        // Just update DB, let bootupRestore handle the actual service startup
        await db.run('INSERT OR REPLACE INTO hotspots (interface, ip_address, dhcp_range, enabled) VALUES (?, ?, ?, 1)', 
            [bridgeName, hotspotIP, dhcpRange]);
    } else {
        console.log(`[NET] Bridge ${bridgeName} already exists in DB. Skipping auto-provision.`);
    }

    // 4. Configure Wireless AP (SSID) on wlan0 (if it exists in the members)
    const wlanInterface = lanMembers.find(m => m.startsWith('wlan') || m.startsWith('ra') || m.startsWith('ap'));
    
    if (wlanInterface) {
        const ssid = 'AJC_PisoWifi_Hotspot';
        // Check if we already have a custom SSID in DB
        const wifiInDb = await db.get('SELECT * FROM wireless_settings WHERE interface = ?', [wlanInterface]);
        const finalSsid = wifiInDb ? wifiInDb.ssid : ssid;
        const finalPass = wifiInDb ? wifiInDb.password : '';
        
        // Just update DB
        await db.run('INSERT OR REPLACE INTO wireless_settings (interface, ssid, password, bridge) VALUES (?, ?, ?, ?)', 
          [wlanInterface, finalSsid, finalPass, bridgeName]);
    }

    console.log('[NET] Auto-Provisioning DB Updated. Services will start during restore phase.');
  } catch (e) {
    console.error('[NET] Auto-Provisioning Error:', e.message);
  }
}

async function getLanInterface() {
  const interfaces = await getInterfaces();
  const bridge = interfaces.find(i => i.type === 'bridge' && i.status === 'up');
  // Return bridge if exists, otherwise first wifi or ethernet that isn't WAN
  if (bridge) return bridge.name;
  
  const defaultWan = await getDefaultRouteInterface();
  const { wanName } = classifyInterfaces(interfaces);
  const lan = interfaces.find(i => i.name !== (defaultWan || wanName) && (i.type === 'wifi' || i.type === 'ethernet'));
  return lan ? lan.name : 'wlan0';
}

async function ensureIFBDevice(ifbName = 'ifb0') {
  // Create and enable IFB device for ingress traffic shaping
  try {
    // Check if IFB device exists
    await execPromise(`ip link show ${ifbName} 2>/dev/null`).catch(async () => {
      // Device doesn't exist, create it
      console.log(`[QoS] Creating IFB device ${ifbName}...`);
      await execPromise(`modprobe ifb`); // Load IFB module if needed
      await execPromise(`ip link add name ${ifbName} type ifb`);
    });
    
    // Ensure it's up
    await execPromise(`ip link set dev ${ifbName} up`);
    console.log(`[QoS] IFB device ${ifbName} ready`);
  } catch (e) {
    console.error(`[QoS] IFB setup error:`, e.message);
  }
}

async function initQoS(interface, discipline = 'cake') {
  console.log(`[QoS] Initializing HTB root with ${discipline} on ${interface}...`);
  try {
    // Ensure IFB device exists
    await ensureIFBDevice('ifb0');
    
    // Clear existing root qdisc
    await execPromise(`tc qdisc del dev ${interface} root`).catch(() => {});
    
    // Add HTB root
    await execPromise(`tc qdisc add dev ${interface} root handle 1: htb default 10`);
    
    // Add default class (unlimited)
    await execPromise(`tc class add dev ${interface} parent 1: classid 1:10 htb rate 1000mbit ceil 1000mbit`);
    
    // Add qdisc for default class
    const qdiscArgs = String(discipline || 'cake').trim() === 'fq_codel'
      ? 'fq_codel'
      : `${discipline} bandwidth 1000mbit`;
    await execPromise(`tc qdisc add dev ${interface} parent 1:10 handle 10: ${qdiscArgs}`);
    
    console.log(`[QoS] ${discipline.toUpperCase()} successfully applied on ${interface}`);

    // Apply Gaming Priority if enabled
    try {
      const gamingEnabled = await db.get("SELECT value FROM config WHERE key = 'gaming_priority_enabled'");
      const gamingPercentage = await db.get("SELECT value FROM config WHERE key = 'gaming_priority_percentage'");
      
      if (gamingEnabled?.value === '1') {
        await applyGamingPriority(interface, true, parseInt(gamingPercentage?.value || '20'));
      }
    } catch (e) {
      console.error(`[QoS] Failed to apply gaming priority during init:`, e.message);
    }
  } catch (e) {
    console.error(`[QoS] Init error:`, e.message);
  }
}

async function applyGamingPriority(interface, enabled, percentage) {
  if (!interface) return;
  console.log(`[QoS] Applying Gaming Priority on ${interface}: Enabled=${enabled}, Percentage=${percentage}%`);

  const gamingClassId = '1:5';
  const gamingHandle = '5:';
  
  // 1. Cleanup existing rules
  try {
    await execPromise(`tc class del dev ${interface} parent 1: classid ${gamingClassId} 2>/dev/null || true`).catch(() => {});
    
    // Cleanup iptables rules
    await execPromise(`iptables -t mangle -D POSTROUTING -o ${interface} -j GAMING_PRIO 2>/dev/null || true`).catch(() => {});
    await execPromise(`iptables -t mangle -F GAMING_PRIO 2>/dev/null || true`).catch(() => {});
    await execPromise(`iptables -t mangle -X GAMING_PRIO 2>/dev/null || true`).catch(() => {});
  } catch (e) {
    // Ignore cleanup errors
  }

  if (!enabled) return;

  try {
    // 2. Create Gaming Class
    // Assuming 1000Mbit root
    const totalRate = 1000;
    const gamingRate = Math.floor(totalRate * (percentage / 100));
    
    await execPromise(`tc class add dev ${interface} parent 1: classid ${gamingClassId} htb rate ${gamingRate}mbit ceil ${totalRate}mbit prio 0`);
    
    // Add fq_codel for low latency
    await execPromise(`tc qdisc add dev ${interface} parent ${gamingClassId} handle ${gamingHandle} fq_codel`);

    // 3. Setup iptables chain
    await execPromise(`iptables -t mangle -N GAMING_PRIO`).catch(() => {});
    await execPromise(`iptables -t mangle -A POSTROUTING -o ${interface} -j GAMING_PRIO`).catch(() => {});

    // 4. Add Rules
    const rules = await db.all('SELECT * FROM gaming_rules WHERE enabled = 1');
    
    for (const rule of rules) {
      const protocols = rule.protocol === 'both' ? ['tcp', 'udp'] : [rule.protocol];
      
      for (const proto of protocols) {
        // Match Source Port (Server -> Client download)
        const cmd = `iptables -t mangle -A GAMING_PRIO -p ${proto} --sport ${rule.port_start}:${rule.port_end} -j CLASSIFY --set-class ${gamingClassId}`;
        await execPromise(cmd);
      }
    }
    console.log(`[QoS] Gaming Priority applied with ${rules.length} rules.`);
  } catch (e) {
    console.error(`[QoS] Error applying Gaming Priority:`, e.message);
  }
}

/**
 * ============================================
 * PPPoE SERVER Management Functions
 * ============================================
 */

let logTailProcess = null;

function startLogTailing() {
  if (logTailProcess) return;
  
  console.log('[PPPoE-Server] Starting log tailing to terminal...');
  try {
    const { spawn } = require('child_process');
    // Use tail -F to handle file truncation and rotation gracefully
    logTailProcess = spawn('tail', ['-F', '/var/log/pppd.log', '/var/log/pppoe-server.log']);
    
    logTailProcess.stdout.on('data', (data) => {
      process.stdout.write(`[PPPoE-LOG] ${data}`);
    });
    
    logTailProcess.stderr.on('data', (data) => {
      process.stderr.write(`[PPPoE-LOG-ERR] ${data}`);
    });
    
    logTailProcess.on('close', () => {
      logTailProcess = null;
    });
  } catch (e) {
    console.error('[PPPoE-Server] Failed to start log tailing:', e.message);
  }
}

async function startPPPoEServer(config) {
  let { interface: iface, local_ip, ip_pool_start, ip_pool_end, dns1 = '8.8.8.8', dns2 = '8.8.4.4', service_name = '' } = config;
  
  console.log(`[PPPoE-Server] Starting PPPoE server on ${iface}...`);
  
  try {
    // 0. Ensure kernel modules are loaded
    console.log('[PPPoE-Server] Loading kernel modules...');
    await execPromise('modprobe pppoe').catch(() => {});
    await execPromise('modprobe ppp_mppe').catch(() => {});
    await execPromise('modprobe ppp_async').catch(() => {});
    await execPromise('modprobe ppp_generic').catch(() => {});

    // 1. Detect if interface is a bridge member
    let targetIface = iface;
    try {
      const { stdout: linkJson } = await execPromise(`ip -j link show ${iface}`);
      const linkInfo = JSON.parse(linkJson)[0];
      
      if (linkInfo && linkInfo.master) {
        console.log(`[PPPoE-Server] Interface ${iface} is a member of ${linkInfo.master}. Using ${linkInfo.master} instead.`);
        targetIface = linkInfo.master;
      }
    } catch (e) {
      console.warn(`[PPPoE-Server] Could not check bridge status for ${iface}`);
    }

    // 2. Stop any existing PPPoE server
    await stopPPPoEServer(targetIface);
    
    // 3. Ensure interface is up
    await execPromise(`ip link set ${targetIface} up`);
    
    // Check if targetIface is a bridge. If NOT a bridge, we can safely flush.
    // If it IS a bridge (like br0), we should NOT flush to avoid hanging the system.
    const isBridge = targetIface.startsWith('br');
    if (!isBridge) {
      console.log(`[PPPoE-Server] Adding secondary IP to non-bridge interface ${targetIface}`);
      // Don't flush! Hotspot clients might be using the primary IP.
      // Just add the PPPoE local IP if it doesn't exist.
      const { stdout: addrCheck } = await execPromise(`ip addr show dev ${targetIface}`);
      if (!addrCheck.includes(local_ip)) {
        await execPromise(`ip addr add ${local_ip}/24 dev ${targetIface}`).catch(() => {});
      }
    } else {
      console.log(`[PPPoE-Server] Interface ${targetIface} is a bridge. Skipping IP flush to prevent system hang.`);
      // Ensure the bridge has an IP, but don't flush existing ones
      const { stdout: addrCheck } = await execPromise(`ip addr show dev ${targetIface}`);
      if (!addrCheck.includes(local_ip)) {
        await execPromise(`ip addr add ${local_ip}/24 dev ${targetIface}`).catch(() => {});
      }
    }
    
    // 4. Create pppoe-server configuration
    const configDir = '/etc/ppp';
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // 5. Create options file for pppoe-server
    const optionsPath = '/etc/ppp/pppoe-server-options';
    const optionsContent = [
      `# AJC PisoWiFi PPPoE Server Options`,
      `lock`,
      `local`,
      `name pppoe-server`,
      `auth`,
      `require-mschap-v2`,
      `# require-mschap`,
      `# require-chap`,
      `# require-pap`,
      `# login`,
      `# lcp-echo-interval 30`,
      `# lcp-echo-failure 30`,
      `ms-dns ${dns1}`,
      `ms-dns ${dns2}`,
      `netmask 255.255.255.0`,
      `noipdefault`,
      `nodefaultroute`,
      `proxyarp`,
      `ktune`,
      `nobsdcomp`,
      `nodeflate`,
      `novj`,
      `novjccomp`,
      `nocrtscts`,
      `refuse-eap`,
      `# refuse-mppe`,
      `# nomppe`,
      `mru 1492`,
      `mtu 1492`,
      `idle 0`,
      `debug`,
      `dump`,
      `logfile /var/log/pppd.log`
    ].join('\n');
    
    fs.writeFileSync(optionsPath, optionsContent);
    
    // Ensure log files exist and are writable
    try {
      ['/var/log/pppd.log', '/var/log/pppoe-server.log'].forEach(file => {
        if (!fs.existsSync(file)) fs.writeFileSync(file, '');
        execPromise(`chmod 666 ${file}`).catch(() => {});
      });
    } catch (e) {}
    
    // 5.1 Sync all users to pap-secrets and chap-secrets
    await syncPPPoESecrets();
    
    // 5.2 Clear old logs to avoid confusion
    try {
      fs.writeFileSync('/var/log/pppoe-server.log', '');
      fs.writeFileSync('/var/log/pppd.log', '');
    } catch (e) {}

    // 5.3 Verify pppoe-server exists
    try {
      await execPromise('which pppoe-server');
    } catch (e) {
      throw new Error('pppoe-server binary not found. Please install it with: sudo apt update && sudo apt install rp-pppoe');
    }
    
    // 6. Start pppoe-server daemon with the exact command structure requested by user
    const serviceNameArg = service_name ? `-S "${service_name}" -C "${service_name}"` : '';
    // We keep nohup and background execution for app stability
    // Using range format for -R and maximum sessions -N 253 as requested
    const poolEnd = ip_pool_end || '254';
    const cmd = `nohup pppoe-server -I ${targetIface} -L ${local_ip} -R ${ip_pool_start}-${poolEnd} -N 253 ${serviceNameArg} -O ${optionsPath} >> /var/log/pppoe-server.log 2>&1 &`;
    
    console.log(`[PPPoE-Server] Executing Dynamic Command: ${cmd}`);
    await execPromise(cmd);
    
    // Start tailing logs to terminal
    startLogTailing();
    
    // Wait for server to initialize
    await new Promise(r => setTimeout(r, 2000));
    
    // Check logs for immediate errors
    try {
      if (fs.existsSync('/var/log/pppoe-server.log')) {
        const pppoeLogs = fs.readFileSync('/var/log/pppoe-server.log', 'utf8').split('\n').slice(-10).join('\n');
        console.log(`[PPPoE-Server] Recent pppoe-server logs:\n${pppoeLogs}`);
      }
    } catch (e) {}
    
    // 7. Verify server is running
    const isRunning = await isPPPoEServerRunning();
    
    if (isRunning) {
      console.log(`[PPPoE-Server] Server started successfully on ${targetIface}`);
      
      // 8. Re-initialize Firewall to include ppp+ rules
      await initFirewall();
      
      // 9. Save to database
      await db.run(
        'INSERT OR REPLACE INTO pppoe_server (interface, local_ip, ip_pool_start, ip_pool_end, dns1, dns2, service_name, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [targetIface, local_ip, ip_pool_start, ip_pool_end, dns1, dns2, service_name]
      );
      
      return { success: true, message: `PPPoE Server started on ${targetIface}` };
    } else {
      // Diagnostics: Why did it fail?
      let diagnosis = 'Unknown error';
      try {
        const { stdout: whereIs } = await execPromise('which pppoe-server').catch(() => ({ stdout: '' }));
        if (!whereIs.trim()) {
          diagnosis = 'pppoe-server binary not found. Please install rp-pppoe (sudo apt install rp-pppoe)';
        } else {
          // Check if interface exists
          const { stdout: ifaceCheck } = await execPromise(`ip link show ${targetIface}`).catch(() => ({ stdout: '' }));
          if (!ifaceCheck.trim()) {
            diagnosis = `Interface ${targetIface} does not exist`;
          } else {
            // Read last few lines of log
            if (fs.existsSync('/var/log/pppoe-server.log')) {
              const logs = fs.readFileSync('/var/log/pppoe-server.log', 'utf8').trim();
              diagnosis = logs.split('\n').slice(-5).join('\n') || 'Server exited immediately with no log output';
            }
          }
        }
      } catch (diagErr) {
        diagnosis = `Diagnostic failed: ${diagErr.message}`;
      }
      
      throw new Error(`PPPoE Server failed to start: ${diagnosis}`);
    }
    
  } catch (e) {
    console.error(`[PPPoE-Server] Start failed:`, e.message);
    throw e;
  }
}

async function stopPPPoEServer(iface) {
  let targetIface = iface;
  if (!targetIface) {
    try {
      const active = await db.get('SELECT * FROM pppoe_server WHERE enabled = 1 LIMIT 1');
      targetIface = active?.interface || '';
    } catch (e) {}
  }

  if (targetIface) {
    try {
      const { stdout: linkJson } = await execPromise(`ip -j link show ${targetIface}`);
      const linkInfo = JSON.parse(linkJson)[0];
      if (linkInfo && linkInfo.master) targetIface = linkInfo.master;
    } catch (e) {}
  }

  console.log(`[PPPoE-Server] Stopping PPPoE server on ${targetIface || iface || 'unknown'}...`);
  
  try {
    // Kill pppoe-server and all pppd child processes forcefully
    await execPromise(`killall -9 pppoe-server`).catch(() => {});
    await execPromise(`killall -9 pppd`).catch(() => {});
    await execPromise(`pkill -9 pppoe-server`).catch(() => {});
    await execPromise(`pkill -9 pppd`).catch(() => {});
    
    // Clean up any stale PID or lock files
    await execPromise(`rm -f /var/run/ppp*.pid /var/run/pppoe-server.pid /var/lock/LCK..*`).catch(() => {});
    
    // Wait for kernel to release interfaces
    await new Promise(r => setTimeout(r, 1000));
    
    // Update database
    await db.run('UPDATE pppoe_server SET enabled = 0');
    
    console.log(`[PPPoE-Server] Server stopped`);
    return { success: true };
    
  } catch (e) {
    console.error(`[PPPoE-Server] Stop error:`, e.message);
    return { success: false, error: e.message };
  }
}

async function isPPPoEServerRunning() {
  try {
    // Try pgrep first
    try {
      const { stdout } = await execPromise('pgrep pppoe-server');
      if (stdout.trim().length > 0) return true;
    } catch (e) {}

    // Fallback to ps
    const { stdout: psOut } = await execPromise('ps aux');
    return psOut.includes('pppoe-server');
  } catch (e) {
    return false;
  }
}

async function getPPPoEServerStatus() {
  try {
    let config = await db.get('SELECT * FROM pppoe_server WHERE enabled = 1 LIMIT 1');
    if (!config) config = await db.get('SELECT * FROM pppoe_server LIMIT 1');
    const running = await isPPPoEServerRunning();
    
    if (!running && (!config || config.enabled === 0)) {
      return {
        running: false,
        message: 'PPPoE server is not running'
      };
    }
    
    // Get active sessions
    const sessions = await getPPPoESessions();
    
    return {
      running: running,
      config: config || { interface: 'unknown', enabled: 0 },
      sessions,
      total_users: sessions.length,
      message: running ? 'Server is operational' : 'Server is configured but offline'
    };
    
  } catch (e) {
    console.error(`[PPPoE-Server] Status check error:`, e.message);
    return {
      running: false,
      error: e.message
    };
  }
}

async function getPPPoESessions() {
  try {
    // Parse active PPP connections from /var/run/pppd*.pid or /etc/ppp/
    const sessions = [];

    const getIfaceUserMapFromLog = () => {
      try {
        const logPath = `/var/log/pppd.log`;
        if (!fs.existsSync(logPath)) return new Map();
        const raw = fs.readFileSync(logPath, 'utf8');
        const lines = raw.split('\n');
        const map = new Map();
        let currentIface = '';
        for (const line of lines) {
          if (!line) continue;
          const ifaceMatch = line.match(/\bUsing interface (ppp\d+)\b/i) || line.match(/\bConnect:\s*(ppp\d+)\b/i);
          if (ifaceMatch && ifaceMatch[1]) {
            currentIface = ifaceMatch[1];
            continue;
          }
          const chap = line.match(/\bCHAP Response\b[\s\S]*?\bname\s*=\s*["']?([^"']+)["']?/i);
          if (chap && chap[1] && currentIface) {
            map.set(currentIface, String(chap[1]).trim());
          }
        }
        return map;
      } catch (e) {
        return new Map();
      }
    };

    const ifaceToUser = getIfaceUserMapFromLog();

    const getIfaceRemoteIpMapFromLog = () => {
      try {
        const logPath = `/var/log/pppd.log`;
        if (!fs.existsSync(logPath)) return new Map();
        const raw = fs.readFileSync(logPath, 'utf8');
        const lines = raw.split('\n');
        const map = new Map();
        let currentIface = '';
        for (const line of lines) {
          if (!line) continue;
          const ifaceMatch = line.match(/\bUsing interface (ppp\d+)\b/i) || line.match(/\bConnect:\s*(ppp\d+)\b/i);
          if (ifaceMatch && ifaceMatch[1]) {
            currentIface = ifaceMatch[1];
            continue;
          }
          const remote = line.match(/\bremote IP address\s+(\d{1,3}(?:\.\d{1,3}){3})\b/i);
          if (remote && remote[1] && currentIface) {
            map.set(currentIface, remote[1]);
          }
        }
        return map;
      } catch (e) {
        return new Map();
      }
    };

    const ifaceToRemoteIp = getIfaceRemoteIpMapFromLog();
    
    // Method 1: Check for ppp interfaces
    const { stdout } = await execPromise('ip -j addr show');
    const interfaces = JSON.parse(stdout);
    const pppInterfaces = interfaces.filter(i => i.ifname && i.ifname.startsWith('ppp'));
    
    for (const pppIface of pppInterfaces) {
      const ifname = pppIface.ifname;
      const addr = (pppIface.addr_info || []).find(a => a.family === 'inet');
      let ip = ifaceToRemoteIp.get(ifname) || (addr?.peer || addr?.local) || 'N/A';
      
      const username = ifaceToUser.get(ifname) || 'Unknown';
      if (ip === 'N/A' || ip === addr?.local) {
        try {
          const { stdout: text } = await execPromise(`ip addr show dev ${ifname}`).catch(() => ({ stdout: '' }));
          const peerMatch = String(text || '').match(/\bpeer\s+(\d{1,3}(?:\.\d{1,3}){3})\b/i);
          if (peerMatch && peerMatch[1]) ip = peerMatch[1];
        } catch (e) {}
      }
      
      // Get statistics
      let rx_bytes = 0, tx_bytes = 0;
      try {
        rx_bytes = parseInt(fs.readFileSync(`/sys/class/net/${ifname}/statistics/rx_bytes`, 'utf8').trim());
        tx_bytes = parseInt(fs.readFileSync(`/sys/class/net/${ifname}/statistics/tx_bytes`, 'utf8').trim());
      } catch (e) {}
      
      sessions.push({
        username,
        ip,
        interface: ifname,
        uptime: 0, // TODO: Calculate from connection time
        rx_bytes,
        tx_bytes
      });
    }
    
    return sessions;
    
  } catch (e) {
    console.error(`[PPPoE-Server] Error getting sessions:`, e.message);
    return [];
  }
}

async function syncPPPoESecrets() {
  console.log('[PPPoE-Server] Syncing PAP and CHAP secrets...');
  try {
    const users = await db.all('SELECT id, username, password, ip_address, expires_at FROM pppoe_users WHERE enabled = 1');
    const papSecretsPath = '/etc/ppp/pap-secrets';
    const chapSecretsPath = '/etc/ppp/chap-secrets';
    
    const { pool } = await getPPPoEExpiredSettings();
    const poolStartInt = pool?.ip_pool_start ? ipToInt(String(pool.ip_pool_start).trim()) : null;
    const poolEndInt = pool?.ip_pool_end ? ipToInt(String(pool.ip_pool_end).trim()) : null;

    const isInExpiredPool = (ip) => {
      if (poolStartInt === null || poolEndInt === null) return false;
      const n = ipToInt(ip);
      if (n === null) return false;
      return n >= Math.min(poolStartInt, poolEndInt) && n <= Math.max(poolStartInt, poolEndInt);
    };

    const usedIps = new Set(
      users
        .map(u => String(u.ip_address || '').trim())
        .filter(ip => ip && isValidIp(ip))
    );

    const allocateExpiredIp = async () => {
      if (poolStartInt === null || poolEndInt === null) return null;
      const start = Math.min(poolStartInt, poolEndInt);
      const end = Math.max(poolStartInt, poolEndInt);
      for (let i = start; i <= end; i++) {
        const ip = intToIp(i);
        if (!usedIps.has(ip)) {
          usedIps.add(ip);
          return ip;
        }
      }
      return null;
    };

    let content = '# AJC PisoWiFi PPPoE Secrets\n';
    content += '# client\tserver\tsecret\t\tIP addresses\n';
    
    for (const user of users) {
      const username = String(user.username || '').trim();
      const password = String(user.password || '');
      if (!username) continue;

      let ipField = '*';
      const expiresAt = normalizeExpiresAt(user.expires_at);
      const isExpired = expiresAt
        ? !!(await db.get("SELECT 1 as ok WHERE datetime(?) <= datetime('now','localtime')", [expiresAt]).catch(() => null))
        : false;

      if (isExpired && poolStartInt !== null && poolEndInt !== null) {
        const currentIp = String(user.ip_address || '').trim();
        let assigned = (currentIp && isValidIp(currentIp) && isInExpiredPool(currentIp)) ? currentIp : null;
        if (!assigned) assigned = await allocateExpiredIp();
        if (assigned) {
          ipField = assigned;
          if (assigned !== currentIp) {
            await db.run('UPDATE pppoe_users SET ip_address = ? WHERE id = ?', [assigned, user.id]).catch(() => {});
          }
        }
      } else {
        const staticIp = String(user.ip_address || '').trim();
        if (staticIp && isValidIp(staticIp) && !isInExpiredPool(staticIp)) {
          ipField = staticIp;
        } else if (staticIp && isValidIp(staticIp) && isInExpiredPool(staticIp)) {
          await db.run('UPDATE pppoe_users SET ip_address = NULL WHERE id = ?', [user.id]).catch(() => {});
          ipField = '*';
        }
      }

      // Format: "username" * "password" *
      content += `"${username}"\t*\t"${password}"\t${ipField}\n`;
    }
    
    fs.writeFileSync(papSecretsPath, content);
    fs.writeFileSync(chapSecretsPath, content);
    
    await execPromise(`chmod 600 ${papSecretsPath}`).catch(() => {});
    await execPromise(`chmod 600 ${chapSecretsPath}`).catch(() => {});
    
    console.log(`[PPPoE-Server] Synced ${users.length} users to secrets files`);
  } catch (e) {
    console.error('[PPPoE-Server] Sync secrets error:', e.message);
  }
}

function normalizeExpiresAt(expires_at) {
  if (expires_at === null || expires_at === undefined) return null;
  const s = String(expires_at).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 23:59:59`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s.replace('T', ' ')}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return s.replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s;
}

async function addPPPoEUser(username, password, billing_profile_id = null, expires_at = null, info = {}) {
  console.log(`[PPPoE-Server] Adding user: ${username}`);
  
  try {
    // 1. Add to database
    const full_name = info?.full_name ?? null;
    const address = info?.address ?? null;
    const contact_number = info?.contact_number ?? null;
    const email = info?.email ?? null;
    const result = await db.run(
      'INSERT INTO pppoe_users (username, password, enabled, billing_profile_id, expires_at, full_name, address, contact_number, email) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)',
      [username, password, billing_profile_id, normalizeExpiresAt(expires_at), full_name, address, contact_number, email]
    );
    
    // 1b. Generate account number based on user ID
    if (result && typeof result.lastID === 'number') {
      const accountNumber = `PP${String(result.lastID).padStart(6, '0')}`;
      await db.run('UPDATE pppoe_users SET account_number = ? WHERE id = ?', [accountNumber, result.lastID]);
      await syncPPPoESecrets();
      return { success: true, id: result.lastID, account_number: accountNumber };
    }
    
    // 2. Sync to system secrets files
    await syncPPPoESecrets();
    
    return { success: true };
  } catch (e) {
    console.error(`[PPPoE-Server] Error adding user:`, e.message);
    throw e;
  }
}

async function deletePPPoEUser(userId) {
  console.log(`[PPPoE-Server] Deleting user ID: ${userId}`);
  
  try {
    // 1. Remove from database
    await db.run('DELETE FROM pppoe_users WHERE id = ?', [userId]);
    
    // 2. Sync to system secrets files
    await syncPPPoESecrets();
    
    return { success: true };
  } catch (e) {
    console.error(`[PPPoE-Server] Error deleting user:`, e.message);
    throw e;
  }
}

async function getPPPoEUsers() {
  try {
    const users = await db.all('SELECT * FROM pppoe_users ORDER BY created_at DESC');
    return users;
  } catch (e) {
    console.error(`[PPPoE-Server] Error getting users:`, e.message);
    return [];
  }
}

async function updatePPPoEUser(userId, updates) {
  try {
    const { username, password, enabled, billing_profile_id, expires_at, full_name, address, contact_number, email } = updates;
    
    // Get current user
    const currentUser = await db.get('SELECT * FROM pppoe_users WHERE id = ?', [userId]);
    if (!currentUser) throw new Error('User not found');
    
    // Update database
    const fields = [];
    const values = [];
    
    if (username !== undefined) { fields.push('username = ?'); values.push(username); }
    if (password !== undefined) { fields.push('password = ?'); values.push(password); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled); }
    if (billing_profile_id !== undefined) { fields.push('billing_profile_id = ?'); values.push(billing_profile_id); }
    if (expires_at !== undefined) { fields.push('expires_at = ?'); values.push(normalizeExpiresAt(expires_at)); }
    if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name ? String(full_name) : null); }
    if (address !== undefined) { fields.push('address = ?'); values.push(address ? String(address) : null); }
    if (contact_number !== undefined) { fields.push('contact_number = ?'); values.push(contact_number ? String(contact_number) : null); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email ? String(email) : null); }
    
    if (fields.length > 0) {
      values.push(userId);
      await db.run(`UPDATE pppoe_users SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (expires_at !== undefined) {
      const normalized = normalizeExpiresAt(expires_at);
      const stillExpired = normalized
        ? !!(await db.get("SELECT 1 as ok WHERE datetime(?) <= datetime('now','localtime')", [normalized]).catch(() => null))
        : false;

      if (!stillExpired) {
        await db.run('UPDATE pppoe_users SET expired_at = NULL WHERE id = ?', [userId]).catch(() => {});
        try {
          const { pool } = await getPPPoEExpiredSettings();
          if (pool && pool.ip_pool_start && pool.ip_pool_end) {
            const a = ipToInt(String(pool.ip_pool_start).trim());
            const b = ipToInt(String(pool.ip_pool_end).trim());
            const updatedUser = await db.get('SELECT ip_address FROM pppoe_users WHERE id = ?', [userId]).catch(() => null);
            const ip = String(updatedUser?.ip_address || currentUser.ip_address || '').trim();
            const n = ipToInt(ip);
            if (a !== null && b !== null && n !== null) {
              const lo = Math.min(a, b);
              const hi = Math.max(a, b);
              if (n >= lo && n <= hi) {
                await db.run('UPDATE pppoe_users SET ip_address = NULL WHERE id = ?', [userId]).catch(() => {});
              }
            }
          }
        } catch (e) {}
      }
    }
    
    // Sync to system secrets files
    await syncPPPoESecrets();
    
    return { success: true };
  } catch (e) {
    console.error(`[PPPoE-Server] Error updating user:`, e.message);
    throw e;
  }
}

async function disconnectPPPoEUser(username) {
  const user = String(username || '').trim();
  if (!user) return { success: false, error: 'Username required' };
  try {
    console.log(`[PPPoE-KICK] Request kick for user="${user}"`);

    const getIfaceUserMapFromLog = () => {
      try {
        const logPath = `/var/log/pppd.log`;
        if (!fs.existsSync(logPath)) return new Map();
        const raw = fs.readFileSync(logPath, 'utf8');
        const lines = raw.split('\n');
        const map = new Map();
        let currentIface = '';
        for (const line of lines) {
          if (!line) continue;
          const ifaceMatch = line.match(/\bUsing interface (ppp\d+)\b/i) || line.match(/\bConnect:\s*(ppp\d+)\b/i);
          if (ifaceMatch && ifaceMatch[1]) {
            currentIface = ifaceMatch[1];
            continue;
          }
          const chap = line.match(/\bCHAP Response\b[\s\S]*?\bname\s*=\s*["']?([^"']+)["']?/i);
          if (chap && chap[1] && currentIface) {
            map.set(currentIface, String(chap[1]).trim());
          }
        }
        return map;
      } catch (e) {
        return new Map();
      }
    };

    const ifaceToUser = getIfaceUserMapFromLog();
    const ifacesForUser = [];
    for (const [iface, u] of ifaceToUser.entries()) {
      if (String(u).trim().toLowerCase() === user.toLowerCase()) ifacesForUser.push(iface);
    }
    if (ifacesForUser.length) {
      console.log(`[PPPoE-KICK] Interfaces for user="${user}" from log: ${ifacesForUser.join(', ')}`);
    }

    const getPppIfacePidMap = () => {
      const results = [];
      const scan = (dir) => {
        try {
          if (!fs.existsSync(dir)) return;
          const files = fs.readdirSync(dir).filter(f => /^ppp\d+\.pid$/.test(f));
          for (const f of files) {
            const iface = f.replace(/\.pid$/, '');
            const pidStr = fs.readFileSync(path.join(dir, f), 'utf8').trim();
            const pid = parseInt(pidStr, 10);
            if (!pid || Number.isNaN(pid)) continue;
            results.push({ iface, pid });
          }
        } catch (e) {}
      };
      scan('/var/run');
      scan('/run');
      return results;
    };

    const getUsernameForPidFromLog = async (pid) => {
      try {
        const logPath = '/var/log/pppd.log';
        if (!fs.existsSync(logPath)) return null;
        const { stdout } = await execPromise(`tail -n 400 ${logPath}`).catch(() => ({ stdout: '' }));
        const lines = String(stdout || '').split('\n');
        const pidRe = new RegExp(`\\bpppd\\[${pid}\\]`, 'i');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line) continue;
          if (!pidRe.test(line)) continue;
          const m = line.match(/\buser[=\s]+["']?([^"'\s\]]+)["']?/i);
          if (m && m[1]) return m[1];
        }
        return null;
      } catch (e) {
        return null;
      }
    };

    let ipFromDb = '';
    try {
      const row = await db.get('SELECT ip_address FROM pppoe_users WHERE username = ? ORDER BY id DESC LIMIT 1', [user]).catch(() => null);
      ipFromDb = row?.ip_address ? String(row.ip_address).trim() : '';
    } catch (e) {}
    console.log(`[PPPoE-KICK] DB ip_address for user="${user}": ${ipFromDb || '(none)'}`);

    let ifaceByIp = '';
    if (ipFromDb && isValidIp(ipFromDb)) {
      try {
        const { stdout } = await execPromise('ip -j addr show').catch(() => ({ stdout: '' }));
        const interfaces = JSON.parse(stdout || '[]');
        for (const it of interfaces) {
          const ifname = it?.ifname || it?.name;
          if (!ifname || !String(ifname).startsWith('ppp')) continue;
          const addr = (it.addr_info || []).find(a => a.family === 'inet');
          const peer = addr?.peer;
          const local = addr?.local;
          if (peer === ipFromDb || local === ipFromDb) {
            ifaceByIp = String(ifname);
            break;
          }
        }
      } catch (e) {}
    }
    console.log(`[PPPoE-KICK] iface detected via DB IP for user="${user}": ${ifaceByIp || '(none)'}`);

    const killedPids = [];
    for (const ifn of ifacesForUser) {
      await execPromise(`ip link set dev ${ifn} down`).catch(() => {});
      const pidCandidates = [`/var/run/${ifn}.pid`, `/run/${ifn}.pid`];
      for (const pidPath of pidCandidates) {
        try {
          if (!fs.existsSync(pidPath)) continue;
          const pidStr = fs.readFileSync(pidPath, 'utf8').trim();
          const pid = parseInt(pidStr, 10);
          if (!pid || Number.isNaN(pid)) continue;
          await execPromise(`kill -9 ${pid}`).catch(() => {});
          killedPids.push(pid);
          console.log(`[PPPoE-KICK] Killed pid from ${pidPath}: ${pid}`);
          break;
        } catch (e) {}
      }
    }

    let iface = '';
    if (!iface && ifaceByIp) {
      iface = ifaceByIp;
      console.log(`[PPPoE-KICK] Detected iface for user="${user}" via DB IP ${ipFromDb}: ${iface}`);
    }

    if (iface && !ifacesForUser.length) {
      console.log(`[PPPoE-KICK] Detected iface for user="${user}": ${iface}`);

      try {
        await execPromise(`ip link set dev ${iface} down`).catch(() => {});
      } catch (e) {}

      const pidFileCandidates = [
        `/var/run/${iface}.pid`,
        `/run/${iface}.pid`,
        `/var/run/ppp${iface.replace(/^ppp/, '')}.pid`,
        `/run/ppp${iface.replace(/^ppp/, '')}.pid`
      ];

      for (const pidPath of pidFileCandidates) {
        try {
          if (!fs.existsSync(pidPath)) continue;
          const pidStr = fs.readFileSync(pidPath, 'utf8').trim();
          const pid = parseInt(pidStr, 10);
          if (!pid || Number.isNaN(pid)) continue;
          await execPromise(`kill -9 ${pid}`).catch(() => {});
          killedPids.push(pid);
          console.log(`[PPPoE-KICK] Killed pid from ${pidPath}: ${pid}`);
          break;
        } catch (e) {}
      }

      if (!killedPids.length) {
        try {
          const { stdout } = await execPromise('ps -eo pid,args').catch(() => ({ stdout: '' }));
          const lines = String(stdout || '').split('\n');
          for (const line of lines) {
            if (!line || !line.includes('pppd')) continue;
            if (!line.includes(iface) && !new RegExp(`\\bifname\\s+${iface}\\b`).test(line)) continue;
            const m = line.trim().match(/^(\d+)\s+/);
            if (m) {
              const pid = parseInt(m[1], 10);
              if (pid && !Number.isNaN(pid)) killedPids.push(pid);
            }
          }
          if (killedPids.length) {
            console.log(`[PPPoE-KICK] Matched pids by iface=${iface}: ${killedPids.join(', ')}`);
            for (const pid of killedPids) await execPromise(`kill -9 ${pid}`).catch(() => {});
          }
        } catch (e) {}
      }
    }

    const { stdout } = await execPromise('ps -eo pid,args').catch(() => ({ stdout: '' }));
    const lines = String(stdout || '').split('\n');
    const pids = [];
    const re = new RegExp(`\\bpppd\\b[\\s\\S]*\\buser\\s+['"]?${user.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]?\\b`, 'i');
    for (const line of lines) {
      if (!line || !line.includes('pppd')) continue;
      if (!re.test(line)) continue;
      const m = line.trim().match(/^(\d+)\s+/);
      if (m) pids.push(parseInt(m[1], 10));
    }
    if (!pids.length) {
      console.log(`[PPPoE-KICK] No matching pppd process found for user="${user}"`);
    } else {
      console.log(`[PPPoE-KICK] Matched pids for user="${user}": ${pids.join(', ')}`);
    }
    for (const pid of pids) {
      await execPromise(`kill -9 ${pid}`).catch(() => {});
    }
    const all = Array.from(new Set([...killedPids, ...pids]));
    console.log(`[PPPoE-KICK] Completed kick for user="${user}" (disconnected=${all.length})`);
    return { success: true, disconnected: all.length, pids: all, iface: iface || null };
  } catch (e) {
    console.error(`[PPPoE-KICK] Kick failed for user="${user}":`, e.message);
    return { success: false, error: e.message };
  }
}

async function getActivePPPoEUsernames() {
  try {
    const { stdout } = await execPromise('ps -eo args').catch(() => ({ stdout: '' }));
    const lines = String(stdout || '').split('\n');
    const users = new Set();
    for (const line of lines) {
      if (!line || !line.includes('pppd')) continue;
      const m = line.match(/\bpppd\b[\s\S]*?\buser\s+['"]?([^'"\s]+)['"]?/i);
      if (m && m[1]) users.add(m[1]);
    }
    return Array.from(users);
  } catch (e) {
    return [];
  }
}

async function clearPPPoERateLimit(iface) {
  const dev = String(iface || '').trim();
  if (!dev || !dev.startsWith('ppp')) return { success: false, error: 'Invalid interface' };
  await execPromise(`tc qdisc del dev ${dev} root 2>/dev/null || true`).catch(() => {});
  await execPromise(`tc qdisc del dev ${dev} ingress 2>/dev/null || true`).catch(() => {});
  await execPromise(`tc qdisc del dev ${dev} handle ffff: ingress 2>/dev/null || true`).catch(() => {});
  return { success: true };
}

async function applyPPPoERateLimit(iface, downloadMbps, uploadMbps) {
  const dev = String(iface || '').trim();
  if (!dev || !dev.startsWith('ppp')) return { success: false, error: 'Invalid interface' };

  const dl = Number(downloadMbps || 0);
  const ul = Number(uploadMbps || 0);
  const dlKbit = dl > 0 ? Math.max(1, Math.floor(dl * 1000)) : 0;
  const ulKbit = ul > 0 ? Math.max(1, Math.floor(ul * 1000)) : 0;

  if (!dlKbit && !ulKbit) {
    await clearPPPoERateLimit(dev).catch(() => {});
    return { success: true, cleared: true };
  }

  try {
    if (dlKbit) {
      await execPromise(`tc qdisc replace dev ${dev} root tbf rate ${dlKbit}kbit burst 32k latency 400ms`).catch(() => {});
    } else {
      await execPromise(`tc qdisc del dev ${dev} root 2>/dev/null || true`).catch(() => {});
    }

    if (ulKbit) {
      await execPromise(`tc qdisc replace dev ${dev} handle ffff: ingress`).catch(() => {});
      await execPromise(`tc filter replace dev ${dev} parent ffff: protocol ip u32 match u32 0 0 police rate ${ulKbit}kbit burst 32k drop flowid :1`).catch(() => {});
    } else {
      await execPromise(`tc qdisc del dev ${dev} ingress 2>/dev/null || true`).catch(() => {});
      await execPromise(`tc qdisc del dev ${dev} handle ffff: ingress 2>/dev/null || true`).catch(() => {});
    }

    console.log(`[PPPoE-QOS] Applied rate limit on ${dev} DL=${dlKbit || 0}kbit UL=${ulKbit || 0}kbit`);
    return { success: true, dl_kbit: dlKbit, ul_kbit: ulKbit };
  } catch (e) {
    console.error(`[PPPoE-QOS] Failed to apply rate limit on ${dev}:`, e.message);
    return { success: false, error: e.message };
  }
}

// ============================================
// WAN INTERFACE CONFIGURATION
// ============================================

async function configureWanDhcp(iface, isVlan = false) {
  const dev = String(iface || '').trim();
  if (!dev) return { success: false, error: 'Interface name required' };
  try {
    // Flush existing IP
    await execPromise(`ip addr flush dev ${dev}`).catch(() => {});
    // Bring interface up
    await execPromise(`ip link set dev ${dev} up`).catch(() => {});
    // For VLAN interfaces, wait briefly for link to settle before starting DHCP
    if (isVlan) {
      await new Promise(r => setTimeout(r, 1500));
    }
    // Kill any existing DHCP clients for this interface
    await execPromise(`pkill -f "dhclient.*${dev}"`).catch(() => {});
    await execPromise(`pkill -f "dhcpcd.*${dev}"`).catch(() => {});
    // Try dhcpcd first, fallback to dhclient
    try {
      await execPromise(`dhcpcd -b ${dev}`);
    } catch (e) {
      await execPromise(`dhclient -v ${dev}`).catch(() => {});
    }

    // Wait for DHCP lease to be acquired (up to 10 seconds)
    let acquiredIp = null;
    let acquiredGw = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 1000));
      const status = await getWanStatus(dev);
      if (status.status === 'up' && status.ip) {
        acquiredIp = status.ip;
        acquiredGw = await getWanGateway(dev);
        console.log(`[WAN] DHCP acquired on ${dev}: IP=${acquiredIp}, GW=${acquiredGw || 'none'}`);
        break;
      }
    }

    if (!acquiredIp) {
      console.warn(`[WAN] DHCP on ${dev} did not acquire IP within 10s — interface is up but may need more time`);
    }

    return { success: true, ip: acquiredIp, gateway: acquiredGw };
  } catch (e) {
    console.error(`[WAN] DHCP config failed on ${dev}:`, e.message);
    return { success: false, error: e.message };
  }
}

async function configureWanStatic(iface, config) {
  const dev = String(iface || '').trim();
  if (!dev) return { success: false, error: 'Interface name required' };
  const { ipaddr, netmask, gateway, dns = [] } = config || {};
  if (!ipaddr || !netmask) return { success: false, error: 'IP address and netmask required' };

  try {
    // Flush existing IP
    await execPromise(`ip addr flush dev ${dev}`).catch(() => {});
    // Bring interface up
    await execPromise(`ip link set dev ${dev} up`).catch(() => {});
    // Assign static IP
    await execPromise(`ip addr add ${ipaddr}/${netmask} dev ${dev}`);
    // Set gateway if provided
    if (gateway) {
      await execPromise(`ip route del default dev ${dev} 2>/dev/null || true`).catch(() => {});
      await execPromise(`ip route add default via ${gateway} dev ${dev} metric ${config.metric || 100}`).catch(() => {});
    }
    // Update resolv.conf with DNS if provided
    if (dns.length > 0) {
      const dnsEntries = dns.map(d => `nameserver ${d}`).join('\n');
      await execPromise(`echo "${dnsEntries}" > /etc/resolv.conf.d/${dev}.conf`).catch(() => {});
    }
    console.log(`[WAN] Static IP configured on ${dev}: ${ipaddr}/${netmask}`);
    return { success: true };
  } catch (e) {
    console.error(`[WAN] Static config failed on ${dev}:`, e.message);
    return { success: false, error: e.message };
  }
}

async function configureWanPppoe(iface, config) {
  const dev = String(iface || '').trim();
  if (!dev) return { success: false, error: 'Interface name required' };
  const { username, password } = config || {};
  if (!username || !password) return { success: false, error: 'PPPoE username and password required' };

  try {
    // Create PPPoE peer config
    const peerDir = '/etc/ppp/peers';
    await execPromise(`mkdir -p ${peerDir}`).catch(() => {});
    const peerConfig = [
      `plugin rp-pppoe.so ${dev}`,
      `user "${username}"`,
      'usepeerdns',
      'defaultroute',
      'persist',
      'noauth',
      'hide-password',
      'lcp-echo-interval 20',
      'lcp-echo-failure 3',
      `metric ${config.metric || 100}`
    ].join('\n');
    fs.writeFileSync(`${peerDir}/ajc_wan_${dev}`, peerConfig);

    // Update chap-secrets and pap-secrets
    const secretLine = `"${username}" * "${password}" *`;
    for (const secretFile of ['/etc/ppp/chap-secrets', '/etc/ppp/pap-secrets']) {
      let existing = '';
      try { existing = fs.readFileSync(secretFile, 'utf8'); } catch (e) {}
      if (!existing.includes(username)) {
        fs.writeFileSync(secretFile, existing + '\n' + secretLine + '\n');
      }
    }

    // Start PPPoE connection
    await execPromise(`poff ajc_wan_${dev}`).catch(() => {});
    await execPromise(`pon ajc_wan_${dev}`).catch(() => {});

    console.log(`[WAN] PPPoE configured on ${dev} for user ${username}`);
    return { success: true };
  } catch (e) {
    console.error(`[WAN] PPPoE config failed on ${dev}:`, e.message);
    return { success: false, error: e.message };
  }
}

async function getWanStatus(iface) {
  const dev = String(iface || '').trim();
  if (!dev) return { status: 'down', ip: null };
  try {
    const { stdout } = await execPromise(`ip -j addr show dev ${dev}`);
    const addrs = JSON.parse(stdout || '[]');
    if (addrs.length === 0) return { status: 'down', ip: null };
    const info = addrs[0];
    const isUp = info.operstate === 'UP' || info.flags?.includes('UP');
    const ipv4 = info.addr_info?.find(a => a.family === 'inet');
    return {
      status: isUp ? 'up' : 'down',
      ip: ipv4 ? ipv4.local : null
    };
  } catch (e) {
    return { status: 'down', ip: null };
  }
}

async function getWanSpeed(iface) {
  const dev = String(iface || '').trim();
  if (!dev) return { ping_ms: null, speed_mbps: null };

  let pingMs = null;
  let speedMbps = null;

  // 1. Ping latency via specific interface
  try {
    const { stdout } = await execPromise(`ping -I ${dev} -c 1 -W 3 8.8.8.8`);
    const match = stdout.match(/time=([\d.]+)\s*ms/);
    if (match) pingMs = parseFloat(match[1]);
  } catch (e) {
    // No ping response
  }

  // 2. Quick download speed test (up to 5 seconds)
  try {
    const { stdout } = await execPromise(
      `curl -o /dev/null --max-time 5 -w '%{speed_download}' --interface ${dev} -s http://speedtest.tele2.net/1MB.zip`
    );
    const bytesPerSec = parseFloat(stdout);
    if (Number.isFinite(bytesPerSec) && bytesPerSec > 0) {
      speedMbps = parseFloat((bytesPerSec * 8 / 1000000).toFixed(2));
    }
  } catch (e) {
    // Speed test failed
  }

  return { ping_ms: pingMs, speed_mbps: speedMbps };
}

// Resolve the current gateway for a WAN interface from the OS routing table
async function getWanGateway(iface) {
  const dev = String(iface || '').trim();
  if (!dev) return null;
  try {
    const { stdout } = await execPromise(`ip route show dev ${dev}`);
    // Match lines like "default via 192.168.1.1" or just any route with a gateway
    const defaultMatch = stdout.match(/default\s+via\s+([\d.]+)/);
    if (defaultMatch) return defaultMatch[1];
    // Fallback: look for any "via" in the routes for this device
    const viaMatch = stdout.match(/via\s+([\d.]+)/);
    return viaMatch ? viaMatch[1] : null;
  } catch (e) {
    return null;
  }
}

// Add NAT masquerade and FORWARD rules for a WAN interface
async function addWanFirewallRules(iface) {
  const dev = String(iface || '').trim();
  if (!dev) return;
  try {
    // NAT masquerade — critical for internet access through this WAN
    await execPromise(`iptables -t nat -C POSTROUTING -o ${dev} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o ${dev} -j MASQUERADE`).catch(() => {});
    // Allow forwarded traffic from LAN to this WAN
    await execPromise(`iptables -C FORWARD -o ${dev} -j ACCEPT 2>/dev/null || iptables -A FORWARD -o ${dev} -j ACCEPT`).catch(() => {});
    console.log(`[WAN] Firewall rules added for ${dev}`);
  } catch (e) {
    console.error(`[WAN] Failed to add firewall rules for ${dev}:`, e.message);
  }
}

// Remove NAT masquerade and FORWARD rules for a WAN interface
async function removeWanFirewallRules(iface) {
  const dev = String(iface || '').trim();
  if (!dev) return;
  try {
    // Remove NAT masquerade
    await execPromise(`iptables -t nat -D POSTROUTING -o ${dev} -j MASQUERADE 2>/dev/null`).catch(() => {});
    // Remove FORWARD accept rule
    await execPromise(`iptables -D FORWARD -o ${dev} -j ACCEPT 2>/dev/null`).catch(() => {});
    console.log(`[WAN] Firewall rules removed for ${dev}`);
  } catch (e) {
    // Silently ignore — rules may not exist
  }
}

async function removeWanConfig(iface) {
  const dev = String(iface || '').trim();
  if (!dev) return { success: false, error: 'Interface name required' };
  try {
    // Remove firewall rules for this WAN
    await removeWanFirewallRules(dev);
    // Kill DHCP clients
    await execPromise(`pkill -f "dhclient.*${dev}"`).catch(() => {});
    await execPromise(`pkill -f "dhcpcd.*${dev}"`).catch(() => {});
    // Stop PPPoE if exists
    await execPromise(`poff ajc_wan_${dev}`).catch(() => {});
    // Remove peer config
    try { fs.unlinkSync(`/etc/ppp/peers/ajc_wan_${dev}`); } catch (e) {}
    // Remove default route through this interface
    await execPromise(`ip route del default dev ${dev} 2>/dev/null || true`).catch(() => {});
    // Flush IP
    await execPromise(`ip addr flush dev ${dev}`).catch(() => {});
    console.log(`[WAN] Removed config from ${dev}`);
    return { success: true };
  } catch (e) {
    console.error(`[WAN] Remove config failed on ${dev}:`, e.message);
    return { success: false, error: e.message };
  }
}

async function applyWanConfig(wan) {
  const { name, type, config = {}, is_vlan, vlan_parent, vlan_id } = wan;
  if (!name) return { success: false, error: 'Interface name required' };

  // For VLAN WANs, ensure the VLAN interface exists before configuring
  if (is_vlan) {
    try {
      await execPromise(`ip link show ${name}`);
    } catch (e) {
      // VLAN interface does not exist, try to create it
      if (vlan_parent && vlan_id) {
        try {
          console.log(`[WAN] VLAN interface ${name} missing, auto-creating...`);
          await createVlan({ parent: vlan_parent, id: vlan_id, name });
        } catch (createErr) {
          console.error(`[WAN] Failed to auto-create VLAN ${name}:`, createErr.message);
          return { success: false, error: `VLAN ${name} does not exist and auto-creation failed: ${createErr.message}` };
        }
      } else {
        return { success: false, error: `VLAN interface ${name} does not exist and no parent/vlan_id info available` };
      }
    }
    // Ensure parent interface is up
    if (vlan_parent) {
      try {
        await execPromise(`ip link set dev ${vlan_parent} up`);
      } catch (e) {
        console.warn(`[WAN] Could not bring up parent ${vlan_parent}:`, e.message);
      }
    }
  }

  // Remove old config first
  await removeWanConfig(name);

  let result;
  switch (type) {
    case 'dhcp':
      result = await configureWanDhcp(name, !!is_vlan);
      break;
    case 'static':
      result = await configureWanStatic(name, config);
      break;
    case 'pppoe':
      result = await configureWanPppoe(name, config);
      break;
    default:
      return { success: false, error: `Unknown WAN type: ${type}` };
  }

  // Add firewall rules (NAT masquerade + FORWARD) for this WAN interface
  if (result.success !== false) {
    await addWanFirewallRules(name);
  }

  // Enrich result with live status info
  if (result.success) {
    const status = await getWanStatus(name);
    const gateway = await getWanGateway(name);
    result.ip = result.ip || status.ip;
    result.gateway = result.gateway || gateway;
    result.status = status.status;
  }

  return result;
}

module.exports = {
  autoProvisionNetwork,
  restoreNetworkConfig,
  ensureWanDhcp,
  getDefaultRouteInterface,
  getInterfaces,
  setupHotspot,
  removeHotspot,
  configureWifiAP,
  whitelistMAC,
  blockMAC,
  createVlan,
  deleteVlan,
  createBridge,
  deleteBridge,
  initFirewall,
  scanWifiDevices,
  initQoS,
  restartDnsmasq,
  setSpeedLimit,
  removeSpeedLimit,
  getLanInterface,
  // WAN functions
  configureWanDhcp,
  configureWanStatic,
  configureWanPppoe,
  getWanStatus,
  getWanSpeed,
  removeWanConfig,
  applyWanConfig,
  getWanGateway,
  addWanFirewallRules,
  removeWanFirewallRules,
  // PPPoE Server functions
  startPPPoEServer,
  stopPPPoEServer,
  getPPPoEServerStatus,
  getPPPoESessions,
  syncPPPoESecrets,
  addPPPoEUser,
  deletePPPoEUser,
  getPPPoEUsers,
  updatePPPoEUser,
  disconnectPPPoEUser,
  getActivePPPoEUsernames,
  applyPPPoERateLimit,
  clearPPPoERateLimit,
  forceNetworkRefresh: async (mac, ip) => {
    console.log(`[NET] Forcing Network Refresh for ${mac} (${ip})`);
    try {
      // Re-apply whitelist rules
      await whitelistMAC(mac, ip);
      // Try to wake up the device in ARP table
      try { await execPromise(`ping -c 1 -W 1 ${ip}`); } catch (e) {}
      return true;
    } catch (e) {
      console.error(`[NET] Force Refresh Error:`, e.message);
      return false;
    }
  },
  detectNetworkConfig: async () => {
    try {
      const { stdout } = await execPromise('ip -j link show');
      const links = JSON.parse(stdout);
      
      const vlans = links
        .filter(l => l.link_info && l.link_info.info_kind === 'vlan')
        .map(l => {
          let parent = 'unknown';
          const parentLink = links.find(p => p.ifindex === l.link);
          if (parentLink) parent = parentLink.ifname;
          return { name: l.ifname, parent, id: l.link_info.info_data.id };
        });

      const bridges = links
        .filter(l => l.link_info && l.link_info.info_kind === 'bridge')
        .map(b => ({
          name: b.ifname,
          members: links.filter(l => l.master === b.ifname).map(l => l.ifname),
          stp: 0 // Default, parsing STP state from ip-link is complex
        }));

      return { vlans, bridges };
    } catch (e) {
      console.error('[NET] Detect Config Error:', e.message);
      return { vlans: [], bridges: [] };
    }
  },
  cleanupAllNetworkSettings: async () => {
    console.log('[NET] Starting Factory Reset Cleanup...');
    
    // 1. Stop Services
    await execPromise('killall -9 hostapd').catch(() => {});
    await execPromise('killall -9 dnsmasq').catch(() => {});
    await execPromise('killall -9 pppoe-server').catch(() => {});
    await execPromise('killall -9 pppd').catch(() => {});
    await execPromise('killall -9 wpa_supplicant').catch(() => {});
    
    // 2. Remove Configs
    await execPromise('rm -f /etc/dnsmasq.d/ajc_*.conf').catch(() => {});
    await execPromise('rm -f /etc/hostapd/*.conf').catch(() => {});
    await execPromise('rm -f /etc/ppp/pap-secrets /etc/ppp/chap-secrets /etc/ppp/pppoe-server-options').catch(() => {});
    
    // 3. Clear Logs (Aggressive cleanup for image creation)
    await execPromise('truncate -s 0 /var/log/pppd.log').catch(() => {});
    await execPromise('truncate -s 0 /var/log/pppoe-server.log').catch(() => {});
    await execPromise('truncate -s 0 /var/log/syslog').catch(() => {});
    await execPromise('truncate -s 0 /var/log/messages').catch(() => {});
    await execPromise('truncate -s 0 /var/log/kern.log').catch(() => {});
    await execPromise('rm -f /var/log/*.gz').catch(() => {});
    await execPromise('rm -f /var/log/*.1').catch(() => {});
    
    // 4. Clear Leases
    await execPromise('rm -f /var/lib/misc/dnsmasq.leases').catch(() => {});
    
    // 5. Flush Firewall
    await execPromise('iptables -F').catch(() => {});
    await execPromise('iptables -X').catch(() => {});
    await execPromise('iptables -t nat -F').catch(() => {});
    await execPromise('iptables -t nat -X').catch(() => {});
    await execPromise('iptables -t mangle -F').catch(() => {});
    await execPromise('iptables -t mangle -X').catch(() => {});
    
    // 6. Remove IFB device
    await execPromise('ip link delete ifb0').catch(() => {});
    
    console.log('[NET] Factory Reset Cleanup Complete.');
  },
  checkTcRulesExist,
  applyGamingPriority
};
