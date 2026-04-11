import React from 'react';
import { MikrotikBillingData, MikrotikRouter } from '../../../types';
import { formatBytes } from './mikrotikUi';

type Props = {
  selectedRouter: MikrotikRouter | null;
  selectedRouterId: string;
  loading: boolean;
  billing: MikrotikBillingData | null;
};

const SnapshotCard: React.FC<Props> = ({ selectedRouter, selectedRouterId, loading, billing }) => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Snapshot</div>
          <div className="text-sm font-bold text-slate-900">Router Overview</div>
        </div>
        {selectedRouter && (
          <div className="text-right">
            <div className="text-xs font-bold text-slate-900">{selectedRouter.name}</div>
            <div className="text-[11px] text-slate-500">{selectedRouter.host}:{selectedRouter.port}</div>
          </div>
        )}
      </div>

      {!selectedRouterId ? (
        <div className="p-6 text-sm text-slate-500">Select a router to view data.</div>
      ) : loading ? (
        <div className="p-6 animate-pulse">
          <div className="h-4 w-56 bg-slate-100 rounded mb-3" />
          <div className="h-3 w-80 bg-slate-100 rounded mb-2" />
          <div className="h-3 w-64 bg-slate-100 rounded" />
        </div>
      ) : billing ? (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Identity</div>
            <div className="text-sm font-bold text-slate-900 mt-1">{billing.snapshot.identity || 'Unknown'}</div>
            <div className="text-[11px] text-slate-500 mt-1">Version: {billing.snapshot.version || 'N/A'}</div>
            <div className="text-[11px] text-slate-500">Board: {billing.snapshot.board_name || 'N/A'}</div>
          </div>
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Resources</div>
            <div className="text-[11px] text-slate-700 mt-2 flex items-center justify-between">
              <span>Uptime</span>
              <span className="font-semibold">{billing.snapshot.uptime || 'N/A'}</span>
            </div>
            <div className="text-[11px] text-slate-700 mt-1 flex items-center justify-between">
              <span>CPU Load</span>
              <span className="font-semibold">{typeof billing.snapshot.cpu_load === 'number' ? `${billing.snapshot.cpu_load}%` : 'N/A'}</span>
            </div>
            <div className="text-[11px] text-slate-700 mt-1 flex items-center justify-between">
              <span>Free Memory</span>
              <span className="font-semibold">{billing.snapshot.free_memory ? formatBytes(billing.snapshot.free_memory) : 'N/A'}</span>
            </div>
            <div className="text-[11px] text-slate-700 mt-1 flex items-center justify-between">
              <span>Total Memory</span>
              <span className="font-semibold">{billing.snapshot.total_memory ? formatBytes(billing.snapshot.total_memory) : 'N/A'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 text-sm text-slate-500">No data available.</div>
      )}
    </div>
  );
};

export default SnapshotCard;

