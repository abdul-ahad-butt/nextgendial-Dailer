/**
 * apps/web/src/lib/api.ts
 *
 * Typed fetch wrappers for all backend API routes.
 * All functions throw on non-ok responses.
 */

import type {
  Agent,
  AgentStatus,
  Campaign,
  Lead,
  CallLog,
  PaginatedResponse,
  Disposition,
} from '../types';

const envBase = import.meta.env.VITE_API_BASE_URL;
// Ensure that if a base URL is provided, it always includes the /api prefix
export const BASE = envBase ? (envBase.endsWith('/api') ? envBase : `${envBase.replace(/\/$/, '')}/api`) : '/api';


async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      errorMessage = body.error || errorMessage;
    } catch (e) {
      // ignore JSON parse error
    }
    throw new Error(errorMessage);
  }

  return res.json() as Promise<T>;
}

// ── Agents ──────────────────────────────────────────────────

export const api = {
  agent: {
    getCallerId: () =>
      request<{ callerId: string }>('/agent/caller-id').then((r) => r.callerId),
  },

  agents: {
    list: () =>
      request<{ data: Agent[] }>('/agents').then((r) => r.data),

    get: (id: string) =>
      request<{ data: Agent }>(`/agents/${id}`).then((r) => r.data),

    updateStatus: (id: string, status: AgentStatus) =>
      request<{ data: Agent }>(`/agents/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }).then((r) => r.data),

    webrtcToken: (id: string) =>
      request<{ token: string }>(`/agents/${id}/webrtc-token`, {
        method: 'POST',
      }).then((r) => r.token),

    create: (data: { name: string; email: string; telnyx_credential_id?: string; telnyx_sip_username?: string }) =>
      request<{ data: Agent }>('/agents', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then((r) => r.data),
  },

// ── Admin ───────────────────────────────────────────────────

  admin: {
    getAgents: () =>
      request<{ data: any[] }>('/admin/users').then((r) => r.data),

    createAgent: (data: { username: string; password: string }) =>
      request<{ data: any }>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then((r) => r.data),

    uploadLeads: (assigned_user_id: string | null, file_name: string, leads: any[]) =>
      request<{ batch_id: string; inserted: number; skipped: number; errors: string[] }>('/admin/upload-leads', {
        method: 'POST',
        body: JSON.stringify({ assigned_user_id, file_name, leads }),
      }),

    getBatches: () =>
      request<{ data: any[] }>('/admin/batches').then((r) => r.data),

    deleteBatch: (id: string) =>
      request<{ deleted_batch_id: string }>(`/admin/batches/${id}`, {
        method: 'DELETE',
      }),

    getNumbers: () =>
      request<{ data: any[] }>('/admin/numbers').then((r) => r.data),

    assignNumber: (phone_id: string, user_id: string | null) =>
      request<{ success: boolean }>('/admin/numbers/assign', {
        method: 'POST',
        body: JSON.stringify({ phone_id, user_id }),
      }),
  },

  // ── Campaigns ────────────────────────────────────────────

  campaigns: {
    list: () =>
      request<{ data: Campaign[] }>('/campaigns').then((r) => r.data),

    get: (id: string) =>
      request<{ data: Campaign }>(`/campaigns/${id}`).then((r) => r.data),
  },

  // ── Leads ────────────────────────────────────────────────

  leads: {
    list: (params?: { campaign_id?: string; status?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.campaign_id) qs.set('campaign_id', params.campaign_id);
      if (params?.status) qs.set('status', params.status);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      return request<PaginatedResponse<Lead>>(`/leads?${qs}`);
    },
  },

  // ── Calls ────────────────────────────────────────────────

  calls: {
    list: (params?: {
      agent_id?: string;
      campaign_id?: string;
      telnyx_call_control_id?: string;
      page?: number;
      limit?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.agent_id) qs.set('agent_id', params.agent_id);
      if (params?.campaign_id) qs.set('campaign_id', params.campaign_id);
      if (params?.telnyx_call_control_id) qs.set('telnyx_call_control_id', params.telnyx_call_control_id);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      return request<PaginatedResponse<CallLog>>(`/calls?${qs}`);
    },

    get: (id: string) =>
      request<{ data: CallLog }>(`/calls/${id}`).then((r) => r.data),

    getByControlId: (callControlId: string) =>
      request<PaginatedResponse<CallLog>>(
        `/calls?telnyx_call_control_id=${encodeURIComponent(callControlId)}`,
      ).then((r) => r.data[0] ?? null),

    submitDisposition: (id: string, disposition: Disposition, notes?: string) =>
      request<{ success: boolean }>(`/calls/${id}/disposition`, {
        method: 'POST',
        body: JSON.stringify({ disposition, notes }),
      }),

    logManual: (data: {
      agentId: string;
      phoneNumber: string;
      leadId?: string;
      campaignId?: string;
      telnyx_call_control_id?: string;
    }) =>
      request<{ data: CallLog }>('/calls/manual', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then((r) => r.data),

    hangup: (id: string) =>
      request<{ success: boolean }>(`/calls/${id}/hangup`, { method: 'POST' }),

    outbound: (to: string) =>
      request<{ success: boolean; data: any }>('/calls/outbound', {
        method: 'POST',
        body: JSON.stringify({ to }),
      }),
  },
};
