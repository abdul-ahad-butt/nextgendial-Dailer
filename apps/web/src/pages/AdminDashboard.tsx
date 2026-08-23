import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import * as XLSX from 'xlsx';
import { AdminNumbers } from './AdminNumbers';

interface User {
  id: string;
  username: string;
  created_at: string;
}

interface Batch {
  id: string;
  file_name: string;
  total_leads: number;
  uploaded_at: string;
  assigned_agent_username: string | null;
}

export function AdminDashboard() {
  const { user, logout } = useAuth();
  
  // Tabs State
  const [activeTab, setActiveTab] = useState<'general' | 'numbers'>('general');

  // Agent State
  const [agents, setAgents] = useState<User[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  
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

  // Batches State
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
    fetchBatches();
  }, []);

  const fetchAgents = async () => {
    try {
      setLoadingAgents(true);
      const data = await api.admin.getAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to load agents', err);
    } finally {
      setLoadingAgents(false);
    }
  };

  const fetchBatches = async () => {
    try {
      setLoadingBatches(true);
      const data = await api.admin.getBatches();
      setBatches(data);
    } catch (err) {
      console.error('Failed to load batches', err);
    } finally {
      setLoadingBatches(false);
    }
  };

  const handleDeleteBatch = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this batch and all its leads?')) return;
    try {
      setDeletingBatchId(id);
      await api.admin.deleteBatch(id);
      await fetchBatches();
    } catch (err) {
      console.error('Failed to delete batch', err);
      alert('Failed to delete batch');
    } finally {
      setDeletingBatchId(null);
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingAgent(true);
    setAgentMessage(null);
    try {
      await api.admin.createAgent({ username: newUsername, password: newPassword });
      setAgentMessage({ type: 'success', text: 'Agent created successfully' });
      setNewUsername('');
      setNewPassword('');
      fetchAgents();
    } catch (err: any) {
      setAgentMessage({ type: 'error', text: err.message || 'Failed to create agent' });
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleUploadLeads = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !file) return;

    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

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

      // Fuzzy matching
      const phoneIdx = headers.findIndex(h => ['phone', 'mobile', 'contact', 'tel', 'cell', 'phonenumber'].includes(h));
      const firstIdx = headers.findIndex(h => ['first', 'fname', 'firstname'].includes(h));
      const lastIdx = headers.findIndex(h => ['last', 'lname', 'lastname', 'surname'].includes(h));

      if (phoneIdx === -1) {
        throw new Error('Could not find a phone number column. Make sure you have a header like "Phone", "Mobile", or "Cell".');
      }

      const parsedLeads = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as any[];
        // Skip entirely empty rows
        if (!row || row.length === 0 || row.every(cell => !cell)) continue;

        parsedLeads.push({
          phone_number: row[phoneIdx] != null ? String(row[phoneIdx]) : undefined,
          first_name: firstIdx !== -1 && row[firstIdx] != null ? String(row[firstIdx]) : undefined,
          last_name: lastIdx !== -1 && row[lastIdx] != null ? String(row[lastIdx]) : undefined,
        });
      }

      const assignedUserId = selectedAgentId === 'pool' ? null : (selectedAgentId === 'me' && user ? user.id : selectedAgentId);
      
      const result = await api.admin.uploadLeads(assignedUserId, file.name, parsedLeads);
      setUploadResult(result);
      fetchBatches(); // Refresh batches table
    } catch (err: any) {
      setUploadError(err.message || 'Error processing file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="app-layout">
      
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-dot" aria-hidden="true" />
          NextGenDial Admin
        </div>

        <div style={{ display: 'flex', gap: 12, marginLeft: 48, flex: 1 }}>
          <button 
            className={`btn ${activeTab === 'general' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('general')}
          >
            Dashboard
          </button>
          <button 
            className={`btn ${activeTab === 'numbers' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('numbers')}
          >
            Phone Numbers
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* ── Main Layout ── */}
      {activeTab === 'numbers' ? (
        <main className="main-content" style={{ width: '100%', flex: 1, overflowY: 'auto' }}>
          <AdminNumbers />
        </main>
      ) : (
      <main className="main-content" style={{ maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Dashboard</h1>
          <p className="text-muted" style={{ margin: 0, marginTop: 4 }}>Manage agents and assign leads.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        
        {/* LEFT COLUMN: AGENT MANAGEMENT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div className="card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Create New Agent</h2>
            {agentMessage && (
              <p style={{
                color: agentMessage.type === 'error' ? 'var(--danger)' : 'var(--success)',
                fontSize: 13, padding: '10px 14px', borderRadius: 8,
                background: agentMessage.type === 'error' ? 'var(--danger-dim)' : 'var(--success-dim)',
                marginBottom: 16
              }}>
                {agentMessage.text}
              </p>
            )}
            <form onSubmit={handleCreateAgent} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="username">Username</label>
                <input
                  id="username"
                  className="form-control"
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="password">Password</label>
                <input
                  id="password"
                  className="form-control"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={creatingAgent}>
                {creatingAgent ? <span className="spinner" /> : 'Create Agent'}
              </button>
            </form>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Existing Agents</h2>
            {loadingAgents ? (
              <span className="spinner" />
            ) : agents.length === 0 ? (
              <p className="text-muted text-sm">No agents found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {agents.map(a => (
                  <div key={a.id} style={{ padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600 }}>{a.username}</div>
                    <div className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>{a.id.slice(0, 8)}...</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: LEAD UPLOAD */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div className="card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Upload Leads</h2>
            
            {uploadError && (
              <p style={{ color: 'var(--danger)', fontSize: 13, padding: '10px 14px', background: 'var(--danger-dim)', borderRadius: 8, marginBottom: 16 }}>
                {uploadError}
              </p>
            )}

            {uploadResult && (
              <div style={{ padding: '12px 16px', background: 'var(--success-dim)', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
                <div style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 4 }}>Upload Complete</div>
                <div>Inserted: {uploadResult.inserted}</div>
                <div>Skipped: {uploadResult.skipped}</div>
                {uploadResult.errors?.length > 0 && (
                  <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--danger)' }}>
                    {uploadResult.errors.map((err: string, i: number) => <li key={i}>{err}</li>)}
                  </ul>
                )}
              </div>
            )}

            <form onSubmit={handleUploadLeads} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="agent-select">Assign To</label>
                <select 
                  id="agent-select" 
                  className="form-control" 
                  value={selectedAgentId} 
                  onChange={e => setSelectedAgentId(e.target.value)}
                  required
                >
                  <option value="" disabled>Select assignment...</option>
                  <option value="pool">General Pool (Unassigned)</option>
                  <option value="me">Assign to me (Admin)</option>
                  <optgroup label="Agents">
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.username}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="csv-file">Spreadsheet File (.csv, .xlsx)</label>
                <input 
                  id="csv-file" 
                  type="file" 
                  accept=".csv,.xlsx,.xls"
                  className="form-control" 
                  style={{ padding: '8px 12px' }}
                  onChange={e => setFile(e.target.files?.[0] || null)}
                  required
                />
                <p className="text-muted text-sm mt-2">
                  Header row required. Automatically detects columns like "Phone", "Mobile", "First Name", "Last".
                </p>
              </div>

              <button type="submit" className="btn btn-primary" disabled={uploading || !selectedAgentId || !file}>
                {uploading ? <span className="spinner" /> : 'Process & Upload Leads'}
              </button>
            </form>
          </div>

        </div>

        </div>

        {/* FULL WIDTH: BATCHES TABLE */}
        <div className="card" style={{ padding: 24, overflowX: 'auto' }}>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>Uploaded Lead Sheets</h2>
          {loadingBatches ? (
            <span className="spinner" />
          ) : batches.length === 0 ? (
            <p className="text-muted text-sm">No lead sheets uploaded yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>File Name</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Leads</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Assigned To</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 500 }}>{b.file_name}</td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                      {new Date(b.uploaded_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 8px' }}>{b.total_leads}</td>
                    <td style={{ padding: '12px 8px' }}>
                      {b.assigned_agent_username ? (
                        <span style={{ padding: '2px 8px', background: 'var(--primary-dim)', color: 'var(--primary)', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>
                          {b.assigned_agent_username}
                        </span>
                      ) : (
                        <span style={{ padding: '2px 8px', background: 'var(--surface-hover)', color: 'var(--text-muted)', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>
                          General Pool
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <button 
                        className="btn btn-ghost" 
                        style={{ color: 'var(--danger)', padding: '6px 12px', fontSize: 13 }}
                        disabled={deletingBatchId === b.id}
                        onClick={() => handleDeleteBatch(b.id)}
                      >
                        {deletingBatchId === b.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </main>
      )}
    </div>
  );
}
