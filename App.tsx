import React, { useState, useEffect, useMemo } from 'react';
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
import { MyMachines } from './components/Admin/MyMachines';
import BandwidthManager from './components/Admin/BandwidthManager';
import MultiWanSettings from './components/Admin/MultiWanSettings';
import ChatManager from './components/Admin/ChatManager';
import VoucherManager from './components/Admin/VoucherManager';
import RemoteManager from './components/Admin/RemoteManager';
import RewardsSettings from './components/Admin/RewardsSettings';
import { apiClient } from './lib/api';
import { initAdminTheme, setAdminTheme } from './lib/theme';

const App: React.FC = () => {

  const isCurrentlyAdminPath = () => {
    const path = window.location.pathname.toLowerCase();
    const hasAdminFlag = localStorage.getItem('ajc_admin_mode') === 'true';
    return path === '/admin' || path === '/admin/' || path.startsWith('/admin/') || hasAdminFlag;
  };

  const [isAdmin, setIsAdmin] = useState(isCurrentlyAdminPath());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Initialize activeTab from localStorage to persist state across refreshes
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const savedTab = localStorage.getItem('ajc_admin_last_tab');
    if (savedTab && Object.values(AdminTab).includes(savedTab as AdminTab)) {
      return savedTab as AdminTab;
    }
    return AdminTab.Analytics;
  });

  // Save activeTab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('ajc_admin_last_tab', activeTab);
  }, [activeTab]);

  const [licenseStatus, setLicenseStatus] = useState<{ isLicensed: boolean, isRevoked: boolean, canOperate: boolean }>({ isLicensed: true, isRevoked: false, canOperate: true });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rates, setRates] = useState<Rate[]>([]);
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [salesSessions, setSalesSessions] = useState<UserSession[]>([]);
  const [devices, setDevices] = useState<WifiDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setError(null);
      
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

      const [fetchedRates, sessions, salesHistory, fetchedDevices] = await Promise.all([
        apiClient.getRates(),
        sessionsPromise,
        salesSessionsPromise,
        devicesPromise
      ]);
      setRates(fetchedRates);
      setActiveSessions(sessions);
      if (isAdminRoute) {
        setSalesSessions(salesHistory);
      }
      setDevices(fetchedDevices);
    } catch (err: any) {
      console.error('Backend connection failed:', err);
      setError(err.message || 'Connection to AJC Hardware failed');
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
      setAdminTheme('default');
    }

    loadData();
    const handleLocationChange = () => {
      const isNowAdmin = isCurrentlyAdminPath();
      setIsAdmin(isNowAdmin);
      
      if (isNowAdmin) {
        initAdminTheme();
      } else {
        setAdminTheme('default');
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    
    // Check authentication status
    const checkAuth = async () => {
      const token = localStorage.getItem('ajc_admin_token');
      if (token) {
        try {
          const res = await fetch('/api/admin/check-auth', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.authenticated) {
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem('ajc_admin_token');
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
      localStorage.setItem('ajc_admin_mode', 'true');
      window.history.pushState({}, '', '/admin');
    } else {
      localStorage.removeItem('ajc_admin_mode');
      localStorage.removeItem('ajc_admin_token');
      setIsAuthenticated(false);
      window.history.pushState({}, '', '/');
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
          localStorage.setItem('ajc_session_token', data.token);
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
  const restoreSession = async (retries = 5) => {
    const sessionToken = localStorage.getItem('ajc_session_token');
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
          }
        } else if (res.status === 404) {
          // Token invalid/expired - only remove if we are sure
          console.log('[Session] Token expired or invalid');
          localStorage.removeItem('ajc_session_token');
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
          <p className="text-blue-400 font-bold tracking-widest uppercase text-xs">AJC Core Initializing...</p>
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
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center font-black text-xs">AJC</div>
                      <h1
                        className="text-lg font-bold tracking-tight"
                        style={{ color: '#111827' }}
                      >
                        PISOWIFI
                      </h1>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 md:hidden">
                      ✕
                    </button>
                  </>
                ) : (
                  <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black text-xs">A</div>
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
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Bandwidth} onClick={() => setActiveTab(AdminTab.Bandwidth)} icon="📶" label="QoS" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.MultiWan} onClick={() => setActiveTab(AdminTab.MultiWan)} icon="🔀" label="Multi-WAN" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Chat} onClick={() => setActiveTab(AdminTab.Chat)} icon="💬" label="Chat" collapsed={!sidebarOpen} />
            <SidebarItem disabled={false} active={activeTab === AdminTab.Machines} onClick={() => setActiveTab(AdminTab.Machines)} icon="🤖" label="Machines" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Vouchers} onClick={() => setActiveTab(AdminTab.Vouchers)} icon="🎟️" label="Vouchers" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Rewards} onClick={() => setActiveTab(AdminTab.Rewards)} icon="🎁" label="Rewards" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.SalesInventory} onClick={() => setActiveTab(AdminTab.SalesInventory)} icon="📒" label="Sales Inventory" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Remote} onClick={() => setActiveTab(AdminTab.Remote)} icon="🛰️" label="Remote" collapsed={!sidebarOpen} />
            <SidebarItem active={activeTab === AdminTab.System} onClick={() => setActiveTab(AdminTab.System)} icon="⚙️" label="System" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Updater} onClick={() => setActiveTab(AdminTab.Updater)} icon="🚀" label="Updater" collapsed={!sidebarOpen} />
          </nav>

              <div className={`admin-sidebar-footer p-4 border-t border-white/5 bg-black/20 ${sidebarOpen ? 'block' : 'hidden md:block'}`}>
                 <div className="flex flex-col gap-3">
                   <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      {sidebarOpen && <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">v3.6.0-ONLINE-BETA</span>}
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
                  {activeTab === AdminTab.Analytics && <Analytics sessions={salesSessions.length ? salesSessions : activeSessions} />}
                  {activeTab === AdminTab.Rates && <RatesManager rates={rates} setRates={updateRates} />}
                  {activeTab === AdminTab.Network && <NetworkSettings />}
                  {activeTab === AdminTab.Devices && <DeviceManager sessions={activeSessions} refreshSessions={loadData} refreshDevices={loadData} />}
                  {activeTab === AdminTab.Hardware && <HardwareManager />}
                  {activeTab === AdminTab.Themes && <ThemeSettings />}
                  {activeTab === AdminTab.PortalEditor && <PortalEditor />}
                  {activeTab === AdminTab.PPPoE && <PPPoEServer />}
                  {activeTab === AdminTab.Bandwidth && <BandwidthManager devices={devices} rates={rates} />}
                  {activeTab === AdminTab.MultiWan && <MultiWanSettings />}
                  {activeTab === AdminTab.Chat && <ChatManager />}
                  {activeTab === AdminTab.Machines && <MyMachines />}
                  {activeTab === AdminTab.Vouchers && <VoucherManager />}
                  {activeTab === AdminTab.SalesInventory && <SalesInventory sessions={salesSessions.length ? salesSessions : activeSessions} />}
                  {activeTab === AdminTab.Remote && <RemoteManager />}
                  {activeTab === AdminTab.Rewards && <RewardsSettings />}
                  {activeTab === AdminTab.System && <SystemSettings />}
                  {activeTab === AdminTab.Updater && <SystemUpdater />}
                </div>
                {/* Bottom Spacer for Mobile */}
                <div className="h-20 md:hidden" />
              </div>
            </main>
          </div>
        ) : (
          <Login 
            onLoginSuccess={(token) => {
              localStorage.setItem('ajc_admin_token', token);
              setIsAuthenticated(true);
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
    className={`sidebar-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
      disabled 
        ? 'sidebar-item-disabled opacity-20 cursor-not-allowed grayscale' 
        : active 
          ? 'sidebar-item-active bg-blue-600 text-white shadow-md shadow-blue-600/20' 
          : 'sidebar-item-default text-slate-400 hover:bg-white/5 hover:text-white'
    } ${collapsed ? 'sidebar-item-collapsed justify-center' : 'justify-start'}`}
  >
    <span className={`sidebar-icon text-lg ${active ? 'scale-110' : 'group-hover:scale-110'} transition-transform`}>{icon}</span>
    {!collapsed && <span className="sidebar-label uppercase tracking-wider text-[10px] font-bold">{label}</span>}
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

  const parseDate = (value: string) => new Date(value + 'T00:00:00');

  const enhancedSessions = useMemo(() => {
    const findSlotLabel = (slotKey: string) => {
      if (!slotKey || slotKey === 'main') return 'MAIN';
      const device = nodeMcuDevices.find(d => d.macAddress.toUpperCase() === slotKey.toUpperCase());
      if (device) return device.name || device.macAddress || slotKey;
      return slotKey;
    };

    return sessions.map((s) => {
      const rawCreatedAt = (s as any).connectedAt || (s as any).createdAt || new Date().toISOString();
      const createdAt = new Date(rawCreatedAt).toISOString();

      const type = 'coin';
      const slotKey = (s as any).coinSlot || 'main';
      const coinSlotLabel = findSlotLabel(slotKey);
      const mac = s.mac || (s as any).customer_mac || '';
      const account = (s as any).account || '';
      const customer = (s as any).customer || '';
      const device = (s as any).device || '';
      return {
        ...s,
        __createdAt: createdAt,
        __type: type,
        __coinSlotKey: slotKey as string,
        __coinSlotLabel: coinSlotLabel,
        __mac: mac as string,
        __account: account as string,
        __customer: customer as string,
        __device: device as string,
      };
    });
  }, [sessions, nodeMcuDevices]);

  const filtered = useMemo(() => {
    const from = parseDate(fromDate);
    const to = parseDate(toDate);
    const upperSearch = searchTerm.trim().toUpperCase();

    const rows: any[] = [...enhancedSessions];

    let result = rows.filter((s: any) => {
      const created = new Date(s.__createdAt);
      if (created < from || created > new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)) return false;
      if (typeFilter !== 'all' && s.__type !== typeFilter) return false;
      if (coinSlotFilter !== 'all' && s.__coinSlotKey !== coinSlotFilter) return false;
      if (upperSearch) {
        const mac = (s.__mac || '').toUpperCase();
        const account = (s.__account || '').toUpperCase();
        if (!mac.includes(upperSearch) && !account.includes(upperSearch)) return false;
      }
      return true;
    });

    result = result.sort((a: any, b: any) => {
      const da = new Date(a.__createdAt).getTime();
      const db = new Date(b.__createdAt).getTime();
      return showOldestFirst ? da - db : db - da;
    });

    return result;
  }, [enhancedSessions, nodeMcuDevices, fromDate, toDate, typeFilter, coinSlotFilter, searchTerm, showOldestFirst]);

  const totalSalesToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return enhancedSessions
      .filter((s: any) => {
        try {
          return new Date(s.__createdAt).toISOString().slice(0, 10) === today;
        } catch {
          return false;
        }
      })
      .reduce((sum: number, s: any) => sum + (s.totalPaid || 0), 0);
  }, [enhancedSessions]);

  const paginated = useMemo(() => filtered.slice(0, itemsPerPage), [filtered, itemsPerPage]);

  const uniqueCoinSlots = useMemo(() => {
    const map = new Map<string, string>();
    map.set('main', 'MAIN');
    nodeMcuDevices.forEach((d) => {
      map.set(d.macAddress, d.name || d.macAddress);
    });
    enhancedSessions.forEach((s: any) => {
      const key = s.__coinSlotKey;
      const label = s.__coinSlotLabel || key;
      if (key) {
        map.set(key, label);
      }
    });
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [nodeMcuDevices, enhancedSessions]);

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
        <div className="bg-white rounded-2xl px-5 py-3 shadow-sm border border-slate-100 flex items-baseline gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sales Today</span>
          <span className="text-2xl font-black text-emerald-600">
            ₱{totalSalesToday.toFixed(2)}
          </span>
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
              <option value="all">All Coinslots</option>
              {uniqueCoinSlots.map((slot) => (
                <option key={slot.key} value={slot.key}>{slot.label}</option>
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
                <th className="px-4 py-2 text-left font-bold">Customer</th>
                <th className="px-4 py-2 text-left font-bold">Device</th>
                <th className="px-4 py-2 text-left font-bold">MAC</th>
                <th className="px-4 py-2 text-left font-bold">Account / Phone</th>
                <th className="px-4 py-2 text-left font-bold">Date</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-[11px] text-slate-400">
                    Walang nahanap na sales sa napiling filter.
                  </td>
                </tr>
              )}
              {paginated.map((s: any, idx: number) => (
                <tr
                  key={(s.mac || s.__mac || 'row') + idx}
                  className="border-b border-slate-50 hover:bg-slate-50/60"
                >
                  <td className="px-4 py-2 font-semibold text-slate-800">
                    ₱{(s.totalPaid || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-[11px] font-semibold">
                    {s.__type === 'coin' && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Coin</span>}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-slate-700">{s.__coinSlot}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-700">{s.__customer || 'N/A'}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-700">{s.__device || 'N/A'}</td>
                  <td className="px-4 py-2 text-[11px] font-mono text-slate-700">{s.__mac || 'N/A'}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-700">{s.__account || 'N/A'}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-600">
                    {new Date(s.__createdAt).toLocaleString()}
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
