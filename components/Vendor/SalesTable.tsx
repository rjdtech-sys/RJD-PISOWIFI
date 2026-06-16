import React from 'react';
import { VendorSaleLog } from '../../lib/supabase-vendor';

const formatMoney = (value: number | string | null | undefined, currency = 'PHP') =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return '-';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

interface SalesTableProps {
  sales: VendorSaleLog[];
}

const SalesTable: React.FC<SalesTableProps> = ({ sales }) => {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-950">Recent Sales</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500">Date</th>
              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500">Machine</th>
              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500">Type</th>
              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500">Duration</th>
              <th className="px-4 py-3 text-right text-[9px] font-black uppercase tracking-widest text-slate-500">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sales.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs font-bold text-slate-400">
                  No cloud sales are visible for this vendor yet.
                </td>
              </tr>
            ) : (
              sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-700">
                    {sale.created_at ? new Date(sale.created_at).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-900">
                    {sale.vendors?.machine_name || sale.machine_id}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {sale.transaction_type || 'sale'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-700">
                    {formatDuration(sale.session_duration)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-black text-slate-950">
                    {formatMoney(sale.amount, sale.currency || 'PHP')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default SalesTable;

