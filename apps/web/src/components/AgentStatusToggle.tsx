/**
 * apps/web/src/components/AgentStatusToggle.tsx
 *
 * Three-button toggle: Available / Break / Offline.
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
  description: string;
}[] = [
  { status: 'available', label: 'Available', description: 'Ready to receive calls' },
  { status: 'break',     label: 'Break',     description: 'Temporarily unavailable' },
  { status: 'offline',   label: 'Offline',   description: 'End shift' },
];

// States that the engine controls — agent cannot manually switch out of these
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
    <div className="status-toggle">
      <div className="status-toggle-label">Status</div>

      {isEngineControlled && (
        <div
          className={`agent-status-badge agent-status-badge--${status}`}
          style={{ marginBottom: 8, alignSelf: 'flex-start' }}
          role="status"
          aria-live="polite"
        >
          <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
          {status === 'dialing'  && 'Dialing…'}
          {status === 'on_call'  && 'On Call'}
          {status === 'wrap_up'  && 'Wrap-Up'}
        </div>
      )}

      <div className="status-buttons" role="group" aria-label="Agent status">
        {STATUS_OPTIONS.map((opt) => {
          const isActive = status === opt.status;
          const isDisabled = isEngineControlled;

          return (
            <button
              key={opt.status}
              id={`status-btn-${opt.status}`}
              className={`status-btn${isActive ? ' status-btn--active' : ''}`}
              disabled={isDisabled}
              aria-pressed={isActive}
              aria-label={`${opt.label} — ${opt.description}`}
              onClick={() => {
                if (!isDisabled && !isActive) {
                  onSetStatus(opt.status).catch(console.error);
                }
              }}
            >
              <span className={`status-dot status-dot--${opt.status}`} aria-hidden="true" />
              <span>{opt.label}</span>
              {isActive && opt.status === 'break' && (
                <span style={{ marginLeft: 'auto', fontSize: '0.85em', color: 'var(--warning)', fontWeight: 'bold' }}>
                  {formatTime(elapsed)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isEngineControlled && (
        <p
          className="text-sm text-muted"
          style={{ padding: '0 4px' }}
          role="note"
        >
          {status === 'wrap_up'
            ? 'Submit a disposition to continue.'
            : 'Status is managed automatically.'}
        </p>
      )}
    </div>
  );
}

