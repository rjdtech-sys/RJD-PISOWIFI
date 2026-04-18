import React, { useState, useEffect } from 'react';
import { BoardType, CoinSlotConfig, NodeMCUDevice } from '../../types';
import { apiClient } from '../../lib/api';
import { 
  Save, 
  Cpu,
  Monitor,
  Wifi,
  CheckCircle,
  Edit2
} from 'lucide-react';
import opiPinout from '../../lib/opi_pinout';
import rpiPinout from '../../lib/rpi_pinout';
import NodeMCUManager from './NodeMCUManager';

const opiPinoutModule: any = opiPinout as any;
const opiMappings: Record<string, { name?: string; pins: Record<number, number> }> = opiPinoutModule?.mappings || {};
const ORANGE_PI_MODELS = ['orange_pi_one', 'orange_pi_zero_3', 'orange_pi_pc', 'orange_pi_5'];
const ORANGE_PI_DEFAULT_MODEL = 'orange_pi_one';

const rpiPinoutModule: any = rpiPinout as any;
const rpiMappings: Record<string, { name?: string; pins: Record<number, number> }> = rpiPinoutModule?.mappings || {};
const RASPBERRY_PI_MODELS = ['raspberry_pi_4b', 'raspberry_pi_2b_3b', 'raspberry_pi_5', 'raspberry_pi_zero'];
const RASPBERRY_PI_DEFAULT_MODEL = 'raspberry_pi_4b';

