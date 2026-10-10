import React, { useState } from 'react';
import { X, ArrowDownLeft, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../utils/formatters';

export interface ReclaimCreditModalProps {
  agent: {
    id: string;
    username?: string;
    name?: string;
    balance_credits?: number;
    allocated_credits?: number;
    spent_credits?: number;
  };
  organizationAvailableBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}

export const ReclaimCreditModal: React.FC<ReclaimCreditModalProps> = ({
  agent,
  organizationAvailableBalance,
  onClose,
  onSuccess,
}) => {
  const agentName = agent.username || agent.name || 'Agent';
  const currentAgentBalance = Number(
    agent.balance_credits !== undefined && agent.balance_credits !== null
      ? agent.balance_credits
      : Math.max(0, (agent.allocated_credits || 0) - (agent.spent_credits || 0))
  );

  const [reclaimAmount, setReclaimAmount] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(reclaimAmount) || 0;
  const isAmountOverBalance = parsedAmount > currentAgentBalance;

  const handleQuickSelect = (amt: number) => {
    const capped = Math.min(amt, currentAgentBalance);
    setReclaimAmount(capped.toFixed(2));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmount <= 0) {
      setError('Reclaim amount must be greater than $0.00');
      return;
    }

    if (isAmountOverBalance) {
      setError(
        `Amount exceeds agent available balance (${formatCurrency(currentAgentBalance)})`
      );
      return;
    }

    try {
      setLoading(true);
      await api.admin.reclaimFromAgent(agent.id, parsedAmount);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reclaim credits from agent.');
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
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <ArrowDownLeft className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Reclaim Agent Credits</h3>
            <p className="text-xs text-slate-400">
              Return unused funds from{' '}
              <strong className="text-slate-200">{agentName}</strong> back to organization pool
            </p>
          </div>
        </div>

        {/* Balance Overview Pill */}
        <div className="grid grid-cols-2 gap-3 mb-5 p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80">
          <div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
              Agent Balance
            </span>
            <span className="text-sm font-bold font-mono text-amber-400">
              {formatCurrency(currentAgentBalance)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">
              Org Available Pool
            </span>
            <span className="text-sm font-bold font-mono text-emerald-400">
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
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Reclaim Amount ($ USD)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={currentAgentBalance}
                value={reclaimAmount}
                onChange={(e) => {
                  setReclaimAmount(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                required
                className="w-full bg-slate-950 border border-slate-700/80 rounded-2xl py-2.5 pl-8 pr-4 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>
          </div>

          {/* Quick Selection Chips */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-500">Quick:</span>
            {[5, 10, 20].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => handleQuickSelect(amt)}
                disabled={currentAgentBalance < amt}
                className="px-2.5 py-1 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 text-slate-300 font-mono transition-colors"
              >
                +${amt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleQuickSelect(currentAgentBalance)}
              disabled={currentAgentBalance <= 0}
              className="px-2.5 py-1 text-xs rounded-xl bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 text-amber-300 font-mono border border-amber-500/20 transition-colors ml-auto"
            >
              All ({formatCurrency(currentAgentBalance)})
            </button>
          </div>

          {parsedAmount > 0 && !isAmountOverBalance && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-slate-300 text-xs space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Agent balance after:</span>
                <span className="text-amber-300 font-bold">
                  {formatCurrency(Math.max(0, currentAgentBalance - parsedAmount))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Org pool after:</span>
                <span className="text-emerald-300 font-bold">
                  {formatCurrency(organizationAvailableBalance + parsedAmount)}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || parsedAmount <= 0 || isAmountOverBalance}
              className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Reclaiming...</span>
                </>
              ) : (
                <span>Reclaim {formatCurrency(parsedAmount)}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
