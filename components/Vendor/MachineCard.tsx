import React from 'react';
import { VendorMachine } from '../../lib/supabase-vendor';

const formatMoney = (value: number | string | null | undefined) =>
  `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatLastSeen = (value?: string | null) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
};

const statusClasses = (status?: string | null) => {
  if (status === 'online') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'maintenance') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

interface MachineCardProps {
  machine: VendorMachine;
}

const MachineCard: React.FC<MachineCardProps> = ({ machine }) => {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black uppercase tracking-tight text-slate-950">
            {machine.machine_name || 'Unnamed Machine'}
          </h3>
          <p className="mt-1 truncate text-[10px] font-mono text-slate-500">{machine.hardware_id}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${statusClasses(machine.status)}`}>
          {machine.status || 'offline'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Revenue</div>
          <div className="text-lg font-black text-slate-950">{formatMoney(machine.total_revenue)}</div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Sessions</div>
          <div className="text-lg font-black text-slate-950">{machine.active_sessions_count || 0}</div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPU</div>
          <div className="text-sm font-bold text-slate-800">
            {machine.cpu_temp ? `${Number(machine.cpu_temp).toFixed(1)} C` : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Last Seen</div>
          <div className="text-xs font-bold text-slate-800">{formatLastSeen(machine.last_seen)}</div>
        </div>
      </div>

      {machine.location && (
        <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {machine.location}
        </div>
      )}
    </article>
  );
};

export default MachineCard;

