import React, { useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

interface LicenseDetails {
  active: boolean;
  type: string;
  label: string;
  expiresAt: string | null;
}

interface FirstRunSetupProps {
  hardwareId: string;
  onComplete: () => void;
}

const FirstRunSetup: React.FC<FirstRunSetupProps> = ({ hardwareId, onComplete }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [license, setLicense] = useState<LicenseDetails | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const verifyAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/setup/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Account verification failed');
      setEmail(data.email);
      setSetupToken(data.setupToken);
      setLicense(data.license);
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Unable to reach the RJD account service');
    } finally {
      setLoading(false);
    }
  };

  const finishSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Admin passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken, newPassword })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not finish setup');
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Could not finish setup');
    } finally {
      setLoading(false);
    }
  };

  const expiration = license?.expiresAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(license.expiresAt))
    : 'No expiration';

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-8">
        <div className="grid w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl lg:grid-cols-[0.8fr_1.2fr]">
          <section className="bg-slate-950 p-7 text-white lg:p-10">
            <div className="mb-10 flex h-10 w-10 items-center justify-center rounded-md bg-indigo-500">
              <ShieldCheck size={22} aria-hidden="true" />
            </div>
            <p className="text-xs font-bold uppercase text-indigo-300">RJD PisoWiFi</p>
            <h1 className="mt-2 text-3xl font-black">Machine setup</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">
              Connect this machine to the RJD account that owns its license, then secure the local admin portal.
            </p>
            <div className="mt-10 border-t border-slate-800 pt-6">
              <p className="text-xs font-bold uppercase text-slate-500">Hardware ID</p>
              <p className="mt-2 break-all font-mono text-sm text-slate-200">{hardwareId || 'Detecting...'}</p>
            </div>
          </section>

          <section className="p-6 lg:p-10">
            {!license ? (
              <form onSubmit={verifyAccount} className="mx-auto max-w-md">
                <p className="text-xs font-bold uppercase text-indigo-600">Step 1 of 2</p>
                <h2 className="mt-2 text-2xl font-black">Connect RJD account</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Sign in with the account created on the RJD website. An available license will be used first; otherwise this hardware receives its one-time 7-day trial.
                </p>

                <label className="mt-7 block text-xs font-bold text-slate-700" htmlFor="setup-email">Email</label>
                <div className="relative mt-2">
                  <Mail className="absolute left-3 top-3 text-slate-400" size={18} aria-hidden="true" />
                  <input id="setup-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-md border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="account@example.com" />
                </div>

                <label className="mt-4 block text-xs font-bold text-slate-700" htmlFor="setup-password">RJD website password</label>
                <div className="relative mt-2">
                  <LockKeyhole className="absolute left-3 top-3 text-slate-400" size={18} aria-hidden="true" />
                  <input id="setup-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-md border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                </div>

                {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

                <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                  Check license
                </button>
                <a href="https://wifi.rjdtech.shop/" target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800">
                  Create an RJD account <ExternalLink size={15} aria-hidden="true" />
                </a>
              </form>
            ) : (
              <form onSubmit={finishSetup} className="mx-auto max-w-md">
                <p className="text-xs font-bold uppercase text-indigo-600">Step 2 of 2</p>
                <h2 className="mt-2 text-2xl font-black">License active</h2>

                <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 font-bold text-emerald-800"><CheckCircle2 size={19} /> License Active</div>
                  <dl className="mt-4 grid grid-cols-[80px_1fr] gap-y-2 text-sm">
                    <dt className="font-semibold text-slate-500">Email</dt><dd className="break-all font-medium text-slate-800">{email}</dd>
                    <dt className="font-semibold text-slate-500">Expires</dt><dd className="font-medium text-slate-800">{expiration}</dd>
                    <dt className="font-semibold text-slate-500">Label</dt><dd className="font-medium text-slate-800">{license.label}</dd>
                  </dl>
                </div>

                <h3 className="mt-7 flex items-center gap-2 text-base font-black"><KeyRound size={18} /> New admin password</h3>
                <p className="mt-1 text-sm text-slate-500">Use username <strong>admin</strong> when the local login page opens.</p>

                <label className="mt-4 block text-xs font-bold text-slate-700" htmlFor="new-admin-password">Password</label>
                <input id="new-admin-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />

                <label className="mt-4 block text-xs font-bold text-slate-700" htmlFor="confirm-admin-password">Confirm password</label>
                <input id="confirm-admin-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />

                {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

                <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}
                  Change new password
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
};

export default FirstRunSetup;
