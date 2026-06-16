# RJD PISOWIFI Management System

**Enterprise-Grade PisoWiFi Management for the Modern ISP**

Transform your Raspberry Pi or Orange Pi into a powerful, revenue-generating WiFi hotspot. The **RJD PISOWIFI Management System** is engineered for stability, speed, and seamless user experience. Built with a robust Node.js core and real-time WebSockets, it delivers instant coin recognition, advanced traffic shaping, and a sleek mobile-first captive portal.

Whether you're managing a single vending machine or a fleet of hotspots, RJD PISOWIFI provides the professional tools you need: multi-WAN load balancing, VLAN support, and comprehensive analytics — all in one lightweight, high-performance package.

---

## Core Features

- **Real-time Coin Detection**: Instant credit updates with support for standard multi-coin slots (Pins configurable).
- **Advanced Networking**: Full control over WAN/WLAN configurations, Bridge management, and 802.1Q VLAN support.
- **Mobile-First Captive Portal**: A beautiful, responsive user interface that works perfectly on any device.
- **Professional Admin Dashboard**: Deep insights with real-time analytics, pricing management, and system health monitoring.
- **Robust Security**: Integrated firewall, captive portal redirection, and hardware-locked licensing system.
- **Hardware Agnostic**: Native optimization for Raspberry Pi and Orange Pi ecosystems.

---

## Phone Rental System

A complete Android device rental management system with kiosk mode, coin-operated sessions, and cloud sync.

### Device Management
- **Full CRUD for Rental Devices**: Add, edit, rename, and delete rental phones with details (name, MAC, IP, model, Android ID).
- **Device Status Tracking**: Real-time status badges — Available, Rented, Maintenance, Offline.
- **Live Timer Display**: Countdown timers for active rental sessions with per-second updates.
- **Maintenance Toggle**: Quickly toggle devices in/out of maintenance mode.
- **Internet Bypass/Block**: Allow internet access (bypass captive portal) or block it (return to captive portal) per device.
- **Cloud Sync**: One-click force-push all devices to Supabase cloud.

### License & Activation
- **7-Day Trial Period**: New devices automatically get a 7-day trial upon acceptance.
- **Activation Key System**: Enter license keys (e.g., `RENT-XXXX-XXXX-XXXX`) to activate full licenses.
- **Vendor Accept/Reject**: Accept or reject pending device registrations from the admin panel.
- **Deactivate & Reactivate**: Deactivate devices or reactivate expired/deactivated ones with a new trial period.
- **License Expiration Tracking**: Visual badges showing days remaining for trial or license expiration.

### Session Management
- **Start Rental**: Begin timed sessions with quick duration presets (30min, 1hr, 2hrs, 3hrs, 5hrs, 8hrs) or custom durations.
- **Customer Tracking**: Optional customer name and contact number per session.
- **Payment Methods**: Cash, Coins, E-Wallet, or Other payment method tracking.
- **Extend Rental**: Add more time to active sessions with additional payment.
- **Kiosk Logout/Resume**: Pause a session by logging out the kiosk, then resume later — timer pauses while logged out.
- **End Rental (Return)**: Terminate active or paused sessions manually.
- **Session Filtering**: Filter sessions by status — All, Active, Paused, Completed, Overdue, Cancelled.
- **Session Cloud Sync**: Force-push session records to Supabase.

### Allowed Apps (Kiosk App Whitelisting)
- **Per-Device App Whitelisting**: Configure which Android apps are allowed on each rental device.
- **24 Pre-configured Common Apps**: Facebook, Messenger, TikTok, YouTube, Mobile Legends, Roblox, PUBG, Free Fire, Instagram, WhatsApp, Viber, Telegram, and more.
- **Category-based Selection**: Apps grouped by Social, Games, Entertainment, Messaging, and Utility.
- **Custom Package Support**: Add any Android package name manually.
- **Select All / Clear All**: Quick bulk toggle for all pre-configured apps.

### OTA App Updates
- **In-Dashboard APK Publishing**: Upload new APK versions directly from the admin panel.
- **Version Management**: Set version code and version name; auto-parse version from filename.
- **Release Notes**: Attach release notes to each update.
- **Download Published APK**: Download the currently published APK for manual installation.
- **Auto-Update on Devices**: Rental devices automatically detect and install updates on startup/heartbeat.

### APK Installer (ADB-based)
- **ADB Integration**: Check ADB installation status, install ADB from the dashboard.
- **Device Scanning**: Detect connected Android devices via USB with serial numbers.
- **Remote APK Installation**: Install the rental APK to connected devices over ADB.
- **Activity Log**: Real-time terminal-style log output for all ADB operations.

### Device Owner Setup (Kiosk Lockdown)
- **Step-by-Step Wizard**: 3-step guided setup — Install ADB, Connect Device, Set Device Owner.
- **Full Kiosk Mode**: Device Owner mode enables home button blocking, status bar blocking, and app whitelisting enforcement.
- **Remove Device Owner**: Option to remove Device Owner mode and disable kiosk.
- **Activity Log**: Real-time log of all setup operations.

