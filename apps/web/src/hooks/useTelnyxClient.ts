/**
 * apps/web/src/hooks/useTelnyxClient.ts
 *
 * Manages the Telnyx WebRTC client lifecycle for an agent session.
 *
 * Key behaviours:
 *  - On mount: fetches a fresh 24h WebRTC token → constructs TelnyxRTC
 *    → calls client.connect().
 *  - On incoming call with leg='agent' client_state: auto-answers
 *    immediately (no ringing UI — feels like the call "arrives" already live).
 *  - On socket drop: refetches a fresh token and reconnects.
 *  - Exposes mute, unmute, hangup, and the current active call object.
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
}

export function useTelnyxClient(agentId: string | null, agentStatus?: string): UseTelnyxClientResult {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callContext, setCallContext] = useState<CallLog | null>(null);
  const [connectionState, setConnectionState] = useState<WebRTCConnectionState>('idle');

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
        setConnectionState('ready');
      });

      client.on('telnyx.error', (err: any) => {
        console.error('[webrtc] telnyx.error:', err);
        if (err?.code === -32002 || err?.error?.includes('BYE_SEND_FAILED') || err?.message?.includes('CALL DOES NOT EXIST')) {
          return; // Ignore call already ended errors
        }
        setConnectionState('error');
      });

      client.on('telnyx.socket.close', () => {
        console.warn('[webrtc] socket closed — reconnecting...');
        setConnectionState('connecting');
        // Refetch a fresh token and reconnect after a short backoff
        setTimeout(() => {
          connectClient(id).catch(console.error);
        }, 3000);
      });

      client.on('telnyx.notification', async (notification: unknown) => {
        const n = notification as {
          type?: string;
          call?: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            answer: () => void;
            hangup: () => void;
            muteAudio: () => void;
            unmuteAudio: () => void;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            options?: { clientState?: string; [key: string]: any };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [key: string]: any;
          };
        };

        if (!n.call) return;

        // Decode client_state to identify the leg
        let state: ClientState_Partial = {};
        try {
          const rawState = n.call.options?.clientState ?? n.call['client_state'];
          if (rawState) {
            state = JSON.parse(atob(rawState)) as ClientState_Partial;
          }
        } catch {
          // If there's no client_state, it might be a manual inbound call
        }

        if (state.leg === 'agent') {
          // ── System-originated call from the dialer engine ──
          // Auto-answer immediately — no ring UI
          n.call.answer();

          const newActiveCall: ActiveCall = {
            sdkCall: n.call,
            callLogId: state.callLogId ?? null,
            leadCallControlId: state.leadId ?? null, // We'll resolve the actual ccid below
            isMuted: false,
            isHeld: false,
          };
          setActiveCall(newActiveCall);

          // Fetch context: lead name, phone, campaign script
          // We look up the call log by callLogId to get lead info
          if (state.callLogId) {
            try {
              const log = await api.calls.get(state.callLogId);
              setCallContext(log);
            } catch (err) {
              console.warn('[webrtc] Failed to fetch call context:', err);
            }
          }
        } else if (n.type === 'callUpdate' && n.call.state === 'ringing') {
          // ── Inbound call ──
          // Wait, the SDK creates a new notification for ringing. We don't auto-answer.
          
          const incomingCall = n.call;
          // Let's create an active call in 'ringing' state so UI can show it
          setActiveCall((prev) => {
            if (prev) return prev; // If already on a call, ignore or the SDK might busy it out
            
            // Log inbound call to our backend (we don't have a callLogId yet)
            api.calls.logManual({ 
              agentId: id, 
              phoneNumber: incomingCall.options?.remoteCallerName || incomingCall.options?.remoteCallerNumber || 'Unknown',
              direction: 'inbound'
            })
              .then(logRes => {
                setActiveCall({
                  sdkCall: incomingCall,
                  callLogId: logRes?.id ?? null,
                  leadCallControlId: null,
                  isMuted: false,
                  isHeld: false,
                });
                
                // Set call context to show the caller info
                setCallContext(logRes ?? null);
              })
              .catch(console.error);
              
            return null; // temporary until log is created
          });
        }
        // Manual outbound calls (initiated from the dialpad) are handled
        // by newCall() below — they don't have an agent leg client_state.
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
    try {
      activeCall?.sdkCall?.hangup?.();
    } catch (e) {
      console.warn('[webrtc] hangup error ignored:', e);
    }
    setActiveCall(null);
    setCallContext(null);
  }, [activeCall]);

  const answer = useCallback(() => {
    activeCall?.sdkCall?.answer?.();
  }, [activeCall]);

  const reject = useCallback(() => {
    activeCall?.sdkCall?.reject?.();
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
      const e164Dest = formatE164(destinationNumber);
      const e164Caller = formatE164(callerNumber);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (clientRef.current as any).newCall({
        destinationNumber: e164Dest,
        callerNumber: e164Caller,
      });
      setActiveCall({
        sdkCall: call,
        callLogId,
        leadCallControlId,
        isMuted: false,
        isHeld: false,
      });
    },
    [],
  );

  // ── Clear active call when SDK call ends + Timeout fallback ──

  useEffect(() => {
    if (!activeCall?.sdkCall) return;

    const sdkCall = activeCall.sdkCall;
    let answered = false;
    let connectionTimeout: any = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleEnd = () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      setActiveCall(null);
      // Don't clear callContext here — ActiveCallBar keeps it until
      // the agent's status flips out of wrap_up via polling
    };

    // 10s timeout fallback if stuck in new/connecting/ringing
    if (['new', 'connecting', 'ringing'].includes(sdkCall.state)) {
      connectionTimeout = setTimeout(() => {
        if (['new', 'connecting', 'ringing'].includes(sdkCall.state)) {
          console.error('[webrtc] Call connection timed out (10s) without connecting to media.');
          
          if (activeCall.callLogId) {
            api.calls.update(activeCall.callLogId, { status: 'failed', end_time: new Date().toISOString() }).catch(console.error);
          }
          if (activeCall.leadCallControlId) {
            // Reset lead status to pending so it can be retried later
            api.leads.updateStatus(activeCall.leadCallControlId, 'pending').catch(console.error);
          }
          
          try { sdkCall.hangup?.(); } catch (e) {}
          handleEnd();
          
          // Force a reconnect if the socket might be dead
          retryConnection();
        }
      }, 10000);
    }

    sdkCall.on?.('telnyx.notification', (n: { type?: string }) => {
      if (n?.type === 'callUpdate') {
        const state = sdkCall.state;
        
        // If state moved to active, clear the timeout
        if (state === 'active' || state === 'answered') {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
        }
        
        if (!answered && (state === 'active' || state === 'answered')) {
          answered = true;
          if (activeCall.callLogId) {
            api.calls.update(activeCall.callLogId, { status: 'answered' }).catch(console.error);
          }
        }
        
        if (state === 'done') {
          if (activeCall.callLogId) {
            const finalStatus = answered ? 'completed' : 'no-answer';
            api.calls.update(activeCall.callLogId, { status: finalStatus, end_time: new Date().toISOString() }).catch(console.error);
          }
          if (activeCall.leadCallControlId) {
            api.leads.updateStatus(activeCall.leadCallControlId, answered ? 'completed' : 'failed').catch(console.error);
          }
          handleEnd();
        }
      }
    });

    return () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      sdkCall.off?.('telnyx.notification', handleEnd);
    };
  }, [activeCall?.sdkCall, activeCall?.callLogId, activeCall?.leadCallControlId, retryConnection]);

  return { activeCall, callContext, connectionState, mute, unmute, toggleHold, sendDTMF, hangup, answer, reject, newCall, retryConnection };
}
