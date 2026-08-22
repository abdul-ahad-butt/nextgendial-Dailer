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
  newCall: (destinationNumber: string, callerNumber?: string) => void;
}

export function useTelnyxClient(agentId: string | null): UseTelnyxClientResult {
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

  // ── Mount / agentId change ─────────────────────────────────

  useEffect(() => {
    if (!agentId) return;
    connectClient(agentId);

    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [agentId, connectClient]);

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

  /**
   * Initiate a manual outbound call from the dialpad.
   * This does NOT go through the dialer engine — it's a direct WebRTC call.
   */
  const newCall = useCallback(
    (destinationNumber: string, callerNumber = '') => {
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
        callLogId: null,
        leadCallControlId: null,
        isMuted: false,
      });
    },
    [],
  );

  // ── Clear active call when SDK call ends ───────────────────

  useEffect(() => {
    if (!activeCall?.sdkCall) return;

    const sdkCall = activeCall.sdkCall;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleEnd = () => {
      setActiveCall(null);
      // Don't clear callContext here — ActiveCallBar keeps it until
      // the agent's status flips out of wrap_up via polling
    };

    sdkCall.on?.('telnyx.notification', (n: { type?: string }) => {
      if (n?.type === 'callUpdate' && sdkCall.state === 'done') {
        handleEnd();
      }
    });

    return () => {
      sdkCall.off?.('telnyx.notification', handleEnd);
    };
  }, [activeCall?.sdkCall]);

  return { activeCall, callContext, connectionState, mute, unmute, hangup, newCall };
}
