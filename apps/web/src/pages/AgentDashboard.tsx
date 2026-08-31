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
import { ActiveCallPanel } from '../components/ActiveCallPanel';
import { AgentStatusToggle } from '../components/AgentStatusToggle';
import { CallHistoryTable } from '../components/CallHistoryTable';
import { Dialer } from '../components/Dialer';
import { DispositionModal } from '../components/DispositionModal';
import { api } from '../lib/api';
import type { Lead } from '../types';

interface Props {
  agent: Agent;
  onLogout: () => void;
}

export function AgentDashboard({ agent, onLogout }: Props) {
  const { currentStatus, changedAt, setStatus, error: statusError } = useAgentStatus();
  const { activeCall, callContext, connectionState, mute, unmute, toggleHold, sendDTMF, hangup, answer, reject, newCall, retryConnection, lastFailedCall } =
    useTelnyxClient(agent.id, currentStatus);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showDisposition, setShowDisposition] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [isAutoDialEnabled, setIsAutoDialEnabled] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'error' | 'warning'>('error');
  // callerId: null means no phone number assigned to this agent
  const [callerId, setCallerId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [dialingLeadId, setDialingLeadId] = useState<string | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionDialed, setSessionDialed] = useState(0);

  // Fetch campaigns for script lookup + caller ID
  useEffect(() => {
    api.campaigns.list().then(setCampaigns).catch(console.error);
    fetchLeads(true);
    api.agent.getCallerId()
      .then((id) => setCallerId(id ?? null))
      .catch(() => setCallerId(null));
  }, []);

  const fetchLeads = (isInitial = false) => {
    setLoadingLeads(true);
    api.leads.list({ status: 'pending,calling' })
      .then(res => {
        setLeads(res.data);
        if (isInitial) {
          setSessionTotal(res.data.length);
          setSessionDialed(0);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingLeads(false));
  };

  // Show disposition modal when agent enters wrap_up
  useEffect(() => {
    if (currentStatus === 'wrap_up') {
      setShowDisposition(true);
    }
  }, [currentStatus]);

  // Toast for call failures
  useEffect(() => {
    if (lastFailedCall) {
      if (dialingLeadId) {
        api.leads.updateStatus(dialingLeadId, 'failed').then(() => fetchLeads()).catch(console.error);
        setDialingLeadId(null);
      }

      let friendly = lastFailedCall.category || lastFailedCall.cause;
      if (!lastFailedCall.category) {
        if (friendly === 'UNALLOCATED_NUMBER') friendly = 'Invalid Number';
        else if (friendly === 'USER_BUSY') friendly = 'Line Busy';
        else if (friendly === 'NO_ANSWER') friendly = 'No Answer';
        else if (friendly === 'NORMAL_CLEARING') friendly = 'Call Ended';
      }
      
      setToastType(lastFailedCall.isConfigIssue ? 'warning' : 'error');
      setToastMessage(`Call failed: ${friendly}`);
      const t = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(t);
    }
  }, [lastFailedCall, dialingLeadId]);

  const currentScript =
    callContext?.campaign_id
      ? (campaigns.find((c) => c.id === callContext.campaign_id)?.script ?? null)
      : null;

  const handleManualCall = useCallback(
    async (number: string, leadId?: string) => {
      if (!callerId) return; // guard: no number assigned

      // 1. Log the manual call to create the call_logs row
      const logRes = await api.calls
        .logManual({ agentId: agent.id, phoneNumber: number, leadId })
        .catch(console.error);

      // 2. Initiate the call using the agent's assigned number as caller ID
      const callLogId = logRes?.id ?? null;
      newCall(number, callerId, callLogId, leadId || null);

      // 3. Update the lead status to 'calling'
      if (leadId) {
        setDialingLeadId(leadId);
        setSessionDialed(prev => prev + 1);
        await api.leads.updateStatus(leadId, 'calling').catch(console.error);
        fetchLeads();
      }
    },
    [agent.id, newCall, callerId],
  );

  const handleDispositionSubmitted = useCallback(() => {
    setShowDisposition(false);
    setDialingLeadId(null);
    fetchLeads(); // Refresh leads in case one was completed
  }, []);

  // Auto-dialer loop
  useEffect(() => {
    if (
      isAutoDialEnabled &&
      currentStatus === 'available' &&
      connectionState === 'ready' &&
      !activeCall &&
      !showDisposition
    ) {
      const timer = setTimeout(async () => {
        try {
          if (leads.length === 0 || !leads.some(l => l.status === 'pending')) {
            setIsAutoDialEnabled(false);
            setToastMessage('Auto-Dial stopped: No pending leads available.');
            setTimeout(() => setToastMessage(null), 5000);
            return;
          }
          const nextLead = leads.find(l => l.status === 'pending');
          if (nextLead) handleManualCall(nextLead.phone_number, nextLead.id);
        } catch (err) {
          console.error('[AutoDialer] Error fetching pending leads:', err);
        }
      }, 3000); // 3-second wrap-up delay

      return () => clearTimeout(timer);
    }
  }, [isAutoDialEnabled, currentStatus, connectionState, activeCall, showDisposition, handleManualCall, leads]);

  const displayAgent = agent;

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
          <div className="connection-status-container">
            {connectionState === 'connecting' && (
              <div className="status-toast status-toast--connecting">
                <span className="spinner spinner-sm" aria-hidden="true" />
                <span>Connecting WebRTC…</span>
              </div>
            )}
            {connectionState === 'error' && (
              <div className="status-toast status-toast--error">
                <span style={{ fontSize: 16 }}>⚠</span>
                <span style={{ flex: 1 }}>WebRTC connection error</span>
                <button 
                  className="btn btn-primary" 
                  style={{ padding: '4px 10px', fontSize: 12, height: 26 }}
                  onClick={retryConnection}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          <div
            className="agent-card"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '8px 12px', border: 'none', background: 'transparent' }}
          >
            <div className="agent-avatar" aria-hidden="true">
              {displayAgent.username?.charAt(0).toUpperCase() || '?'}
            </div>
            <div>
              <div className="agent-name" style={{ fontSize: 13 }}>{displayAgent.username || 'Agent'}</div>
              <div className="text-muted text-xs" style={{ marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                ID: {displayAgent.id.slice(0, 8).toUpperCase()}
              </div>
              <div
                className={`agent-status-badge agent-status-badge--${currentStatus}`}
                style={{ marginTop: 4 }}
                role="status"
                aria-live="polite"
              >
                <span className={`status-dot status-dot--${currentStatus}`} aria-hidden="true" />
                {currentStatus.replace('_', ' ')}
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

      {/* ── Active Call Panel (Floating) ── */}
      {(activeCall || currentStatus === 'wrap_up' || currentStatus === 'on_call') && (
        <ActiveCallPanel
          currentStatus={currentStatus}
          activeCall={activeCall}
          callContext={callContext}
          script={currentScript}
          onMute={mute}
          onUnmute={unmute}
          onToggleHold={toggleHold}
          onSendDTMF={sendDTMF}
          onHangup={hangup}
          onAnswer={answer}
          onReject={reject}
        />
      )}

      {/* ── Status error banner ── */}
      {statusError && (
        <div className="status-toast status-toast--error" style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }} role="alert">
          {statusError}
        </div>
      )}

      {toastMessage && (
        <div className={`status-toast status-toast--${toastType}`} style={{ position: 'fixed', top: 110, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: toastType === 'warning' ? '#473619' : 'var(--danger-dim)', border: toastType === 'warning' ? '1px solid #d99616' : '1px solid var(--danger)', color: '#fff', padding: '12px 20px', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }} role="alert">
          {toastMessage}
        </div>
      )}

      {/* ── WebRTC Media Elements ── */}
      <audio id="remote-media" autoPlay />
      <audio id="local-media" autoPlay muted />

      {/* ── Main layout ── */}
      <div className="app-main">
        {/* Sidebar */}
        <aside className="sidebar" aria-label="Agent controls">
          {/* Agent info */}
          <div className="agent-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="agent-avatar">{displayAgent.username?.charAt(0).toUpperCase() || '?'}</div>
              <div>
                <div className="agent-name">{displayAgent.username || 'Agent'}</div>
                <div className="agent-email text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                  ID: {displayAgent.id.slice(0, 8).toUpperCase()}
                </div>
              </div>
            </div>
          </div>

          {/* Status toggle */}
          <AgentStatusToggle status={currentStatus} changedAt={changedAt} onSetStatus={setStatus} />

          {/* Auto-Dial toggle */}
          <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Auto-Dialer</span>
              <button 
                className={`btn ${isAutoDialEnabled ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '4px 10px', fontSize: 11, minWidth: 48 }}
                onClick={() => setIsAutoDialEnabled(!isAutoDialEnabled)}
              >
                {isAutoDialEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Automatically dial next pending lead when Available.
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border)' }} role="separator" />

          {/* Dialer */}
          <div>
            <div className="card-title">Manual Dial</div>
            {callerId === undefined ? (
              // Still loading caller ID
              <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                <span className="spinner spinner-sm" aria-hidden="true" /> Loading...
              </div>
            ) : callerId === null ? (
              // No number assigned — gate the dialer
              <div
                role="alert"
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#f87171',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <strong>No phone number assigned.</strong><br />
                Contact your admin to assign a number before dialing.
              </div>
            ) : (
              <Dialer
                onCall={handleManualCall}
                disabled={
                  connectionState !== 'ready' ||
                  currentStatus === 'on_call' ||
                  currentStatus === 'dialing' ||
                  currentStatus === 'wrap_up'
                }
              />
            )}
          </div>
        </aside>

        <main className="main-content" id="main-content" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* Auto-Dialer Session Panel */}
          {isAutoDialEnabled && (
            <section aria-labelledby="autodial-heading">
              <div className="card" style={{ padding: 20, border: '1px solid var(--primary)', background: 'var(--surface-sunken)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h2 id="autodial-heading" style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                      Auto-Dialer Active
                    </h2>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      Dialing session in progress. Stay in <strong>Available</strong> status to continue.
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger-dim)' }}
                    onClick={() => setIsAutoDialEnabled(false)}
                  >
                    Stop Auto-Dial
                  </button>
                </div>

                <div className="dashboard-grid-3" style={{ marginBottom: 20 }}>
                  <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Session Progress</div>
                    <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{sessionDialed} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/ {sessionTotal}</span></div>
                  </div>
                  <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remaining</div>
                    <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{leads.filter(l => l.status === 'pending').length}</div>
                  </div>
                  <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Action</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 8, color: currentStatus === 'available' ? 'var(--primary)' : 'var(--text-secondary)' }}>
                      {currentStatus === 'available' ? (activeCall ? 'On Call' : 'Waiting/Dialing...') : 'Paused (Not Available)'}
                    </div>
                  </div>
                </div>

                {leads.filter(l => l.status === 'pending').length === 0 && !activeCall && (
                  <div style={{ textAlign: 'center', padding: '24px 12px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>No Leads Left</h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                      You have reached the end of your pending leads list. <br/>
                      Please request more leads or dial manually.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          <section aria-labelledby="leads-heading">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 id="leads-heading" style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
                My Leads (Pending)
              </h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => fetchLeads()}>
                Refresh
              </button>
            </div>
            
            <div className="card" style={{ overflowX: 'auto' }}>
              {loadingLeads ? (
                <div style={{ padding: '24px' }}>
                  <div className="skeleton skeleton-row"></div>
                  <div className="skeleton skeleton-row" style={{ width: '80%' }}></div>
                </div>
              ) : leads.length === 0 ? (
                <div style={{ padding: '40px 24px' }}>
                  <div className="empty-state" style={{ border: 'none', background: 'transparent' }}>
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-title">No pending leads</div>
                    <div className="empty-state-text">You have no leads waiting to be called right now.</div>
                  </div>
                </div>
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
                          <span className={`pill-chip pill-chip--${lead.id === dialingLeadId ? 'calling' : (lead.status === 'calling' ? 'pending' : lead.status)}`}>
                            {lead.id === dialingLeadId ? 'calling' : (lead.status === 'calling' ? 'pending' : lead.status)}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button 
                            className="btn btn-primary btn-dial" 
                            style={{ padding: '4px 12px', fontSize: 13 }}
                            disabled={
                              !callerId ||
                              connectionState !== 'ready' ||
                              currentStatus === 'on_call' ||
                              currentStatus === 'dialing' ||
                              currentStatus === 'wrap_up'
                            }
                            onClick={() => handleManualCall(lead.phone_number, lead.id)}
                            title={
                              !callerId ? 'No phone number assigned' :
                              connectionState !== 'ready' ? 'WebRTC Not Connected' : ''
                            }
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
