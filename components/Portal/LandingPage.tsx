import React, { useState, useEffect } from 'react';
import { Rate, UserSession } from '../../types';
import CoinModal from './CoinModal';
import ChatWidget from './ChatWidget';
import VoucherActivation from './VoucherActivation';
import { apiClient } from '../../lib/api';
import { getPortalConfig, fetchPortalConfig, PortalConfig, DEFAULT_PORTAL_CONFIG } from '../../lib/theme';
import { voucherService } from '../../lib/voucher-service';

// Add refreshSessions prop to Props interface
interface Props {
  rates: Rate[];
  sessions: UserSession[];
  onSessionStart: (session: UserSession) => void;
  refreshSessions?: () => void;
  onRestoreSession?: () => void;
}

const LandingPage: React.FC<Props> = ({ rates, sessions, onSessionStart, refreshSessions, onRestoreSession }) => {
  const [showModal, setShowModal] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [myMac, setMyMac] = useState('');
  const [isMacLoading, setIsMacLoading] = useState(true);
  const [clientIp, setClientIp] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [availableSlots, setAvailableSlots] = useState<{id: string, name: string, macAddress: string, isOnline: boolean, license?: { isValid: boolean, isTrial: boolean, isExpired: boolean }}[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>('main');
  const [slotError, setSlotError] = useState<string | null>(null);
  const [canInsertCoin, setCanInsertCoin] = useState(true);
  const [isRevoked, setIsRevoked] = useState(false);
  const [coinSlotLockId, setCoinSlotLockId] = useState<string | null>(null);
  const [reservedSlot, setReservedSlot] = useState<string | null>(null);
  const [isVoucherLoading, setIsVoucherLoading] = useState<boolean>(false);

  // Hardcoded default rates in case the API fetch returns nothing
  const defaultRates: Rate[] = [
    { id: '1', pesos: 1, minutes: 10 },
    { id: '5', pesos: 5, minutes: 60 },
    { id: '10', pesos: 10, minutes: 180 }
  ];

  const activeRates = (rates && rates.length > 0) ? rates : defaultRates;

  // Get fallback ID immediately without waiting for server
  const getFallbackId = () => {
    const storageKey = 'ajc_client_id';
    let id = localStorage.getItem(storageKey);
    if (!id) {
      id = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      localStorage.setItem(storageKey, id);
    }
    return id;
  };

  const setCookie = (name: string, value: string, days: number) => {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  };

  const getCookie = (name: string): string | null => {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  };

  useEffect(() => {
    // Load Portal Configuration
    const loadConfig = async () => {
      const cfg = await fetchPortalConfig();
      setConfig(cfg);
    };
    loadConfig();

    // Load Available Coinslots
    const loadAvailableSlots = async () => {
      try {
        const slots = await apiClient.getAvailableNodeMCUDevices();
        setAvailableSlots(slots);
      } catch (e) {
        console.error('Failed to load available coinslots');
      }
    };
    loadAvailableSlots();

    // Set fallback ID immediately so UI can render
    const fallbackId = getFallbackId();
    setMyMac(fallbackId);
    setCookie('ajc_client_id', fallbackId, 365);
    setIsMacLoading(false);
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host) {
        setClientIp(host);
      }
    }

    // Try to get real MAC in background without blocking UI
    const fetchWhoAmI = async () => {
      try {
        const data = await apiClient.whoAmI();
        if (data.mac && data.mac !== 'unknown') {
          setMyMac(data.mac);
        }
        if (data.ip) {
          setClientIp(data.ip);
        }
        setCanInsertCoin(data.canInsertCoin !== false);
        setIsRevoked(data.isRevoked === true);
      } catch (e) {
        console.error('Failed to identify client');
      }
    };
    
    // Only fetch if we have a valid IP (not localhost)
    if (!window.location.hostname.includes('localhost')) {
      fetchWhoAmI();
    }
  }, []);

  const sessionToken = typeof window !== 'undefined' ? (getCookie('ajc_session_token') || localStorage.getItem('ajc_session_token')) : null;
  const mySession = sessionToken 
    ? sessions.find(s => s.token === sessionToken) 
    : sessions.find(s => s.mac === myMac);

  useEffect(() => {
    let interval: any = null;
    if (onRestoreSession) {
      interval = setInterval(() => {
        const token = localStorage.getItem('ajc_session_token');
        if (token && !mySession) {
          onRestoreSession();
        }
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [onRestoreSession, mySession]);

  const handleOpenModal = async (e: React.MouseEvent) => {
    e.preventDefault();
    setSlotError(null);

    if (!canInsertCoin) {
      setSlotError("System License Revoked: Only 1 device can use the insert coin button at a time. Another device is currently active.");
      return;
    }

    if (selectedSlot !== 'main') {
      const slot = availableSlots.find(s => s.macAddress === selectedSlot);
      if (slot && !slot.isOnline) {
        setSlotError(`The machine "${slot.name}" is OFFLINE. Please tell the owner to restart it.`);
        return;
      }
      
      // Double check status with API for selected slot
      try {
        const status = await apiClient.checkNodeMCUStatus(selectedSlot);
        if (!status.online) {
          setSlotError(`The machine "${slot?.name || 'Sub-Vendo'}" is OFFLINE. Please tell the owner to restart it.`);
          return;
        }
        
        // License Check
        if (status.license && !status.license.isValid) {
          setSlotError('YOUR COINSLOT MACHINE IS DISABLED');
          return;
        }
      } catch (err) {
        console.error('Status check failed');
      }
    }

    const reserve = await apiClient.reserveCoinSlot(selectedSlot);
    if (!reserve.success || !reserve.lockId) {
      if (reserve.status === 409) {
        setSlotError(reserve.error || 'JUST WAIT SOMEONE IS PAYING.');
        return;
      }
      setSlotError(reserve.error || 'Failed to open coinslot. Please try again.');
      return;
    }

    setReservedSlot(selectedSlot);
    setCoinSlotLockId(reserve.lockId);
    setShowModal(true);
  };

  const handleCloseModal = async () => {
    if (reservedSlot && coinSlotLockId) {
      await apiClient.releaseCoinSlot(reservedSlot, coinSlotLockId).catch(() => {});
    }
    setShowModal(false);
    setReservedSlot(null);
    setCoinSlotLockId(null);
  };

  const handleGoToInternet = () => {
    // Navigate to success page which will trigger captive portal exit
    window.location.href = '/success';
  };

  const handlePause = async () => {
    if (!mySession || !mySession.token) return;
    try {
      const result = await apiClient.pauseSession(mySession.token);
      if (result.success) {
        if (refreshSessions) refreshSessions();
      } else {
        alert('Pause failed: ' + result.message);
      }
    } catch (err) {
      alert('Error pausing session: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleResume = async () => {
    if (!mySession || !mySession.token) return;
    try {
      const result = await apiClient.resumeSession(mySession.token);
      if (result.success) {
        if (refreshSessions) refreshSessions();
        
        // Proactive network refresh after resume
        setTimeout(async () => {
          try {
            // Trigger a probe request to help the OS recognize internet is back
            await fetch('http://connectivitycheck.gstatic.com/generate_204', { mode: 'no-cors' }).catch(() => {});
            // Also try a common domain
            await fetch('http://1.1.1.1', { mode: 'no-cors' }).catch(() => {});
          } catch (e) {}
        }, 1000);
      } else {
        alert('Resume failed: ' + result.message);
      }
    } catch (err) {
      alert('Error resuming session: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleVoucherActivate = async (voucherCode: string) => {
    setIsVoucherLoading(true);
    try {
      // Use the voucher service for activation
      const data = await voucherService.activateVoucher(voucherCode);
      
      if (data.success) {
        // Show success message
        const successMessage = data.message || 'Voucher activated successfully!';
        
        // Save the token for session restoration
        if (data.token) {
          localStorage.setItem('ajc_session_token', data.token);
        }
        
        // Refresh sessions to show the new session
        if (refreshSessions) {
          refreshSessions();
        }
        
        // Show success feedback
        alert('✅ ' + successMessage);
        
        // Try to help the connection by forcing a page reload after a short delay
        setTimeout(() => {
          if (window.location.pathname === '/') {
            window.location.reload();
          }
        }, 2000);
      }
    } catch (error) {
      // Show error feedback
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert('❌ Failed to activate voucher: ' + errorMessage);
    } finally {
      setIsVoucherLoading(false);
    }
  };

  // Play success audio when session becomes active
  useEffect(() => {
    if (mySession && mySession.remainingSeconds > 0 && config.connectedAudio) {
      // Only play if we haven't just refreshed the page (optional logic, but for now simple is better)
      // Check if we just started this session recently (e.g. within last 10 seconds)
      const isNewSession = (Date.now() - mySession.connectedAt) < 10000;
      
      if (isNewSession) {
        try {
          console.log('Playing Connected Audio...');
          const audio = new Audio(config.connectedAudio);
          audio.play().catch(e => console.log('Connected audio play failed', e));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, [mySession, config.connectedAudio]);

  const handleRefreshNetwork = async () => {
    setIsRefreshing(true);
    try {
      // Client-side network refresh attempts
      console.log('Attempting client-side network refresh...');
      
      // Method 1: Force browser to re-resolve DNS by clearing DNS cache
      try {
        // Clear browser's DNS cache by making requests to different domains
        const testUrls = ['http://1.1.1.1', 'http://8.8.8.8', 'http://google.com'];
        for (const url of testUrls) {
          try {
            await fetch(url, { mode: 'no-cors', cache: 'reload' });
          } catch (e) {
            // Ignore errors, just trying to force DNS resolution
          }
        }
      } catch (e) {
        console.log('DNS refresh failed:', e);
      }
      
      // Method 2: Clear browser cache for this domain
      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
          console.log('Browser cache cleared');
        } catch (e) {
          console.log('Cache clear failed:', e);
        }
      }
      
      // Method 3: Force page reload with cache bypass
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
      // Method 4: Server-side network refresh
      const result = await apiClient.refreshNetworkConnection();
      if (result.success) {
        alert('✅ Network connection refreshed! The page will reload automatically.');
        // Also refresh session data
        if (refreshSessions) {
          refreshSessions();
        }
      } else {
        alert('⚠️ Network refresh failed: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Network refresh error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatSessionTime = (seconds: number) => {
    if (seconds >= 86400) { // 24 hours or more
      const days = Math.floor(seconds / 86400);
      const remainingSeconds = seconds % 86400;
      const hours = Math.floor(remainingSeconds / 3600);
      const mins = Math.floor((remainingSeconds % 3600) / 60);
      const secs = remainingSeconds % 60;
      
      return (
        <>
          {days}<span className="text-2xl">d</span> {hours}<span className="text-2xl">h</span> {mins}<span className="text-2xl">m</span> {secs}<span className="text-2xl">s</span>
        </>
      );
    }
    
    if (seconds >= 3600) { // 60 minutes or more
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      
      return (
        <>
          {hours}<span className="text-2xl">h</span> {mins}<span className="text-2xl">m</span> {secs}<span className="text-2xl">s</span>
        </>
      );
    }
    
    // Default: minutes and seconds
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    return (
      <>
        {mins}<span className="text-2xl">m</span> {secs}<span className="text-2xl">s</span>
      </>
    );
  };

  return (
    <div className="portal-container min-h-screen" style={{ backgroundColor: config.backgroundColor, color: config.textColor }}>
      {/* Inject Custom CSS */}
      {config.customCss && <style dangerouslySetInnerHTML={{ __html: config.customCss }} />}
      
      <header 
        className="portal-header"
        style={{ 
          background: `linear-gradient(135deg, ${config.primaryColor} 0%, ${config.secondaryColor} 100%)`,
          color: '#ffffff'
        }}
      >
        <div className="relative z-10">
          <h1 className="text-3xl font-black tracking-tighter mb-1 uppercase">{config.title}</h1>
          <p className="text-xs font-bold opacity-80 uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.9)' }}>{config.subtitle}</p>
        </div>
      </header>

      {/* Inject Custom HTML Top */}
      {config.customHtmlTop && (
        <div 
          className="portal-custom-html-top" 
          dangerouslySetInnerHTML={{ __html: config.customHtmlTop }} 
        />
      )}

      <main className="relative z-20">
        <div className="portal-card">
          {mySession ? (
            <div className="mb-6 animate-in fade-in zoom-in duration-500">
              <p className="text-blue-600 text-[10px] font-black uppercase tracking-[0.2em] mb-2">Authenticated Session</p>
              <h2 className={`text-6xl font-black mb-4 tracking-tighter ${mySession.isPaused ? 'text-orange-500 animate-pulse' : 'text-slate-900'}`}>
                {formatSessionTime(mySession.remainingSeconds)}
              </h2>
              <div className="flex flex-col gap-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">
                {mySession.isPaused ? (
                  <span className="text-orange-500 font-black flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                    Time Paused - Internet Suspended
                  </span>
                ) : (
                  <span className="text-green-500 font-black flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                    Internet Access Live
                  </span>
                )}
                <span>Device MAC: {myMac}</span>
              </div>
              
              {!mySession.isPaused ? (
                <>
                  <button 
                    onClick={handleGoToInternet}
                    className="admin-btn-primary w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest mb-3 shadow-xl active:scale-95 flex items-center justify-center gap-2"
                  >
                    <span>🌍</span> PROCEED TO INTERNET
                  </button>
                  
                  <button 
                    onClick={handlePause}
                    className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest mb-3 shadow-xl hover:bg-orange-600 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <span>⏸️</span> PAUSE MY TIME
                  </button>
                </>
              ) : (
                <button 
                  onClick={handleResume}
                  className="w-full bg-green-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest mb-3 shadow-xl hover:bg-green-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>▶️</span> RESUME MY TIME
                </button>
              )}
              
              <button 
                onClick={handleRefreshNetwork}
                disabled={isRefreshing}
                className="w-full bg-blue-600 text-white py-3 rounded-2xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isRefreshing ? '⟳' : '🔄'}</span> 
                {isRefreshing ? 'REFRESHING...' : 'REFRESH CONNECTION'}
              </button>
            </div>
          ) : (
            <div className="mb-4">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📡</div>
              <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight text-center">Insert Coins to Connect</h2>
              <p className="text-slate-500 text-xs mb-4 font-medium px-6 text-center">
                1. Tap INSERT COIN. 2. Drop coins. 3. Tap START SURFING.
              </p>
            </div>
          )}

          <div className="mx-6 mb-6 text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em] text-center">
            <div>Device IP: {clientIp || 'Detecting...'}</div>
            <div>Device MAC: {isMacLoading ? 'Detecting...' : myMac}</div>
          </div>

          {isRevoked && (
            <div className="mx-6 mb-6 p-4 bg-orange-50 border border-orange-100 rounded-2xl text-orange-600 text-center animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="text-xl mb-1">🛡️</div>
              <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
                System License Revoked: Limited Service Mode Active
              </p>
            </div>
          )}

          {availableSlots.length > 0 && (
            <div className="px-8 mb-6">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 text-center">
                Select Coinslot Location
              </label>
              <div className="relative">
                <select
                  value={selectedSlot}
                  onChange={(e) => setSelectedSlot(e.target.value)}
                  className="w-full appearance-none bg-white border-2 border-slate-100 rounded-xl py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-700 focus:outline-none focus:border-blue-600 focus:ring-0 transition-all"
                >
                  <option value="main">🏠 Main Machine</option>
                  {availableSlots.map(slot => (
                    <option key={slot.id} value={slot.macAddress} disabled={slot.license && !slot.license.isValid}>
                      {slot.license && !slot.license.isValid ? '🔒' : (slot.isOnline ? '🟢' : '🔴')} {slot.name} {slot.license && !slot.license.isValid ? '(DISABLED)' : ''}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {slotError && (
            <div className="mx-6 mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-center animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="text-xl mb-1">⚠️</div>
              <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
                {slotError}
              </p>
            </div>
          )}

          <button onClick={handleOpenModal} className="portal-btn">
            {mySession ? 'ADD MORE TIME' : 'INSERT COIN'}
          </button>
          <button
            onClick={() => setShowRatesModal(true)}
            className="portal-btn mt-3"
          >
            View Rates
          </button>
          
          {!mySession && onRestoreSession && (
            <button 
              onClick={onRestoreSession}
              className="mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors"
            >
              Lost Connection? Restore Session
            </button>
          )}
        </div>

        <VoucherActivation onVoucherActivate={handleVoucherActivate} loading={isVoucherLoading} />
      </main>

      {/* Inject Custom HTML Bottom */}
      {config.customHtmlBottom && (
        <div 
          className="portal-custom-html-bottom" 
          dangerouslySetInnerHTML={{ __html: config.customHtmlBottom }} 
        />
      )}

      <footer className="mt-12 text-center pb-10 flex flex-col items-center gap-4">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 opacity-50">
          Powered by AJC PisoWifi System
        </p>
      </footer>

      {showRatesModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-in zoom-in duration-300 shadow-2xl border border-slate-200">
            <div className="p-6 bg-slate-50 border-b border-slate-100 text-center">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Pricing & Rates</h3>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em]">
                Based on current pricing configuration
              </p>
            </div>
            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {activeRates.sort((a, b) => a.pesos - b.pesos).map((rate) => (
                <div
                  key={rate.id}
                  className="flex items-center justify-between bg-white rounded-2xl border border-slate-100 px-4 py-3"
                >
                  <div>
                    <span className="block text-sm font-black text-slate-900">₱{rate.pesos}</span>
                    <span className="block text-[9px] font-black uppercase tracking-[0.2em] text-blue-600">
                      {rate.minutes >= 60
                        ? `${Math.floor(rate.minutes / 60)}h ${
                            rate.minutes % 60 > 0 ? (rate.minutes % 60) + 'm' : ''
                          }`
                        : `${rate.minutes} Minutes`}
                    </span>
                  </div>
                </div>
              ))}
              {activeRates.length === 0 && (
                <div className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  No rates available
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 text-center">
              <button
                onClick={() => setShowRatesModal(false)}
                className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <CoinModal 
          onClose={handleCloseModal}
          audioSrc={config.coinDropAudio}
          insertCoinAudioSrc={config.insertCoinAudio}
          selectedSlot={selectedSlot}
          coinSlot={reservedSlot || selectedSlot}
          coinSlotLockId={coinSlotLockId || undefined}
          onSuccess={(pesos, minutes) => {
            onSessionStart({
              mac: myMac,
              remainingSeconds: minutes * 60,
              totalPaid: pesos,
              connectedAt: Date.now(),
              coinSlot: reservedSlot || selectedSlot,
              coinSlotLockId: coinSlotLockId || undefined
              // Don't send IP - server will detect it
            });
            setShowModal(false);
            setReservedSlot(null);
            setCoinSlotLockId(null);
          }}
          rates={activeRates}
        />
      )}
      <ChatWidget mac={myMac} />
    </div>
  );
};

export default LandingPage;
