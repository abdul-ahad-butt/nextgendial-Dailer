import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

interface Batch {
  id: string;
  file_name: string;
  total_leads: number;
  uploaded_at: string;
  assigned_agent_username: string | null;
  dialed_count: number;
  completed_count: number;
  pending_count: number;
}

export function AdminLeadSheets() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  useEffect(() => {
    fetchBatches();
    
    const interval = setInterval(() => {
      fetchBatches();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchBatches = async () => {
    try {
      if (batches.length === 0) setLoadingBatches(true);
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
            className="btn btn-ghost"
            onClick={() => navigate('/admin')}
          >
            Dashboard
          </button>
          <button 
            className="btn btn-ghost"
            onClick={() => navigate('/admin/agent-status')}
          >
            Agent Status
          </button>
          <button 
            className="btn btn-ghost"
            onClick={() => navigate('/admin/leads')}
          >
            Leads
          </button>
          <button 
            className="btn btn-primary"
          >
            Lead Sheets
          </button>
          <button 
            className="btn btn-ghost"
            onClick={() => navigate('/admin')}
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

      <main className="main-content" style={{ maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Lead Sheets</h1>
          <p className="text-muted" style={{ margin: 0, marginTop: 4 }}>Manage and monitor uploaded lead sheets.</p>
        </div>

      <div className="card" style={{ padding: 24, overflowX: 'auto' }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Uploaded Lead Sheets</h2>
        {loadingBatches && batches.length === 0 ? (
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
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div>{b.dialed_count} / {b.total_leads} Dialed</div>
                      <div style={{ height: 6, width: '100%', background: 'var(--surface-hover)', borderRadius: 3, overflow: 'hidden' }}>
                         <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, (b.dialed_count / (b.total_leads || 1)) * 100))}%`, background: 'var(--primary)' }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.completed_count} Completed, {b.pending_count} Pending</div>
                    </div>
                  </td>
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
    </div>
  );
}
