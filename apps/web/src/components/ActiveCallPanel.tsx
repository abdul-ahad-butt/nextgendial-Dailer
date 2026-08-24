import { useEffect, useRef, useState } from 'react';
import type { Agent, ActiveCall, CallLog } from '../types';

interface Props {
  agent: Agent;
  activeCall: ActiveCall | null;
  callContext: CallLog | null;
  script: string | null;
  onMute: () => void;
  onUnmute: () => void;
  onToggleHold: () => void;
  onSendDTMF: (digit: string) => void;
  onHangup: () => void;
  onAnswer: () => void;
  onReject: () => void;
}

export function ActiveCallPanel({
  agent,
  activeCall,
  callContext,
  script,
  onMute,
  onUnmute,
  onToggleHold,
  onSendDTMF,
  onHangup,
  onAnswer,
  onReject,
}: Props) {
  const isWrapUp = agent.status === 'wrap_up' && !activeCall;
  const isOnCall = !!activeCall;
  const sdkState = activeCall?.sdkCall?.state || '';
  const isRinging = sdkState === 'ringing' && callContext?.direction === 'inbound';
  const isConnecting = sdkState === 'new' || sdkState === 'connecting' || (sdkState === 'ringing' && callContext?.direction !== 'inbound');
  const isActive = sdkState === 'active' || sdkState === 'answered';

  const [showKeypad, setShowKeypad] = useState(false);
  const [showScript, setShowScript] = useState(false);

  if (!isOnCall && !isWrapUp) return null;

  const remoteNumber = activeCall?.sdkCall?.options?.remoteCallerNumber 
    || activeCall?.sdkCall?.options?.remoteCallerName 
    || 'Unknown';

  const dtmfDigits = ['1','2','3','4','5','6','7','8','9','*','0','#'];

  return (
    <div className={`active-call-panel ${isWrapUp ? 'wrap-up' : ''} ${isRinging ? 'ringing' : ''}`}>
      
      {/* ── Header Status ── */}
      <div className="panel-header">
        <div className="status-indicator">
          {isActive && <div className="pulsing-badge active">Live Call</div>}
          {isConnecting && <div className="pulsing-badge connecting">Connecting...</div>}
          {isRinging && <div className="pulsing-badge ringing">Incoming Call...</div>}
          {isWrapUp && <div className="pulsing-badge wrap-up">Wrapping Up</div>}
        </div>
        <CallTimer started={callContext?.started_at ?? null} isWrapUp={isWrapUp} />
      </div>

      {/* ── Lead Profile ── */}
      <div className="panel-profile">
        <div className="avatar">
          {remoteNumber?.replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase() || '?'}
        </div>
        <div className="profile-details">
          <div className="lead-name">
            {callContext?.lead_id ? `Lead ID: ${callContext.lead_id.slice(0,8)}` : (isRinging ? 'Unknown Caller' : 'Outbound Target')}
          </div>
          <div className="lead-phone">{remoteNumber}</div>
        </div>
      </div>

      {/* ── Audio Waveform (Visible when active and not muted) ── */}
      {isActive && (
        <div className={`audio-waveform ${activeCall?.isMuted ? 'muted' : ''}`}>
          <div className="bar"></div>
          <div className="bar"></div>
          <div className="bar"></div>
          <div className="bar"></div>
          <div className="bar"></div>
        </div>
      )}

      {/* ── Script Popover ── */}
      {script && !isRinging && (
        <div className="script-container">
          <button className="btn btn-ghost script-toggle" onClick={() => setShowScript(!showScript)}>
            {showScript ? 'Hide Script' : 'Show Script'}
          </button>
          {showScript && <div className="script-content">{script}</div>}
        </div>
      )}

      {/* ── DTMF Keypad Popover ── */}
      {showKeypad && isActive && (
        <div className="keypad-grid">
          {dtmfDigits.map((digit) => (
            <button key={digit} className="btn-dtmf" onClick={() => onSendDTMF(digit)}>
              {digit}
            </button>
          ))}
        </div>
      )}

      {/* ── Controls ── */}
      <div className="panel-controls">
        {isRinging ? (
          <>
            <button className="btn btn-answer" onClick={onAnswer}>Accept</button>
            <button className="btn btn-reject" onClick={onReject}>Reject</button>
          </>
        ) : (
          <>
            {isOnCall && (
              <>
                <button
                  className={`btn-control ${activeCall?.isMuted ? 'active' : ''}`}
                  onClick={activeCall?.isMuted ? onUnmute : onMute}
                  title="Mute"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {activeCall?.isMuted ? (
                      <>
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </>
                    )}
                  </svg>
                </button>
                <button
                  className={`btn-control ${showKeypad ? 'active' : ''}`}
                  onClick={() => setShowKeypad(!showKeypad)}
                  title="Keypad"
                  disabled={!isActive}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                  </svg>
                </button>
                <button
                  className={`btn-control ${activeCall?.isHeld ? 'active' : ''}`}
                  onClick={onToggleHold}
                  title="Hold"
                  disabled={!isActive}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                </button>
                <button className="btn-control btn-hangup" onClick={onHangup} title="End Call">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z" />
                  </svg>
                </button>
              </>
            )}
          </>
        )}
      </div>

    </div>
  );
}

function CallTimer({ started, isWrapUp }: { started: string | null; isWrapUp: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startMs = useRef<number | null>(null);

  useEffect(() => {
    if (!started) {
      setElapsed(0);
      return;
    }
    startMs.current = new Date(started).getTime();

    const tick = () => {
      if (startMs.current) {
        setElapsed(Math.floor((Date.now() - startMs.current) / 1000));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [started]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className={`call-timer ${isWrapUp ? 'wrap-up' : ''}`}>
      {mm}:{ss}
    </div>
  );
}