### CoinSlot Rates
- **Independent Pricing**: Separate rate configuration from PisoWiFi internet rates.
- **Flexible Rate Tiers**: Define custom peso-to-minute mappings (e.g., P10 = 60 mins).
- **Rate Labels**: Optional human-readable labels for each rate tier.
- **CRUD Operations**: Add, edit, delete, and save all rates in one click.

### Wallpaper Management
- **Per-Device Wallpapers**: Upload custom full-screen wallpapers for each rental device.
- **Multi-Format Support**: JPG, PNG, WEBP, GIF (up to 30MB), BMP, TIFF (up to 10MB).
- **Preview & Delete**: View current wallpaper preview and delete it from the dashboard.
- **Auto-Download**: Wallpapers download automatically when the rental app starts.

### Revenue & Reporting
- **Summary Dashboard**: Total devices, available, rented, and total revenue at a glance.
- **7-Day Revenue Chart**: Visual bar chart showing daily revenue for the past week.
- **Today's Stats**: Real-time today's revenue and session count.
- **Device Performance Table**: Per-device breakdown of total rentals, revenue, last rented date, and status.
- **Average Duration Tracking**: Session duration analytics.

---

## MikroTik Management

Full CRUD management for MikroTik RouterOS devices via API or REST API, with integrated PPPoE billing.

### Router Connections
- **Multi-Router Support**: Add and manage multiple MikroTik routers.
- **Connection Testing**: Test router connectivity before saving (shows device identity on success).
- **Dual Protocol**: Support for both MikroTik API (port 8728) and REST API (HTTP/HTTPS).
- **Router Selection**: Select active router from a persistent connections card.
- **Delete Router**: Remove router connections with confirmation.

### Router Snapshot
- **Live System Info**: Identity, uptime, RouterOS version, board name, CPU load, free/total memory.
- **Auto-Refresh**: Refresh snapshot data on demand.

### PPPoE Secrets / Users
- **Full CRUD**: Create, read, update, and delete PPPoE secrets (users).
- **User Details**: Username, password, service type, profile assignment, enable/disable toggle.
- **Profile Assignment**: Dropdown selection of available PPP profiles.
- **Due Date Tracking**: Next due date column with visual overdue indicators.
- **Expired Profile Dropdown**: Assign a specific profile for expired users.
- **Billing Plan Integration**: Assign billing plans directly from the secrets page.

### PPPoE Profiles
- **Full CRUD**: Create, edit, and delete PPP profiles.
- **Rate Limits**: Configure download/upload speed limits per profile.
- **IP Assignment**: Local and remote address configuration.
- **Only-One Setting**: Control single-session enforcement.

### PPPoE Active Sessions
- **Live Session View**: See all currently active PPPoE connections.
- **Session Details**: Username, IP address, service, uptime, caller ID.

### Billing Plans
- **Plan Management**: Create, edit, and delete billing plans linked to PPP profiles.
- **Pricing Configuration**: Set monthly pricing for each billing plan.
- **Automatic Scheduler**: Scheduler auto-created on secret creation for billing enforcement.
- **Multi-Month Payment**: Pay for multiple months at once with time-preserving renewal logic.
- **Pay Modal**: Integrated payment modal with offline-day discount support.

### Sales Report
- **Full CRUD Sales Records**: Create, view, edit, and delete sales entries.
- **Payment Tracking**: Record payments with gross amount, discount days, net amount, and payment method.
- **Due Date Management**: Track and extend user expiration dates upon payment.
- **Acknowledgement Receipt**: Thermal-printer-ready receipt generation (NOT AN OFFICIAL RECEIPT).
- **Dual-Mode Printing**: Full receipt or condensed receipt printing options.
- **Offline-Day Discount**: Automatically calculates discounts for days the service was offline during the billing period.

---

## Equipment Inventory System

Complete inventory management for network equipment and client withdrawals.

### Inventory Management
- **Full CRUD**: Add, edit, and delete equipment items.
- **Equipment Types**: Router, Access Point, Switch, Cable, Antenna, Other — with color-coded badges.
- **Detailed Records**: Name, type, serial number, MAC address, price, stock quantity, description.
- **Summary Cards**: Total items count, total stock units, and total inventory value (in PHP).
- **Filtering & Search**: Filter by equipment type and search by name, serial number, MAC address, or description.
- **Stock Level Indicators**: Color-coded stock badges — Green (>5), Amber (1-5), Red (0).

### Equipment Withdrawal
- **Multi-Item Withdrawals**: Issue multiple equipment items in a single withdrawal.
- **Client Tracking**: Record client name, withdrawal date, and notes.
- **Automatic Stock Deduction**: Stock quantities are automatically reduced when equipment is withdrawn.
- **Stock Restoration**: Deleting a withdrawal automatically restores the stock.
- **Expandable Cards**: Click to expand withdrawal details showing itemized equipment list.
- **Search**: Search withdrawals by client name, notes, or equipment name.

