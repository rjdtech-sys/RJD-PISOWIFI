
import { Rate, NetworkInterface, SystemConfig, WanConfig, VlanConfig, WanInterface, WifiDevice, DeviceSession, PPPoEServerConfig, PPPoEUser, PPPoESession, QoSConfig, PPPoEProfile, PPPoEBillingProfile, PPPoEPool, PPPoESale, MikrotikRouter, MikrotikBillingData, MikrotikRouterSnapshot, Employee, DTRRecord, PayrollRecord, Equipment, EquipmentWithdrawal, RentalDevice, RentalSession, RentalReport, PhoneRentalRate } from '../types';

const API_BASE = '/api';

const getHeaders = (customHeaders: HeadersInit = {}) => {
  const headers: Record<string, string> = { 
    'Content-Type': 'application/json',
    ...customHeaders as Record<string, string>
  };
  const token = localStorage.getItem('ajc_admin_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const userToken = (typeof document !== 'undefined')
    ? (document.cookie.split(';').map(s => s.trim()).find(c => c.startsWith('ajc_session_token='))?.split('=')[1] || localStorage.getItem('ajc_session_token'))
    : localStorage.getItem('ajc_session_token');
  if (userToken) {
    headers['X-Session-Token'] = userToken;
  }
  return headers;
};

const handleResponse = async (res: Response) => {
  const contentType = res.headers.get('content-type');
  if (!res.ok) {
    let errorMsg = `Server error: ${res.status}`;
    try {
      if (contentType?.includes('application/json')) {
        const errJson = await res.json();
        errorMsg = errJson.error || errorMsg;
      }
    } catch (e) { /* ignore */ }
    throw new Error(errorMsg);
  }
  return res.json();
};

export const apiClient = {
  // Fetch all rates from the database
  async getRates(): Promise<Rate[]> {
    const res = await fetch(`${API_BASE}/rates`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Add a new rate definition (fixing error in RatesManager)
  async addRate(
    pesos: number, 
    minutes: number, 
    expiration_hours?: number,
    mode?: 'pausable' | 'consumable'
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/rates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ 
        pesos, 
        minutes, 
        expiration_hours: expiration_hours ?? null,
        mode: mode || 'pausable'
      })
    });
    await handleResponse(res);
  },

  // Delete an existing rate definition (fixing error in RatesManager)
  async deleteRate(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/rates/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  // Get current system hardware configuration (fixing error in HardwareSetup)
  async getConfig(): Promise<SystemConfig> {
    const res = await fetch(`${API_BASE}/config`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Save hardware configuration changes (fixing error in HardwareSetup)
  async saveConfig(config: SystemConfig): Promise<void> {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    await handleResponse(res);
  },

  async getCentralPortalConfig(): Promise<{ enabled: boolean; ip: string }> {
    const res = await fetch(`${API_BASE}/config/central-portal`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async saveCentralPortalConfig(enabled: boolean, ip: string): Promise<void> {
    const res = await fetch(`${API_BASE}/config/central-portal`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ enabled, ip })
    });
    await handleResponse(res);
  },

  async getCentralizedKey(): Promise<{ key: string; syncEnabled: boolean }> {
    const res = await fetch(`${API_BASE}/config/centralized-key`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getSyncStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/sync/status`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async saveCentralizedKey(key?: string, syncEnabled?: boolean): Promise<void> {
    const body: any = {};
    if (typeof key !== 'undefined') body.key = key;
    if (typeof syncEnabled !== 'undefined') body.syncEnabled = syncEnabled;

    const res = await fetch(`${API_BASE}/config/centralized-key`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body)
    });
    await handleResponse(res);
  },

  // Get Portal Configuration
  async getPortalConfig(): Promise<any> {
    const res = await fetch(`${API_BASE}/portal/config`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Save Portal Configuration
  async savePortalConfig(config: any): Promise<void> {
    const res = await fetch(`${API_BASE}/portal/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    await handleResponse(res);
  },

  // Get QoS Configuration
  async getQoSConfig(): Promise<QoSConfig> {
    const res = await fetch(`${API_BASE}/config/qos`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Save QoS Configuration
  async saveQoSConfig(discipline: 'cake' | 'fq_codel'): Promise<void> {
    const res = await fetch(`${API_BASE}/config/qos`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ discipline })
    });
    await handleResponse(res);
  },

  // Gaming Priority
  async getGamingConfig(): Promise<{ enabled: boolean; percentage: number }> {
    const res = await fetch(`${API_BASE}/gaming/config`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async saveGamingConfig(enabled: boolean, percentage: number): Promise<void> {
    const res = await fetch(`${API_BASE}/gaming/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ enabled, percentage })
    });
    await handleResponse(res);
  },

  async getRewardsConfig(): Promise<{ enabled: boolean; thresholdPesos: number; rewardCreditPesos: number }> {
    const res = await fetch(`${API_BASE}/rewards/config`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async saveRewardsConfig(enabled: boolean, thresholdPesos: number, rewardCreditPesos: number): Promise<void> {
    const res = await fetch(`${API_BASE}/rewards/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ enabled, thresholdPesos, rewardCreditPesos })
    });
    await handleResponse(res);
  },

  async getGamingRules(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/gaming/rules`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async addGamingRule(name: string, protocol: string, port_start: number, port_end: number): Promise<void> {
    const res = await fetch(`${API_BASE}/gaming/rules`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, protocol, port_start, port_end })
    });
    await handleResponse(res);
  },

  async deleteGamingRule(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/gaming/rules/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },


  // Fetch available network interfaces from the kernel
  async getInterfaces(): Promise<NetworkInterface[]> {
    const res = await fetch(`${API_BASE}/interfaces`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async whoAmI(): Promise<{ ip: string; mac: string; vlanId?: number; recommendedNodeMCU?: { id: string; macAddress: string; name?: string }; canInsertCoin?: boolean; isRevoked?: boolean; creditPesos?: number; creditMinutes?: number }> {
    const res = await fetch(`${API_BASE}/whoami`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async reserveCoinSlot(slot: string): Promise<{ success: boolean; slot?: string; lockId?: string; expiresAt?: number; code?: string; busyUntil?: number; error?: string; status: number }> {
    const res = await fetch(`${API_BASE}/coinslot/reserve`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ slot })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...(data || {}) };
  },

  async addCredit(pesos: number, minutes?: number): Promise<{ success: boolean; status?: number }> {
    const payload: any = { pesos };
    if (typeof minutes === 'number') {
      payload.minutes = minutes;
    }
    const res = await fetch(`${API_BASE}/credits/add`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...(data || {}) };
  },

  async useCredit(pesos: number): Promise<{ success: boolean; error?: string; remainingMinutes?: number }> {
    const res = await fetch(`${API_BASE}/credits/use`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ pesos })
    });
    const data = await res.json().catch(() => ({}));
    return {
      success: !!data.success && res.ok,
      error: data.error,
      remainingMinutes: data.remainingMinutes
    };
  },

  async heartbeatCoinSlot(slot: string, lockId: string): Promise<{ success: boolean; expiresAt?: number; error?: string; status: number }> {
    const res = await fetch(`${API_BASE}/coinslot/heartbeat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ slot, lockId })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...(data || {}) };
  },

  async releaseCoinSlot(slot: string, lockId: string): Promise<{ success: boolean; status: number }> {
    const res = await fetch(`${API_BASE}/coinslot/release`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ slot, lockId })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...(data || {}) };
  },

  // Toggle interface up/down status
  async setInterfaceStatus(name: string, status: 'up' | 'down'): Promise<void> {
    const res = await fetch(`${API_BASE}/network/status`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, status })
    });
    await handleResponse(res);
  },

  // Update WAN configuration (DHCP or Static)
  async saveWanConfig(config: WanConfig): Promise<void> {
    const res = await fetch(`${API_BASE}/network/wan`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    await handleResponse(res);
  },

  // Create a new VLAN tagged interface
  async createVlan(vlan: VlanConfig): Promise<void> {
    const res = await fetch(`${API_BASE}/network/vlan`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ parent: vlan.parentInterface, id: vlan.id, name: vlan.name })
    });
    await handleResponse(res);
  },

  async createVlansBulk(payload: {
    parentInterface: string;
    ids?: number[];
    range?: { start: number; end: number };
    createHotspots?: boolean;
    netmask?: string;
    bandwidth_limit?: number;
  }): Promise<{
    success: boolean;
    summary?: any;
    results?: any[];
    dnsmasqRestarted?: boolean;
    dnsmasqRestartError?: string | null;
  }> {
    const res = await fetch(`${API_BASE}/network/vlans/bulk`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        parent: payload.parentInterface,
        ids: payload.ids,
        range: payload.range,
        createHotspots: payload.createHotspots,
        netmask: payload.netmask,
        bandwidth_limit: payload.bandwidth_limit
      })
    });
    return handleResponse(res);
  },

  async getVlans(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/network/vlans`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async deleteVlan(name: string): Promise<void> {
    const res = await fetch(`${API_BASE}/network/vlan/${name}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  // ============================================
  // WAN INTERFACE CRUD APIs
  // ============================================

  async getWanInterfaces(): Promise<{ success: boolean; wans: WanInterface[] }> {
    const res = await fetch(`${API_BASE}/multiwan/wans`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createWanInterface(wan: Omit<WanInterface, 'id' | 'created_at' | 'updated_at'>): Promise<{ success: boolean; wan: WanInterface }> {
    const res = await fetch(`${API_BASE}/multiwan/wans`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(wan)
    });
    return handleResponse(res);
  },

  async updateWanInterface(id: number, updates: Partial<WanInterface>): Promise<{ success: boolean; wan: WanInterface }> {
    const res = await fetch(`${API_BASE}/multiwan/wans/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deleteWanInterface(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/multiwan/wans/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async applyWanInterface(id: number): Promise<{ success: boolean; error?: string; status?: { status: string; ip: string | null }; gateway?: string | null }> {
    const res = await fetch(`${API_BASE}/multiwan/wans/${id}/apply`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async getWanInterfaceStatus(id: number): Promise<{ success: boolean; status: { status: string; ip: string | null } }> {
    const res = await fetch(`${API_BASE}/multiwan/wans/${id}/status`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getWanInterfaceSpeed(id: number): Promise<{ success: boolean; speed: { ping_ms: number | null; speed_mbps: number | null } }> {
    const res = await fetch(`${API_BASE}/multiwan/wans/${id}/speed`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getInterfaceSpeedByName(name: string): Promise<{ success: boolean; speed: { ping_ms: number | null; speed_mbps: number | null } }> {
    const res = await fetch(`${API_BASE}/network/interface/${encodeURIComponent(name)}/speed`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getDefaultWan(): Promise<{ success: boolean; interface: string | null }> {
    const res = await fetch(`${API_BASE}/network/default-wan`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Create a software bridge interface with member ports
  async createBridge(name: string, members: string[], stp: boolean): Promise<string> {
    const res = await fetch(`${API_BASE}/network/bridge`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, members, stp })
    });
    const data = await handleResponse(res);
    return data.output;
  },

  async getBridges(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/network/bridges`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async deleteBridge(name: string): Promise<void> {
    const res = await fetch(`${API_BASE}/network/bridge/${name}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  // Device Management APIs
  async getWifiDevices(): Promise<WifiDevice[]> {
    const res = await fetch(`${API_BASE}/devices`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getWifiDevice(id: string): Promise<WifiDevice> {
    const res = await fetch(`${API_BASE}/devices/${id}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createWifiDevice(device: Omit<WifiDevice, 'id' | 'connectedAt' | 'lastSeen'>): Promise<WifiDevice> {
    const res = await fetch(`${API_BASE}/devices`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(device)
    });
    return handleResponse(res);
  },

  async updateWifiDevice(id: string, updates: Partial<WifiDevice>): Promise<WifiDevice> {
    const res = await fetch(`${API_BASE}/devices/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deleteWifiDevice(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/devices/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  async connectDevice(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/devices/${id}/connect`, {
      method: 'POST',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  async disconnectDevice(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/devices/${id}/disconnect`, {
      method: 'POST',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  async getDeviceSessions(deviceId: string): Promise<DeviceSession[]> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/sessions`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Network refresh function to help devices reconnect after session creation
  async refreshNetworkConnection(): Promise<{ success: boolean; message?: string }> {
    const res = await fetch(`${API_BASE}/network/refresh`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // System Stats API
  async getSystemStats(signal?: AbortSignal): Promise<any> {
    const res = await fetch(`${API_BASE}/system/stats`, { headers: getHeaders(), signal });
    return handleResponse(res);
  },

  async getPendingUpdate(): Promise<any> {
    const res = await fetch(`${API_BASE}/system/updates/pending`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async acceptUpdate(): Promise<void> {
    const res = await fetch(`${API_BASE}/system/updates/accept`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({})
    });
    await handleResponse(res);
  },

  async rejectUpdate(): Promise<void> {
    const res = await fetch(`${API_BASE}/system/updates/reject`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({})
    });
    await handleResponse(res);
  },

  async restartSystem(type: 'soft' | 'hard' = 'soft'): Promise<void> {
    const res = await fetch(`${API_BASE}/system/restart`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type })
    });
    await handleResponse(res);
  },

  async getSystemInfo(signal?: AbortSignal): Promise<any> {
    const res = await fetch(`${API_BASE}/system/info`, { headers: getHeaders(), signal });
    return handleResponse(res);
  },

  async getSystemInterfaces(signal?: AbortSignal): Promise<string[]> {
    const res = await fetch(`${API_BASE}/system/interfaces`, { headers: getHeaders(), signal });
    return handleResponse(res);
  },

  async getMachineStatus(signal?: AbortSignal): Promise<any> {
    const res = await fetch(`${API_BASE}/machine/status`, { headers: getHeaders(), signal });
    return handleResponse(res);
  },

  // Hotspot Management APIs
  async getHotspots(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/hotspots`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createHotspot(hotspot: any): Promise<void> {
    const res = await fetch(`${API_BASE}/hotspots`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(hotspot)
    });
    await handleResponse(res);
  },

  async deleteHotspot(interfaceName: string): Promise<void> {
    const res = await fetch(`${API_BASE}/hotspots/${interfaceName}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  // Wireless Management APIs
  async getWirelessConfigs(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/network/wireless`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async saveWirelessConfig(config: any): Promise<void> {
    const res = await fetch(`${API_BASE}/network/wireless`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    await handleResponse(res);
  },

  // Device Scan & Refresh APIs
  async scanDevices(): Promise<WifiDevice[]> {
    const res = await fetch(`${API_BASE}/devices/scan`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async refreshDevice(deviceId: string): Promise<WifiDevice> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/refresh`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // System Management
  async factoryReset(): Promise<void> {
    const res = await fetch(`${API_BASE}/system/reset`, {
      method: 'POST',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const res = await fetch(`${API_BASE}/admin/change-password`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ oldPassword, newPassword })
    });
    await handleResponse(res);
  },

  // NodeMCU Flasher
  async getUSBDevices(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/system/usb-devices`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async flashNodeMCU(port: string): Promise<{ success: boolean; message: string; output?: string }> {
    const res = await fetch(`${API_BASE}/system/flash-nodemcu`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ port })
    });
    return handleResponse(res);
  },

  async getSessions(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/sessions`);
    return handleResponse(res);
  },

  async getMySession(): Promise<any | null> {
    try {
      const res = await fetch(`${API_BASE}/sessions/me`);
      if (!res.ok) return null;
      return handleResponse(res);
    } catch {
      return null;
    }
  },

  async getSalesSessions(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/sales/sessions`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getSalesHistory(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/sales/history`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getSalesInventory(params?: { from?: string; to?: string; coinslot?: string; type?: string }): Promise<{
    sales: any[];
    coinslots: string[];
    totals: Record<string, { amount: number; count: number }>;
    grandTotal: { amount: number; count: number };
    todayTotal: { amount: number; count: number };
  }> {
    const queryParams = new URLSearchParams();
    if (params?.from) queryParams.append('from', params.from);
    if (params?.to) queryParams.append('to', params.to);
    if (params?.coinslot) queryParams.append('coinslot', params.coinslot);
    if (params?.type) queryParams.append('type', params.type);
    
    const queryString = queryParams.toString();
    const url = `${API_BASE}/sales/inventory${queryString ? `?${queryString}` : ''}`;
    
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },

  async pauseSession(token: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/sessions/pause`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ token })
    });
    return handleResponse(res);
  },

  async resumeSession(token: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/sessions/resume`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ token })
    });
    return handleResponse(res);
  },

  // PPPoE Server Management APIs
  async getPPPoEServerStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/network/pppoe/status`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async startPPPoEServer(config: PPPoEServerConfig): Promise<{ success: boolean; message?: string }> {
    const res = await fetch(`${API_BASE}/network/pppoe/start`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    return handleResponse(res);
  },

  async stopPPPoEServer(interfaceName: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/stop`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ interface: interfaceName })
    });
    return handleResponse(res);
  },

  async restartPPPoEServer(): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/restart`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async getPPPoESessions(signal?: AbortSignal): Promise<PPPoESession[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/sessions`, { headers: getHeaders(), signal });
    return handleResponse(res);
  },

  async getPPPoEUsers(): Promise<PPPoEUser[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/users`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async addPPPoEUser(
    username: string,
    password: string,
    billing_profile_id?: number,
    expires_at?: string,
    info?: { full_name?: string; address?: string; contact_number?: string; email?: string }
  ): Promise<{ success: boolean; id?: number; account_number?: string }> {
    const res = await fetch(`${API_BASE}/network/pppoe/users`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ username, password, billing_profile_id, expires_at, ...(info || {}) })
    });
    return handleResponse(res);
  },

  async getPPPoEUserFormPdf(userId: number, download = false): Promise<Blob> {
    const res = await fetch(`${API_BASE}/network/pppoe/users/${userId}/form.pdf${download ? '?download=1' : ''}`, {
      headers: getHeaders()
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg);
    }
    return await res.blob();
  },

  // PPPoE Profile APIs
  async getPPPoEProfiles(): Promise<PPPoEProfile[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/profiles`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async addPPPoEProfile(profile: PPPoEProfile): Promise<void> {
    const res = await fetch(`${API_BASE}/network/pppoe/profiles`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(profile)
    });
    await handleResponse(res);
  },

  async deletePPPoEProfile(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/network/pppoe/profiles/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  // PPPoE Billing Profile APIs
  async getPPPoEBillingProfiles(): Promise<PPPoEBillingProfile[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/billing-profiles`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async addPPPoEBillingProfile(profile: Partial<PPPoEBillingProfile>): Promise<void> {
    const res = await fetch(`${API_BASE}/network/pppoe/billing-profiles`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(profile)
    });
    await handleResponse(res);
  },

  async deletePPPoEBillingProfile(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/network/pppoe/billing-profiles/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    await handleResponse(res);
  },

  // PPPoE IP Pool APIs
  async getPPPoEPools(): Promise<PPPoEPool[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/pools`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async addPPPoEPool(pool: Partial<PPPoEPool>): Promise<{ success: boolean; id?: number }> {
    const res = await fetch(`${API_BASE}/network/pppoe/pools`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(pool)
    });
    return handleResponse(res);
  },

  async updatePPPoEPool(id: number, updates: Partial<PPPoEPool>): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/pools/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deletePPPoEPool(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/pools/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // PPPoE Logs API
  async getPPPoELogs(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/logs`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getPPPoEExpiredSettings(): Promise<any> {
    const res = await fetch(`${API_BASE}/network/pppoe/expired-settings`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async savePPPoEExpiredSettings(pool_id?: number | null, redirect_ip?: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/expired-settings`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ pool_id: pool_id ?? null, redirect_ip: redirect_ip ?? '' })
    });
    return handleResponse(res);
  },

  async getPPPoESales(): Promise<PPPoESale[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/sales`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async deletePPPoESale(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/sales/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async getPPPoESaleReceiptPdf(saleId: number, download = false): Promise<Blob> {
    const res = await fetch(`${API_BASE}/network/pppoe/sales/${saleId}/receipt.pdf${download ? '?download=1' : ''}`, {
      headers: getHeaders()
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg);
    }
    return await res.blob();
  },

  async createPPPoESale(payload: { user_id: number; billing_profile_id?: number; payment_method?: string; notes?: string; discount_days?: number; apply_renewal?: boolean }): Promise<{ success: boolean; id?: number }> {
    const res = await fetch(`${API_BASE}/network/pppoe/sales`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  async updatePPPoEUser(id: number, updates: Partial<PPPoEUser>): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/users/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deletePPPoEUser(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/network/pppoe/users/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // Bandwidth Management APIs
  async getBandwidthSettings(): Promise<any> {
    const res = await fetch(`${API_BASE}/bandwidth/settings`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async saveBandwidthSettings(settings: any): Promise<void> {
    const res = await fetch(`${API_BASE}/bandwidth/settings`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(settings)
    });
    await handleResponse(res);
  },

  // NodeMCU Device Management APIs
  async registerNodeMCU(macAddress: string, ipAddress: string, authenticationKey: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/register`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ macAddress, ipAddress, authenticationKey })
    });
    return handleResponse(res);
  },

  async authenticateNodeMCU(macAddress: string, authenticationKey: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/authenticate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ macAddress, authenticationKey })
    });
    return handleResponse(res);
  },

  async updateNodeMCUStatus(deviceId: string, status: 'pending' | 'accepted' | 'rejected', name?: string, vlanId?: number): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}/status`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ status, name, vlanId })
    });
    return handleResponse(res);
  },

  async acceptNodeMCUDevice(deviceId: string, name?: string, vlanId?: number): Promise<any> {
    return this.updateNodeMCUStatus(deviceId, 'accepted', name, vlanId);
  },

  async rejectNodeMCUDevice(deviceId: string): Promise<any> {
    return this.updateNodeMCUStatus(deviceId, 'rejected');
  },

  async removeNodeMCUDevice(deviceId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async updateNodeMCURates(deviceId: string, rates: any[]): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}/rates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ rates })
    });
    return handleResponse(res);
  },

  async saveNodeMCUCoinsOut(deviceId: string, data: { gross: number; net: number; share: number; date?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}/coinsout`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },

  async updateNodeMCUFirmware(deviceId: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('firmware', file);
    
    // Create a Headers instance to properly handle headers
    const headers = new Headers();
    const token = localStorage.getItem('ajc_admin_token');
    if (token) {
      headers.append('Authorization', `Bearer ${token}`);
    }
    // Note: Do NOT set Content-Type, fetch will set it with the boundary for FormData
    
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}/update`, {
      method: 'POST',
      headers,
      body: formData
    });
    return handleResponse(res);
  },

  async getNodeMCUDevices(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/nodemcu/devices`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async sendNodeMCUConfig(deviceId: string, config: any): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    return handleResponse(res);
  },

  async getNodeMCUDevice(deviceId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/${deviceId}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getAvailableNodeMCUDevices(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/nodemcu/available`);
    return handleResponse(res);
  },

  async checkNodeMCUStatus(macAddress: string): Promise<{ online: boolean, lastSeen: string, license?: { isValid: boolean, isTrial: boolean, isExpired: boolean, error?: string } }> {
    const res = await fetch(`${API_BASE}/nodemcu/status/${macAddress}`);
    return handleResponse(res);
  },

  // NodeMCU License Management APIs
  async getNodeMCULicenseStatus(macAddress: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/license/status/${macAddress}`, { 
      headers: getHeaders() 
    });
    return handleResponse(res);
  },

  async activateNodeMCULicense(licenseKey: string, macAddress: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/license/activate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ licenseKey, macAddress })
    });
    return handleResponse(res);
  },

  async startNodeMCUTrial(macAddress: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/license/trial`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ macAddress })
    });
    return handleResponse(res);
  },

  async revokeNodeMCULicense(licenseKey: string): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/license/revoke`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ licenseKey })
    });
    return handleResponse(res);
  },

  async generateNodeMCULicenses(count: number = 1, licenseType: 'standard' | 'premium' = 'standard', expirationMonths?: number): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/license/generate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ count, licenseType, expirationMonths })
    });
    return handleResponse(res);
  },

  async getVendorNodeMCULicenses(): Promise<any> {
    const res = await fetch(`${API_BASE}/nodemcu/license/vendor`, { 
      headers: getHeaders() 
    });
    return handleResponse(res);
  },

  async getAdminTheme(): Promise<string> {
    const res = await fetch(`${API_BASE}/admin/theme`, { headers: getHeaders() });
    const data = await handleResponse(res);
    return data.theme;
  },

  async saveAdminTheme(theme: string): Promise<void> {
    const res = await fetch(`${API_BASE}/admin/theme`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ theme })
    });
    await handleResponse(res);
  },

  async getCustomThemes(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/admin/custom-themes`, { headers: getHeaders() });
    const data = await handleResponse(res);
    return data.themes;
  },

  async saveCustomThemes(themes: any[]): Promise<void> {
    const res = await fetch(`${API_BASE}/admin/custom-themes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ themes })
    });
    await handleResponse(res);
  },

  async saveMainCoinsOut(data: { gross: number; net: number; date?: string }): Promise<any> {
    const res = await fetch(`${API_BASE}/admin/coinsout`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },

  async getCompanySettings(): Promise<{ companyName: string, companyLogo: string | null }> {
    const res = await fetch(`${API_BASE}/settings/company`);
    return handleResponse(res);
  },

  async updateCompanySettings(formData: FormData): Promise<{ companyName: string, companyLogo: string | null }> {
    const token = localStorage.getItem('ajc_admin_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/settings/company`, {
      method: 'POST',
      headers: headers,
      body: formData
    });
    return handleResponse(res);
  }
  ,
  async getMikrotikRouters(): Promise<MikrotikRouter[]> {
    const res = await fetch(`${API_BASE}/mikrotik/routers`, { headers: getHeaders() });
    return handleResponse(res);
  }
  ,
  async createMikrotikRouter(payload: { name: string; host: string; port?: number; connection_type?: 'api' | 'rest'; rest_scheme?: 'http' | 'https'; username: string; password: string }): Promise<MikrotikRouter> {
    const res = await fetch(`${API_BASE}/mikrotik/routers`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  }
  ,
  async updateMikrotikRouter(id: string, payload: { name?: string; host?: string; port?: number; connection_type?: 'api' | 'rest'; rest_scheme?: 'http' | 'https'; username?: string; password?: string }): Promise<MikrotikRouter> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  }
  ,
  async deleteMikrotikRouter(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  }
  ,
  async testMikrotikRouter(id: string): Promise<{ success: boolean; snapshot?: MikrotikRouterSnapshot; error?: string }> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  }
  ,
  async testMikrotikRouterDraft(payload: { host: string; port?: number; connection_type?: 'api' | 'rest'; rest_scheme?: 'http' | 'https'; username: string; password: string }): Promise<{ success: boolean; snapshot?: MikrotikRouterSnapshot; error?: string }> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/test`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  }
  ,
  async getMikrotikBillingData(id: string): Promise<MikrotikBillingData> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(id)}/billing`, { headers: getHeaders() });
    return handleResponse(res);
  },
  async createMikrotikSecret(routerId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/secrets`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async updateMikrotikSecret(routerId: string, secretId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/secrets/${encodeURIComponent(secretId)}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async deleteMikrotikSecret(routerId: string, secretId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/secrets/${encodeURIComponent(secretId)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },
  async createMikrotikProfile(routerId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/profiles`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async updateMikrotikProfile(routerId: string, profileId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/profiles/${encodeURIComponent(profileId)}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async deleteMikrotikProfile(routerId: string, profileId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },
  async disconnectMikrotikActive(routerId: string, activeId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/active/${encodeURIComponent(activeId)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },
  async getMikrotikProfiles(routerId: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/profiles`, { headers: getHeaders() });
    return handleResponse(res);
  },
  async getMikrotikSales(routerId: string, startDate?: string, endDate?: string): Promise<any[]> {
    let url = `${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/sales`;
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (params.toString()) url += `?${params.toString()}`;
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },
  async processMikrotikPayment(routerId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/process-payment`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async getMikrotikBillingPlans(routerId: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/billing-plans`, { headers: getHeaders() });
    return handleResponse(res);
  },
  async createMikrotikBillingPlan(routerId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/billing-plans`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async updateMikrotikBillingPlan(routerId: string, planId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/billing-plans/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async deleteMikrotikBillingPlan(routerId: string, planId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/routers/${encodeURIComponent(routerId)}/billing-plans/${encodeURIComponent(planId)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },
  // Sales CRUD operations
  async getMikrotikSale(saleId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/sales/${encodeURIComponent(saleId)}`, { headers: getHeaders() });
    return handleResponse(res);
  },
  async updateMikrotikSale(saleId: string, data: any): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/sales/${encodeURIComponent(saleId)}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },
  async deleteMikrotikSale(saleId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/mikrotik/sales/${encodeURIComponent(saleId)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // Free Internet API
  async getFreeInternetConfig(): Promise<{ enabled: boolean; minutes: number; message: string; cooldownDays: number }> {
    const res = await fetch(`${API_BASE}/free-internet/config`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async setFreeInternetConfig(config: { enabled: boolean; minutes: number; message: string; cooldownDays: number }): Promise<{ success: boolean; config: any }> {
    const res = await fetch(`${API_BASE}/free-internet/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    return handleResponse(res);
  },

  async claimFreeInternet(): Promise<{ success: boolean; minutes: number; message: string; token: string; cooldownDays: number }> {
    const res = await fetch(`${API_BASE}/free-internet/claim`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // Audio Files API
  async getAudioFiles(): Promise<{ name: string; path: string; size: number; modified: string }[]> {
    const res = await fetch(`${API_BASE}/admin/audio-files`, { headers: getHeaders() });
    const data = await handleResponse(res);
    return data.files || [];
  },

  // Voucher APIs
  async createVoucher(payload: { code: string; amount: number; time_minutes: number; voucher_type?: 'time_based' | 'monthly'; duration_days?: number }): Promise<{ success: boolean; voucher: any; message: string }> {
    const res = await fetch(`${API_BASE}/vouchers`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  // Employee Management APIs
  async getEmployees(): Promise<Employee[]> {
    const res = await fetch(`${API_BASE}/employees`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createEmployee(employee: Omit<Employee, 'id' | 'created_at' | 'updated_at'>): Promise<Employee> {
    const res = await fetch(`${API_BASE}/employees`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(employee)
    });
    return handleResponse(res);
  },

  async updateEmployee(id: number, updates: Partial<Employee>): Promise<Employee> {
    const res = await fetch(`${API_BASE}/employees/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deleteEmployee(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/employees/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // DTR APIs
  async getDTRRecords(params?: { employee_id?: number; from?: string; to?: string }): Promise<DTRRecord[]> {
    const queryParams = new URLSearchParams();
    if (params?.employee_id) queryParams.append('employee_id', String(params.employee_id));
    if (params?.from) queryParams.append('from', params.from);
    if (params?.to) queryParams.append('to', params.to);
    const queryString = queryParams.toString();
    const url = `${API_BASE}/dtr${queryString ? `?${queryString}` : ''}`;
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createDTRRecord(record: Omit<DTRRecord, 'id' | 'created_at'>): Promise<DTRRecord> {
    const res = await fetch(`${API_BASE}/dtr`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(record)
    });
    return handleResponse(res);
  },

  async updateDTRRecord(id: number, updates: Partial<DTRRecord>): Promise<DTRRecord> {
    const res = await fetch(`${API_BASE}/dtr/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deleteDTRRecord(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/dtr/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // Payroll APIs
  async getPayrollRecords(params?: { employee_id?: number; from?: string; to?: string }): Promise<PayrollRecord[]> {
    const queryParams = new URLSearchParams();
    if (params?.employee_id) queryParams.append('employee_id', String(params.employee_id));
    if (params?.from) queryParams.append('from', params.from);
    if (params?.to) queryParams.append('to', params.to);
    const queryString = queryParams.toString();
    const url = `${API_BASE}/payroll${queryString ? `?${queryString}` : ''}`;
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },

  async generatePayroll(payload: { employee_id: number; period_start: string; period_end: string; deductions?: number; notes?: string }): Promise<PayrollRecord> {
    const res = await fetch(`${API_BASE}/payroll/generate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  async updatePayroll(id: number, updates: Partial<PayrollRecord>): Promise<PayrollRecord> {
    const res = await fetch(`${API_BASE}/payroll/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deletePayroll(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/payroll/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // Equipment Inventory APIs
  async getEquipment(): Promise<Equipment[]> {
    const res = await fetch(`${API_BASE}/equipment`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createEquipment(item: Omit<Equipment, 'id' | 'created_at' | 'updated_at'>): Promise<Equipment> {
    const res = await fetch(`${API_BASE}/equipment`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(item)
    });
    return handleResponse(res);
  },

  async updateEquipment(id: number, updates: Partial<Equipment>): Promise<Equipment> {
    const res = await fetch(`${API_BASE}/equipment/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deleteEquipment(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/equipment/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // Equipment Withdrawal APIs
  async getEquipmentWithdrawals(): Promise<EquipmentWithdrawal[]> {
    const res = await fetch(`${API_BASE}/equipment-withdrawals`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createEquipmentWithdrawal(payload: { client_name: string; withdrawal_date: string; notes?: string; items: { equipment_id: number; quantity: number }[] }): Promise<EquipmentWithdrawal> {
    const res = await fetch(`${API_BASE}/equipment-withdrawals`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  async deleteEquipmentWithdrawal(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/equipment-withdrawals/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // ============================================
  // PHONE RENTAL APIs
  // ============================================

  async getRentalDevices(): Promise<RentalDevice[]> {
    const res = await fetch(`${API_BASE}/phone-rental/devices`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createRentalDevice(device: Partial<RentalDevice>): Promise<RentalDevice> {
    const res = await fetch(`${API_BASE}/phone-rental/devices`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(device)
    });
    return handleResponse(res);
  },

  async updateRentalDevice(id: number, updates: Partial<RentalDevice>): Promise<RentalDevice> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    });
    return handleResponse(res);
  },

  async deleteRentalDevice(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async bypassRentalDevice(id: number): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${id}/bypass`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async unblockRentalDevice(id: number): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${id}/unblock`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async startRentalSession(payload: { device_id: number; customer_name?: string; customer_contact?: string; duration_minutes: number; amount_paid?: number; payment_method?: string; notes?: string }): Promise<RentalSession> {
    const res = await fetch(`${API_BASE}/phone-rental/sessions/start`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  async endRentalSession(sessionId: number): Promise<RentalSession> {
    const res = await fetch(`${API_BASE}/phone-rental/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async extendRentalSession(sessionId: number, payload: { additional_minutes: number; amount_paid?: number; payment_method?: string }): Promise<RentalSession> {
    const res = await fetch(`${API_BASE}/phone-rental/sessions/${sessionId}/extend`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },

  async kioskLogoutSession(sessionId: number, reason?: string): Promise<RentalSession> {
    const res = await fetch(`${API_BASE}/phone-rental/sessions/${sessionId}/kiosk-logout`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ reason })
    });
    return handleResponse(res);
  },

  async kioskResumeSession(sessionId: number): Promise<RentalSession> {
    const res = await fetch(`${API_BASE}/phone-rental/sessions/${sessionId}/kiosk-resume`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async getRentalSessions(filters?: { status?: string; device_id?: number }): Promise<RentalSession[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.device_id) params.set('device_id', String(filters.device_id));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/phone-rental/sessions${query}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getRentalReport(): Promise<RentalReport> {
    const res = await fetch(`${API_BASE}/phone-rental/report`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getRentalDeviceAllowedApps(deviceId: number): Promise<{ allowed_apps: string[] }> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/allowed-apps`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async setRentalDeviceAllowedApps(deviceId: number, allowedApps: string[]): Promise<{ success: boolean; allowed_apps: string[] }> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/allowed-apps`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ allowed_apps: allowedApps })
    });
    return handleResponse(res);
  },

  // Activation System
  async acceptRentalDevice(deviceId: number): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/accept`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async rejectRentalDevice(deviceId: number): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/reject`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async activateRentalDevice(deviceId: number, activationKey: string): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/activate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ activation_key: activationKey })
    });
    return handleResponse(res);
  },

  async deactivateRentalDevice(deviceId: number): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/deactivate`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async reactivateRentalDevice(deviceId: number): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/devices/${deviceId}/reactivate`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async getRentalActivationKeys(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/phone-rental/activation-keys`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async generateRentalActivationKeys(count: number, licenseType: string = 'standard', expirationMonths: number | null = null): Promise<any[]> {
    const res = await fetch(`${API_BASE}/phone-rental/activation-keys/generate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ count, license_type: licenseType, expiration_months: expirationMonths })
    });
    return handleResponse(res);
  },

  async syncRentalDevicesToCloud(): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/sync-to-cloud`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  async syncRentalSessionsToCloud(): Promise<any> {
    const res = await fetch(`${API_BASE}/phone-rental/sync-sessions-to-cloud`, {
      method: 'POST',
      headers: getHeaders()
    });
    return handleResponse(res);
  },

  // ============================================
  // PHONE RENTAL - COINSLOT RATES
  // ============================================

  async getPhoneRentalRates(): Promise<PhoneRentalRate[]> {
    const res = await fetch(`${API_BASE}/phone-rental/rates`);
    if (!res.ok) throw new Error('Failed to fetch rental rates');
    const data = await res.json();
    return data.rates || [];
  },

  async savePhoneRentalRates(rates: PhoneRentalRate[]): Promise<void> {
    const res = await fetch(`${API_BASE}/phone-rental/rates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ rates })
    });
    if (!res.ok) throw new Error('Failed to save rental rates');
  }
};
