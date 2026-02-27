import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';

interface LoginProps {
  onLoginSuccess: (token: string) => void;
  onBack: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess, onBack }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [companySettings, setCompanySettings] = useState<{ companyName: string, companyLogo: string | null }>({
    companyName: 'AJC PISOWIFI',
    companyLogo: null
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await apiClient.getCompanySettings();
        setCompanySettings(settings);
      } catch (e) {
        // Ignore error, use defaults
      }
    };
    fetchSettings();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (data.success) {
        onLoginSuccess(data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white p-6 rounded-2xl shadow-2xl border border-slate-200">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg overflow-hidden bg-slate-50 border border-slate-100">
             {companySettings.companyLogo ? (
               <img src={companySettings.companyLogo} className="w-full h-full object-contain p-2" alt="Logo" />
             ) : (
               <span className="text-2xl font-black text-blue-600">
                 {companySettings.companyName.substring(0, 3).toUpperCase()}
               </span>
             )}
          </div>
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">{companySettings.companyName}</h2>
          <p className="text-slate-400 text-[9px] font-bold uppercase tracking-tighter mt-1">Admin Control Panel</p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-100 text-red-600 p-3 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
            <span>⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[10px] font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all"
              placeholder="Username"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[10px] font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all"
              placeholder="Password"
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="admin-btn-primary w-full py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {loading ? 'Verifying...' : 'Login to Console'}
          </button>
        </form>

        <button 
          onClick={onBack}
          className="w-full mt-4 text-slate-400 text-[9px] font-black uppercase tracking-widest hover:text-slate-900 transition-colors"
        >
          Return to Portal
        </button>
      </div>
    </div>
  );
};

export default Login;
