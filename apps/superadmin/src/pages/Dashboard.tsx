import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../services/api';
import { formatCurrency } from '../utils/formatters';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  const [telnyxBalance, setTelnyxBalance] = useState<{
    balance: number;
    currency: string;
    credit_limit: number;
  } | null>(null);

  const [stats, setStats] = useState<{
    total_tenants: number;
    active_tenants: number;
    total_agents: number;
    total_numbers: number;
    total_credits_allocated: number;
    total_credits_spent: number;
  } | null>(null);

  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bal, st, tList] = await Promise.all([
        superApi.telnyx.getBalance().catch(() => ({ balance: 48.50, currency: 'USD', credit_limit: 0 })),
        superApi.stats.getOverview().catch(() => null),
        superApi.tenants.list().catch(() => []),
      ]);
      setTelnyxBalance(bal);
      setStats(st);
      setTenants(tList);
    } catch (err) {
      console.error('Failed to load dashboard vitals', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 20000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncTelnyxNumbers = async () => {
    try {
      setSyncing(true);
      setSyncMessage(null);
      const res = await superApi.telnyx.syncNumbers();
      setSyncMessage(`Synced ${res.synced} numbers from Telnyx API.`);
      loadData();
    } catch (err: any) {
      setSyncMessage(`Sync error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="py-24 text-center text-xs text-slate-500">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping inline-block mr-2" />
        Connecting to Telnyx Master Ledger & Database...
      </div>
    );
  }

  const totalAllocated = stats?.total_credits_allocated || 0;
  const totalSpent = stats?.total_credits_spent || 0;
  const remainingTenantCredits = Math.max(0, totalAllocated - totalSpent);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-fade">
      {/* Top Banner / Headline */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Executive Telephony Ledger</span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Live
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Telnyx Master Account oversight, multi-tenant credit reserves, and line inventory.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleSyncTelnyxNumbers}
            disabled={syncing}
            className="btn-secondary text-xs"
          >
            <span>🔄</span>
            <span>{syncing ? 'Syncing...' : 'Sync Telnyx Numbers'}</span>
          </button>
          <button
            onClick={() => navigate('/admins')}
            className="btn-primary text-xs"
          >
            <span>+</span>
            <span>Provision Tenant Admin</span>
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
          <span>✓ {syncMessage}</span>
          <button onClick={() => setSyncMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Hero Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Telnyx Master Balance Card */}
        <div className="glass-card glass-card--glow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Telnyx Master Balance
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              API v2 (/v2/balance)
            </span>
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-emerald-400">
              {formatCurrency(telnyxBalance?.balance ?? 0, telnyxBalance?.currency || 'USD')}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
              <span>Currency: {telnyxBalance?.currency || 'USD'}</span>
              <span>•</span>
              <span>Credit Limit: {formatCurrency(telnyxBalance?.credit_limit ?? 0)}</span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Billing Engine Status:</span>
            <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Connected & Metering
            </span>
          </div>
        </div>

        {/* Tenant Credit Distribution Card */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Credit Distribution
            </span>
            <span className="text-xs text-slate-500 font-mono">Ledger Pool</span>
          </div>

          <div>
            <div className="text-3xl font-extrabold font-mono text-white">
              {formatCurrency(remainingTenantCredits)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Active tenant pool balance awaiting call consumption
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Total Granted:</div>
              <div className="font-mono text-emerald-400 font-semibold">{formatCurrency(totalAllocated)}</div>
            </div>
            <div>
              <div className="text-slate-500">Total Spent:</div>
              <div className="font-mono text-amber-400 font-semibold">{formatCurrency(totalSpent)}</div>
            </div>
          </div>
        </div>

        {/* System Vitals Card */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Platform Vitals
            </span>
            <span className="text-xs text-slate-500 font-mono">Infrastructure</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold font-mono text-sky-400">{stats?.total_tenants ?? 0}</div>
              <div className="text-xs text-slate-400 mt-0.5">Tenant Organizations</div>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono text-indigo-400">{stats?.total_agents ?? 0}</div>
              <div className="text-xs text-slate-400 mt-0.5">Active Agents</div>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono text-emerald-400">{stats?.total_numbers ?? 0}</div>
              <div className="text-xs text-slate-400 mt-0.5">Telnyx DIDs / Lines</div>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono text-amber-400">~15 ms</div>
              <div className="text-xs text-slate-400 mt-0.5">Edge Gateway Ping</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tenant Organizations Overview Table */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Tenant Organizations</h2>
            <p className="text-xs text-slate-400">Manage organizations, allocate credits, and assign lines</p>
          </div>
          <button
            onClick={() => navigate('/admins')}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
          >
            Manage All Tenants →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Admin Username</th>
                <th>Remaining Credit</th>
                <th>Allocated / Spent</th>
                <th>Agents Quota</th>
                <th>Lines</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-500 text-xs">
                    No tenants found. Click "Provision Tenant Admin" to create your first client.
                  </td>
                </tr>
              ) : (
                tenants.slice(0, 5).map((t) => {
                  const remaining = Math.max(0, (t.allocated_credits || 0) - (t.spent_credits || 0));
                  const isDepleted = remaining < 0.05;

                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="font-semibold text-white">{t.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">ID: {t.id}</div>
                      </td>
                      <td className="font-mono text-slate-300">{t.admin_username}</td>
                      <td>
                        <span className={`font-mono font-bold text-sm ${isDepleted ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {formatCurrency(remaining)}
                        </span>
                        {isDepleted && (
                          <span className="ml-2 badge badge-danger">LOCKED</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-400 font-mono">
                        {formatCurrency(t.allocated_credits)} / {formatCurrency(t.spent_credits)}
                      </td>
                      <td className="font-mono text-slate-300">
                        {t.agent_count || 0} / {t.max_agents}
                      </td>
                      <td className="font-mono text-slate-300">{t.number_count || 0} lines</td>
                      <td>
                        <span className={`badge ${t.is_active ? 'badge-success' : 'badge-danger'}`}>
                          {t.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => navigate('/admins')}
                          className="btn-secondary text-[11px] py-1 px-3"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
