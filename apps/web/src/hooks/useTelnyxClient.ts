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
      const token = await api.agents.webrtcToken(id);

      // Destroy any previous client cleanly before creating a new one
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = new TelnyxRTC({ login_token: token } as any);
      clientRef.current = client;

      client.on('telnyx.ready', () => {
        setConnectionState('ready');
      });

      client.on('telnyx.error', (err: unknown) => {
        console.error('[webrtc] telnyx.error:', err);
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
    activeCall?.sdkCall?.hangup?.();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (clientRef.current as any).newCall({
        destinationNumber,
        callerNumber,
      });
      setActiveCall({
        sdkCall: call,
        callLogId,
        leadCallControlId,
        isMuted: false,
      });
    },
    [],
  );

  // ── Clear active call when SDK call ends ───────────────────

  useEffect(() => {
    if (!activeCall?.sdkCall) return;

    const sdkCall = activeCall.sdkCall;
    let answered = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleEnd = () => {
      setActiveCall(null);
      // Don't clear callContext here — ActiveCallBar keeps it until
      // the agent's status flips out of wrap_up via polling
    };

    sdkCall.on?.('telnyx.notification', (n: { type?: string }) => {
      if (n?.type === 'callUpdate') {
        const state = sdkCall.state;
        
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
      sdkCall.off?.('telnyx.notification', handleEnd);
    };
  }, [activeCall?.sdkCall, activeCall?.callLogId, activeCall?.leadCallControlId]);

  return { activeCall, callContext, connectionState, mute, unmute, hangup, answer, reject, newCall, retryConnection };
}
