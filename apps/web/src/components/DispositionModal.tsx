/**
 * apps/web/src/components/DispositionModal.tsx
 *
 * Blocking modal shown when agent.status === 'wrap_up'.
 * The agent MUST submit a disposition before the dialer re-triggers.
 * When 'callback' is selected, prompts for scheduled callback time
 * and automatically persists it to the callbacks queue.
 */

import { useState } from 'react';
import type { CallLog, Disposition } from '../types';
import { api } from '../lib/api';

interface Props {
  callLog: CallLog | null;
  onSubmitted: () => void;
}

const DISPOSITIONS: { value: Disposition; label: string; emoji: string; color: string }[] = [
  { value: 'sale',           label: 'Sale / Closed',    emoji: '🏆', color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300' },
  { value: 'callback',       label: 'Callback Needed',  emoji: '📅', color: 'from-amber-500/20 to-orange-500/10 border-amber-500/40 text-amber-300' },
  { value: 'not_interested', label: 'Not Interested',   emoji: '🚫', color: 'from-rose-500/20 to-pink-500/10 border-rose-500/40 text-rose-300' },
  { value: 'wrong_number',   label: 'Wrong Number',     emoji: '❌', color: 'from-slate-500/20 to-slate-600/10 border-slate-600/40 text-slate-300' },
  { value: 'voicemail',      label: 'Left Voicemail',   emoji: '📨', color: 'from-sky-500/20 to-blue-500/10 border-sky-500/40 text-sky-300' },
  { value: 'no_answer',      label: 'No Answer / Ring', emoji: '📵', color: 'from-indigo-500/20 to-indigo-600/10 border-indigo-500/40 text-indigo-300' },
  { value: 'dnc_request',    label: 'Do Not Call (DNC)',emoji: '⛔', color: 'from-red-600/25 to-red-900/20 border-red-500/50 text-red-300' },
];

export function DispositionModal({ callLog, onSubmitted }: Props) {
  const [disposition, setDisposition] = useState<Disposition | ''>('');
  const [notes, setNotes] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!disposition || !callLog) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. Submit call log disposition
      await api.calls.submitDisposition(callLog.id, disposition, notes || undefined);

      // 2. If callback was selected and time specified, store in callbacks table
      if (disposition === 'callback' && callbackTime) {
        try {
          await api.callbacks.create({
            lead_id: callLog.lead_id || undefined,
            phone_number: (callLog as any).phone_number || (callLog as any).to_number || '+10000000000',
            scheduled_time: new Date(callbackTime).toISOString(),
            notes: notes ? `Disposition Note: ${notes}` : 'Scheduled via Wrap-up Disposition',
          });
        } catch (cbErr) {
          console.error('Failed to create scheduled callback record', cbErr);
        }
      }

      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit disposition');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disposition-modal-title"
    >
      <div className="relative w-full max-w-lg bg-[#0F1422] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6 text-slate-100 animate-scale-up">
        {/* Glow ambient accent */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3.5 mb-5 pb-4 border-b border-slate-800/80">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xl text-amber-400">
            📋
          </div>
          <div>
            <h2 id="disposition-modal-title" className="text-base font-semibold text-slate-100">
              Log Call Disposition
            </h2>
            <p className="text-xs text-slate-400">
              Required wrap-up step before the next lead or call session
            </p>
          </div>
        </div>

        {/* Outcome grid */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Select Call Outcome *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DISPOSITIONS.map((d) => {
                const isSelected = disposition === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDisposition(d.value)}
                    className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left text-xs font-medium transition-all ${
                      isSelected
                        ? `bg-gradient-to-r ${d.color} shadow-lg ring-1 ring-emerald-500/40 scale-[1.02]`
                        : 'bg-slate-900/50 hover:bg-slate-800/70 border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="text-base">{d.emoji}</span>
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional Callback Scheduler */}
          {disposition === 'callback' && (
            <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-800/40 space-y-2 animate-fade-in">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span>📅</span>
                <span>Schedule Callback Time</span>
              </div>
              <input
                type="datetime-local"
                value={callbackTime}
                onChange={(e) => setCallbackTime(e.target.value)}
                className="w-full bg-slate-950/90 border border-amber-700/50 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
              <p className="text-[11px] text-amber-400/80">
                This will automatically add this contact to your priority Scheduled Callbacks Queue.
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label htmlFor="disposition-notes" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Call Notes (Optional)
            </label>
            <textarea
              id="disposition-notes"
              className="w-full bg-slate-950/70 border border-slate-800 focus:border-emerald-500 rounded-2xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none transition-colors resize-none"
              placeholder="Key notes, customer objections, budget details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex justify-end gap-3">
          <button
            id="disposition-submit-btn"
            type="button"
            className="w-full py-3 px-5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-98 transition-all disabled:opacity-40"
            disabled={!disposition || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting & Advancing...' : 'Save & Ready for Next Lead'}
          </button>
        </div>
      </div>
    </div>
  );
}
