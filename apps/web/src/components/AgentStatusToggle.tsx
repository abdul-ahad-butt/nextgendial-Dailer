/**
 * apps/web/src/components/AgentStatusToggle.tsx
 *
 * Three-button toggle: Available / Break / Offline.
 * Disabled during engine-controlled states (dialing, on_call, wrap_up).
 * Server is the source of truth — this reflects polled agent.status.
 */

import type { Agent, AgentStatus } from '../types';

interface Props {
  agent: Agent | null;
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

export function AgentStatusToggle({ agent, onSetStatus }: Props) {
  if (!agent) return null;

  const isEngineControlled = ENGINE_CONTROLLED.includes(agent.status);

  return (
    <div className="status-toggle">
      <div className="status-toggle-label">Status</div>

      {isEngineControlled && (
        <div
          className={`agent-status-badge agent-status-badge--${agent.status}`}
          style={{ marginBottom: 8, alignSelf: 'flex-start' }}
          role="status"
          aria-live="polite"
        >
          <span className={`status-dot status-dot--${agent.status}`} aria-hidden="true" />
          {agent.status === 'dialing'  && 'Dialing…'}
          {agent.status === 'on_call'  && 'On Call'}
          {agent.status === 'wrap_up'  && 'Wrap-Up'}
        </div>
      )}

      <div className="status-buttons" role="group" aria-label="Agent status">
        {STATUS_OPTIONS.map(({ status, label, description }) => {
          const isActive = agent.status === status;
          const isDisabled = isEngineControlled;

          return (
            <button
              key={status}
              id={`status-btn-${status}`}
              className={`status-btn${isActive ? ' status-btn--active' : ''}`}
              disabled={isDisabled}
              aria-pressed={isActive}
              aria-label={`${label} — ${description}`}
              onClick={() => {
                if (!isDisabled && !isActive) {
                  onSetStatus(status).catch(console.error);
                }
              }}
            >
              <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
              <span>{label}</span>
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
          {agent.status === 'wrap_up'
            ? 'Submit a disposition to continue.'
            : 'Status is managed automatically.'}
        </p>
      )}
    </div>
  );
}
