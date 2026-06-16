import React, { useState } from 'react';
import { signInVendor } from '../../lib/supabase-vendor';

interface VendorLoginProps {
  onLogin: () => void;
}

const VendorLogin: React.FC<VendorLoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInVendor(email.trim(), password);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Vendor login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <section className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-2xl p-6">
        <div className="mb-6">
          <div className="w-12 h-12 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-sm mb-4">
            RJD
          </div>
          <h1 className="text-xl font-black text-slate-950 uppercase tracking-tight">Vendor Dashboard</h1>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
            Supabase cloud access
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[10px] font-bold text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="vendor@example.com"
            />
          </label>

          <label className="block">
            <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="Password"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-950 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
};

export default VendorLogin;

