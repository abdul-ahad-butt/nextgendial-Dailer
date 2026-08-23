import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

interface User {
  id: string;
  username: string;
  created_at: string;
}

export function AdminDashboard() {
  const { logout } = useAuth();
  
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

  useEffect(() => {
    fetchAgents();
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
      const text = await file.text();
      // Basic CSV parser (assumes comma separated, no escaped commas inside quotes)
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      
      if (lines.length === 0) throw new Error('File is empty');

      // Assume first row is header
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
      
      const phoneIdx = headers.findIndex(h => h.includes('phone'));
      const firstIdx = headers.findIndex(h => h.includes('first'));
      const lastIdx = headers.findIndex(h => h.includes('last'));

      if (phoneIdx === -1) {
        throw new Error('CSV must contain a column header with "phone" in it.');
      }

      const parsedLeads = [];
      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split(',').map(c => c.trim());
        parsedLeads.push({
          phone_number: columns[phoneIdx],
          first_name: firstIdx !== -1 ? columns[firstIdx] : undefined,
          last_name: lastIdx !== -1 ? columns[lastIdx] : undefined,
        });
      }

      const result = await api.admin.uploadLeads(selectedAgentId, parsedLeads);
      setUploadResult(result);
    } catch (err: any) {
      setUploadError(err.message || 'Error processing CSV');
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* ── Main Layout ── */}
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
                <label className="form-label" htmlFor="agent-select">Assign to Agent</label>
                <select 
                  id="agent-select" 
                  className="form-control" 
                  value={selectedAgentId} 
                  onChange={e => setSelectedAgentId(e.target.value)}
                  required
                >
                  <option value="" disabled>Select an agent...</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.username}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="csv-file">CSV File</label>
                <input 
                  id="csv-file" 
                  type="file" 
                  accept=".csv"
                  className="form-control" 
                  style={{ padding: '8px 12px' }}
                  onChange={e => setFile(e.target.files?.[0] || null)}
                  required
                />
                <p className="text-muted text-sm mt-2">
                  Header row required. Must include a column with "phone" in the header (e.g. phone, phone_number). Optional: "first", "last" for names.
                </p>
              </div>

              <button type="submit" className="btn btn-primary" disabled={uploading || !selectedAgentId || !file}>
                {uploading ? <span className="spinner" /> : 'Process & Upload CSV'}
              </button>
            </form>
          </div>

          </div>

        </div>

      </main>
    </div>
  );
}
