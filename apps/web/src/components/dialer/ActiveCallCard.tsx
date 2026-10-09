import React, { useState, useEffect } from 'react';
import type { ActiveCall } from '../../types';
import { formatDuration } from '../../utils/formatters';

interface ActiveCallCardProps {
  activeCall: ActiveCall;
  onHangup: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onToggleHold: () => void;
  onDTMF: (digit: string) => void;
  contactName?: string | null;
}

export const ActiveCallCard: React.FC<ActiveCallCardProps> = ({
  activeCall,
  onHangup,
  onMute,
  onUnmute,
  onToggleHold,
  onDTMF,
  contactName,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [showDTMF, setShowDTMF] = useState(false);

  // Timer loop for active live talk
  useEffect(() => {
    setSeconds(0);
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeCall.callLogId]);

  const dtmfDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  return (
    <div className="active-call-card" aria-label="Active Call Panel">
      <div className="active-call-card__header">
        <div className="active-call-card__status-pill">
          <span className="live-pulse-dot" />
          <span className="status-label">
            {activeCall.isHeld ? 'On Hold' : 'Live Talk'}
          </span>
        </div>
        <div className="active-call-card__timer font-mono">
          {formatDuration(seconds)}
        </div>
      </div>

      <div className="active-call-card__contact">
        <div className="contact-avatar">
          {contactName ? contactName[0]?.toUpperCase() : '📞'}
        </div>
        <div className="contact-details">
          <h4 className="contact-name">{contactName || 'Connected Lead'}</h4>
          <p className="contact-number font-mono">
            {activeCall.destinationNumber || 'In Progress'}
          </p>
        </div>
      </div>

      {/* Live Audio Waveform Animation */}
      <div className="active-call-card__waveform">
        <div className="sound-wave-bars">
          <span className="wave-bar wave-bar--1" />
          <span className="wave-bar wave-bar--2" />
          <span className="wave-bar wave-bar--3" />
          <span className="wave-bar wave-bar--4" />
          <span className="wave-bar wave-bar--5" />
          <span className="wave-bar wave-bar--6" />
          <span className="wave-bar wave-bar--7" />
          <span className="wave-bar wave-bar--8" />
        </div>
        <span className="waveform-tag">HD WebRTC Audio Flow</span>
      </div>

      {/* Quick DTMF Drawer */}
      {showDTMF && (
        <div className="active-call-dtmf-grid">
          {dtmfDigits.map((d) => (
            <button
              key={d}
              type="button"
              className="dtmf-btn"
              onClick={() => onDTMF(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {/* In-Call Controls Toolbar */}
      <div className="active-call-card__controls">
        <button
          type="button"
          className={`call-control-btn ${activeCall.isMuted ? 'call-control-btn--active' : ''}`}
          onClick={activeCall.isMuted ? onUnmute : onMute}
          title={activeCall.isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {activeCall.isMuted ? '🔇 Unmute' : '🎙️ Mute'}
        </button>

        <button
          type="button"
          className={`call-control-btn ${activeCall.isHeld ? 'call-control-btn--active' : ''}`}
          onClick={onToggleHold}
          title={activeCall.isHeld ? 'Resume call' : 'Put on hold'}
        >
          {activeCall.isHeld ? '▶️ Resume' : '⏸️ Hold'}
        </button>

        <button
          type="button"
          className={`call-control-btn ${showDTMF ? 'call-control-btn--active' : ''}`}
          onClick={() => setShowDTMF(!showDTMF)}
          title="Toggle DTMF keypad"
        >
          🔢 Keypad
        </button>

        <button
          type="button"
          className="call-control-btn call-control-btn--hangup"
          onClick={onHangup}
          title="End Call"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
          Hangup
        </button>
      </div>
    </div>
  );
};
