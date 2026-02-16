import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { NetworkInterface, HotspotInstance, VlanConfig, WirelessConfig, PPPoEServerConfig, PPPoEUser, PPPoESession } from '../../types';

const NetworkSettings: React.FC = () => {
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [hotspots, setHotspots] = useState<HotspotInstance[]>([]);
  const [wirelessArr, setWirelessArr] = useState<WirelessConfig[]>([]);
  const [loading, setLoading] = useState(false);
  
  // State for Wireless AP Setup
  const [newWifi, setNewWifi] = useState<Partial<WirelessConfig & { bridge?: string }>>({
    interface: '',
    ssid: 'AJC_PISOWIFI',
    password: '',
    channel: 1,
    hw_mode: 'g',
    bridge: ''
  });

  // State for Hotspot Portal Setup
  const [newHS, setNewHS] = useState<Partial<HotspotInstance> & { netmask?: string; dhcp_start?: string; dhcp_end?: string; dhcp_gateway?: string }>({
    interface: '',
    ip_address: '10.0.10.1',
    dhcp_range: '10.0.10.50,10.0.10.250',
    netmask: '255.255.255.0',
    dhcp_start: '10.0.10.50',
    dhcp_end: '10.0.10.250',
    dhcp_gateway: '10.0.10.1',
    bandwidth_limit: 10
  });

  // VLAN State
  const [vlan, setVlan] = useState<VlanConfig>({ id: 10, parentInterface: 'eth0', name: 'eth0.10' });
  const [vlans, setVlans] = useState<any[]>([]);

  // Bridge State
  const [bridge, setBridge] = useState({ name: 'br0', members: [] as string[], stp: false });
  const [bridges, setBridges] = useState<any[]>([]);

  const makeSafeVlanName = (parent: string, id: number) => {
    const base = (parent || '').split('.')[0];
    const suffix = `.${id}`;
    const maxLen = 15;
    const candidate = `${base}${suffix}`;
    if (candidate.length <= maxLen) return candidate;
    const allowed = maxLen - suffix.length;
    if (allowed <= 0) return `v${id}`;
    return `${base.slice(0, allowed)}${suffix}`;
  };



  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ifaces, hs, wifi, v, b] = await Promise.all([
        apiClient.getInterfaces(),
        apiClient.getHotspots().catch(() => []),
        apiClient.getWirelessConfigs().catch(() => []),
        apiClient.getVlans().catch(() => []),
        apiClient.getBridges().catch(() => [])
      ]);
      setInterfaces(ifaces.filter(i => !i.isLoopback));
      setHotspots(Array.isArray(hs) ? hs : []);
      setWirelessArr(Array.isArray(wifi) ? wifi : []);
      setVlans(Array.isArray(v) ? v : []);
      setBridges(Array.isArray(b) ? b : []);
    } catch (err) { 
      console.error('[UI] Data Load Error:', err); 
    }
    finally { setLoading(false); }
  };

  const deployWireless = async (ifaceName?: string) => {
    const targetInterface = ifaceName || newWifi.interface;
    if (!targetInterface || !newWifi.ssid) return alert('Select interface and SSID!');
    
    try {
      setLoading(true);
      await apiClient.saveWirelessConfig({ ...newWifi, interface: targetInterface });
      await loadData();
      alert('Wi-Fi AP Broadcast Started!');
    } catch (e) { alert('Failed to deploy Wireless AP.'); }
    finally { setLoading(false); }
  };

  const createHotspot = async () => {
    if (!newHS.interface) return alert('Select interface!');
    const gateway = newHS.dhcp_gateway || newHS.ip_address;
    const start = newHS.dhcp_start || (newHS.dhcp_range ? String(newHS.dhcp_range).split(',')[0] : '');
    const end = newHS.dhcp_end || (newHS.dhcp_range ? String(newHS.dhcp_range).split(',')[1] : '');
    if (!gateway || !start || !end) return alert('Complete DHCP fields!');
    try {
      setLoading(true);
      await apiClient.createHotspot({
        interface: newHS.interface,
        ip_address: gateway,
        dhcp_range: `${start},${end}`,
        bandwidth_limit: newHS.bandwidth_limit || 10,
        netmask: newHS.netmask
      });
      await loadData();
      alert('Hotspot Portal Segment Deployed!');
    } catch (e) { alert('Failed to deploy Hotspot.'); }
    finally { setLoading(false); }
  };

  const deleteHotspot = async (iface: string) => {
    if (!confirm(`Stop and remove portal segment on ${iface}?`)) return;
    try {
      setLoading(true);
      await apiClient.deleteHotspot(iface);
      await loadData();
    } catch (e) { alert('Failed to remove portal.'); }
    finally { setLoading(false); }
  };

  const generateVlan = async () => {
    try {
      setLoading(true);
      await apiClient.createVlan(vlan);
      await loadData();
      alert(`VLAN ${vlan.name} created!`);
    } catch (e) { alert('Failed to create VLAN.'); }
    finally { setLoading(false); }
  };

  const deployBridge = async () => {
    if (!bridge.name || bridge.members.length === 0) return alert('Bridge name and members required!');
    try {
      setLoading(true);
      await apiClient.createBridge(bridge.name, bridge.members, bridge.stp);
      await loadData();
      alert(`Bridge ${bridge.name} created! Members have been flushed to prevent IP conflicts.`);
    } catch (e) { alert('Failed to create Bridge.'); }
    finally { setLoading(false); }
  };

  const deleteVlan = async (name: string) => {
    if (!confirm(`Delete VLAN ${name}? This may disrupt connectivity.`)) return;
    try {
      setLoading(true);
      await apiClient.deleteVlan(name);
      await loadData();
    } catch (e) { alert('Failed to delete VLAN.'); }
    finally { setLoading(false); }
  };

  const deleteBridge = async (name: string) => {
    if (!confirm(`Delete Bridge ${name}? This may disrupt connectivity.`)) return;
    try {
      setLoading(true);
      await apiClient.deleteBridge(name);
      await loadData();
    } catch (e) { alert('Failed to delete Bridge.'); }
    finally { setLoading(false); }
  };

  const toggleBridgeMember = (iface: string) => {
    setBridge(prev => ({
      ...prev,
      members: prev.members.includes(iface) 
        ? prev.members.filter(m => m !== iface) 
        : [...prev.members, iface]
    }));
  };

  const ipToInt = (ip: string) => ip.split('.').reduce((a, b) => (a << 8) + (parseInt(b, 10) & 255), 0) >>> 0;
  const intToIp = (n: number) => [ (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255 ].join('.');
  const calcDhcpRange = (gateway: string, mask: string) => {
    if (!gateway || !mask) return { start: '', end: '' };
    const gw = ipToInt(gateway);
    const m = ipToInt(mask);
    const network = gw & m;
    const broadcast = network | (~m >>> 0);
    const countBits = (n: number) => ((n & 128 ? 1 : 0) + (n & 64 ? 1 : 0) + (n & 32 ? 1 : 0) + (n & 16 ? 1 : 0) + (n & 8 ? 1 : 0) + (n & 4 ? 1 : 0) + (n & 2 ? 1 : 0) + (n & 1 ? 1 : 0));
    const prefix = [ (m >>> 24) & 255, (m >>> 16) & 255, (m >>> 8) & 255, m & 255 ].reduce((a, b) => a + countBits(b), 0);
    const large = prefix <= 23;
    const baseStartOffset = large ? 100 : 50;
    const baseEndOffset = large ? 500 : 250;
    let start = Math.min(Math.max(network + baseStartOffset, network + 10), broadcast - 10);
    let end = Math.min(network + baseEndOffset, broadcast - 10);
    if (end <= start) end = Math.min(start + 30, broadcast - 10);
    if (gw === start) start = Math.min(start + 10, broadcast - 10);
    if (gw === end) end = Math.min(end - 10, broadcast - 10);
    return { start: intToIp(start), end: intToIp(end) };
  };
  const handleNetmaskChange = (mask: string) => {
    const gw = newHS.dhcp_gateway || newHS.ip_address || '';
    const { start, end } = calcDhcpRange(gw, mask);
    setNewHS({ ...newHS, netmask: mask, dhcp_start: start, dhcp_end: end });
  };

  const [editHS, setEditHS] = useState<Partial<HotspotInstance> & { netmask?: string; dhcp_start?: string; dhcp_end?: string; dhcp_gateway?: string } | null>(null);
  const startEdit = (hs: HotspotInstance) => {
    const parts = String(hs.dhcp_range || '').split(',');
    const start = parts[0] || '';
    const end = parts[1] || '';
    const gw = (hs as any).dhcp_gateway || hs.ip_address;
    setEditHS({
      interface: hs.interface,
      ip_address: gw,
      dhcp_start: start,
      dhcp_end: end,
      dhcp_gateway: gw,
      netmask: (hs as any).netmask || '255.255.255.0',
      bandwidth_limit: hs.bandwidth_limit
    });
  };
  const saveHotspotEdit = async () => {
    if (!editHS || !editHS.interface) return;
    const gateway = editHS.dhcp_gateway || editHS.ip_address;
    const start = editHS.dhcp_start || '';
    const end = editHS.dhcp_end || '';
    if (!gateway || !start || !end) return alert('Complete DHCP fields!');
    try {
      setLoading(true);
      await apiClient.createHotspot({
        interface: editHS.interface,
        ip_address: gateway,
        dhcp_range: `${start},${end}`,
        bandwidth_limit: editHS.bandwidth_limit || 10,
        netmask: editHS.netmask
      });
      await loadData();
      setEditHS(null);
      alert('Portal Segment Updated!');
    } catch (e) { alert('Failed to update Hotspot.'); }
    finally { setLoading(false); }
  };
  const cancelEdit = () => setEditHS(null);
  const handleEditNetmaskChange = (mask: string) => {
    if (!editHS) return;
    const gw = editHS.dhcp_gateway || editHS.ip_address || '';
    const { start, end } = calcDhcpRange(gw || '', mask);
    setEditHS({ ...(editHS as any), netmask: mask, dhcp_start: start, dhcp_end: end });
  };

  // PPPoE Server Functions


  // Helper to identify potential wireless interfaces
  const isPotentialWifi = (iface: NetworkInterface) => {
    const name = (iface.name || '').toLowerCase();
    const type = (iface.type || '').toLowerCase();
    return type === 'wifi' || name.startsWith('wlan') || name.startsWith('ap') || name.startsWith('ra');
  };

  return (
    <div className="space-y-4 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-500">
      
      {/* 1. Hardware Link Status Engine */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hardware Link Engine</h3>
          <button onClick={loadData} disabled={loading} className="text-[9px] font-black uppercase text-blue-600 hover:text-blue-700 disabled:opacity-50">
            {loading ? 'Syncing...' : 'Sync Kernel'}
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-100">
          {interfaces.map(iface => (
            <div key={iface.name} className="p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className={`text-[7px] font-black uppercase px-1 py-0.5 rounded ${iface.status === 'up' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {iface.status}
                </span>
                <span className="text-[8px] text-slate-400 font-mono uppercase">{iface.type}</span>
              </div>
              <div>
                <h4 className="font-black text-slate-900 text-xs">{iface.name}</h4>
                <p className="text-[9px] text-slate-500 font-mono truncate">{iface.ip || '-'}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Wireless Interface Manager */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Wireless AP Layer</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Link</label>
              <select 
                value={newWifi.interface}
                onChange={e => setNewWifi({...newWifi, interface: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold"
              >
                <option value="">Select Link...</option>
                {interfaces.filter(isPotentialWifi).map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">SSID</label>
              <input type="text" value={newWifi.ssid} onChange={e => setNewWifi({...newWifi, ssid: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-black" />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Passkey</label>
              <input type="password" value={newWifi.password} onChange={e => setNewWifi({...newWifi, password: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs" placeholder="Open" />
            </div>
            <button
              onClick={() => deployWireless()}
              disabled={loading}
              className="admin-btn-primary w-full py-2 rounded-lg font-black text-[9px] uppercase tracking-widest shadow-md disabled:opacity-50"
            >
              Start Radio
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-slate-50 rounded-xl border border-slate-200 p-4">
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Active Radio Nodes</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {wirelessArr.length > 0 ? wirelessArr.map(w => (
              <div key={w.interface} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-sm">📶</div>
                <div className="flex-1">
                  <p className="text-[11px] font-black text-slate-900 uppercase">{w.ssid}</p>
                  <p className="text-[8px] text-slate-400 font-bold uppercase">
                    {w.interface} • CH {w.channel}
                  </p>
                </div>
              </div>
            )) : (
              <div className="col-span-full py-10 text-center text-slate-400 text-[10px] font-bold uppercase">No Active Radios</div>
            )}
          </div>
        </div>
      </section>

      {/* 3. Hotspot Server Manager */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Portal Segment</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Bind</label>
              <select 
                value={newHS.interface}
                onChange={e => setNewHS({...newHS, interface: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-900"
              >
                <option value="">Select Link...</option>
                {interfaces.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Bitmask</label>
              <select
                value={newHS.netmask}
                onChange={e => handleNetmaskChange(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-900"
              >
                <option value="255.255.255.0">/24 • 256 total • 254 usable</option>
                <option value="255.255.254.0">/23 • 512 total • 510 usable</option>
                <option value="255.255.252.0">/22 • 1024 total • 1022 usable</option>
                <option value="255.255.248.0">/21 • 2048 total • 2046 usable</option>
                <option value="255.255.240.0">/20 • 4096 total • 4094 usable</option>
                <option value="255.255.224.0">/19 • 8192 total • 8190 usable</option>
                <option value="255.255.192.0">/18 • 16384 total • 16382 usable</option>
                <option value="255.255.0.0">/16 • 65536 total • 65534 usable</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DHCP Start</label>
                <input type="text" value={newHS.dhcp_start || ''} onChange={e => setNewHS({...newHS, dhcp_start: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DHCP End</label>
                <input type="text" value={newHS.dhcp_end || ''} onChange={e => setNewHS({...newHS, dhcp_end: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DHCP Gateway</label>
                <input type="text" value={newHS.dhcp_gateway || ''} onChange={e => setNewHS({...newHS, dhcp_gateway: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
              </div>
            </div>
            <button
              onClick={createHotspot}
              disabled={loading}
              className="admin-btn-primary w-full py-2 rounded-lg font-black text-[9px] uppercase tracking-widest shadow-md disabled:opacity-50"
            >
              Commit Portal
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-3">
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Portal Segments</h4>
          {hotspots.length > 0 ? hotspots.map(hs => (
             <div key={hs.interface} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between group">
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center text-lg">🏛️</div>
                 <div>
                   <h5 className="font-black text-slate-900 text-[11px] uppercase">{hs.interface}</h5>
                   <p className="text-[9px] text-slate-500 font-mono">
                     GW: {(hs as any).dhcp_gateway || hs.ip_address} • DHCP: {hs.dhcp_range}
                   </p>
                   {(hs as any).netmask && (
                     <p className="text-[8px] text-slate-400 font-mono">
                       Netmask: {(hs as any).netmask}
                     </p>
                   )}
                 </div>
               </div>
               <div className="flex items-center gap-2">
                 <button onClick={() => startEdit(hs)} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-black text-[8px] uppercase hover:bg-blue-100 transition-opacity opacity-0 group-hover:opacity-100">Edit</button>
                 <button onClick={() => deleteHotspot(hs.interface)} className="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-black text-[8px] uppercase hover:bg-red-100 transition-opacity opacity-0 group-hover:opacity-100">Terminate</button>
               </div>
             </div>
          )) : (
            <div className="py-10 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-300 text-[10px] font-black uppercase">No Active Segments</div>
          )}
          {editHS && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Edit: {editHS.interface}</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DHCP Start</label>
                  <input type="text" value={editHS.dhcp_start || ''} onChange={e => setEditHS({ ...(editHS as any), dhcp_start: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DHCP End</label>
                  <input type="text" value={editHS.dhcp_end || ''} onChange={e => setEditHS({ ...(editHS as any), dhcp_end: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
                </div>
                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Gateway</label>
                  <input type="text" value={editHS.dhcp_gateway || ''} onChange={e => setEditHS({ ...(editHS as any), dhcp_gateway: e.target.value, ip_address: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
                </div>
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Bitmask</label>
                <select
                  value={editHS.netmask || '255.255.240.0'}
                  onChange={e => handleEditNetmaskChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold"
                >
                  <option value="255.255.255.0">/24 • 256 total • 254 usable</option>
                  <option value="255.255.254.0">/23 • 512 total • 510 usable</option>
                  <option value="255.255.252.0">/22 • 1024 total • 1022 usable</option>
                  <option value="255.255.248.0">/21 • 2048 total • 2046 usable</option>
                  <option value="255.255.240.0">/20 • 4096 total • 4094 usable</option>
                  <option value="255.255.224.0">/19 • 8192 total • 8190 usable</option>
                  <option value="255.255.192.0">/18 • 16384 total • 16382 usable</option>
                  <option value="255.255.0.0">/16 • 65536 total • 65534 usable</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveHotspotEdit}
                  disabled={loading}
                  className="admin-btn-primary px-3 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest"
                >
                  Save Changes
                </button>
                <button onClick={cancelEdit} className="border border-slate-300 text-slate-600 px-3 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 4. Trunking & Bridging Engines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">VLAN Engine</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Parent</label>
                <select 
                  value={vlan.parentInterface}
                  onChange={e => setVlan({...vlan, parentInterface: e.target.value, name: makeSafeVlanName(e.target.value, vlan.id)})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold"
                >
                  {interfaces.filter(i => i.type === 'ethernet' || i.name.startsWith('wlan')).map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">VLAN ID</label>
                <input type="number" value={vlan.id} onChange={e => setVlan({...vlan, id: parseInt(e.target.value), name: makeSafeVlanName(vlan.parentInterface, parseInt(e.target.value))})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
              </div>
            </div>
            <button
              onClick={generateVlan}
              disabled={loading}
              className="admin-btn-primary w-full py-2 rounded-lg font-black text-[9px] uppercase tracking-widest"
            >
              Create: {vlan.name}
            </button>
            
            <div className="space-y-1.5">
              {vlans.map(v => (
                <div key={v.name} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 group">
                  <p className="text-[10px] font-black text-slate-900">{v.name} <span className="text-[8px] text-slate-400 font-mono ml-1">ID: {v.id}</span></p>
                  <button onClick={() => deleteVlan(v.name)} className="text-red-600 text-[8px] font-black uppercase opacity-0 group-hover:opacity-100">Delete</button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Bridge Engine</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <input type="text" value={bridge.name} onChange={e => setBridge({...bridge, name: e.target.value})} className="w-1/2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" placeholder="Bridge Name" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bridge.stp} onChange={e => setBridge({...bridge, stp: e.target.checked})} className="w-3 h-3 rounded border-slate-300 text-blue-600" />
                <span className="text-[8px] font-black text-slate-600 uppercase">STP</span>
              </label>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
               {interfaces.map(iface => (
                 <button key={iface.name} onClick={() => toggleBridgeMember(iface.name)} className={`py-1 rounded border text-[7px] font-black uppercase transition-all ${bridge.members.includes(iface.name) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
                   {iface.name}
                 </button>
               ))}
            </div>
            <button
              onClick={deployBridge}
              disabled={loading}
              className="admin-btn-outline-primary w-full py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all disabled:opacity-50"
            >
              Deploy Bridge
            </button>
            
            <div className="space-y-1.5">
              {bridges.map(b => (
                <div key={b.name} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 group">
                  <p className="text-[10px] font-black text-slate-900">{b.name} <span className="text-[8px] text-slate-400 font-mono ml-1">({(b.members || []).join(',')})</span></p>
                  <button onClick={() => deleteBridge(b.name)} className="text-red-600 text-[8px] font-black uppercase opacity-0 group-hover:opacity-100">Delete</button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default NetworkSettings;
