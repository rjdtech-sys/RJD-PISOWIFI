import React, { useState, useEffect, useCallback } from 'react';

export type ToolsSubPage = 'speedtest' | 'dhcp_leases' | 'terminal';

interface TerminalInfo {
  hostname: string;
  username: string;
  cwd: string;
  shell: string;
}

interface TerminalOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

interface SpeedTestResult {
  success: boolean;
  ping: number | null;
  jitter: number | null;
  download: number | null;   // bytes/sec
  upload: number | null;      // bytes/sec
  server: string | null;
  serverId: string | null;
  serverLocation: string | null;
  ip: string | null;
  timestamp: string | null;
  resultUrl: string | null;
  raw?: string;
}

interface SpeedTestStatus {
  installed: boolean;
  cliPath: string;
  termsAccepted: boolean;
}

interface DhcpLease {
  mac: string;
  ip: string;
  hostname: string;
  clientId: string;
  expiry: string | null;
  interface?: string;
  state?: string;
  source: string;
}

type TestPhase = 'idle' | 'testing' | 'done' | 'error';

// Sub-page selector tabs
const subPageItems: { id: ToolsSubPage; label: string; icon: string }[] = [
  { id: 'speedtest', label: 'Speedtest', icon: '⚡' },
  { id: 'dhcp_leases', label: 'DHCP Leases', icon: '📋' },
  { id: 'terminal', label: 'Terminal', icon: '💻' }
];

