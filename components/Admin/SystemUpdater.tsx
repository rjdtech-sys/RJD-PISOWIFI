import React, { useState, useRef, useEffect } from 'react';

interface UpdateInfo {
  version_code: number;
  version_name: string;
  filename: string;
  release_notes: string;
  published_at: string;
  bucket: string;
  public_url?: string;
}

interface CurrentVersion {
  version_code: number;
  version_name: string;
}

const readResponseBody = async (res: Response) => {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }

  const text = await res.text();
  return {
    error: text
      ? text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : `Request failed with status ${res.status}`
  };
};

const getAdminToken = () => {
  return localStorage.getItem('rjd_admin_token')
    || localStorage.getItem('ajc_admin_token')
    || localStorage.getItem('admin_token');
};

const SystemUpdater: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState<CurrentVersion | null>(null);
  const [isLoadingVersion, setIsLoadingVersion] = useState(true);

  const [isScanningUpdate, setIsScanningUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [scanMessage, setScanMessage] = useState('');

  const [isInstalling, setIsInstalling] = useState(false);

  const [isBackupLoading, setIsBackupLoading] = useState(false);
  const [isRestoreLoading, setIsRestoreLoading] = useState(false);
  const [isUpdateLoading, setIsUpdateLoading] = useState(false);

  const restoreFileRef = useRef<HTMLInputElement>(null);
  const updateFileRef = useRef<HTMLInputElement>(null);

  // Fetch current version on mount (1-time scan)
  useEffect(() => {
    fetchCurrentVersion();
  }, []);

  const fetchCurrentVersion = async () => {
    setIsLoadingVersion(true);
    try {
      const token = getAdminToken();
      const headers: HeadersInit = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/current-version', { headers });
      const data = await readResponseBody(res);

      if (res.ok) {
        setCurrentVersion({ version_code: data.version_code, version_name: data.version_name });
      }
    } catch {
      // Silent fail - version unknown
    } finally {
      setIsLoadingVersion(false);
    }
  };

  const handleScanUpdate = async () => {
    setIsScanningUpdate(true);
    setScanMessage('');
    setUpdateInfo(null);
    setHasUpdate(false);

    try {
      const token = getAdminToken();
      const headers: HeadersInit = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/check-update', { headers });
      const data = await readResponseBody(res);

      if (res.ok) {
        setHasUpdate(data.has_update);
        if (data.update) {
          setUpdateInfo(data.update);
        }
        if (data.message) {
          setScanMessage(data.message);
        }
        if (!data.has_update && !data.message) {
          setScanMessage('System is already up to date.');
        }
      } else {
        setScanMessage(data.error || 'Failed to check for updates.');
      }
    } catch (error: any) {
      setScanMessage(error.message || 'Network error while checking for updates.');
    } finally {
      setIsScanningUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo || !updateInfo.filename) {
      alert('No update file specified.');
      return;
    }

    if (!confirm(`Install update v${updateInfo.version_name}? The system will restart automatically.`)) return;

    setIsInstalling(true);
    try {
      const token = getAdminToken();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/download-and-update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filename: updateInfo.filename,
          bucket: updateInfo.bucket,
          public_url: (updateInfo as any).public_url
        })
      });

      const data = await readResponseBody(res);

      if (res.ok) {
        alert('Update installed successfully. The system will restart automatically.');
        window.location.reload();
      } else {
        throw new Error(data.error || 'Update failed');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleBackup = async () => {
    setIsBackupLoading(true);
    try {
      const token = getAdminToken();
      const headers: HeadersInit = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/backup', { headers });
      if (!res.ok) throw new Error('Backup failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = 'backup.nxs';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=(.+)/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert('Backup failed');
    } finally {
      setIsBackupLoading(false);
    }
  };

  const handleRestore = async () => {
    const file = restoreFileRef.current?.files?.[0];
    if (!file) {
      alert('Please select a .nxs backup file first');
      return;
    }
    if (!confirm('WARNING: This will overwrite the entire system database and configuration. Are you sure?')) return;

    setIsRestoreLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getAdminToken();
      const headers: HeadersInit = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/restore', {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await readResponseBody(res);
      if (res.ok) {
        alert('System restore initiated. The system will restart automatically.');
        window.location.reload();
      } else {
        throw new Error(data.error || 'Restore failed');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsRestoreLoading(false);
    }
  };

  const handleManualUpdate = async () => {
    const file = updateFileRef.current?.files?.[0];
    if (!file) {
      alert('Please select a .nxs update file first');
      return;
    }

    setIsUpdateLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getAdminToken();
      const headers: HeadersInit = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/update', {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await readResponseBody(res);
      if (res.ok) {
        alert('System update initiated. The system will restart automatically.');
        window.location.reload();
      } else {
        throw new Error(data.error || 'Update failed');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdateLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-500">

      {/* Current Version */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 rounded-xl text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-indigo-200 text-xs font-bold uppercase tracking-wider">Current System Version</p>
            <h2 className="text-3xl font-black mt-1">
              {isLoadingVersion ? '...' : currentVersion ? `v${currentVersion.version_name}` : 'Unknown'}
            </h2>
            {currentVersion && (
              <p className="text-indigo-200 text-sm mt-1">Version Code: {currentVersion.version_code}</p>
            )}
          </div>
          <div className="p-3 bg-white/20 rounded-xl">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Cloud Update Section */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Cloud Update</h3>
            <p className="text-sm text-slate-500">Scan for the latest system update from the cloud server.</p>
          </div>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleScanUpdate}
            disabled={isScanningUpdate}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold text-sm uppercase tracking-wide hover:bg-indigo-700 transition-all shadow-md disabled:opacity-50"
          >
            {isScanningUpdate ? 'Scanning for Updates...' : 'Scan Update'}
          </button>

          {/* Scan Result - Update Available */}
          {hasUpdate && updateInfo && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg mt-0.5">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-lg font-bold text-emerald-800">
                    Update Available: v{updateInfo.version_name}
                  </h4>
                  <p className="text-sm text-emerald-600 mt-1">
                    Version Code: {updateInfo.version_code} {updateInfo.published_at && `• Released: ${new Date(updateInfo.published_at).toLocaleDateString()}`}
                  </p>

                  {updateInfo.release_notes && (
                    <div className="mt-3 bg-white rounded-lg p-3 border border-emerald-200">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Release Notes</p>
                      <p className="text-sm text-slate-700 whitespace-pre-line">{updateInfo.release_notes}</p>
                    </div>
                  )}

                  <button
                    onClick={handleInstallUpdate}
                    disabled={isInstalling}
                    className="mt-4 bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold text-sm uppercase tracking-wide hover:bg-emerald-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {isInstalling ? 'Installing Update...' : `Install v${updateInfo.version_name}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Scan Result - No Update */}
          {!hasUpdate && scanMessage && (
            <div className="border border-slate-200 bg-slate-50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-slate-600">{scanMessage}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backup Section */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">System Backup</h3>
            <p className="text-sm text-slate-500">Download a full system backup (.nxs file) including database and configuration.</p>
          </div>
        </div>

        <button
          onClick={handleBackup}
          disabled={isBackupLoading}
          className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold text-sm uppercase tracking-wide hover:bg-emerald-700 transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
        >
          {isBackupLoading ? 'Creating Backup...' : 'Download Backup (.nxs)'}
        </button>
      </div>

      {/* Restore Section */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">System Restore</h3>
            <p className="text-sm text-slate-500">Restore the system from a previous backup (.nxs file). This will overwrite the database.</p>
          </div>
        </div>

        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select Backup File (.nxs)</label>
            <input
              type="file"
              ref={restoreFileRef}
              accept=".nxs"
              className="block w-full text-sm text-slate-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-xs file:font-semibold
              file:bg-amber-50 file:text-amber-700
              hover:file:bg-amber-100
              cursor-pointer"
            />
          </div>
          <button
            onClick={handleRestore}
            disabled={isRestoreLoading}
            className="bg-amber-600 text-white px-6 py-2 rounded-lg font-bold text-sm uppercase tracking-wide hover:bg-amber-700 transition-all shadow-md disabled:opacity-50"
          >
            {isRestoreLoading ? 'Restoring...' : 'Restore System'}
          </button>
        </div>
      </div>

      {/* Manual Update Section */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Manual Update</h3>
            <p className="text-sm text-slate-500">Update the system using a local .nxs update package. Database will be preserved.</p>
          </div>
        </div>

        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select Update Package (.nxs)</label>
            <input
              type="file"
              ref={updateFileRef}
              accept=".nxs"
              className="block w-full text-sm text-slate-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-xs file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
              cursor-pointer"
            />
          </div>
          <button
            onClick={handleManualUpdate}
            disabled={isUpdateLoading}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold text-sm uppercase tracking-wide hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
          >
            {isUpdateLoading ? 'Updating...' : 'Update System'}
          </button>
        </div>
      </div>

    </div>
  );
};

export default SystemUpdater;
