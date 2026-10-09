import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { formatE164 } from '../../utils/formatters';

export interface CallbackItem {
  id: string;
  tenant_id: string;
  lead_id?: string;
  phone_number: string;
  contact_name?: string;
  scheduled_time: string;
  assigned_agent_id?: string;
  assigned_agent_name?: string;
  status: 'pending' | 'completed' | 'dismissed';
  notes?: string;
  created_at: string;
}

interface CallbackDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onDial: (phoneNumber: string, leadId?: string) => void;
}

export const CallbackDrawer: React.FC<CallbackDrawerProps> = ({
  isOpen,
  onClose,
  onDial,
}) => {
  const [callbacks, setCallbacks] = useState<CallbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'completed'>('pending');
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCallbacks = async () => {
    try {
      setLoading(true);
      const data = await api.callbacks.list({ status: filter });
      setCallbacks(data || []);
    } catch (err) {
      console.error('Failed to load callbacks', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCallbacks();
    }
  }, [isOpen, filter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !scheduledTime) return;

    try {
      setSubmitting(true);
      await api.callbacks.create({
        phone_number: phone,
        contact_name: name || undefined,
        scheduled_time: new Date(scheduledTime).toISOString(),
        notes: notes || undefined,
      });
      setPhone('');
      setName('');
      setScheduledTime('');
      setNotes('');
      setShowAddForm(false);
      fetchCallbacks();
    } catch (err: any) {
      alert(err.message || 'Failed to create callback');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: 'completed' | 'dismissed') => {
    try {
      await api.callbacks.update(id, { status });
      setCallbacks((prev) => prev.filter((cb) => cb.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to update callback');
    }
  };

  if (!isOpen) return null;

  const isDue = (timeStr: string) => {
    return new Date(timeStr).getTime() <= Date.now() + 5 * 60 * 1000;
  };

  const isOverdue = (timeStr: string) => {
    return new Date(timeStr).getTime() < Date.now();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300">
      <div className="relative w-full max-w-md h-full bg-[#0E131F]/95 border-l border-slate-800 shadow-2xl flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800/80 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">Scheduled Callbacks</h2>
              <p className="text-xs text-slate-400">Priority queue for timely lead follow-ups</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-slate-800/50 flex items-center justify-between gap-3 bg-slate-900/20">
          <div className="flex bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 text-xs">
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filter === 'pending'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filter === 'completed'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Completed
            </button>
          </div>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl transition-all"
          >
            <span>+</span>
            <span>Schedule</span>
          </button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <form onSubmit={handleCreate} className="p-4 border-b border-slate-800/80 bg-slate-900/60 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Schedule Callback</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Phone Number (+1...)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
              <input
                type="text"
                placeholder="Contact Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <input
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                required
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <textarea
              placeholder="Notes or context for the callback..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Callback'}
              </button>
            </div>
          </form>
        )}

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-xs">
              Loading callbacks...
            </div>
          ) : callbacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-6 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
              <div className="w-10 h-10 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 mb-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-xs font-medium text-slate-300">No callbacks in queue</p>
              <p className="text-[11px] text-slate-500 mt-1">Scheduled call reminders will appear here.</p>
            </div>
          ) : (
            callbacks.map((cb) => {
              const overdue = isOverdue(cb.scheduled_time);
              const due = isDue(cb.scheduled_time);

              return (
                <div
                  key={cb.id}
                  className={`p-3.5 rounded-2xl border transition-all duration-200 ${
                    overdue
                      ? 'bg-rose-950/20 border-rose-800/40 hover:border-rose-700/60'
                      : due
                      ? 'bg-amber-950/20 border-amber-800/40 hover:border-amber-700/60'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100 text-sm">
                          {cb.contact_name || formatE164(cb.phone_number)}
                        </span>
                        {overdue ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            Overdue
                          </span>
                        ) : due ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                            Due Now
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                            Upcoming
                          </span>
                        )}
                      </div>
                      {cb.contact_name && (
                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          {formatE164(cb.phone_number)}
                        </div>
                      )}
                    </div>

                    {cb.status === 'pending' && (
                      <button
                        onClick={() => {
                          onDial(cb.phone_number, cb.lead_id);
                          onClose();
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <span>Dial</span>
                      </button>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{new Date(cb.scheduled_time).toLocaleString()}</span>
                  </div>

                  {cb.notes && (
                    <div className="mt-2 text-xs text-slate-300 bg-slate-950/60 p-2 rounded-xl border border-slate-800/60">
                      {cb.notes}
                    </div>
                  )}

                  {cb.status === 'pending' && (
                    <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                      <button
                        onClick={() => handleUpdateStatus(cb.id, 'dismissed')}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(cb.id, 'completed')}
                        className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                      >
                        ✓ Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
