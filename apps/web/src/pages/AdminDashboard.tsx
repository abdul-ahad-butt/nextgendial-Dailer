import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import * as XLSX from 'xlsx';
import { AdminNumbers } from './AdminNumbers';
import { CustomSelect } from '../components/common/CustomSelect';
import { GlassCard } from '../components/common/GlassCard';
import { formatCurrency } from '../utils/formatters';
import { Loader2 } from 'lucide-react';

interface User {
  id: string;
  username: string;
  created_at: string;
  status?: string;
  name?: string;
}

interface TenantDetails {
  id: string;
  name: string;
  allocated_credits: number;
  spent_credits: number;
  remaining_credits: number;
  max_agents: number;
  is_active: number | boolean;
}

interface TenantStats {
  agents_count: number;
  total_calls: number;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tabs State
  const [activeTab, setActiveTab] = useState<'general' | 'numbers'>('general');

  // Tenant / Credit State
  const [tenantInfo, setTenantInfo] = useState<{
    tenant: TenantDetails;
    stats: TenantStats;
  } | null>(null);

  // Agent State
  const [agents, setAgents] = useState<User[]>([]);

  // Create Agent State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentMessage, setAgentMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Lead Upload State
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Manual Mapping State
  const [needsManualMapping, setNeedsManualMapping] = useState(false);
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [selectedPhoneColIdx, setSelectedPhoneColIdx] = useState<string>('');
  const [pendingUploadData, setPendingUploadData] = useState<any>(null);

  // System Warning State
  const [systemWarning, setSystemWarning] = useState<string | null>(null);

  // Password Modal State
  const [passwordModal, setPasswordModal] = useState<{ username: string; password?: string; isReset?: boolean } | null>(null);

  const fetchTenantData = async () => {
    try {
      const res = await api.admin.getTenant();
      if (res) {
        const rawTenant = res?.tenant || res?.data?.tenant || res?.data || res;
        const rawStats = res?.stats || res?.data?.stats || res?.data || res;

        setTenantInfo({
          tenant: {
            id: rawTenant?.id || res?.id || '',
            name: rawTenant?.name || res?.name || 'Admin Organization',
            allocated_credits: Number(rawTenant?.allocated_credits ?? res?.allocated_credits ?? 0),
            spent_credits: Number(rawTenant?.spent_credits ?? res?.spent_credits ?? 0),
            remaining_credits: Number(rawTenant?.remaining_credits ?? rawTenant?.remaining_balance ?? res?.remaining_balance ?? res?.remaining_credits ?? 0),
            max_agents: Number(rawTenant?.max_agents ?? res?.max_agents ?? 5),
            is_active: rawTenant?.is_active ?? res?.is_active ?? 1,
          },
          stats: {
            agents_count: Number(rawStats?.agents_count ?? res?.agents_count ?? 0),
            total_calls: Number(rawStats?.total_calls ?? res?.total_calls ?? 0),
          },
        });
      }
    } catch (err: any) {
      console.error('Failed to load tenant details', err);
    }
  };

