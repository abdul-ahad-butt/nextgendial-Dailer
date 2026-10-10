import React, { useState } from 'react';
import { X, Coins, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../utils/formatters';

export interface AssignAgentModalProps {
  agent: {
    id: string;
    username?: string;
    name?: string;
    allocated_credits?: number;
    spent_credits?: number;
    assigned_phone_number?: string | null;
  };
  organizationAvailableBalance: number;
  availablePhoneNumbers: Array<{
    phone_number: string;
    friendly_name?: string;
    assigned_agent_id?: string | null;
  }>;
  onClose: () => void;
  onSuccess: () => void;
}

export const AssignAgentModal: React.FC<AssignAgentModalProps> = ({
  agent,
  organizationAvailableBalance,
  availablePhoneNumbers,
  onClose,
  onSuccess,
}) => {
  const [creditAmount, setCreditAmount] = useState<string>('');
  const [selectedPhone, setSelectedPhone] = useState<string>(
    agent.assigned_phone_number || ''
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const agentName = agent.username || agent.name || 'Agent';
  const currentAllocated = agent.allocated_credits ?? 0;
  const currentSpent = agent.spent_credits ?? 0;
  const currentAgentBalance = Math.max(0, currentAllocated - currentSpent);

  const parsedAmount = parseFloat(creditAmount) || 0;
  const isAmountOverBalance = parsedAmount > organizationAvailableBalance;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmount < 0) {
      setError('Credit amount cannot be negative');
      return;
    }

    if (isAmountOverBalance) {
      setError(
        `Amount exceeds available organization credits (${formatCurrency(organizationAvailableBalance)})`
      );
      return;
    }

    try {
      setLoading(true);
      await api.admin.allocateToAgent(
        agent.id,
        parsedAmount,
        selectedPhone ? selectedPhone : null
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to allocate credits and phone number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 relative">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-200 rounded-xl hover:bg-slate-800/60 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Allocate Agent Budget & DID</h3>
            <p className="text-xs text-slate-400">
              Distribute prepaid credits and assign phone lines to{' '}
              <strong className="text-slate-200">{agentName}</strong>
            </p>
          </div>
        </div>

        {/* Balance Overview Pill */}
        <div className="grid grid-cols-2 gap-3 mb-5 p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80">
          <div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
              Agent Current Balance
            </span>
            <span className="text-sm font-bold font-mono text-emerald-400">
              {formatCurrency(currentAgentBalance)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
              Org Available Pool
            </span>
            <span className="text-sm font-bold font-mono text-sky-400">
              {formatCurrency(organizationAvailableBalance)}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Credit Allocation Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Add Calling Credits ($)</span>
              <span className="text-[10px] text-slate-500 font-normal">
                Transferred from org pool
              </span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">
                $
              </span>
              <input
                type="number"
                step="0.50"
                min="0"
                max={Math.max(0, organizationAvailableBalance)}
                placeholder="0.00"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                className={`w-full bg-slate-950/80 border rounded-xl py-2.5 pl-8 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none transition-colors ${
                  isAmountOverBalance
                    ? 'border-rose-500/60 focus:border-rose-500'
                    : 'border-slate-800 focus:border-emerald-500/60'
                }`}
              />
            </div>
            {parsedAmount > 0 && (
              <p className="text-[11px] text-slate-400 mt-1">
                New agent budget after transfer:{' '}
                <strong className="text-emerald-400">
                  {formatCurrency(currentAgentBalance + parsedAmount)}
                </strong>
              </p>
            )}
          </div>

          {/* Phone Line Assignment Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Assigned Outbound Line</span>
              <span className="text-[10px] text-slate-500 font-normal">
                Telnyx Caller ID
              </span>
            </label>
            <div className="relative">
              <select
                value={selectedPhone}
                onChange={(e) => setSelectedPhone(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl py-2.5 px-3 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/60 transition-colors"
              >
                <option value="">— Use Organization Default Line —</option>
                {availablePhoneNumbers.map((p) => {
                  const isAlreadyAssigned =
                    p.assigned_agent_id && p.assigned_agent_id !== agent.id;
                  return (
                    <option key={p.phone_number} value={p.phone_number}>
                      {p.friendly_name || p.phone_number} ({p.phone_number})
                      {isAlreadyAssigned ? ' [In Use]' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700/80 text-slate-300 text-xs font-semibold rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isAmountOverBalance}
              className="flex-1 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Allocating...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Assign & Transfer</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
