export const formatBytes = (value?: number) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const mb = n / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

export const statusChipClass = (status?: string) => {
  if (status === 'connected') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'error') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
};