  const fetchAgents = async () => {
    try {
      const data = await api.admin.getAgents();
      setAgents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load agents', err);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      try {
        setLoading(true);
        setError(null);
        await Promise.allSettled([fetchAgents(), fetchTenantData()]);
      } catch (err: any) {
        if (isMounted) {
          console.error('Failed to load admin dashboard:', err);
          setError(err?.message || 'Error connecting to backend API');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initialize();
    
    const interval = setInterval(() => {
      fetchAgents();
      fetchTenantData();
    }, 10000);
    
    // Check for systemic configuration failures
    api.calls.list({ status: 'failed', limit: 5 })
      .then(res => {
        const failures = res?.data || [];
        if (Array.isArray(failures) && failures.length >= 3) {
          const recentConfigFailures = failures.slice(0, 3).every(call => 
            call?.failure_category === 'Rejected immediately — possible account/config issue'
          );
          if (recentConfigFailures && isMounted) {
            setSystemWarning('System Warning: The last 3 failed calls were immediately rejected. Please check your Telnyx balance, trial restrictions, or allocated credits.');
          }
        }
      })
      .catch(console.error);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDeleteAgent = async (agentId: string) => {
    if (!agentId) return;
    if (!window.confirm("Are you sure you want to delete this agent? They will no longer be able to log in. Their call history will be preserved.")) return;
    try {
      await api.admin.deleteAgent(agentId);
      fetchAgents();
      fetchTenantData();
    } catch (err: any) {
      alert(err.message || "Failed to delete agent");
    }
  };

  const handleResetPassword = async (agentId: string, username: string) => {
    if (!agentId) return;
    if (!window.confirm(`Are you sure you want to reset the password for ${username || 'this agent'}?`)) return;
    try {
      const res = await api.admin.resetAgentPassword(agentId);
      setPasswordModal({ username, password: res.new_password, isReset: true });
    } catch (err: any) {
      alert(err.message || "Failed to reset password");
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingAgent(true);
    setAgentMessage(null);
    try {
      await api.admin.createAgent({ username: newUsername, password: newPassword });
      setPasswordModal({ username: newUsername, password: newPassword, isReset: false });
      setNewUsername('');
      setNewPassword('');
      fetchAgents();
      fetchTenantData();
    } catch (err: any) {
      setAgentMessage({ type: 'error', text: err.message || 'Failed to create agent' });
    } finally {
      setCreatingAgent(false);
    }
  };

  const processLeads = async (rows: any[], headers: string[], manualPhoneIdx?: number) => {
    let phoneIdx = manualPhoneIdx !== undefined ? manualPhoneIdx : headers.findIndex(h => 
      ['phone', 'phonenumber', 'mobile', 'cell', 'contact', 'tel', 'number', 'num', 'usa', 'profilephone'].includes(h)
    );
    const firstIdx = headers.findIndex(h => ['first', 'fname', 'firstname'].includes(h));
    const lastIdx = headers.findIndex(h => ['last', 'lname', 'lastname', 'surname'].includes(h));

    if (phoneIdx === -1) {
      setNeedsManualMapping(true);
      setAvailableHeaders(rows[0] as string[]);
      setPendingUploadData({ rows, headers });
      setUploading(false);
      return;
    }

    setNeedsManualMapping(false);

    const parsedLeads = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as any[];
      if (!row || row.length === 0 || row.every(cell => !cell)) continue;

      parsedLeads.push({
        phone_number: row[phoneIdx] != null ? String(row[phoneIdx]) : undefined,
        first_name: firstIdx !== -1 && row[firstIdx] != null ? String(row[firstIdx]) : undefined,
        last_name: lastIdx !== -1 && row[lastIdx] != null ? String(row[lastIdx]) : undefined,
      });
    }

    const assignedUserId = selectedAgentId === 'pool' ? null : (selectedAgentId === 'me' && user ? user.sub : selectedAgentId);
    const assignmentMode = selectedAgentId === 'pool' ? 'pool' : 'assigned';
    
    const result = await api.admin.uploadLeads(assignedUserId, file!.name, parsedLeads, assignmentMode);
    setUploadResult(result);
    setFile(null);
    setUploading(false);
  };

  const confirmManualUpload = async () => {
    if (selectedPhoneColIdx === '' || !pendingUploadData) return;
    setUploading(true);
    setUploadError(null);
    try {
      await processLeads(pendingUploadData.rows, pendingUploadData.headers, Number(selectedPhoneColIdx));
    } catch (err: any) {
      setUploadError(err.message || 'Error processing file');
      setUploading(false);
    }
  };

  const handleUploadLeads = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !file) return;

    setUploading(true);
    setUploadResult(null);
    setUploadError(null);
    setNeedsManualMapping(false);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const rows = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });
      if (rows.length < 2) {
        throw new Error('File is empty or missing data rows');
      }

      const headers = (rows[0] as string[]).map(h => {
        if (typeof h !== 'string') return '';
        return h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      });

