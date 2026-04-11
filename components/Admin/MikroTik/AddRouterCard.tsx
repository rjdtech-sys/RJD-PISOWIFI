import React from 'react';

type Props = {
  loading: boolean;
  draftTest: { status: 'idle' | 'loading' | 'success' | 'error'; message: string };
  value: { name: string; host: string; port: string; connection_type: 'api' | 'rest'; rest_scheme: 'http' | 'https'; username: string; password: string };
  onChange: (next: { name: string; host: string; port: string; connection_type: 'api' | 'rest'; rest_scheme: 'http' | 'https'; username: string; password: string }) => void;
  onTest: () => void;
  onSave: () => void;
};

const AddRouterCard: React.FC<Props> = ({ loading, draftTest, value, onChange, onTest, onSave }) => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Add Router</div>
        <div className="text-sm font-bold text-slate-900">New Connection</div>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Connection Type</label>
          <select
            className="w-full admin-input text-xs"
            value={value.connection_type}
            onChange={(e) => {
              const nextType = (e.target.value === 'rest') ? 'rest' : 'api';
              const nextPort = nextType === 'rest' ? '80' : '8728';
              onChange({ ...value, connection_type: nextType, port: nextPort });
            }}
          >
            <option value="api">RouterOS API</option>
            <option value="rest">REST API (HTTP/HTTPS)</option>
          </select>
        </div>
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
              placeholder={value.connection_type === 'rest' ? '80' : '8728'}
            />
          </div>
        </div>

        {value.connection_type === 'rest' && (
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Scheme</label>
            <select
              className="w-full admin-input text-xs"
              value={value.rest_scheme}
              onChange={(e) => onChange({ ...value, rest_scheme: (e.target.value === 'https') ? 'https' : 'http' })}
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </div>
        )}

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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onTest}
            className="admin-btn-secondary w-full py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest"
            disabled={loading || draftTest.status === 'loading'}
          >
            {draftTest.status === 'loading' ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="admin-btn-primary w-full py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest"
            disabled={loading}
          >
            Save Router
          </button>
        </div>

        {draftTest.status !== 'idle' && (
          <div
            className={`rounded-xl border px-3 py-2 text-[11px] ${
              draftTest.status === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : draftTest.status === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            {draftTest.message}
          </div>
        )}

        <div className="text-[11px] text-slate-500 leading-relaxed">
          Credentials are stored on this device and used only by the server to fetch RouterOS data.
        </div>
      </div>
    </div>
  );
};


export default AddRouterCard;
