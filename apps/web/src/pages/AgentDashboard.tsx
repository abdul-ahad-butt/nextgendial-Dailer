/**
 * apps/web/src/pages/Dashboard.tsx
 *
 * Main agent workspace. Composes all components:
 *  - Header with logo + connection state
 *  - ActiveCallBar (sticky, shown when on_call or wrap_up)
 *  - DispositionModal (blocking overlay when wrap_up)
 *  - Sidebar: AgentStatusToggle + Dialpad
 *  - Main: CallHistoryTable
 *
 * Script for active campaign is fetched once and passed down to ActiveCallBar.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Agent, Campaign } from '../types';
import { useAgentStatus } from '../hooks/useAgentStatus';
import { useTelnyxClient } from '../hooks/useTelnyxClient';
import { ActiveCallBar } from '../components/ActiveCallBar';
import { AgentStatusToggle } from '../components/AgentStatusToggle';
import { CallHistoryTable } from '../components/CallHistoryTable';
import { Dialpad } from '../components/Dialpad';
import { DispositionModal } from '../components/DispositionModal';
import { api } from '../lib/api';
import type { Lead } from '../types';

interface Props {
  agent: Agent;
  onLogout: () => void;
}

export function AgentDashboard({ agent, onLogout }: Props) {
  const { agent: liveAgent, setStatus, error: statusError } = useAgentStatus(agent.id);
  const { activeCall, callContext, connectionState, mute, unmute, hangup, newCall } =
    useTelnyxClient(agent.id);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showDisposition, setShowDisposition] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);

  // Fetch campaigns for script lookup
  useEffect(() => {
    api.campaigns.list().then(setCampaigns).catch(console.error);
    fetchLeads();
  }, []);

  const fetchLeads = () => {
    setLoadingLeads(true);
    api.leads.list({ status: 'pending' })
      .then(res => setLeads(res.data))
      .catch(console.error)
      .finally(() => setLoadingLeads(false));
  };

  // Show disposition modal when agent enters wrap_up
  useEffect(() => {
    if (liveAgent?.status === 'wrap_up') {
      setShowDisposition(true);
    }
  }, [liveAgent?.status]);

  const currentScript =
    callContext?.campaign_id
      ? (campaigns.find((c) => c.id === callContext.campaign_id)?.script ?? null)
      : null;

  const handleManualCall = useCallback(
    async (number: string, leadId?: string) => {
      newCall(number);
      // Log the manual call — we don't have call_control_id yet at this point,
      // the frontend can update it once the SDK call object is available.
      await api.calls
        .logManual({ agentId: agent.id, phoneNumber: number, leadId })
        .catch(console.error);
    },
    [agent.id, newCall],
  );

  const handleDispositionSubmitted = useCallback(() => {
    setShowDisposition(false);
    fetchLeads(); // Refresh leads in case one was completed
  }, []);

  const displayAgent = liveAgent ?? agent;

  return (
    <div className="app-layout">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-dot" aria-hidden="true" />
          NextGenDial
        </div>

        {/* Connection state */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {connectionState === 'connecting' && (
            <div className="connection-banner connection-banner--connecting">
              <span className="spinner" aria-hidden="true" />
              Connecting WebRTC…
            </div>
          )}
          {connectionState === 'error' && (
            <div className="connection-banner connection-banner--error">
              ⚠ WebRTC connection error
            </div>
          )}

          <div
            className="agent-card"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '8px 12px', border: 'none', background: 'transparent' }}
          >
            <div className="agent-avatar" aria-hidden="true">
              {displayAgent.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="agent-name" style={{ fontSize: 13 }}>{displayAgent.name}</div>
              <div
                className={`agent-status-badge agent-status-badge--${displayAgent.status}`}
                style={{ marginTop: 2 }}
                role="status"
                aria-live="polite"
              >
                <span className={`status-dot status-dot--${displayAgent.status}`} aria-hidden="true" />
                {displayAgent.status.replace('_', ' ')}
              </div>
            </div>
          </div>

          <button
            id="logout-btn"
            className="btn btn-ghost"
            onClick={onLogout}
            aria-label="Switch agent"
          >
            Switch Agent
          </button>
        </div>
      </header>

      {/* ── Active Call Bar (sticky) ── */}
      {(activeCall || displayAgent.status === 'wrap_up' || displayAgent.status === 'on_call') && (
        <ActiveCallBar
          agent={displayAgent}
          activeCall={activeCall}
          callContext={callContext}
          script={currentScript}
          onMute={mute}
          onUnmute={unmute}
          onHangup={hangup}
        />
      )}

      {/* ── Status error banner ── */}
      {statusError && (
        <div className="connection-banner connection-banner--error" role="alert">
          {statusError}
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="app-main">
        {/* Sidebar */}
        <aside className="sidebar" aria-label="Agent controls">
          {/* Agent info */}
          <div className="agent-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="agent-avatar">{displayAgent.name.charAt(0).toUpperCase()}</div>
              <div>
                <div className="agent-name">{displayAgent.name}</div>
                <div className="agent-email">{displayAgent.email}</div>
              </div>
            </div>
          </div>

          {/* Status toggle */}
          <AgentStatusToggle agent={displayAgent} onSetStatus={setStatus} />

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border)' }} role="separator" />

          {/* Dialpad */}
          <div>
            <div className="card-title">Manual Dial</div>
            <Dialpad
              agentId={agent.id}
              onCall={handleManualCall}
              disabled={
                displayAgent.status === 'on_call' ||
                displayAgent.status === 'dialing' ||
                displayAgent.status === 'wrap_up'
              }
            />
          </div>
        </aside>

        {/* Main content */}
        <main className="main-content" id="main-content" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          
          <section aria-labelledby="leads-heading">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 id="leads-heading" style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
                My Leads (Pending)
              </h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={fetchLeads}>
                Refresh
              </button>
            </div>
            
            <div className="card" style={{ overflow: 'hidden' }}>
              {loadingLeads ? (
                <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner" /></div>
              ) : leads.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No pending leads assigned.</div>
              ) : (
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-sunken)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '12px 16px', fontWeight: 500 }}>Name</th>
                      <th style={{ padding: '12px 16px', fontWeight: 500 }}>Phone</th>
                      <th style={{ padding: '12px 16px', fontWeight: 500 }}>Status</th>
                      <th style={{ padding: '12px 16px', fontWeight: 500, textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map(lead => (
                      <tr key={lead.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 16px' }}>
                          {lead.first_name || lead.last_name ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'Unknown'}
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>{lead.phone_number}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`status-badge status-badge--${lead.status}`}>{lead.status}</span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button 
                            className="btn btn-primary" 
                            style={{ padding: '4px 12px', fontSize: 13 }}
                            disabled={displayAgent.status === 'on_call' || displayAgent.status === 'dialing' || displayAgent.status === 'wrap_up'}
                            onClick={() => handleManualCall(lead.phone_number, lead.id)}
                          >
                            Dial
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section aria-labelledby="history-heading">
            <h2 id="history-heading" style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Call History
            </h2>
            <CallHistoryTable agentId={agent.id} />
          </section>
        </main>
      </div>

      {/* ── Disposition Modal (blocking) ── */}
      {showDisposition && (
        <DispositionModal
          callLog={callContext}
          onSubmitted={handleDispositionSubmitted}
        />
      )}
    </div>
  );
}