const HardwareManager: React.FC = () => {
  const [board, setBoard] = useState<BoardType>('none');
  const [pin, setPin] = useState(2);
  const [boardModel, setBoardModel] = useState<string>('orange_pi_one');
  const [rpiBoardModel, setRpiBoardModel] = useState<string>('raspberry_pi_4b');
  const [relayPin, setRelayPin] = useState<number | null>(null);
  const [relayActiveMode, setRelayActiveMode] = useState<'high' | 'low'>('high');
  
  const [coinSlots, setCoinSlots] = useState<CoinSlotConfig[]>([]);
  const [nodemcuDevices, setNodemcuDevices] = useState<NodeMCUDevice[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const [lastCoinsOutStats, setLastCoinsOutStats] = useState<{lastCoinsOutGross: number, lastCoinsOutNet: number, lastCoinsOutDate: string} | null>(null);
  const [showCoinsOutModal, setShowCoinsOutModal] = useState(false);
  const [coinsOutProcessing, setCoinsOutProcessing] = useState(false);
  const [coinsOutSharePercent, setCoinsOutSharePercent] = useState<string>('');
  const [mainRevenue, setMainRevenue] = useState<number>(0);

  useEffect(() => {
    loadConfig();
    loadNodemcuDevices();
    loadMainRevenue();
    
    // Attempt to load last coins out stats from localStorage as fallback
    // Ensures stats persist even after browser refresh
    const savedStats = localStorage.getItem('main_coins_out_stats');
    if (savedStats) {
        try {
            setLastCoinsOutStats(JSON.parse(savedStats));
        } catch (e) {}
    }

    // Refresh device list periodically
    const interval = setInterval(() => {
      loadNodemcuDevices();
      loadMainRevenue();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadMainRevenue = async () => {
    try {
      const [history, config] = await Promise.all([
        apiClient.getSalesHistory(),
        apiClient.getConfig() // We need to check if we can get the specific config key
      ]);
      
      // We need to fetch the specific config key 'main_coins_out_stats'
       // apiClient.getConfig returns the whole system config object defined in types.
       // But 'main_coins_out_stats' might not be in SystemConfig type or the main config endpoint return.
       // We might need a direct way to get this or rely on localStorage/state.
       // Actually, let's use the local state 'lastCoinsOutStats' if available, or try to find it in localStorage.
       
       let lastDate = null;
       
       // Try from API config first (robust against cache clearing)
       if (config && (config as any).mainCoinsOutStats) {
           const stats = (config as any).mainCoinsOutStats;
           if (stats.lastCoinsOutDate) {
               lastDate = new Date(stats.lastCoinsOutDate);
               // Ensure UI state is in sync with backend
               setLastCoinsOutStats(stats);
           }
       }

       // Fallback to localStorage if not found in config
       if (!lastDate) {
           const savedStats = localStorage.getItem('main_coins_out_stats');
           if (savedStats) {
              try {
                  const parsed = JSON.parse(savedStats);
                  if (parsed.lastCoinsOutDate) lastDate = new Date(parsed.lastCoinsOutDate);
              } catch(e) {}
           }
       }
       
       if (Array.isArray(history)) {
        // Filter for main machine sales
        const mainSales = history.filter((s: any) => 
          (s.machine_id === 'main' || !s.machine_id) && 
          s.transaction_type !== 'coins_out' &&
          s.type !== 'coins_out'
        );
        
        let filteredSales = mainSales;
        
        // If we have a last coins out date, filter sales after that date
        if (lastDate) {
            filteredSales = mainSales.filter((s: any) => {
                const d = new Date(s.timestamp || s.created_at);
                return d > lastDate;
            });
        }
        
        // If no last date, we default to ALL time or maybe this month?
        // NodeMCU logic is "Lifetime" until reset.
        // So if no last date, we take ALL main sales.
        
        const total = filteredSales.reduce((acc, s) => acc + (s.amount || 0), 0);
        setMainRevenue(total);
      }
    } catch (e) {
      console.error('Failed to load main revenue');
    }
  };

  const handleCoinsOut = async () => {
    setCoinsOutProcessing(true);
    try {
      const gross = mainRevenue;
      const parsedSharePercent = parseFloat(coinsOutSharePercent || '0');
      const safeSharePercent = isNaN(parsedSharePercent) ? 0 : parsedSharePercent;
      const shareAmount = gross * (safeSharePercent / 100);
      const net = gross - shareAmount;
      
      const stats = {
        gross,
        net,
        date: new Date().toISOString()
      };

      await apiClient.saveMainCoinsOut(stats);
      
      setLastCoinsOutStats({
        lastCoinsOutGross: gross,
        lastCoinsOutNet: net,
        lastCoinsOutDate: stats.date
      });
      
      localStorage.setItem('main_coins_out_stats', JSON.stringify({
        lastCoinsOutGross: gross,
        lastCoinsOutNet: net,
        lastCoinsOutDate: stats.date
      }));

      setShowCoinsOutModal(false);
      setCoinsOutSharePercent('');
      loadMainRevenue(); // Refresh revenue
    } catch (err) {
      console.error('Coins Out failed', err);
      alert('Failed to save coins out record');
    } finally {
      setCoinsOutProcessing(false);
    }
  };

  useEffect(() => {
    if (board !== 'orange_pi') return;
    const modelKey = boardModel || ORANGE_PI_DEFAULT_MODEL;
    const pinsMap = opiMappings[modelKey]?.pins || {};
    const physicalPins = Object.keys(pinsMap).map(p => parseInt(p, 10)).sort((a, b) => a - b);
    if (physicalPins.length === 0) return;
    if (!physicalPins.includes(pin)) {
      setPin(physicalPins[0]);
    }
  }, [board, boardModel, pin]);

  useEffect(() => {
    if (board !== 'raspberry_pi') return;
    const modelKey = rpiBoardModel || RASPBERRY_PI_DEFAULT_MODEL;
    const pinsMap = rpiMappings[modelKey]?.pins || {};
    const physicalPins = Object.keys(pinsMap).map(p => parseInt(p, 10)).sort((a, b) => a - b);
    if (physicalPins.length === 0) return;
    if (!physicalPins.includes(pin)) {
      setPin(physicalPins[0]);
    }
  }, [board, rpiBoardModel, pin]);

  const isOrangePi = board === 'orange_pi';
  const isRaspberryPi = board === 'raspberry_pi';
  const isX64 = board === 'x64_pc';

  const currentOrangeModelKey = boardModel || ORANGE_PI_DEFAULT_MODEL;
  const currentOrangePinsMap = opiMappings[currentOrangeModelKey]?.pins || {};
  const currentOrangePins = Object.keys(currentOrangePinsMap)
    .map(p => parseInt(p, 10))
    .sort((a, b) => a - b);

  const getOrangeGpioLabel = (physicalPin: number) => {
    const gpio = currentOrangePinsMap[physicalPin];
    if (typeof gpio !== 'number') return '';
    return `GPIO ${gpio}`;
  };

  const orangeGpioForSelectedPin = isOrangePi ? currentOrangePinsMap[pin] : undefined;

  const boardModelLabel = isOrangePi && currentOrangeModelKey
    ? (opiMappings[currentOrangeModelKey]?.name || currentOrangeModelKey.replace(/_/g, ' '))
    : null;

  // Raspberry Pi pin mapping
  const currentRpiModelKey = rpiBoardModel || RASPBERRY_PI_DEFAULT_MODEL;
  const currentRpiPinsMap = rpiMappings[currentRpiModelKey]?.pins || {};
  const currentRpiPins = Object.keys(currentRpiPinsMap)
    .map(p => parseInt(p, 10))
    .sort((a, b) => a - b);

  const getRpiGpioLabel = (physicalPin: number) => {
    const gpio = currentRpiPinsMap[physicalPin];
    if (typeof gpio !== 'number') return '';
    return `BCM ${gpio}`;
  };

  const rpiGpioForSelectedPin = isRaspberryPi ? currentRpiPinsMap[pin] : undefined;

  const rpiModelLabel = isRaspberryPi && currentRpiModelKey
    ? (rpiMappings[currentRpiModelKey]?.name || currentRpiModelKey.replace(/_/g, ' '))
    : null;

  const parsedSharePercent = parseFloat(coinsOutSharePercent || '0');
  const safeSharePercent = isNaN(parsedSharePercent) ? 0 : parsedSharePercent;
  const coinsOutShareAmount = mainRevenue * (safeSharePercent / 100);
  const coinsOutNetIncome = mainRevenue - coinsOutShareAmount;

  const loadConfig = async () => {
    try {
      const cfg = await apiClient.getConfig();
      setBoard(cfg.boardType);
      setPin(cfg.coinPin);
      if (cfg.boardModel) setBoardModel(cfg.boardModel);
      if (cfg.boardType === 'raspberry_pi' && cfg.boardModel) {
        setRpiBoardModel(cfg.boardModel);
      }
      if (typeof cfg.relayPin === 'number') {
        setRelayPin(cfg.relayPin);
      }
      if (cfg.relayActiveMode === 'low' || cfg.relayActiveMode === 'high') {
        setRelayActiveMode(cfg.relayActiveMode);
      }

      if (cfg.coinSlots && cfg.coinSlots.length > 0) {
        setCoinSlots(cfg.coinSlots);
      }

      // Backward compatibility: if Raspberry Pi coinPin is a BCM GPIO number (not a physical pin), convert it
      if (cfg.boardType === 'raspberry_pi') {
        const modelKey = cfg.boardModel || RASPBERRY_PI_DEFAULT_MODEL;
        const pinsMap = rpiMappings[modelKey]?.pins || {};
        const physicalPins = Object.keys(pinsMap).map(p => parseInt(p, 10));
        if (!physicalPins.includes(cfg.coinPin)) {
          // coinPin is a BCM GPIO number, find the corresponding physical pin
          if (rpiPinoutModule?.bcmToPhysicalPin) {
            const physPin = rpiPinoutModule.bcmToPhysicalPin(modelKey, cfg.coinPin);
            if (physPin) setPin(physPin);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load hardware config');
    } finally {
      setLoading(false);
    }
  };

  const loadNodemcuDevices = async () => {
    try {
      const devices = await apiClient.getNodeMCUDevices();
      setNodemcuDevices(devices);
    } catch (e) {
      console.error('Failed to load NodeMCU devices');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      await apiClient.saveConfig({ 
        boardType: board, 
        coinPin: pin,
        boardModel: (board === 'orange_pi' || board === 'raspberry_pi') ? (board === 'orange_pi' ? boardModel : rpiBoardModel) : null,
        coinSlots: coinSlots,
        relayPin: board === 'none' || board === 'nodemcu_esp' || board === 'x64_pc' ? null : relayPin,
        relayActiveMode: relayPin != null ? relayActiveMode : 'high'
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      alert('Failed to save hardware configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="p-12 text-center text-slate-400 text-xs font-black uppercase tracking-widest animate-pulse">
      Probing Hardware Bus...
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-4 animate-in fade-in duration-500 pb-20">
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Hardware Architecture (Legacy/Main Board) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
             <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
               <Cpu size={14} className="text-slate-700" /> Main Controller
             </h3>
             <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Hardware Selection</span>
          </div>
          <div className="p-4 space-y-4">
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button 
                  onClick={() => setBoard('raspberry_pi')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${board === 'raspberry_pi' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-wide mb-0.5">Raspberry Pi</div>
                  <div className="text-[9px] text-slate-500">BCM GPIO</div>
                </button>
                <button 
                  onClick={() => setBoard('orange_pi')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${board === 'orange_pi' ? 'border-orange-500 bg-orange-50' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-wide mb-0.5">Orange Pi</div>
                  <div className="text-[9px] text-slate-500">Physical Map</div>
                </button>
                
                <button 
                  onClick={() => setBoard('x64_pc')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${board === 'x64_pc' ? 'border-green-600 bg-green-50' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-wide mb-0.5">x64 PC</div>
                  <div className="text-[9px] text-slate-500">Serial Bridge</div>
                </button>
                
                <button 
                  onClick={() => setBoard('none')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${board === 'none' ? 'border-slate-400 bg-slate-50' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-wide mb-0.5">Simulated</div>
                  <div className="text-[9px] text-slate-500">Virtual</div>
                </button>
             </div>
             {isOrangePi ? (
               <div className="space-y-4">
                 <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Board Model</label>
                   <select
                     value={currentOrangeModelKey}
                     onChange={(e) => setBoardModel(e.target.value)}
                     className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                   >
                     {ORANGE_PI_MODELS.map(modelKey => {
                       const label = (opiMappings[modelKey]?.name || modelKey.replace(/_/g, ' '));
                       return (
                         <option key={modelKey} value={modelKey}>
                           {label}
                         </option>
                       );
                     })}
                   </select>
                 </div>

                 <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                     <div className="flex-1">
                       <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Coin Pin (Main)</label>
                       <select
                         value={String(pin)}
                         onChange={(e) => setPin(parseInt(e.target.value, 10))}
                         className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                       >
                         {currentOrangePins.map(p => (
                           <option key={p} value={p}>
                             {`Pin ${p} (${getOrangeGpioLabel(p)})`}
                           </option>
                         ))}
                       </select>
                     </div>
                     <div className="flex-1">
                       <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Relay Pin (Output)</label>
                       <select
                         value={relayPin !== null ? String(relayPin) : ''}
                         onChange={(e) => {
                           const v = e.target.value;
                           setRelayPin(v ? parseInt(v, 10) : null);
                         }}
                         className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                       >
                         <option value="">Disabled</option>
                         {currentOrangePins.map(p => (
                           <option key={p} value={p}>
                             {`Pin ${p} (${getOrangeGpioLabel(p)})`}
                           </option>
                         ))}
                       </select>
                     </div>
                     <button
                       onClick={handleSave}
                       disabled={saving}
                       className="admin-btn-primary w-full sm:w-48 py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
                     >
                       <Save size={12} />
                       {saving ? 'Saving...' : 'Apply Config'}
                     </button>
                   </div>
                 </div>

                 <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="flex justify-between items-center mb-3">
                     <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Available Pins</div>
                     {currentOrangePins.length > 0 && (
                       <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                         {`Showing first ${Math.min(16, currentOrangePins.length)} of ${currentOrangePins.length} available pins`}
                       </div>
                     )}
                   </div>
                   <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                     {currentOrangePins.slice(0, 16).map(p => (
                       <button
                         key={p}
                         type="button"
                         onClick={() => setPin(p)}
                         className={`p-3 rounded-lg border text-left transition-all ${
                           pin === p
                             ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-sm'
                             : 'border-slate-200 text-slate-600 hover:border-slate-400'
                         }`}
                       >
                         <div className="text-[11px] font-black tracking-wide">P{p}</div>
                         <div className="text-[9px] text-slate-500">{getOrangeGpioLabel(p)}</div>
                       </button>
                     ))}
                   </div>
                 </div>
                 <div className="mt-3 flex flex-wrap items-center gap-3">
                   <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Relay Mode</span>
                   <div className="flex items-center gap-2 text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => setRelayActiveMode('high')}
                        className={`px-2 py-1 rounded border transition-all ${
                          relayActiveMode === 'high'
                            ? 'admin-btn-primary'
                            : 'border-slate-300 text-slate-600'
                        }`}
                      >
                        Active High
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelayActiveMode('low')}
                        className={`px-2 py-1 rounded border transition-all ${
                          relayActiveMode === 'low'
                            ? 'admin-btn-primary'
                            : 'border-slate-300 text-slate-600'
                        }`}
                      >
                        Active Low
                      </button>
                    </div>
                 </div>
               </div>
             ) : isX64 ? (
               <div className="flex flex-col sm:flex-row gap-4">
                 <div className="flex-1 bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">x64 PC Mode</div>
                   <p className="text-[10px] text-slate-600">
                     GPIO pin selection and relay output are disabled on x64 PC. This mode uses the serial or NodeMCU bridge for coinslot input.
                   </p>
                 </div>
                 <button
                   onClick={handleSave}
                   disabled={saving}
                   className="admin-btn-primary sm:w-48 py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
                 >
                   <Save size={12} />
                   {saving ? 'Saving...' : 'Apply Config'}
                 </button>
               </div>
             ) : isRaspberryPi ? (
               <div className="space-y-4">
                 <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Board Model</label>
                   <select
                     value={currentRpiModelKey}
                     onChange={(e) => setRpiBoardModel(e.target.value)}
                     className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                   >
                     {RASPBERRY_PI_MODELS.map(modelKey => {
                       const label = (rpiMappings[modelKey]?.name || modelKey.replace(/_/g, ' '));
                       return (
                         <option key={modelKey} value={modelKey}>
                           {label}
                         </option>
                       );
                     })}
                   </select>
                 </div>

                 <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                     <div className="flex-1">
                       <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Coin Pin (Main)</label>
                       <select
                         value={String(pin)}
                         onChange={(e) => setPin(parseInt(e.target.value, 10))}
                         className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                       >
                         {currentRpiPins.map(p => (
                           <option key={p} value={p}>
                             {`Pin ${p} (${getRpiGpioLabel(p)})`}
                           </option>
                         ))}
                       </select>
                     </div>
                     <div className="flex-1">
                       <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Relay Pin (Output)</label>
                       <select
                         value={relayPin !== null ? String(relayPin) : ''}
                         onChange={(e) => {
                           const v = e.target.value;
                           setRelayPin(v ? parseInt(v, 10) : null);
                         }}
                         className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                       >
                         <option value="">Disabled</option>
                         {currentRpiPins.map(p => (
                           <option key={p} value={p}>
                             {`Pin ${p} (${getRpiGpioLabel(p)})`}
                           </option>
                         ))}
                       </select>
                     </div>
                     <button
                       onClick={handleSave}
                       disabled={saving}
                       className="admin-btn-primary w-full sm:w-48 py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
                     >
                       <Save size={12} />
                       {saving ? 'Saving...' : 'Apply Config'}
                     </button>
                   </div>
                 </div>

                 <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="flex justify-between items-center mb-3">
                     <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Available Pins</div>
                     {currentRpiPins.length > 0 && (
                       <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                         {`Showing first ${Math.min(16, currentRpiPins.length)} of ${currentRpiPins.length} available pins`}
                       </div>
                     )}
                   </div>
                   <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                     {currentRpiPins.slice(0, 16).map(p => (
                       <button
                         key={p}
                         type="button"
                         onClick={() => setPin(p)}
                         className={`p-3 rounded-lg border text-left transition-all ${
                           pin === p
                             ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                             : 'border-slate-200 text-slate-600 hover:border-slate-400'
                         }`}
                       >
                         <div className="text-[11px] font-black tracking-wide">P{p}</div>
                         <div className="text-[9px] text-slate-500">{getRpiGpioLabel(p)}</div>
                       </button>
                     ))}
                   </div>
                 </div>
                 <div className="mt-3 flex flex-wrap items-center gap-3">
                   <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Relay Mode</span>
                   <div className="flex items-center gap-2 text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => setRelayActiveMode('high')}
                        className={`px-2 py-1 rounded border transition-all ${
                          relayActiveMode === 'high'
                            ? 'admin-btn-primary'
                            : 'border-slate-300 text-slate-600'
                        }`}
                      >
                        Active High
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelayActiveMode('low')}
                        className={`px-2 py-1 rounded border transition-all ${
                          relayActiveMode === 'low'
                            ? 'admin-btn-primary'
                            : 'border-slate-300 text-slate-600'
                        }`}
                      >
                        Active Low
                      </button>
                    </div>
                 </div>
               </div>
             ) : (
               <div className="flex flex-col sm:flex-row gap-4">
                 <div className="flex-1 bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Simulated Mode</div>
                   <p className="text-[10px] text-slate-600">
                     No physical GPIO pins. This mode is for testing and does not require pin configuration.
                   </p>
                 </div>
                 <button
                   onClick={handleSave}
                   disabled={saving}
                   className="admin-btn-primary sm:w-48 py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
                 >
                   <Save size={12} />
                   {saving ? 'Saving...' : 'Apply Config'}
                 </button>
               </div>
             )}
          </div>


        </div>

        {/* System Monitor */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
             <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
               <Monitor size={14} className="text-slate-700" /> Monitor
             </h3>
             <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          </div>
          <div className="p-4 space-y-3">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Active Spec</div>
              <div className="space-y-1.5 text-[10px]">
                <div className="flex justify-between border-b border-slate-200/50 pb-1">
                  <span className="text-slate-500 uppercase">Board:</span>
                  <span className="font-bold text-slate-900">{board.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200/50 pb-1">
                  <span className="text-slate-500 uppercase">Input:</span>
                  <span className="font-bold text-slate-900">
                    {isOrangePi && typeof orangeGpioForSelectedPin === 'number'
                      ? `Pin ${pin} (GPIO ${orangeGpioForSelectedPin})`
                      : isRaspberryPi && typeof rpiGpioForSelectedPin === 'number'
                      ? `Pin ${pin} (BCM ${rpiGpioForSelectedPin})`
                      : `GPIO ${pin}`}
                  </span>
                </div>
                {board === 'orange_pi' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 uppercase">Model:</span>
                    <span className="font-bold text-slate-900">
                      {boardModelLabel || boardModel}
                    </span>
                  </div>
                )}
                {board === 'raspberry_pi' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 uppercase">Model:</span>
                    <span className="font-bold text-slate-900">
                      {rpiModelLabel || rpiBoardModel}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-2 flex items-center gap-2">
                <CheckCircle size={12} className="text-green-600" />
                <div className="text-green-800 text-[9px] font-bold uppercase tracking-tight">Saved successfully</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Machine Revenue Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 admin-sidebar flex items-center justify-between">
           <div className="flex items-center gap-3">
             <div className="p-2 bg-white/10 rounded-lg text-white">
               <span className="text-lg">💰</span>
             </div>
             <div>
               <h3 className="text-[10px] font-black text-white uppercase tracking-widest">
                 Main Machine Revenue
               </h3>
               <p className="text-[8px] text-white/70 font-bold uppercase tracking-widest">
                 Sales & Coins Out
               </p>
             </div>
           </div>
           <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/10">
             <div className="text-[8px] font-black text-emerald-200 uppercase tracking-wider mb-0.5">Current</div>
             <div className="text-sm font-black text-white tracking-widest font-mono">
               ₱{mainRevenue.toFixed(2)}
             </div>
           </div>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Current Revenue</div>
              <div className="text-2xl font-black text-slate-800">₱{mainRevenue.toFixed(2)}</div>
              <div className="text-[9px] text-slate-400 mt-1">Uncollected Sales</div>
            </div>
            <button
              onClick={() => setShowCoinsOutModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm flex items-center gap-2"
            >
              <span>💸</span> Coins Out
            </button>
          </div>

          <div className="pt-4 border-t border-slate-100">
             <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Last Coins Out History</div>
             {lastCoinsOutStats ? (
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                 <div>
                   <div className="text-[9px] text-slate-500 mb-0.5 font-bold uppercase">Date</div>
                   <div className="text-[10px] font-black text-slate-700">{new Date(lastCoinsOutStats.lastCoinsOutDate).toLocaleDateString()}</div>
                   <div className="text-[8px] text-slate-400">{new Date(lastCoinsOutStats.lastCoinsOutDate).toLocaleTimeString()}</div>
                 </div>
                 <div>
                   <div className="text-[9px] text-slate-500 mb-0.5 font-bold uppercase">Gross</div>
                   <div className="text-[10px] font-black text-slate-700">₱{lastCoinsOutStats.lastCoinsOutGross.toFixed(2)}</div>
                 </div>
                 <div>
                   <div className="text-[9px] text-slate-500 mb-0.5 font-bold uppercase">Net Income</div>
                   <div className="text-[10px] font-black text-emerald-600">₱{lastCoinsOutStats.lastCoinsOutNet.toFixed(2)}</div>
                 </div>
               </div>
             ) : (
               <div className="text-[10px] text-slate-400 italic bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">No coins out history available</div>
             )}
          </div>
        </div>
      </div>

      {/* Sub-Vendo Controller Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 admin-sidebar flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg text-white">
              <Wifi size={16} />
            </div>
            <div>
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest">
                Sub-Vendo Bridge
              </h3>
              <p className="text-[8px] text-white/70 font-bold uppercase tracking-widest">
                {nodemcuDevices.length} ACTIVE NODES
              </p>
            </div>
          </div>
          
          <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/10">
            <div className="text-[8px] font-black text-blue-200 uppercase tracking-wider mb-0.5">License System</div>
            <div className="text-sm font-black text-white tracking-widest font-mono">
              HYBRID
            </div>
          </div>
        </div>
        <div className="p-4">
            <NodeMCUManager devices={nodemcuDevices} onUpdateDevices={setNodemcuDevices} />
        </div>
      </div>

      {/* Main Machine Coins Out Modal */}
      {showCoinsOutModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Main Coins-out Summary</h3>
              <button
                onClick={() => {
                  setShowCoinsOutModal(false);
                  setCoinsOutSharePercent('');
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Gross Sales Revenue</div>
                <div className="text-[11px] font-black text-emerald-600">
                  ₱{mainRevenue.toFixed(2)}
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Share Percentage
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={coinsOutSharePercent}
                    onChange={(e) => setCoinsOutSharePercent(e.target.value)}
                    placeholder="Halimbawa: 40 para sa 40% na share"
                    min={0}
                    max={100}
                    step="0.01"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">%</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Net Income ng Coinslot</div>
                  <div className="text-[11px] font-black text-slate-900">
                    ₱{coinsOutNetIncome.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Share Mula sa Gross</div>
                  <div className="text-[11px] font-black text-blue-600">
                    ₱{coinsOutShareAmount.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCoinsOut}
                  disabled={coinsOutProcessing}
                  className="flex-1 px-4 py-2.5 bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {coinsOutProcessing ? 'Saving...' : 'Save & Reset'}
                </button>
                <button
                  onClick={() => {
                    setShowCoinsOutModal(false);
                    setCoinsOutSharePercent('');
                  }}
                  disabled={coinsOutProcessing}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HardwareManager;
