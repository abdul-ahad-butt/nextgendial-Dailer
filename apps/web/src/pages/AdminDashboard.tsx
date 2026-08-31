import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import * as XLSX from 'xlsx';
import { AdminNumbers } from './AdminNumbers';

interface User {
  id: string;
  username: string;
  created_at: string;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  // Tabs State
  const [activeTab, setActiveTab] = useState<'general' | 'numbers'>('general');

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
  const [selectedPhoneColIdx, setSelectedPhoneColIdx] = useState<number | ''>('');
  const [pendingUploadData, setPendingUploadData] = useState<any>(null);

  // System Warning State
  const [systemWarning, setSystemWarning] = useState<string | null>(null);



  useEffect(() => {
    fetchAgents();
    
    const interval = setInterval(() => {
      fetchAgents();
    }, 5000);
    
    // Check for recent systemic configuration failures
    api.calls.list({ status: 'failed', limit: 5 })
      .then(res => {
        const failures = res.data;
        if (failures.length >= 3) {
          const recentConfigFailures = failures.slice(0, 3).every(call => 
            call.failure_category === 'Rejected immediately — possible account/config issue'
          );
          if (recentConfigFailures) {
            setSystemWarning('System Warning: The last 3 failed calls were immediately rejected. Please check your Telnyx account balance, trial restrictions, or Outbound Voice Profile settings.');
          }
        }
      })
      .catch(console.error);

    return () => clearInterval(interval);
  }, []);

  const fetchAgents = async () => {
    try {
      const data = await api.admin.getAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to load agents', err);
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

  const processLeads = async (rows: any[], headers: string[], manualPhoneIdx?: number) => {
    // Fuzzy matching
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
      // Skip entirely empty rows
      if (!row || row.length === 0 || row.every(cell => !cell)) continue;

      parsedLeads.push({
        phone_number: row[phoneIdx] != null ? String(row[phoneIdx]) : undefined,
        first_name: firstIdx !== -1 && row[firstIdx] != null ? String(row[firstIdx]) : undefined,
        last_name: lastIdx !== -1 && row[lastIdx] != null ? String(row[lastIdx]) : undefined,
      });
    }

    const assignedUserId = selectedAgentId === 'pool' ? null : (selectedAgentId === 'me' && user ? user.sub : selectedAgentId);
    
    // Default assignment_mode is 'assigned'. If 'pool' was selected, mode is 'pool'.
    const assignmentMode = selectedAgentId === 'pool' ? 'pool' : 'assigned';
    
    const result = await api.admin.uploadLeads(assignedUserId, file!.name, parsedLeads, assignmentMode);
    setUploadResult(result);
    setFile(null); // Reset file
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

  return (
    <div className="app-layout">
      
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-dot" aria-hidden="true" />
          NextGenDial Admin
        </div>

        <div className="app-header-nav">
          <button 
            className={`btn ${activeTab === 'general' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('general')}
          >
            Dashboard
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/agent-status')}>Agent Status</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/leads')}>Leads</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/leadsheets')}>Lead Sheets</button>
          <button 
            className={`btn ${activeTab === 'numbers' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('numbers')}
          >
            Phone Numbers
          </button>
          <button 
            className="btn btn-ghost"
            onClick={() => navigate('/admin/recordings')}
          >
            Call Recordings
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* ── System Warning Banner ── */}
      {systemWarning && (
        <div style={{ background: '#473619', color: '#fff', border: '1px solid #d99616', padding: '12px 24px', textAlign: 'center', fontWeight: 500 }}>
          <span style={{ marginRight: 8 }}>⚠</span>
          {systemWarning}
        </div>
      )}

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

        <div className="dashboard-grid">
        
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
                  className={`form-control ${agentMessage?.type === 'error' ? 'is-invalid' : ''}`}
                  type="text"
                  value={newUsername}
                  onChange={e => {
                    setNewUsername(e.target.value);
                    if (agentMessage?.type === 'error') setAgentMessage(null);
                  }}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="password">Password</label>
                <input
                  id="password"
                  className={`form-control ${agentMessage?.type === 'error' ? 'is-invalid' : ''}`}
                  type="password"
                  value={newPassword}
                  onChange={e => {
                    setNewPassword(e.target.value);
                    if (agentMessage?.type === 'error') setAgentMessage(null);
                  }}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={creatingAgent}>
                {creatingAgent ? <span className="spinner" /> : 'Create Agent'}
              </button>
            </form>
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

            {needsManualMapping ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ color: 'var(--warning)', fontSize: 14 }}>
                  Could not automatically detect the phone number column. Please select it manually:
                </p>
                <div className="form-group">
                  <label className="form-label">Phone Number Column</label>
                  <select 
                    className="form-control"
                    value={selectedPhoneColIdx}
                    onChange={e => setSelectedPhoneColIdx(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="" disabled>Select a column...</option>
                    {availableHeaders.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button className="btn btn-primary" onClick={confirmManualUpload} disabled={uploading || selectedPhoneColIdx === ''}>
                    {uploading ? <span className="spinner" /> : 'Confirm & Upload'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setNeedsManualMapping(false); setPendingUploadData(null); }} disabled={uploading}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
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
            )}
          </div>

        </div>

        </div>


      </main>
      )}
    </div>
  );
}
