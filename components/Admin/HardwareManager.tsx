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
import NodeMCUManager from './NodeMCUManager';

const opiPinoutModule: any = opiPinout as any;
const opiMappings: Record<string, { name?: string; pins: Record<number, number> }> = opiPinoutModule?.mappings || {};
const ORANGE_PI_MODELS = ['orange_pi_one', 'orange_pi_zero_3', 'orange_pi_pc', 'orange_pi_5'];
const ORANGE_PI_DEFAULT_MODEL = 'orange_pi_one';

const HardwareManager: React.FC = () => {
  const [board, setBoard] = useState<BoardType>('none');
  const [pin, setPin] = useState(2);
  const [boardModel, setBoardModel] = useState<string>('orange_pi_one');
  const [relayPin, setRelayPin] = useState<number | null>(null);
  const [relayActiveMode, setRelayActiveMode] = useState<'high' | 'low'>('high');
  
  const [coinSlots, setCoinSlots] = useState<CoinSlotConfig[]>([]);
  const [nodemcuDevices, setNodemcuDevices] = useState<NodeMCUDevice[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadConfig();
    loadNodemcuDevices();
    
    // Refresh device list periodically
    const interval = setInterval(loadNodemcuDevices, 10000);
    return () => clearInterval(interval);
  }, []);

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

  const isOrangePi = board === 'orange_pi';

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

  const loadConfig = async () => {
    try {
      const cfg = await apiClient.getConfig();
      setBoard(cfg.boardType);
      setPin(cfg.coinPin);
      if (cfg.boardModel) setBoardModel(cfg.boardModel);
      if (typeof cfg.relayPin === 'number') {
        setRelayPin(cfg.relayPin);
      }
      if (cfg.relayActiveMode === 'low' || cfg.relayActiveMode === 'high') {
        setRelayActiveMode(cfg.relayActiveMode);
      }

      if (cfg.coinSlots && cfg.coinSlots.length > 0) {
        setCoinSlots(cfg.coinSlots);
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
        boardModel: board === 'orange_pi' ? boardModel : null,
        coinSlots: coinSlots,
        relayPin: board === 'none' || board === 'nodemcu_esp' ? null : relayPin,
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
                       className={`px-2 py-1 rounded border ${
                         relayActiveMode === 'high'
                           ? 'border-slate-900 bg-slate-900 text-white'
                           : 'border-slate-300 text-slate-600'
                       }`}
                     >
                       Active High
                     </button>
                     <button
                       type="button"
                       onClick={() => setRelayActiveMode('low')}
                       className={`px-2 py-1 rounded border ${
                         relayActiveMode === 'low'
                           ? 'border-slate-900 bg-slate-900 text-white'
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
                   <div className="flex justify-between items-center mb-2">
                     <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Coin Pin (Main)</label>
                     <div className="text-[10px] font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">GPIO {pin}</div>
                   </div>
                   <input
                     type="range"
                     min="2"
                     max="27"
                     value={pin}
                     onChange={(e) => setPin(parseInt(e.target.value, 10))}
                     className="w-full accent-slate-900 h-1.5 rounded-lg appearance-none bg-slate-200 cursor-pointer"
                   />
                 </div>
                 <div className="flex-1 bg-slate-50 rounded-lg p-3 border border-slate-200">
                   <div className="flex justify-between items-center mb-2">
                     <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Relay Pin (Output)</label>
                     <div className="text-[10px] font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                       {relayPin != null ? `GPIO ${relayPin}` : 'Disabled'}
                     </div>
                   </div>
                   <input
                     type="range"
                     min="2"
                     max="27"
                     value={relayPin != null ? relayPin : 2}
                     onChange={(e) => setRelayPin(parseInt(e.target.value, 10))}
                     className="w-full accent-slate-900 h-1.5 rounded-lg appearance-none bg-slate-200 cursor-pointer"
                   />
                   <div className="mt-3 flex flex-wrap items-center gap-3">
                     <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Relay Mode</span>
                     <div className="flex items-center gap-2 text-[10px] font-bold">
                       <button
                         type="button"
                         onClick={() => setRelayActiveMode('high')}
                         className={`px-2 py-1 rounded border ${
                           relayActiveMode === 'high'
                             ? 'border-slate-900 bg-slate-900 text-white'
                             : 'border-slate-300 text-slate-600'
                         }`}
                       >
                         Active High
                       </button>
                       <button
                         type="button"
                         onClick={() => setRelayActiveMode('low')}
                         className={`px-2 py-1 rounded border ${
                           relayActiveMode === 'low'
                             ? 'border-slate-900 bg-slate-900 text-white'
                             : 'border-slate-300 text-slate-600'
                         }`}
                       >
                         Active Low
                       </button>
                     </div>
                   </div>
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

      {/* Sub-Vendo Controller Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white">
              <Wifi size={16} />
            </div>
            <div>
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest">
                Sub-Vendo Bridge
              </h3>
              <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">
                {nodemcuDevices.length} ACTIVE NODES
              </p>
            </div>
          </div>
          
          <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/10">
            <div className="text-[8px] font-black text-blue-400 uppercase tracking-wider mb-0.5">License System</div>
            <div className="text-sm font-black text-white tracking-widest font-mono">
              HYBRID
            </div>
          </div>
        </div>
        <div className="p-4">
            <NodeMCUManager devices={nodemcuDevices} onUpdateDevices={setNodemcuDevices} />
        </div>
      </div>
    </div>
  );
};

export default HardwareManager;
