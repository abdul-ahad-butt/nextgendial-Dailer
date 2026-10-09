import React, { useCallback, useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { getAudioMuted, initAudioContext } from '../../lib/audio';
import { formatE164 } from '../../utils/formatters';

const DTMF_FREQS: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

interface KeypadProps {
  onCall: (number: string) => void;
  disabled?: boolean;
  isActiveCall?: boolean;
  onDTMF?: (digit: string) => void;
  callerIdOverride?: string | null;
}

const KEYS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '•' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '⌗' },
];

let localAudioCtx: AudioContext | null = null;

export const Keypad: React.FC<KeypadProps> = ({
  onCall,
  disabled = false,
  isActiveCall = false,
  onDTMF,
  callerIdOverride,
}) => {
  const [number, setNumber] = useState('');
  const [callerId, setCallerId] = useState<string | null>(null);

  useEffect(() => {
    if (callerIdOverride !== undefined) {
      setCallerId(callerIdOverride);
    } else {
      api.agent.getCallerId().then(setCallerId).catch(console.error);
    }
  }, [callerIdOverride]);

  const playTone = useCallback((digit: string) => {
    if (getAudioMuted()) return;
    try {
      initAudioContext().catch(() => {});
      if (!localAudioCtx) {
        localAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (localAudioCtx.state === 'suspended') {
        localAudioCtx.resume().catch(() => {});
      }

      const freqs = DTMF_FREQS[digit];
      if (freqs && localAudioCtx) {
        const osc1 = localAudioCtx.createOscillator();
        const osc2 = localAudioCtx.createOscillator();
        const gainNode = localAudioCtx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.value = freqs[0];
        osc2.frequency.value = freqs[1];

        const t = localAudioCtx.currentTime;
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(0.08, t + 0.01);
        gainNode.gain.setValueAtTime(0.08, t + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, t + 0.14);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(localAudioCtx.destination);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.14);
        osc2.stop(t + 0.14);
      }
    } catch {}
  }, []);

  const append = useCallback((digit: string) => {
    playTone(digit);
    if (isActiveCall && onDTMF) {
      onDTMF(digit);
    } else {
      setNumber((n) => (n.length < 20 ? n + digit : n));
    }
  }, [isActiveCall, onDTMF, playTone]);

  const backspace = useCallback(() => {
    setNumber((n) => n.slice(0, -1));
  }, []);

  const clearNumber = useCallback(() => {
    setNumber('');
  }, []);

  const handleCall = useCallback(() => {
    if (!number || disabled || isActiveCall) return;
    const normalized = formatE164(number);
    onCall(normalized);
  }, [number, disabled, isActiveCall, onCall]);

  // Keyboard shortcut listener
  useEffect(() => {
    if (disabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key;
      if (/^[0-9*#]$/.test(key)) {
        append(key);
      } else if (key === 'Backspace') {
        backspace();
      } else if (key === 'Enter') {
        handleCall();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, append, backspace, handleCall]);

  return (
    <div className="tactile-keypad-container" aria-label="Tactile Dialer Keypad">
      {/* Caller ID Badge */}
      <div className="caller-id-badge">
        <div className="caller-id-badge__label">CALLER ID / LINE</div>
        <div className="caller-id-badge__number">
          <span className="live-dot" />
          {callerId || 'Unassigned Line'}
        </div>
      </div>

      {/* Number Display with Mono Typography */}
      <div className="keypad-screen">
        <div
          className={`keypad-screen__digits ${!number ? 'keypad-screen__placeholder' : ''}`}
          aria-live="polite"
        >
          {number || 'Enter number'}
        </div>
        {number && (
          <button
            type="button"
            className="keypad-screen__clear-btn"
            onClick={clearNumber}
            title="Clear number"
            aria-label="Clear number"
          >
            ✕
          </button>
        )}
      </div>

      {/* Audio Waveform Bar (active during call) */}
      {isActiveCall && (
        <div className="keypad-wave-bar" aria-label="Audio wave active">
          <span className="wave-bar wave-bar--1" />
          <span className="wave-bar wave-bar--2" />
          <span className="wave-bar wave-bar--3" />
          <span className="wave-bar wave-bar--4" />
          <span className="wave-bar wave-bar--5" />
          <span className="wave-bar wave-bar--6" />
          <span className="wave-bar wave-bar--7" />
          <span className="wave-label">LIVE AUDIO STREAM</span>
        </div>
      )}

      {/* Tactile Keypad Keys Grid */}
      <div className="tactile-grid" role="group" aria-label="Dialpad Keys">
        {KEYS.map(({ digit, sub }) => (
          <button
            key={digit}
            id={`tactile-key-${digit === '*' ? 'star' : digit === '#' ? 'hash' : digit}`}
            type="button"
            className="tactile-key"
            onClick={() => append(digit)}
            disabled={disabled}
            aria-label={`${digit} ${sub}`}
          >
            <span className="tactile-key__digit">{digit}</span>
            {sub && <span className="tactile-key__sub">{sub}</span>}
          </button>
        ))}
      </div>

      {/* Bottom Actions Row */}
      <div className="tactile-actions">
        <button
          type="button"
          id="tactile-backspace-btn"
          className="tactile-action-btn tactile-action-btn--secondary"
          onClick={backspace}
          disabled={!number || disabled}
          aria-label="Delete last digit"
        >
          ⌫
        </button>

        <button
          type="button"
          id="tactile-call-btn"
          className="tactile-action-btn tactile-action-btn--call"
          onClick={handleCall}
          disabled={!number || disabled || isActiveCall}
          aria-label={`Dial ${number || 'number'}`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ marginRight: 6 }}
          >
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z" />
          </svg>
          {isActiveCall ? 'In Call' : 'Call'}
        </button>
      </div>
    </div>
  );
};
