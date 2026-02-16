import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { NetworkInterface, PPPoEServerConfig, PPPoEUser, PPPoESession, PPPoEProfile, PPPoEBillingProfile, PPPoEPool } from '../../types';

const PPPoEServer: React.FC = () => {
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [loading, setLoading] = useState(false);
  
  // PPPoE Server State
  const [pppoeServer, setPppoeServer] = useState<Partial<PPPoEServerConfig>>({
    interface: '',
    local_ip: '192.168.100.1',
    ip_pool_start: '192.168.100.10',
    ip_pool_end: '192.168.100.254',
    dns1: '8.8.8.8',
    dns2: '8.8.4.4',
    service_name: ''
  });
  const [pppoeStatus, setPppoeStatus] = useState<any>(null);
  const [pppoeUsers, setPppoeUsers] = useState<PPPoEUser[]>([]);
  const [pppoeSessions, setPppoeSessions] = useState<PPPoESession[]>([]);
  const [pppoeProfiles, setPppoeProfiles] = useState<PPPoEProfile[]>([]);
  const [pppoeBillingProfiles, setPppoeBillingProfiles] = useState<PPPoEBillingProfile[]>([]);
  const [pppoeLogs, setPppoeLogs] = useState<string[]>([]);
  
  const [newPppoeUser, setNewPppoeUser] = useState({ username: '', password: '', billing_profile_id: '' });
  const [newProfile, setNewProfile] = useState<PPPoEProfile>({ name: '', rate_limit_dl: 5, rate_limit_ul: 5 });
  const [newBillingProfile, setNewBillingProfile] = useState<Partial<PPPoEBillingProfile>>({ profile_id: 0, name: '', price: 0 });
  const [pppoePools, setPppoePools] = useState<PPPoEPool[]>([]);
  const [newPool, setNewPool] = useState<Partial<PPPoEPool>>({ name: '', ip_pool_start: '', ip_pool_end: '', description: '' });
  const [editingPoolId, setEditingPoolId] = useState<number | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null);
  const [lastCreatedAccountNumber, setLastCreatedAccountNumber] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<PPPoEUser | null>(null);

  useEffect(() => { 
    loadData();
    const logInterval = setInterval(loadLogs, 5000);
    return () => clearInterval(logInterval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ifaces, pppoeS, pppoeU, pppoeSess, profiles, billingProfiles, pools] = await Promise.all([
        apiClient.getInterfaces(),
        apiClient.getPPPoEServerStatus().catch(() => null),
        apiClient.getPPPoEUsers().catch(() => []),
        apiClient.getPPPoESessions().catch(() => []),
        apiClient.getPPPoEProfiles().catch(() => []),
        apiClient.getPPPoEBillingProfiles().catch(() => []),
        apiClient.getPPPoEPools().catch(() => [])
      ]);
      const detectedIfaces = ifaces.filter(i => !i.isLoopback);
      setInterfaces(detectedIfaces);

      // Auto-select br0 if available and no interface selected
      if (!pppoeServer.interface) {
        const br0 = detectedIfaces.find(i => i.name === 'br0');
        if (br0) {
          setPppoeServer(prev => ({ ...prev, interface: 'br0' }));
        }
      }

      setPppoeStatus(pppoeS);
      setPppoeUsers(Array.isArray(pppoeU) ? pppoeU : []);
      setPppoeSessions(Array.isArray(pppoeSess) ? pppoeSess : []);
      setPppoeProfiles(profiles);
      setPppoeBillingProfiles(billingProfiles);
      setPppoePools(Array.isArray(pools) ? pools : []);
      loadLogs();
    } catch (err) { 
      console.error('[UI] Data Load Error:', err); 
    }
    finally { setLoading(false); }
  };

  const loadLogs = async () => {
    try {
      const logs = await apiClient.getPPPoELogs();
      setPppoeLogs(logs);
    } catch (e) {}
  };

  // PPPoE Server Functions
  const startPPPoEServerHandler = async () => {
    if (!pppoeServer.interface || !pppoeServer.local_ip || !pppoeServer.ip_pool_start || !pppoeServer.ip_pool_end) {
      return alert('Please fill all required fields!');
    }
    
    try {
      setLoading(true);
      await apiClient.startPPPoEServer(pppoeServer as PPPoEServerConfig);
      await loadData();
      alert('PPPoE Server started successfully!');
    } catch (e: any) {
      alert(`Failed to start PPPoE Server: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const stopPPPoEServerHandler = async () => {
    if (!confirm('Stop PPPoE Server? All active connections will be terminated.')) return;
    
    try {
      setLoading(true);
      await apiClient.stopPPPoEServer(pppoeStatus?.config?.interface || '');
      await loadData();
      alert('PPPoE Server stopped');
    } catch (e: any) {
      alert(`Failed to stop server: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const restartPPPoEServerHandler = async () => {
    try {
      setLoading(true);
      await apiClient.restartPPPoEServer();
      await loadData();
      alert('PPPoE Server restarted successfully!');
    } catch (e: any) {
      alert(`Failed to restart server: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const addPPPoEUserHandler = async () => {
    if (!newPppoeUser.username || !newPppoeUser.password) {
      return alert('Username and password required!');
    }
    
    try {
      setLoading(true);
      const result = await apiClient.addPPPoEUser(
        newPppoeUser.username, 
        newPppoeUser.password, 
        newPppoeUser.billing_profile_id ? parseInt(newPppoeUser.billing_profile_id) : undefined
      );
      if (result?.account_number) {
        setLastCreatedAccountNumber(result.account_number);
      } else {
        setLastCreatedAccountNumber(null);
      }
      setNewPppoeUser({ username: '', password: '', billing_profile_id: '' });
      await loadData();
      alert(`User ${newPppoeUser.username} added!${result?.account_number ? ` Account No: ${result.account_number}` : ''}`);
    } catch (e: any) {
      alert(`Failed to add user: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deletePPPoEUserHandler = async (userId: number, username: string) => {
    if (!confirm(`Delete PPPoE user "${username}"?`)) return;
    
    try {
      setLoading(true);
      await apiClient.deletePPPoEUser(userId);
      await loadData();
    } catch (e: any) {
      alert(`Failed to delete user: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const startEditPPPoEUser = (user: PPPoEUser) => {
    setEditingUser({
      ...user,
      password: ''
    });
  };

  const updateEditingUserField = (field: keyof PPPoEUser, value: any) => {
    if (!editingUser) return;
    setEditingUser({ ...editingUser, [field]: value });
  };

  const savePPPoEUserEditHandler = async () => {
    if (!editingUser || !editingUser.id) return;
    try {
      setLoading(true);
      const updates: Partial<PPPoEUser> = {
        username: editingUser.username,
        enabled: editingUser.enabled
      };
      if (editingUser.password && editingUser.password.trim()) {
        updates.password = editingUser.password;
      }
      if (typeof editingUser.billing_profile_id === 'number') {
        updates.billing_profile_id = editingUser.billing_profile_id;
      }
      await apiClient.updatePPPoEUser(editingUser.id, updates);
      setEditingUser(null);
      await loadData();
    } catch (e: any) {
      alert(`Failed to update user: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const cancelPPPoEUserEdit = () => {
    setEditingUser(null);
  };

  const addProfileHandler = async () => {
    if (!newProfile.name) return alert('Profile name required!');
    try {
      setLoading(true);
      await apiClient.addPPPoEProfile(newProfile);
      setNewProfile({ name: '', rate_limit_dl: 5, rate_limit_ul: 5 });
      await loadData();
    } catch (e: any) {
      alert(`Failed to add profile: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteProfileHandler = async (id: number) => {
    if (!confirm('Delete this profile?')) return;
    try {
      setLoading(true);
      await apiClient.deletePPPoEProfile(id);
      await loadData();
    } catch (e: any) {
      alert(`Failed to delete profile: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const addBillingProfileHandler = async () => {
    if (!newBillingProfile.name || !newBillingProfile.profile_id) return alert('Name and Profile selection required!');
    try {
      setLoading(true);
      await apiClient.addPPPoEBillingProfile(newBillingProfile);
      setNewBillingProfile({ profile_id: 0, name: '', price: 0 });
      await loadData();
    } catch (e: any) {
      alert(`Failed to add billing profile: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteBillingProfileHandler = async (id: number) => {
    if (!confirm('Delete this billing profile?')) return;
    try {
      setLoading(true);
      await apiClient.deletePPPoEBillingProfile(id);
      await loadData();
    } catch (e: any) {
      alert(`Failed to delete billing profile: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const resetPoolForm = () => {
    setNewPool({ name: '', ip_pool_start: '', ip_pool_end: '', description: '' });
    setEditingPoolId(null);
  };

  const savePoolHandler = async () => {
    if (!newPool.name || !newPool.ip_pool_start || !newPool.ip_pool_end) {
      return alert('Name, Pool Start, and Pool End are required!');
    }
    try {
      setLoading(true);
      if (editingPoolId == null) {
        await apiClient.addPPPoEPool({
          name: newPool.name,
          ip_pool_start: newPool.ip_pool_start,
          ip_pool_end: newPool.ip_pool_end,
          description: newPool.description
        });
      } else {
        await apiClient.updatePPPoEPool(editingPoolId, {
          name: newPool.name,
          ip_pool_start: newPool.ip_pool_start,
          ip_pool_end: newPool.ip_pool_end,
          description: newPool.description
        });
      }
      resetPoolForm();
      await loadData();
    } catch (e: any) {
      alert(`Failed to save PPPoE pool: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const editPoolHandler = (pool: PPPoEPool) => {
    if (!pool.id) return;
    setEditingPoolId(pool.id);
    setNewPool({
      name: pool.name,
      ip_pool_start: pool.ip_pool_start,
      ip_pool_end: pool.ip_pool_end,
      description: pool.description || ''
    });
  };

  const deletePoolHandler = async (pool: PPPoEPool) => {
    if (!pool.id) return;
    if (!confirm(`Delete PPPoE pool "${pool.name}"?`)) return;
    try {
      setLoading(true);
      await apiClient.deletePPPoEPool(pool.id);
      if (editingPoolId === pool.id) {
        resetPoolForm();
      }
      await loadData();
    } catch (e: any) {
      alert(`Failed to delete PPPoE pool: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-32 animate-in fade-in slide-in-from-bottom-2 duration-500">
      
      {/* PPPoE Server Management */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">PPPoE Server</h3>
            <span className="text-[8px] bg-slate-900 text-white px-1.5 py-0.5 rounded font-black tracking-tighter">ISP MODE</span>
          </div>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter hidden sm:block">Accept PPPoE client connections</p>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Status and Config (Left) */}
          <div className="lg:col-span-8 space-y-4">
            {/* Status Card */}
            <div className="bg-slate-900 rounded-lg p-3 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${pppoeStatus?.running ? 'bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`}></div>
                <div>
                  <div className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Server Status</div>
                  <div className="text-[10px] font-black uppercase tracking-tight">
                    {pppoeStatus?.running ? `Running on ${pppoeStatus.config?.interface}` : 'Inactive'}
                  </div>
                </div>
              </div>
              {pppoeStatus?.running && (
                <div className="flex gap-2">
                  <button onClick={restartPPPoEServerHandler} disabled={loading} className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all active:scale-95 disabled:opacity-50">
                    Restart
                  </button>
                  <button onClick={stopPPPoEServerHandler} disabled={loading} className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all active:scale-95 disabled:opacity-50">
                    Stop Server
                  </button>
                </div>
              )}
            </div>

            {/* Config Form */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Listen Interface</label>
                    <select 
                      value={pppoeServer.interface}
                      onChange={e => setPppoeServer({...pppoeServer, interface: e.target.value})}
                      disabled={pppoeStatus?.running}
                      className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-bold disabled:opacity-50 focus:ring-1 focus:ring-slate-900 outline-none"
                    >
                      <option value="">Select Interface...</option>
                      {interfaces.filter(i => i.type === 'ethernet' || i.type === 'vlan' || i.type === 'bridge').map(i => (
                        <option key={i.name} value={i.name}>
                          {i.name} ({i.type}){i.name === 'br0' ? ' - Recommended' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Local IP</label>
                    <input 
                      type="text" 
                      value={pppoeServer.local_ip} 
                      onChange={e => setPppoeServer({...pppoeServer, local_ip: e.target.value})}
                      disabled={pppoeStatus?.running}
                      className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-mono disabled:opacity-50 outline-none" 
                      placeholder="192.168.100.1"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Pool Start</label>
                      <input 
                        type="text" 
                        value={pppoeServer.ip_pool_start} 
                        onChange={e => setPppoeServer({...pppoeServer, ip_pool_start: e.target.value})}
                        disabled={pppoeStatus?.running}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-mono disabled:opacity-50 outline-none" 
                        placeholder="192.168.100.10"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Pool End</label>
                      <input 
                        type="text" 
                        value={pppoeServer.ip_pool_end} 
                        onChange={e => setPppoeServer({...pppoeServer, ip_pool_end: e.target.value})}
                        disabled={pppoeStatus?.running}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-mono disabled:opacity-50 outline-none" 
                        placeholder="192.168.100.254"
                      />
                    </div>
                  </div>

                <div>
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Use Saved Pool (Optional)</label>
                  <select
                    value={selectedPoolId !== null ? String(selectedPoolId) : ''}
                    onChange={e => {
                      const value = e.target.value;
                      if (!value) {
                        setSelectedPoolId(null);
                        return;
                      }
                      const id = parseInt(value, 10);
                      const pool = pppoePools.find(p => p.id === id);
                      setSelectedPoolId(id);
                      if (pool) {
                        setPppoeServer({
                          ...pppoeServer,
                          ip_pool_start: pool.ip_pool_start,
                          ip_pool_end: pool.ip_pool_end
                        });
                      }
                    }}
                    disabled={pppoeStatus?.running || pppoePools.length === 0}
                    className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-bold disabled:opacity-50 focus:ring-1 focus:ring-slate-900 outline-none"
                  >
                    <option value="">Manual IP range...</option>
                    {pppoePools.map(pool => (
                      <option key={pool.id} value={pool.id}>
                        {pool.name} ({pool.ip_pool_start} - {pool.ip_pool_end})
                      </option>
                    ))}
                  </select>
                </div>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DNS 1</label>
                      <input 
                        type="text" 
                        value={pppoeServer.dns1} 
                        onChange={e => setPppoeServer({...pppoeServer, dns1: e.target.value})}
                        disabled={pppoeStatus?.running}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-mono disabled:opacity-50 outline-none" 
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">DNS 2</label>
                      <input 
                        type="text" 
                        value={pppoeServer.dns2} 
                        onChange={e => setPppoeServer({...pppoeServer, dns2: e.target.value})}
                        disabled={pppoeStatus?.running}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-mono disabled:opacity-50 outline-none" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Service Name</label>
                    <input 
                      type="text" 
                      value={pppoeServer.service_name} 
                      onChange={e => setPppoeServer({...pppoeServer, service_name: e.target.value})}
                      disabled={pppoeStatus?.running}
                      className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[10px] font-bold disabled:opacity-50 outline-none" 
                      placeholder="Leave empty for default"
                    />
                  </div>

                  <div className="pt-2">
                    {!pppoeStatus?.running && (
                      <button 
                        onClick={startPPPoEServerHandler} 
                        disabled={loading} 
                        className="admin-btn-primary w-full py-2.5 rounded-md font-black text-[9px] uppercase tracking-[0.2em] shadow-lg active:scale-95 disabled:opacity-50"
                      >
                        Launch PPPoE Server
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <h4 className="text-[9px] font-black text-slate-900 uppercase tracking-widest">PPPoE IP Pools</h4>
                <span className="text-[8px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">{pppoePools.length}</span>
              </div>
              <div className="p-3 border-b border-slate-100 bg-slate-50/30">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Pool Name</label>
                    <input
                      type="text"
                      value={newPool.name || ''}
                      onChange={e => setNewPool({ ...newPool, name: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none"
                      placeholder="Example: Default Pool"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description</label>
                    <input
                      type="text"
                      value={newPool.description || ''}
                      onChange={e => setNewPool({ ...newPool, description: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono outline-none"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Pool Start</label>
                    <input
                      type="text"
                      value={newPool.ip_pool_start || ''}
                      onChange={e => setNewPool({ ...newPool, ip_pool_start: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono outline-none"
                      placeholder="192.168.100.10"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Pool End</label>
                    <input
                      type="text"
                      value={newPool.ip_pool_end || ''}
                      onChange={e => setNewPool({ ...newPool, ip_pool_end: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono outline-none"
                      placeholder="192.168.100.254"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={savePoolHandler}
                    disabled={loading}
                    className="flex-1 bg-slate-900 text-white py-1.5 rounded text-[9px] font-black uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50"
                  >
                    {editingPoolId == null ? 'Add Pool' : 'Update Pool'}
                  </button>
                  {editingPoolId != null && (
                    <button
                      onClick={resetPoolForm}
                      type="button"
                      disabled={loading}
                      className="px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-widest border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-[180px] overflow-y-auto divide-y divide-slate-100">
                {pppoePools.length > 0 ? (
                  pppoePools.map(pool => (
                    <div key={pool.id} className="px-3 py-2 flex items-center justify-between group">
                      <div>
                        <p className="text-[10px] font-bold text-slate-900">{pool.name}</p>
                        <p className="text-[8px] text-slate-500 font-mono">
                          {pool.ip_pool_start} - {pool.ip_pool_end}
                        </p>
                        {pool.description ? (
                          <p className="text-[7px] text-slate-400 font-bold uppercase tracking-widest">
                            {pool.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={() => editPoolHandler(pool)}
                          className="text-slate-500 hover:text-slate-800 p-1"
                          title="Edit Pool"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536M4 20h4.75L19 9.75 14.25 5 4 15.75V20z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deletePoolHandler(pool)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Delete Pool"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center">
                    <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest">No PPPoE pools defined</p>
                  </div>
                )}
              </div>
            </div>

            {/* Profiles Management */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* PPPoE Profiles */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                  <h4 className="text-[9px] font-black text-slate-900 uppercase tracking-widest">PPPoE Profiles</h4>
                  <span className="text-[8px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">{pppoeProfiles.length}</span>
                </div>
                <div className="p-3 border-b border-slate-100 bg-slate-50/30">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input 
                      type="text" 
                      placeholder="Profile Name"
                      value={newProfile.name}
                      onChange={e => setNewProfile({...newProfile, name: e.target.value})}
                      className="col-span-2 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none"
                    />
                    <div className="relative">
                      <span className="absolute right-2 top-1 text-[8px] font-black text-slate-300">DL</span>
                      <input 
                        type="number" 
                        placeholder="DL Mbps"
                        value={newProfile.rate_limit_dl}
                        onChange={e => setNewProfile({...newProfile, rate_limit_dl: parseInt(e.target.value)})}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono outline-none"
                      />
                    </div>
                    <div className="relative">
                      <span className="absolute right-2 top-1 text-[8px] font-black text-slate-300">UL</span>
                      <input 
                        type="number" 
                        placeholder="UL Mbps"
                        value={newProfile.rate_limit_ul}
                        onChange={e => setNewProfile({...newProfile, rate_limit_ul: parseInt(e.target.value)})}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono outline-none"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={addProfileHandler}
                    className="admin-btn-primary w-full py-1.5 rounded text-[9px] font-black uppercase tracking-widest"
                  >
                    Add Profile
                  </button>
                </div>
                <div className="max-h-[150px] overflow-y-auto divide-y divide-slate-100">
                  {pppoeProfiles.map(p => (
                    <div key={p.id} className="px-3 py-2 flex items-center justify-between group">
                      <div>
                        <p className="text-[10px] font-bold text-slate-900">{p.name}</p>
                        <p className="text-[8px] text-slate-400 font-bold uppercase">{p.rate_limit_dl}M/{p.rate_limit_ul}M Limit</p>
                      </div>
                      <button onClick={() => deleteProfileHandler(p.id!)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Billing Profiles */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                  <h4 className="text-[9px] font-black text-slate-900 uppercase tracking-widest">Billing Profiles</h4>
                  <span className="text-[8px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">{pppoeBillingProfiles.length}</span>
                </div>
                <div className="p-3 border-b border-slate-100 bg-slate-50/30">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input 
                      type="text" 
                      placeholder="Billing Name"
                      value={newBillingProfile.name}
                      onChange={e => setNewBillingProfile({...newBillingProfile, name: e.target.value})}
                      className="col-span-2 w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none"
                    />
                    <select 
                      value={newBillingProfile.profile_id}
                      onChange={e => setNewBillingProfile({...newBillingProfile, profile_id: parseInt(e.target.value)})}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none"
                    >
                      <option value="0">Select Profile...</option>
                      {pppoeProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div className="relative">
                      <span className="absolute left-2 top-1 text-[8px] font-black text-slate-300">₱</span>
                      <input 
                        type="number" 
                        placeholder="Price"
                        value={newBillingProfile.price}
                        onChange={e => setNewBillingProfile({...newBillingProfile, price: parseInt(e.target.value)})}
                        className="w-full bg-white border border-slate-200 rounded pl-5 pr-2 py-1 text-[10px] font-mono outline-none"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={addBillingProfileHandler}
                    className="w-full bg-blue-600 text-white py-1.5 rounded text-[9px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all"
                  >
                    Add Billing
                  </button>
                </div>
                <div className="max-h-[150px] overflow-y-auto divide-y divide-slate-100">
                  {pppoeBillingProfiles.map(bp => (
                    <div key={bp.id} className="px-3 py-2 flex items-center justify-between group">
                      <div>
                        <p className="text-[10px] font-bold text-slate-900">{bp.name}</p>
                        <p className="text-[8px] text-slate-400 font-bold uppercase">₱{bp.price} • {pppoeProfiles.find(p => p.id === bp.profile_id)?.name || 'Unknown'}</p>
                      </div>
                      <button onClick={() => deleteBillingProfileHandler(bp.id!)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* User Management (Right) */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-3 flex-shrink-0">
              <h4 className="text-[9px] font-black text-slate-900 uppercase tracking-widest mb-3">Add User</h4>
              <div className="space-y-2">
                <input 
                  type="text" 
                  value={newPppoeUser.username} 
                  onChange={e => setNewPppoeUser({...newPppoeUser, username: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[10px] font-bold outline-none focus:bg-white" 
                  placeholder="Username"
                />
                <input 
                  type="password" 
                  value={newPppoeUser.password} 
                  onChange={e => setNewPppoeUser({...newPppoeUser, password: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[10px] font-mono outline-none focus:bg-white" 
                  placeholder="Password"
                />
                <select 
                  value={newPppoeUser.billing_profile_id}
                  onChange={e => setNewPppoeUser({...newPppoeUser, billing_profile_id: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[10px] font-bold outline-none focus:bg-white"
                >
                  <option value="">Select Billing Profile (Optional)...</option>
                  {pppoeBillingProfiles.map(bp => <option key={bp.id} value={bp.id}>{bp.name} (₱{bp.price})</option>)}
                </select>
                <button 
                  onClick={addPPPoEUserHandler} 
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-2 rounded font-black text-[9px] uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
                >
                  Create User
                </button>
                {lastCreatedAccountNumber && (
                  <div className="text-[8px] text-slate-500 font-mono">
                    Last Account No: <span className="font-bold text-slate-700">{lastCreatedAccountNumber}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="px-4 pb-4">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">PPPoE Accounts</h4>
              <span className="text-[9px] font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">{pppoeUsers.length}</span>
            </div>
            <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-100">
              {pppoeUsers.length > 0 ? pppoeUsers.map(user => (
                <div key={user.id} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${user.enabled ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-black text-slate-900">{user.username}</span>
                        {user.account_number && (
                          <span className="text-[8px] bg-slate-900 text-white px-1.5 py-0.5 rounded font-mono">
                            {user.account_number}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tight">
                          ID: {user.id} • {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'NO DATE'}
                        </span>
                        {user.billing_profile_id && (
                          <span className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-black">
                            {pppoeBillingProfiles.find(bp => bp.id === user.billing_profile_id)?.name || 'BILLED'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEditPPPoEUser(user)}
                      className="px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => deletePPPoEUserHandler(user.id!, user.username)} 
                      className="px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-red-200 text-red-600 rounded hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )) : (
                <div className="py-6 text-center">
                  <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest">No accounts</p>
                </div>
              )}
            </div>
            {editingUser && (
              <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <div className="space-y-1">
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Username</span>
                    <input
                      type="text"
                      value={editingUser.username}
                      onChange={e => updateEditingUserField('username', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">New Password</span>
                    <input
                      type="password"
                      value={editingUser.password}
                      onChange={e => updateEditingUserField('password', e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-mono outline-none"
                      placeholder="Leave blank to keep"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Billing Profile</span>
                    <select
                      value={editingUser.billing_profile_id || ''}
                      onChange={e => updateEditingUserField('billing_profile_id', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold outline-none"
                    >
                      <option value="">None</option>
                      {pppoeBillingProfiles.map(bp => (
                        <option key={bp.id} value={bp.id}>{bp.name} (₱{bp.price})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-[9px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!editingUser.enabled}
                        onChange={e => updateEditingUserField('enabled', e.target.checked ? 1 : 0)}
                        className="w-3 h-3"
                      />
                      <span className="font-bold uppercase tracking-widest">Enabled</span>
                    </label>
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={savePPPoEUserEditHandler}
                        disabled={loading}
                        className="flex-1 bg-slate-900 text-white py-1.5 rounded text-[8px] font-black uppercase tracking-widest hover:bg-black disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelPPPoEUserEdit}
                        type="button"
                        disabled={loading}
                        className="flex-1 border border-slate-300 text-slate-700 py-1.5 rounded text-[8px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Active Sessions */}
        {pppoeStatus?.running && pppoeSessions.length > 0 && (
          <div className="px-4 pb-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-indigo-100 bg-indigo-100/50 flex justify-between items-center">
                <h4 className="text-[9px] font-black text-indigo-900 uppercase tracking-widest">Active Connections</h4>
                <span className="text-[8px] font-bold text-indigo-600 bg-white px-1.5 py-0.5 rounded border border-indigo-200">{pppoeSessions.length} ONLINE</span>
              </div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {pppoeSessions.map((session, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border border-indigo-200/50 flex flex-col gap-1 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-slate-900 truncate">{session.username}</p>
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 text-[8px] font-bold text-slate-400 uppercase tracking-tighter">
                      <span>IP: <span className="text-indigo-600 font-mono">{session.ip}</span></span>
                      <span>IF: <span className="text-indigo-600 font-mono">{session.interface}</span></span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-indigo-50">
                      <span className="text-[8px] text-slate-400">RX: <span className="text-slate-900 font-black">{(session.rx_bytes / 1024 / 1024).toFixed(1)} MB</span></span>
                      <span className="text-[8px] text-slate-400">TX: <span className="text-slate-900 font-black">{(session.tx_bytes / 1024 / 1024).toFixed(1)} MB</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Debug Logs Output */}
        <div className="px-4 pb-4">
          <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
            <div className="px-3 py-1.5 bg-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></div>
                <h4 className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Server Logs (Real-time)</h4>
              </div>
              <button onClick={loadLogs} className="text-[7px] text-slate-400 hover:text-white uppercase font-black transition-colors">Refresh</button>
            </div>
            <div className="p-3 font-mono text-[9px] text-slate-300 h-32 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-700">
              {pppoeLogs.length > 0 ? pppoeLogs.map((log, i) => (
                <div key={i} className="border-l border-slate-700 pl-2 py-0.5 hover:bg-slate-800/50 transition-colors">
                  <span className="text-slate-500 mr-2">[{i+1}]</span>
                  {log}
                </div>
              )) : (
                <div className="text-slate-600 italic">Waiting for server logs...</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PPPoEServer;
