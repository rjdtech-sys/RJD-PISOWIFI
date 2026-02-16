export type BoardType = 'raspberry_pi' | 'orange_pi' | 'x64_pc' | 'nodemcu_esp' | 'none';

export interface SystemConfig {
  boardType: BoardType;
  coinPin: number;
  boardModel?: string | null;
  // Multi-coin slot support
  coinSlots?: CoinSlotConfig[];
  // For ESP WiFi connection
  espIpAddress?: string;
  espPort?: number;
  // For multi-NodeMCU setup
  nodemcuDevices?: NodeMCUDevice[];
  registrationKey?: string;
  // Deprecated - kept for backward compatibility
  serialPort?: string;
}

export interface CoinSlotConfig {
  id: number; // Slot identifier (1, 2, 3, 4)
  enabled: boolean;
  pin: number; // GPIO pin on ESP board
  denomination: number; // 1, 5, 10 pesos
  name?: string; // Optional custom name
}

export interface NodeMCUDevice {
  id: string;
  name: string;
  ipAddress: string;
  macAddress: string;
  pin: number;
  coinPinLabel?: string;
  coinPin?: number;
  relayPinLabel?: string;
  relayPin?: number;
  status: 'pending' | 'accepted' | 'rejected' | 'disconnected';
  vlanId?: number;
  lastSeen: string;
  authenticationKey: string;
  createdAt: string;
  // Pricing configuration
  rates: Rate[]; // Independent pricing rules for this device
  totalPulses: number;
  totalRevenue: number;
}

export interface Rate {
  id: string;
  pesos: number;
  minutes: number;
  download_limit?: number; // Mbps
  upload_limit?: number; // Mbps
}

export interface QoSConfig {
  discipline: 'cake' | 'fq_codel';
}

export interface NetworkInterface {
  name: string;
  type: 'ethernet' | 'wifi' | 'bridge' | 'vlan' | 'loopback';
  status: 'up' | 'down';
  ip?: string;
  mac: string;
  isLoopback?: boolean;
}

export interface WirelessConfig {
  interface: string;
  ssid: string;
  password?: string;
  channel: number;
  hw_mode: 'g' | 'a';
  bridge?: string;
}

export interface HotspotInstance {
  interface: string;
  ip_address: string;
  dhcp_range: string;
  bandwidth_limit: number;
  enabled: number;
}

export interface WanConfig {
  proto: 'static' | 'dhcp';
  ipaddr: string;
  netmask: string;
  gateway: string;
  dns: string[];
}

export interface VlanConfig {
  id: number;
  parentInterface: string;
  name: string;
}

export interface PPPoEServerConfig {
  interface: string;
  local_ip: string;
  ip_pool_start: string;
  ip_pool_end: string;
  dns1?: string;
  dns2?: string;
  service_name?: string;
  enabled: number;
}

export interface PPPoEUser {
  id?: number;
  account_number?: string;
  username: string;
  password: string;
  enabled: number;
  ip_address?: string;
  billing_profile_id?: number;
  created_at?: string;
}

export interface PPPoEProfile {
  id?: number;
  name: string;
  rate_limit_dl: number; // in Mbps
  rate_limit_ul: number; // in Mbps
  created_at?: string;
}

export interface PPPoEBillingProfile {
  id?: number;
  profile_id: number;
  name: string;
  price: number;
  created_at?: string;
}

export interface PPPoESession {
  username: string;
  ip: string;
  interface: string;
  uptime: number;
  rx_bytes: number;
  tx_bytes: number;
}

export interface PPPoEPool {
  id?: number;
  name: string;
  ip_pool_start: string;
  ip_pool_end: string;
  description?: string | null;
  created_at?: string;
}

export interface UserSession {
  mac: string;
  ip: string;
  remainingSeconds: number;
  totalPaid: number;
  connectedAt: number;
  downloadLimit?: number;
  uploadLimit?: number;
  isPaused?: boolean;
  token?: string;
  coinSlot?: string;
  coinSlotLockId?: string;
}

export interface WifiDevice {
  id: string;
  mac: string;
  ip: string;
  hostname: string;
  interface: string;
  ssid: string;
  signal: number;
  connectedAt: number;
  lastSeen: number;
  sessionTime?: number;
  isActive: boolean;
  customName?: string;
  totalPaid?: number;
  downloadLimit?: number;
  uploadLimit?: number;
}

