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

interface Props {
  agent: Agent;
  onLogout: () => void;
}

export function Dashboard({ agent, onLogout }: Props) {
  const { agent: liveAgent, setStatus, error: statusError } = useAgentStatus(agent.id);
  const { activeCall, callContext, connectionState, mute, unmute, hangup, newCall } =
    useTelnyxClient(agent.id);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showDisposition, setShowDisposition] = useState(false);

  // Fetch campaigns for script lookup
  useEffect(() => {
    api.campaigns.list().then(setCampaigns).catch(console.error);
  }, []);

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
    async (number: string) => {
      newCall(number);
      // Log the manual call — we don't have call_control_id yet at this point,
      // the frontend can update it once the SDK call object is available.
      await api.calls
        .logManual({ agentId: agent.id, phoneNumber: number })
        .catch(console.error);
    },
    [agent.id, newCall],
  );

  const handleDispositionSubmitted = useCallback(() => {
    setShowDisposition(false);
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
        <main className="main-content" id="main-content">
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
