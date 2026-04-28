import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { WanInterface } from '../../types';

interface MultiWanConfig {
  enabled: boolean;
  mode: 'pcc' | 'ecmp';
  pcc_method: 'both_addresses' | 'both_addresses_ports';
}

interface NetworkIface {
  name: string;
  type: string;
  status: string;
}

const MultiWanSettings: React.FC = () => {
  const [config, setConfig] = useState<MultiWanConfig>({
    enabled: false,
    mode: 'pcc',
    pcc_method: 'both_addresses'
  });
  const [wans, setWans] = useState<WanInterface[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableInterfaces, setAvailableInterfaces] = useState<NetworkIface[]>([]);
  const [availableVlans, setAvailableVlans] = useState<{ name: string; parent: string; id: number }[]>([]);
  const [defaultWan, setDefaultWan] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWan, setEditingWan] = useState<WanInterface | null>(null);

  // Add WAN form
  const [addForm, setAddForm] = useState<Partial<WanInterface>>({
    name: '',
    type: 'dhcp',
    config: {},
    gateway: '',
    weight: 1,
    enabled: 1
  });

  useEffect(() => {
    fetchConfig();
    fetchWans();
    fetchInterfaces();
    fetchVlans();
    fetchDefaultWan();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/multiwan/config');
      const data = await res.json();
      if (data.success && data.config) {
        setConfig({
          enabled: data.config.enabled,
          mode: data.config.mode,
          pcc_method: data.config.pcc_method
        });
      }
    } catch (e) {
      console.error('Failed to fetch Multi-WAN config', e);
    }
  };

  const fetchWans = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getWanInterfaces();
      if (data.success) {
        setWans(data.wans);
      }
    } catch (e) {
      console.error('Failed to fetch WAN interfaces', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchInterfaces = async () => {
    try {
      const res = await fetch('/api/interfaces');
      const data = await res.json();
      if (Array.isArray(data)) {
        setAvailableInterfaces(data.map((i: any) => ({ name: i.name, type: i.type, status: i.status })));
      }
    } catch (e) {
      // Fallback
    }
  };

  const fetchVlans = async () => {
    try {
      const res = await fetch('/api/network/vlans');
      const data = await res.json();
      if (Array.isArray(data)) {
        setAvailableVlans(data.map((v: any) => ({ name: v.name, parent: v.parent, id: v.id })));
      }
    } catch (e) {
      // Fallback
    }
  };

  const fetchDefaultWan = async () => {
    try {
      const data = await apiClient.getDefaultWan();
      if (data.success) {
        setDefaultWan(data.interface);
      }
    } catch (e) {
      // Fallback
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/multiwan/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, interfaces: wans.map(w => ({ interface: w.name, gateway: w.gateway, weight: w.weight })) })
      });
      const data = await res.json();
      if (data.success) {
        alert('Multi-WAN settings saved!');
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleAddWan = async () => {
    if (!addForm.name) {
      alert('Interface name is required');
      return;
    }
    try {
      const payload = {
        name: addForm.name!,
        type: addForm.type!,
        config: addForm.config || {},
        gateway: addForm.gateway || null,
        weight: addForm.weight || 1,
        enabled: addForm.enabled ?? 1,
        is_vlan: availableVlans.some(v => v.name === addForm.name) ? 1 : 0
      };
      await apiClient.createWanInterface(payload);
      setShowAddModal(false);
      setAddForm({ name: '', type: 'dhcp', config: {}, gateway: '', weight: 1, enabled: 1 });
      fetchWans();
    } catch (e: any) {
      alert('Failed to add WAN: ' + e.message);
    }
  };

  const handleConfigureDefaultWan = () => {
    if (!defaultWan) return;
    setAddForm({
      name: defaultWan,
      type: 'dhcp',
      config: {},
      gateway: '',
      weight: 1,
      enabled: 1
    });
    setShowAddModal(true);
  };

  const handleEditWan = async () => {
    if (!editingWan || !editingWan.id) return;
    try {
      await apiClient.updateWanInterface(editingWan.id, {
        name: editingWan.name,
        type: editingWan.type,
        config: editingWan.config,
        gateway: editingWan.gateway,
        weight: editingWan.weight,
        enabled: editingWan.enabled
      });
      setShowEditModal(false);
      setEditingWan(null);
      fetchWans();
    } catch (e: any) {
      alert('Failed to update WAN: ' + e.message);
    }
  };

  const handleDeleteWan = async (id: number) => {
    if (!confirm('Delete this WAN interface?')) return;
    try {
      await apiClient.deleteWanInterface(id);
      fetchWans();
    } catch (e: any) {
      alert('Failed to delete: ' + e.message);
    }
  };

  const handleApplyWan = async (id: number) => {
    try {
      const data = await apiClient.applyWanInterface(id);
      if (data.success) {
        alert(`WAN applied! Status: ${data.status?.status}, IP: ${data.status?.ip || 'None'}`);
      } else {
        alert('Apply failed: ' + (data.error || 'Unknown'));
      }
      fetchWans();
    } catch (e: any) {
      alert('Failed to apply: ' + e.message);
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'dhcp': return 'bg-blue-100 text-blue-700';
      case 'static': return 'bg-amber-100 text-amber-700';
      case 'pppoe': return 'bg-purple-100 text-purple-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const getStatusBadge = (status?: string, enabled?: number) => {
    if (!enabled) return 'bg-gray-100 text-gray-500';
    if (status === 'up') return 'bg-green-100 text-green-700';
    return 'bg-red-100 text-red-700';
  };

  const isDefaultWanConfigured = () => {
    return defaultWan ? wans.some(w => w.name === defaultWan) : true;
  };

  const renderConfigFields = (form: Partial<WanInterface>, setForm: React.Dispatch<React.SetStateAction<any>>) => {
    const type = form.type || 'dhcp';
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Type</label>
          <select
            className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={type}
            onChange={e => setForm((prev: any) => ({ ...prev, type: e.target.value, config: {} }))}
          >
            <option value="dhcp">DHCP (Auto)</option>
            <option value="static">Static IP</option>
            <option value="pppoe">PPPoE</option>
          </select>
        </div>

        {type === 'static' && (
          <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">IP Address</label>
              <input
                type="text"
                placeholder="192.168.1.100"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={form.config?.ipaddr || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, ipaddr: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Netmask (CIDR or dotted)</label>
              <input
                type="text"
                placeholder="255.255.255.0"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={form.config?.netmask || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, netmask: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gateway</label>
              <input
                type="text"
                placeholder="192.168.1.1"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={form.config?.gateway || form.gateway || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, gateway: e.target.value, config: { ...prev.config, gateway: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">DNS (comma separated)</label>
              <input
                type="text"
                placeholder="8.8.8.8, 1.1.1.1"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={(form.config?.dns || []).join(', ')}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, dns: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) } }))}
              />
            </div>
          </div>
        )}

        {type === 'pppoe' && (
          <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Username</label>
              <input
                type="text"
                placeholder="ISP Username"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.config?.username || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, username: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Password</label>
              <input
                type="password"
                placeholder="ISP Password"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.config?.password || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, password: e.target.value } }))}
              />
            </div>
          </div>
        )}

        {type === 'dhcp' && (
          <div className="text-xs text-slate-500 bg-blue-50 p-3 rounded-lg border border-blue-100">
            DHCP will automatically obtain an IP address from the ISP.
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading Multi-WAN Configuration...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Multi-WAN Management</h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">ISP Interfaces, Load Balancing & Failover</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${config.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
            {config.enabled ? 'Load Balancing Active' : 'Disabled'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">

          {/* Default WAN Alert */}
          {defaultWan && !isDefaultWanConfigured() && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 font-black text-lg">!</div>
                <div>
                  <div className="font-black text-sm text-slate-800 uppercase">Default WAN Detected: {defaultWan}</div>
                  <div className="text-xs text-slate-500 mt-0.5">This interface currently handles your internet traffic. Configure it to manage settings.</div>
                </div>
              </div>
              <button
                onClick={handleConfigureDefaultWan}
                className="text-[10px] font-black uppercase tracking-widest bg-amber-500 text-white px-4 py-2 rounded-xl hover:bg-amber-600 transition-colors shadow-sm"
              >
                Configure
              </button>
            </div>
          )}

          {/* WAN Interface Cards */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">WAN Interfaces</h3>
              <button
                onClick={() => setShowAddModal(true)}
                className="text-[10px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
              >
                + Add WAN
              </button>
            </div>
            <div className="p-6">
              {wans.length === 0 && !defaultWan ? (
                <div className="text-center py-12 text-slate-400 text-xs font-bold uppercase border-2 border-dashed border-slate-200 rounded-xl">
                  No WAN interfaces configured
                  <div className="mt-2 font-normal normal-case text-slate-400">Click "Add WAN" to get started</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {wans.map((wan) => (
                    <div key={wan.id} className={`flex items-center justify-between p-4 bg-white border rounded-xl shadow-sm hover:border-blue-200 transition-colors ${defaultWan === wan.name ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-black text-xs uppercase ${getStatusBadge(wan.status, wan.enabled)}`}>
                          {wan.status === 'up' ? 'UP' : wan.enabled ? 'DN' : 'OFF'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-slate-800 uppercase">{wan.name}</span>
                            {defaultWan === wan.name && (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                DEFAULT WAN
                              </span>
                            )}
                            <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${getTypeBadge(wan.type)}`}>
                              {wan.type}
                            </span>
                            {wan.is_vlan ? (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">
                                VLAN {wan.vlan_id}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {wan.ip_address ? `IP: ${wan.ip_address}` : 'No IP'} &bull; GW: {wan.gateway || 'Auto'} &bull; Weight: {wan.weight}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleApplyWan(wan.id!)}
                          className="text-[10px] font-black uppercase tracking-widest bg-green-50 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => { setEditingWan(wan); setShowEditModal(true); }}
                          className="text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteWan(wan.id!)}
                          className="text-[10px] font-black uppercase tracking-widest bg-red-50 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Load Balancing Config */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Load Balancing</h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={config.enabled} onChange={e => setConfig({...config, enabled: e.target.checked})} className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mode</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    onClick={() => setConfig({...config, mode: 'pcc'})}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${config.mode === 'pcc' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                  >
                    <div className={`font-black text-sm uppercase ${config.mode === 'pcc' ? 'text-blue-700' : 'text-slate-700'}`}>PCC</div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Per Connection Classifier</div>
                  </button>
                  <button
                    onClick={() => setConfig({...config, mode: 'ecmp'})}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${config.mode === 'ecmp' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                  >
                    <div className={`font-black text-sm uppercase ${config.mode === 'ecmp' ? 'text-blue-700' : 'text-slate-700'}`}>ECMP</div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Equal Cost Multi-Path</div>
                  </button>
                </div>
              </div>

              {config.mode === 'pcc' && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 animate-in fade-in">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">PCC Classifier</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-blue-300 transition-colors">
                      <input type="radio" name="pcc_method" checked={config.pcc_method === 'both_addresses'} onChange={() => setConfig({...config, pcc_method: 'both_addresses'})} className="text-blue-600 focus:ring-blue-500" />
                      <div>
                        <div className="font-bold text-xs text-slate-700 uppercase">Both Addresses</div>
                        <div className="text-[9px] text-slate-400 font-medium">Src Address & Dst Address Hashing</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-blue-300 transition-colors">
                      <input type="radio" name="pcc_method" checked={config.pcc_method === 'both_addresses_ports'} onChange={() => setConfig({...config, pcc_method: 'both_addresses_ports'})} className="text-blue-600 focus:ring-blue-500" />
                      <div>
                        <div className="font-bold text-xs text-slate-700 uppercase">Both Addresses and Ports</div>
                        <div className="text-[9px] text-slate-400 font-medium">Src/Dst Address & Port Hashing</div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Load Balancing'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-600/10">
            <h3 className="font-black uppercase tracking-widest text-sm mb-4">How it works</h3>
            <div className="space-y-4 text-xs leading-relaxed opacity-90">
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">WAN Types</strong>
                DHCP for auto-config, Static for fixed IPs, PPPoE for DSL/fiber requiring login.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">Default WAN</strong>
                The system auto-detects your current default internet interface. Configure it to manage settings.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">VLAN Interfaces</strong>
                Existing VLANs appear in the Add WAN dropdown so you can use them as WAN.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">Load Balancing</strong>
                Enable PCC or ECMP to distribute traffic across multiple WAN interfaces. Requires 2+ active WANs.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Add WAN Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Add WAN Interface</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Interface</label>
                <select
                  className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={addForm.name}
                  onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                >
                  <option value="">Select interface...</option>
                  <optgroup label="Physical Interfaces">
                    {availableInterfaces.filter(i => i.type === 'ethernet').map(iface => (
                      <option key={iface.name} value={iface.name}>{iface.name} ({iface.status})</option>
                    ))}
                  </optgroup>
                  {availableVlans.length > 0 && (
                    <optgroup label="VLAN Interfaces">
                      {availableVlans.map(vlan => (
                        <option key={vlan.name} value={vlan.name}>{vlan.name} (VLAN {vlan.id} on {vlan.parent})</option>
                      ))}
                    </optgroup>
                  )}
                  <option value="custom">Custom (Type manually)</option>
                </select>
              </div>

              {addForm.name === 'custom' && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Custom Name</label>
                  <input
                    type="text"
                    placeholder="e.g. eth1.100"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    value={addForm.name === 'custom' ? '' : addForm.name}
                    onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                  />
                </div>
              )}

              {renderConfigFields(addForm, setAddForm)}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gateway</label>
                  <input
                    type="text"
                    placeholder="192.168.1.1"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    value={addForm.gateway || ''}
                    onChange={e => setAddForm({ ...addForm, gateway: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Weight</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={addForm.weight || 1}
                    onChange={e => setAddForm({ ...addForm, weight: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!addForm.enabled}
                  onChange={e => setAddForm({ ...addForm, enabled: e.target.checked ? 1 : 0 })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-bold text-slate-600">Enable immediately</span>
              </label>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleAddWan} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-colors">Add WAN</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit WAN Modal */}
      {showEditModal && editingWan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Edit WAN: {editingWan.name}</h3>
            </div>
            <div className="p-6 space-y-4">
              {renderConfigFields(editingWan, setEditingWan)}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gateway</label>
                  <input
                    type="text"
                    placeholder="192.168.1.1"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    value={editingWan.gateway || ''}
                    onChange={e => setEditingWan({ ...editingWan, gateway: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Weight</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editingWan.weight || 1}
                    onChange={e => setEditingWan({ ...editingWan, weight: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editingWan.enabled}
                  onChange={e => setEditingWan({ ...editingWan, enabled: e.target.checked ? 1 : 0 })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-bold text-slate-600">Enabled</span>
              </label>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleEditWan} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiWanSettings;
