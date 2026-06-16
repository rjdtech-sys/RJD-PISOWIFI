import React, { useState, useEffect, useCallback } from 'react';
import { RentalDevice, RentalSession, RentalReport, PhoneRentalRate } from '../../types';
import { apiClient } from '../../lib/api';
import ApkInstallerSubPage from './ApkInstaller';

// ============================================
// SUB-PAGE SELECTOR
// ============================================
type SubPage = 'devices' | 'sessions' | 'report' | 'apps' | 'appupdate' | 'rates' | 'apkinstaller' | 'wallpaper';

// ============================================
// PHONE RENTAL MANAGEMENT PAGE
// ============================================
const PhoneRental: React.FC = () => {
  const [activeSubPage, setActiveSubPage] = useState<SubPage>('devices');
  const [devices, setDevices] = useState<RentalDevice[]>([]);
  const [sessions, setSessions] = useState<RentalSession[]>([]);
  const [report, setReport] = useState<RentalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [devs, sess, rep] = await Promise.all([
        apiClient.getRentalDevices().catch(() => []),
        apiClient.getRentalSessions().catch(() => []),
        apiClient.getRentalReport().catch(() => null)
      ]);
      setDevices(devs);
      setSessions(sess);
      setReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Sub-page tabs
  const subPages: { key: SubPage; label: string; icon: string }[] = [
    { key: 'devices', label: 'Devices', icon: '📱' },
    { key: 'sessions', label: 'Sessions', icon: '⏱️' },
    { key: 'apps', label: 'Allowed Apps', icon: '🔒' },
    { key: 'report', label: 'Report', icon: '📊' },
    { key: 'appupdate', label: 'App Update', icon: '⬆️' },
    { key: 'rates', label: 'CoinSlot Rates', icon: '💰' },
    { key: 'apkinstaller', label: 'APK Installer', icon: '📱' },
    { key: 'wallpaper', label: 'Wallpaper', icon: '🖼️' }
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">Phone Rental Management</h2>
          <p className="text-[10px] text-slate-500 mt-0.5">Manage rental devices, sessions, and bypass portal access</p>
        </div>
        <button onClick={loadData} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-200">
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard icon="📱" label="Total Devices" value={String(report.devices_online)} color="blue" />
          <SummaryCard icon="✅" label="Available" value={String(report.devices_available)} color="green" />
          <SummaryCard icon="🕒" label="Rented" value={String(report.devices_rented)} color="amber" />
          <SummaryCard icon="💰" label="Total Revenue" value={`₱${report.total_revenue.toFixed(2)}`} color="emerald" />
        </div>
      )}

      {/* Sub-page navigation */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex border-b border-slate-100">
          {subPages.map(sp => (
            <button
              key={sp.key}
              onClick={() => setActiveSubPage(sp.key)}
              className={`flex-1 px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                activeSubPage === sp.key
                  ? 'admin-tab-active'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {sp.icon} {sp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading && !devices.length ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-slate-500 text-xs">Loading phone rental data...</div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-xs">{error}</div>
      ) : (
        <>
          {activeSubPage === 'devices' && (
            <DevicesSubPage devices={devices} sessions={sessions} onRefresh={loadData} />
          )}
          {activeSubPage === 'sessions' && (
            <SessionsSubPage sessions={sessions} devices={devices} onRefresh={loadData} />
          )}
          {activeSubPage === 'report' && (
            <ReportSubPage report={report} sessions={sessions} devices={devices} />
          )}
          {activeSubPage === 'apps' && (
            <AllowedAppsSubPage devices={devices} />
          )}
          {activeSubPage === 'appupdate' && (
            <AppUpdateSubPage />
          )}
          {activeSubPage === 'rates' && (
            <CoinSlotRatesSubPage />
          )}
          {activeSubPage === 'apkinstaller' && (
            <ApkInstallerSubPage onRefresh={loadData} />
          )}
          {activeSubPage === 'wallpaper' && (
            <WallpaperSubPage devices={devices} />
          )}
        </>
      )}
    </div>
  );
};

// ============================================
// SUMMARY CARD
// ============================================
const SummaryCard: React.FC<{ icon: string; label: string; value: string; color: string }> = ({ icon, label, value, color }) => {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    green: 'bg-green-50 border-green-100 text-green-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    red: 'bg-red-50 border-red-100 text-red-700'
  };
  return (
    <div className={`rounded-xl border p-3 ${colorMap[color] || colorMap.blue}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest opacity-70">{label}</span>
      </div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
};

// ============================================
// DEVICES SUB-PAGE
// ============================================
const DevicesSubPage: React.FC<{
  devices: RentalDevice[];
  sessions: RentalSession[];
  onRefresh: () => void;
}> = ({ devices, sessions, onRefresh }) => {
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [editingDevice, setEditingDevice] = useState<RentalDevice | null>(null);
  const [renamingDevice, setRenamingDevice] = useState<RentalDevice | null>(null);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showStartRental, setShowStartRental] = useState<RentalDevice | null>(null);
  const [activatingDevice, setActivatingDevice] = useState<RentalDevice | null>(null);
  const [activationKey, setActivationKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [form, setForm] = useState({
    device_name: '',
    mac_address: '',
    ip_address: '',
    android_id: '',
    model: '',
    rental_rate_per_hour: 20,
    max_rental_hours: 8
  });
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setForm({ device_name: '', mac_address: '', ip_address: '', android_id: '', model: '', rental_rate_per_hour: 20, max_rental_hours: 8 });
    setEditingDevice(null);
  };

  const handleAddDevice = async () => {
    if (!form.device_name || !form.mac_address) {
      alert('Device name and MAC address are required.');
      return;
    }
    try {
      setSaving(true);
      await apiClient.createRentalDevice(form);
      setShowAddDevice(false);
      resetForm();
      onRefresh();
    } catch (err) {
      alert(`Failed to add device: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateDevice = async () => {
    if (!editingDevice) return;
    try {
      setSaving(true);
      await apiClient.updateRentalDevice(editingDevice.id, form);
      setEditingDevice(null);
      resetForm();
      onRefresh();
    } catch (err) {
      alert(`Failed to update device: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDevice = async (id: number) => {
    if (!confirm('Are you sure you want to remove this rental device?')) return;
    try {
      await apiClient.deleteRentalDevice(id);
      onRefresh();
    } catch (err) {
      alert(`Failed to delete device: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleToggleMaintenance = async (device: RentalDevice) => {
    const newStatus = device.status === 'maintenance' ? 'available' : 'maintenance';
    try {
      await apiClient.updateRentalDevice(device.id, { status: newStatus });
      onRefresh();
    } catch (err) {
      alert(`Failed to update status: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleRenameDevice = async () => {
    if (!renamingDevice || !newDeviceName.trim()) return;
    try {
      setSaving(true);
      await apiClient.updateRentalDevice(renamingDevice.id, { device_name: newDeviceName.trim() });
      setRenamingDevice(null);
      setNewDeviceName('');
      onRefresh();
    } catch (err) {
      alert(`Failed to rename device: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const openRename = (device: RentalDevice) => {
    setRenamingDevice(device);
    setNewDeviceName(device.device_name);
  };

  const openEdit = (device: RentalDevice) => {
    setEditingDevice(device);
    setForm({
      device_name: device.device_name,
      mac_address: device.mac_address,
      ip_address: device.ip_address || '',
      android_id: device.android_id || '',
      model: device.model || '',
      rental_rate_per_hour: device.rental_rate_per_hour,
      max_rental_hours: device.max_rental_hours
    });
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      available: { bg: 'bg-green-100', text: 'text-green-700', label: 'Available' },
      rented: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Rented' },
      maintenance: { bg: 'bg-red-100', text: 'text-red-700', label: 'Maintenance' },
      offline: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Offline' }
    };
    const s = map[status] || map.offline;
    return <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  const getActivationBadge = (device: RentalDevice) => {
    const status = (device as any).activation_status || 'trial';
    const trialExpires = (device as any).trial_expires_at;
    const licenseExpires = (device as any).license_expires_at;
    const accepted = (device as any).accepted_by_vendor;
    const vendorId = (device as any).vendor_id;
    const machineId = (device as any).machine_id;
    const cloudDeviceId = (device as any).cloud_device_id;

    const badgeMap: Record<string, { bg: string; text: string; label: string; icon: string }> = {
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending', icon: '⏳' },
      trial: { bg: 'bg-blue-100', text: 'text-blue-800', label: '7-Day Trial', icon: '🔄' },
      active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Full License', icon: '✅' },
      expired: { bg: 'bg-red-100', text: 'text-red-800', label: 'Expired', icon: '⚠️' },
      deactivated: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Deactivated', icon: '🚫' },
      rejected: { bg: 'bg-red-200', text: 'text-red-900', label: 'Rejected', icon: '❌' },
    };

    const b = badgeMap[status] || badgeMap.trial;
    const expiresAt = status === 'trial' ? trialExpires : licenseExpires;
    const daysLeft = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : null;

    const shortId = (id: string | null) => id ? `${id.slice(0, 8)}…` : '—';

    return (
      <div className="flex flex-col gap-0.5">
        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${b.bg} ${b.text}`}>
          {b.icon} {b.label}
        </span>
        {daysLeft !== null && status !== 'active' && (
          <span className={`text-[8px] font-bold ${daysLeft <= 2 ? 'text-red-600' : 'text-slate-500'}`}>
            {daysLeft}d left
          </span>
        )}
        {status === 'active' && licenseExpires && (
          <span className="text-[8px] text-slate-500">
            exp: {new Date(licenseExpires).toLocaleDateString()}
          </span>
        )}
        {!accepted && status === 'pending' && (
          <span className="text-[8px] text-yellow-600 font-bold">NOT ACCEPTED</span>
        )}
        <div className="mt-0.5 space-y-0.5">
          {vendorId && (
            <div className="text-[8px] text-slate-400" title={vendorId}>
              <span className="font-bold text-slate-500">Vendor:</span> {shortId(vendorId)}
            </div>
          )}
          {machineId && (
            <div className="text-[8px] text-slate-400" title={machineId}>
              <span className="font-bold text-slate-500">Machine:</span> {shortId(machineId)}
            </div>
          )}
          {cloudDeviceId && (
            <div className="text-[8px] text-slate-400" title={cloudDeviceId}>
              <span className="font-bold text-slate-500">Cloud ID:</span> {shortId(cloudDeviceId)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleAccept = async (deviceId: number) => {
    try {
      await apiClient.acceptRentalDevice(deviceId);
      onRefresh();
    } catch (err) {
      alert(`Failed to accept: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleReject = async (deviceId: number) => {
    if (!confirm('Reject this device? It will be deactivated.')) return;
    try {
      await apiClient.rejectRentalDevice(deviceId);
      onRefresh();
    } catch (err) {
      alert(`Failed to reject: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleActivate = async () => {
    if (!activatingDevice || !activationKey.trim()) return;
    try {
      setActivating(true);
      const result = await apiClient.activateRentalDevice(activatingDevice.id, activationKey.trim());
      if (result.success) {
        setActivatingDevice(null);
        setActivationKey('');
        onRefresh();
      } else {
        alert(`Activation failed: ${result.error || 'Invalid key'}`);
      }
    } catch (err) {
      alert(`Activation error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async (deviceId: number) => {
    if (!confirm('Deactivate this device? It will stop working.')) return;
    try {
      await apiClient.deactivateRentalDevice(deviceId);
      onRefresh();
    } catch (err) {
      alert(`Failed to deactivate: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleReactivate = async (deviceId: number) => {
    if (!confirm('Reactivate this device? It will get a new 7-day trial period.')) return;
    try {
      const result = await apiClient.reactivateRentalDevice(deviceId);
      if (result.success) {
        onRefresh();
      } else {
        alert(`Reactivation failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to reactivate: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const getActiveSessionForDevice = (deviceId: number) => {
    return sessions.find(s => s.device_id === deviceId && (s.status === 'active' || s.status === 'paused'));
  };

  const formatRemainingTime = (endTime: string) => {
    const end = new Date(endTime);
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    if (diffMs <= 0) return 'Expired';
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={async () => {
            if (syncing) return;
            setSyncing(true);
            try {
              const result = await apiClient.syncRentalDevicesToCloud();
              alert(`Cloud sync complete: ${result.synced} device(s) synced.`);
              onRefresh();
            } catch (err) {
              alert(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            } finally {
              setSyncing(false);
            }
          }}
          disabled={syncing}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-purple-600/20 hover:bg-purple-700 disabled:opacity-50"
          title="Force-push all devices to Supabase cloud"
        >
          {syncing ? '⏳ Syncing…' : '☁ Sync to Cloud'}
        </button>
        <button
          onClick={() => { resetForm(); setShowAddDevice(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-blue-600/20 hover:bg-blue-700"
        >
          + Add Device
        </button>
      </div>

      {/* Add/Edit Device Modal */}
      {(showAddDevice || editingDevice) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-md shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-tight">
              {editingDevice ? 'Edit Rental Device' : 'Add Rental Device'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Device Name *</label>
                <input type="text" value={form.device_name} onChange={e => setForm({...form, device_name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                  placeholder="e.g. Phone #1" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">MAC Address *</label>
                <input type="text" value={form.mac_address} onChange={e => setForm({...form, mac_address: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                  placeholder="AA:BB:CC:DD:EE:FF" disabled={!!editingDevice} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">IP Address</label>
                  <input type="text" value={form.ip_address} onChange={e => setForm({...form, ip_address: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                    placeholder="10.0.0.x" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Model</label>
                  <input type="text" value={form.model} onChange={e => setForm({...form, model: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                    placeholder="Samsung A12" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Android ID</label>
                <input type="text" value={form.android_id} onChange={e => setForm({...form, android_id: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                  placeholder="Auto-filled by app" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rate/Hour (₱)</label>
                  <input type="number" value={form.rental_rate_per_hour} onChange={e => setForm({...form, rental_rate_per_hour: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Max Hours</label>
                  <input type="number" value={form.max_rental_hours} onChange={e => setForm({...form, max_rental_hours: Number(e.target.value)})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setShowAddDevice(false); setEditingDevice(null); resetForm(); }}
                  className="px-4 py-2 text-slate-500 text-[10px] font-bold uppercase">Cancel</button>
                <button onClick={editingDevice ? handleUpdateDevice : handleAddDevice} disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-blue-600/20 disabled:opacity-50">
                  {saving ? 'Saving...' : editingDevice ? 'Update' : 'Add Device'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start Rental Modal */}
      {showStartRental && (
        <StartRentalModal
          device={showStartRental}
          onClose={() => setShowStartRental(null)}
          onRefresh={onRefresh}
        />
      )}

      {/* Activation Key Modal */}
      {activatingDevice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-md shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-800 mb-2 uppercase tracking-tight">
              Activate Device
            </h3>
            <p className="text-[10px] text-slate-500 mb-4">
              Enter an activation key for <strong>{activatingDevice.device_name}</strong>
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Activation Key</label>
                <input
                  type="text"
                  value={activationKey}
                  onChange={e => setActivationKey(e.target.value.toUpperCase())}
                  className="w-full px-3 py-3 border-2 border-purple-200 rounded-lg text-sm font-mono tracking-wider text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                  placeholder="RENT-XXXX-XXXX-XXXX"
                  onKeyDown={e => e.key === 'Enter' && handleActivate()}
                />
              </div>
              {(activatingDevice as any).activation_status === 'expired' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[10px] text-red-700">
                  This device's trial or license has expired. Enter a valid activation key to continue using it.
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setActivatingDevice(null); setActivationKey(''); }}
                  className="px-4 py-2 text-slate-500 text-[10px] font-bold uppercase">Cancel</button>
                <button onClick={handleActivate} disabled={activating || !activationKey.trim()}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-purple-600/20 disabled:opacity-50">
                  {activating ? 'Activating...' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Devices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Rental Devices ({devices.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[9px] uppercase font-bold tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-4 py-2">Device</th>
                <th className="px-4 py-2">Network</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Activation</th>
                <th className="px-4 py-2">Rate</th>
                <th className="px-4 py-2">Timer</th>
                <th className="px-4 py-2">Revenue</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[11px] text-slate-400">No rental devices registered. Add one to get started.</td></tr>
              )}
              {devices.map(device => {
                const activeSession = getActiveSessionForDevice(device.id);
                return (
                  <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-sm">📱</div>
                        <div>
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-bold text-slate-900">{device.device_name}</span>
                            <button 
                              onClick={() => openRename(device)}
                              className="text-[9px] text-blue-600 hover:text-blue-800 font-bold"
                              title="Rename device"
                            >
                              ✏️
                            </button>
                          </div>
                          <div className="text-[9px] text-slate-400 uppercase">{device.model || 'Unknown Model'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-[10px] font-bold text-slate-700">{device.ip_address || '-'}</div>
                      <div className="text-[9px] text-slate-400">{device.mac_address}</div>
                      {(device as any).hostname && (
                        <div className="text-[9px] text-emerald-600">{(device as any).hostname}</div>
                      )}
                      {device.mac_address === 'UNKNOWN' && device.ip_address && (
                        <div className="text-[9px] text-amber-500">MAC not resolved</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {activeSession?.status === 'paused' ? (
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-blue-100 text-blue-700">Paused</span>
                      ) : (
                        getStatusBadge(device.status)
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{getActivationBadge(device)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-[10px] font-bold text-slate-700">₱{device.rental_rate_per_hour}/hr</div>
                      <div className="text-[9px] text-slate-400">Max {device.max_rental_hours}h</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {activeSession ? (
                        <div>
                          {activeSession.status === 'paused' ? (
                            <div className="text-[10px] font-black text-blue-600">PAUSED</div>
                          ) : (
                            <div className="text-[10px] font-black text-amber-600">
                              <TimerDisplay endTime={activeSession.end_time!} />
                            </div>
                          )}
                          <div className="text-[9px] text-slate-400">{activeSession.customer_name || 'Walk-in'}</div>
                        </div>
                      ) : (
                        <span className="text-[9px] text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-[10px] font-bold text-emerald-600">₱{device.total_revenue.toFixed(2)}</div>
                      <div className="text-[9px] text-slate-400">{device.total_rentals} rentals</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {!(device as any).accepted_by_vendor && (device as any).activation_status === 'trial' && (
                          <button onClick={() => handleAccept(device.id)}
                            className="px-2 py-1 bg-green-600 text-white rounded text-[9px] font-bold uppercase hover:bg-green-700"
                            title="Accept Device">Accept</button>
                        )}
                        {!(device as any).accepted_by_vendor && (device as any).activation_status === 'pending' && (
                          <>
                            <button onClick={() => handleAccept(device.id)}
                              className="px-2 py-1 bg-green-600 text-white rounded text-[9px] font-bold uppercase hover:bg-green-700">Accept</button>
                            <button onClick={() => handleReject(device.id)}
                              className="px-2 py-1 bg-red-600 text-white rounded text-[9px] font-bold uppercase hover:bg-red-700">Reject</button>
                          </>
                        )}
                        {((device as any).activation_status === 'trial' || (device as any).activation_status === 'expired') && (device as any).accepted_by_vendor && (
                          <button onClick={() => { setActivatingDevice(device); setActivationKey(''); }}
                            className="px-2 py-1 bg-purple-600 text-white rounded text-[9px] font-bold uppercase hover:bg-purple-700"
                            title="Enter Activation Key">Activate</button>
                        )}
                        {(device as any).activation_status === 'active' && (
                          <button onClick={() => handleDeactivate(device.id)}
                            className="px-2 py-1 bg-gray-500 text-white rounded text-[9px] font-bold uppercase hover:bg-gray-600"
                            title="Deactivate Device">Deactivate</button>
                        )}
                        {((device as any).activation_status === 'deactivated' || (device as any).activation_status === 'expired' || (device as any).activation_status === 'rejected') && (
                          <button onClick={() => handleReactivate(device.id)}
                            className="px-2 py-1 bg-emerald-600 text-white rounded text-[9px] font-bold uppercase hover:bg-emerald-700"
                            title="Reactivate device with new 7-day trial">Re-activate</button>
                        )}
                        {device.status === 'available' && !activeSession && (
                          <button onClick={() => setShowStartRental(device)}
                            className="px-2 py-1 bg-green-600 text-white rounded text-[9px] font-bold uppercase hover:bg-green-700"
                            title="Start Rental">Rent</button>
                        )}
                        {activeSession && (
                          <>
                            {activeSession.status === 'paused' ? (
                              <button onClick={async () => {
                                try { await apiClient.kioskResumeSession(activeSession.id); onRefresh(); }
                                catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                              }}
                                className="px-2 py-1 bg-emerald-600 text-white rounded text-[9px] font-bold uppercase hover:bg-emerald-700"
                                title="Resume Kiosk">Resume</button>
                            ) : (
                              <button onClick={async () => {
                                if (!confirm('Logout kiosk for this device? Timer will be paused.')) return;
                                try { await apiClient.kioskLogoutSession(activeSession.id); onRefresh(); }
                                catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                              }}
                                className="px-2 py-1 bg-amber-600 text-white rounded text-[9px] font-bold uppercase hover:bg-amber-700"
                                title="Logout Kiosk">Logout Kiosk</button>
                            )}
                            <button onClick={async () => {
                              try { await apiClient.endRentalSession(activeSession.id); onRefresh(); }
                              catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                            }}
                              className="px-2 py-1 bg-red-600 text-white rounded text-[9px] font-bold uppercase hover:bg-red-700"
                              title="End Rental">Return</button>
                          </>
                        )}
                        {device.ip_address && (
                          <>
                            <button onClick={async () => {
                              try { await apiClient.bypassRentalDevice(device.id); alert(`Internet enabled for ${device.device_name}`); }
                              catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                            }}
                              className="px-2 py-1 bg-cyan-600 text-white rounded text-[9px] font-bold uppercase hover:bg-cyan-700"
                              title="Allow Internet (Bypass Captive Portal)">Bypass</button>
                            <button onClick={async () => {
                              try { await apiClient.unblockRentalDevice(device.id); alert(`Internet removed for ${device.device_name}`); }
                              catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                            }}
                              className="px-2 py-1 bg-orange-600 text-white rounded text-[9px] font-bold uppercase hover:bg-orange-700"
                              title="Block Internet (Return to Captive Portal)">Block</button>
                          </>
                        )}
                        <button onClick={() => handleToggleMaintenance(device)}
                          className={`p-1.5 rounded hover:bg-slate-100 ${device.status === 'maintenance' ? 'text-red-600' : 'text-slate-400'}`}
                          title={device.status === 'maintenance' ? 'Set Available' : 'Set Maintenance'}>🔧</button>
                        <button onClick={() => openEdit(device)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Edit">✏️</button>
                        <button onClick={() => handleDeleteDevice(device.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">🗑️</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Rename Modal */}
      {renamingDevice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-2xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-800 mb-1 uppercase tracking-tight">Rename Device</h3>
            <p className="text-[10px] text-slate-500 mb-4">Give this device a custom name for easier identification</p>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Device Name</label>
                <input 
                  type="text" 
                  value={newDeviceName} 
                  onChange={e => setNewDeviceName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRenameDevice()}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                  placeholder="e.g., Rental 1, Unit A, etc."
                  autoFocus
                />
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
                <div className="text-[9px] text-blue-600">
                  <strong>MAC:</strong> {renamingDevice.mac_address}
                </div>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => { setRenamingDevice(null); setNewDeviceName(''); }}
                  className="flex-1 px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-200"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRenameDevice}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase hover:bg-blue-700 disabled:opacity-50"
                  disabled={saving || !newDeviceName.trim()}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// LIVE TIMER DISPLAY
// ============================================
const TimerDisplay: React.FC<{ endTime: string }> = ({ endTime }) => {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const end = new Date(endTime);
      const now = new Date();
      const diffMs = end.getTime() - now.getTime();
      if (diffMs <= 0) {
        setRemaining('EXPIRED');
        return;
      }
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      const s = Math.floor((diffMs % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  return <span className={remaining === 'EXPIRED' ? 'text-red-600' : ''}>{remaining}</span>;
};

// ============================================
// START RENTAL MODAL
// ============================================
const StartRentalModal: React.FC<{
  device: RentalDevice;
  onClose: () => void;
  onRefresh: () => void;
}> = ({ device, onClose, onRefresh }) => {
  const [duration, setDuration] = useState(60);
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saving, setSaving] = useState(false);

  const amount = (duration / 60) * device.rental_rate_per_hour;

  const handleStart = async () => {
    try {
      setSaving(true);
      await apiClient.startRentalSession({
        device_id: device.id,
        customer_name: customerName || undefined,
        customer_contact: customerContact || undefined,
        duration_minutes: duration,
        amount_paid: amount,
        payment_method: paymentMethod
      });
      onRefresh();
      onClose();
    } catch (err) {
      alert(`Failed to start rental: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const quickDurations = [
    { label: '30min', value: 30 },
    { label: '1hr', value: 60 },
    { label: '2hrs', value: 120 },
    { label: '3hrs', value: 180 },
    { label: '5hrs', value: 300 },
    { label: '8hrs', value: 480 }
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md shadow-2xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-800 mb-1 uppercase tracking-tight">Start Rental</h3>
        <p className="text-[10px] text-slate-500 mb-4">{device.device_name} - ₱{device.rental_rate_per_hour}/hr</p>

        <div className="space-y-3">
          {/* Quick Duration Buttons */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Duration</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {quickDurations.map(d => (
                <button key={d.value} onClick={() => setDuration(d.value)}
                  className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors ${
                    duration === d.value ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
            <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              min={1} max={device.max_rental_hours * 60} />
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-blue-600 uppercase">Amount Due</span>
              <span className="text-lg font-black text-blue-700">₱{amount.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Customer Name (Optional)</label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Walk-in" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Contact Number (Optional)</label>
            <input type="text" value={customerContact} onChange={e => setCustomerContact(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="09XX XXX XXXX" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Payment Method</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none">
              <option value="cash">Cash</option>
              <option value="coins">Coins</option>
              <option value="ewallet">E-Wallet</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="px-4 py-2 text-slate-500 text-[10px] font-bold uppercase">Cancel</button>
            <button onClick={handleStart} disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-green-600/20 disabled:opacity-50">
              {saving ? 'Starting...' : 'Start Rental'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// SESSIONS SUB-PAGE
// ============================================
const SessionsSubPage: React.FC<{
  sessions: RentalSession[];
  devices: RentalDevice[];
  onRefresh: () => void;
}> = ({ sessions, devices, onRefresh }) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showExtend, setShowExtend] = useState<RentalSession | null>(null);
  const [syncingSessions, setSyncingSessions] = useState(false);

  const filtered = sessions.filter(s => statusFilter === 'all' || s.status === statusFilter);

  const handleSyncSessions = async () => {
    if (syncingSessions) return;
    setSyncingSessions(true);
    try {
      const result = await apiClient.syncRentalSessionsToCloud();
      alert(`Sessions synced: ${result.ok} ok, ${result.fail} failed (${result.total} total).`);
      onRefresh();
    } catch (err) {
      alert(`Session sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSyncingSessions(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
      completed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Completed' },
      overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
      cancelled: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Cancelled' },
      paused: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Paused' }
    };
    const s = map[status] || map.cancelled;
    return <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
  };

  return (
    <div className="space-y-4">
      {/* Filter + Cloud Sync */}
      <div className="flex gap-2 items-center flex-wrap">
        <label className="text-[10px] font-bold text-slate-500 uppercase">Filter:</label>
        {['all', 'active', 'paused', 'completed', 'overdue', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase ${
              statusFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}>
            {s}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={handleSyncSessions}
            disabled={syncingSessions}
            className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-[9px] font-bold uppercase hover:bg-purple-700 disabled:opacity-50"
            title="Force-push all sessions to Supabase cloud"
          >
            {syncingSessions ? '⏳ Syncing…' : '☁ Sync Sessions'}
          </button>
        </div>
      </div>

      {/* Extend Modal */}
      {showExtend && (
        <ExtendRentalModal
          session={showExtend}
          devices={devices}
          onClose={() => setShowExtend(null)}
          onRefresh={onRefresh}
        />
      )}

      {/* Sessions Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[9px] uppercase font-bold tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-4 py-2">Device</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Start</th>
                <th className="px-4 py-2">End</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[11px] text-slate-400">No sessions found.</td></tr>
              )}
              {filtered.map(session => {
                const device = devices.find(d => d.id === session.device_id);
                return (
                  <tr key={session.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="text-[10px] font-bold text-slate-900">{device?.device_name || `Device #${session.device_id}`}</div>
                      <div className="text-[9px] text-slate-400">{device?.mac_address}</div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="text-[10px] font-bold text-slate-700">{session.customer_name || 'Walk-in'}</div>
                      <div className="text-[9px] text-slate-400">{session.customer_contact || '-'}</div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-[10px] text-slate-600">{formatTime(session.start_time)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {session.status === 'active' && session.end_time ? (
                        <div className="text-[10px] font-black text-amber-600">
                          <TimerDisplay endTime={session.end_time} />
                        </div>
                      ) : session.status === 'paused' ? (
                        <div className="text-[10px] font-black text-blue-600">PAUSED</div>
                      ) : (
                        <span className="text-[10px] text-slate-500">{formatTime(session.end_time)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-[10px] font-bold text-slate-700">
                      {session.duration_minutes}min
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-[10px] font-bold text-emerald-600">
                      ₱{session.amount_paid.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{getStatusBadge(session.status)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                      {session.status === 'active' && (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setShowExtend(session)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-[9px] font-bold uppercase hover:bg-blue-700"
                            title="Extend">Extend</button>
                          <button onClick={async () => {
                            if (!confirm('Logout kiosk for this device? Timer will be paused.')) return;
                            try { await apiClient.kioskLogoutSession(session.id); onRefresh(); }
                            catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                          }}
                            className="px-2 py-1 bg-amber-600 text-white rounded text-[9px] font-bold uppercase hover:bg-amber-700"
                            title="Logout Kiosk">Logout</button>
                          <button onClick={async () => {
                            try { await apiClient.endRentalSession(session.id); onRefresh(); }
                            catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                          }}
                            className="px-2 py-1 bg-red-600 text-white rounded text-[9px] font-bold uppercase hover:bg-red-700"
                            title="End">Return</button>
                        </div>
                      )}
                      {session.status === 'paused' && (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={async () => {
                            try { await apiClient.kioskResumeSession(session.id); onRefresh(); }
                            catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                          }}
                            className="px-2 py-1 bg-emerald-600 text-white rounded text-[9px] font-bold uppercase hover:bg-emerald-700"
                            title="Resume Kiosk">Resume</button>
                          <button onClick={async () => {
                            try { await apiClient.endRentalSession(session.id); onRefresh(); }
                            catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
                          }}
                            className="px-2 py-1 bg-red-600 text-white rounded text-[9px] font-bold uppercase hover:bg-red-700"
                            title="End">Return</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================
// EXTEND RENTAL MODAL
// ============================================
const ExtendRentalModal: React.FC<{
  session: RentalSession;
  devices: RentalDevice[];
  onClose: () => void;
  onRefresh: () => void;
}> = ({ session, devices, onClose, onRefresh }) => {
  const [additionalMinutes, setAdditionalMinutes] = useState(60);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saving, setSaving] = useState(false);

  const device = devices.find(d => d.id === session.device_id);
  const additionalAmount = device ? (additionalMinutes / 60) * device.rental_rate_per_hour : 0;

  const handleExtend = async () => {
    try {
      setSaving(true);
      await apiClient.extendRentalSession(session.id, {
        additional_minutes: additionalMinutes,
        amount_paid: additionalAmount,
        payment_method: paymentMethod
      });
      onRefresh();
      onClose();
    } catch (err) {
      alert(`Failed to extend: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const quickExtends = [
    { label: '30min', value: 30 },
    { label: '1hr', value: 60 },
    { label: '2hrs', value: 120 },
    { label: '3hrs', value: 180 }
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-2xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-tight">Extend Rental</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {quickExtends.map(q => (
              <button key={q.value} onClick={() => setAdditionalMinutes(q.value)}
                className={`px-2 py-2 rounded-lg text-[9px] font-bold uppercase ${
                  additionalMinutes === q.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {q.label}
              </button>
            ))}
          </div>
          <input type="number" value={additionalMinutes} onChange={e => setAdditionalMinutes(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none"
            min={1} />
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div className="flex justify-between">
              <span className="text-[10px] font-bold text-blue-600 uppercase">Additional Amount</span>
              <span className="text-lg font-black text-blue-700">₱{additionalAmount.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Payment Method</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none">
              <option value="cash">Cash</option>
              <option value="coins">Coins</option>
              <option value="ewallet">E-Wallet</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="px-4 py-2 text-slate-500 text-[10px] font-bold uppercase">Cancel</button>
            <button onClick={handleExtend} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase disabled:opacity-50">
              {saving ? 'Extending...' : 'Extend'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// REPORT SUB-PAGE
// ============================================
const ReportSubPage: React.FC<{
  report: RentalReport | null;
  sessions: RentalSession[];
  devices: RentalDevice[];
}> = ({ report, sessions, devices }) => {
  if (!report) return <div className="text-center py-8 text-slate-400 text-xs">No report data available.</div>;

  const completedSessions = sessions.filter(s => s.status === 'completed');
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = completedSessions.filter(s => s.start_time && s.start_time.startsWith(today));
  const todayRevenue = todaySessions.reduce((sum, s) => sum + s.amount_paid, 0);

  // Group sessions by date for the last 7 days
  const last7Days: { date: string; sessions: number; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const daySessions = completedSessions.filter(s => s.start_time && s.start_time.startsWith(dateStr));
    last7Days.push({
      date: dateStr,
      sessions: daySessions.length,
      revenue: daySessions.reduce((sum, s) => sum + s.amount_paid, 0)
    });
  }

  const maxRevenue = Math.max(...last7Days.map(d => d.revenue), 1);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon="💰" label="Today Revenue" value={`₱${todayRevenue.toFixed(2)}`} color="emerald" />
        <SummaryCard icon="📋" label="Today Sessions" value={String(todaySessions.length)} color="blue" />
        <SummaryCard icon="📊" label="Avg Duration" value={`${report.avg_duration_minutes}min`} color="amber" />
        <SummaryCard icon="🔄" label="Active Rentals" value={String(report.active_rentals)} color="green" />
      </div>

      {/* 7-Day Revenue Chart (Simple bar chart) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest mb-4">7-Day Revenue</h3>
        <div className="flex items-end gap-2 h-40">
          {last7Days.map(day => {
            const height = maxRevenue > 0 ? (day.revenue / maxRevenue) * 100 : 0;
            const dayLabel = new Date(day.date).toLocaleDateString('en', { weekday: 'short' });
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[8px] font-bold text-emerald-600">₱{day.revenue.toFixed(0)}</div>
                <div className="w-full bg-slate-100 rounded-t relative" style={{ height: '100%' }}>
                  <div className="absolute bottom-0 w-full bg-emerald-500 rounded-t transition-all"
                    style={{ height: `${Math.max(height, 2)}%` }} />
                </div>
                <div className="text-[8px] font-bold text-slate-500 uppercase">{dayLabel}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Device Performance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Device Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[9px] uppercase font-bold tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-4 py-2">Device</th>
                <th className="px-4 py-2">Total Rentals</th>
                <th className="px-4 py-2">Revenue</th>
                <th className="px-4 py-2">Last Rented</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.map(device => (
                <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="text-[10px] font-bold text-slate-900">{device.device_name}</div>
                    <div className="text-[9px] text-slate-400">{device.model || '-'}</div>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-[10px] font-bold text-slate-700">{device.total_rentals}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-[10px] font-bold text-emerald-600">₱{device.total_revenue.toFixed(2)}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-[10px] text-slate-500">
                    {device.last_rented_at ? new Date(device.last_rented_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${
                      device.status === 'available' ? 'bg-green-100 text-green-700' :
                      device.status === 'rented' ? 'bg-amber-100 text-amber-700' :
                      device.status === 'maintenance' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>{device.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================
// ALLOWED APPS SUB-PAGE
// ============================================
const COMMON_APPS = [
  { package: 'com.facebook.katana', name: 'Facebook', category: 'Social' },
  { package: 'com.facebook.orca', name: 'Messenger', category: 'Social' },
  { package: 'com.mobile.legends', name: 'Mobile Legends', category: 'Games' },
  { package: 'com.roblox.client', name: 'Roblox', category: 'Games' },
  { package: 'com.zhiliaoapp.musically', name: 'TikTok', category: 'Social' },
  { package: 'com.instagram.android', name: 'Instagram', category: 'Social' },
  { package: 'com.google.android.youtube', name: 'YouTube', category: 'Entertainment' },
  { package: 'com.twitter.android', name: 'X (Twitter)', category: 'Social' },
  { package: 'com.snapchat.android', name: 'Snapchat', category: 'Social' },
  { package: 'com.whatsapp', name: 'WhatsApp', category: 'Messaging' },
  { package: 'com.viber.voip', name: 'Viber', category: 'Messaging' },
  { package: 'org.telegram.messenger', name: 'Telegram', category: 'Messaging' },
  { package: 'com.garena.game.kgth', name: 'Free Fire', category: 'Games' },
  { package: 'com.tencent.ig', name: 'PUBG Mobile', category: 'Games' },
  { package: 'com.riotgames.league.wildrift', name: 'Wild Rift', category: 'Games' },
  { package: 'com.supercell.clashofclans', name: 'Clash of Clans', category: 'Games' },
  { package: 'com.supercell.clashroyale', name: 'Clash Royale', category: 'Games' },
  { package: 'com.nianticlabs.pokemongo', name: 'Pokemon GO', category: 'Games' },
  { package: 'com.google.android.gm', name: 'Gmail', category: 'Utility' },
  { package: 'com.android.chrome', name: 'Chrome', category: 'Utility' },
  { package: 'com.google.android.apps.maps', name: 'Google Maps', category: 'Utility' },
  { package: 'com.android.vending', name: 'Play Store', category: 'Utility' },
  { package: 'com.spotify.music', name: 'Spotify', category: 'Entertainment' },
  { package: 'com.netflix.mediaclient', name: 'Netflix', category: 'Entertainment' },
];

const AllowedAppsSubPage: React.FC<{ devices: RentalDevice[] }> = ({ devices }) => {
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [allowedApps, setAllowedApps] = useState<string[]>([]);
  const [customPackage, setCustomPackage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedDevice) {
      loadAllowedApps(selectedDevice);
    }
  }, [selectedDevice]);

  const loadAllowedApps = async (deviceId: number) => {
    try {
      setLoading(true);
      const result = await apiClient.getRentalDeviceAllowedApps(deviceId);
      setAllowedApps(result.allowed_apps || []);
    } catch {
      setAllowedApps([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleApp = (pkg: string) => {
    setAllowedApps(prev =>
      prev.includes(pkg) ? prev.filter(p => p !== pkg) : [...prev, pkg]
    );
  };

  const saveApps = async () => {
    if (!selectedDevice) return;
    try {
      setSaving(true);
      await apiClient.setRentalDeviceAllowedApps(selectedDevice, allowedApps);
      alert('Allowed apps saved! The device will sync on next rental session.');
    } catch (err: any) {
      alert('Error saving: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const addCustomPackage = () => {
    const pkg = customPackage.trim();
    if (pkg && !allowedApps.includes(pkg)) {
      setAllowedApps(prev => [...prev, pkg]);
      setCustomPackage('');
    }
  };

  const categories = [...new Set(COMMON_APPS.map(a => a.category))];

  return (
    <div className="space-y-4">
      {/* Device Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">
          Select Device
        </label>
        <select
          value={selectedDevice || ''}
          onChange={e => setSelectedDevice(Number(e.target.value) || null)}
          className="w-full p-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">-- Choose a device --</option>
          {devices.map(d => (
            <option key={d.id} value={d.id}>{d.device_name} ({d.status})</option>
          ))}
        </select>
      </div>

      {!selectedDevice ? (
        <div className="text-center py-10 text-slate-500 text-xs">
          Select a device above to configure allowed apps
        </div>
      ) : loading ? (
        <div className="text-center py-10 text-slate-500 text-xs">Loading...</div>
      ) : (
        <>
          {/* Quick Toggle: All Common / None */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                Allowed Apps ({allowedApps.length} selected)
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setAllowedApps(COMMON_APPS.map(a => a.package))}
                  className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[9px] font-bold hover:bg-blue-200"
                >
                  Select All
                </button>
                <button
                  onClick={() => setAllowedApps([])}
                  className="px-2 py-1 bg-red-100 text-red-700 rounded text-[9px] font-bold hover:bg-red-200"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Apps by Category */}
            {categories.map(cat => {
              const catApps = COMMON_APPS.filter(a => a.category === cat);
              return (
                <div key={cat} className="mb-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{cat}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {catApps.map(app => (
                      <button
                        key={app.package}
                        onClick={() => toggleApp(app.package)}
                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                          allowedApps.includes(app.package)
                            ? 'bg-green-100 border-green-400 text-green-800'
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                        }`
                        }
                      >
                        {allowedApps.includes(app.package) ? '✓ ' : ''}{app.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Custom Package Input */}
            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Add Custom Package</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPackage}
                  onChange={e => setCustomPackage(e.target.value)}
                  placeholder="com.example.app"
                  className="flex-1 p-2 border border-slate-300 rounded-lg text-xs"
                  onKeyDown={e => e.key === 'Enter' && addCustomPackage()}
                />
                <button
                  onClick={addCustomPackage}
                  className="px-3 py-2 bg-slate-700 text-white rounded-lg text-xs font-bold hover:bg-slate-800"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Currently Allowed List */}
          {allowedApps.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                Allowed Packages
              </h3>
              <div className="flex flex-wrap gap-1">
                {allowedApps.map(pkg => {
                  const known = COMMON_APPS.find(a => a.package === pkg);
                  return (
                    <span key={pkg} className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded text-[10px]">
                      {known?.name || pkg}
                      <button
                        onClick={() => toggleApp(pkg)}
                        className="text-red-500 hover:text-red-700 font-bold ml-1"
                      >✕</button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Save Button */}
          <button
            onClick={saveApps}
            disabled={saving}
            className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Allowed Apps'}
          </button>
        </>
      )}
    </div>
  );
};

// ============================================
// APP UPDATE SUB-PAGE (OTA)
// ============================================
interface AppUpdateMeta {
  version_code: number;
  version_name: string;
  filename: string;
  release_notes: string;
  published_at?: string;
  apk_url?: string;
}

const AppUpdateSubPage: React.FC = () => {
  const [currentMeta, setCurrentMeta] = useState<AppUpdateMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [form, setForm] = useState({ version_code: '', version_name: '', release_notes: '' });
  const [apkFile, setApkFile] = useState<File | null>(null);

  useEffect(() => {
    fetchCurrentMeta();
  }, []);

  const fetchCurrentMeta = async () => {
    try {
      setLoadingMeta(true);
      const res = await fetch('/api/phone-rental/app-update');
      const data = await res.json();
      setCurrentMeta(data.version_code > 0 ? data : null);
    } catch {
      setCurrentMeta(null);
    } finally {
      setLoadingMeta(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setApkFile(file);
    if (file) {
      // Auto-parse version from filename e.g. RJD-Phone-Rental-v1.6.0-debug.apk
      const match = file.name.match(/v(\d+\.\d+\.\d+)/);
      if (match) setForm(f => ({ ...f, version_name: match[1] }));
    }
  };

  const handleUpload = async () => {
    setUploadError('');
    setUploadSuccess('');
    if (!apkFile) return setUploadError('Please select an APK file.');
    if (!form.version_code || !form.version_name) return setUploadError('Version code and name are required.');

    try {
      setUploading(true);
      setUploadProgress('Uploading APK...');
      const fd = new FormData();
      fd.append('apk', apkFile);
      fd.append('version_code', form.version_code);
      fd.append('version_name', form.version_name);
      fd.append('release_notes', form.release_notes);

      const res = await fetch('/api/phone-rental/app-update/upload', {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setUploadSuccess(`Published v${data.meta.version_name} (code ${data.meta.version_code}) successfully! Devices will update on next startup.`);
      setForm({ version_code: '', version_name: '', release_notes: '' });
      setApkFile(null);
      fetchCurrentMeta();
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Current Published Version */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Currently Published Version</h3>
        {loadingMeta ? (
          <div className="text-xs text-slate-400">Loading...</div>
        ) : currentMeta ? (
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-black text-slate-800">v{currentMeta.version_name}</div>
              <div className="text-[10px] text-slate-500">Version Code: {currentMeta.version_code}</div>
              <div className="text-[10px] text-slate-500">File: {currentMeta.filename}</div>
              {currentMeta.published_at && (
                <div className="text-[10px] text-slate-400">Published: {new Date(currentMeta.published_at).toLocaleString()}</div>
              )}
              {currentMeta.release_notes && (
                <div className="mt-2 text-[10px] text-slate-600 bg-slate-50 rounded p-2">{currentMeta.release_notes}</div>
              )}
            </div>
            <a
              href="/api/phone-rental/app-update/download"
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-700"
              download
            >
              Download APK
            </a>
          </div>
        ) : (
          <div className="text-xs text-slate-400 py-2">No APK published yet. Upload one below to enable OTA updates.</div>
        )}
      </div>

      {/* Upload New Version */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Publish New Version</h3>

        {uploadSuccess && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">{uploadSuccess}</div>
        )}
        {uploadError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{uploadError}</div>
        )}

        <div className="space-y-3">
          {/* APK File */}
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">APK File</label>
            <input
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={handleFileChange}
              className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
            />
            {apkFile && (
              <div className="text-[9px] text-slate-500 mt-1">{apkFile.name} ({(apkFile.size / 1024 / 1024).toFixed(1)} MB)</div>
            )}
          </div>

          {/* Version fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Version Code (integer)</label>
              <input
                type="number"
                value={form.version_code}
                onChange={e => setForm(f => ({ ...f, version_code: e.target.value }))}
                placeholder="e.g. 7"
                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Version Name</label>
              <input
                type="text"
                value={form.version_name}
                onChange={e => setForm(f => ({ ...f, version_name: e.target.value }))}
                placeholder="e.g. 1.6.0"
                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>

          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Release Notes (optional)</label>
            <textarea
              value={form.release_notes}
              onChange={e => setForm(f => ({ ...f, release_notes: e.target.value }))}
              placeholder="What changed in this version..."
              rows={3}
              className="w-full p-2 border border-slate-300 rounded-lg text-xs resize-none"
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || !apkFile}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploading ? (uploadProgress || 'Uploading...') : 'Publish Update'}
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">How OTA Updates Work</h3>
        <ol className="text-[10px] text-blue-800 space-y-1 list-decimal list-inside">
          <li>Build a new APK with a higher <strong>versionCode</strong> in build.gradle</li>
          <li>Upload it here and set the correct version code + name</li>
          <li>All rental devices will detect the update on their next startup or heartbeat</li>
          <li>The app downloads and installs automatically — no manual uninstall needed</li>
        </ol>
      </div>
    </div>
  );
};

// ============================================
// COIN SLOT RATES SUB-PAGE
// ============================================
const CoinSlotRatesSubPage: React.FC = () => {
  const [rates, setRates] = useState<PhoneRentalRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ pesos: 10, minutes: 60, label: '' });

  const loadRates = async () => {
    try {
      setLoading(true);
      const fetchedRates = await apiClient.getPhoneRentalRates();
      setRates(fetchedRates);
    } catch (err) {
      console.error('Failed to load rates:', err);
      alert('Failed to load rates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRates();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await apiClient.savePhoneRentalRates(rates);
      alert('Rates saved successfully!');
      setShowAddForm(false);
      setEditingId(null);
    } catch (err) {
      alert('Failed to save rates: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddRate = () => {
    if (form.pesos <= 0 || form.minutes <= 0) {
      alert('Pesos and minutes must be positive numbers');
      return;
    }
    const newRate: PhoneRentalRate = {
      id: Date.now().toString(),
      pesos: form.pesos,
      minutes: form.minutes,
      label: form.label || `${form.minutes} mins`
    };
    setRates([...rates, newRate]);
    setForm({ pesos: 10, minutes: 60, label: '' });
    setShowAddForm(false);
  };

  const handleUpdateRate = (id: string) => {
    setRates(rates.map(r => r.id === id ? { ...r, ...form } : r));
    setEditingId(null);
    setForm({ pesos: 10, minutes: 60, label: '' });
  };

  const handleDeleteRate = (id: string) => {
    if (confirm('Delete this rate?')) {
      setRates(rates.filter(r => r.id !== id));
    }
  };

  const startEdit = (rate: PhoneRentalRate) => {
    setEditingId(rate.id);
    setForm({ pesos: rate.pesos, minutes: rate.minutes, label: rate.label || '' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="text-slate-500 text-xs">Loading rates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">💰 Phone Rental CoinSlot Rates</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">Set pricing for phone rental sessions (separate from PisoWiFi rates)</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-700"
        >
          + Add Rate
        </button>
      </div>

      {/* Add Rate Form */}
      {showAddForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-600">Add New Rate</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Pesos (₱)</label>
              <input
                type="number"
                value={form.pesos}
                onChange={e => setForm(f => ({ ...f, pesos: parseInt(e.target.value) || 0 }))}
                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                min="1"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Minutes</label>
              <input
                type="number"
                value={form.minutes}
                onChange={e => setForm(f => ({ ...f, minutes: parseInt(e.target.value) || 0 }))}
                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                min="1"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Label (optional)</label>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g., 1 Hour"
                className="w-full p-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddRate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-700"
            >
              Add to List
            </button>
            <button
              onClick={() => { setShowAddForm(false); setForm({ pesos: 10, minutes: 60, label: '' }); }}
              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold hover:bg-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rates List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {rates.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">No rates configured. Click "Add Rate" to create one.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rates.map(rate => (
              <div key={rate.id} className="p-4 flex items-center justify-between">
                {editingId === rate.id ? (
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <input
                      type="number"
                      value={form.pesos}
                      onChange={e => setForm(f => ({ ...f, pesos: parseInt(e.target.value) || 0 }))}
                      className="p-2 border border-slate-300 rounded-lg text-xs"
                      min="1"
                    />
                    <input
                      type="number"
                      value={form.minutes}
                      onChange={e => setForm(f => ({ ...f, minutes: parseInt(e.target.value) || 0 }))}
                      className="p-2 border border-slate-300 rounded-lg text-xs"
                      min="1"
                    />
                    <input
                      type="text"
                      value={form.label}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                      placeholder="Label"
                      className="p-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                ) : (
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-blue-600">₱{rate.pesos}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-sm font-bold text-slate-700">{rate.minutes} minutes</span>
                      {rate.label && (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold uppercase">
                          {rate.label}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 ml-4">
                  {editingId === rate.id ? (
                    <>
                      <button
                        onClick={() => handleUpdateRate(rate.id)}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-[10px] font-bold hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setForm({ pesos: 10, minutes: 60, label: '' }); }}
                        className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold hover:bg-slate-300"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(rate)}
                        className="px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg text-[10px] font-bold hover:bg-blue-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteRate(rate.id)}
                        className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-[10px] font-bold hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Button */}
      {rates.length > 0 && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : '💾 Save All Rates to Server'}
        </button>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">ℹ️ About CoinSlot Rates</h4>
        <ul className="text-[10px] text-blue-800 space-y-1">
          <li>• These rates are used by the phone rental app for kiosk coin insertion</li>
          <li>• Separate from PisoWiFi internet rates</li>
          <li>• Customers can accumulate multiple payments before starting session</li>
          <li>• Session starts immediately when they click "Done Paying"</li>
        </ul>
      </div>
    </div>
  );
};

// ============================================
// DEVICE OWNER SETUP SUB-PAGE
// ============================================
const DeviceOwnerSubPage: React.FC = () => {
  const [adbInstalled, setAdbInstalled] = useState<boolean | null>(null);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceSerial, setDeviceSerial] = useState('');
  const [deviceOwnerSet, setDeviceOwnerSet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const checkAdbStatus = async () => {
    try {
      setLoading(true);
      addLog('Checking ADB installation...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/device-owner/check-adb', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      setAdbInstalled(data.installed);
      addLog(data.installed ? '✅ ADB is installed' : '❌ ADB is not installed');
    } catch (err) {
      setAdbInstalled(false);
      addLog(`❌ Error checking ADB: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const installAdb = async () => {
    try {
      setLoading(true);
      addLog('Installing ADB...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/device-owner/install-adb', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      
      if (data.success) {
        addLog('✅ ADB installed successfully');
        setAdbInstalled(true);
        checkDeviceConnection();
      } else {
        addLog(`❌ Failed to install ADB: ${data.error}`);
      }
    } catch (err) {
      addLog(`❌ Error installing ADB: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const checkDeviceConnection = async () => {
    try {
      setLoading(true);
      addLog('Checking for connected devices...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/device-owner/list-devices', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      
      if (data.devices && data.devices.length > 0) {
        setDeviceConnected(true);
        setDeviceSerial(data.devices[0]);
        addLog(`✅ Device connected: ${data.devices[0]}`);
      } else {
        setDeviceConnected(false);
        setDeviceSerial('');
        addLog('❌ No devices connected. Please connect via USB and enable USB debugging.');
      }
    } catch (err) {
      setDeviceConnected(false);
      addLog(`❌ Error checking devices: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const setDeviceOwner = async () => {
    if (!deviceConnected || !deviceSerial) {
      addLog('❌ No device connected');
      return;
    }

    try {
      setLoading(true);
      addLog('Setting Device Owner mode...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/device-owner/set-owner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ serial: deviceSerial })
      });
      const data = await response.json();
      
      if (data.success) {
        setDeviceOwnerSet(true);
        addLog('✅ Device Owner set successfully!');
        addLog('🎉 Kiosk mode is now active on the device');
      } else {
        addLog(`❌ Failed to set Device Owner: ${data.error}`);
        if (data.solution) {
          addLog(`💡 Solution: ${data.solution}`);
        }
      }
    } catch (err) {
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const removeDeviceOwner = async () => {
    if (!confirm('Are you sure you want to remove Device Owner mode? This will disable kiosk mode.')) {
      return;
    }

    try {
      setLoading(true);
      addLog('Removing Device Owner mode...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/device-owner/remove-owner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setDeviceOwnerSet(false);
        addLog('✅ Device Owner removed successfully');
      } else {
        addLog(`❌ Failed to remove Device Owner: ${data.error}`);
      }
    } catch (err) {
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAdbStatus();
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-1 uppercase tracking-tight">🔐 Device Owner Setup</h3>
        <p className="text-[10px] text-slate-500">Set this app as Device Owner to enable full kiosk mode</p>
      </div>

      {/* Steps */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        {/* Step 1: Check ADB */}
        <div className="border border-slate-100 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold text-slate-700">Step 1: ADB Installation</h4>
            {adbInstalled !== null && (
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                adbInstalled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {adbInstalled ? 'Installed' : 'Not Installed'}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mb-2">ADB (Android Debug Bridge) is required to set Device Owner mode</p>
          <div className="flex gap-2">
            <button 
              onClick={checkAdbStatus}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold hover:bg-slate-200 disabled:opacity-50"
            >
              {loading ? 'Checking...' : 'Check Status'}
            </button>
            {!adbInstalled && (
              <button 
                onClick={installAdb}
                disabled={loading}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Installing...' : 'Install ADB'}
              </button>
            )}
          </div>
        </div>

        {/* Step 2: Connect Device */}
        <div className="border border-slate-100 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold text-slate-700">Step 2: Connect Android Device</h4>
            {deviceConnected && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-green-100 text-green-700">
                Connected
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mb-2">
            1. Enable USB Debugging on device (Settings &gt; Developer Options)<br/>
            2. Connect device via USB to this machine<br/>
            3. Accept "Allow USB debugging?" prompt on device
          </p>
          <div className="flex gap-2">
            <button 
              onClick={checkDeviceConnection}
              disabled={loading || !adbInstalled}
              className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold hover:bg-slate-200 disabled:opacity-50"
            >
              {loading ? 'Checking...' : 'Check Connection'}
            </button>
            {deviceConnected && (
              <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded text-[10px] font-bold">
                ✅ {deviceSerial}
              </span>
            )}
          </div>
        </div>

        {/* Step 3: Set Device Owner */}
        <div className="border border-slate-100 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold text-slate-700">Step 3: Set Device Owner</h4>
            {deviceOwnerSet && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-purple-100 text-purple-700">
                Active
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mb-2">
            This will set the Phone Rental app as Device Owner, enabling:<br/>
            • Full kiosk mode lockdown<br/>
            • Home button blocking<br/>
            • Status bar blocking<br/>
            • App whitelisting enforcement
          </p>
          <div className="flex gap-2">
            {!deviceOwnerSet ? (
              <button 
                onClick={setDeviceOwner}
                disabled={loading || !deviceConnected}
                className="px-3 py-1.5 bg-purple-600 text-white rounded text-[10px] font-bold hover:bg-purple-700 disabled:opacity-50"
              >
                {loading ? 'Setting...' : 'Set Device Owner'}
              </button>
            ) : (
              <button 
                onClick={removeDeviceOwner}
                disabled={loading}
                className="px-3 py-1.5 bg-red-600 text-white rounded text-[10px] font-bold hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Removing...' : 'Remove Device Owner'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="bg-slate-900 rounded-xl p-4">
          <h4 className="text-[10px] font-bold text-slate-300 mb-2 uppercase">Activity Log</h4>
          <div className="bg-slate-950 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[9px] text-green-400 space-y-0.5">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">ℹ️ Important Notes</h4>
        <ul className="text-[10px] text-blue-800 space-y-1">
          <li>• Device must be factory reset or have no existing Device Owner</li>
          <li>• USB Debugging must be enabled on the Android device</li>
          <li>• Device will be in full kiosk mode after setup</li>
          <li>• To remove: Use "Remove Device Owner" button or factory reset device</li>
          <li>• App will auto-start on boot and cannot be force-closed</li>
        </ul>
      </div>
    </div>
  );
};

// ============================================
// WALLPAPER SUB-PAGE
// ============================================
const WallpaperSubPage: React.FC<{ devices: RentalDevice[] }> = ({ devices }) => {
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [currentWallpaper, setCurrentWallpaper] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedDevice) {
      setMessageType('error');
      setMessage('Please select a device first');
      return;
    }

    // Validate file size (GIF: 30MB, others: 10MB)
    const isGif = file.type === 'image/gif';
    const maxSize = isGif ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
    const sizeLimit = isGif ? '30MB' : '10MB';
    
    if (file.size > maxSize) {
      setMessageType('error');
      setMessage(`File too large. Maximum size for ${isGif ? 'GIF' : 'this format'}: ${sizeLimit}`);
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
    if (!allowedTypes.includes(file.type)) {
      setMessageType('error');
      setMessage('Invalid file type. Supported: JPG, PNG, WEBP, GIF, BMP, TIFF');
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('wallpaper', file);

      const response = await fetch(`/api/phone-rental/devices/${selectedDevice}/wallpaper`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      setMessageType('success');
      setMessage('Wallpaper uploaded successfully!');
      setCurrentWallpaper(result.wallpaper_url);

      // Clear file input
      if (e.target) {
        e.target.value = '';
      }
    } catch (err) {
      setMessageType('error');
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteWallpaper = async () => {
    if (!selectedDevice) return;

    setUploading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/phone-rental/devices/${selectedDevice}/wallpaper`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Delete failed');
      }

      setMessageType('success');
      setMessage('Wallpaper deleted successfully!');
      setCurrentWallpaper(null);
    } catch (err) {
      setMessageType('error');
      setMessage(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setUploading(false);
    }
  };

  // Load current wallpaper when device is selected
  useEffect(() => {
    if (!selectedDevice) {
      setCurrentWallpaper(null);
      return;
    }

    const device = devices.find(d => d.id === Number(selectedDevice));
    if (device && device.wallpaper_path) {
      setCurrentWallpaper(device.wallpaper_path);
    } else {
      setCurrentWallpaper(null);
    }
  }, [selectedDevice, devices]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl p-4">
        <h3 className="text-sm font-black text-purple-800 mb-1">🖼️ Device Wallpaper Manager</h3>
        <p className="text-[10px] text-purple-600">Upload custom full-screen wallpapers for each rental device</p>
      </div>

      {/* Device Selection */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-700 mb-2 block">
          Select Device
        </label>
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">-- Choose a device --</option>
          {devices.map(device => (
            <option key={device.id} value={device.id}>
              {device.device_name} (ID: {device.id} | MAC: {device.mac_address})
            </option>
          ))}
        </select>
      </div>

      {/* Upload Section */}
      {selectedDevice && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-700 mb-3">
            Upload Wallpaper
          </h4>

          {/* Current Wallpaper Preview */}
          {currentWallpaper && (
            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-600 mb-2 block">Current Wallpaper:</label>
              <div className="relative rounded-lg overflow-hidden border-2 border-slate-200" style={{ maxHeight: '300px' }}>
                <img
                  src={currentWallpaper.startsWith('/') ? currentWallpaper : `/uploads/wallpapers/${currentWallpaper}`}
                  alt="Current wallpaper"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </div>
          )}

          {/* Upload Input */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-slate-600 block">Upload New Wallpaper:</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={uploading}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-[10px] file:font-black file:uppercase file:tracking-widest file:bg-purple-500 file:text-white hover:file:bg-purple-600 disabled:opacity-50"
              />
              {currentWallpaper && (
                <button
                  onClick={handleDeleteWallpaper}
                  disabled={uploading}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-600 disabled:opacity-50"
                >
                  🗑️ Delete
                </button>
              )}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-[10px] text-blue-800">
                <strong>Supported formats:</strong> JPG, PNG, WEBP, GIF, BMP, TIFF
              </p>
              <p className="text-[10px] text-blue-800 mt-1">
                <strong>Max file size:</strong> 30MB for GIF, 10MB for other formats
              </p>
              <p className="text-[10px] text-blue-800 mt-1">
                <strong>Recommended size:</strong> 1080x1920 (portrait) or match device screen size
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`border rounded-lg p-3 ${
          messageType === 'success' 
            ? 'bg-green-50 border-green-200 text-green-700' 
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <p className="text-[10px] font-bold">
            {messageType === 'success' ? '✅' : '❌'} {message}
          </p>
        </div>
      )}

      {/* Info */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-2">ℹ️ How It Works</h4>
        <ul className="text-[10px] text-purple-800 space-y-1">
          <li>• Select a device from the dropdown</li>
          <li>• Upload an image (JPG, PNG, WEBP, etc.)</li>
          <li>• Wallpaper will be displayed as full-screen background on the device</li>
          <li>• UI elements (timer, buttons) will appear on top of the wallpaper</li>
          <li>• Each device can have its own custom wallpaper</li>
          <li>• Wallpaper downloads automatically when the rental app starts</li>
        </ul>
      </div>
    </div>
  );
};

export default PhoneRental;
