import React from 'react';

type Props = {
  loading: boolean;
  value: { name: string; host: string; port: string; username: string; password: string };
  onChange: (next: { name: string; host: string; port: string; username: string; password: string }) => void;
  onSave: () => void;
};

const AddRouterCard: React.FC<Props> = ({ loading, value, onChange, onSave }) => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Add Router</div>
        <div className="text-sm font-bold text-slate-900">New Connection</div>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Name</label>
          <input
            className="w-full admin-input text-xs"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Office Router"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Host</label>
            <input
              className="w-full admin-input text-xs"
              value={value.host}
              onChange={(e) => onChange({ ...value, host: e.target.value })}
              placeholder="192.168.88.1"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Port</label>
            <input
              className="w-full admin-input text-xs"
              value={value.port}
              onChange={(e) => onChange({ ...value, port: e.target.value })}
              placeholder="8728"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Username</label>
          <input
            className="w-full admin-input text-xs"
            value={value.username}
            onChange={(e) => onChange({ ...value, username: e.target.value })}
            placeholder="admin"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Password</label>
          <input
            type="password"
            className="w-full admin-input text-xs"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            placeholder="••••••••"
          />
        </div>
        <button
          type="button"
          onClick={onSave}
          className="admin-btn-primary w-full py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest"
          disabled={loading}
        >
          Save Router
        </button>
        <div className="text-[11px] text-slate-500 leading-relaxed">
          Credentials are stored on this device and used only by the server to fetch RouterOS data.
        </div>
      </div>
    </div>
  );
};

export default AddRouterCard;

