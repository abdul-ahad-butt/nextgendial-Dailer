import React from 'react';
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';

export interface ZeroCreditBannerProps {
  type: 'organization' | 'agent';
  balance?: number;
  onRequestCredits?: () => void;
  onRefresh?: () => void;
  className?: string;
}

export const ZeroCreditBanner: React.FC<ZeroCreditBannerProps> = ({
  type,
  balance = 0,
  onRequestCredits,
  onRefresh,
  className = '',
}) => {
  const formattedBalance = `$${Number(balance || 0).toFixed(2)}`;

  if (type === 'organization') {
    return (
      <div
        className={`p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-rose-300 shadow-lg animate-fade-in ${className}`}
        role="alert"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <p className="font-semibold text-sm">
              Organization Out of Credits ({formattedBalance})
            </p>
            <p className="text-xs text-rose-400/80">
              All agent outbound calls are suspended. Please contact Super Admin to refill credits.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={
            onRequestCredits ||
            (() => {
              alert(
                'Please contact your Super Administrator at support@nextgendial.com to refill calling credits.'
              );
            })
          }
          className="px-3.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold rounded-xl border border-rose-500/40 transition-all hover:scale-105 active:scale-95 shrink-0"
        >
          Request Credits
        </button>
      </div>
    );
  }

  // Agent Out-of-Credit Lockout Banner
  return (
    <div
      className={`p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-amber-300 shadow-lg animate-fade-in ${className}`}
      role="alert"
    >
      <div className="flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
        <div>
          <p className="font-semibold text-sm">
            Out of Calling Credits ({formattedBalance})
          </p>
          <p className="text-xs text-amber-400/80">
            Outbound dialing is disabled. Please contact your administrator to assign credits.
          </p>
        </div>
      </div>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold rounded-xl border border-amber-500/40 transition-all hover:scale-105 active:scale-95 shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      )}
    </div>
  );
};
