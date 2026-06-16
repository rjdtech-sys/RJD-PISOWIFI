#!/bin/bash
# ajc-wan-dhcp-wait.sh — Ensures WAN interface gets DHCP lease on boot
# Fixes Chromebox/x64 Debian issue where NIC doesn't obtain IP until cable is replugged.
#
# This script:
# 1. Waits for any ethernet interface to get link (carrier)
# 2. Forces a DHCP renew if no IP is present
# 3. Retries up to 3 times
#
# Install as systemd service for best results:
#   cp ajc-wan-dhcp-wait.service /etc/systemd/system/
#   systemctl daemon-reload
#   systemctl enable ajc-wan-dhcp-wait.service

set -e

MAX_WAIT=45          # Seconds to wait for link per attempt
MAX_RETRIES=3        # Number of DHCP attempts
RETRY_DELAY=5        # Seconds between retries

log() { echo "[$(date '+%H:%M:%S')] [WAN-DHCP] $*"; }

# Find the WAN interface (first ethernet with default route or first ethernet)
find_wan_interface() {
    # 1. Try default route
    local wan
    wan=$(ip -j route show default 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['dev'] if r else '')" 2>/dev/null || true)
    if [ -n "$wan" ] && [ -d "/sys/class/net/$wan" ]; then
        echo "$wan"
        return
    fi

    # 2. Try from ip route
    wan=$(ip route show default 2>/dev/null | awk '{print $5}' | head -n1 || true)
    if [ -n "$wan" ] && [ -d "/sys/class/net/$wan" ]; then
        echo "$wan"
        return
    fi

    # 3. Find first ethernet with carrier
    for iface in /sys/class/net/en* /sys/class/net/eth*; do
        [ -d "$iface" ] || continue
        local name
        name=$(basename "$iface")
        # Skip virtual interfaces
        [ -f "$iface/device" ] || continue
        echo "$name"
        return
    done

    # 4. Fallback
    echo "eth0"
}

# Check if interface has a valid global IPv4 address
has_ip() {
    local iface="$1"
    ip -j addr show dev "$iface" 2>/dev/null | python3 -c "
import sys, json
addrs = json.load(sys.stdin)
if addrs:
    for a in addrs[0].get('addr_info', []):
        if a.get('family') == 'inet' and a.get('scope') == 'global':
            print(a['local'])
            sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# Wait for link (carrier)
wait_for_link() {
    local iface="$1"
    local waited=0
    while [ $waited -lt $MAX_WAIT ]; do
        if [ -f "/sys/class/net/$iface/carrier" ]; then
            local carrier
            carrier=$(cat "/sys/class/net/$iface/carrier" 2>/dev/null || echo "0")
            if [ "$carrier" = "1" ]; then
                log "Link UP on $iface after ${waited}s"
                return 0
            fi
        fi
        sleep 1
        waited=$((waited + 1))
    done
    log "No link on $iface after ${MAX_WAIT}s"
    return 1
}

# Force DHCP renew
force_dhcp() {
    local iface="$1"

    # Kill existing dhclient for this interface
    pkill -f "dhclient.*$iface" 2>/dev/null || true
    sleep 1

    # Release existing lease
    dhclient -r "$iface" 2>/dev/null || true
    sleep 1

    # Request new lease
    log "Running dhclient on $iface..."
    if timeout 30 dhclient -1 -v "$iface" 2>&1 | tail -1; then
        log "dhclient completed for $iface"
    else
        log "dhclient failed or timed out for $iface"
    fi

    # Also try dhcpcd if available
    if command -v dhcpcd &>/dev/null; then
        dhcpcd -n "$iface" 2>/dev/null || true
    fi
}

# Force link renegotiation
force_link_toggle() {
    local iface="$1"
    log "Toggling interface $iface down/up to force link renegotiation..."
    ip link set dev "$iface" down 2>/dev/null || true
    sleep 2
    ip link set dev "$iface" up 2>/dev/null || true
    sleep 3
}

# === Main ===
log "Starting WAN DHCP wait service..."

WAN=$(find_wan_interface)
log "Detected WAN interface: $WAN"

# Check if already has IP
EXISTING_IP=$(has_ip "$WAN")
if [ -n "$EXISTING_IP" ]; then
    log "WAN $WAN already has IP $EXISTING_IP. Nothing to do."
    exit 0
fi

log "WAN $WAN has no IP. Starting recovery..."

for attempt in $(seq 1 $MAX_RETRIES); do
    log "=== Attempt $attempt/$MAX_RETRIES ==="

    # Wait for link
    if ! wait_for_link "$WAN"; then
        # No link — try toggling the interface
        force_link_toggle "$WAN"

        # Wait again after toggle
        if ! wait_for_link "$WAN"; then
            log "Still no link after toggle. Retrying..."
            sleep $RETRY_DELAY
            continue
        fi
    fi

    # Force DHCP
    force_dhcp "$WAN"

    # Verify
    sleep 2
    OBTAINED_IP=$(has_ip "$WAN")
    if [ -n "$OBTAINED_IP" ]; then
        log "SUCCESS: $WAN obtained IP $OBTAINED_IP"
        exit 0
    fi

    log "Attempt $attempt failed: No IP on $WAN"
    sleep $RETRY_DELAY
done

log "FAILED: Could not obtain DHCP IP on $WAN after $MAX_RETRIES attempts."
log "The application-level WAN recovery (ensureWanDhcp) will continue retrying."
exit 1
