
import { Rate, NetworkInterface, SystemConfig, WanConfig, VlanConfig, WifiDevice, DeviceSession, PPPoEServerConfig, PPPoEUser, PPPoESession, QoSConfig, PPPoEProfile, PPPoEBillingProfile, PPPoEPool, PPPoESale, MikrotikRouter, MikrotikBillingData, MikrotikRouterSnapshot } from '../types';

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
  async getSystemStats(): Promise<any> {
    const res = await fetch(`${API_BASE}/system/stats`, { headers: getHeaders() });
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

  async getSystemInfo(): Promise<any> {
    const res = await fetch(`${API_BASE}/system/info`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getSystemInterfaces(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/system/interfaces`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getMachineStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/machine/status`, { headers: getHeaders() });
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

  async getSalesSessions(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/sales/sessions`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async getSalesHistory(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/sales/history`, { headers: getHeaders() });
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

  async getPPPoESessions(): Promise<PPPoESession[]> {
    const res = await fetch(`${API_BASE}/network/pppoe/sessions`, { headers: getHeaders() });
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
    return res.json();
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
    return res.json();
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
  }
};
