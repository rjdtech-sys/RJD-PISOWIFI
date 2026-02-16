import React, { useState, useEffect } from 'react';
import { AdminTab, UserSession, Rate, WifiDevice } from './types';
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
  const [activeTab, setActiveTab] = useState<AdminTab>(AdminTab.Analytics);
  const [licenseStatus, setLicenseStatus] = useState<{ isLicensed: boolean, isRevoked: boolean, canOperate: boolean }>({ isLicensed: true, isRevoked: false, canOperate: true });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rates, setRates] = useState<Rate[]>([]);
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
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
          setActiveTab(AdminTab.System);
        }
      } catch (e) {
        console.warn('Failed to fetch license status');
      }

      const [fetchedRates, sessions, fetchedDevices] = await Promise.all([
        apiClient.getRates(),
        apiClient.getSessions().catch(() => []),
        apiClient.getWifiDevices().catch(() => [])
      ]);
      setRates(fetchedRates);
      setActiveSessions(sessions);
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
        const fetchedDevices = await apiClient.getWifiDevices();
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
      setLoading(true);

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
        await loadData();
        // Show connection message to user
        if (data.message) {
          alert('✅ ' + data.message);
        } else {
          alert('✅ Internet access granted! Connection should activate automatically.');
        }
        
        // Try to help the connection by forcing a page reload after a short delay
        setTimeout(() => {
          if (window.location.pathname === '/') {
            window.location.reload();
          }
        }, 2000);
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
      setLoading(false);
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
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Analytics} onClick={() => setActiveTab(AdminTab.Analytics)} icon="📊" label="Dashboard" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Rates} onClick={() => setActiveTab(AdminTab.Rates)} icon="💰" label="Pricing" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Network} onClick={() => setActiveTab(AdminTab.Network)} icon="🌐" label="Network" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Devices} onClick={() => setActiveTab(AdminTab.Devices)} icon="📱" label="Devices" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Hardware} onClick={() => setActiveTab(AdminTab.Hardware)} icon="🔌" label="Hardware" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Themes} onClick={() => setActiveTab(AdminTab.Themes)} icon="🎨" label="Themes" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.PortalEditor} onClick={() => setActiveTab(AdminTab.PortalEditor)} icon="🖥️" label="Portal" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.PPPoE} onClick={() => setActiveTab(AdminTab.PPPoE)} icon="📞" label="PPPoE" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Bandwidth} onClick={() => setActiveTab(AdminTab.Bandwidth)} icon="📶" label="QoS" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.MultiWan} onClick={() => setActiveTab(AdminTab.MultiWan)} icon="🔀" label="Multi-WAN" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Chat} onClick={() => setActiveTab(AdminTab.Chat)} icon="💬" label="Chat" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Machines} onClick={() => setActiveTab(AdminTab.Machines)} icon="🤖" label="Machines" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Vouchers} onClick={() => setActiveTab(AdminTab.Vouchers)} icon="🎟️" label="Vouchers" collapsed={!sidebarOpen} />
                <SidebarItem active={activeTab === AdminTab.System} onClick={() => setActiveTab(AdminTab.System)} icon="⚙️" label="System" collapsed={!sidebarOpen} />
                <SidebarItem disabled={licenseStatus.isRevoked} active={activeTab === AdminTab.Updater} onClick={() => setActiveTab(AdminTab.Updater)} icon="🚀" label="Updater" collapsed={!sidebarOpen} />
              </nav>

              <div className={`admin-sidebar-footer p-4 border-t border-white/5 bg-black/20 ${sidebarOpen ? 'block' : 'hidden md:block'}`}>
                 <div className="flex flex-col gap-3">
                   <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      {sidebarOpen && <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">v3.4.0-beta.1 ONLINE</span>}
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
                  {activeTab === AdminTab.Analytics && <Analytics sessions={activeSessions} />}
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

export default App;
