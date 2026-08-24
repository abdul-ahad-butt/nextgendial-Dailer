/**
 * apps/web/src/hooks/useAgentStatus.ts
 *
 * Polls GET /api/agents/:id every 4 seconds and exposes a setStatus()
 * function that PATCHes /api/agents/:id/status.
 *
 * Polling note: Workers + D1 has no built-in push mechanism. This is
 * an intentional MVP choice — a future Durable Objects / WebSocket
 * upgrade would eliminate the polling entirely.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AgentStatus } from '../types';
import { api } from '../lib/api';

interface UseAgentStatusResult {
  currentStatus: AgentStatus;
  changedAt: string | null;
  loading: boolean;
  error: string | null;
  setStatus: (status: AgentStatus) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useAgentStatus(): UseAgentStatusResult {
  const [currentStatus, setCurrentStatus] = useState<AgentStatus>('offline');
  const [changedAt, setChangedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.agent.status();
      setCurrentStatus(data.status);
      setChangedAt(data.changed_at);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    }
  }, []);

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const setStatus = useCallback(async (status: AgentStatus) => {
    try {
      await api.agent.setStatus(status);
      setCurrentStatus(status);
      setChangedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
      throw err;
    }
  }, []);

  return { currentStatus, changedAt, loading, error, setStatus, refetch: fetchStatus };
}

