/**
 * apps/web/src/components/CallHistoryTable.tsx
 *
 * Glassmorphic Call History & Analytics table with status pill badges,
 * accurate call duration, and modern pagination controls.
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
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {status}
        </span>
      );
    }
    if (s === 'ringing') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 inline-flex items-center gap-1.5 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          Ringing
        </span>
      );
    }
    if (s === 'failed' || s === 'busy' || s === 'no_answer' || s === 'declined') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          {status}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700/50 inline-flex items-center gap-1.5">
        {status}
      </span>
    );
  };

  return (
    <div className="glass-panel rounded-3xl p-6 border border-slate-800/80 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">Call History & Analytics</h2>
          <p className="text-xs text-slate-400">Accurate call duration, outcomes, and Telnyx diagnostics</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800/60 bg-slate-950/40">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800/80 bg-slate-900/60 text-[11px] uppercase tracking-wider text-slate-400">
              <th scope="col" className="py-3 px-4 font-semibold">Time</th>
              <th scope="col" className="py-3 px-4 font-semibold">Destination</th>
              <th scope="col" className="py-3 px-4 font-semibold">Status</th>
              <th scope="col" className="py-3 px-4 font-semibold">Disposition</th>
              <th scope="col" className="py-3 px-4 font-semibold">Duration</th>
              <th scope="col" className="py-3 px-4 font-semibold">Diagnostics</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40 text-xs">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Loading call history...</span>
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-xl mb-2 text-slate-400">
                      📞
                    </div>
                    <div className="text-sm font-semibold text-slate-300">No Call History Yet</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Outbound and inbound calls will appear here in real time.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const destination = (log as any).phone_number || (log as any).to_number || '—';
                const safeDuration = formatDuration(log.duration_seconds, log.status);

                return (
                  <tr key={log.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {formatTs(log.started_at)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-200 font-semibold">
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
                    <td className="py-3 px-4 font-mono font-medium text-slate-300">
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

      {/* Pagination Footer */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800/60 text-xs text-slate-400">
        <span>
          Showing page <span className="font-semibold text-slate-200">{page}</span> of{' '}
          <span className="font-semibold text-slate-200">{totalPages || 1}</span> ({total} total calls)
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            id="history-prev-btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            Prev
          </button>
          <button
            type="button"
            id="history-next-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
});
