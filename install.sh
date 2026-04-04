#!/bin/bash

# AJC PISOWIFI - Automated Installation Script v3.6.0-ONLINE-BETA
# Hardware Support: Raspberry Pi, Orange Pi, x86_64
# Process Manager: PM2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}==============================================${NC}"
echo -e "${BLUE}   AJC PISOWIFI SYSTEM INSTALLER v3.6.0-ONLINE-BETA ${NC}"
echo -e "${BLUE}==============================================${NC}"

# Check for root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root (use sudo)${NC}"
  exit 1
fi

echo -e "${GREEN}[1/8] Detecting Hardware Architecture...${NC}"
ARCH=$(uname -m)
BOARD="unknown"

if grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    BOARD="raspberry_pi"
    echo -e "${YELLOW}Detected: Raspberry Pi (${ARCH})${NC}"
elif [ -f /etc/armbian-release ] || grep -q "Orange Pi" /proc/cpuinfo 2>/dev/null; then
    BOARD="orange_pi"
    echo -e "${YELLOW}Detected: Orange Pi / Armbian (${ARCH})${NC}"
elif [[ "$ARCH" == "x86_64" ]]; then
    BOARD="x64_pc"
    echo -e "${YELLOW}Detected: x86_64 PC (Ubuntu/Debian)${NC}"
else
    echo -e "${RED}Unknown hardware: ${ARCH}. Proceeding with generic installation.${NC}"
fi

echo -e "${GREEN}[2/8] Updating system repositories...${NC}"
# Fix for "No space left on device" and corrupted lists
echo -e "${YELLOW}Cleaning apt cache and lists to free space...${NC}"
apt-get clean
rm -rf /var/lib/apt/lists/*

apt-get update

echo -e "${GREEN}[3/8] Installing core dependencies...${NC}"
# Added: ffmpeg (audio), conntrack (networking), libsqlite3-dev/python3-dev (build), vlan/iw (wifi/net)
apt-get install -y \
    bridge-utils \
    build-essential \
    conntrack \
    curl \
    dnsmasq \
    ffmpeg \
    git \
    hostapd \
    iproute2 \
    iptables \
    iputils-ping \
    iw \
    libcap2-bin \
    libffi-dev \
    libsqlite3-dev \
    libssl-dev \
    libudev-dev \
    net-tools \
    pkg-config \
    ppp \
    pppoe \
    psmisc \
    python3 \
    python3-dev \
    python3-venv \
    python-is-python3 \
    python3-pip \
    sqlite3 \
    vlan

# Install Board-Specific Packages
case $BOARD in
    "raspberry_pi")
        apt-get install -y raspberrypi-kernel-headers || echo "Skipping RPi headers..."
        ;;
    "x64_pc")
        apt-get install -y setserial
        usermod -a -G dialout root || true
        ;;
esac

echo -e "${GREEN}Installing esptool...${NC}"
if apt-get install -y esptool; then
    echo -e "${BLUE}esptool installed via apt.${NC}"
elif apt-get install -y python3-esptool; then
    echo -e "${BLUE}python3-esptool installed via apt.${NC}"
else
    ESPTOOL_VENV="/opt/ajc-esptool-venv"
    python3 -m venv "$ESPTOOL_VENV"
    "$ESPTOOL_VENV/bin/python" -m pip install --no-input esptool
    ln -sf "$ESPTOOL_VENV/bin/esptool" /usr/local/bin/esptool
    echo -e "${BLUE}esptool installed in venv and linked to /usr/local/bin/esptool.${NC}"
fi

echo -e "${GREEN}[4/8] Installing Node.js v20 (LTS)...${NC}"
DEB_ARCH=$(dpkg --print-architecture 2>/dev/null || echo "")
if [[ "$DEB_ARCH" == "amd64" || "$DEB_ARCH" == "arm64" ]]; then
    if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1) != "v20" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    else
        echo -e "${BLUE}Node.js $(node -v) is already installed.${NC}"
    fi
else
    if ! command -v node &> /dev/null; then
        echo -e "${YELLOW}Using distro Node.js for architecture ${DEB_ARCH:-unknown}.${NC}"
        apt-get install -y nodejs npm
    else
        echo -e "${BLUE}Node.js $(node -v) is already installed.${NC}"
    fi
fi

echo -e "${GREEN}Installing global build tools...${NC}"
if [[ "$DEB_ARCH" == "amd64" || "$DEB_ARCH" == "arm64" ]]; then
    npm install -g npm@latest node-gyp pm2
else
    npm install -g node-gyp@10 pm2
fi

echo -e "${GREEN}[5/8] Preparing Project Directory...${NC}"
INSTALL_DIR="/opt/ajc-pisowifi"
if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Cloning repository...${NC}"
    git clone https://github.com/Djnirds1984/AJC-PISOWIFI-Management-System.git "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

echo -e "${GREEN}[6/8] Building Application...${NC}"

# Clean state
rm -rf node_modules package-lock.json dist

# Swap creation disabled by user request
# TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
# if [ "$TOTAL_MEM" -lt 1000 ]; then
#     echo -e "${YELLOW}Low memory detected (${TOTAL_MEM}MB). Creating 1GB temporary swap...${NC}"
#     fallocate -l 1G /tmp/swapfile || dd if=/dev/zero of=/tmp/swapfile bs=1M count=1024
#     chmod 600 /tmp/swapfile
#     mkswap /tmp/swapfile
#     swapon /tmp/swapfile
# fi

echo -e "${GREEN}Running 'npm install'...${NC}"
# --build-from-source ensures native modules like sqlite3 link against system libs correctly
npm install --unsafe-perm --no-audit --no-fund --build-from-source

echo -e "${GREEN}Running 'npm run build' (Transpiling TSX to JS)...${NC}"
npm run build

# Swap removal disabled by user request
# if [ -f /tmp/swapfile ]; then
#     swapoff /tmp/swapfile
#     rm /tmp/swapfile
# fi

echo -e "${GREEN}[7/8] Finalizing System Persistence...${NC}"
pm2 delete ajc-pisowifi 2>/dev/null || true
pm2 start server.js --name "ajc-pisowifi"
pm2 save

PM2_STARTUP=$(pm2 startup systemd -u root --hp /root | grep "sudo env")
if [ -n "$PM2_STARTUP" ]; then
    eval "$PM2_STARTUP"
fi
pm2 save

echo -e "${GREEN}[8/8] Setting Kernel Capabilities...${NC}"
# cap_net_bind_service allows binding to port 80 without being root
# cap_net_admin/raw needed for raw socket access (some networking tools)
setcap 'cap_net_bind_service,cap_net_admin,cap_net_raw+ep' $(eval readlink -f $(which node))

echo -e "${BLUE}==============================================${NC}"
echo -e "${GREEN} INSTALLATION COMPLETE! ${NC}"
echo -e "${BLUE}==============================================${NC}"
echo -e "Hardware:         ${BOARD}"
echo -e "Portal:           http://$(hostname -I | awk '{print $1}')"
echo -e "Check Logs:       pm2 logs ajc-pisowifi"
echo -e "${BLUE}==============================================${NC}"
