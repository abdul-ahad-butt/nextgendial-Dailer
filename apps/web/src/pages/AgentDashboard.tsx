/**
 * apps/web/src/pages/AgentDashboard.tsx
 *
 * Modernized Agent Workspace with:
 *  - Tactile Keypad with audio waveform & DTMF tones
 *  - Real-time Tenant Credit Balance safeguard indicator
 *  - Scheduled Callbacks Drawer with due reminders
 *  - Two-Way SMS Inbox for direct lead engagement
 *  - Floating row cards and glassmorphic aesthetics
 */

import { useCallback, useEffect, useState } from 'react';
import type { Agent, Campaign, Lead } from '../types';
import { useAgentStatus } from '../hooks/useAgentStatus';
import { useTelnyxClient } from '../hooks/useTelnyxClient';
import { ActiveCallPanel } from '../components/ActiveCallPanel';
import { AgentStatusToggle } from '../components/AgentStatusToggle';
import { CallHistoryTable } from '../components/CallHistoryTable';
import { Keypad } from '../components/dialer/Keypad';
import { CallbackDrawer } from '../components/dialer/CallbackDrawer';
import { SMSInbox } from '../components/messaging/SMSInbox';
import { DispositionModal } from '../components/DispositionModal';
import { api } from '../lib/api';
import { getAudioMuted, setAudioMuted, initAudioContext } from '../lib/audio';
import { formatCurrency, formatE164 } from '../utils/formatters';

interface Props {
  agent: Agent;
  onLogout: () => void;
}

