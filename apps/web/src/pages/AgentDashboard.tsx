/**
 * apps/web/src/pages/AgentDashboard.tsx
 *
 * Modernized Agent Telephony Workspace with:
 *  - 3D Telephony Audio Orb / Particle Wave Visualizer
 *  - Responsive 12-column Grid with Glassmorphic Panels
 *  - Tactile Keypad with DTMF and Audio Waveforms
 *  - Real-time Prepaid Tenant Credit Safeguard
 *  - Scheduled Callbacks & Two-Way SMS Drawers
 *  - Glassmorphic Call History & Diagnostics Table
 */

import { useCallback, useEffect, useState } from 'react';
import { PhoneCall, MessageSquare, RefreshCw, LogOut, Zap, ShieldAlert } from 'lucide-react';
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
import { TelephonyVisualizer3D } from '../components/3d/TelephonyVisualizer3D';
import { ZeroCreditBanner } from '../components/common/ZeroCreditBanner';
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
    } catch {
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
      setToastType('error');
      setToastMessage(`Call failed: ${friendly || 'Connection lost'}`);
      const t = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(t);
    }
  }, [lastFailedCall, dialingLeadId]);

  // Update lead status when activeCall changes
  useEffect(() => {
    if (activeCall && dialingLeadId) {
      api.leads.updateStatus(dialingLeadId, 'calling').catch(console.error);
    }
  }, [activeCall, dialingLeadId]);

  const currentScript = campaigns[0]?.script ?? null;

  const handleManualCall = useCallback(
    async (number: string, leadId?: string) => {
      initAudioContext().catch(() => {});

      if (creditBalance && (creditBalance.credits <= 0 || creditBalance.credits < 0.05)) {
        setToastType('error');
        setToastMessage('Outbound call blocked: Out of calling credits ($0.00). Please contact your administrator.');
        setTimeout(() => setToastMessage(null), 6000);
        alert('Insufficient credits. Please contact your admin to assign credits.');
        return;
      }

      if (!number) return;
      const normalized = formatE164(number);

      if (leadId) {
        setDialingLeadId(leadId);
        setSessionDialed((d) => d + 1);
      } else {
        setDialingLeadId(null);
      }

      try {
        await newCall(normalized, callerId || undefined);
      } catch (err: any) {
        console.error('Call failed to start:', err);
        setToastType('error');
        setToastMessage(err.message || 'Call failed to initiate');
        setTimeout(() => setToastMessage(null), 5000);
      }
    },
    [newCall, callerId, creditBalance],
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
  const isOutOfCredit = (creditBalance?.credits ?? 0) <= 0 || (creditBalance !== null && creditBalance.credits < 0.05);

  const visualizerStatus = activeCall
    ? 'active'
    : currentStatus === 'dialing' || currentStatus === 'on_call'
    ? 'active'
    : (currentStatus as any);

  return (
    <div
      className="min-h-screen bg-[#070A12] text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-300"
      onClick={() => initAudioContext()}
      onKeyDown={() => initAudioContext()}
    >
      {/* ── Top Header Navigation ── */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80 px-6 py-3.5 flex items-center justify-between shadow-lg">
        {/* Logo & Brand Identity */}
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 font-black text-slate-950 text-base flex-shrink-0">
            N
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide text-white">NextGenDial</span>
              <span className="text-[10px] font-semibold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 font-mono tracking-wider">
                ENTERPRISE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Agent Telephony Console</p>
          </div>
        </div>

        {/* Global Controls & Status */}
        <div className="flex items-center gap-3">
          {/* Agent Credits Safeguard Pill */}
          {creditBalance !== null && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all shadow-sm ${
                isOutOfCredit
                  ? 'bg-amber-950/60 border-amber-800/80 text-amber-300 ring-1 ring-amber-500/30'
                  : creditBalance.credits < 0.5
                  ? 'bg-rose-950/50 border-rose-800/60 text-rose-300'
                  : 'bg-slate-900/80 border-slate-700/60 text-slate-300'
              }`}
              title="Agent Calling Credits"
            >
              <span className="text-[10px] uppercase font-sans font-semibold text-slate-400">Credit:</span>
              <span className={`font-bold ${isOutOfCredit ? 'text-amber-400' : 'text-emerald-400'}`}>
                {formatCurrency(creditBalance.credits)}
              </span>
              {isOutOfCredit && (
                <span className="text-[10px] bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded font-sans uppercase font-bold animate-pulse">
                  Locked
                </span>
              )}
            </div>
          )}

          {/* Callbacks Drawer Button */}
          <button
            type="button"
            onClick={() => setIsCallbackDrawerOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-xs font-medium text-slate-200 transition-all shadow-sm active:scale-95"
            title="Scheduled Callbacks"
          >
            <PhoneCall className="w-3.5 h-3.5 text-amber-400" />
            <span>Callbacks</span>
            {pendingCallbacksCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950 animate-pulse ml-0.5">
                {pendingCallbacksCount}
              </span>
            )}
          </button>

          {/* SMS Inbox Button */}
          <button
            type="button"
            onClick={() => {
              setSmsTargetPhone('');
              setIsSMSInboxOpen(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-xs font-medium text-slate-200 transition-all shadow-sm active:scale-95"
            title="Two-Way SMS"
          >
            <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
            <span>SMS Inbox</span>
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
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Disconnected</span>
              <button
                type="button"
                onClick={retryConnection}
                className="ml-1 text-[11px] underline font-semibold hover:text-white"
              >
                Reconnect
              </button>
            </div>
          )}

          <div className="h-5 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

          {/* Agent Pill */}
          <div className="flex items-center gap-2 pl-2">
            <div className="w-8 h-8 rounded-xl bg-slate-800/80 border border-slate-700/70 flex items-center justify-center text-xs font-bold text-slate-200 shadow-sm">
              {displayAgent.username?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-slate-200">{displayAgent.username}</div>
              <div className="text-[10px] text-slate-400 font-mono">ID: {displayAgent.id.slice(0, 8)}</div>
            </div>
          </div>

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={onLogout}
            className="p-2 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-slate-800/50 transition-colors ml-1"
            title="Sign Out"
            aria-label="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Agent Zero-Credit Lockout Warning Banner */}
      {isOutOfCredit && (
        <ZeroCreditBanner
          type="agent"
          balance={creditBalance?.credits ?? 0}
          onRefresh={fetchCredits}
          className="mx-6 mt-3"
        />
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
          className={`fixed top-16 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl text-xs font-medium shadow-2xl flex items-center gap-2 border ${
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

      {/* ── Main 12-Column Responsive Body ── */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Controls & Dialpad (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Status & 3D Visualizer Card */}
          <div className="glass-panel rounded-3xl p-5 border border-slate-800/80 flex items-center justify-between shadow-2xl">
            <div className="flex-1 pr-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Agent Status
              </span>
              <AgentStatusToggle status={currentStatus} changedAt={changedAt} onSetStatus={setStatus} />

              {/* Auto-Dial & Sound Toggles */}
              <div className="grid grid-cols-2 gap-2 pt-3 mt-3 border-t border-slate-800/60">
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-slate-300">Auto-Dial</div>
                    <div className="text-[10px] text-slate-500">Auto queue</div>
                  </div>
                  <button
                    type="button"
                    disabled={isOutOfCredit}
                    onClick={() => {
                      if (isOutOfCredit) {
                        alert('Insufficient credits. Please contact your admin to assign credits.');
                        return;
                      }
                      setIsAutoDialEnabled(!isAutoDialEnabled);
                    }}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                      isOutOfCredit
                        ? 'bg-slate-800/60 text-slate-600 cursor-not-allowed opacity-40'
                        : isAutoDialEnabled
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isAutoDialEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
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

            {/* Interactive 3D Audio Visualizer Orb */}
            <div className="flex-shrink-0">
              <TelephonyVisualizer3D status={visualizerStatus} />
            </div>
          </div>

          {/* Keypad Component */}
          {callerId === undefined ? (
            <div className="w-full max-w-[340px] mx-auto glass-panel rounded-3xl p-8 border border-slate-800/80 text-center text-xs text-slate-500 shadow-2xl">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block mr-2" />
              Loading telephony line...
            </div>
          ) : callerId === null ? (
            <div className="w-full max-w-[340px] mx-auto glass-panel rounded-3xl p-6 border border-rose-900/50 bg-rose-950/20 text-rose-300 text-xs shadow-2xl">
              <strong className="block text-sm mb-1 text-white">No Telephony Line Assigned</strong>
              <p className="text-slate-400">
                Contact your administrator to allocate a Telnyx DID phone number to your agent profile.
              </p>
            </div>
          ) : (
            <Keypad
              onCall={(num: string) => {
                if (isOutOfCredit) {
                  alert('Insufficient credits. Please contact your admin to assign credits.');
                  return;
                }
                handleManualCall(num);
              }}
              disabled={
                isOutOfCredit ||
                connectionState !== 'ready' ||
                currentStatus === 'on_call' ||
                currentStatus === 'dialing' ||
                currentStatus === 'wrap_up'
              }
              isActiveCall={Boolean(activeCall || currentStatus === 'on_call')}
              callerIdOverride={callerId}
            />
          )}
        </div>

        {/* Right Column: Leads & Call History (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Active Auto-Dial Session Bar */}
          {isAutoDialEnabled && (
            <div className="p-4 rounded-3xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-slate-900/40 border border-emerald-500/30 flex items-center justify-between shadow-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                  <Zap className="w-5 h-5 fill-current" />
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
                type="button"
                onClick={() => setIsAutoDialEnabled(false)}
                className="px-3 py-1.5 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-xl transition-all"
              >
                Stop Auto-Dial
              </button>
            </div>
          )}

          {/* Assigned Leads Card */}
          <div className="glass-panel rounded-3xl p-6 border border-slate-800/80 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Assigned Leads (Pending)</h2>
                <p className="text-xs text-slate-400">Contacts queued for auto or manual outreach</p>
              </div>
              <button
                type="button"
                onClick={() => fetchLeads()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-xs font-medium text-slate-200 transition-all shadow-sm active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingLeads ? 'animate-spin' : ''}`} />
                <span>Refresh Leads</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800/60 bg-slate-950/40">
              {loadingLeads ? (
                <div className="h-32 flex items-center justify-center text-xs text-slate-500 gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>Loading assigned leads...</span>
                </div>
              ) : leads.length === 0 ? (
                <div className="h-32 rounded-2xl border border-dashed border-slate-800/80 flex items-center justify-center bg-slate-950/30">
                  <span className="text-xs text-slate-500">No pending leads assigned. Upload leads to start.</span>
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
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700/60">
                              {lead.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {/* 2-Way SMS trigger */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSmsTargetPhone(lead.phone_number);
                                  setIsSMSInboxOpen(true);
                                }}
                                title="Send SMS"
                                className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800/60 rounded-lg transition-colors"
                              >
                                <MessageSquare className="w-4 h-4" />
                              </button>
                              {/* Dial Trigger */}
                              <button
                                type="button"
                                onClick={() => handleManualCall(lead.phone_number, lead.id)}
                                disabled={
                                  !callerId ||
                                  connectionState !== 'ready' ||
                                  currentStatus === 'on_call' ||
                                  currentStatus === 'wrap_up'
                                }
                                className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold rounded-lg shadow-sm shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-40"
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

          {/* Call History Table */}
          <CallHistoryTable agentId={agent.id} />
        </div>
      </main>

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
