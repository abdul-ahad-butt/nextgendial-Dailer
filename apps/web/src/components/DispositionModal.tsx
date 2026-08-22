/**
 * apps/web/src/components/DispositionModal.tsx
 *
 * Blocking modal shown when agent.status === 'wrap_up'.
 * The agent MUST submit a disposition before the dialer re-triggers.
 * Disposition options match the Disposition union type exactly.
 */

import { useState } from 'react';
import type { CallLog, Disposition } from '../types';
import { api } from '../lib/api';

interface Props {
  callLog: CallLog | null;
  onSubmitted: () => void;
}

const DISPOSITIONS: { value: Disposition; label: string; emoji: string }[] = [
  { value: 'sale',           label: 'Sale',            emoji: '✅' },
  { value: 'callback',       label: 'Callback',        emoji: '📅' },
  { value: 'not_interested', label: 'Not Interested',  emoji: '🚫' },
  { value: 'wrong_number',   label: 'Wrong Number',    emoji: '❌' },
  { value: 'voicemail',      label: 'Voicemail',       emoji: '📨' },
  { value: 'no_answer',      label: 'No Answer',       emoji: '📵' },
  { value: 'dnc_request',    label: 'DNC Request',     emoji: '🔒' },
];

export function DispositionModal({ callLog, onSubmitted }: Props) {
  const [disposition, setDisposition] = useState<Disposition | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!disposition || !callLog) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.calls.submitDisposition(callLog.id, disposition, notes || undefined);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit disposition');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disposition-modal-title"
    >
      <div className="modal">
        <div className="modal-header">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'hsla(38, 92%, 55%, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            📋
          </div>
          <div>
            <h2 id="disposition-modal-title" className="modal-title">
              Log Call Disposition
            </h2>
            <p className="text-sm text-muted">
              Required before the next call begins
            </p>
          </div>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="disposition-select" className="form-label">
              Outcome *
            </label>
            <select
              id="disposition-select"
              className="form-control"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as Disposition)}
              autoFocus
              required
            >
              <option value="" disabled>
                Select an outcome…
              </option>
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.emoji} {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="disposition-notes" className="form-label">
              Notes
            </label>
            <textarea
              id="disposition-notes"
              className="form-control"
              placeholder="Optional — callback time, objection, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <p
              role="alert"
              style={{
                color: 'var(--danger)',
                fontSize: 13,
                padding: '8px 12px',
                background: 'var(--danger-dim)',
                borderRadius: 6,
              }}
            >
              {error}
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button
            id="disposition-submit-btn"
            className="btn btn-primary"
            disabled={!disposition || submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              'Submit & Continue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
