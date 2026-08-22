/**
 * apps/web/src/components/ActiveCallBar.tsx
 *
 * Sticky top bar shown whenever the agent is on_call or in wrap_up.
 * Carries: lead name/phone, campaign script (collapsible), call timer,
 * Mute toggle, and Hangup button.
 *
 * The bar has heavy visual weight (teal glow border) so it's unmistakable
 * during an 8-hour shift — the agent always knows when they're live.
 */

import { useEffect, useRef, useState } from 'react';
import type { Agent, ActiveCall, CallLog } from '../types';

interface Props {
  agent: Agent;
  activeCall: ActiveCall | null;
  callContext: CallLog | null;
  script: string | null;
  onMute: () => void;
  onUnmute: () => void;
  onHangup: () => void;
}

export function ActiveCallBar({
  agent,
  activeCall,
  callContext,
  script,
  onMute,
  onUnmute,
  onHangup,
}: Props) {
  const isWrapUp = agent.status === 'wrap_up' && !activeCall;
  const isOnCall = !!activeCall;

  if (!isOnCall && !isWrapUp) return null;

  return (
    <div
      className={`active-call-bar${isWrapUp ? ' active-call-bar--wrap-up' : ''}`}
      role="region"
      aria-label={isWrapUp ? 'Wrap-up — submit disposition' : 'Active call controls'}
      aria-live="polite"
    >
      <div
        className={`call-bar-indicator${isWrapUp ? ' call-bar-indicator--wrap-up' : ''}`}
        aria-hidden="true"
      />

      <CallInfo callContext={callContext} isWrapUp={isWrapUp} />

      {script && <ScriptPanel script={script} />}

      <CallTimer started={callContext?.started_at ?? null} isWrapUp={isWrapUp} />

      {isOnCall && activeCall && (
        <div className="call-bar-actions">
          <MuteButton
            isMuted={activeCall.isMuted}
            onMute={onMute}
            onUnmute={onUnmute}
          />
          <button
            id="hangup-btn"
            className="btn btn-danger btn-icon"
            aria-label="Hang up"
            title="Hang up (future: Escape key)"
            onClick={onHangup}
          >
            {/* Phone hang-up icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z" />
            </svg>
          </button>
        </div>
      )}

      {isWrapUp && (
        <span
          className="text-sm text-muted"
          style={{ marginLeft: 'auto', flexShrink: 0 }}
        >
          Awaiting disposition…
        </span>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function CallInfo({
  callContext,
  isWrapUp,
}: {
  callContext: CallLog | null;
  isWrapUp: boolean;
}) {
  // We don't have a direct join to lead name here — that would require a
  // second fetch. In a real app you'd include lead_name in the call log
  // response. For now we show the call log ID and a "Live" label.
  return (
    <div className="call-bar-info">
      <div className="call-bar-name">
        {isWrapUp ? 'Call Ended' : 'Live Call'}
      </div>
      <div className="call-bar-detail">
        {callContext
          ? `Call ID: ${callContext.id.slice(0, 8)}…`
          : 'Connecting…'}
      </div>
    </div>
  );
}

function ScriptPanel({ script }: { script: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ flex: '0 0 200px' }}>
      <button
        className="btn btn-ghost"
        style={{ marginBottom: 4, padding: '4px 8px', fontSize: 11 }}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="call-script-panel"
      >
        {expanded ? 'Hide' : 'Show'} Script
      </button>
      {expanded && (
        <div id="call-script-panel" className="script-panel">
          {script}
        </div>
      )}
    </div>
  );
}

function MuteButton({
  isMuted,
  onMute,
  onUnmute,
}: {
  isMuted: boolean;
  onMute: () => void;
  onUnmute: () => void;
}) {
  return (
    <button
      id="mute-btn"
      className={`btn btn-icon ${isMuted ? 'btn-primary' : 'btn-ghost'}`}
      aria-label={isMuted ? 'Unmute' : 'Mute'}
      aria-pressed={isMuted}
      title={`${isMuted ? 'Unmute' : 'Mute'} (future: Space key)`}
      onClick={isMuted ? onUnmute : onMute}
    >
      {isMuted ? (
        // Mic off icon
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ) : (
        // Mic on icon
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
  );
}

// ── Call Timer ───────────────────────────────────────────────

function CallTimer({
  started,
  isWrapUp,
}: {
  started: string | null;
  isWrapUp: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startMs = useRef<number | null>(null);

  useEffect(() => {
    if (!started) return;
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
    <div
      className={`call-bar-timer${isWrapUp ? ' call-bar-timer--wrap-up' : ''}`}
      aria-label={`Call duration: ${mm} minutes ${ss} seconds`}
      aria-live="off"
    >
      {mm}:{ss}
    </div>
  );
}
