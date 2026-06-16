import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AdminTab, UserSession, Rate, WifiDevice, NodeMCUDevice } from './types';
import LandingPage from './components/Portal/LandingPage';
import Analytics from './components/Admin/Analytics';
import RatesManager from './components/Admin/RatesManager';
import NetworkSettings from './components/Admin/NetworkSettings';
import HardwareManager from './components/Admin/HardwareManager';
import SystemUpdater from './components/Admin/SystemUpdater';
import SystemSettings from './components/Admin/SystemSettings';
import DeviceManager from './components/Admin/DeviceManager';
import Login from './components/Admin/Login';
import ThemeSettings from './components/Admin/ThemeSettings';
import PortalEditor from './components/Admin/PortalEditor';
import PPPoEServer from './components/Admin/PPPoEServer';
import MikroTikManagement from './components/Admin/MikroTikManagement';
import { MyMachines } from './components/Admin/MyMachines';
import BandwidthManager from './components/Admin/BandwidthManager';
import MultiWanSettings from './components/Admin/MultiWanSettings';
import ChatManager from './components/Admin/ChatManager';
import VoucherManager from './components/Admin/VoucherManager';
import RemoteManager from './components/Admin/RemoteManager';
import RewardsSettings from './components/Admin/RewardsSettings';
import CompanySettings from './components/Admin/CompanySettings';
import ToolsPage from './components/Admin/ToolsPage';
import EmployeeManagement from './components/Admin/EmployeeManagement';
import EquipmentInventory from './components/Admin/EquipmentInventory';
import PhoneRental from './components/Admin/PhoneRental';
import { apiClient } from './lib/api';
import { initAdminTheme, setAdminTheme, applyAdminTheme } from './lib/theme';

