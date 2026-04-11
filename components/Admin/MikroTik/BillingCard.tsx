import React, { useMemo, useState } from 'react';
import { MikrotikBillingData } from '../../../types';

type Props = {
  billing: MikrotikBillingData | null;
  loading: boolean;
};

const BillingCard: React.FC<Props> = ({ billing, loading }) => {
  const [activeView, setActiveView] = useState<'profiles' | 'secrets' | 'actives'>('secrets');
  const [search, setSearch] = useState('');

  const filteredSecrets = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = billing?.ppp_secrets || [];
    if (!q) return rows;
    return rows.filter((r: any) => String(r.name || '').toLowerCase().includes(q));
  }, [billing, search]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Billing Data</div>
          <div className="text-sm font-bold text-slate-900">PPPoE</div>
          {!!(billing?.errors && billing.errors.length > 0) && (
            <div className="text-[11px] text-amber-700 mt-1">Some data could not be fetched. Check permissions and REST API access.</div>
          )}
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <input
            className="admin-input text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search secrets by username"
            disabled={!billing || loading}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('secrets')}
              className={`px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border ${
                activeView === 'secrets' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              disabled={loading}
            >
              Secrets
            </button>
            <button
              type="button"
              onClick={() => setActiveView('profiles')}
              className={`px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border ${
                activeView === 'profiles' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              disabled={loading}
            >
              Profiles
            </button>
            <button
              type="button"
              onClick={() => setActiveView('actives')}
              className={`px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border ${
                activeView === 'actives' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              disabled={loading}
            >
              Active
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        {!!(billing?.errors && billing.errors.length > 0) && (
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px]">
            {billing.errors[0]}
          </div>
        )}
        {activeView === 'secrets' && (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2 text-left font-bold">Username</th>
                <th className="px-4 py-2 text-left font-bold">Profile</th>
                <th className="px-4 py-2 text-left font-bold">Service</th>
                <th className="px-4 py-2 text-left font-bold">Disabled</th>
                <th className="px-4 py-2 text-left font-bold">Comment</th>
              </tr>
            </thead>
            <tbody>
              {(!billing || filteredSecrets.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[11px] text-slate-500">
                    No secrets found.
                  </td>
                </tr>
              )}
              {billing && filteredSecrets.map((r: any, idx: number) => (
                <tr key={(r.id || r['.id'] || r.name || 'row') + idx} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-semibold text-slate-900">{r.name || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r.profile || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r.service || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{String(r.disabled || '')}</td>
                  <td className="px-4 py-2 text-slate-600">{r.comment || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeView === 'profiles' && (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2 text-left font-bold">Name</th>
                <th className="px-4 py-2 text-left font-bold">Rate Limit</th>
                <th className="px-4 py-2 text-left font-bold">Local Address</th>
                <th className="px-4 py-2 text-left font-bold">Remote Address</th>
              </tr>
            </thead>
            <tbody>
              {(!billing || (billing.ppp_profiles || []).length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[11px] text-slate-500">
                    No profiles found.
                  </td>
                </tr>
              )}
              {billing && (billing.ppp_profiles || []).map((r: any, idx: number) => (
                <tr key={(r.id || r['.id'] || r.name || 'row') + idx} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-semibold text-slate-900">{r.name || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r['rate-limit'] || r.rate_limit || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r['local-address'] || r.local_address || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r['remote-address'] || r.remote_address || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeView === 'actives' && (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2 text-left font-bold">Username</th>
                <th className="px-4 py-2 text-left font-bold">Address</th>
                <th className="px-4 py-2 text-left font-bold">Uptime</th>
                <th className="px-4 py-2 text-left font-bold">Caller ID</th>
              </tr>
            </thead>
            <tbody>
              {(!billing || (billing.ppp_actives || []).length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[11px] text-slate-500">
                    No active sessions.
                  </td>
                </tr>
              )}
              {billing && (billing.ppp_actives || []).map((r: any, idx: number) => (
                <tr key={(r.id || r['.id'] || r.name || 'row') + idx} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-semibold text-slate-900">{r.name || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r.address || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-700">{r.uptime || 'N/A'}</td>
                  <td className="px-4 py-2 text-slate-600">{r['caller-id'] || r.caller_id || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default BillingCard;