const ToolsPage: React.FC = () => {
  const [subPage, setSubPage] = useState<ToolsSubPage>('speedtest');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Tools</h1>
          <p className="text-xs text-slate-500">Network diagnostics and utilities for your machine.</p>
        </div>
      </div>

      {/* Sub-page Selector */}
      <div className="flex flex-wrap items-center gap-2">
        {subPageItems.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setSubPage(it.id)}
            className={`px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-colors ${
              subPage === it.id
                ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className="mr-1.5">{it.icon}</span>
            {it.label}
          </button>
        ))}
      </div>

      {/* Sub-page Content */}
      {subPage === 'speedtest' && <SpeedtestSubPage />}
      {subPage === 'dhcp_leases' && <DhcpLeasesSubPage />}
      {subPage === 'terminal' && <TerminalSubPage />}
    </div>
  );
};

/* =====================================================
   SPEEDTEST SUB-PAGE
   ===================================================== */
const SpeedtestSubPage: React.FC = () => {
  const [status, setStatus] = useState<SpeedTestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const [animPhase, setAnimPhase] = useState<'idle' | 'download' | 'upload' | 'ping'>('idle');

  const fetchStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/speedtest/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch speedtest status:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/speedtest/install', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        await fetchStatus();
      } else {
        setError(data.error || 'Installation failed');
      }
    } catch (e: any) {
      setError(e.message || 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const handleAcceptTerms = async () => {
    setAcceptingTerms(true);
    setError(null);
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/speedtest/accept-terms', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        await fetchStatus();
      } else {
        setError(data.error || 'Failed to accept terms');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to accept terms');
    } finally {
      setAcceptingTerms(false);
    }
  };

  const handleRunTest = async () => {
    setPhase('testing');
    setError(null);
    setResult(null);
    setAnimPhase('ping');

    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/speedtest/run', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success) {
        setResult(data);
        setPhase('done');
        setAnimPhase('idle');
      } else {
        setError(data.error || 'Speedtest failed');
        setPhase('error');
        setAnimPhase('idle');
      }
    } catch (e: any) {
      setError(e.message || 'Speedtest failed');
      setPhase('error');
      setAnimPhase('idle');
    }
  };

  // Simulate animation phases during test
  useEffect(() => {
    if (phase !== 'testing') return;
    const t1 = setTimeout(() => setAnimPhase('download'), 2000);
    const t2 = setTimeout(() => setAnimPhase('upload'), 8000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

  const bytesToMbps = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '--';
    return (bytes * 8 / 1000000).toFixed(2);
  };

  const formatPing = (ms: number | null): string => {
    if (ms === null || ms === undefined) return '--';
    return ms.toFixed(2);
  };

  // Gauge component
  const Gauge: React.FC<{ value: number; max: number; label: string; unit: string; color: string; active: boolean }> = ({ value, max, label, unit, color, active }) => {
    const pct = Math.min((value / max) * 100, 100);
    const circumference = 2 * Math.PI * 54;
    const strokeDashoffset = circumference - (pct / 100) * circumference * 0.75;

    return (
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-36 h-36">
          <svg className="w-full h-full -rotate-[135deg]" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="#e2e8f0" strokeWidth="8" strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} strokeLinecap="round" />
            <circle
              cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="8"
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-black ${active ? 'text-slate-900' : 'text-slate-300'}`}>
              {value > 0 ? value.toFixed(1) : '--'}
            </span>
            <span className={`text-[9px] font-bold uppercase tracking-wider ${active ? 'text-slate-500' : 'text-slate-300'}`}>{unit}</span>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      </div>
    );
  };

  return (
      <>{/* Speedtest Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/20">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">Speedtest by Ookla</h2>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Machine WAN Speed Test</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-xs text-slate-500 font-bold uppercase tracking-wider">Checking Speedtest CLI...</span>
            </div>
          )}

          {/* Not Installed */}
          {!loading && status && !status.installed && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Speedtest CLI Not Installed</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                The Ookla Speedtest CLI needs to be installed on this machine to test the WAN internet speed. This runs the test from your machine directly, not from the browser.
              </p>
              <button
                onClick={handleInstall}
                disabled={installing}
                className="admin-btn-primary px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg disabled:opacity-50"
              >
                {installing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Installing...
                  </span>
                ) : (
                  'Install Speedtest CLI'
                )}
              </button>
              {error && (
                <p className="text-xs text-red-500 font-semibold mt-2">{error}</p>
              )}
            </div>
          )}

          {/* Installed but Terms Not Accepted */}
          {!loading && status && status.installed && !status.termsAccepted && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Accept Ookla Terms of Use</h3>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                Before using the Speedtest CLI, you must accept Ookla's License Agreement and GDPR Terms.
                By clicking "Accept Terms", you agree to the Ookla End User License Agreement, Privacy Policy, and Terms of Use.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 max-w-md mx-auto">
                <p className="text-[10px] text-amber-800 font-semibold leading-relaxed">
                  By using Speedtest, you agree to Ookla's Terms of Use and Privacy Policy available at:
                  <a href="https://www.speedtest.net/about/terms" target="_blank" rel="noopener noreferrer" className="underline ml-1">speedtest.net/about/terms</a> and
                  <a href="https://www.speedtest.net/about/privacy" target="_blank" rel="noopener noreferrer" className="underline ml-1">speedtest.net/about/privacy</a>
                </p>
              </div>
              <button
                onClick={handleAcceptTerms}
                disabled={acceptingTerms}
                className="admin-btn-primary px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg disabled:opacity-50"
              >
                {acceptingTerms ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Accepting...
                  </span>
                ) : (
                  'Accept Terms & License'
                )}
              </button>
              {error && (
                <p className="text-xs text-red-500 font-semibold mt-2">{error}</p>
              )}
            </div>
          )}

          {/* Ready / Test Results */}
          {!loading && status && status.installed && status.termsAccepted && (
            <div className="space-y-6">
              {/* Gauge Display */}
              <div className="flex flex-col items-center py-4">
                <div className="flex items-center gap-8 md:gap-12 flex-wrap justify-center">
                  <Gauge
                    value={result?.ping ? parseFloat(formatPing(result.ping)) : 0}
                    max={200}
                    label="Ping"
                    unit="ms"
                    color={phase === 'testing' && animPhase === 'ping' ? '#3b82f6' : (result?.ping ? '#3b82f6' : '#cbd5e1')}
                    active={phase === 'testing' ? animPhase === 'ping' : !!result?.ping}
                  />
                  <Gauge
                    value={result?.download ? parseFloat(bytesToMbps(result.download)) : 0}
                    max={1000}
                    label="Download"
                    unit="Mbps"
                    color={phase === 'testing' && animPhase === 'download' ? '#10b981' : (result?.download ? '#10b981' : '#cbd5e1')}
                    active={phase === 'testing' ? animPhase === 'download' : !!result?.download}
                  />
                  <Gauge
                    value={result?.upload ? parseFloat(bytesToMbps(result.upload)) : 0}
                    max={1000}
                    label="Upload"
                    unit="Mbps"
                    color={phase === 'testing' && animPhase === 'upload' ? '#8b5cf6' : (result?.upload ? '#8b5cf6' : '#cbd5e1')}
                    active={phase === 'testing' ? animPhase === 'upload' : !!result?.upload}
                  />
                </div>

                {/* Testing animation indicator */}
                {phase === 'testing' && (
                  <div className="mt-6 flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-widest">
                      Testing {animPhase === 'ping' ? 'Ping' : animPhase === 'download' ? 'Download Speed' : 'Upload Speed'}...
                    </span>
                  </div>
                )}
              </div>

              {/* Run Test Button */}
              <div className="flex justify-center">
                <button
                  onClick={handleRunTest}
                  disabled={phase === 'testing'}
                  className={`
                    px-8 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all duration-300 shadow-xl
                    ${phase === 'testing'
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-green-500/30 active:scale-95'
                    }
                  `}
                >
                  {phase === 'testing' ? 'Testing...' : 'Start Speedtest'}
                </button>
              </div>

              {/* Results Details */}
              {result && phase === 'done' && (
                <div className="mt-4 bg-slate-50 rounded-xl border border-slate-100 p-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Test Results</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Ping</span>
                      <p className="text-lg font-black text-blue-600">{formatPing(result.ping)} <span className="text-[10px] font-bold text-slate-400">ms</span></p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Jitter</span>
                      <p className="text-lg font-black text-blue-500">{formatPing(result.jitter)} <span className="text-[10px] font-bold text-slate-400">ms</span></p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Download</span>
                      <p className="text-lg font-black text-emerald-600">{bytesToMbps(result.download)} <span className="text-[10px] font-bold text-slate-400">Mbps</span></p>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Upload</span>
                      <p className="text-lg font-black text-violet-600">{bytesToMbps(result.upload)} <span className="text-[10px] font-bold text-slate-400">Mbps</span></p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200 grid grid-cols-2 md:grid-cols-3 gap-3">
                    {result.server && (
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Server</span>
                        <p className="text-xs font-semibold text-slate-700">{result.server}</p>
                      </div>
                    )}
                    {result.serverLocation && (
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Location</span>
                        <p className="text-xs font-semibold text-slate-700">{result.serverLocation}</p>
                      </div>
                    )}
                    {result.ip && (
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">External IP</span>
                        <p className="text-xs font-semibold text-slate-700">{result.ip}</p>
                      </div>
                    )}
                  </div>

                  {result.resultUrl && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <a
                        href={result.resultUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-bold text-blue-500 hover:text-blue-700 uppercase tracking-widest"
                      >
                        View Full Results on Speedtest.net →
                      </a>
                    </div>
                  )}

                  {result.timestamp && (
                    <div className="mt-2">
                      <span className="text-[9px] text-slate-400">Tested at: {new Date(result.timestamp).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Error Display */}
              {error && phase === 'error' && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-red-600">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              Powered by Ookla® Speedtest CLI
            </span>
            {status?.cliPath && (
              <span className="text-[9px] text-slate-400 font-mono">
                {status.cliPath}
              </span>
            )}
          </div>
        </div>
      </div>
      </>
  );
};

/* =====================================================
   DHCP LEASES SUB-PAGE
   ===================================================== */
const DhcpLeasesSubPage: React.FC = () => {
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'ip' | 'mac' | 'hostname' | 'expiry'>('ip');

  const fetchLeases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/dhcp-leases', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLeases(data.leases || []);
      } else {
        const data = await res.json().catch(() => ({ error: 'Failed to fetch DHCP leases' }));
        setError(data.error || 'Failed to fetch DHCP leases');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to fetch DHCP leases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeases();
  }, [fetchLeases]);

  const filtered = leases.filter((lease) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      lease.mac.toLowerCase().includes(term) ||
      lease.ip.toLowerCase().includes(term) ||
      lease.hostname.toLowerCase().includes(term)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'ip') {
      const aParts = a.ip.split('.').map(Number);
      const bParts = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    }
    if (sortBy === 'mac') return a.mac.localeCompare(b.mac);
    if (sortBy === 'hostname') return a.hostname.localeCompare(b.hostname);
    if (sortBy === 'expiry') {
      const aTime = a.expiry ? new Date(a.expiry).getTime() : Infinity;
      const bTime = b.expiry ? new Date(b.expiry).getTime() : Infinity;
      return aTime - bTime;
    }
    return 0;
  });

  const formatExpiry = (iso: string | null): string => {
    if (!iso) return '--';
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.getTime() < now.getTime()) return 'Expired';
      return d.toLocaleString();
    } catch {
      return '--';
    }
  };

  const isExpired = (iso: string | null): boolean => {
    if (!iso) return false;
    return new Date(iso).getTime() < Date.now();
  };

  return (
      <>{/* DHCP Leases Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">DHCP Leases</h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">All connected devices and their DHCP assignments</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-3 py-1.5 rounded-lg">
                {leases.length} Device{leases.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={fetchLeases}
                disabled={loading}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Search & Sort */}
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by MAC, IP, or Hostname..."
                className="w-full admin-input text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="admin-input text-xs"
              >
                <option value="ip">IP Address</option>
                <option value="mac">MAC Address</option>
                <option value="hostname">Hostname</option>
                <option value="expiry">Expiry</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-xs text-slate-500 font-bold uppercase tracking-wider">Loading DHCP Leases...</span>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-xs text-red-500 font-semibold">{error}</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                {searchTerm ? 'No devices match your search.' : 'No DHCP leases found.'}
              </p>
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2.5 text-left font-bold">#</th>
                  <th className="px-4 py-2.5 text-left font-bold">MAC Address</th>
                  <th className="px-4 py-2.5 text-left font-bold">IP Address</th>
                  <th className="px-4 py-2.5 text-left font-bold">Hostname</th>
                  <th className="px-4 py-2.5 text-left font-bold">Interface</th>
                  <th className="px-4 py-2.5 text-left font-bold">State</th>
                  <th className="px-4 py-2.5 text-left font-bold">Lease Expiry</th>
                  <th className="px-4 py-2.5 text-left font-bold">Source</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((lease, idx) => (
                  <tr
                    key={`${lease.mac}-${lease.ip}`}
                    className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-slate-400 font-bold">{idx + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">{lease.mac}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-700">{lease.ip}</td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {lease.hostname ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                          {lease.hostname}
                        </span>
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {lease.interface ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 font-semibold text-[10px]">
                          {lease.interface}
                        </span>
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {lease.state ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          lease.state === 'REACHABLE' || lease.state === 'STALE'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : lease.state === 'DELAY' || lease.state === 'PROBE'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {lease.state}
                        </span>
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {lease.expiry ? (
                        <span className={`text-[11px] ${isExpired(lease.expiry) ? 'text-red-500 font-bold' : 'text-slate-600'}`}>
                          {formatExpiry(lease.expiry)}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[10px]">Static / ARP</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase border ${
                        lease.source === 'arp'
                          ? 'bg-purple-50 text-purple-600 border-purple-200'
                          : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      }`}>
                        {lease.source === 'arp' ? 'ARP' : 'DHCP'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              DHCP Leases from dnsmasq & ARP Table
            </span>
            <span className="text-[9px] text-slate-400">
              {filtered.length} of {leases.length} shown
            </span>
          </div>
        </div>
      </div>
      </>
  );
};

/* =====================================================
   TERMINAL SUB-PAGE (SSH CLI)
   ===================================================== */
const TerminalSubPage: React.FC = () => {
  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<TerminalOutput[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalEndRef = React.useRef<HTMLDivElement>(null);

  // Fetch terminal info on mount
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const token = localStorage.getItem('ajc_admin_token');
        const res = await fetch('/api/terminal/info', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setInfo(data);
        }
      } catch (e) {
        console.error('Failed to fetch terminal info:', e);
      }
    };
    fetchInfo();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const executeCommand = async () => {
    if (!command.trim()) return;
    
    setLoading(true);
    setError(null);
    
    const cmdToExecute = command.trim();
    setCommand(''); // Clear input immediately for better UX
    
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ command: cmdToExecute })
      });
      
      const data = await res.json();
      
      setHistory(prev => [...prev, {
        success: data.success,
        stdout: data.stdout,
        stderr: data.stderr,
        exitCode: data.exitCode,
        command: cmdToExecute
      }]);
    } catch (e: any) {
      setHistory(prev => [...prev, {
        success: false,
        stdout: '',
        stderr: e.message || 'Failed to execute command',
        exitCode: 1,
        command: cmdToExecute
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    }
  };

  const clearHistory = () => {
    setHistory([]);
  };

  const quickCommands = [
    { label: 'pwd', cmd: 'pwd' },
    { label: 'ls -la', cmd: 'ls -la' },
    { label: 'df -h', cmd: 'df -h' },
    { label: 'free -m', cmd: 'free -m' },
    { label: 'uptime', cmd: 'uptime' },
    { label: 'whoami', cmd: 'whoami' },
    { label: 'ip addr', cmd: 'ip addr' },
    { label: 'top -bn1 | head', cmd: 'top -bn1 | head -20' },
  ];

  return (
      <>{/* Terminal Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-700 to-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-slate-500/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">SSH Terminal</h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                  {info ? `${info.username}@${info.hostname}:${info.cwd}` : 'Connecting...'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearHistory}
                disabled={history.length === 0 || loading}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Quick Commands */}
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mr-2">Quick:</span>
            {quickCommands.map((qc) => (
              <button
                key={qc.label}
                onClick={() => {
                  setCommand(qc.cmd);
                }}
                disabled={loading}
                className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
              >
                {qc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Terminal Output */}
        <div className="bg-slate-900 p-4 min-h-[300px] max-h-[500px] overflow-y-auto font-mono text-xs">
          {/* Welcome Message */}
          {history.length === 0 && (
            <div className="text-slate-400 mb-4">
              <p className="text-green-400">Welcome to AJC PisoWiFi Terminal</p>
              <p className="mt-1">Type commands to execute on the local machine.</p>
              <p className="text-slate-500 mt-1">Note: Some dangerous commands are blocked for security.</p>
            </div>
          )}

          {/* Command History */}
          {history.map((entry, idx) => (
            <div key={idx} className="mb-4">
              {/* Command Prompt */}
              <div className="flex items-center gap-2 text-green-400">
                <span className="text-slate-500">$</span>
                <span>{entry.command}</span>
              </div>
              
              {/* Output */}
              {entry.stdout && (
                <div className="text-slate-200 whitespace-pre-wrap mt-1 ml-4">
                  {entry.stdout}
                </div>
              )}
              
              {/* Error */}
              {entry.stderr && (
                <div className="text-red-400 whitespace-pre-wrap mt-1 ml-4">
                  {entry.stderr}
                </div>
              )}
              
              {/* Exit Code */}
              {entry.exitCode !== 0 && (
                <div className="text-amber-400 text-[10px] mt-1 ml-4">
                  Exit code: {entry.exitCode}
                </div>
              )}
            </div>
          ))}

          {/* Current Input Line */}
          <div className="flex items-center gap-2">
            <span className="text-green-400">$</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder={loading ? 'Executing...' : 'Type command...'}
              className="flex-1 bg-transparent text-slate-200 outline-none font-mono text-xs placeholder-slate-600"
              autoFocus
            />
            {loading && (
              <span className="text-slate-500 animate-pulse">...</span>
            )}
          </div>

          <div ref={terminalEndRef} />
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              Press Enter to execute • Some commands are blocked for security
            </span>
            <span className="text-[9px] text-slate-400">
              {history.length} command{history.length !== 1 ? 's' : ''} executed
            </span>
          </div>
        </div>
      </div>
      </>
  );
};

export default ToolsPage;