const App: React.FC = () => {

  const isCurrentlyAdminPath = () => {
    const path = window.location.pathname.toLowerCase();
    const hasAdminFlag = localStorage.getItem('rjd_admin_mode') === 'true';
    return path === '/admin' || path === '/admin/' || path.startsWith('/admin/') || hasAdminFlag;
  };

  const [isAdmin, setIsAdmin] = useState(isCurrentlyAdminPath());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Initialize activeTab from localStorage if available to persist state across refreshes
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const savedTab = localStorage.getItem('rjd_admin_last_tab');
    // Simple validation to ensure the saved value is a valid enum value
    if (savedTab && Object.values(AdminTab).includes(savedTab as AdminTab)) {
      return savedTab as AdminTab;
    }
    return AdminTab.Analytics;
  });

  // Persist activeTab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('rjd_admin_last_tab', activeTab);
  }, [activeTab]);

  const [licenseStatus, setLicenseStatus] = useState<{ isLicensed: boolean, isRevoked: boolean, canOperate: boolean }>({ isLicensed: true, isRevoked: false, canOperate: true });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rates, setRates] = useState<Rate[]>([]);
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [salesSessions, setSalesSessions] = useState<UserSession[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [devices, setDevices] = useState<WifiDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<{ companyName: string, companyLogo: string | null }>({
    companyName: 'RJD PISOWIFI',
    companyLogo: null
  });

  const [systemVersion, setSystemVersion] = useState<string>('');

  // Fetch system version on mount
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const token = localStorage.getItem('rjd_admin_token');
        const headers: HeadersInit = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/system/current-version', { headers });
        if (res.ok) {
          const data = await res.json();
          const tag = data.version_name ? `v${data.version_name}-ONLINE-STABLE` : '';
          setSystemVersion(tag);
        }
      } catch {}
    };
    fetchVersion();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      document.title = `${companySettings.companyName} - Admin Panel`;
    }
  }, [companySettings, isAdmin]);

  const loadData = async () => {
    try {
      setError(null);
      
      // Fetch company settings first to update UI immediately
      try {
        const settings = await apiClient.getCompanySettings();
        setCompanySettings(settings);
      } catch (e) {
        console.warn('Failed to fetch company settings');
      }

      // Check license status first
      try {
        const lic = await fetch('/api/license/status').then(r => r.json());
        setLicenseStatus(lic);
        if (lic.isRevoked) {
          setActiveTab(AdminTab.Machines);
        }
      } catch (e) {
        console.warn('Failed to fetch license status');
      }

      const isAdminRoute = isCurrentlyAdminPath();
      const devicesPromise = isAdminRoute
        ? apiClient.getWifiDevices().catch(() => [])
        : Promise.resolve([]);

      const sessionsPromise = apiClient.getSessions().catch(() => []);
      const salesSessionsPromise = isAdminRoute
        ? apiClient.getSalesSessions().catch(() => [])
        : Promise.resolve([]);
      
      const salesHistoryPromise = isAdminRoute
        ? apiClient.getSalesHistory().catch(() => [])
        : Promise.resolve([]);

      const [fetchedRates, sessions, salesSessionData, fetchedDevices, salesHistoryData] = await Promise.all([
        apiClient.getRates(),
        sessionsPromise,
        salesSessionsPromise,
        devicesPromise,
        salesHistoryPromise
      ]);
      setRates(fetchedRates);
      setActiveSessions(sessions);
      if (isAdminRoute) {
        setSalesSessions(salesSessionData);
        setSalesHistory(salesHistoryData);
      }
      setDevices(fetchedDevices);
    } catch (err: any) {
      console.error('Backend connection failed:', err);
      setError(err.message || 'Connection to RJD Hardware failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initialize theme based on current mode
    if (isCurrentlyAdminPath()) {
      initAdminTheme();
    } else {
      // Ensure portal always uses default theme (or specific portal theme logic)
      applyAdminTheme('default');
    }

    loadData();
    const handleLocationChange = () => {
      const isNowAdmin = isCurrentlyAdminPath();
      setIsAdmin(isNowAdmin);
      
      if (isNowAdmin) {
        initAdminTheme();
      } else {
        applyAdminTheme('default');
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    
    // Check authentication status
    const checkAuth = async () => {
      const token = localStorage.getItem('rjd_admin_token');
      if (token) {
        try {
          const res = await fetch('/api/admin/check-auth', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.authenticated) {
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem('rjd_admin_token');
            setIsAuthenticated(false);
          }
        } catch (e) {
          setIsAuthenticated(false);
        }
      }
    };
    checkAuth();

    // Restore session on mount
    restoreSession();

    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Sync state with backend timer
  useEffect(() => {
    const interval = setInterval(async () => {
      // Periodic refresh from server to ensure sync
      try {
        const sessions = await apiClient.getSessions();
        let fetchedDevices: WifiDevice[] = [];
        if (isCurrentlyAdminPath()) {
          fetchedDevices = await apiClient.getWifiDevices();
        }
        setActiveSessions(sessions);
        setDevices(fetchedDevices);
      } catch (e) {
        // Local decrement as fallback for smooth UI - skip if paused
        setActiveSessions(prev => 
          prev.map(s => ({
            ...s,
            remainingSeconds: s.isPaused ? s.remainingSeconds : Math.max(0, s.remainingSeconds - 1)
          })).filter(s => s.remainingSeconds > 0)
        );
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleAdmin = () => {
    const nextState = !isAdmin;
    setIsAdmin(nextState);
    if (nextState) {
      localStorage.setItem('rjd_admin_mode', 'true');
      window.history.pushState({}, '', '/admin');
      initAdminTheme();
    } else {
      localStorage.removeItem('rjd_admin_mode');
      localStorage.removeItem('rjd_admin_token');
      setIsAuthenticated(false);
      window.history.pushState({}, '', '/');
      applyAdminTheme('default');
    }
  };

  const handleAddSession = async (session: UserSession) => {
    try {
      const coinSlot = (session as any).coinSlot as string | undefined;
      const coinSlotLockId = (session as any).coinSlotLockId as string | undefined;
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mac: session.mac,
          minutes: Math.ceil(session.remainingSeconds / 60),
          pesos: session.totalPaid,
          slot: coinSlot || 'main',
          lockId: coinSlotLockId
          // Don't send IP - server will detect it
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) {
          localStorage.setItem('rjd_session_token', data.token);
        }
        loadData();
        if (data.message) {
          alert('✅ ' + data.message);
        } else {
          alert('✅ Internet access granted! Connection should activate automatically.');
        }
        if (window.location.pathname === '/') {
          window.location.reload();
        }
      } else {
        alert('❌ Failed to authorize session: ' + data.error);
      }
    } catch (e) {
      alert('❌ Network error authorizing connection.');
    } finally {
      const coinSlot = (session as any).coinSlot as string | undefined;
      const coinSlotLockId = (session as any).coinSlotLockId as string | undefined;
      if (coinSlot && coinSlotLockId) {
        fetch('/api/coinslot/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: coinSlot, lockId: coinSlotLockId })
        }).catch(() => {});
      }
    }
  };

  const updateRates = async () => {
    await loadData();
  };

  // Check for existing session token and try to restore (Fix for randomized MACs/SSID switching)
  // Trigger OS connectivity probes after session restore/transfer
  // This forces the OS to re-check internet connectivity and close
  // the captive portal mini-browser popup
  const triggerConnectivityProbes = () => {
    fetch('http://connectivitycheck.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    fetch('http://captive.apple.com/hotspot-detect.html', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    fetch('http://www.msftconnecttest.com/connecttest.txt', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    fetch('http://1.1.1.1/', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    setTimeout(() => {
      fetch('http://connectivitycheck.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
      fetch('http://captive.apple.com/hotspot-detect.html', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    }, 1500);
  };

  const restoreSession = async (retries = 5) => {
    const sessionToken = localStorage.getItem('rjd_session_token');
    if (sessionToken) {
      try {
        const res = await fetch('/api/sessions/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: sessionToken })
        });
        
        // If 400 (Bad Request), it likely means MAC resolution failed temporarily. Retry.
        if (res.status === 400 && retries > 0) {
          console.log(`[Session] Restore failed (400), retrying... (${retries} left)`);
          setTimeout(() => restoreSession(retries - 1), 2000);
          return;
        }

        const data = await res.json();
        if (data.success) {
          console.log('Session restored successfully');
          if (data.migrated) {
            console.log('Session migrated to new network info');
            loadData(); // Reload to see active session
            // Trigger connectivity probes so OS closes captive portal mini-browser
            triggerConnectivityProbes();
          } else {
            // Even for non-migrated restores, probe connectivity
            // to ensure the OS knows internet is available
            triggerConnectivityProbes();
          }
        } else if (res.status === 404) {
          // Token invalid/expired - only remove if we are sure
          console.log('[Session] Token expired or invalid');
          localStorage.removeItem('rjd_session_token');
        }
      } catch (e) {
        console.error('Failed to restore session:', e);
        if (retries > 0) {
          setTimeout(() => restoreSession(retries - 1), 2000);
        }
      }
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-blue-400 font-bold tracking-widest uppercase text-xs">RJD Core Initializing...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-2xl border border-red-100 text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">⚠️</div>
          <h2 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">System Offline</h2>
          <p className="text-slate-500 text-sm mb-8 leading-relaxed">{error}</p>
          <button
            onClick={() => { setLoading(true); loadData(); }}
            className="admin-btn-primary w-full py-4 rounded-2xl font-bold shadow-xl shadow-slate-900/20"
          >
            Retry System Link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="fixed bottom-4 right-4 z-[999] hidden md:block">
        <button
          onClick={handleToggleAdmin}
          className="admin-exit-btn px-5 py-3 rounded-full text-[10px] font-black tracking-widest uppercase shadow-2xl border active:scale-95 transition-all flex items-center gap-2"
        >
          <span>{isAdmin ? '🚪' : '🔐'}</span>
          {isAdmin ? 'Exit Admin' : 'Admin Login'}
        </button>
      </div>

      {isAdmin ? (
        isAuthenticated ? (
          <div className="admin-layout flex h-screen overflow-hidden bg-slate-100 font-sans selection:bg-blue-100">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
              <div 
                className="fixed inset-0 bg-black/50 z-40 md:hidden animate-in fade-in duration-300" 
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Sidebar */}
            <aside className={`
              admin-sidebar fixed md:relative h-full
              ${sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64 md:translate-x-0 md:w-20'} 
              bg-slate-900 text-white flex flex-col shrink-0 transition-all duration-300 ease-in-out z-50 border-r border-slate-800
            `}>
              <div className={`p-4 border-b border-white/5 flex items-center ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
                {sidebarOpen ? (
                  <>
                    <div className="flex items-center gap-2 overflow-hidden">
                      {companySettings.companyLogo ? (
                         <img src={companySettings.companyLogo} className="w-8 h-8 object-contain bg-white rounded-md" alt="Logo" />
                      ) : (
                         <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center font-black text-xs shrink-0">
                           {companySettings.companyName.substring(0, 3).toUpperCase()}
                         </div>
                      )}
                      <h1
                        className="text-lg font-bold tracking-tight truncate"
                        style={{ color: '#111827' }}
                        title={companySettings.companyName}
                      >
                        {companySettings.companyName}
                      </h1>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 md:hidden shrink-0">
                      ✕
                    </button>
                  </>
                ) : (
                  companySettings.companyLogo ? (
                     <img src={companySettings.companyLogo} className="w-8 h-8 object-contain bg-white rounded-md" alt="Logo" />
                  ) : (
                     <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black text-xs">
                       {companySettings.companyName.substring(0, 1).toUpperCase()}
                     </div>
                  )
                )}
              </div>
              
          <nav className={`admin-sidebar-nav flex-1 ${sidebarOpen ? 'p-3' : 'p-2'} space-y-1 overflow-y-auto scrollbar-hide`}>
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Analytics} onClick={() => setActiveTab(AdminTab.Analytics)} icon="📊" label="Dashboard" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Rates} onClick={() => setActiveTab(AdminTab.Rates)} icon="💰" label="Pricing" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Network} onClick={() => setActiveTab(AdminTab.Network)} icon="🌐" label="Network" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Devices} onClick={() => setActiveTab(AdminTab.Devices)} icon="📱" label="Devices" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Hardware} onClick={() => setActiveTab(AdminTab.Hardware)} icon="🔌" label="Hardware" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Themes} onClick={() => setActiveTab(AdminTab.Themes)} icon="🎨" label="Themes" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.PortalEditor} onClick={() => setActiveTab(AdminTab.PortalEditor)} icon="🖥️" label="Portal" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.PPPoE} onClick={() => setActiveTab(AdminTab.PPPoE)} icon="📞" label="PPPoE" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.MikroTik} onClick={() => setActiveTab(AdminTab.MikroTik)} icon="📡" label="MikroTik" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Bandwidth} onClick={() => setActiveTab(AdminTab.Bandwidth)} icon="📶" label="QoS" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.MultiWan} onClick={() => setActiveTab(AdminTab.MultiWan)} icon="🔀" label="Multi-WAN" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Chat} onClick={() => setActiveTab(AdminTab.Chat)} icon="💬" label="Chat" collapsed={!sidebarOpen} />
            <SidebarItem disabled={false} active={activeTab === AdminTab.Machines} onClick={() => setActiveTab(AdminTab.Machines)} icon="🤖" label="Machines" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Vouchers} onClick={() => setActiveTab(AdminTab.Vouchers)} icon="🎟️" label="Vouchers" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Rewards} onClick={() => setActiveTab(AdminTab.Rewards)} icon="🎁" label="Rewards" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.SalesInventory} onClick={() => setActiveTab(AdminTab.SalesInventory)} icon="📒" label="Sales Inventory" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Employees} onClick={() => setActiveTab(AdminTab.Employees)} icon="👷" label="Employees" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.EquipmentInventory} onClick={() => setActiveTab(AdminTab.EquipmentInventory)} icon="📦" label="Equipment" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.PhoneRental} onClick={() => setActiveTab(AdminTab.PhoneRental)} icon="📲" label="Phone Rental" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Remote} onClick={() => setActiveTab(AdminTab.Remote)} icon="🛰️" label="Remote" collapsed={!sidebarOpen} />
            <SidebarItem active={activeTab === AdminTab.CompanySettings} onClick={() => setActiveTab(AdminTab.CompanySettings)} icon="🏢" label="Company" collapsed={!sidebarOpen} />
            <SidebarItem active={activeTab === AdminTab.System} onClick={() => setActiveTab(AdminTab.System)} icon="⚙️" label="System" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Updater} onClick={() => setActiveTab(AdminTab.Updater)} icon="🚀" label="Updater" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Tools} onClick={() => setActiveTab(AdminTab.Tools)} icon="🔧" label="Tools" collapsed={!sidebarOpen} />
          </nav>

              <div className={`admin-sidebar-footer p-4 border-t border-white/5 bg-black/20 ${sidebarOpen ? 'block' : 'hidden md:block'}`}>
                 <div className="flex flex-col gap-3">
                   <div className="flex flex-col">
                      <span className="text-white font-black text-sm tracking-tighter uppercase leading-none">RJD PISOWIFI</span>
                      {sidebarOpen && <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">{systemVersion || 'v3.7.8-STABLE'}</span>}
                   </div>
                   
                  {/* Mobile Exit Button */}
                  {sidebarOpen && (
                    <button 
                      onClick={handleToggleAdmin}
                      className="admin-exit-btn w-full px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors md:hidden"
                    >
                      <span>🚪</span> Exit Admin
                    </button>
                  )}
                 </div>
              </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 bg-slate-100 overflow-hidden">
              {/* Compact Top Bar */}
              <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-30">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tight block">
                    {activeTab}
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden md:flex flex-col items-end mr-2">
                    <span className="text-[10px] font-bold text-slate-900 uppercase">Administrator</span>
                    <span className="text-[9px] text-green-600 font-bold uppercase tracking-tighter">System Verified</span>
                  </div>
                  <div className="w-8 h-8 bg-slate-800 rounded-md flex items-center justify-center text-white font-bold text-xs shadow-sm">
                    AD
                  </div>
                </div>
              </header>

              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto space-y-6">
                  {activeTab === AdminTab.Analytics && <Analytics sessions={salesSessions.length ? salesSessions : activeSessions} salesHistory={salesHistory} />}
                  {activeTab === AdminTab.Rates && <RatesManager rates={rates} setRates={updateRates} />}
                  {activeTab === AdminTab.Network && <NetworkSettings />}
                  {activeTab === AdminTab.Devices && <DeviceManager sessions={activeSessions} refreshSessions={loadData} refreshDevices={loadData} />}
                  {activeTab === AdminTab.Hardware && <HardwareManager />}
                  {activeTab === AdminTab.Themes && <ThemeSettings />}
                  {activeTab === AdminTab.PortalEditor && <PortalEditor />}
                  {activeTab === AdminTab.PPPoE && <PPPoEServer />}
                  {activeTab === AdminTab.MikroTik && <MikroTikManagement />}
                  {activeTab === AdminTab.Bandwidth && <BandwidthManager devices={devices} rates={rates} />}
                  {activeTab === AdminTab.MultiWan && <MultiWanSettings />}
                  {activeTab === AdminTab.Chat && <ChatManager />}
                  {activeTab === AdminTab.Machines && <MyMachines />}
                  {activeTab === AdminTab.Vouchers && <VoucherManager />}
                  {activeTab === AdminTab.SalesInventory && <SalesInventory sessions={salesSessions.length ? salesSessions : activeSessions} />}
                  {activeTab === AdminTab.Employees && <EmployeeManagement />}
                  {activeTab === AdminTab.EquipmentInventory && <EquipmentInventory />}
                  {activeTab === AdminTab.PhoneRental && <PhoneRental />}
                  {activeTab === AdminTab.Remote && <RemoteManager />}
                  {activeTab === AdminTab.Rewards && <RewardsSettings />}
                  {activeTab === AdminTab.CompanySettings && <CompanySettings />}
                  {activeTab === AdminTab.System && <SystemSettings />}
                  {activeTab === AdminTab.Updater && <SystemUpdater />}
                  {activeTab === AdminTab.Tools && <ToolsPage />}
                </div>
                {/* Bottom Spacer for Mobile */}
                <div className="h-20 md:hidden" />
              </div>
            </main>
          </div>
        ) : (
          <Login 
            onLoginSuccess={(token) => {
              localStorage.setItem('rjd_admin_token', token);
              setIsAuthenticated(true);
              initAdminTheme();
            }} 
            onBack={() => handleToggleAdmin()} 
          />
        )
      ) : (
        <LandingPage 
          rates={rates} 
          onSessionStart={handleAddSession} 
          sessions={activeSessions} 
          refreshSessions={loadData} 
          onRestoreSession={() => restoreSession(5)}
        />
      )}
    </div>
  );
};

const SidebarItem: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string; collapsed?: boolean; disabled?: boolean }> = ({ active, onClick, icon, label, collapsed, disabled }) => (
  <button 
    onClick={disabled ? undefined : onClick} 
    title={collapsed ? label : undefined}
    disabled={disabled}
    className={`sidebar-item w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-200 group ${
      disabled 
        ? 'sidebar-item-disabled opacity-20 cursor-not-allowed grayscale' 
        : active 
          ? 'sidebar-item-active text-white' 
          : 'sidebar-item-default text-slate-400 hover:bg-white/5 hover:text-white'
    } ${collapsed ? 'sidebar-item-collapsed justify-center' : 'justify-start'}`}
  >
    <span className={`sidebar-icon text-xl ${active ? 'scale-110' : 'group-hover:scale-110'} transition-transform`}>{icon}</span>
    {!collapsed && <span className="sidebar-label uppercase tracking-widest text-[11px] font-black">{label}</span>}
  </button>
);

const SalesInventory: React.FC<{ sessions: UserSession[] }> = ({ sessions }) => {
  const [nodeMcuDevices, setNodeMcuDevices] = useState<NodeMCUDevice[]>([]);
  const [fromDate, setFromDate] = useState<string>(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });
  const [datePreset, setDatePreset] = useState<string>('today');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [coinSlotFilter, setCoinSlotFilter] = useState<string>('all');
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showOldestFirst, setShowOldestFirst] = useState<boolean>(false);
  const [showPaymentsBreakdown, setShowPaymentsBreakdown] = useState<boolean>(false);
  const [showNotCredited, setShowNotCredited] = useState<boolean>(false);
  
  // New state for sales inventory data from API
  const [salesData, setSalesData] = useState<{
    sales: any[];
    coinslots: string[];
    totals: Record<string, { amount: number; count: number }>;
    grandTotal: { amount: number; count: number };
    todayTotal: { amount: number; count: number };
  }>({
    sales: [],
    coinslots: [],
    totals: {},
    grandTotal: { amount: 0, count: 0 },
    todayTotal: { amount: 0, count: 0 }
  });
  const [salesLoading, setSalesLoading] = useState<boolean>(false);

  // Load NodeMCU devices
  useEffect(() => {
    let cancelled = false;
    const loadDevices = async () => {
      try {
        const devices = await apiClient.getNodeMCUDevices();
        if (!cancelled && Array.isArray(devices)) {
          setNodeMcuDevices(devices.filter((d: any) => d.status === 'accepted' || d.status === 'connected'));
        }
      } catch (e) {
        console.error('Failed to load NodeMCU devices for Sales Inventory');
      }
    };
    loadDevices();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load sales data from API
  useEffect(() => {
    let cancelled = false;
    const loadSalesData = async () => {
      try {
        setSalesLoading(true);
        const data = await apiClient.getSalesInventory({
          from: fromDate,
          to: toDate,
          coinslot: coinSlotFilter,
          type: typeFilter
        });
        if (!cancelled) {
          setSalesData(data);
        }
      } catch (e) {
        console.error('Failed to load sales inventory data:', e);
      } finally {
        if (!cancelled) {
          setSalesLoading(false);
        }
      }
    };
    loadSalesData();
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, coinSlotFilter, typeFilter]);

  const applyDatePreset = (preset: string) => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    let from = todayStr;
    let to = todayStr;

    if (preset === 'yesterday') {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      from = d.toISOString().slice(0, 10);
      to = from;
    } else if (preset === 'this_week') {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const start = new Date(d.setDate(diff));
      from = start.toISOString().slice(0, 10);
      to = todayStr;
    } else if (preset === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      from = start.toISOString().slice(0, 10);
      to = todayStr;
    } else if (preset === 'since_last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      from = start.toISOString().slice(0, 10);
      to = todayStr;
    } else if (preset === 'last_2_months') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      from = start.toISOString().slice(0, 10);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      to = end.toISOString().slice(0, 10);
    } else if (preset === 'this_year') {
      const start = new Date(now.getFullYear(), 0, 1);
      from = start.toISOString().slice(0, 10);
      to = todayStr;
    }

    setFromDate(from);
    setToDate(to);
  };

  // Get coinslot label from MAC address
  const getCoinSlotLabel = (machineId: string) => {
    if (!machineId || machineId === 'main') return 'MAIN';
    const device = nodeMcuDevices.find(d => d.macAddress.toUpperCase() === machineId.toUpperCase());
    return device?.name || machineId;
  };

  // Filter and sort sales data
  const filteredSales = useMemo(() => {
    let result = [...salesData.sales];
    
    // Apply search filter
    if (searchTerm.trim()) {
      const upperSearch = searchTerm.trim().toUpperCase();
      result = result.filter((s: any) => {
        const mac = (s.mac || '').toUpperCase();
        const machineId = (s.machineId || '').toUpperCase();
        return mac.includes(upperSearch) || machineId.includes(upperSearch);
      });
    }
    
    // Sort
    result = result.sort((a: any, b: any) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return showOldestFirst ? da - db : db - da;
    });
    
    return result;
  }, [salesData.sales, searchTerm, showOldestFirst]);

  const paginated = useMemo(() => filteredSales.slice(0, itemsPerPage), [filteredSales, itemsPerPage]);

  // Calculate total sales for the selected date range
  const totalSalesSelected = useMemo(() => {
    if (coinSlotFilter === 'all') {
      return salesData.grandTotal.amount;
    }
    return salesData.totals[coinSlotFilter]?.amount || 0;
  }, [salesData, coinSlotFilter]);

  // Use today's total from API (calculated on server)
  const totalSalesToday = salesData.todayTotal?.amount || 0;

  // Build unique coinslots list with labels
  const uniqueCoinSlots = useMemo(() => {
    const map = new Map<string, string>();
    map.set('main', 'MAIN');
    map.set('all', 'All Coinslots');
    
    // Add NodeMCU devices
    nodeMcuDevices.forEach((d) => {
      map.set(d.macAddress, d.name || d.macAddress);
    });
    
    // Add coinslots from sales data
    salesData.coinslots.forEach((machineId) => {
      if (!map.has(machineId)) {
        map.set(machineId, getCoinSlotLabel(machineId));
      }
    });
    
    return Array.from(map.entries())
      .filter(([key]) => key !== 'all') // Remove the 'all' entry for individual options
      .map(([key, label]) => ({ 
        key, 
        label,
        total: salesData.totals[key]?.amount || 0
      }));
  }, [nodeMcuDevices, salesData]);

  useEffect(() => {
    applyDatePreset(datePreset);
  }, [datePreset]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Sales Inventory</h1>
          <p className="text-xs text-slate-500">Monitor all sales by coinslot, type, and date.</p>
        </div>
        <div className="flex flex-col gap-2">
          {/* TOTAL SALES - Main + NodeMCU */}
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl px-5 py-3 shadow-sm border border-emerald-400 flex items-baseline gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">Total Sales (All Coinslots)</span>
            <span className="text-2xl font-black text-white">
              ₱{salesData.grandTotal.amount.toFixed(2)}
            </span>
          </div>
          {/* Sales Today */}
          <div className="bg-white rounded-xl px-4 py-2 shadow-sm border border-slate-100 flex items-baseline gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sales Today</span>
            <span className="text-lg font-black text-emerald-600">
              ₱{totalSalesToday.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full admin-input text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full admin-input text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">More Date Filters</label>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="w-full admin-input text-xs"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="since_last_month">Since Last Month</option>
              <option value="last_2_months">Last 2 Months</option>
              <option value="this_year">This Year</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full admin-input text-xs"
            >
              <option value="all">All</option>
              <option value="voucher">Voucher</option>
              <option value="coin">Coin</option>
              <option value="cash">Cash</option>
              <option value="eload">Eload</option>
              <option value="subscription">Subscription</option>
              <option value="cash_in">Cash-in</option>
              <option value="bills_payment">Bills Payment</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Coinslot</label>
            <select
              value={coinSlotFilter}
              onChange={(e) => setCoinSlotFilter(e.target.value)}
              className="w-full admin-input text-xs"
            >
              <option value="all">All Coinslots (₱{salesData.grandTotal.amount.toFixed(2)})</option>
              {uniqueCoinSlots.map((slot) => (
                <option key={slot.key} value={slot.key}>
                  {slot.label} (₱{(slot.total || 0).toFixed(2)})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Items per page</label>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(parseInt(e.target.value, 10))}
              className="w-full admin-input text-xs"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Search MAC / Account</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full admin-input text-xs"
              placeholder="Ex: 11:22:33 or 09xxxxxxxxx"
            />
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOldestFirst}
                onChange={(e) => setShowOldestFirst(e.target.checked)}
                className="w-3 h-3 rounded border-slate-300"
              />
              <span className="font-semibold text-slate-600">Show oldest first</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPaymentsBreakdown}
                onChange={(e) => setShowPaymentsBreakdown(e.target.checked)}
                className="w-3 h-3 rounded border-slate-300"
              />
              <span className="font-semibold text-slate-600">Show payments break-down</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showNotCredited}
                onChange={(e) => setShowNotCredited(e.target.checked)}
                className="w-3 h-3 rounded border-slate-300"
              />
              <span className="font-semibold text-slate-600">Show not credited</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="admin-btn-secondary px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest"
            >
              Download Sales Report
            </button>
            <button
              type="button"
              className="admin-btn-danger px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest"
            >
              Clear Inventory
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2 text-left font-bold">Amount</th>
                <th className="px-4 py-2 text-left font-bold">Type</th>
                <th className="px-4 py-2 text-left font-bold">Coinslot</th>
                <th className="px-4 py-2 text-left font-bold">MAC</th>
                <th className="px-4 py-2 text-left font-bold">IP</th>
                <th className="px-4 py-2 text-left font-bold">Date</th>
              </tr>
            </thead>
            <tbody>
              {salesLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-slate-400">
                    Loading sales data...
                  </td>
                </tr>
              )}
              {!salesLoading && paginated.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-slate-400">
                    Walang nahanap na sales sa napiling filter.
                  </td>
                </tr>
              )}
              {!salesLoading && paginated.map((s: any, idx: number) => (
                <tr
                  key={(s.id || s.mac || 'row') + idx}
                  className="border-b border-slate-50 hover:bg-slate-50/60"
                >
                  <td className="px-4 py-2 font-semibold text-slate-800">
                    ₱{(s.amount || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-[11px] font-semibold">
                    {s.type === 'coin' && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Coin</span>}
                    {s.type === 'voucher' && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Voucher</span>}
                    {!s.type && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">-</span>}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-slate-700">{getCoinSlotLabel(s.machineId)}</td>
                  <td className="px-4 py-2 text-[11px] font-mono text-slate-700">{s.mac || 'N/A'}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-700">{s.ip || 'N/A'}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-600">
                    {s.createdAt ? new Date(s.createdAt).toLocaleString() : 'N/A'}
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

export default App;