      await processLeads(rows, headers);
    } catch (err: any) {
      setUploadError(err.message || 'Error processing file');
      setUploading(false);
    }
  };

  const assignmentOptions = [
    { value: 'pool', label: 'General Pool (Unassigned)' },
    { value: 'me', label: 'Assign to me (Admin)' },
    ...(agents || []).map(a => ({ value: a?.id || '', label: `Agent: ${a?.username || a?.name || 'Unknown'}` }))
  ];

  // 1. Loading State Skeleton (Prevents early render crashes)
  if (loading) {
    return (
      <div className="min-h-screen bg-[#070A12] flex flex-col items-center justify-center text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
        <p className="text-sm font-medium text-slate-200">Loading Admin Console...</p>
        <p className="text-xs text-slate-500 mt-1">Connecting to telephony services & tenant portal...</p>
      </div>
    );
  }

  // 2. Controlled Error Banner (Never crash to a blank screen)
  if (error && !tenantInfo) {
    return (
      <div className="min-h-screen bg-[#070A12] p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-6 text-center shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 text-xl mx-auto mb-3">
            ⚠️
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Unable to Load Dashboard</h2>
          <p className="text-xs text-rose-300 mb-4">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              Promise.allSettled([fetchAgents(), fetchTenantData()]).finally(() => setLoading(false));
            }}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-xl transition-all shadow-md shadow-emerald-500/20 active:scale-95"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-[#0E131F]/90 backdrop-blur-md border-b border-slate-800/80 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-bold text-sm shadow-md shadow-emerald-500/20">
            N
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>NextGenDial Admin</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                TENANT PORTAL
              </span>
            </div>
            {tenantInfo && (
              <div className="text-[11px] text-slate-400 font-medium">
                Org: {tenantInfo?.tenant?.name || (tenantInfo as any)?.name || 'Admin Organization'}
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-2xl border border-slate-800/80 text-xs font-medium">
          <button 
            className={`px-3 py-1.5 rounded-xl transition-all ${activeTab === 'general' ? 'bg-emerald-500 text-slate-950 font-semibold shadow-md shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('general')}
          >
            Dashboard
          </button>
          <button className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-200 transition-colors" onClick={() => navigate('/admin/agent-status')}>Agent Status</button>
          <button className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-200 transition-colors" onClick={() => navigate('/admin/leads')}>Leads</button>
          <button className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-200 transition-colors" onClick={() => navigate('/admin/leadsheets')}>Lead Sheets</button>
          <button 
            className={`px-3 py-1.5 rounded-xl transition-all ${activeTab === 'numbers' ? 'bg-emerald-500 text-slate-950 font-semibold shadow-md shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('numbers')}
          >
            Phone Numbers
          </button>
          <button 
            className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => navigate('/admin/recordings')}
          >
            Call Recordings
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={logout}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* ── System Warning Banner ── */}
      {systemWarning && (
        <div className="bg-amber-950/80 border-b border-amber-800 px-6 py-2.5 text-xs text-amber-200 text-center font-medium animate-fade-in flex items-center justify-center gap-2">
          <span>⚠️</span>
          <span>{systemWarning}</span>
        </div>
      )}

      {/* ── Main Content ── */}
      {activeTab === 'numbers' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-6">
          <AdminNumbers />
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
          {/* Organization Credits & Quota Vitals Banner */}
          {tenantInfo && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-fade-in">
              <GlassCard title="Prepaid Balance" subtitle="Calling & SMS Credits">
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {formatCurrency(tenantInfo?.tenant?.remaining_credits ?? 0)}
                </div>
                <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                  <span>Allocated: {formatCurrency(tenantInfo?.tenant?.allocated_credits ?? 0)}</span>
                  <span>Spent: {formatCurrency(tenantInfo?.tenant?.spent_credits ?? 0)}</span>
                </div>
                {(tenantInfo?.tenant?.remaining_credits ?? 0) < 0.05 && (
                  <div className="mt-2 text-[11px] text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                    Depleted: Outbound calls locked out
                  </div>
                )}
              </GlassCard>

              <GlassCard title="Agent Seat Quota" subtitle="Configured by Super Admin">
                <div className="text-2xl font-bold font-mono text-sky-400">
                  {tenantInfo?.stats?.agents_count ?? (agents || []).length} / {tenantInfo?.tenant?.max_agents ?? 5}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {Math.max(0, (tenantInfo?.tenant?.max_agents ?? 5) - (tenantInfo?.stats?.agents_count ?? (agents || []).length))} seats remaining
                </div>
              </GlassCard>

              <GlassCard title="Total Calls Logged" subtitle="Lifetime outbound volume">
                <div className="text-2xl font-bold font-mono text-indigo-400">
                  {tenantInfo?.stats?.total_calls ?? 0}
                </div>
                <div className="text-xs text-slate-400 mt-1">Rate: ~$0.015 / minute</div>
              </GlassCard>

              <GlassCard title="Organization Status" subtitle="Telephony Line Health">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-lg font-semibold text-white">
                    {tenantInfo?.tenant?.is_active ? 'Active & Verified' : 'Suspended'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1">Telnyx Master SIP Connected</div>
              </GlassCard>
            </div>
          )}

          {/* Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT COLUMN: AGENT MANAGEMENT */}
            <div className="lg:col-span-6 space-y-6">
              <GlassCard title="Create New Agent" subtitle="Provision agent login credentials">
                {agentMessage && (
                  <div className={`p-3 rounded-xl text-xs mb-4 ${agentMessage.type === 'error' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'}`}>
                    {agentMessage.text}
                  </div>
                )}
                <form onSubmit={handleCreateAgent} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder="e.g. agent_sarah"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={creatingAgent}
                    className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 active:scale-98 transition-all disabled:opacity-50"
                  >
                    {creatingAgent ? 'Creating Agent...' : 'Create Agent'}
                  </button>
                </form>
              </GlassCard>

              {/* Active Agents Table */}
              <GlassCard title="Active Agents" subtitle={`${(agents || []).length} agents currently registered`}>
                {(agents || []).length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    No active agents registered yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-2.5 px-3">Agent</th>
                          <th className="py-2.5 px-3">Created</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {(agents || []).map(a => (
                          <tr key={a?.id || Math.random()} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-200">{a?.username || a?.name || 'Agent'}</div>
                              <div className="text-[10px] text-slate-400 font-mono">ID: {a?.id ? a.id.slice(0, 8) : 'N/A'}</div>
                            </td>
                            <td className="py-3 px-3 text-slate-400">
                              {a?.created_at ? new Date(a.created_at).toLocaleDateString() : 'N/A'}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => handleResetPassword(a?.id || '', a?.username || a?.name || '')}
                                  className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
                                >
                                  Reset Password
                                </button>
                                <button
                                  onClick={() => handleDeleteAgent(a?.id || '')}
                                  className="px-2.5 py-1 text-[11px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded-lg border border-rose-500/30 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>
            </div>

            {/* RIGHT COLUMN: LEAD UPLOAD */}
            <div className="lg:col-span-6 space-y-6">
              <GlassCard title="Upload Leads" subtitle="Bulk import leads via CSV or Excel (.xlsx)">
                {uploadError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-4">
                    {uploadError}
                  </div>
                )}

                {uploadResult && (
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs mb-4 space-y-1">
                    <div className="font-semibold">✓ Upload Complete</div>
                    <div>Inserted: {uploadResult.inserted} leads (E.164 normalized)</div>
                    <div>Skipped: {uploadResult.skipped}</div>
                  </div>
                )}

                {needsManualMapping ? (
                  <div className="space-y-4">
                    <p className="text-xs text-amber-300 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                      Could not automatically detect the phone number column. Please select it manually:
                    </p>
                    <CustomSelect
                      label="Phone Number Column"
                      value={selectedPhoneColIdx}
                      onChange={val => setSelectedPhoneColIdx(val)}
                      placeholder="Select phone column..."
                      options={availableHeaders.map((h, i) => ({
                        value: String(i),
                        label: h || `Column ${i + 1}`,
                      }))}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={confirmManualUpload}
                        disabled={uploading || selectedPhoneColIdx === ''}
                        className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-xl shadow-md transition-all disabled:opacity-50"
                      >
                        {uploading ? 'Processing...' : 'Confirm & Upload'}
                      </button>
                      <button
                        onClick={() => { setNeedsManualMapping(false); setPendingUploadData(null); }}
                        className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleUploadLeads} className="space-y-4">
                    {/* Modern CustomSelect replacing native <select> */}
                    <CustomSelect
                      label="Assign To"
                      value={selectedAgentId}
                      onChange={val => setSelectedAgentId(val)}
                      options={assignmentOptions}
                      placeholder="Select assignment..."
                    />

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                        Spreadsheet File (.CSV, .XLSX)
                      </label>
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={e => setFile(e.target.files?.[0] || null)}
                        required
                        className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-2.5 text-xs text-slate-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                      />
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        Header row required. Automatically detects columns like "Phone", "Mobile", "First Name", "Last". Numbers are normalized to E.164.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={uploading || !selectedAgentId || !file}
                      className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 active:scale-98 transition-all disabled:opacity-40"
                    >
                      {uploading ? 'Processing & Normalizing Leads...' : 'Process & Upload Leads'}
                    </button>
                  </form>
                )}
              </GlassCard>
            </div>
          </div>
        </main>
      )}

      {/* Password Modal */}
      {passwordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-sm bg-[#0F1422] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-lg">
              🔑
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {passwordModal.isReset ? 'Password Reset Successful' : 'Agent Created'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Credentials for <strong>{passwordModal.username}</strong>:
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-1">
              <div>Username: <span className="text-slate-200">{passwordModal.username}</span></div>
              {passwordModal.password && (
                <div>Password: <span className="text-emerald-400 font-bold">{passwordModal.password}</span></div>
              )}
            </div>
            <button
              onClick={() => setPasswordModal(null)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
