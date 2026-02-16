import React, { useState, useEffect } from 'react';
import { WifiDevice, Rate, BandwidthSettings } from '../../types';
import { apiClient } from '../../lib/api';
import GamingPriority from './GamingPriority';

interface Props {
  devices: WifiDevice[];
  rates: Rate[];
}

const BandwidthManager: React.FC<Props> = ({ devices, rates }) => {
  const [defaultDownloadLimit, setDefaultDownloadLimit] = useState<number>(5);
  const [defaultUploadLimit, setDefaultUploadLimit] = useState<number>(5);
  const [autoApplyToNew, setAutoApplyToNew] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [qosDiscipline, setQoSDiscipline] = useState<'cake' | 'fq_codel'>('cake');
  const [savingQoS, setSavingQoS] = useState(false);

  // Load current default settings
  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const settings = await apiClient.getBandwidthSettings();
        setDefaultDownloadLimit(settings.defaultDownloadLimit);
        setDefaultUploadLimit(settings.defaultUploadLimit);
        setAutoApplyToNew(settings.autoApplyToNew);
      } catch (err) {
        console.error('Error loading bandwidth settings:', err);
        setError('Failed to load bandwidth settings');
      }
    };

    loadDefaults();
  }, []);

  useEffect(() => {
    apiClient.getQoSConfig().then(config => setQoSDiscipline(config.discipline));
  }, []);

  const saveQoS = async (discipline: 'cake' | 'fq_codel') => {
    setSavingQoS(true);
    try {
      await apiClient.saveQoSConfig(discipline);
      setQoSDiscipline(discipline);
    } finally {
      setSavingQoS(false);
    }
  };

  const handleSaveDefaults = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      await apiClient.saveBandwidthSettings({
        defaultDownloadLimit,
        defaultUploadLimit,
        autoApplyToNew
      });
      
      setMessage('Default bandwidth settings saved successfully!');
      
      // Apply to all existing devices if requested
      if (autoApplyToNew) {
        await applyToAllDevices();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save bandwidth settings');
    } finally {
      setLoading(false);
    }
  };

  const applyToAllDevices = async () => {
    setLoading(true);
    try {
      // Update all devices with the default limits
      for (const device of devices) {
        await apiClient.updateWifiDevice(device.id, {
          downloadLimit: defaultDownloadLimit,
          uploadLimit: defaultUploadLimit
        });
      }
      
      setMessage('Bandwidth limits applied to all devices successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to apply limits to devices');
    } finally {
      setLoading(false);
    }
  };

  const applyToDevice = async (deviceId: string, downloadLimit: number, uploadLimit: number) => {
    setLoading(true);
    try {
      await apiClient.updateWifiDevice(deviceId, {
        downloadLimit,
        uploadLimit
      });
      
      setMessage('Device bandwidth updated successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to update device bandwidth');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Page Header */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1">Bandwidth Management</h3>
        <p className="text-[10px] text-slate-500 font-medium">
          Configure default limits for hotspot devices.
        </p>
      </div>

      {/* Global QoS Settings */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-4">Global Traffic Control</h3>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1 w-full">
            <p className="text-[10px] text-slate-500 mb-3 font-medium">
              Select Queue Discipline. <span className="font-bold text-slate-700">Cake</span> is recommended.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => saveQoS('cake')}
                disabled={savingQoS}
                className={`flex-1 py-2 px-3 rounded-lg border font-bold text-[10px] uppercase tracking-wider transition-all ${
                  qosDiscipline === 'cake' 
                    ? 'border-blue-600 bg-blue-50 text-blue-700' 
                    : 'border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                Cake QoS
              </button>
              <button
                onClick={() => saveQoS('fq_codel')}
                disabled={savingQoS}
                className={`flex-1 py-2 px-3 rounded-lg border font-bold text-[10px] uppercase tracking-wider transition-all ${
                  qosDiscipline === 'fq_codel' 
                    ? 'border-blue-600 bg-blue-50 text-blue-700' 
                    : 'border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                Fq_Codel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Gaming Priority */}
      <GamingPriority />

      {/* Default Settings */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-4">Default Bandwidth Settings</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Default Download (Mbps)</label>
            <input 
              type="number" 
              value={defaultDownloadLimit}
              onChange={(e) => setDefaultDownloadLimit(Number(e.target.value))}
              min="0"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-1 focus:ring-blue-500 outline-none transition-all font-bold text-sm"
              placeholder="0 for unlimited"
            />
          </div>
          
          <div>
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Default Upload (Mbps)</label>
            <input 
              type="number" 
              value={defaultUploadLimit}
              onChange={(e) => setDefaultUploadLimit(Number(e.target.value))}
              min="0"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-1 focus:ring-blue-500 outline-none transition-all font-bold text-sm"
              placeholder="0 for unlimited"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={autoApplyToNew}
              onChange={(e) => setAutoApplyToNew(e.target.checked)}
              className="sr-only"
            />
            <div className={`relative w-8 h-4.5 flex items-center rounded-full p-0.5 transition-colors ${autoApplyToNew ? 'bg-blue-600' : 'bg-slate-300'}`}>
              <div className={`bg-white w-3.5 h-3.5 rounded-full shadow transform transition-transform ${autoApplyToNew ? 'translate-x-3.5' : ''}`}></div>
            </div>
            <span className="ml-2 text-[10px] font-bold text-slate-700 uppercase">Auto-apply to new devices</span>
          </label>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={handleSaveDefaults}
            disabled={loading}
            className="bg-blue-600 text-white py-2 px-4 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md shadow-blue-500/10 disabled:opacity-50"
          >
            {loading ? 'SAVING...' : 'SAVE DEFAULTS'}
          </button>
          
          <button 
            onClick={applyToAllDevices}
            disabled={loading}
            className="admin-btn-primary py-2 px-4 rounded-lg font-black text-[10px] uppercase tracking-widest shadow-md shadow-slate-800/10 disabled:opacity-50"
          >
            {loading ? 'APPLYING...' : 'APPLY TO ALL'}
          </button>
        </div>
      </div>

      {/* Active Sessions Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Active Device Bandwidth</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] text-slate-400 uppercase font-black tracking-widest border-b border-slate-100">
              <tr>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Network Info</th>
                <th className="px-4 py-3">Limits (DL/UL)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices && devices.length > 0 ? (
                devices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-4 py-2">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center mr-2 text-sm">📱</div>
                        <div>
                          <div className="text-[11px] font-black text-slate-900">{device.customName || device.hostname}</div>
                          <div className="text-[9px] text-slate-500 uppercase">{device.interface}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-[10px] font-mono text-slate-600 font-bold">{device.mac}</div>
                      <div className="text-[9px] font-mono text-slate-400 uppercase tracking-tighter">{device.ip}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <div className="text-[10px]">
                          <div className="font-bold text-slate-900">{device.downloadLimit ? `${device.downloadLimit}M` : '∞'}</div>
                          <div className="text-[8px] text-slate-500 uppercase">DL</div>
                        </div>
                        <div className="text-[10px]">
                          <div className="font-bold text-slate-900">{device.uploadLimit ? `${device.uploadLimit}M` : '∞'}</div>
                          <div className="text-[8px] text-slate-500 uppercase">UL</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button 
                          onClick={() => applyToDevice(device.id, defaultDownloadLimit, defaultUploadLimit)}
                          disabled={loading}
                          className="text-[9px] bg-blue-50 text-blue-700 px-2 py-1 rounded font-black uppercase tracking-wider hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                          Default
                        </button>
                        <button 
                          onClick={() => applyToDevice(device.id, 0, 0)}
                          disabled={loading}
                          className="text-[9px] bg-slate-50 text-slate-700 px-2 py-1 rounded font-black uppercase tracking-wider hover:bg-slate-100 transition-colors disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-[10px] font-black uppercase">
                    No active devices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Section */}
      <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
        <h4 className="font-black text-blue-900 text-[10px] uppercase tracking-widest mb-1">Bandwidth Policy</h4>
        <ul className="text-[10px] text-blue-800 space-y-0.5 font-medium">
          <li>• Default limits apply to all new hotspot connections</li>
          <li>• Individual device limits override default settings</li>
          <li>• Traffic shaping enforced via Linux TC (HTB)</li>
        </ul>
      </div>
    </div>
  );
};

export default BandwidthManager;
