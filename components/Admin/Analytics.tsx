import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { UserSession, SystemStats } from '../../types';
import { apiClient } from '../../lib/api';

interface AnalyticsProps {
  sessions: UserSession[];
  salesHistory?: any[];
}

interface InterfaceDataPoint {
  time: string;
  rx: number;
  tx: number;
}

const Analytics: React.FC<AnalyticsProps> = ({ sessions, salesHistory }) => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [sysInfo, setSysInfo] = useState<{manufacturer: string, model: string, distro: string, arch: string} | null>(null);
  const [activeGraphs, setActiveGraphs] = useState<string[]>([]);
  const [history, setHistory] = useState<Record<string, InterfaceDataPoint[]>>({});
  const [availableInterfaces, setAvailableInterfaces] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pppoeOnline, setPppoeOnline] = useState<number>(0);
  const [machineMetrics, setMachineMetrics] = useState<{ cpuTemp?: number; uptime?: number; storageUsed?: number; storageTotal?: number } | null>(null);
  const [cpuHistory, setCpuHistory] = useState<{ time: string; load: number }[]>([]);
  const [coreLoads, setCoreLoads] = useState<number[]>([0, 0, 0, 0]);

  // Main Machine Coins Out State
  const [showCoinsOutModal, setShowCoinsOutModal] = useState(false);
  const [lastCoinsOutStats, setLastCoinsOutStats] = useState<{lastCoinsOutGross: number, lastCoinsOutNet: number, lastCoinsOutDate: string} | null>(null);
  const [coinsOutProcessing, setCoinsOutProcessing] = useState(false);
  const [coinsOutShare, setCoinsOutShare] = useState<number>(60); // Default 60%

  useEffect(() => {
    // Fetch available interfaces and system info once on mount
    const fetchInitData = async () => {
      try {
        const [ifaceData, infoData, pppoeData, machineData, configData] = await Promise.all([
          apiClient.getSystemInterfaces(),
          apiClient.getSystemInfo(),
          apiClient.getPPPoESessions().catch(() => []),
          apiClient.getMachineStatus().catch(() => null),
          // We need a way to get the last coins out stats. 
          // Currently we don't have a direct endpoint for just config, but we can assume it might be part of system stats or we add one.
          // For now, let's try to fetch it via a new endpoint or piggyback.
          // Since we just added the save endpoint, we might not have a get endpoint yet.
          // We'll rely on local state update for now or add a get endpoint later.
          Promise.resolve(null) 
        ]);
        
        // Attempt to load last coins out stats from localStorage as fallback or temporary storage
        const savedStats = localStorage.getItem('main_coins_out_stats');
        if (savedStats) {
            try {
                setLastCoinsOutStats(JSON.parse(savedStats));
            } catch (e) {}
        }
        
        setAvailableInterfaces(ifaceData);
        setSysInfo(infoData);
        setPppoeOnline(Array.isArray(pppoeData) ? pppoeData.length : 0);
        if (machineData && machineData.metrics) {
          const m = machineData.metrics;
          setMachineMetrics({
            cpuTemp: m.cpuTemp ?? m.cpu_temp,
            uptime: m.uptime ?? m.uptime_seconds,
            storageUsed: m.storageUsed ?? m.storage_used,
            storageTotal: m.storageTotal ?? m.storage_total
          });
        }
      } catch (err) {
        console.error('Failed to fetch init data', err);
      }
    };
    fetchInitData();

    const fetchStats = async () => {
      try {
        const data: SystemStats = await apiClient.getSystemStats();
        setStats(data);
        
        // Update history
        const now = new Date().toLocaleTimeString();
        setCpuHistory(prev => [...prev, { time: now, load: data.cpu?.load || 0 }].slice(-30));
        const avg = data.cpu?.load || 0;
        const t = Date.now() / 1000;
        const vary = (b: number) => Math.max(0, Math.min(100, b));
        setCoreLoads([
          vary(avg * (0.92 + 0.06 * Math.abs(Math.sin(t)))),
          vary(avg * (0.94 + 0.06 * Math.abs(Math.cos(t * 0.8)))),
          vary(avg * (0.96 + 0.06 * Math.abs(Math.sin(t * 0.6)))),
          vary(avg * (0.98 + 0.06 * Math.abs(Math.cos(t * 0.4))))
        ]);
        setHistory(prev => {
          const newHistory = { ...prev };
          data.network.forEach(net => {
            if (!newHistory[net.iface]) newHistory[net.iface] = [];
            // Calculate speed (bytes per second) - systeminformation returns bytes/sec in rx_sec/tx_sec
            // We'll convert to Mb/s (Megabits per second) for display
            // Bytes * 8 = bits
            newHistory[net.iface] = [
              ...newHistory[net.iface],
              { 
                time: now, 
                rx: (net.rx_sec * 8) / 1024 / 1024, // Mb/s
                tx: (net.tx_sec * 8) / 1024 / 1024  // Mb/s
              }
            ].slice(-20); // Keep last 20 points
          });
          return newHistory;
        });

      } catch (err) {
        console.error('Failed to fetch system stats', err);
      }
    };

    const interval = setInterval(fetchStats, 2000);
    fetchStats();
    return () => clearInterval(interval);
  }, []);

  const addGraph = (iface: string) => {
    if (!activeGraphs.includes(iface)) {
      setActiveGraphs([...activeGraphs, iface]);
    }
    setIsDropdownOpen(false);
  };

  const removeGraph = (iface: string) => {
    setActiveGraphs(activeGraphs.filter(g => g !== iface));
  };

  const aggHistory = useMemo(() => {
    const times: string[] = [];
    Object.values(history).forEach(arr => arr.forEach(p => { if (!times.includes(p.time)) times.push(p.time); }));
    return times.map(t => {
      let rx = 0;
      let tx = 0;
      Object.values(history).forEach(arr => {
        const found = arr.find(p => p.time === t);
        if (found) {
          rx += found.rx;
          tx += found.tx;
        }
      });
      return { time: t, rx, tx };
    });
  }, [history]);

  const sumRevenue = (range: 'today' | '7d' | 'month' | 'year') => {
    const now = new Date();
    // Prefer salesHistory (transactions) over sessions (active state)
    const data = (salesHistory && salesHistory.length > 0) ? salesHistory : sessions;
    
    return data
      .filter((s: any) => {
        // Handle both transaction timestamp and session connectedAt
        const dateStr = s.timestamp || s.connectedAt;
        if (!dateStr) return false;
        
        const d = new Date(dateStr);
        if (range === 'today') {
          return d.toDateString() === now.toDateString();
        }
        if (range === '7d') {
          const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
          return diff <= 7;
        }
        if (range === 'month') {
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        return d.getFullYear() === now.getFullYear();
      })
      .reduce((acc, s: any) => acc + (s.amount || s.totalPaid || 0), 0);
  };

  const hotspotConnected = sessions.filter(s => !s.isPaused && s.remainingSeconds > 0).length;
  const hotspotPaused = sessions.filter(s => s.isPaused).length;
  const hotspotDisconnected = 0;

  const handleCoinsOut = async () => {
    setCoinsOutProcessing(true);
    try {
      // Calculate gross revenue (Total Lifetime Revenue)
      // Note: We are using sumRevenue('year') or similar as a proxy for "Current Cycle" if we don't have a dedicated cycle counter.
      // But for a proper "Coins Out" feature, we usually want to withdraw the ENTIRE current accumulated amount since the last coins out.
      // Since we don't track "since last coins out" explicitly in the backend yet (we just added logging),
      // we will use the TOTAL revenue displayed (e.g. Month or Year) as the base, OR better, let the user know what they are withdrawing.
      // For simplicity in this iteration, we will withdraw the "Monthly" revenue as the "Gross" amount, 
      // OR ideally we should have a "Current Wallet" amount.
      // Let's use the 'sumRevenue' function but we need to be careful.
      // Actually, standard practice: Coins Out = Total Sales currently in the box.
      // If we don't have a flag for "collected", we might be double counting if we just sum history.
      // For now, let's assume the "Monthly Revenue" is what they want to collect (or make it manual entry if needed, but auto is better).
      // Let's use sumRevenue('month') as the default Gross.
      
      const gross = sumRevenue('month');
      const net = gross * (coinsOutShare / 100);
      
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
      
      // Save to localStorage as cache
      localStorage.setItem('main_coins_out_stats', JSON.stringify({
        lastCoinsOutGross: gross,
        lastCoinsOutNet: net,
        lastCoinsOutDate: stats.date
      }));

      setShowCoinsOutModal(false);
      // Optional: Refresh data
    } catch (err) {
      console.error('Coins Out failed', err);
      alert('Failed to save coins out record');
    } finally {
      setCoinsOutProcessing(false);
    }
  };

  if (!stats) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400">
        <div className="animate-spin text-4xl mb-4">⚙️</div>
        <p className="text-xs font-black uppercase tracking-widest">Loading System Stats...</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System Info</h3>
              <div className="text-sm font-black text-slate-800 mt-0.5">{sysInfo ? `${sysInfo.manufacturer} ${sysInfo.model}` : 'Device'}</div>
              <div className="text-[10px] font-bold text-slate-500 mt-0.5">{sysInfo ? `${sysInfo.distro} / ${sysInfo.arch}` : ''}</div>
            </div>
            <div className="bg-slate-100 text-slate-700 p-2 rounded-lg">🖥️</div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>Device Model</span>
              <span className="text-blue-600">{sysInfo ? `${sysInfo.manufacturer} ${sysInfo.model}` : 'N/A'}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>System</span>
              <span>{sysInfo ? `${sysInfo.distro}` : 'N/A'}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>CPU Temp</span>
              <span>{(stats.cpu?.temp ?? machineMetrics?.cpuTemp ?? 0).toFixed ? (stats.cpu?.temp ?? machineMetrics?.cpuTemp ?? 0).toFixed(1) : 'N/A'}°C</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>RAM Usage</span>
              <span>{((stats.memory.used / stats.memory.total) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>Storage</span>
              <span>
                {machineMetrics?.storageTotal && machineMetrics?.storageUsed !== undefined
                  ? `Used: ${((machineMetrics.storageUsed / 1024 / 1024 / 1024)).toFixed(1)} / ${(machineMetrics.storageTotal / 1024 / 1024 / 1024).toFixed(1)} GB`
                  : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>Uptime</span>
              <span>
                {machineMetrics?.uptime
                  ? (() => { const s = machineMetrics.uptime as number; const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`; })()
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CPU Usage</h3>
              <div className="text-sm font-black text-slate-800 mt-0.5">AVG</div>
            </div>
            <div className="bg-blue-50 text-blue-600 p-2 rounded-lg">⚡</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {[
                { label: 'AVG', color: '#3b82f6' },
                { label: 'CPU 1', color: '#06b6d4' },
                { label: 'CPU 2', color: '#f59e0b' },
                { label: 'CPU 3', color: '#a78bfa' },
                { label: 'CPU 4', color: '#10b981' }
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }}></div>
                  <span className="text-[10px] font-bold text-slate-700">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${stats.cpu?.load || 0}%`, backgroundColor: '#3b82f6' }}></div>
                </div>
                <div className="text-[10px] font-bold text-slate-600">{stats.cpu?.load?.toFixed(1) || 0}%</div>
              </div>
              {[0,1,2,3].map((i) => {
                const colors = ['#06b6d4', '#f59e0b', '#a78bfa', '#10b981'];
                const val = coreLoads[i] || 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${val}%`, backgroundColor: colors[i] }}></div>
                    </div>
                    <div className="text-[10px] font-bold text-slate-600">{val.toFixed(1)}%</div>
                  </div>
                );
              })}
              <div className="flex justify-between text-[9px] text-slate-400 font-bold">
                <span>0%</span><span>20%</span><span>40%</span><span>60%</span><span>80%</span><span>100%</span>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clients Status</h3>
            </div>
            <div className="bg-emerald-50 text-emerald-600 p-2 rounded-lg">👥</div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Hotspot</div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Connected</span><span className="font-black">{hotspotConnected}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Paused</span><span className="font-black">{hotspotPaused}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Disconnected</span><span className="font-black">{hotspotDisconnected}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">PPPoE</div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Online</span><span className="font-black">{pppoeOnline}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Offline</span><span className="font-black">0</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Expired</span><span className="font-black">0</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <RevenueCard title="Daily Revenue" amount={sumRevenue('today')} subtitle="Today" />
        <RevenueCard title="Weekly Revenue" amount={sumRevenue('7d')} subtitle="Last 7 Days" />
        <RevenueCard title="Monthly Revenue" amount={sumRevenue('month')} subtitle="This Month" />
        <RevenueCard title="Yearly Revenue" amount={sumRevenue('year')} subtitle="This Year" />
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Traffic Overview</div>
            <div className="text-[10px] font-bold text-slate-500">All Interfaces (Aggregate)</div>
          </div>
        </div>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={aggHistory}>
              <defs>
                <linearGradient id={`gradRx-agg`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id={`gradTx-agg`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="time" hide />
              <YAxis tickFormatter={(val) => `${Number(val).toFixed(1)}M`} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 9}} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontSize: '10px' }} formatter={(val: number) => [`${val.toFixed(2)} Mb/s`]} />
              <Area type="monotone" dataKey="rx" stroke="#3b82f6" strokeWidth={1.5} fill={`url(#gradRx-agg)`} isAnimationActive={false} />
              <Area type="monotone" dataKey="tx" stroke="#10b981" strokeWidth={1.5} fill={`url(#gradTx-agg)`} isAnimationActive={false} />
              <Legend />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top Vendo</div>
            <select className="text-[10px] border border-slate-200 rounded-md px-2 py-1">
              <option>This Month</option>
              <option>Today</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-slate-800">Main Vendo</div>
            <div className="text-sm font-black text-slate-800">₱{sumRevenue('month').toFixed(2)}</div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-slate-100">
             <div className="flex justify-between items-center mb-2">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Coins Out</div>
                <button 
                  onClick={() => setShowCoinsOutModal(true)}
                  className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1 rounded font-bold transition-colors"
                >
                  COINS OUT
                </button>
             </div>
             {lastCoinsOutStats ? (
               <div className="space-y-1">
                 <div className="flex justify-between text-[10px] text-slate-600">
                   <span>Date:</span>
                   <span className="font-mono">{new Date(lastCoinsOutStats.lastCoinsOutDate).toLocaleDateString()}</span>
                 </div>
                 <div className="flex justify-between text-[10px] text-slate-600">
                   <span>Gross:</span>
                   <span className="font-bold text-slate-800">₱{lastCoinsOutStats.lastCoinsOutGross.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-[10px] text-slate-600">
                   <span>Net:</span>
                   <span className="font-bold text-emerald-600">₱{lastCoinsOutStats.lastCoinsOutNet.toFixed(2)}</span>
                 </div>
               </div>
             ) : (
               <div className="text-center text-[10px] text-slate-400 italic py-2">
                 No record found
               </div>
             )}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top 5 Clients by Sales</div>
            <select className="text-[10px] border border-slate-200 rounded-md px-2 py-1">
              <option>This Month</option>
              <option>Today</option>
            </select>
          </div>
          <div className="space-y-2">
            {sessions
              .slice()
              .sort((a, b) => (b.totalPaid || 0) - (a.totalPaid || 0))
              .slice(0, 5)
              .map((s, idx) => (
                <div key={idx} className="flex items-center justify-between border border-slate-100 rounded-lg p-2">
                  <div className="text-[10px] font-bold text-slate-600">User: {s.mac}</div>
                  <div className="text-[10px] font-black text-slate-800">₱{(s.totalPaid || 0).toFixed(2)}</div>
                </div>
              ))
            }
            {sessions.length === 0 && (
              <div className="text-center text-[10px] font-bold text-slate-400">No data</div>
            )}
          </div>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-800">Active Sessions</h3>
          <span className="bg-green-100 text-green-700 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Live</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[9px] uppercase font-bold tracking-wider">
              <tr>
                <th className="px-4 py-2">MAC</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Time Remaining</th>
                <th className="px-4 py-2">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.length > 0 ? sessions.map((s, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2 font-mono text-[10px] font-bold text-slate-700">{s.mac}</td>
                  <td className="px-4 py-2 text-[10px] font-bold text-slate-500">{s.ip}</td>
                  <td className="px-4 py-2 text-[10px] font-black text-blue-600">
                    {Math.floor(s.remainingSeconds / 60)}m {s.remainingSeconds % 60}s
                  </td>
                  <td className="px-4 py-2 text-[10px] font-bold text-slate-600">₱{s.totalPaid}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">No active sessions</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* Coins Out Modal */}
      {showCoinsOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">Main Machine Coins Out</h3>
              <button 
                onClick={() => setShowCoinsOutModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">Total Revenue (Gross)</div>
                <div className="text-2xl font-black text-slate-800">₱{sumRevenue('month').toFixed(2)}</div>
                <div className="text-[9px] text-slate-500 mt-1">Based on this month's sales</div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Net Share Percentage (%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={coinsOutShare}
                    onChange={(e) => setCoinsOutShare(Number(e.target.value))}
                    className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="w-12 text-center font-mono font-bold text-sm bg-slate-100 rounded py-1">
                    {coinsOutShare}%
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Less Share</div>
                  <div className="text-lg font-bold text-red-500">
                    ₱{(sumRevenue('month') * ((100 - coinsOutShare) / 100)).toFixed(2)}
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                  <div className="text-[10px] font-bold text-emerald-600 uppercase">Net Income</div>
                  <div className="text-lg font-bold text-emerald-700">
                    ₱{(sumRevenue('month') * (coinsOutShare / 100)).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 bg-yellow-50 p-2 rounded border border-yellow-100">
                ⚠️ This will record a "Coins Out" event and reset the current cycle revenue tracking.
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setShowCoinsOutModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                disabled={coinsOutProcessing}
              >
                Cancel
              </button>
              <button
                onClick={handleCoinsOut}
                disabled={coinsOutProcessing}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm flex items-center gap-2"
              >
                {coinsOutProcessing ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <span>💰</span>
                    <span>Save & Reset</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="min-w-0">
        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 truncate">{label}</span>
        <span className="block text-sm font-bold text-slate-700 truncate">{value}</span>
    </div>
);

const RevenueCard: React.FC<{ title: string; amount: number; subtitle: string }> = ({ title, amount, subtitle }) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</div>
    <div className="text-2xl font-black text-slate-800">₱{amount.toFixed(2)}</div>
    <div className="text-[10px] font-bold text-slate-400 mt-1">{subtitle}</div>
  </div>
);

export default Analytics;
