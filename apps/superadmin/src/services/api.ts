/**
 * apps/superadmin/src/services/api.ts
 *
 * Super Admin API client communicating with nextgendial-api worker.
 */

const envBase = import.meta.env.VITE_API_BASE_URL;
export const BASE = envBase
  ? (envBase.endsWith('/api') ? envBase : `${envBase.replace(/\/$/, '')}/api`)
  : '/api';

export interface SuperAdminTokenUser {
  id: string;
  username: string;
  role: 'super_admin';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('super_admin_token');
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
    if (res.status === 401) {
      localStorage.removeItem('super_admin_token');
      window.location.href = '/login';
      throw new Error('Unauthorized: Super Admin session expired');
    }

    let errorMessage = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      errorMessage = body.error || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }

  return res.json() as Promise<T>;
}

export const superApi = {
  auth: {
    login: (credentials: { username: string; password: string }) =>
      request<{
        success: boolean;
        token: string;
        user: { id: string; username: string; role: string };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      }),
  },

  telnyx: {
    getBalance: () =>
      request<{
        balance: number;
        currency: string;
        credit_limit: number;
      }>('/super/telnyx/balance'),

    getNumbers: () =>
      request<{
        data: Array<{
          phone_number: string;
          friendly_name: string;
          telnyx_id: string;
          assigned_tenant_id: string | null;
          assigned_tenant_name?: string | null;
          status: string;
          created_at: string;
        }>;
      }>('/super/telnyx/numbers').then((r) => r.data),

    syncNumbers: () =>
      request<{
        success: boolean;
        synced: number;
        numbers: any[];
      }>('/super/telnyx/sync-numbers', {
        method: 'POST',
      }),
  },

  tenants: {
    list: () =>
      request<{
        data: Array<{
          id: string;
          name: string;
          admin_username: string;
          allocated_credits: number;
          spent_credits: number;
          remaining_credits: number;
          max_agents: number;
          is_active: number;
          created_at: string;
          agent_count: number;
          number_count: number;
        }>;
      }>('/super/tenants').then((r) => r.data),

    create: (data: {
      name: string;
      admin_username: string;
      admin_password: string;
      allocated_credits?: number;
      max_agents?: number;
    }) =>
      request<{ success: boolean; data: any }>('/super/tenants', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (
      id: string,
      data: {
        name?: string;
        max_agents?: number;
        is_active?: number;
      }
    ) =>
      request<{ success: boolean; data: any }>(`/super/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    grantCredits: (
      id: string,
      data: {
        amount: number;
        notes?: string;
      }
    ) =>
      request<{
        success: boolean;
        allocated_credits: number;
        spent_credits: number;
        remaining_balance: number;
      }>(`/super/tenants/${id}/credits`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  numbers: {
    allocate: (data: {
      phone_number: string;
      tenant_id: string | null;
      agent_id?: string | null;
    }) =>
      request<{ success: boolean; data: any }>('/super/numbers/allocate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  ledger: {
    list: (params?: { tenant_id?: string; type?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.tenant_id) qs.set('tenant_id', params.tenant_id);
      if (params?.type) qs.set('type', params.type);
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString();
      return request<{
        data: Array<{
          id: string;
          tenant_id: string;
          tenant_name: string;
          amount: number;
          type: string;
          reference_id?: string | null;
          balance_after: number;
          created_at: string;
        }>;
      }>(`/super/ledger${query ? `?${query}` : ''}`).then((r) => r.data);
    },
  },

  stats: {
    getOverview: () =>
      request<{
        total_tenants: number;
        active_tenants: number;
        total_agents: number;
        total_numbers: number;
        total_credits_allocated: number;
        total_credits_spent: number;
      }>('/super/stats'),
  },
};
