import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

interface Lead {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  assigned_user_id: string | null;
  assigned_agent_username: string | null;
  batch_id: string | null;
  batch_name: string | null;
}

export function AdminLeads() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<{id: string, username: string}[]>([]);
  
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  
  // Bulk Assign State
  const [bulkAssignAgentId, setBulkAssignAgentId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    fetchLeads();
    fetchAgents();
  }, []);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const data = await api.admin.getLeads();
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads', err);
    } finally {
      setLoading(false);
    }
  };
  
  const fetchAgents = async () => {
    try {
      const data = await api.admin.getAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to load agents', err);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  const toggleAll = () => {
    if (selectedLeadIds.size === leads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(leads.map(l => l.id)));
    }
  };

  const handleSingleAssign = async (leadId: string, userId: string) => {
    try {
      await api.admin.assignLead(leadId, userId || null);
      await fetchLeads(); // refresh
    } catch (err) {
      console.error('Failed to assign lead', err);
      alert('Failed to assign lead.');
    }
  };

  const handleBulkAssign = async () => {
    if (selectedLeadIds.size === 0) return;
    try {
      setIsAssigning(true);
      const ids = Array.from(selectedLeadIds);
      await api.admin.assignBulkLeads(ids, bulkAssignAgentId || null);
      setSelectedLeadIds(new Set());
      await fetchLeads();
    } catch (err) {
      console.error('Bulk assign failed', err);
      alert('Failed to bulk assign leads.');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleDistributeRandomly = async () => {
    if (selectedLeadIds.size === 0) return;
    if (agents.length === 0) {
      alert("No agents available to distribute to.");
      return;
    }
    
    if (!window.confirm(`Are you sure you want to distribute ${selectedLeadIds.size} leads randomly across ${agents.length} agents?`)) {
      return;
    }

    try {
      setIsAssigning(true);
      const ids = Array.from(selectedLeadIds);
      const agentIds = agents.map(a => a.id);
      await api.admin.distributeLeadsRandomly(ids, agentIds);
      setSelectedLeadIds(new Set());
      await fetchLeads();
    } catch (err) {
      console.error('Random distribution failed', err);
      alert('Failed to distribute leads.');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleDeleteLead = async (id: string) => {
    if (!window.confirm('Delete this lead?')) return;
    try {
      await api.admin.deleteLead(id);
      fetchLeads();
    } catch (err) {
      console.error(err);
      alert('Failed to delete lead');
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
          <button className="btn btn-ghost" onClick={() => navigate('/admin')}>Dashboard</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/agent-status')}>Agent Status</button>
          <button className="btn btn-primary" onClick={() => navigate('/admin/leads')}>Leads</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/leadsheets')}>Lead Sheets</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin')}>Phone Numbers</button>
          <button className="btn btn-ghost" onClick={() => navigate('/admin/recordings')}>Call Recordings</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      <main className="main-content" style={{ maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>All Leads</h1>
          <p className="text-muted" style={{ margin: 0, marginTop: 4 }}>Assign or distribute leads across agents.</p>
        </div>

        {/* ── Bulk Actions Bar ── */}
        {selectedLeadIds.size > 0 && (
          <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16, background: 'var(--surface-hover)' }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>
              {selectedLeadIds.size} leads selected
            </span>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select 
                className="input" 
                style={{ padding: '6px 12px', fontSize: 13, minWidth: 150 }}
                value={bulkAssignAgentId}
                onChange={e => setBulkAssignAgentId(e.target.value)}
              >
                <option value="">-- General Pool --</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.username}</option>
                ))}
              </select>
              <button 
                className="btn btn-primary" 
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={handleBulkAssign}
                disabled={isAssigning}
              >
                Assign Selected
              </button>
            </div>
            
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            
            <button 
              className="btn btn-ghost" 
              style={{ padding: '6px 12px', fontSize: 13, border: '1px solid var(--border)' }}
              onClick={handleDistributeRandomly}
              disabled={isAssigning}
            >
              Distribute Randomly
            </button>
          </div>
        )}

        <div className="card" style={{ padding: 24, overflowX: 'auto' }}>
          {loading && leads.length === 0 ? (
             <span className="spinner" />
          ) : leads.length === 0 ? (
             <p className="text-muted text-sm">No leads found.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px', width: 40 }}>
                    <input 
                      type="checkbox" 
                      checked={selectedLeadIds.size === leads.length && leads.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Name</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Phone</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Status</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Batch</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500 }}>Assignment</th>
                  <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 8px' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={() => toggleSelection(lead.id)}
                      />
                    </td>
                    <td style={{ padding: '12px 8px', fontWeight: 500 }}>
                      {lead.first_name || lead.last_name ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'Unknown'}
                    </td>
                    <td style={{ padding: '12px 8px', fontFamily: 'monospace' }}>
                      {lead.phone_number}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <span className={`pill-chip pill-chip--${lead.status}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                      {lead.batch_name || 'N/A'}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <select 
                        className="input" 
                        style={{ padding: '4px 8px', fontSize: 12, height: 'auto', minWidth: 120 }}
                        value={lead.assigned_user_id || ''}
                        onChange={(e) => handleSingleAssign(lead.id, e.target.value)}
                      >
                        <option value="">General Pool</option>
                        {agents.map(a => (
                          <option key={a.id} value={a.id}>{a.username}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <button 
                        className="btn btn-ghost" 
                        style={{ color: 'var(--danger)', padding: '4px 8px', fontSize: 12 }}
                        onClick={() => handleDeleteLead(lead.id)}
                      >
                        Delete
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
