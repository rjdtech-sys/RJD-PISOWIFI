import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assertVendorAccess,
  claimMachine,
  fetchPendingMachines,
  fetchVendorDashboardSnapshot,
  signOutVendor,
  vendorSupabase,
  VendorDashboardSnapshot,
  VendorMachine
} from '../../lib/supabase-vendor';
import MachineCard from './MachineCard';
import SalesTable from './SalesTable';

interface VendorDashboardProps {
  onLogout: () => void;
}

const emptySnapshot: VendorDashboardSnapshot = {
  machines: [],
  sales: [],
  rentalDevices: [],
  realtimeRows: []
};

const formatMoney = (value: number | string | null | undefined) =>
  `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VendorDashboard: React.FC<VendorDashboardProps> = ({ onLogout }) => {
  const [snapshot, setSnapshot] = useState<VendorDashboardSnapshot>(emptySnapshot);
  const [pendingMachines, setPendingMachines] = useState<VendorMachine[]>([]);
  const [vendorUserId, setVendorUserId] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      setError('');
      const access = await assertVendorAccess();
      setVendorUserId(access.user.id);
      setVendorEmail(access.user.email || access.user.id);
      const [nextSnapshot, nextPending] = await Promise.all([
        fetchVendorDashboardSnapshot(),
        fetchPendingMachines()
      ]);
      setSnapshot(nextSnapshot);
      setPendingMachines(nextPending);
    } catch (err: any) {
      setError(err.message || 'Failed to load vendor dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();

    const channel = vendorSupabase
      .channel('rjd-vendor-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors' }, () => loadDashboard())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales_logs' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_dashboard_realtime' }, () => loadDashboard())
      .subscribe();

    return () => {
      vendorSupabase.removeChannel(channel);
    };
  }, [loadDashboard]);

  const totals = useMemo(() => {
    const salesRevenue = snapshot.sales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0);
    const machineRevenue = snapshot.machines.reduce((sum, machine) => sum + Number(machine.total_revenue || 0), 0);
    const onlineMachines = snapshot.machines.filter((machine) => machine.status === 'online').length;
    const activeRentalDevices = snapshot.rentalDevices.filter((device) => device.status === 'rented').length;

    return {
      salesRevenue,
      machineRevenue,
      onlineMachines,
      activeRentalDevices
    };
  }, [snapshot]);

  const handleClaim = async (machine: VendorMachine) => {
    setClaimingId(machine.id);
    setError('');

    try {
      await claimMachine(machine.id, vendorUserId, machine.machine_name);
      await loadDashboard();
    } catch (err: any) {
      setError(err.message || 'Failed to claim machine');
    } finally {
      setClaimingId('');
    }
  };

  const handleLogout = async () => {
    await signOutVendor();
    onLogout();
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Loading vendor dashboard</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-black uppercase tracking-tight">RJD Vendor Dashboard</h1>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{vendorEmail}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadDashboard}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700"
            >
              Refresh
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5">
        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Machines" value={snapshot.machines.length} detail={`${totals.onlineMachines} online`} />
          <Stat label="Recent Sales" value={formatMoney(totals.salesRevenue)} detail={`${snapshot.sales.length} rows loaded`} />
          <Stat label="Fleet Revenue" value={formatMoney(totals.machineRevenue)} detail="from machine totals" />
          <Stat label="Phone Rentals" value={snapshot.rentalDevices.length} detail={`${totals.activeRentalDevices} active`} />
        </section>

        {pendingMachines.length > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="mb-3">
              <h2 className="text-xs font-black uppercase tracking-widest text-amber-900">Pending Machines</h2>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                Claim only hardware that belongs to your deployment.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {pendingMachines.map((machine) => (
                <div key={machine.id} className="rounded-lg border border-amber-200 bg-white p-3">
                  <div className="text-sm font-black text-slate-950">{machine.machine_name || 'Pending Machine'}</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-500">{machine.hardware_id}</div>
                  <button
                    onClick={() => handleClaim(machine)}
                    disabled={claimingId === machine.id}
                    className="mt-3 rounded-md bg-amber-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60"
                  >
                    {claimingId === machine.id ? 'Claiming...' : 'Claim Machine'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-950">Machines</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {snapshot.machines.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs font-bold text-slate-400 lg:col-span-3">
                No machines are assigned to this vendor account yet.
              </div>
            ) : (
              snapshot.machines.map((machine) => <MachineCard key={machine.id} machine={machine} />)
            )}
          </div>
        </section>

        <SalesTable sales={snapshot.sales} />
      </div>
    </main>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; detail: string }> = ({ label, value, detail }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
    <div className="mt-2 text-xl font-black text-slate-950">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{detail}</div>
  </div>
);

export default VendorDashboard;

