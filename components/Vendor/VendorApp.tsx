import React, { useEffect, useState } from 'react';
import { getVendorSession } from '../../lib/supabase-vendor';
import VendorDashboard from './VendorDashboard';
import VendorLogin from './VendorLogin';

const VendorApp: React.FC = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkSession = async () => {
    setChecking(true);
    try {
      const { session } = await getVendorSession();
      setAuthenticated(!!session);
    } catch {
      setAuthenticated(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    document.title = 'RJD Vendor Dashboard';
    checkSession();
  }, []);

  if (checking) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Checking vendor session</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return <VendorLogin onLogin={() => setAuthenticated(true)} />;
  }

  return <VendorDashboard onLogout={() => setAuthenticated(false)} />;
};

export default VendorApp;

