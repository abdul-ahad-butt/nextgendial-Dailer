import { useCallback, useState, useEffect } from 'react';
import { api } from '../lib/api';

interface Props {
  onCall: (number: string) => void; 
  disabled?: boolean;
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
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
];

export function Dialer({ onCall, disabled = false }: Props) {
  const [number, setNumber] = useState('');
  const [callerId, setCallerId] = useState<string | null>(null);

  useEffect(() => {
    api.agent.getCallerId().then(setCallerId).catch(console.error);
  }, []);

  const append = useCallback((digit: string) => {
    setNumber((n) => (n.length < 20 ? n + digit : n));
  }, []);

  const backspace = useCallback(() => {
    setNumber((n) => n.slice(0, -1));
  }, []);

  const handleCall = useCallback(() => {
    if (!number || disabled) return;
    onCall(number);
  }, [number, onCall, disabled]);

  return (
    <div className="dialpad" aria-label="Manual dial pad">
      {/* Caller ID Display */}
      <div style={{ marginBottom: 12, fontSize: 13, textAlign: 'center', background: 'var(--surface-sunken)', padding: '8px', borderRadius: '6px' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Caller ID</div>
        <div style={{ fontWeight: 600, marginTop: 4, fontFamily: 'monospace', fontSize: 14 }}>{callerId || 'Loading...'}</div>
      </div>

      {/* Number display */}
      <div className="dialpad-display" aria-live="polite" aria-label={`Number to dial: ${number || 'empty'}`}>
        {number || <span style={{ opacity: 0.3 }}>Enter number</span>}
      </div>

      {/* Keypad grid */}
      <div className="dialpad-grid" role="group" aria-label="Dial keys">
        {KEYS.map(({ digit, sub }) => (
          <button
            key={digit}
            id={`dial-key-${digit === '*' ? 'star' : digit === '#' ? 'hash' : digit}`}
            className="dialpad-key"
            aria-label={`${digit}${sub ? ` ${sub}` : ''}`}
            onClick={() => append(digit)}
            disabled={disabled}
          >
            {digit}
            {sub && <span className="dialpad-key-sub">{sub}</span>}
          </button>
        ))}
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          id="dial-backspace-btn"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          aria-label="Delete last digit"
          onClick={backspace}
          disabled={!number}
        >
          ⌫
        </button>

        <button
          id="dial-call-btn"
          className="btn btn-primary"
          style={{ flex: 2 }}
          aria-label={`Call ${number || 'number'}`}
          onClick={handleCall}
          disabled={!number || disabled}
        >
          {/* Phone icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 4 }}>
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z" />
          </svg>
          Call
        </button>
      </div>
    </div>
  );
}
