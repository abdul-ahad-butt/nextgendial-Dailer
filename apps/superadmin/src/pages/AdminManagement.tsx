import React, { useEffect, useState } from 'react';
import { superApi } from '../services/api';
import { formatCurrency } from '../utils/formatters';

export const AdminManagement: React.FC = () => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAdminUser, setNewAdminUser] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [newCredits, setNewCredits] = useState('10.00');
  const [newMaxAgents, setNewMaxAgents] = useState('5');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Credit Grant Modal
  const [creditModalTenant, setCreditModalTenant] = useState<any | null>(null);
  const [grantAmount, setGrantAmount] = useState('10.00');
  const [grantNotes, setGrantNotes] = useState('');
  const [granting, setGranting] = useState(false);

  // Edit Modal
  const [editTenant, setEditTenant] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editMaxAgents, setEditMaxAgents] = useState(5);
  const [editIsActive, setEditIsActive] = useState(1);
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const list = await superApi.tenants.list();
      setTenants(list);
    } catch (err) {
      console.error('Failed to load tenants', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newAdminUser || !newAdminPass) return;

    try {
      setCreating(true);
      setCreateError(null);
      await superApi.tenants.create({
        name: newName,
        admin_username: newAdminUser,
        admin_password: newAdminPass,
        allocated_credits: parseFloat(newCredits) || 0,
        max_agents: parseInt(newMaxAgents, 10) || 5,
      });

      setIsCreateModalOpen(false);
      setNewName('');
      setNewAdminUser('');
      setNewAdminPass('');
      setNewCredits('10.00');
      fetchTenants();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create tenant organization');
    } finally {
      setCreating(false);
    }
  };

  const handleGrantCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditModalTenant || !grantAmount) return;

    try {
      setGranting(true);
      await superApi.tenants.grantCredits(creditModalTenant.id, {
        amount: parseFloat(grantAmount),
        notes: grantNotes || 'Super Admin Refill',
      });
      setCreditModalTenant(null);
      setGrantAmount('10.00');
      setGrantNotes('');
      fetchTenants();
    } catch (err: any) {
      alert(err.message || 'Failed to grant credits');
    } finally {
      setGranting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTenant) return;

    try {
      setSavingEdit(true);
      await superApi.tenants.update(editTenant.id, {
        name: editName,
        max_agents: editMaxAgents,
        is_active: editIsActive,
      });
      setEditTenant(null);
      fetchTenants();
    } catch (err: any) {
      alert(err.message || 'Failed to update tenant');
    } finally {
      setSavingEdit(false);
    }
  };

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.admin_username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 animate-fade">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Tenant Organization Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Provision customer accounts, grant prepaid calling credits, and set agent limits.
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="btn-primary text-xs"
        >
          <span>+</span>
          <span>Provision New Tenant</span>
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Search by organization name or admin username..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input max-w-md text-xs"
        />
        <div className="text-xs text-slate-400">
          Showing {filteredTenants.length} of {tenants.length} organizations
        </div>
      </div>

      {/* Tenants Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Admin Username</th>
                <th>Available Pool</th>
                <th>Granted / Spent</th>
                <th>Agents Limit</th>
                <th>Assigned Lines</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500 text-xs">
                    Loading tenant organizations...
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500 text-xs">
                    No matching organizations found.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => {
                  const available = Number(t.available_credits ?? Math.max(0, (t.allocated_credits || 0) - (t.spent_credits || 0) - (t.distributed_credits || 0)));
                  const isDepleted = available < 0.05;

                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="font-semibold text-white">{t.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">ID: {t.id}</div>
                      </td>
                      <td className="font-mono text-slate-300 font-medium">
                        {t.admin_username}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-sm ${isDepleted ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {formatCurrency(available)}
                          </span>
                          {isDepleted ? (
                            <span className="badge badge-danger">DEPLETED</span>
                          ) : (
                            <span className="badge badge-success">OK</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Assigned: {formatCurrency(t.distributed_credits || 0)}
                        </div>
                      </td>
                      <td className="text-xs text-slate-400 font-mono">
                        {formatCurrency(t.allocated_credits)} / {formatCurrency(t.spent_credits)}
                      </td>
                      <td className="font-mono text-slate-300">
                        {t.agent_count || 0} / {t.max_agents} agents
                      </td>
                      <td className="font-mono text-slate-300">
                        {t.number_count || 0} numbers
                      </td>
                      <td>
                        <span className={`badge ${t.is_active ? 'badge-success' : 'badge-danger'}`}>
                          {t.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => {
                              setCreditModalTenant(t);
                              setGrantAmount('10.00');
                            }}
                            className="btn-primary text-xs py-1 px-2.5"
                            title="Add Calling Credits"
                          >
                            + Refill
                          </button>
                          <button
                            onClick={() => {
                              setEditTenant(t);
                              setEditName(t.name);
                              setEditMaxAgents(t.max_agents);
                              setEditIsActive(t.is_active);
                            }}
                            className="btn-secondary text-xs py-1 px-2.5"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Tenant Modal ── */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade">
          <div className="w-full max-w-md bg-[#0F1422] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">Provision New Tenant</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Organization / Company Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Health Solutions"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="form-input text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Tenant Admin Username
                </label>
                <input
                  type="text"
                  placeholder="e.g. apex_admin"
                  value={newAdminUser}
                  onChange={(e) => setNewAdminUser(e.target.value)}
                  className="form-input text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Tenant Admin Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••••••"
                  value={newAdminPass}
                  onChange={(e) => setNewAdminPass(e.target.value)}
                  className="form-input text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Initial Prepaid Credits ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newCredits}
                    onChange={(e) => setNewCredits(e.target.value)}
                    className="form-input text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Max Agent Seats
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newMaxAgents}
                    onChange={(e) => setNewMaxAgents(e.target.value)}
                    className="form-input text-xs"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-primary text-xs"
                >
                  {creating ? 'Provisioning...' : 'Provision Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Grant Credits Modal ── */}
      {creditModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade">
          <div className="w-full max-w-sm bg-[#0F1422] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">Refill Tenant Credits</h3>
              <button
                onClick={() => setCreditModalTenant(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Grant prepaid credit balance to <strong>{creditModalTenant.name}</strong>.
            </p>

            <form onSubmit={handleGrantCredits} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Credit Amount ($ USD)
                </label>
                <div className="flex gap-2 mb-2">
                  {['10.00', '25.00', '50.00', '100.00'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setGrantAmount(amt)}
                      className={`flex-1 py-1 text-xs rounded-lg border font-mono ${
                        grantAmount === amt
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      +${amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  className="form-input text-xs font-mono font-bold text-emerald-400"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Notes / Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. Monthly subscription refill"
                  value={grantNotes}
                  onChange={(e) => setGrantNotes(e.target.value)}
                  className="form-input text-xs"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreditModalTenant(null)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={granting}
                  className="btn-primary text-xs"
                >
                  {granting ? 'Granting...' : 'Confirm Credit Refill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Tenant Modal ── */}
      {editTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade">
          <div className="w-full max-w-sm bg-[#0F1422] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">Edit Tenant Settings</h3>
              <button
                onClick={() => setEditTenant(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="form-input text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Max Agents Limit
                </label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={editMaxAgents}
                  onChange={(e) => setEditMaxAgents(parseInt(e.target.value, 10))}
                  className="form-input text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Status
                </label>
                <select
                  value={editIsActive}
                  onChange={(e) => setEditIsActive(parseInt(e.target.value, 10))}
                  className="form-input text-xs"
                >
                  <option value={1}>Active</option>
                  <option value={0}>Suspended</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditTenant(null)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="btn-primary text-xs"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
