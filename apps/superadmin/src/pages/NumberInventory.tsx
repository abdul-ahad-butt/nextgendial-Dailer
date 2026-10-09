import React, { useEffect, useState } from 'react';
import { superApi } from '../services/api';
import { formatE164 } from '../utils/formatters';

export const NumberInventory: React.FC = () => {
  const [numbers, setNumbers] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [nums, tList] = await Promise.all([
        superApi.telnyx.getNumbers(),
        superApi.tenants.list(),
      ]);
      setNumbers(nums || []);
      setTenants(tList || []);
    } catch (err: any) {
      console.error('Failed to load number inventory', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setMessage(null);
      const res = await superApi.telnyx.syncNumbers();
      setMessage(`Successfully synced ${res.synced} numbers from Telnyx API.`);
      loadData();
    } catch (err: any) {
      setMessage(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleAllocate = async (phoneNumber: string, tenantId: string) => {
    try {
      const targetTenant = tenantId === 'unassign' ? null : tenantId;
      await superApi.numbers.allocate({
        phone_number: phoneNumber,
        tenant_id: targetTenant,
      });
      loadData();
    } catch (err: any) {
      alert(`Failed to allocate number: ${err.message}`);
    }
  };

  const filteredNumbers = numbers.filter((num) => {
    const matchesSearch =
      num.phone_number.includes(search) ||
      (num.friendly_name || '').toLowerCase().includes(search.toLowerCase());
    const matchesTenant =
      !filterTenant ||
      (filterTenant === 'unassigned'
        ? !num.assigned_tenant_id
        : num.assigned_tenant_id === filterTenant);
    return matchesSearch && matchesTenant;
  });

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 animate-fade">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Global Phone Number Inventory</span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Telnyx SIP DIDs
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Allocate 1-2 dedicated telephony lines per tenant organization. Numbers sync directly from your Telnyx Master Account.
          </p>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="btn-primary text-xs"
        >
          <span>🔄</span>
          <span>{syncing ? 'Syncing Telnyx API...' : 'Sync from Telnyx'}</span>
        </button>
      </div>

      {message && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
          <span>✓ {message}</span>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search phone number or friendly name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input text-xs w-72"
          />
          <select
            value={filterTenant}
            onChange={(e) => setFilterTenant(e.target.value)}
            className="form-input text-xs w-48"
          >
            <option value="">All Organizations</option>
            <option value="unassigned">— Unassigned Pool —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-slate-400">
          Showing {filteredNumbers.length} of {numbers.length} total numbers
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Phone Number (E.164)</th>
                <th>Friendly Name</th>
                <th>Telnyx ID</th>
                <th>Assigned Tenant Organization</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Allocation Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500 text-xs">
                    Loading numbers inventory...
                  </td>
                </tr>
              ) : filteredNumbers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500 text-xs">
                    No phone numbers found matching the criteria. Click "Sync from Telnyx" to pull active DIDs.
                  </td>
                </tr>
              ) : (
                filteredNumbers.map((num) => {
                  return (
                    <tr key={num.phone_number}>
                      <td className="font-mono font-semibold text-white">
                        {formatE164(num.phone_number)}
                      </td>
                      <td className="text-slate-400 text-xs">
                        {num.friendly_name || 'Telnyx Voice Line'}
                      </td>
                      <td className="font-mono text-slate-500 text-[11px]">
                        {num.telnyx_id || 'manual'}
                      </td>
                      <td>
                        {num.assigned_tenant_id ? (
                          <div>
                            <span className="font-semibold text-emerald-400 text-xs">
                              {num.assigned_tenant_name || `Tenant: ${num.assigned_tenant_id}`}
                            </span>
                          </div>
                        ) : (
                          <span className="badge badge-neutral">Unassigned</span>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-success">
                          {num.status || 'Active'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <select
                          value={num.assigned_tenant_id || 'unassign'}
                          onChange={(e) => handleAllocate(num.phone_number, e.target.value)}
                          className="form-input text-xs"
                          style={{ width: '220px', padding: '6px 10px' }}
                        >
                          <option value="unassign">— Master Pool (Unassigned) —</option>
                          {tenants.map((t) => (
                            <option key={t.id} value={t.id}>
                              Assign to: {t.name}
                            </option>
                          ))}
                        </select>
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
