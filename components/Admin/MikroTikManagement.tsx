import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { MikrotikBillingData, MikrotikRouter } from '../../types';
import AddRouterCard from './MikroTik/AddRouterCard';
import BillingCard from './MikroTik/BillingCard';
import ReadonlyCard from './MikroTik/ReadonlyCard';
import RouterConnectionsCard from './MikroTik/RouterConnectionsCard';
import SnapshotCard from './MikroTik/SnapshotCard';

const MikroTikManagement: React.FC = () => {
  const [routers, setRouters] = useState<MikrotikRouter[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>('');
  const [billing, setBilling] = useState<MikrotikBillingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [newRouter, setNewRouter] = useState({
    name: '',
    host: '',
    port: '8728',
    connection_type: 'api' as const,
    rest_scheme: 'http' as const,
    username: 'admin',
    password: ''
  });

  const [draftTest, setDraftTest] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; message: string }>(
    { status: 'idle', message: '' }
  );

  const selectedRouter = useMemo(
    () => routers.find(r => r.id === selectedRouterId) || null,
    [routers, selectedRouterId]
  );

  const loadRouters = async (autoSelect = true) => {
    setError('');
    const list = await apiClient.getMikrotikRouters().catch((e: any) => {
      throw new Error(e?.message || 'Failed to load routers');
    });
    setRouters(Array.isArray(list) ? list : []);
    if (autoSelect) {
      const next = (Array.isArray(list) && list.length > 0) ? list[0].id : '';
      setSelectedRouterId(prev => prev || next);
    }
  };

  const refreshBilling = async (routerId: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getMikrotikBillingData(routerId);
      setBilling(data);
    } catch (e: any) {
      setBilling(null);
      setError(e?.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRouters(true).catch((e: any) => setError(e?.message || 'Failed to load routers'));
  }, []);

  useEffect(() => {
    if (!selectedRouterId) {
      setBilling(null);
      return;
    }
    refreshBilling(selectedRouterId);
  }, [selectedRouterId]);

  const onCreateRouter = async () => {
    if (!newRouter.name || !newRouter.host || !newRouter.username || !newRouter.password) {
      alert('Name, host, username, and password are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const created = await apiClient.createMikrotikRouter({
        name: newRouter.name,
        host: newRouter.host,
        port: Number(newRouter.port) || 8728,
        connection_type: newRouter.connection_type,
        rest_scheme: newRouter.rest_scheme,
        username: newRouter.username,
        password: newRouter.password
      });
      setNewRouter({ name: '', host: '', port: '8728', connection_type: 'api', rest_scheme: 'http', username: 'admin', password: '' });
      setDraftTest({ status: 'idle', message: '' });
      await loadRouters(false);
      if (created?.id) setSelectedRouterId(created.id);
      alert('Router saved.');
    } catch (e: any) {
      setError(e?.message || 'Failed to save router');
    } finally {
      setLoading(false);
    }
  };

  const onTestDraft = async () => {
    if (!newRouter.host || !newRouter.username || !newRouter.password) {
      setDraftTest({ status: 'error', message: 'Host, username, and password are required to test.' });
      return;
    }
    setDraftTest({ status: 'loading', message: 'Testing connection...' });
    try {
      const result = await apiClient.testMikrotikRouterDraft({
        host: newRouter.host,
        port: Number(newRouter.port) || undefined,
        connection_type: newRouter.connection_type,
        rest_scheme: newRouter.rest_scheme,
        username: newRouter.username,
        password: newRouter.password
      });
      if (result?.success) {
        const identity = result.snapshot?.identity ? ` (${result.snapshot.identity})` : '';
        setDraftTest({ status: 'success', message: `Connection OK${identity}.` });
      } else {
        setDraftTest({ status: 'error', message: result?.error || 'Connection failed.' });
      }
    } catch (e: any) {
      setDraftTest({ status: 'error', message: e?.message || 'Connection failed.' });
    }
  };

  const onDeleteRouter = async (routerId: string) => {
    if (!confirm('Delete this router connection?')) return;
    setLoading(true);
    setError('');
    try {
      await apiClient.deleteMikrotikRouter(routerId);
      await loadRouters(false);
      setBilling(null);
      setSelectedRouterId(prev => (prev === routerId ? '' : prev));
    } catch (e: any) {
      setError(e?.message || 'Failed to delete router');
    } finally {
      setLoading(false);
    }
  };

  const onTestRouter = async (routerId: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.testMikrotikRouter(routerId);
      if (result?.success) {
        alert('Connection OK.');
        await loadRouters(false);
      } else {
        alert(result?.error || 'Connection failed.');
      }
    } catch (e: any) {
      setError(e?.message || 'Connection test failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">MikroTik Management</h1>
          <p className="text-xs text-slate-500">Read-only billing-related data via RouterOS API or REST API.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadRouters(false)}
            className="admin-btn-secondary px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest"
            disabled={loading}
          >
            Refresh Routers
          </button>
          <button
            type="button"
            onClick={() => selectedRouterId && refreshBilling(selectedRouterId)}
            className="admin-btn-primary px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest"
            disabled={loading || !selectedRouterId}
          >
            Refresh Data
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <RouterConnectionsCard
            routers={routers}
            selectedRouterId={selectedRouterId}
            loading={loading}
            onSelect={setSelectedRouterId}
            onDelete={onDeleteRouter}
            onTestSelected={() => selectedRouter && onTestRouter(selectedRouter.id)}
          />

          <AddRouterCard
            loading={loading}
            draftTest={draftTest}
            value={newRouter}
            onChange={(next) => {
              setNewRouter(next);
              if (draftTest.status !== 'idle') setDraftTest({ status: 'idle', message: '' });
            }}
            onTest={onTestDraft}
            onSave={onCreateRouter}
          />
        </div>

        <div className="lg:col-span-8 space-y-6">
          <SnapshotCard selectedRouter={selectedRouter} selectedRouterId={selectedRouterId} loading={loading} billing={billing} />
          <BillingCard billing={billing} loading={loading} />
          <ReadonlyCard />
        </div>
      </div>
    </div>
  );
};

export default MikroTikManagement;
