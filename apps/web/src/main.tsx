/**
 * apps/web/src/main.tsx
 *
 * Application root. Handles agent selection before showing the dashboard.
 * MVP approach: list available agents from the API → agent picks their name.
 * (Full auth is out of scope per spec.)
 */

import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import type { Agent } from './types';
import { api } from './lib/api';
import { Dashboard } from './pages/Dashboard';

// ── Agent Selector (login screen) ───────────────────────────

function AgentSelector({ onSelect }: { onSelect: (agent: Agent) => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agents
      .list()
      .then(setAgents)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon" aria-hidden="true">📞</div>
          <h1 className="login-title">NextGenDial</h1>
          <p className="login-subtitle">Select your agent profile to begin</p>
        </div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <span className="spinner" aria-label="Loading agents…" />
          </div>
        )}

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--danger)',
              fontSize: 13,
              padding: '10px 14px',
              background: 'var(--danger-dim)',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            {error}
          </p>
        )}

        {!loading && agents.length === 0 && !error && (
          <p
            className="text-muted text-sm"
            style={{ textAlign: 'center', padding: 16 }}
          >
            No agents found. Create one via the API first.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agents.map((agent) => (
            <button
              key={agent.id}
              id={`agent-select-${agent.id}`}
              className="btn btn-ghost"
              style={{
                justifyContent: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                fontSize: 14,
              }}
              onClick={() => onSelect(agent)}
            >
              <div
                className="agent-avatar"
                style={{ width: 32, height: 32, fontSize: 13 }}
                aria-hidden="true"
              >
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600 }}>{agent.name}</div>
                <div className="text-sm text-muted">{agent.email}</div>
              </div>
              <div
                className={`agent-status-badge agent-status-badge--${agent.status}`}
                style={{ marginLeft: 'auto', flexShrink: 0 }}
              >
                {agent.status}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── App root ─────────────────────────────────────────────────

function App() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(() => {
    // Persist agent selection across page refreshes
    const saved = sessionStorage.getItem('ngd_agent_id');
    if (saved) {
      return { id: saved } as Agent; // Will be replaced by full data on mount
    }
    return null;
  });
  const [fullAgent, setFullAgent] = useState<Agent | null>(null);

  // Resolve the full agent object if we only have the ID
  useEffect(() => {
    if (!selectedAgent?.id) return;
    if (selectedAgent.name) {
      setFullAgent(selectedAgent);
      return;
    }
    api.agents.get(selectedAgent.id).then(setFullAgent).catch(() => {
      // If agent not found (e.g. deleted), clear the selection
      sessionStorage.removeItem('ngd_agent_id');
      setSelectedAgent(null);
    });
  }, [selectedAgent]);

  const handleSelect = useCallback((agent: Agent) => {
    sessionStorage.setItem('ngd_agent_id', agent.id);
    setSelectedAgent(agent);
    setFullAgent(agent);
  }, []);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('ngd_agent_id');
    setSelectedAgent(null);
    setFullAgent(null);
  }, []);

  if (!fullAgent) {
    return <AgentSelector onSelect={handleSelect} />;
  }

  return <Dashboard agent={fullAgent} onLogout={handleLogout} />;
}

// ── Mount ────────────────────────────────────────────────────

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
