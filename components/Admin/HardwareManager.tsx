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
import NodeMCUManager from './NodeMCUManager';

const HardwareManager: React.FC = () => {
  const [board, setBoard] = useState<BoardType>('none');
  const [pin, setPin] = useState(2);
  const [boardModel, setBoardModel] = useState<string>('orange_pi_one');
  
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

  const loadConfig = async () => {
    try {
      const cfg = await apiClient.getConfig();
      setBoard(cfg.boardType);
      setPin(cfg.coinPin);
      if (cfg.boardModel) setBoardModel(cfg.boardModel);

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
        coinSlots: coinSlots
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
                   onChange={(e) => setPin(parseInt(e.target.value))}
                   className="w-full accent-slate-900 h-1.5 rounded-lg appearance-none bg-slate-200 cursor-pointer"
                 />
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
                  <span className="font-bold text-slate-900">GPIO {pin}</span>
                </div>
                {board === 'orange_pi' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 uppercase">Model:</span>
                    <span className="font-bold text-slate-900">{boardModel}</span>
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
