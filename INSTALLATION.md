# Installation Guide

## 📥 Installation

### Automated Install (Recommended)

Run this command in your terminal to install all dependencies and the RJD PISOWIFI system:

```bash
curl -sSL https://raw.githubusercontent.com/Djnirds1984/RJD-PISOWIFI-Management-System/main/install.sh | sudo bash
```

### Manual Installation

1. **Update System & Install Dependencies**:
   ```bash
   sudo apt update
   sudo apt install -y git nodejs npm sqlite3 iptables bridge-utils hostapd dnsmasq build-essential
   ```

2. **Clone the Repository**:
   ```bash
   git clone https://github.com/Djnirds1984/RJD-PISOWIFI-Management-System.git
   cd RJD-PISOWIFI-Management-System
   ```

3. **Install Node Modules**:
   ```bash
   npm install
   ```

4. **Start the System**:
   ```bash
   sudo node server.js
   ```

5. **Setup Process Manager (PM2)**:
   For production environments, use PM2 to keep the system running in the background and automatically restart on boot.

   **Install PM2 Globally:**
   ```bash
   sudo npm install -g pm2
   ```

   **Start the Application:**
   ```bash
   # Ensure you are in the project directory
   sudo pm2 start server.js --name "rjd-pisowifi"
   ```

   **Enable Startup Script:**
   Generate and run the startup script to ensure the system boots automatically:
   ```bash
   sudo pm2 startup
   # Run the command displayed by the output of the previous line
   sudo pm2 save
   ```

   **Basic Management Commands:**
   ```bash
   sudo pm2 status       # Check system status
   sudo pm2 restart all  # Restart the system
   sudo pm2 logs         # View real-time logs
   ```

## 🔧 Troubleshooting

### Common Errors

**Error: `Cannot find module 'express'`**
This indicates that the project dependencies are not installed.
1. Navigate to the project directory: `cd /opt/rjd-pisowifi` (or your install path)
2. Install dependencies: `npm install`
3. Restart the system: `sudo pm2 restart rjd-pisowifi`

**Error: `EADDRINUSE: address already in use`**
Another process is using port 80.
1. Find the process: `sudo lsof -i :80`
2. Kill it: `sudo kill -9 <PID>`
3. Restart: `sudo pm2 restart rjd-pisowifi`

**Error: `sqlite3` or `serialport` Build Failure**
If `npm install` fails on ARM boards (Orange Pi/Raspberry Pi) with Python 3.12+:
1. Install system build tools:
   ```bash
   sudo apt install -y build-essential python3-dev libsqlite3-dev
   ```
2. Update npm and node-gyp:
   ```bash
   sudo npm install -g npm@latest node-gyp@latest
   ```
3. Force build from source:
   ```bash
   npm install --build-from-source
   ```