---

## Employee Management

Integrated HR system with attendance tracking and payroll generation.

### Employee Records
- **Full CRUD**: Add, edit, and delete employee records.
- **Employee Details**: Employee code, full name, position, daily rate, contact number, email, address, status.
- **Status Management**: Active / Inactive status with visual badges.
- **Daily Rate Tracking**: Per-employee daily rate configuration in PHP.

### Daily Time Records (DTR)
- **Attendance Logging**: Record time-in and time-out for each employee per day.
- **Status Types**: Present, Absent, Late, Half Day, Leave — with color-coded badges.
- **Auto-Calculated Hours**: Total hours automatically computed from time-in/time-out.
- **Filtering**: Filter DTR records by employee or search by name/date.
- **Notes**: Optional notes field for each DTR entry.

### Payroll Generator
- **One-Click Payroll Generation**: Select an employee, set a period, and generate payroll automatically from DTR records.
- **Payroll Summary**: Total gross pay, total deductions, and total net pay across all records.
- **Deductions Support**: Custom deductions per payroll period.
- **Approval Workflow**: Draft → Approved → Paid status progression.
- **Payroll Details**: Period start/end, total days, total hours, gross pay, deductions, net pay.
- **Filter by Employee**: View payroll records for a specific employee or all.

---

## NodeMCU Firmware Management

Streamline your hardware deployment with the integrated **NodeMCU Flasher**. This enterprise feature allows administrators to flash firmware directly from the dashboard, eliminating the need for external tools or complex command-line operations.

**Key Capabilities:**
- **Auto-Detection**: Instantly identifies connected NodeMCU/ESP8266 devices via USB.
- **One-Click Flashing**: Deploys the optimized `NodeMCU_ESP8266.bin` firmware directly from the server.
- **Safety Interlocks**: Intelligent filtering prevents accidental flashing of active WiFi adapters or critical system peripherals.
- **Multi-Device Management**: Support for multiple NodeMCU devices with independent pricing and pin configuration.
- **License Management**: Integrated license system for NodeMCU devices with hardware-locked activation.
- **CoinsOut Tracking**: Record and manage coin collection with gross/net share percentages.

**Usage:**
1. Navigate to **System Settings** in the Admin Dashboard.
2. Connect your NodeMCU board to any USB port on the server.
3. The system will auto-detect the device (displayed as `ttyUSB*` or `ttyACM*`).
4. Click **Flash Firmware** to initiate the deployment process.

---

## Additional Admin Features

### Voucher System
- **Bulk Voucher Generation**: Generate multiple vouchers with custom amount and time values.
- **Voucher Filtering**: View All, Used, or Unused vouchers.
- **Portal Activation**: Customers can activate vouchers from the captive portal.

### Portal Editor
- **Theme System**: Multiple pre-built themes for the captive portal.
- **Free Internet Promo**: Configure free internet minutes with cooldown period.
- **Central Portal Sync**: Sync portal configuration across multiple machines.
- **MAC Sync**: Per-MAC configuration with sync mode options.
- **Audio Configuration**: Upload and select custom audio files for portal events.

### Tools Page
- **Ookla Speedtest**: Run WAN speed tests directly from the dashboard with ping, jitter, download, and upload results.
- **DHCP Leases**: View all active DHCP leases from connected routers.

### Bandwidth Management
- **Per-User Rate Limiting**: Configure download and upload speed limits per session.
- **Default Bandwidth Settings**: Set default limits for new users.

### Multi-WAN & Networking
- **Multi-WAN Load Balancing**: Configure multiple WAN interfaces.
- **VLAN Support**: 802.1Q VLAN configuration.
- **PPPoE Server**: Built-in PPPoE server configuration.

### System & Analytics
- **Real-time Analytics**: Earnings, user count, and session data with visual charts.
- **System Health Monitoring**: CPU, memory, storage, and network interface statistics.
- **Remote Management**: Remote access and control capabilities.
- **Company Settings**: Business profile and branding configuration.
- **Rewards System**: Customer loyalty and rewards configuration.

---

## Hardware Requirements

- **SBC**: Raspberry Pi (All models) or Orange Pi (All models).
- **Coin Slot**: Standard multi-coin slot (e.g., CH-926).
- **OS**: Debian-based Linux (Raspberry Pi OS / Armbian).

## Documentation & Installation

For detailed installation instructions, including automated scripts and manual setup guides, please refer to our **[Installation Guide](INSTALLATION.md)**.

## Configuration

- **Default Port**: 80 (Standard HTTP)
- **Admin Login**: Click the "ADMIN LOGIN" button in the bottom right of the portal.
- **GPIO**: Configure the board type and pin number via the "System Configuration" gear icon in the portal (Simulation mode available).

---

&copy; 2026 RJD PISOWIFI &mdash; Developed for robust public internet delivery.
# RJD-PISOWIFI
