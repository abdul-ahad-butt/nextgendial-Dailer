/**
 * apps/web/src/components/AgentStatusToggle.tsx
 *
 * Three-button pill toggle: Available / Break / Offline.
 * Disabled during engine-controlled states (dialing, on_call, wrap_up).
 * Server is the source of truth — this reflects polled agent.status.
 */

import { useEffect, useState } from 'react';
import type { AgentStatus } from '../types';

interface Props {
  status: AgentStatus;
  changedAt: string | null;
  onSetStatus: (status: AgentStatus) => Promise<void>;
}

const STATUS_OPTIONS: {
  status: AgentStatus;
  label: string;
}[] = [
  { status: 'available', label: 'Available' },
  { status: 'break',     label: 'Break' },
  { status: 'offline',   label: 'Offline' },
];

const ENGINE_CONTROLLED: AgentStatus[] = ['dialing', 'on_call', 'wrap_up'];

export function AgentStatusToggle({ status, changedAt, onSetStatus }: Props) {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    if (!changedAt || status !== 'break') {
      setElapsed(0);
      return;
    }

    const start = new Date(changedAt).getTime();
    const updateElapsed = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };

    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [changedAt, status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isEngineControlled = ENGINE_CONTROLLED.includes(status);

  return (
    <div className="flex flex-col gap-2">
      {isEngineControlled && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border self-start shadow-sm animate-pulse bg-amber-500/10 text-amber-400 border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>
            {status === 'dialing' && 'Dialing…'}
            {status === 'on_call' && 'On Live Call'}
            {status === 'wrap_up' && 'Wrap-Up Period'}
          </span>
        </div>
      )}

      <div className="inline-flex p-1 rounded-2xl bg-slate-950/80 border border-slate-800/80 gap-1 shadow-inner" role="group" aria-label="Agent status">
        {STATUS_OPTIONS.map((opt) => {
          const isActive = status === opt.status;
          const isDisabled = isEngineControlled;

          return (
            <button
              key={opt.status}
              id={`status-btn-${opt.status}`}
              type="button"
              disabled={isDisabled}
              aria-pressed={isActive}
              onClick={() => {
                if (!isDisabled && !isActive) {
                  onSetStatus(opt.status).catch(console.error);
                }
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all duration-150 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive
                  ? opt.status === 'available'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 font-bold'
                    : opt.status === 'break'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                    : 'bg-slate-700 text-white shadow-md shadow-slate-900/40'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  opt.status === 'available'
                    ? 'bg-emerald-400'
                    : opt.status === 'break'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />
              <span>{opt.label}</span>
              {isActive && opt.status === 'break' && (
                <span className="ml-1 text-[10px] font-mono font-bold text-slate-950 bg-amber-400/80 px-1 rounded">
                  {formatTime(elapsed)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isEngineControlled && (
        <p className="text-[11px] text-slate-400 px-1">
          {status === 'wrap_up'
            ? 'Submit a disposition in the dialog to continue.'
            : 'Status is actively managed by current telephony session.'}
        </p>
      )}
    </div>
  );
}
