import React, { useState, useEffect } from 'react';
import { RentalDevice } from '../../types';

interface ApkInstallerSubPageProps {
  onRefresh: () => void;
}

const ApkInstallerSubPage: React.FC<ApkInstallerSubPageProps> = ({ onRefresh }) => {
  const [adbInstalled, setAdbInstalled] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Array<{serial: string, status: string}>>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [latestApk, setLatestApk] = useState<any>(null);
  const [installing, setInstalling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState<string>('');

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const checkAdbStatus = async () => {
    try {
      setLoading(true);
      addLog('Checking ADB installation...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/apk-installer/check-adb', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      setAdbInstalled(data.installed);
      addLog(data.installed ? `✅ ADB found at: ${data.path}` : '❌ ADB is not installed');
    } catch (err) {
      setAdbInstalled(false);
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshDevices = async () => {
    try {
      setLoading(true);
      addLog('Scanning for connected devices...');
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/apk-installer/devices', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      
      if (data.devices && data.devices.length > 0) {
        setDevices(data.devices);
        setSelectedDevice(data.devices[0].serial);
        addLog(`✅ Found ${data.devices.length} device(s)`);
        data.devices.forEach((d: any) => addLog(`  📱 ${d.serial} (${d.status})`));
      } else {
        setDevices([]);
        setSelectedDevice('');
        addLog('⚠️ No devices connected');
        addLog('💡 Connect device via USB and enable USB Debugging');
      }
    } catch (err) {
      setDevices([]);
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const checkLatestApk = async () => {
    try {
      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/apk-installer/latest-apk', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await response.json();
      
      if (data.found) {
        setLatestApk(data);
        addLog(`📦 Latest APK: ${data.filename}`);
        addLog(`   Size: ${(data.size / 1024 / 1024).toFixed(2)} MB`);
        addLog(`   Modified: ${data.modified}`);
      } else {
        addLog('❌ No APK files found');
      }
    } catch (err) {
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };

  const installApk = async () => {
    if (!selectedDevice) {
      addLog('❌ No device selected');
      return;
    }

    if (!latestApk) {
      addLog('❌ No APK found');
      return;
    }

    try {
      setInstalling(true);
      setInstallProgress('Starting installation...');
      addLog(`📲 Installing APK on ${selectedDevice}...`);

      const token = localStorage.getItem('admin_token') || '';
      const response = await fetch('/api/phone-rental/apk-installer/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ serial: selectedDevice })
      });

      const data = await response.json();

      if (data.success) {
        setInstallProgress('✅ Installation successful!');
        addLog('✅ APK installed successfully!');
        addLog('🎉 App is ready to use');
      } else {
        setInstallProgress('❌ Installation failed');
        addLog(`❌ Failed: ${data.error}`);
        if (data.output) {
          addLog(`Output: ${data.output.substring(0, 200)}`);
        }
      }
    } catch (err) {
      setInstallProgress('❌ Installation error');
      addLog(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    checkAdbStatus();
    checkLatestApk();
    refreshDevices();
    
    // Auto-refresh devices every 5 seconds
    const interval = setInterval(refreshDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-1 uppercase tracking-tight">📱 APK Installer</h3>
        <p className="text-[10px] text-slate-500">Install latest app on connected Android devices via ADB</p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ADB Status */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-600 uppercase">ADB Status</span>
            {adbInstalled ? (
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold">INSTALLED</span>
            ) : (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[9px] font-bold">NOT FOUND</span>
            )}
          </div>
          <p className="text-[9px] text-slate-500">Android Debug Bridge</p>
        </div>

        {/* Connected Devices */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-600 uppercase">Devices</span>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-bold">{devices.length}</span>
          </div>
          <p className="text-[9px] text-slate-500">Connected via USB</p>
        </div>

        {/* Latest APK */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-600 uppercase">Latest APK</span>
            {latestApk && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px] font-bold">READY</span>
            )}
          </div>
          <p className="text-[9px] text-slate-500 truncate">{latestApk?.filename || 'Not found'}</p>
        </div>
      </div>

      {/* Device Selection */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h4 className="text-[10px] font-bold text-slate-700 mb-3 uppercase">Select Device</h4>
        
        {devices.length > 0 ? (
          <div className="space-y-2">
            {devices.map(device => (
              <label
                key={device.serial}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedDevice === device.serial
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="device"
                  value={device.serial}
                  checked={selectedDevice === device.serial}
                  onChange={() => setSelectedDevice(device.serial)}
                  className="w-4 h-4 text-blue-600"
                />
                <div className="flex-1">
                  <div className="text-[10px] font-bold text-slate-700">{device.serial}</div>
                  <div className="text-[9px] text-slate-500">{device.status}</div>
                </div>
                {selectedDevice === device.serial && (
                  <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-[9px] font-bold">SELECTED</span>
                )}
              </label>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📱</div>
            <p className="text-[10px] text-slate-500">No devices connected</p>
            <p className="text-[9px] text-slate-400 mt-1">Connect device via USB and enable USB Debugging</p>
          </div>
        )}

        <button
          onClick={refreshDevices}
          disabled={loading}
          className="mt-3 px-3 py-1.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold hover:bg-slate-200 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : '🔄 Refresh Devices'}
        </button>
      </div>

      {/* APK Info */}
      {latestApk && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h4 className="text-[10px] font-bold text-slate-700 mb-3 uppercase">APK Details</h4>
          <div className="space-y-2 text-[10px]">
            <div className="flex justify-between">
              <span className="text-slate-500">Filename:</span>
              <span className="font-mono text-slate-700">{latestApk.filename}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Size:</span>
              <span className="text-slate-700">{(latestApk.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Modified:</span>
              <span className="text-slate-700">{latestApk.modified}</span>
            </div>
          </div>
        </div>
      )}

      {/* Install Button */}
      {selectedDevice && latestApk && (
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-4 text-white">
          <h4 className="text-[10px] font-bold mb-2 uppercase">Ready to Install</h4>
          <p className="text-[9px] opacity-90 mb-3">
            Installing <strong>{latestApk.filename}</strong> on <strong>{selectedDevice}</strong>
          </p>
          
          {installProgress && (
            <div className="bg-white/20 rounded-lg p-2 mb-3">
              <p className="text-[10px] font-bold">{installProgress}</p>
            </div>
          )}

          <button
            onClick={installApk}
            disabled={installing}
            className="w-full px-4 py-3 bg-white text-blue-600 rounded-lg text-[11px] font-bold hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {installing ? '⏳ Installing...' : '📲 Install APK Now'}
          </button>
        </div>
      )}

      {/* Activity Logs */}
      {logs.length > 0 && (
        <div className="bg-slate-900 rounded-xl p-4">
          <h4 className="text-[10px] font-bold text-slate-300 mb-2 uppercase">Activity Log</h4>
          <div className="bg-slate-950 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-[9px] text-green-400 space-y-0.5">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">📋 How to Use</h4>
        <ol className="text-[10px] text-blue-800 space-y-1 list-decimal list-inside">
          <li>Connect Android device via USB cable</li>
          <li>Enable USB Debugging on device (Settings → Developer Options)</li>
          <li>Accept "Allow USB debugging?" prompt on device</li>
          <li>Click "Refresh Devices" to detect your device</li>
          <li>Select the device from the list</li>
          <li>Click "Install APK Now" to install the latest app</li>
        </ol>
      </div>
    </div>
  );
};

export default ApkInstallerSubPage;
