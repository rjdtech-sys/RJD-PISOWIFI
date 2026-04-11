import React from 'react';
import { MikrotikRouter } from '../../../types';
import { statusChipClass } from './mikrotikUi';

type Props = {
  routers: MikrotikRouter[];
  selectedRouterId: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTestSelected: () => void;
};

const RouterConnectionsCard: React.FC<Props> = ({
  routers,
  selectedRouterId,
  loading,
  onSelect,
  onDelete,
  onTestSelected
}) => {
  const selectedRouter = routers.find(r => r.id === selectedRouterId) || null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Routers</div>
            <div className="text-sm font-bold text-slate-900">Connections</div>
          </div>
          {selectedRouter && (
            <button
              type="button"
              onClick={onTestSelected}
              className="admin-btn-secondary px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest"
              disabled={loading}
            >
              Test
            </button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2">
        {routers.length === 0 && (
          <div className="px-2 py-6 text-center text-[11px] text-slate-500">No routers configured.</div>
        )}
        {routers.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
              selectedRouterId === r.id
                ? 'border-blue-200 bg-blue-50'
                : 'border-slate-100 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{r.host}:{r.port} • {(r.connection_type || 'api').toUpperCase()} • {r.username}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-widest ${statusChipClass(r.status)}`}>
                  {r.status || 'disconnected'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(r.id);
                  }}
                  className="admin-btn-danger px-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest"
                  disabled={loading}
                >
                  Delete
                </button>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RouterConnectionsCard;
