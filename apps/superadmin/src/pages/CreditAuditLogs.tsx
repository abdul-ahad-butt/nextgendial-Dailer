import React, { useEffect, useState } from 'react';
import { superApi } from '../services/api';
import { formatCurrency, formatDateTime } from '../utils/formatters';

export const CreditAuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterType, setFilterType] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [entries, tList] = await Promise.all([
        superApi.ledger.list({
          tenant_id: filterTenant || undefined,
          type: filterType || undefined,
          limit: 100,
        }),
        superApi.tenants.list(),
      ]);
      setLogs(entries || []);
      setTenants(tList || []);
    } catch (err) {
      console.error('Failed to load credit audit ledger', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filterTenant, filterType]);

  const getTypeBadge = (type: string) => {
    if (type === 'SUPER_ADMIN_GRANT') {
      return (
        <span className="badge badge-success">
          <span>+</span>
          <span>ADMIN GRANT</span>
        </span>
      );
    }
    if (type === 'CALL_OUTBOUND') {
      return (
        <span className="badge badge-warning">
          <span>📞</span>
          <span>OUTBOUND CALL</span>
        </span>
      );
    }
    if (type === 'SMS_SENT') {
      return (
        <span className="badge badge-neutral">
          <span>💬</span>
          <span>SMS SENT</span>
        </span>
      );
    }
    return <span className="badge badge-neutral">{type}</span>;
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 animate-fade">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Credit Audit Ledger</span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Immutable Records
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time ledger tracking every prepaid credit allocation, per-minute call deduction, and SMS dispatch.
          </p>
        </div>

        <button onClick={loadData} className="btn-secondary text-xs">
          <span>🔄</span>
          <span>Refresh Ledger</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            value={filterTenant}
            onChange={(e) => setFilterTenant(e.target.value)}
            className="form-input text-xs w-56"
          >
            <option value="">All Organizations</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="form-input text-xs w-48"
          >
            <option value="">All Transaction Types</option>
            <option value="SUPER_ADMIN_GRANT">Super Admin Grants (+)</option>
            <option value="CALL_OUTBOUND">Call Deductions (-)</option>
            <option value="SMS_SENT">SMS Deductions (-)</option>
          </select>
        </div>

        <div className="text-xs text-slate-400">
          Showing latest {logs.length} transactions
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Tenant Organization</th>
                <th>Transaction Type</th>
                <th>Amount</th>
                <th>Balance After</th>
                <th>Reference ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500 text-xs">
                    Loading ledger transactions...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500 text-xs">
                    No transactions recorded yet in the audit ledger.
                  </td>
                </tr>
              ) : (
                logs.map((entry) => {
                  const isPositive = entry.amount > 0;

                  return (
                    <tr key={entry.id}>
                      <td className="font-mono text-xs text-slate-400 whitespace-nowrap">
                        {formatDateTime(entry.created_at)}
                      </td>
                      <td>
                        <span className="font-semibold text-white">
                          {entry.tenant_name || `Tenant: ${entry.tenant_id}`}
                        </span>
                      </td>
                      <td>{getTypeBadge(entry.type)}</td>
                      <td>
                        <span
                          className={`font-mono font-bold text-sm ${
                            isPositive ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isPositive ? `+${formatCurrency(entry.amount)}` : formatCurrency(entry.amount)}
                        </span>
                      </td>
                      <td className="font-mono font-semibold text-slate-300">
                        {formatCurrency(entry.balance_after)}
                      </td>
                      <td className="font-mono text-slate-500 text-[11px] truncate max-w-xs">
                        {entry.reference_id || 'manual_transaction'}
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
