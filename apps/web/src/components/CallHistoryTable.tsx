/**
 * apps/web/src/components/CallHistoryTable.tsx
 *
 * Paginated call log for the current agent.
 * Disposition badges use distinct color coding for quick scanning.
 */

import { useEffect, useState } from 'react';
import type { CallLog, Disposition } from '../types';
import { api } from '../lib/api';

interface Props {
  agentId: string;
}

function formatDuration(secs: number | null): string {
  if (secs === null) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTs(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const DISPOSITIONS_LABEL: Record<Disposition, string> = {
  sale: 'Sale',
  callback: 'Callback',
  not_interested: 'Not Interested',
  wrong_number: 'Wrong #',
  voicemail: 'Voicemail',
  no_answer: 'No Answer',
  dnc_request: 'DNC',
};

const PAGE_SIZE = 20;

export function CallHistoryTable({ agentId }: Props) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.calls
      .list({ agent_id: agentId, page, limit: PAGE_SIZE })
      .then((r) => {
        setLogs(r.data);
        setTotal(r.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="table-container">
        <table className="table" aria-label="Call history">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Status</th>
              <th scope="col">Disposition</th>
              <th scope="col">Duration</th>
              <th scope="col">Hangup Cause</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  <span className="spinner" style={{ margin: '0 auto' }} />
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-empty text-muted">
                  No calls yet
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="text-mono text-sm">{formatTs(log.started_at)}</td>
                  <td>
                    <span style={{ fontSize: 12, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                      {log.status}
                    </span>
                  </td>
                  <td>
                    {log.disposition ? (
                      <span
                        className={`disposition-badge disposition-badge--${log.disposition}`}
                      >
                        {DISPOSITIONS_LABEL[log.disposition]}
                      </span>
                    ) : (
                      <span className="text-muted text-sm">—</span>
                    )}
                  </td>
                  <td className="text-mono text-sm">{formatDuration(log.duration_seconds)}</td>
                  <td className="text-muted text-sm">
                    {log.hangup_cause ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            justifyContent: 'flex-end',
          }}
        >
          <button
            id="history-prev-btn"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            ← Prev
          </button>
          <span className="text-sm text-muted" aria-live="polite">
            Page {page} of {totalPages}
          </span>
          <button
            id="history-next-btn"
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
