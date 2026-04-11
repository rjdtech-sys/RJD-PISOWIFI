import React from 'react';

const ReadonlyCard: React.FC = () => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Safety</div>
      <div className="text-sm font-bold text-slate-900 mt-1">Read-only Mode</div>
      <div className="text-[11px] text-slate-600 mt-2 leading-relaxed">
        This page only reads from RouterOS (print/get). It does not create, update, disable, or remove anything on MikroTik.
      </div>
    </div>
  );
};

export default ReadonlyCard;

