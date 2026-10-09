import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, User, ArrowRight } from 'lucide-react';
import { superApi } from '../services/api';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('superadmin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    try {
      setLoading(true);
      setError(null);
      const res = await superApi.auth.login({ username, password });
      if (res.success && res.token) {
        localStorage.setItem('super_admin_token', res.token);
        navigate('/');
      } else {
        throw new Error('Authentication failed');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid Super Admin credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060911] flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Background Radial Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/10 blur-[130px] rounded-full pointer-events-none" />

      {/* Centered Floating 3D Glass Card */}
      <div className="w-full max-w-md glass-panel rounded-3xl p-8 border border-slate-800/90 shadow-2xl relative z-10 transition-all hover:border-emerald-500/30 animate-fade">
        {/* Header Icon */}
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-6 mx-auto">
          <ShieldCheck className="w-6 h-6 text-slate-950" />
        </div>

        <h1 className="text-xl font-bold text-center text-white mb-1 tracking-tight">Super Admin Portal</h1>
        <p className="text-xs text-center text-slate-400 mb-6">
          Telnyx Master Ledger & Multi-Tenant Provisioning
        </p>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs mb-5 flex items-center gap-2">
            <span>⛔</span>
            <span>{error}</span>
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Super Admin Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="superadmin"
                required
                className="w-full bg-slate-950/70 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full bg-slate-950/70 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <span>{loading ? 'Authenticating...' : 'Sign In to Super Admin'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-800/60 text-center">
          <span className="text-[11px] text-slate-500 font-mono">
            NextGenDial Enterprise Telephony Engine • Telnyx Master API v2
          </span>
        </div>
      </div>
    </div>
  );
};
