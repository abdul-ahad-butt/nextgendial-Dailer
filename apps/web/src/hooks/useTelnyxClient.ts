/**
 * apps/web/src/hooks/useTelnyxClient.ts
 *
 * Manages the Telnyx WebRTC client lifecycle for an agent session.
 *
 * Key behaviours:
 *  - On mount: fetches a fresh 24h WebRTC token → constructs TelnyxRTC
 *    → calls client.connect().
 *  - All call state tracking happens in the client-level telnyx.notification
 *    handler (not on individual sdkCall objects — the SDK v1.x does NOT emit
 *    events on call objects; only the client emits them).
 *  - Inbound calls: immediately surfaces the ringing UI, then async-updates
 *    the callLogId once the backend log is created.
 *  - On socket drop: refetches a fresh token and reconnects.
 *  - Exposes mute, unmute, hangup, answer, reject, and the current active call.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import type { ActiveCall, CallLog, ClientState } from '../types';
import { api } from '../lib/api';

function formatE164(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`; // Fallback for international
}

type ClientState_Partial = Partial<ClientState>;

export type WebRTCConnectionState = 'idle' | 'connecting' | 'ready' | 'error';

interface UseTelnyxClientResult {
  activeCall: ActiveCall | null;
  callContext: CallLog | null;
  connectionState: WebRTCConnectionState;
  mute: () => void;
  unmute: () => void;
  hangup: () => void;
  answer: () => void;
  reject: () => void;
  toggleHold: () => void;
  sendDTMF: (digit: string) => void;
  newCall: (destinationNumber: string, callerNumber?: string, callLogId?: string | null, leadCallControlId?: string | null) => void;
  retryConnection: () => void;
  lastFailedCall: { cause: string; timestamp: number } | null;
}

export function useTelnyxClient(agentId: string | null, agentStatus?: string): UseTelnyxClientResult {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callContext, setCallContext] = useState<CallLog | null>(null);
  const [connectionState, setConnectionState] = useState<WebRTCConnectionState>('idle');
  const [lastFailedCall, setLastFailedCall] = useState<{ cause: string; timestamp: number } | null>(null);

  // Refs to track call state for use inside stable callbacks without re-render
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;
  const answeredRef = useRef(false);

  // ── Token fetch + client construction ─────────────────────

  const connectClient = useCallback(async (id: string) => {
    setConnectionState('connecting');
    try {
      const res = await api.agents.webrtcToken(id);

      if (res.error === 'MISSING_TELNYX_CREDENTIALS') {
        console.error('[webrtc] connectClient error: Missing TELNYX_CONNECTION_ID in Cloudflare Worker secrets. Run: npx wrangler secret put TELNYX_CONNECTION_ID');
        setConnectionState('error');
        return;
      }

      if (res.error === 'INVALID_TELNYX_API_KEY') {
        console.error('[webrtc] connectClient error: The API key looks malformed. Check that you copied it correctly.');
        setConnectionState('error');
        return;
      }

      if (res.error) {
        console.error('[webrtc] connectClient error:', res.error);
        setConnectionState('error');
        return;
      }

      const token = res.token;
      if (!token) throw new Error('No WebRTC token returned');

      // Destroy any previous client cleanly before creating a new one
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = new TelnyxRTC({
        login_token: token,
        // STUN servers let ICE gather server-reflexive candidates so calls
        // can traverse NAT. Without this, only host (local) candidates are
        // gathered and the call stalls at CONNECTING on any non-LAN network
        // (Warning 33005: "Only local network candidates available").
        iceServers: [
          { urls: 'stun:stun.telnyx.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      } as any);
      clientRef.current = client;

      client.on('telnyx.ready', () => {
        console.log('[webrtc] Client ready — WebRTC connected.');
        setConnectionState('ready');
      });

      client.on('telnyx.error', (err: any) => {
        console.error('[webrtc] telnyx.error:', err);
        const errStr = typeof err?.error === 'string' ? err.error : '';
        const msgStr = typeof err?.message === 'string' ? err.message : '';
        
        if (err?.code === -32002 || errStr.includes('BYE_SEND_FAILED') || msgStr.includes('CALL DOES NOT EXIST')) {
          return; // Ignore call already ended errors
        }
        setConnectionState('error');
      });

      client.on('telnyx.socket.close', () => {
        console.warn('[webrtc] Socket closed — reconnecting in 3s...');
        setConnectionState('connecting');
        // Refetch a fresh token and reconnect after a short backoff
        setTimeout(() => {
          connectClient(id).catch(console.error);
        }, 3000);
      });

      // ─────────────────────────────────────────────────────────────
      // CLIENT-LEVEL notification handler
      //
      // CRITICAL: The Telnyx WebRTC SDK v1.x emits ALL call-state
      // events (callUpdate, callNew, callDestroyed, etc.) on the
      // CLIENT object, not on individual call objects. Listening on
      // sdkCall.on('telnyx.notification', ...) will never fire.
      // All call state tracking MUST happen here.
      // ─────────────────────────────────────────────────────────────
      client.on('telnyx.notification', async (notification: unknown) => {
        const n = notification as {
          type?: string;
          call?: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            answer: () => void;
            hangup: () => void;
            reject: () => void;
            muteAudio: () => void;
            unmuteAudio: () => void;
            hold?: () => void;
            unhold?: () => void;
            dtmf?: (digit: string) => void;
            state?: string;
            cause?: string;
            id?: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            options?: { clientState?: string; remoteCallerName?: string; remoteCallerNumber?: string; [key: string]: any };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [key: string]: any;
          };
        };

        if (!n.call) return;

        const callState = n.call.state;
        const callType = n.type;
        const callCause = n.call.cause || 'none';
        console.log(`[webrtc] telnyx.notification — type: ${callType}, state: ${callState}, cause: ${callCause}`);

        // Decode client_state to identify the leg (system-originated calls only)
        let state: ClientState_Partial = {};
        try {
          const rawState = n.call.options?.clientState ?? n.call['client_state'];
          if (rawState) {
            state = JSON.parse(atob(rawState)) as ClientState_Partial;
          }
        } catch {
          // Manual inbound call — no client_state is expected
        }

        // ── Handle call state transitions for the ACTIVE call ──
        const currentActive = activeCallRef.current;

        if (callState === 'ringing' || callType === 'callUpdate' && callState === 'ringing') {
          // Inbound call arriving — show ringing UI immediately
          if (state.leg === 'agent') {
            // System-originated agent leg — auto-answer
            console.log('[webrtc] System agent-leg call ringing — auto-answering...');
            n.call.answer();

            const newActiveCall: ActiveCall = {
              sdkCall: n.call,
              destinationNumber: null,
              callLogId: state.callLogId ?? null,
              leadCallControlId: state.leadId ?? null,
              isMuted: false,
              isHeld: false,
            };
            setActiveCall(newActiveCall);
            answeredRef.current = false;

            if (state.callLogId) {
              try {
                const log = await api.calls.get(state.callLogId);
                setCallContext(log);
              } catch (err) {
                console.warn('[webrtc] Failed to fetch call context:', err);
              }
            }
          } else if (currentActive) {
            // Another call is already active — reject the new inbound call
            console.warn(`[webrtc] Rejecting incoming call ${n.call.id} because another call is active.`);
            if (typeof n.call.reject === 'function') {
              n.call.reject();
            } else if (typeof n.call.hangup === 'function') {
              n.call.hangup();
            }
            return;
          } else {
            // Manual inbound call — surface ringing UI immediately
            console.log('[webrtc] Inbound call ringing — surfacing UI...');
            const callerNumber = n.call.options?.remoteCallerNumber || n.call.options?.remoteCallerName || 'Unknown';

            // Set the active call NOW so the ringing UI appears immediately
            const provisionalCall: ActiveCall = {
              sdkCall: n.call,
              destinationNumber: callerNumber,
              callLogId: null, // Will be updated once log is created
              leadCallControlId: null,
              isMuted: false,
              isHeld: false,
            };
            setActiveCall(provisionalCall);
            answeredRef.current = false;

            // Create backend log async — update callLogId when done
            api.calls.logManual({
              agentId: id,
              phoneNumber: callerNumber,
              direction: 'inbound'
            })
              .then(logRes => {
                if (logRes?.id) {
                  setActiveCall(prev => prev ? { ...prev, callLogId: logRes.id } : null);
                  setCallContext(logRes ?? null);
                }
              })
              .catch(err => console.error('[webrtc] Failed to log inbound call:', err));
          }
          return;
        }

        // For all other state changes, we need to match the notification to our activeCall
        if (!currentActive) return;

        // Ensure this notification belongs to the currently active call
        if (n.call.id && currentActive.sdkCall.id && n.call.id !== currentActive.sdkCall.id) {
          console.warn(`[webrtc] Ignoring event (${callType}: ${callState}) for background/old call (id: ${n.call.id}). Active call is ${currentActive.sdkCall.id}`);
          return;
        }

        if (callState === 'active' || callState === 'answered' || callType === 'callUpdate' && (callState === 'active' || callState === 'answered')) {
          console.log('[webrtc] Call ACTIVE — audio should be flowing.');
          if (!answeredRef.current) {
            answeredRef.current = true;
            if (currentActive.callLogId) {
              api.calls.update(currentActive.callLogId, { status: 'answered' }).catch(console.error);
            }
          }
          return;
        }

        if (callState === 'done' || callState === 'destroy' || callState === 'hangup') {
          console.log(`[webrtc] Call ended. State: ${callState}, Cause: ${callCause}, WasAnswered: ${answeredRef.current}`);
          if (currentActive.callLogId) {
            const finalStatus = answeredRef.current ? 'completed' : 'failed';
            api.calls.update(currentActive.callLogId, {
              status: finalStatus,
              end_time: new Date().toISOString(),
              hangup_cause: callCause !== 'none' ? callCause : undefined
            }).catch(console.error);
          }
          if (currentActive.leadCallControlId) {
            api.leads.updateStatus(
              currentActive.leadCallControlId,
              answeredRef.current ? 'completed' : 'failed'
            ).catch(console.error);
          }
          
          if (!answeredRef.current) {
            setLastFailedCall({ cause: callCause, timestamp: Date.now() });
          }

          answeredRef.current = false;
          setActiveCall(null);
          // Don't clear callContext here — ActiveCallBar keeps it until
          // the agent's status flips out of wrap_up via polling
          return;
        }

        if (callState === 'new' || callState === 'requesting' || callState === 'connecting') {
          // Outbound call just initiated — update activeCall with the real sdkCall object
          // The sdkCall from newCall() might be a different object reference
          console.log(`[webrtc] Outbound call state: ${callState} — waiting for far-end answer...`);
          return;
        }

        if (callType === 'telnyx.error' || (n as any)?.type === 'error') {
          const errMsg = (n as any)?.error?.message || (n as any)?.message || 'Unknown SDK error';
          console.error(`[webrtc] Call error notification: ${errMsg}`, n);
        }
      });

      client.connect();
    } catch (err) {
      console.error('[webrtc] connectClient error:', err);
      setConnectionState('error');
    }
  }, []);

  const retryConnection = useCallback(() => {
    if (agentId) {
      connectClient(agentId);
    }
  }, [agentId, connectClient]);

  // ── Mount / agentId change ─────────────────────────────────

  useEffect(() => {
    if (!agentId || !agentStatus) return;

    if (agentStatus === 'offline' || agentStatus === 'break') {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
        setConnectionState('idle');
      }
    } else {
      if (!clientRef.current) {
        connectClient(agentId);
      }
    }

    return () => {
      // We don't cleanup on unmount unless agentId actually changes/unmounts
      // The dependency array handles the status logic
    };
  }, [agentId, agentStatus, connectClient]);

  // ── Controls ───────────────────────────────────────────────

  const mute = useCallback(() => {
    activeCall?.sdkCall?.muteAudio?.();
    setActiveCall((prev) => prev ? { ...prev, isMuted: true } : null);
  }, [activeCall]);

  const unmute = useCallback(() => {
    activeCall?.sdkCall?.unmuteAudio?.();
    setActiveCall((prev) => prev ? { ...prev, isMuted: false } : null);
  }, [activeCall]);

  const hangup = useCallback(() => {
    console.log('[webrtc] hangup() called by user.');
    try {
      activeCall?.sdkCall?.hangup?.();
    } catch (e) {
      console.warn('[webrtc] hangup error ignored (call may already be gone):', e);
    }
    answeredRef.current = false;
    setActiveCall(null);
    setCallContext(null);
  }, [activeCall]);

  const answer = useCallback(() => {
    console.log('[webrtc] answer() called — answering inbound call.');
    activeCall?.sdkCall?.answer?.();
  }, [activeCall]);

  const reject = useCallback(() => {
    console.log('[webrtc] reject() called — rejecting inbound call.');
    activeCall?.sdkCall?.reject?.();
    answeredRef.current = false;
    setActiveCall(null);
    setCallContext(null);
  }, [activeCall]);

  const toggleHold = useCallback(() => {
    if (!activeCall?.sdkCall) return;
    if (activeCall.isHeld) {
      activeCall.sdkCall.unhold?.();
      setActiveCall((prev) => (prev ? { ...prev, isHeld: false } : null));
    } else {
      activeCall.sdkCall.hold?.();
      setActiveCall((prev) => (prev ? { ...prev, isHeld: true } : null));
    }
  }, [activeCall]);

  const sendDTMF = useCallback((digit: string) => {
    if (!activeCall?.sdkCall) return;
    activeCall.sdkCall.dtmf?.(digit);
  }, [activeCall]);

  /**
   * Initiate a manual outbound call from the dialpad.
   * This does NOT go through the dialer engine — it's a direct WebRTC call.
   */
  const newCall = useCallback(
    (destinationNumber: string, callerNumber = '', callLogId: string | null = null, leadCallControlId: string | null = null) => {
      if (!clientRef.current) {
        console.warn('[webrtc] newCall: client not ready');
        return;
      }
      if (activeCallRef.current) {
        console.warn('[webrtc] newCall blocked: active call exists locally.');
        alert('Cannot start a new call: another call is currently active. Please hang up the current call first.');
        return;
      }

      const e164Dest = formatE164(destinationNumber);
      const e164Caller = formatE164(callerNumber);

      console.log(`[webrtc] newCall → dest: ${e164Dest}, caller: ${e164Caller}, callLogId: ${callLogId}`);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const call = (clientRef.current as any).newCall({
          destinationNumber: e164Dest,
          callerNumber: e164Caller,
          callerName: 'NextGenDial Agent',
          remoteElement: 'remote-media',
          localElement: 'local-media',
        });

        answeredRef.current = false;
        setActiveCall({
          sdkCall: call,
          destinationNumber: e164Dest,
          callLogId,
          leadCallControlId,
          isMuted: false,
          isHeld: false,
        });

        console.log(`[webrtc] Outbound call initiated to ${e164Dest}. Waiting for telnyx.notification events on client...`);
      } catch (err: any) {
        console.error('[webrtc] newCall failed to initiate:', err);
        alert(`Cannot start a new call: ${err.message || 'SDK error'}.`);

        // Auto-heal logic if SDK is stuck in MULTIPLE_ACTIVE_CALLS_DETECTED
        if (err.message && err.message.includes('MULTIPLE_ACTIVE_CALLS_DETECTED')) {
          console.warn('[webrtc] MULTIPLE_ACTIVE_CALLS_DETECTED — forcing SDK reconnect to clear stale state.');
          setConnectionState('connecting');
          clientRef.current?.disconnect();
          // The 'telnyx.socket.close' event will fire and automatically reconnect
        }
      }
    },
    [],  // No dependency on activeCall — uses activeCallRef instead to avoid stale closure
  );

  // ── Stale call safety net ──────────────────────────────────
  //
  // If the call is stuck in new/connecting for more than 15 seconds
  // (i.e. the client never received a state-change notification) we
  // time out and clean up.  We specifically do NOT time out 'ringing'
  // because that is a valid pre-answer state that can last as long as
  // the remote phone rings.
  useEffect(() => {
    if (!activeCall?.sdkCall) return;

    const sdkCall = activeCall.sdkCall;
    const initialState = sdkCall.state;

    if (!['new', 'requesting', 'connecting'].includes(initialState)) return;

    console.log(`[webrtc] Starting 15s connection timeout for call in state: ${initialState}`);

    const connectionTimeout = setTimeout(() => {
      const currentState = activeCallRef.current?.sdkCall?.state ?? 'gone';
      if (['new', 'requesting', 'connecting'].includes(currentState)) {
        console.error(
          `[webrtc] Call connection timed out (15s) — still in state '${currentState}'. ` +
          `Check ICE/STUN config and that the Telnyx TELNYX_CONNECTION_ID is set correctly.`
        );

        if (activeCallRef.current?.callLogId) {
          api.calls.update(activeCallRef.current.callLogId, {
            status: 'failed',
            end_time: new Date().toISOString()
          }).catch(console.error);
        }
        if (activeCallRef.current?.leadCallControlId) {
          api.leads.updateStatus(activeCallRef.current.leadCallControlId, 'pending').catch(console.error);
        }

        try { sdkCall.hangup?.(); } catch (e) {}
        answeredRef.current = false;
        setActiveCall(null);

        // Force a reconnect if the socket might be dead
        retryConnection();
      }
    }, 15000);

    return () => clearTimeout(connectionTimeout);
  }, [activeCall?.sdkCall, retryConnection]);

  return { activeCall, callContext, connectionState, mute, unmute, toggleHold, sendDTMF, hangup, answer, reject, newCall, retryConnection, lastFailedCall };
}
