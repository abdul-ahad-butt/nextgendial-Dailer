import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

interface CallRecording {
  id: string;
  call_control_id: string;
  call_log_id: string | null;
  agent_id: string | null;
  agent_username: string | null;
  destination_number: string;
  direction: string;
  duration_seconds: number;
  r2_key: string | null;
  recording_url: string | null;
  playback_url: string | null;
  created_at: string;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function AdminRecordings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [recordings, setRecordings] = useState<CallRecording[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterAgentId, setFilterAgentId] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [agents, setAgents] = useState<{ id: string; username: string }[]>([]);

  useEffect(() => {
    api.admin.getAgents()
      .then((data: any[]) => setAgents(data.map((a: any) => ({ id: a.id, username: a.username }))))
      .catch(console.error);
    fetchRecordings();
  }, []);

  const fetchRecordings = async (agentId?: string, date?: string) => {
    try {
      setLoading(true);
      const data = await api.admin.getCallRecordings(agentId || undefined, date || undefined);
      setRecordings(data);
    } catch (err) {
      console.error('Failed to fetch call recordings', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = () => {
    fetchRecordings(filterAgentId, filterDate);
  };

  const handleClearFilters = () => {
    setFilterAgentId('');
    setFilterDate('');
    fetchRecordings();
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
          <button className="btn btn-ghost" onClick={() => navigate('/admin')}>Dashboard</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/agent-status')}>Agent Status</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/leads')}>Leads</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/leadsheets')}>Lead Sheets</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin')}>Phone Numbers</button>
          <button className="btn btn-primary">Call Recordings</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <main className="main-content" style={{ maxWidth: 1100, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Call Recordings</h1>
          <p className="text-muted" style={{ margin: 0, marginTop: 4 }}>Review past call recordings from all agents.</p>
        </div>

        {/* Filter bar */}
        <div className="card" style={{ padding: '14px 20px', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="filter-agent" style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Agent
            </label>
            <select
              id="filter-agent"
              className="input"
              style={{ minWidth: 180 }}
              value={filterAgentId}
              onChange={(e) => setFilterAgentId(e.target.value)}
            >
              <option value="">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.username}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="filter-date" style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Date
            </label>
            <input
              id="filter-date"
              type="date"
              className="input"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" onClick={handleFilter}>Apply</button>
          <button className="btn btn-ghost" onClick={handleClearFilters}>Clear</button>
        </div>

        <div className="card" style={{ padding: 24, overflowX: 'auto' }}>
          {loading ? (
             <div style={{ padding: '24px' }}>
                <div className="skeleton skeleton-row"></div>
                <div className="skeleton skeleton-row" style={{ width: '90%' }}></div>
                <div className="skeleton skeleton-row" style={{ width: '80%' }}></div>
             </div>
          ) : recordings.length === 0 ? (
             <div style={{ padding: '60px 24px' }}>
               <div className="empty-state" style={{ border: 'none', background: 'transparent' }}>
                 <div className="empty-state-icon">🎙️</div>
                 <div className="empty-state-title">No recordings found</div>
                 <div className="empty-state-text">There are no call recordings matching your filters.</div>
               </div>
             </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Agent</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Direction</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Destination</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Duration</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Recording</th>
                </tr>
              </thead>
              <tbody>
                {recordings.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      {r.agent_username || <span style={{ color: 'var(--text-muted)' }}>Unknown</span>}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: r.direction === 'inbound' ? 'rgba(34,197,94,0.15)' : 'rgba(99,102,241,0.15)',
                          color: r.direction === 'inbound' ? '#4ade80' : '#818cf8',
                        }}
                      >
                        {r.direction || 'outbound'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>{r.destination_number || '—'}</td>
                    <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                      {formatDuration(r.duration_seconds)}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      {r.playback_url ? (
                        <audio controls src={r.playback_url} style={{ height: 32, minWidth: 200 }} />
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Not available</span>
                      )}
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

