/**
 * apps/web/src/components/CallHistoryTable.tsx
 *
 * Modernized Call History with floating row cards,
 * robust duration formatting (safeguarded against negative corrupted values),
 * and live disposition tags.
 */

import React, { useEffect, useState } from 'react';
import type { CallLog, Disposition } from '../types';
import { api } from '../lib/api';
import { formatDuration, formatE164 } from '../utils/formatters';

interface Props {
  agentId: string;
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

export const CallHistoryTable = React.memo(function CallHistoryTable({ agentId }: Props) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchLogs = () => {
    setLoading(true);
    api.calls
      .list({ agent_id: agentId, page, limit: PAGE_SIZE })
      .then((r) => {
        setLogs(r.data);
        setTotal(r.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, [agentId, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'completed' || s === 'connected' || s === 'in_progress') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          {status}
        </span>
      );
    }
    if (s === 'ringing') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
          Ringing
        </span>
      );
    }
    if (s === 'failed' || s === 'busy' || s === 'no_answer' || s === 'declined') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
          {status}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700/50">
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-900/30">
        <table className="w-full text-left text-xs border-collapse" aria-label="Call history">
          <thead>
            <tr className="border-b border-slate-800/80 bg-slate-900/60 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
              <th scope="col" className="py-3 px-4">Time</th>
              <th scope="col" className="py-3 px-4">Destination</th>
              <th scope="col" className="py-3 px-4">Status</th>
              <th scope="col" className="py-3 px-4">Disposition</th>
              <th scope="col" className="py-3 px-4">Duration</th>
              <th scope="col" className="py-3 px-4">Diagnostics</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span>Loading call history...</span>
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center text-slate-500">
                    <div className="w-12 h-12 rounded-2xl bg-slate-800/50 flex items-center justify-center text-xl mb-2">
                      📞
                    </div>
                    <div className="text-sm font-medium text-slate-300">No Call History</div>
                    <div className="text-xs text-slate-500 mt-1">Calls made by this agent will appear here.</div>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const destination = (log as any).phone_number || (log as any).to_number || '—';
                const safeDuration = formatDuration(log.duration_seconds, log.status);

                return (
                  <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {formatTs(log.started_at)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-200 font-medium">
                      {destination !== '—' ? formatE164(destination) : '—'}
                    </td>
                    <td className="py-3 px-4">
                      {getStatusBadge(log.status)}
                    </td>
                    <td className="py-3 px-4">
                      {log.disposition ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-emerald-950/40 text-emerald-300 border border-emerald-800/50">
                          {DISPOSITIONS_LABEL[log.disposition] || log.disposition}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-slate-200">
                      {safeDuration}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      <div>{log.failure_category || log.hangup_cause || '—'}</div>
                      {log.setup_duration_ms !== null && log.setup_duration_ms !== undefined && (
                        <div className="text-[10px] text-slate-500 font-mono">
                          Setup: {log.setup_duration_ms}ms
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400 px-2">
          <span>
            Showing page <span className="font-semibold text-slate-200">{page}</span> of{' '}
            <span className="font-semibold text-slate-200">{totalPages}</span> ({total} total calls)
          </span>
          <div className="flex items-center gap-2">
            <button
              id="history-prev-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              ← Prev
            </button>
            <button
              id="history-next-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
