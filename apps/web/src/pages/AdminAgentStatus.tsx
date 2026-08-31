import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

export function AdminAgentStatus() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  
  const [workSummary, setWorkSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkSummary();
    const interval = setInterval(() => {
      fetchWorkSummary();
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const fetchWorkSummary = async () => {
    try {
      const data = await api.admin.getWorkSummary();
      setWorkSummary(data);
    } catch (err) {
      console.error('Failed to load work summary', err);
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

        <div className="app-header-nav">
          <button className="btn btn-ghost" onClick={() => navigate('/admin')}>
            Dashboard
          </button>
          <button 
            className="btn btn-primary"
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
          <h1 style={{ fontSize: 20, margin: 0 }}>Agent Status</h1>
          <p className="text-muted" style={{ margin: 0, marginTop: 4 }}>Real-time monitoring of agent work time and live calls.</p>
        </div>

        <div className="card" style={{ padding: 24, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner" /></div>
          ) : workSummary.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px' }}>
              <p className="text-muted" style={{ marginBottom: 8 }}>No agents found.</p>
              <p className="text-muted text-sm">Create an agent in the Dashboard to see them here.</p>
            </div>
          ) : (
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Agent</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Live Call</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Total Calls</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Talk Time</th>
                  <th style={{ padding: '12px 16px', fontWeight: 500 }}>Active / Break</th>
                </tr>
              </thead>
              <tbody>
                {workSummary.map(a => {
                  const status = a.status || 'offline';
                  
                  return (
                    <tr key={a.agent_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{a.username}</div>
                        <div className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                          ID: {a.agent_id.slice(0, 8).toUpperCase()}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div className={`agent-status-badge agent-status-badge--${status}`} style={{ fontSize: 12, padding: '2px 8px', display: 'inline-flex' }}>
                          <span className={`status-dot status-dot--${status}`} />
                          {status.replace('_', ' ').toUpperCase()}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {a.live_call_destination ? (
                          <div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)' }}>
                              {a.live_call_destination}
                            </div>
                            <div className="text-muted text-xs">
                              {a.live_call_duration !== null ? `${a.live_call_duration}s` : 'Connecting...'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted text-sm">-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>{a.total_calls_made}</td>
                      <td style={{ padding: '12px 16px' }}>
                        {Math.floor(a.total_talk_time_seconds / 60)}m {a.total_talk_time_seconds % 60}s
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ color: 'var(--success)' }}>{Math.floor(a.total_active_seconds / 60)}m</span>
                        <span className="text-muted mx-1" style={{ margin: '0 4px' }}>/</span>
                        <span style={{ color: 'var(--warning)' }}>{Math.floor(a.total_break_seconds / 60)}m</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
