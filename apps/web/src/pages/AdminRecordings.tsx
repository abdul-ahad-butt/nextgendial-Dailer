import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

interface CallRecording {
  id: string;
  call_control_id: string;
  agent_id: string | null;
  agent_username: string | null;
  destination_number: string;
  duration_seconds: number;
  recording_url: string;
  created_at: string;
}

export function AdminRecordings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [recordings, setRecordings] = useState<CallRecording[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      setLoading(true);
      const data = await api.admin.getCallRecordings();
      setRecordings(data);
    } catch (err) {
      console.error('Failed to fetch call recordings', err);
    } finally {
      setLoading(false);
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
            className="btn btn-ghost"
            onClick={() => navigate('/admin/leadsheets')}
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
            className="btn btn-primary"
          >
            Call Recordings
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <main className="main-content" style={{ maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Call Recordings</h1>
          <p className="text-muted" style={{ margin: 0, marginTop: 4 }}>Review past call recordings from all agents.</p>
        </div>

        <div className="card" style={{ padding: 24, overflowX: 'auto' }}>
          {loading ? (
            <span className="spinner" />
          ) : recordings.length === 0 ? (
            <p className="text-muted text-sm">No call recordings found.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Agent</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Destination</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Duration</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Recording</th>
                </tr>
              </thead>
              <tbody>
                {recordings.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 8px' }}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      {r.agent_username || 'Unknown'}
                    </td>
                    <td style={{ padding: '12px 8px' }}>{r.destination_number}</td>
                    <td style={{ padding: '12px 8px' }}>
                      {Math.floor(r.duration_seconds / 60)}m {r.duration_seconds % 60}s
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <audio controls src={r.recording_url} style={{ height: 32 }} />
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
