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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, AgentStatus } from '../types';
import { api } from '../lib/api';

const POLL_INTERVAL_MS = 4000;

interface UseAgentStatusResult {
  agent: Agent | null;
  loading: boolean;
  error: string | null;
  setStatus: (status: AgentStatus) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useAgentStatus(agentId: string | null): UseAgentStatusResult {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAgent = useCallback(async () => {
    if (!agentId) return;
    try {
      const data = await api.agents.get(agentId);
      setAgent(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agent');
    }
  }, [agentId]);

  // Initial fetch
  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchAgent().finally(() => setLoading(false));
  }, [agentId, fetchAgent]);

  // Polling
  useEffect(() => {
    if (!agentId) return;

    intervalRef.current = setInterval(fetchAgent, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [agentId, fetchAgent]);

  const setStatus = useCallback(
    async (status: AgentStatus) => {
      if (!agentId) return;
      try {
        const updated = await api.agents.updateStatus(agentId, status);
        setAgent(updated);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update status');
        throw err; // re-throw so UI can handle
      }
    },
    [agentId],
  );

  return { agent, loading, error, setStatus, refetch: fetchAgent };
}