export interface DeviceSession {
  id: number;
  deviceId: string;
  startTime: number;
  endTime?: number;
  duration: number;
  dataUsed: number;
}

export interface AnalyticsData {
  date: string;
  earnings: number;
  users: number;
}

export enum AdminTab {
  Analytics = 'analytics',
  Rates = 'rates',
  Network = 'network',
  Hardware = 'hardware',
  System = 'system',
  Updater = 'updater',
  Devices = 'devices',
  Themes = 'themes',
  PortalEditor = 'portal_editor',
  PPPoE = 'pppoe',
  Machines = 'machines',
  Bandwidth = 'bandwidth',
  MultiWan = 'multi_wan',
  Chat = 'chat',
  Vouchers = 'vouchers'
}

export interface UpdateLog {
  timestamp: string;
  version: string;
  description: string;
  status: 'success' | 'failed';
}

export interface BandwidthSettings {
  defaultDownloadLimit: number;
  defaultUploadLimit: number;
  autoApplyToNew: boolean;
}

export interface SystemStats {
  cpu: {
    manufacturer: string;
    brand: string;
    speed: number;
    cores: number;
    load: number;
    temp: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    active: number;
    available: number;
  };
  network: {
    iface: string;
    rx_bytes: number;
    tx_bytes: number;
    rx_sec: number;
    tx_sec: number;
  }[];
}

// ============================================
// VENDOR DASHBOARD TYPES
// ============================================

export interface VendorMachine {
  id: string;
  vendor_id: string;
  hardware_id: string;
  machine_name: string;
  location: string | null;
  license_key: string | null;
  is_licensed: boolean;
  activated_at: string | null;
  status: 'online' | 'offline' | 'maintenance';
  last_seen: string;
  coin_slot_pulses: number;
  total_revenue: number;
  created_at: string;
  updated_at: string;
  cpu_temp?: number;
  uptime_seconds?: number;
  active_sessions_count?: number;
  // Multi-coin slot data
  coin_slots_data?: {
    slot_id: number;
    pulses: number;
    revenue: number;
  }[];
}

export interface SalesLog {
  id: string;
  vendor_id: string;
  machine_id: string;
  amount: number;
  currency: string;
  session_duration: number | null;
  data_used: number | null;
  customer_mac: string | null;
  customer_ip: string | null;
  transaction_type: 'coin_insert' | 'voucher' | 'refund';
  created_at: string;
  notes: string | null;
}

export interface VendorDashboardSummary {
  vendor_id: string;
  total_machines: number;
  online_machines: number;
  total_revenue: number;
  total_transactions: number;
  revenue_24h: number;
  revenue_7d: number;
  revenue_30d: number;
}

export interface VendorProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface RealtimeVendorUpdate {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: 'vendors' | 'sales_logs';
  record: VendorMachine | SalesLog;
  old_record?: VendorMachine | SalesLog;
}

// ============================================
// VOUCHER SYSTEM TYPES
// ============================================

export interface Voucher {
  id: number;
  code: string;
  amount: number;
  time_minutes: number;
  created_at: string;
  used_at: string | null;
  used_by_mac: string | null;
  used_by_ip: string | null;
  is_used: 0 | 1;
  created_by: string;
}

export interface VoucherGenerationRequest {
  amount: number;
  time_minutes: number;
  count: number;
}

export interface VoucherActivationRequest {
  code: string;
}

export interface VoucherActivationResponse {
  success: boolean;
  mac: string;
  token: string;
  time_minutes: number;
  amount: number;
  message: string;
  error?: string;
}

// ============================================
// VOUCHER SYSTEM TYPES
// ============================================

export interface Voucher {
  id: number;
  code: string;
  amount: number;
  time_minutes: number;
  created_at: string;
  used_at: string | null;
  used_by_mac: string | null;
  used_by_ip: string | null;
  is_used: 0 | 1;
  created_by: string;
}

export interface VoucherGenerationRequest {
  amount: number;
  time_minutes: number;
  count: number;
}

export interface VoucherActivationRequest {
  code: string;
}

export interface VoucherActivationResponse {
  success: boolean;
  mac: string;
  token: string;
  time_minutes: number;
  amount: number;
  message: string;
  error?: string;
}

