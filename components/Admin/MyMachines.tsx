import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { VendorMachine } from '../../types';

interface LicenseStatus {
  hardwareId: string;
  isLicensed: boolean;
  isRevoked?: boolean;
  licenseKey?: string;
  trial: {
    isActive: boolean;
    hasEnded: boolean;
    daysRemaining: number;
    expiresAt: string | null;
  };
  canOperate: boolean;
}

export const MyMachines: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [machineStatus, setMachineStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);

  const fetchStatus = async () => {
    try {
      // Don't set loading to true on background refreshes to avoid flicker
      if (!machineStatus) setLoading(true);
      const status = await apiClient.getMachineStatus();
      setMachineStatus(status);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching machine status:', err);
      // Only set error if we don't have data yet
      if (!machineStatus) setError(err.message || 'Failed to fetch machine status');
    } finally {
      setLoading(false);
    }
  };

  const fetchLicenseStatus = async () => {
    try {
      const res = await fetch('/api/license/status');
      const data = await res.json();
      setLicenseStatus(data);
    } catch (e) {
      console.error('Failed to fetch license status', e);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchLicenseStatus();
    const interval = setInterval(fetchStatus, 30000); // Poll every 30s
    const licenseInterval = setInterval(fetchLicenseStatus, 30000);
    return () => {
      clearInterval(interval);
      clearInterval(licenseInterval);
    };
  }, []);

  if (loading && !machineStatus) {
    return (
      <div className="max-w-7xl mx-auto p-4 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Initializing Machine Link...</p>
        </div>
      </div>
    );
  }

  if (error && !machineStatus) {
    return (
      <div className="max-w-7xl mx-auto p-4 flex items-center justify-center min-h-[400px]">
        <div className="text-center bg-white p-6 rounded-xl border border-red-100 shadow-sm max-w-sm">
          <div className="text-2xl mb-2">⚠️</div>
          <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-4">{error}</p>
          <button
            onClick={fetchStatus}
            className="admin-btn-primary w-full py-2 rounded-lg text-[10px] font-black uppercase tracking-widest"
          >
            Retry Link
          </button>
        </div>
      </div>
    );
  }

  const { hardwareId, vendorId, metrics } = machineStatus || {};
  const isPending = !vendorId;

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-500">
      
      {/* Current Machine Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg text-white ${isPending ? 'bg-amber-500' : 'bg-emerald-500'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest leading-none">Local Machine Identity</h3>
              <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter mt-1">Hardware Bus v2.1</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${
              isPending ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'
            }`}>
              {isPending ? 'Activation Required' : 'Verified System'}
            </div>
            {!isPending && (
              <div className="text-[8px] font-black text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded uppercase">
                Vendor: <span className="font-mono text-slate-900">{vendorId}</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-slate-900 rounded-lg p-3 text-white border border-white/5">
            <div className="flex-1">
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Hardware ID (System UUID)</div>
              <div className="text-sm font-black tracking-widest font-mono text-blue-400 break-all">
                {hardwareId}
              </div>
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(hardwareId);
                alert('Hardware ID copied to clipboard');
              }}
              className="px-3 py-1.5 rounded bg-white/10 text-[9px] font-black uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-2 shrink-0"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy ID
            </button>
          </div>

          {isPending && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 flex gap-3">
              <div className="text-amber-500 shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h4 className="text-[9px] font-black text-amber-900 uppercase tracking-tight">Activation Pending</h4>
                <p className="text-[8px] text-amber-800/70 font-bold uppercase tracking-tighter leading-normal mt-0.5">
                  Link this Hardware ID to your vendor account in the cloud dashboard to enable remote monitoring and management.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { 
                label: 'CPU Temperature', 
                value: metrics?.cpuTemp ? `${metrics.cpuTemp.toFixed(1)}°C` : 'N/A', 
                color: 'blue', 
                icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
              },
              { 
                label: 'System Uptime', 
                value: metrics?.uptime ? formatUptime(metrics.uptime) : 'N/A', 
                color: 'emerald', 
                icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
              },
              { 
                label: 'Active Sessions', 
                value: metrics?.activeSessions ?? 0, 
                color: 'indigo', 
                icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z'
              }
            ].map((stat) => (
              <div key={stat.label} className={`bg-${stat.color}-50 border border-${stat.color}-100 rounded-lg p-3 flex flex-col justify-between h-20`}>
                <div className={`text-${stat.color}-600 text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5`}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={stat.icon} />
                  </svg>
                  {stat.label}
                </div>
                <div className="text-xl font-black text-slate-900 tracking-tighter">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* License Status Card */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-blue-50/30 flex justify-between items-center">
          <div>
            <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest">License & Trial Status</h3>
          </div>
          {licenseStatus && (
            <div className="flex gap-2">
              {licenseStatus.isRevoked ? (
                <span className="bg-red-600 text-white text-[8px] font-black px-2 py-1 rounded font-bold uppercase animate-pulse">Revoked</span>
              ) : licenseStatus.isLicensed ? (
                <span className="bg-green-100 text-green-600 text-[8px] font-black px-2 py-1 rounded font-bold uppercase">Licensed</span>
              ) : licenseStatus.trial.isActive ? (
                <span className="bg-yellow-100 text-yellow-600 text-[8px] font-black px-2 py-1 rounded font-bold uppercase">
                  Trial: {licenseStatus.trial.daysRemaining}d
                </span>
              ) : (
                <span className="bg-red-100 text-red-600 text-[8px] font-black px-2 py-1 rounded font-bold uppercase">Expired</span>
              )}
            </div>
          )}
        </div>
        <div className="p-4">
          <LicenseActivation licenseStatus={licenseStatus} onActivated={() => {
            fetch('/api/license/status')
              .then(res => res.json())
              .then(data => setLicenseStatus(data))
              .catch(e => console.error('Failed to refresh license status', e));
          }} />
        </div>
      </section>
    </div>
  );
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const LicenseActivation: React.FC<{ licenseStatus: LicenseStatus | null; onActivated: () => void }> = ({ licenseStatus, onActivated }) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey.trim() })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setMessage('✅ ' + data.message);
        setLicenseKey('');
        onActivated();
        
        // Show success alert
        setTimeout(() => {
          alert('License activated successfully! Please restart the system for changes to take effect.');
        }, 500);
      } else {
        setMessage('❌ ' + data.error);
      }
    } catch (err: any) {
      setMessage('❌ Activation failed: ' + (err.message || 'Network error'));
    } finally {
      setLoading(false);
    }
  };

  if (!licenseStatus) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-4 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-[10px] text-slate-500 font-bold uppercase">Loading License Status...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hardware ID Display */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Hardware ID</label>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono font-bold text-slate-800">
            {licenseStatus.hardwareId}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(licenseStatus.hardwareId);
              alert('Hardware ID copied to clipboard!');
            }}
            className="bg-slate-600 text-white px-4 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-700 active:scale-95 transition-all"
          >
            Copy
          </button>
        </div>
        <p className="text-[9px] text-slate-500 font-bold uppercase mt-2">
          Provide this ID to your vendor when requesting a license key
        </p>
      </div>

      {/* Status Information */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">License Status</p>
          <p className={`text-sm font-black uppercase ${licenseStatus.isLicensed ? 'text-green-600' : 'text-slate-500'}`}>
            {licenseStatus.isLicensed ? '✓ ACTIVE' : 'Not Activated'}
          </p>
        </div>
        
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Trial Status</p>
          <p className={`text-sm font-black uppercase ${licenseStatus.trial.isActive ? 'text-yellow-600' : licenseStatus.trial.hasEnded ? 'text-red-600' : 'text-slate-500'}`}>
            {licenseStatus.trial.isActive ? `${licenseStatus.trial.daysRemaining} Days Left` : licenseStatus.trial.hasEnded ? 'Expired' : 'N/A'}
          </p>
        </div>
        
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Can Operate</p>
          <p className={`text-sm font-black uppercase ${licenseStatus.canOperate ? 'text-green-600' : 'text-red-600'}`}>
            {licenseStatus.canOperate ? '✓ YES' : '✗ NO'}
          </p>
        </div>
      </div>

      {/* Activation Form - Only show if not licensed */}
      {!licenseStatus.isLicensed && (
        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
              Enter License Key
            </label>
            <input 
              type="text" 
              value={licenseKey}
              onChange={e => setLicenseKey(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs uppercase"
              placeholder="AJC-XXXX-YYYY-ZZZZ"
              required
            />
          </div>
          
          {message && (
            <div className={`p-4 rounded-xl border text-xs font-bold ${
              message.startsWith('✅') 
                ? 'bg-green-50 border-green-200 text-green-700' 
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {message}
            </div>
          )}
          
          <button 
            type="submit" 
            disabled={loading || !licenseKey.trim()}
            className="w-full bg-blue-600 text-white px-6 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Activating...' : 'Activate License'}
          </button>
          
          <p className="text-[9px] text-slate-500 font-bold uppercase text-center leading-relaxed">
            Don't have a license key? Contact your vendor or check the SUPABASE_SETUP.md file for instructions.
          </p>
        </form>
      )}

      {/* Licensed Message */}
      {licenseStatus.isLicensed && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
          <p className="text-sm font-black text-green-900 uppercase tracking-tight mb-2">
            License Activated
          </p>
          {licenseStatus.licenseKey && (
            <div className="mb-4">
              <p className="text-[9px] text-green-700 font-bold uppercase mb-1">Active License Key</p>
              <code className="bg-white/50 border border-green-200 text-green-800 px-4 py-2 rounded-xl text-xs font-mono font-bold inline-block">
                {licenseStatus.licenseKey}
              </code>
            </div>
          )}
          <p className="text-[10px] text-green-700 font-bold uppercase">
            Your device is fully licensed and operational. Thank you for your support!
          </p>
        </div>
      )}
    </div>
  );
};