export function AgentDashboard({ agent, onLogout }: Props) {
  const { currentStatus, changedAt, setStatus, error: statusError } = useAgentStatus();
  const {
    activeCall,
    callContext,
    connectionState,
    mute,
    unmute,
    toggleHold,
    sendDTMF,
    hangup,
    answer,
    reject,
    newCall,
    retryConnection,
    lastFailedCall,
  } = useTelnyxClient(agent.id, currentStatus);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showDisposition, setShowDisposition] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [isAutoDialEnabled, setIsAutoDialEnabled] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'error' | 'warning' | 'info'>('error');

  // Tenant Credit Stats
  const [creditBalance, setCreditBalance] = useState<{ credits: number; allocated: number; spent: number } | null>(null);

  // Drawers
  const [isCallbackDrawerOpen, setIsCallbackDrawerOpen] = useState(false);
  const [pendingCallbacksCount, setPendingCallbacksCount] = useState(0);
  const [isSMSInboxOpen, setIsSMSInboxOpen] = useState(false);
  const [smsTargetPhone, setSmsTargetPhone] = useState<string>('');

  // Caller ID
  const [callerId, setCallerId] = useState<string | null | undefined>(undefined);
  const [dialingLeadId, setDialingLeadId] = useState<string | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionDialed, setSessionDialed] = useState(0);
  const [isAudioMutedState, setIsAudioMutedState] = useState(() => getAudioMuted());

  const handleToggleMute = useCallback(() => {
    const newState = !isAudioMutedState;
    setIsAudioMutedState(newState);
    setAudioMuted(newState);
  }, [isAudioMutedState]);

  const fetchCredits = async () => {
    try {
      const creds = await api.agent.getCredits();
      setCreditBalance(creds);
    } catch (err) {
      // ignore
    }
  };

  const fetchCallbacksCount = async () => {
    try {
      const dueList = await api.callbacks.list({ due_only: true });
      setPendingCallbacksCount(dueList?.length || 0);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    api.campaigns.list().then(setCampaigns).catch(console.error);
    fetchLeads(true);
    fetchCredits();
    fetchCallbacksCount();

    api.agent.getCallerId()
      .then((id) => setCallerId(id ?? null))
      .catch(() => setCallerId(null));

    const pollInterval = setInterval(() => {
      fetchCredits();
      fetchCallbacksCount();
    }, 15000);

    return () => clearInterval(pollInterval);
  }, []);

  const fetchLeads = (isInitial = false) => {
    setLoadingLeads(true);
    api.leads.list({ status: 'pending,calling' })
      .then((res) => {
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
      if (!callerId) return;

      // Pre-flight Credit Lockout Safeguard:
      if (creditBalance && creditBalance.credits < 0.05) {
        setToastType('error');
        setToastMessage('INSUFFICIENT CREDITS: Your organization balance is depleted ($0.00). Please contact Super Admin.');
        setTimeout(() => setToastMessage(null), 6000);
        return;
      }

      // 1. Log manual call
      const logRes = await api.calls
        .logManual({ agentId: agent.id, phoneNumber: number, leadId })
        .catch((err) => {
          setToastType('error');
          setToastMessage(err.message || 'Call initiation blocked');
          setTimeout(() => setToastMessage(null), 5000);
          return null;
        });

      if (!logRes) return;

      // 2. Initiate call
      const callLogId = logRes.id ?? null;
      newCall(number, callerId, callLogId, leadId || null);

      // 3. Update lead status if applicable
      if (leadId) {
        setDialingLeadId(leadId);
        setSessionDialed((prev) => prev + 1);
        await api.leads.updateStatus(leadId, 'calling').catch(console.error);
        fetchLeads();
      }
    },
    [agent.id, newCall, callerId, creditBalance],
  );

  const handleDispositionSubmitted = useCallback(() => {
    setShowDisposition(false);
    setDialingLeadId(null);
    fetchLeads();
    fetchCredits();
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
      if (creditBalance && creditBalance.credits < 0.05) {
        setIsAutoDialEnabled(false);
        setToastType('warning');
        setToastMessage('Auto-Dial halted: Insufficient organization credits.');
        setTimeout(() => setToastMessage(null), 5000);
        return;
      }

      const timer = setTimeout(async () => {
        try {
          if (leads.length === 0 || !leads.some((l) => l.status === 'pending')) {
            setIsAutoDialEnabled(false);
            setToastMessage('Auto-Dial stopped: No pending leads available.');
            setTimeout(() => setToastMessage(null), 5000);
            return;
          }
          const nextLead = leads.find((l) => l.status === 'pending');
          if (nextLead) handleManualCall(nextLead.phone_number, nextLead.id);
        } catch (err) {
          console.error('[AutoDialer] Error fetching pending leads:', err);
        }
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isAutoDialEnabled, currentStatus, connectionState, activeCall, showDisposition, handleManualCall, leads, creditBalance]);

  const displayAgent = agent;

  return (
    <div
      className="min-h-screen bg-[#0B0F19] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950"
      onClick={() => initAudioContext()}
      onKeyDown={() => initAudioContext()}
    >
      {/* ── Top Header ── */}
      <header className="sticky top-0 z-40 bg-[#0E131F]/90 backdrop-blur-md border-b border-slate-800/80 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-bold text-sm shadow-md shadow-emerald-500/20">
            N
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>NextGenDial</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                ENTERPRISE
              </span>
            </div>
            <div className="text-[11px] text-slate-400">Agent Telephony Console</div>
          </div>
        </div>

        {/* Action Controls & Vitals */}
        <div className="flex items-center gap-3">
          {/* Tenant Credits Safeguard Pill */}
          {creditBalance !== null && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all ${
                creditBalance.credits < 0.5
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  : 'bg-slate-900/80 border-slate-700/60 text-slate-300'
              }`}
              title="Organization Prepaid Calling Credits"
            >
              <span className="text-[10px] uppercase font-sans font-semibold text-slate-400">Credit:</span>
              <span className="font-semibold text-emerald-400">
                {formatCurrency(creditBalance.credits)}
              </span>
              {creditBalance.credits < 0.05 && (
                <span className="text-[10px] bg-rose-500 text-white px-1.5 py-0.2 rounded font-sans uppercase font-bold animate-pulse">
                  Cutoff
                </span>
              )}
            </div>
          )}

          {/* Callbacks Drawer Button */}
          <button
            onClick={() => setIsCallbackDrawerOpen(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-xs text-slate-200 transition-all"
            title="Scheduled Callbacks"
          >
            <span>📅 Callbacks</span>
            {pendingCallbacksCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950 animate-pulse">
                {pendingCallbacksCount}
              </span>
            )}
          </button>

          {/* SMS Inbox Button */}
          <button
            onClick={() => {
              setSmsTargetPhone('');
              setIsSMSInboxOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-xs text-slate-200 transition-all"
            title="Two-Way SMS"
          >
            <span>💬 SMS Inbox</span>
          </button>

          {/* WebRTC Status Indicator */}
          {connectionState === 'connecting' && (
            <div className="flex items-center gap-1.5 text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <span>SIP Connecting…</span>
            </div>
          )}
          {connectionState === 'error' && (
            <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-xl">
              <span>⚠ Disconnected</span>
              <button
                onClick={retryConnection}
                className="ml-1 text-[11px] underline font-semibold hover:text-white"
              >
                Reconnect
              </button>
            </div>
          )}

          {/* Agent Pill */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-200">
              {displayAgent.username?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-slate-200">{displayAgent.username}</div>
              <div className="text-[10px] text-slate-400 font-mono">ID: {displayAgent.id.slice(0, 8)}</div>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Credit Lockout Warning Banner */}
      {creditBalance && creditBalance.credits < 0.05 && (
        <div className="bg-rose-950/70 border-b border-rose-800/80 px-6 py-2.5 flex items-center justify-between text-xs text-rose-200 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-base">🚨</span>
            <span>
              <strong>Outbound Calling Disabled:</strong> Your organization credit balance is{' '}
              <span className="font-mono font-bold text-rose-300">{formatCurrency(creditBalance.credits)}</span>.
              Please contact your administrator to refill prepaid credits.
            </span>
          </div>
          <button
            onClick={fetchCredits}
            className="text-[11px] px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800 border border-rose-700 rounded-lg"
          >
            Refresh Balance
          </button>
        </div>
      )}

      {/* Status Error Alert Banner */}
      {statusError && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-2 text-xs text-rose-300 text-center font-medium">
          ⚠️ Status update error: {statusError}
        </div>
      )}

      {/* ── Active Call Floating Panel ── */}
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

      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`fixed top-16 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl text-xs font-medium shadow-2xl flex items-center gap-2 border animate-fade-in ${
            toastType === 'warning'
              ? 'bg-amber-950/90 border-amber-800 text-amber-200'
              : toastType === 'info'
              ? 'bg-sky-950/90 border-sky-800 text-sky-200'
              : 'bg-rose-950/90 border-rose-800 text-rose-200'
          }`}
          role="alert"
        >
          <span>{toastType === 'warning' ? '⚠️' : toastType === 'info' ? 'ℹ️' : '⛔'}</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* WebRTC hidden audio tags */}
      <audio id="remote-media" autoPlay />
      <audio id="local-media" autoPlay muted />

      {/* ── Main Workspace ── */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Status, Controls, Tactile Keypad */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Status Selector Card */}
          <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-md space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Agent Status</div>
            <AgentStatusToggle status={currentStatus} changedAt={changedAt} onSetStatus={setStatus} />

            {/* Auto-Dial & Sound Toggles */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60">
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-300">Auto-Dial</div>
                  <div className="text-[10px] text-slate-500">Auto queue</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAutoDialEnabled(!isAutoDialEnabled)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                    isAutoDialEnabled
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {isAutoDialEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-300">Audio</div>
                  <div className="text-[10px] text-slate-500">DTMF tones</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                    !isAudioMutedState
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {!isAudioMutedState ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>

          {/* Tactile Keypad */}
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-md">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Manual Dialpad
            </div>
            {callerId === undefined ? (
              <div className="py-8 text-center text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block mr-2" />
                Loading telephony line...
              </div>
            ) : callerId === null ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                <strong>No phone number assigned.</strong>
                <p className="mt-1 text-slate-400">Ask your admin to allocate a line to your user account.</p>
              </div>
            ) : (
              <Keypad
                onCall={handleManualCall}
                disabled={
                  connectionState !== 'ready' ||
                  currentStatus === 'on_call' ||
                  currentStatus === 'dialing' ||
                  currentStatus === 'wrap_up'
                }
                callerIdOverride={callerId}
              />
            )}
          </div>
        </aside>

        {/* Right Content: Leads, Auto-dial session, Call History */}
        <main className="lg:col-span-8 space-y-6">
          {/* Active Auto-Dial Session Bar */}
          {isAutoDialEnabled && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-slate-900/40 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                  ⚡
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Auto-Dialer Session Active</h3>
                  <p className="text-xs text-slate-400">
                    Dialed {sessionDialed} of {sessionTotal} leads • Status:{' '}
                    <span className="text-emerald-400 font-medium capitalize">{currentStatus}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAutoDialEnabled(false)}
                className="px-3 py-1.5 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-xl transition-all"
              >
                Stop Auto-Dial
              </button>
            </div>
          )}

          {/* Pending Leads Section */}
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-md space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Assigned Leads (Pending)</h2>
                <p className="text-xs text-slate-400">Contacts ready for outbound outreach</p>
              </div>
              <button
                onClick={() => fetchLeads()}
                className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors"
              >
                Refresh Leads
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/40">
              {loadingLeads ? (
                <div className="py-8 text-center text-xs text-slate-500">Loading leads...</div>
              ) : leads.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No pending leads assigned to you right now.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 bg-slate-900/60 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Contact</th>
                      <th className="py-3 px-4">Phone Number</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {leads.map((lead) => {
                      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead Contact';
                      return (
                        <tr key={lead.id} className="hover:bg-slate-800/20 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-200">{name}</td>
                          <td className="py-3 px-4 font-mono text-slate-300">{formatE164(lead.phone_number)}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700/60">
                              {lead.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {/* 2-Way SMS trigger */}
                              <button
                                onClick={() => {
                                  setSmsTargetPhone(lead.phone_number);
                                  setIsSMSInboxOpen(true);
                                }}
                                title="Send SMS"
                                className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                              >
                                💬
                              </button>
                              {/* Dial Trigger */}
                              <button
                                onClick={() => handleManualCall(lead.phone_number, lead.id)}
                                disabled={
                                  !callerId ||
                                  connectionState !== 'ready' ||
                                  currentStatus === 'on_call' ||
                                  currentStatus === 'wrap_up'
                                }
                                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-lg shadow-sm shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-40"
                              >
                                Dial
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Call History Section */}
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-md space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Call History & Diagnostics</h2>
              <p className="text-xs text-slate-400">Accurate elapsed durations and dispositions</p>
            </div>
            <CallHistoryTable agentId={agent.id} />
          </div>
        </main>
      </div>

      {/* ── Slide-Over Callbacks Drawer ── */}
      <CallbackDrawer
        isOpen={isCallbackDrawerOpen}
        onClose={() => setIsCallbackDrawerOpen(false)}
        onDial={(phone, leadId) => handleManualCall(phone, leadId)}
      />

      {/* ── Slide-Over 2-Way SMS Inbox ── */}
      <SMSInbox
        isOpen={isSMSInboxOpen}
        onClose={() => setIsSMSInboxOpen(false)}
        targetPhoneNumber={smsTargetPhone}
        onDial={(phone) => handleManualCall(phone)}
      />

      {/* ── Disposition Modal ── */}
      {showDisposition && (
        <DispositionModal
          callLog={callContext}
          onSubmitted={handleDispositionSubmitted}
        />
      )}
    </div>
  );
}
