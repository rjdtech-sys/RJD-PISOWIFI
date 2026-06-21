import React, { useState, useEffect, useRef } from 'react';
import { apiClient } from '../../lib/api';
import { WanInterface } from '../../types';

interface MultiWanConfig {
  enabled: boolean;
  topology: 'single' | 'multi';
  mode: 'pcc' | 'ecmp';
  pcc_method: 'both_addresses' | 'both_addresses_ports';
}

interface NetworkIface {
  name: string;
  type: string;
  status: string;
  ip: string | null;
  speed?: number;
}

interface WanTrafficData {
  rx_bytes: number;
  tx_bytes: number;
  rx_rate: number;
  tx_rate: number;
  timestamp: number;
  status?: 'up' | 'down';
  ip?: string | null;
  error?: string;
}

// Traffic history point for the graph
interface TrafficPoint {
  timestamp: number;
  rx_rate: number;
  tx_rate: number;
}

// WAN Traffic Monitor Component with real-time graph
const WanTrafficMonitor: React.FC<{ wans: WanInterface[] }> = ({ wans }) => {
  const [trafficData, setTrafficData] = useState<Record<string, WanTrafficData>>({});
  const [trafficHistory, setTrafficHistory] = useState<Record<string, TrafficPoint[]>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const fetchTraffic = async () => {
      try {
        const token = localStorage.getItem('ajc_admin_token');
        const res = await fetch('/api/multiwan/traffic', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const data = await res.json();
        setTrafficData(data);

        // Update history (keep last 60 points = 2 minutes at 2s interval)
        setTrafficHistory(prev => {
          const newHistory = { ...prev };
          for (const [iface, stats] of Object.entries(data)) {
            if (!newHistory[iface]) newHistory[iface] = [];
            newHistory[iface] = [
              ...newHistory[iface].slice(-59),
              {
                timestamp: stats.timestamp || Date.now(),
                rx_rate: stats.rx_rate || 0,
                tx_rate: stats.tx_rate || 0
              }
            ];
          }
          return newHistory;
        });
      } catch (e) {
        console.error('Failed to fetch traffic data', e);
      }
    };

    fetchTraffic();
    const interval = setInterval(fetchTraffic, 2000);
    return () => clearInterval(interval);
  }, []);

  // Draw the graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const padding = 40;
      const graphWidth = width - padding * 2;
      const graphHeight = height - padding * 2;

      // Clear canvas
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // Draw grid
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;

      // Horizontal grid lines
      for (let i = 0; i <= 4; i++) {
        const y = padding + (graphHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
      }

      // Vertical grid lines
      for (let i = 0; i <= 6; i++) {
        const x = padding + (graphWidth / 6) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
      }

      // Draw axis labels
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'right';

      // Y-axis labels (time labels would go here)
      ctx.fillText('0', padding - 5, height - padding + 4);

      // Find max rate for scaling
      let maxRate = 1000; // Default 1 KB/s minimum scale
      for (const wan of wans) {
        const history = trafficHistory[wan.name] || [];
        for (const point of history) {
          maxRate = Math.max(maxRate, point.rx_rate, point.tx_rate);
        }
      }
      // Round up to nice number
      maxRate = Math.ceil(maxRate / 1000) * 1000 || 1000;

      // Draw Y-axis labels
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const value = Math.round((maxRate / 4) * (4 - i));
        const y = padding + (graphHeight / 4) * i + 4;
        ctx.fillText(formatRate(value), padding - 5, y);
      }

      // Colors for each WAN
      const colors = [
        { rx: '#3b82f6', tx: '#93c5fd' }, // Blue
        { rx: '#10b981', tx: '#6ee7b7' }, // Green
        { rx: '#8b5cf6', tx: '#c4b5fd' }, // Purple
        { rx: '#f59e0b', tx: '#fcd34d' }, // Amber
      ];

      // Draw each WAN's traffic
      wans.forEach((wan, wanIndex) => {
        const history = trafficHistory[wan.name] || [];
        if (history.length < 2) return;

        const color = colors[wanIndex % colors.length];

        // Draw RX line
        ctx.strokeStyle = color.rx;
        ctx.lineWidth = 2;
        ctx.beginPath();
        history.forEach((point, i) => {
          const x = padding + (graphWidth / 60) * i;
          const y = height - padding - (point.rx_rate / maxRate) * graphHeight;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw TX line (dashed)
        ctx.strokeStyle = color.tx;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        history.forEach((point, i) => {
          const x = padding + (graphWidth / 60) * i;
          const y = height - padding - (point.tx_rate / maxRate) * graphHeight;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Draw legend
      const legendY = 15;
      let legendX = padding;

      wans.forEach((wan, wanIndex) => {
        const color = colors[wanIndex % colors.length];
        const stats = trafficData[wan.name];

        // RX indicator
        ctx.fillStyle = color.rx;
        ctx.fillRect(legendX, legendY - 8, 12, 12);
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(`${wan.name} ↓`, legendX + 16, legendY);

        // TX indicator
        ctx.fillStyle = color.tx;
        ctx.fillRect(legendX + 80, legendY - 8, 12, 12);
        ctx.fillStyle = '#334155';
        ctx.fillText(`↑`, legendX + 96, legendY);

        // Current rate
        if (stats) {
          ctx.fillStyle = '#64748b';
          ctx.font = '8px system-ui';
          ctx.fillText(formatRate(stats.rx_rate), legendX + 16, legendY + 12);
          ctx.fillText(formatRate(stats.tx_rate), legendX + 96, legendY + 12);
        }

        legendX += 170;
      });
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [trafficHistory, trafficData, wans]);

  const formatRate = (bytesPerSec: number): string => {
    if (bytesPerSec === 0) return '0 B/s';
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
        <div>
          <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">WAN Traffic Monitor</h3>
          <p className="text-[9px] text-slate-400 uppercase mt-0.5">Real-time bandwidth usage per interface</p>
        </div>
        <div className="flex items-center gap-4 text-[9px]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-blue-500"></div>
            <span className="text-slate-500 font-bold uppercase">Download (RX)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-blue-300 border border-blue-400"></div>
            <span className="text-slate-500 font-bold uppercase">Upload (TX)</span>
          </div>
        </div>
      </div>
      <div className="p-6">
        {/* Graph Canvas */}
        <canvas
          ref={canvasRef}
          width={800}
          height={200}
          className="w-full h-auto rounded-lg border border-slate-100"
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {wans.map((wan) => {
            const stats = trafficData[wan.name];
            const isUp = stats?.status === 'up' && !stats.error;

            return (
              <div
                key={wan.id}
                className={`p-4 rounded-xl border-2 ${isUp ? 'bg-slate-50 border-slate-200' : 'bg-gray-50 border-gray-200'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-black text-sm text-slate-800 uppercase">{wan.name}</span>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${isUp ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {isUp ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>

                {stats && !stats.error ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[8px] font-black text-slate-400 uppercase">Download</div>
                      <div className="text-lg font-black text-blue-600">{formatRate(stats.rx_rate)}</div>
                      <div className="text-[9px] text-slate-400 font-mono">{formatBytes(stats.rx_bytes)} total</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-black text-slate-400 uppercase">Upload</div>
                      <div className="text-lg font-black text-green-600">{formatRate(stats.tx_rate)}</div>
                      <div className="text-[9px] text-slate-400 font-mono">{formatBytes(stats.tx_bytes)} total</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 text-center py-2">No data available</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const MultiWanSettings: React.FC = () => {
  const [config, setConfig] = useState<MultiWanConfig>({
    enabled: false,
    topology: 'single',
    mode: 'pcc',
    pcc_method: 'both_addresses'
  });
  const [wans, setWans] = useState<WanInterface[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableInterfaces, setAvailableInterfaces] = useState<NetworkIface[]>([]);
  const [defaultWan, setDefaultWan] = useState<string | null>(null);
  const [speedResults, setSpeedResults] = useState<Record<number, { ping_ms: number | null; speed_mbps: number | null }>>({});
  const [testingSpeed, setTestingSpeed] = useState<number | null>(null);
  const [defaultWanSpeed, setDefaultWanSpeed] = useState<{ ping_ms: number | null; speed_mbps: number | null } | null>(null);
  const [testingDefaultSpeed, setTestingDefaultSpeed] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWan, setEditingWan] = useState<WanInterface | null>(null);

  // Add WAN form
  const [addForm, setAddForm] = useState<Partial<WanInterface>>({
    name: '',
    type: 'dhcp',
    config: {},
    gateway: '',
    weight: 1,
    enabled: 1
  });
  const [customIfaceName, setCustomIfaceName] = useState('');

  useEffect(() => {
    fetchConfig();
    fetchWans();
    fetchInterfaces();
    fetchDefaultWan();
  }, []);

  const fetchConfig = async () => {
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/multiwan/config', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success && data.config) {
        setConfig({
          enabled: data.config.enabled,
          topology: data.config.topology || 'single',
          mode: data.config.mode,
          pcc_method: data.config.pcc_method
        });
      }
    } catch (e) {
      console.error('Failed to fetch Multi-WAN config', e);
    }
  };

  const fetchWans = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getWanInterfaces();
      if (data.success) {
        setWans(data.wans);
      }
    } catch (e) {
      console.error('Failed to fetch WAN interfaces', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchInterfaces = async () => {
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/interfaces', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setAvailableInterfaces(data.map((i: any) => ({ 
          name: i.name, 
          type: i.type, 
          status: i.status, 
          ip: i.ip || null,
          speed: i.speed || 0
        })));
      }
    } catch (e) {
      // Fallback
    }
  };

  const fetchDefaultWan = async () => {
    try {
      const data = await apiClient.getDefaultWan();
      if (data.success) {
        setDefaultWan(data.interface);
      }
    } catch (e) {
      // Fallback
    }
  };

  const formatSpeed = (speedMbps: number | undefined) => {
    if (!speedMbps || speedMbps <= 0) return null;
    if (speedMbps >= 10000) return '10G';
    if (speedMbps >= 2500) return '2.5G';
    if (speedMbps >= 1000) return '1G';
    return `${speedMbps}M`;
  };

  const getSpeedBadgeColor = (speedMbps: number | undefined) => {
    if (!speedMbps) return 'bg-slate-100 text-slate-500';
    if (speedMbps >= 10000) return 'bg-indigo-100 text-indigo-700';
    if (speedMbps >= 2500) return 'bg-purple-100 text-purple-700';
    if (speedMbps >= 1000) return 'bg-blue-100 text-blue-700';
    return 'bg-slate-100 text-slate-700';
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('ajc_admin_token');
      const res = await fetch('/api/multiwan/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ ...config, interfaces: wans.map(w => ({ interface: w.name, gateway: w.gateway, weight: w.weight })) })
      });
      const data = await res.json();
      if (data.success) {
        alert('Multi-WAN settings saved!');
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleAddWan = async () => {
    // Resolve the actual interface name (custom input vs dropdown)
    const ifaceName = addForm.name === 'custom' ? customIfaceName.trim() : addForm.name;
    if (!ifaceName) {
      alert('Interface name is required');
      return;
    }
    try {
      const selectedIface = availableInterfaces.find(i => i.name === ifaceName);
      // Auto-detect VLAN: if name contains a dot (e.g. eth0.100) treat as VLAN
      const isVlan = selectedIface?.type === 'vlan' || (ifaceName.includes('.') && !selectedIface) ? 1 : 0;
      let vlan_parent = null;
      let vlan_id = null;
      if (isVlan && ifaceName) {
        const lastDot = ifaceName.lastIndexOf('.');
        if (lastDot > 0) {
          vlan_parent = ifaceName.substring(0, lastDot);
          vlan_id = parseInt(ifaceName.substring(lastDot + 1), 10);
        }
      }
      const payload = {
        name: ifaceName!,
        type: addForm.type!,
        config: addForm.config || {},
        gateway: addForm.gateway || null,
        weight: addForm.weight || 1,
        enabled: addForm.enabled ?? 1,
        is_vlan: isVlan,
        vlan_parent,
        vlan_id
      };
      await apiClient.createWanInterface(payload);
      setShowAddModal(false);
      setAddForm({ name: '', type: 'dhcp', config: {}, gateway: '', weight: 1, enabled: 1 });
      setCustomIfaceName('');
      fetchWans();
    } catch (e: any) {
      alert('Failed to add WAN: ' + e.message);
    }
  };

  const handleConfigureDefaultWan = () => {
    if (!defaultWan) return;
    setAddForm({
      name: defaultWan,
      type: 'dhcp',
      config: {},
      gateway: '',
      weight: 1,
      enabled: 1
    });
    setCustomIfaceName('');
    setShowAddModal(true);
  };

  const handleEditWan = async () => {
    if (!editingWan || !editingWan.id) return;
    try {
      await apiClient.updateWanInterface(editingWan.id, {
        name: editingWan.name,
        type: editingWan.type,
        config: editingWan.config,
        gateway: editingWan.gateway,
        weight: editingWan.weight,
        enabled: editingWan.enabled
      });
      setShowEditModal(false);
      setEditingWan(null);
      fetchWans();
    } catch (e: any) {
      alert('Failed to update WAN: ' + e.message);
    }
  };

  const handleDeleteWan = async (id: number) => {
    if (!confirm('Delete this WAN interface?')) return;
    try {
      await apiClient.deleteWanInterface(id);
      fetchWans();
    } catch (e: any) {
      alert('Failed to delete: ' + e.message);
    }
  };

  const handleApplyWan = async (id: number) => {
    try {
      const data = await apiClient.applyWanInterface(id);
      if (data.success) {
        const ip = data.status?.ip || 'None';
        const gw = data.gateway || 'Auto';
        alert(`WAN applied! Status: ${data.status?.status}, IP: ${ip}, Gateway: ${gw}`);
      } else {
        alert('Apply failed: ' + (data.error || 'Unknown'));
      }
      fetchWans();
    } catch (e: any) {
      alert('Failed to apply: ' + e.message);
    }
  };

  const testWanSpeed = async (id: number) => {
    setTestingSpeed(id);
    try {
      const data = await apiClient.getWanInterfaceSpeed(id);
      if (data.success && data.speed) {
        setSpeedResults(prev => ({ ...prev, [id]: data.speed }));
      }
    } catch (e: any) {
      console.error('Speed test failed:', e);
    } finally {
      setTestingSpeed(null);
    }
  };

  const testDefaultWanSpeed = async (iface: string) => {
    setTestingDefaultSpeed(true);
    try {
      const data = await apiClient.getInterfaceSpeedByName(iface);
      if (data.success && data.speed) {
        setDefaultWanSpeed(data.speed);
      }
    } catch (e: any) {
      console.error('Default WAN speed test failed:', e);
    } finally {
      setTestingDefaultSpeed(false);
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'dhcp': return 'bg-blue-100 text-blue-700';
      case 'static': return 'bg-amber-100 text-amber-700';
      case 'pppoe': return 'bg-purple-100 text-purple-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const getStatusBadge = (status?: string, enabled?: number) => {
    if (!enabled) return 'bg-gray-100 text-gray-500';
    if (status === 'up') return 'bg-green-100 text-green-700';
    return 'bg-red-100 text-red-700';
  };

  const isDefaultWanConfigured = () => {
    return defaultWan ? wans.some(w => w.name === defaultWan) : true;
  };

  const renderConfigFields = (form: Partial<WanInterface>, setForm: React.Dispatch<React.SetStateAction<any>>) => {
    const type = form.type || 'dhcp';
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Type</label>
          <select
            className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={type}
            onChange={e => setForm((prev: any) => ({ ...prev, type: e.target.value, config: {} }))}
          >
            <option value="dhcp">DHCP (Auto)</option>
            <option value="static">Static IP</option>
            <option value="pppoe">PPPoE</option>
          </select>
        </div>

        {type === 'static' && (
          <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">IP Address</label>
              <input
                type="text"
                placeholder="192.168.1.100"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={form.config?.ipaddr || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, ipaddr: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Netmask (CIDR or dotted)</label>
              <input
                type="text"
                placeholder="255.255.255.0"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={form.config?.netmask || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, netmask: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gateway</label>
              <input
                type="text"
                placeholder="192.168.1.1"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={form.config?.gateway || form.gateway || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, gateway: e.target.value, config: { ...prev.config, gateway: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">DNS (comma separated)</label>
              <input
                type="text"
                placeholder="8.8.8.8, 1.1.1.1"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                value={(form.config?.dns || []).join(', ')}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, dns: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) } }))}
              />
            </div>
          </div>
        )}

        {type === 'pppoe' && (
          <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Username</label>
              <input
                type="text"
                placeholder="ISP Username"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.config?.username || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, username: e.target.value } }))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Password</label>
              <input
                type="password"
                placeholder="ISP Password"
                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.config?.password || ''}
                onChange={e => setForm((prev: any) => ({ ...prev, config: { ...prev.config, password: e.target.value } }))}
              />
            </div>
          </div>
        )}

        {type === 'dhcp' && (
          <div className="text-xs text-slate-500 bg-blue-50 p-3 rounded-lg border border-blue-100">
            DHCP will automatically obtain an IP address from the ISP.
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading Multi-WAN Configuration...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Multi-WAN Management</h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">ISP Interfaces, Load Balancing & Failover</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${config.topology === 'multi' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {config.topology === 'multi' ? 'Multi-WAN Mode' : 'Single WAN Mode'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">

          {/* Default WAN Alert */}
          {defaultWan && !isDefaultWanConfigured() && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 font-black text-lg">!</div>
                <div>
                  <div className="font-black text-sm text-slate-800 uppercase">Default WAN Detected: {defaultWan}</div>
                  <div className="text-xs text-slate-500 mt-0.5">This interface currently handles your internet traffic. Configure it to manage settings.</div>
                </div>
              </div>
              <button
                onClick={handleConfigureDefaultWan}
                className="text-[10px] font-black uppercase tracking-widest bg-amber-500 text-white px-4 py-2 rounded-xl hover:bg-amber-600 transition-colors shadow-sm"
              >
                Configure
              </button>
            </div>
          )}

          {/* WAN Mode Selector */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">WAN Topology</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => setConfig({ ...config, topology: 'single', enabled: false })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${config.topology === 'single' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className={`font-black text-sm uppercase ${config.topology === 'single' ? 'text-blue-700' : 'text-slate-700'}`}>Single WAN</div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Only one active WAN at a time. New WANs replace the current one.</div>
                </button>
                <button
                  onClick={() => setConfig({ ...config, topology: 'multi', enabled: true, mode: 'ecmp' })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${config.topology === 'multi' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className={`font-black text-sm uppercase ${config.topology === 'multi' ? 'text-blue-700' : 'text-slate-700'}`}>Multi-WAN</div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Multiple active WANs with automatic ECMP load balancing.</div>
                </button>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="bg-blue-600 text-white px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Mode'}
                </button>
              </div>
            </div>
          </div>

          {/* WAN Interface Cards */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">WAN Interfaces</h3>
              <button
                onClick={() => setShowAddModal(true)}
                className="text-[10px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
              >
                + Add WAN
              </button>
            </div>
            <div className="p-6">
              {wans.length === 0 && !defaultWan ? (
                <div className="text-center py-12 text-slate-400 text-xs font-bold uppercase border-2 border-dashed border-slate-200 rounded-xl">
                  No WAN interfaces configured
                  <div className="mt-2 font-normal normal-case text-slate-400">Click "Add WAN" to get started</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Current System WAN */}
                  {defaultWan && !wans.find(w => w.name === defaultWan) && (
                    <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-xl shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center font-black text-xs uppercase text-amber-700">
                          UP
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-slate-800 uppercase">{defaultWan}</span>
                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                              CURRENT WAN
                            </span>
                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                              SYSTEM
                            </span>
                            {availableInterfaces.find(i => i.name === defaultWan)?.speed && (
                              <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${getSpeedBadgeColor(availableInterfaces.find(i => i.name === defaultWan)?.speed)}`}>
                                {formatSpeed(availableInterfaces.find(i => i.name === defaultWan)?.speed)}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            IP: {availableInterfaces.find(i => i.name === defaultWan)?.ip || 'Detecting...'}
                          </div>
                          {defaultWanSpeed && (
                            <div className="flex items-center gap-2 mt-1">
                              {defaultWanSpeed.ping_ms !== null && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                  {defaultWanSpeed.ping_ms}ms
                                </span>
                              )}
                              {defaultWanSpeed.speed_mbps !== null && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700">
                                  {defaultWanSpeed.speed_mbps} Mbps
                                </span>
                              )}
                              {defaultWanSpeed.ping_ms === null && defaultWanSpeed.speed_mbps === null && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                  No Internet
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => testDefaultWanSpeed(defaultWan!)}
                          disabled={testingDefaultSpeed}
                          className="text-[10px] font-black uppercase tracking-widest bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                        >
                          {testingDefaultSpeed ? '...' : 'Test'}
                        </button>
                        <button
                          onClick={handleConfigureDefaultWan}
                          className="text-[10px] font-black uppercase tracking-widest bg-amber-500 text-white px-4 py-1.5 rounded-lg hover:bg-amber-600 transition-colors"
                        >
                          Configure
                        </button>
                      </div>
                    </div>
                  )}

                  {wans.map((wan) => (
                    <div key={wan.id} className={`flex items-center justify-between p-4 bg-white border rounded-xl shadow-sm hover:border-blue-200 transition-colors ${defaultWan === wan.name ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'}`}>
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-black text-xs uppercase ${getStatusBadge(wan.status, wan.enabled)}`}>
                          {wan.status === 'up' ? 'UP' : wan.enabled ? 'DN' : 'OFF'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-slate-800 uppercase">{wan.name}</span>
                            {defaultWan === wan.name && (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                DEFAULT WAN
                              </span>
                            )}
                            <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${getTypeBadge(wan.type)}`}>
                              {wan.type}
                            </span>
                            {availableInterfaces.find(i => i.name === wan.name)?.speed && (
                              <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${getSpeedBadgeColor(availableInterfaces.find(i => i.name === wan.name)?.speed)}`}>
                                {formatSpeed(availableInterfaces.find(i => i.name === wan.name)?.speed)}
                              </span>
                            )}
                            {wan.is_vlan ? (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">
                                VLAN {wan.vlan_id}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {wan.ip_address ? `IP: ${wan.ip_address}` : 'No IP'} • GW: {wan.gateway || 'Auto'} • Weight: {wan.weight}
                          </div>
                          {speedResults[wan.id!] && (
                            <div className="flex items-center gap-2 mt-1">
                              {speedResults[wan.id!].ping_ms !== null && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                  {speedResults[wan.id!].ping_ms}ms
                                </span>
                              )}
                              {speedResults[wan.id!].speed_mbps !== null && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700">
                                  {speedResults[wan.id!].speed_mbps} Mbps
                                </span>
                              )}
                              {speedResults[wan.id!].ping_ms === null && speedResults[wan.id!].speed_mbps === null && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                  No Internet
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => testWanSpeed(wan.id!)}
                          disabled={testingSpeed === wan.id}
                          className="text-[10px] font-black uppercase tracking-widest bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                        >
                          {testingSpeed === wan.id ? '...' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleApplyWan(wan.id!)}
                          className="text-[10px] font-black uppercase tracking-widest bg-green-50 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => { setEditingWan(wan); setShowEditModal(true); }}
                          className="text-[10px] font-black uppercase tracking-widest bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteWan(wan.id!)}
                          className="text-[10px] font-black uppercase tracking-widest bg-red-50 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {config.topology === 'multi' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Load Balancing</h3>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={config.enabled} onChange={e => setConfig({...config, enabled: e.target.checked})} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mode</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={() => setConfig({...config, mode: 'pcc'})}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${config.mode === 'pcc' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                    >
                      <div className={`font-black text-sm uppercase ${config.mode === 'pcc' ? 'text-blue-700' : 'text-slate-700'}`}>PCC</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Per Connection Classifier</div>
                    </button>
                    <button
                      onClick={() => setConfig({...config, mode: 'ecmp'})}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${config.mode === 'ecmp' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-slate-300'}`}
                    >
                      <div className={`font-black text-sm uppercase ${config.mode === 'ecmp' ? 'text-blue-700' : 'text-slate-700'}`}>ECMP</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Equal Cost Multi-Path</div>
                    </button>
                  </div>
                </div>

                {config.mode === 'pcc' && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 animate-in fade-in">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">PCC Classifier</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-blue-300 transition-colors">
                        <input type="radio" name="pcc_method" checked={config.pcc_method === 'both_addresses'} onChange={() => setConfig({...config, pcc_method: 'both_addresses'})} className="text-blue-600 focus:ring-blue-500" />
                        <div>
                          <div className="font-bold text-xs text-slate-700 uppercase">Both Addresses</div>
                          <div className="text-[9px] text-slate-400 font-medium">Src Address & Dst Address Hashing</div>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-blue-300 transition-colors">
                        <input type="radio" name="pcc_method" checked={config.pcc_method === 'both_addresses_ports'} onChange={() => setConfig({...config, pcc_method: 'both_addresses_ports'})} className="text-blue-600 focus:ring-blue-500" />
                        <div>
                          <div className="font-bold text-xs text-slate-700 uppercase">Both Addresses and Ports</div>
                          <div className="text-[9px] text-slate-400 font-medium">Src/Dst Address & Port Hashing</div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Load Balancing'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* WAN Traffic Monitor — always visible, works for both Single and Multi-WAN */}
          {(() => {
            // Build the list of interfaces to monitor:
            // - Multi-WAN: all enabled WANs from the table
            // - Single-WAN: configured WANs first, fallback to defaultWan
            const enabledWans = wans.filter(w => !!w.enabled);
            let monitorWans: WanInterface[] = enabledWans;

            if (monitorWans.length === 0 && defaultWan) {
              // Synthesize a minimal WanInterface for the default system WAN
              monitorWans = [{
                id: 0,
                name: defaultWan,
                type: 'dhcp',
                config: {},
                gateway: null,
                weight: 1,
                enabled: 1,
                status: 'up',
                ip_address: null,
                is_vlan: 0,
                vlan_parent: null,
                vlan_id: null,
                created_at: '',
                updated_at: ''
              } as WanInterface];
            }

            if (monitorWans.length === 0) return null;
            return <WanTrafficMonitor wans={monitorWans} />;
          })()}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-600/10">
            <h3 className="font-black uppercase tracking-widest text-sm mb-4">How it works</h3>
            <div className="space-y-4 text-xs leading-relaxed opacity-90">
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">WAN Types</strong>
                DHCP for auto-config, Static for fixed IPs, PPPoE for DSL/fiber requiring login.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">Default WAN</strong>
                The system auto-detects your current default internet interface. Configure it to manage settings.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">VLAN Interfaces</strong>
                Existing VLANs appear in the Add WAN dropdown so you can use them as WAN.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">Single vs Multi-WAN</strong>
                Single WAN uses one active interface at a time. Multi-WAN enables load balancing across all active interfaces.
              </p>
              <p>
                <strong className="block text-indigo-200 mb-1 uppercase text-[10px]">Load Balancing</strong>
                Enable PCC or ECMP to distribute traffic across multiple WAN interfaces. Requires 2+ active WANs.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Add WAN Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Add WAN Interface</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Interface</label>
                <select
                  className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={addForm.name}
                  onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                >
                  <option value="">Select interface...</option>
                  {availableInterfaces.filter(i => !i.ip).map(iface => (
                    <option key={iface.name} value={iface.name}>
                      {iface.name} ({iface.type}) — NO IP
                    </option>
                  ))}
                  {availableInterfaces.filter(i => !!i.ip).map(iface => (
                    <option key={iface.name} value={iface.name}>
                      {iface.name} ({iface.type}) — IP: {iface.ip}
                    </option>
                  ))}
                  <option value="custom">Custom (Type manually)</option>
                </select>
              </div>

              {addForm.name === 'custom' && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Custom Name</label>
                  <input
                    type="text"
                    placeholder="e.g. eth1 or eth0.100 (VLAN)"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    value={customIfaceName}
                    onChange={e => setCustomIfaceName(e.target.value)}
                    autoFocus
                  />
                  {customIfaceName.includes('.') && (
                    <p className="text-[9px] text-orange-500 font-bold mt-1 uppercase">Auto-detected as VLAN interface</p>
                  )}
                </div>
              )}

              {renderConfigFields(addForm, setAddForm)}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gateway</label>
                  <input
                    type="text"
                    placeholder="192.168.1.1"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    value={addForm.gateway || ''}
                    onChange={e => setAddForm({ ...addForm, gateway: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Weight</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={addForm.weight || 1}
                    onChange={e => setAddForm({ ...addForm, weight: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!addForm.enabled}
                  onChange={e => setAddForm({ ...addForm, enabled: e.target.checked ? 1 : 0 })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-bold text-slate-600">Enable immediately</span>
              </label>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleAddWan} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-colors">Add WAN</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit WAN Modal */}
      {showEditModal && editingWan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Edit WAN: {editingWan.name}</h3>
            </div>
            <div className="p-6 space-y-4">
              {renderConfigFields(editingWan, setEditingWan)}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gateway</label>
                  <input
                    type="text"
                    placeholder="192.168.1.1"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    value={editingWan.gateway || ''}
                    onChange={e => setEditingWan({ ...editingWan, gateway: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Weight</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="w-full p-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editingWan.weight || 1}
                    onChange={e => setEditingWan({ ...editingWan, weight: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editingWan.enabled}
                  onChange={e => setEditingWan({ ...editingWan, enabled: e.target.checked ? 1 : 0 })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-bold text-slate-600">Enabled</span>
              </label>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleEditWan} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiWanSettings;
