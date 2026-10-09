import React, { useCallback, useState, useEffect } from 'react';
import { Phone, Delete, Volume2 } from 'lucide-react';
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
  { num: '1', sub: ' ' },
  { num: '2', sub: 'ABC' },
  { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' },
  { num: '5', sub: 'JKL' },
  { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' },
  { num: '8', sub: 'TUV' },
  { num: '9', sub: 'WXYZ' },
  { num: '*', sub: ' ' },
  { num: '0', sub: '+' },
  { num: '#', sub: ' ' },
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

  const handleKeyClick = useCallback(
    (val: string) => {
      playTone(val);
      if (isActiveCall && onDTMF) {
        onDTMF(val);
      } else {
        setNumber((prev) => (prev.length < 20 ? prev + val : prev));
      }
    },
    [isActiveCall, onDTMF, playTone]
  );

  const handleBackspace = useCallback(() => {
    setNumber((prev) => prev.slice(0, -1));
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
        handleKeyClick(key);
      } else if (key === 'Backspace') {
        handleBackspace();
      } else if (key === 'Enter') {
        handleCall();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, handleKeyClick, handleBackspace, handleCall]);

  return (
    <div className="w-full max-w-[340px] mx-auto glass-panel rounded-3xl p-6 shadow-2xl border border-slate-800/80 transition-all hover:border-slate-700/80">
      {/* Caller ID Badge */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/60 mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Caller ID / Line
        </span>
        <span className="text-xs font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 flex items-center gap-1.5 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {callerId || '+1 (Standard Line)'}
        </span>
      </div>

      {/* Number Display Screen */}
      <div className="relative mb-5 bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 flex items-center justify-between shadow-inner group focus-within:border-emerald-500/50 transition-colors">
        <input
          type="text"
          value={number}
          placeholder="Enter number..."
          onChange={(e) => setNumber(e.target.value)}
          disabled={disabled}
          className="bg-transparent text-xl font-mono tracking-wider font-semibold text-white outline-none w-full placeholder:text-slate-600"
          aria-label="Phone number to dial"
        />
        {number && (
          <button
            type="button"
            onClick={handleBackspace}
            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors rounded-lg hover:bg-slate-800/60 ml-2"
            title="Backspace"
            aria-label="Delete last digit"
          >
            <Delete className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Live Audio Waveform when In Call */}
      {isActiveCall && (
        <div className="mb-4 py-2 px-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
            <Volume2 className="w-3.5 h-3.5 animate-pulse" />
            <span className="tracking-wide text-[11px]">LIVE AUDIO STREAM</span>
          </div>
          <div className="flex items-end gap-1 h-3.5">
            <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-2" style={{ animationDelay: '0ms' }} />
            <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-3.5" style={{ animationDelay: '150ms' }} />
            <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-1.5" style={{ animationDelay: '300ms' }} />
            <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-3" style={{ animationDelay: '450ms' }} />
          </div>
        </div>
      )}

      {/* 3x4 Tactile Keypad Grid */}
      <div className="grid grid-cols-3 gap-3 mb-5" role="group" aria-label="Dialpad keys">
        {KEYS.map((k) => (
          <button
            key={k.num}
            type="button"
            onClick={() => handleKeyClick(k.num)}
            disabled={disabled}
            className="group relative flex flex-col items-center justify-center h-14 rounded-2xl bg-slate-800/40 hover:bg-slate-700/50 active:scale-95 border border-slate-700/40 hover:border-emerald-500/30 transition-all duration-150 shadow-sm disabled:opacity-40 disabled:pointer-events-none"
            aria-label={`Digit ${k.num}`}
          >
            <span className="text-xl font-semibold text-white group-hover:text-emerald-300 transition-colors font-mono">
              {k.num}
            </span>
            {k.sub !== ' ' && (
              <span className="text-[9px] tracking-widest text-slate-400 font-medium">
                {k.sub}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Call Button */}
      <button
        type="button"
        onClick={handleCall}
        disabled={isActiveCall || !number || disabled}
        className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-semibold text-base transition-all duration-200 shadow-lg disabled:opacity-40 disabled:pointer-events-none ${
          isActiveCall
            ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
            : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-emerald-500/25 active:scale-[0.98]'
        }`}
        aria-label={isActiveCall ? 'In Call' : 'Call Now'}
      >
        <Phone className="w-5 h-5 fill-current" />
        <span>{isActiveCall ? 'In Call' : 'Call Now'}</span>
      </button>
    </div>
  );
};
