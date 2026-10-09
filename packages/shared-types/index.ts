// ============================================================
// Enums / Union Types
// ============================================================

export type UserRole = 'super_admin' | 'admin' | 'agent';

export type AgentStatus =
  | 'offline'
  | 'available'
  | 'dialing'
  | 'on_call'
  | 'wrap_up'
  | 'break'
  | 'deleted';

export type LeadStatus =
  | 'pending'
  | 'calling'
  | 'dialing'
  | 'contacted'
  | 'completed'
  | 'failed'
  | 'dnc';

export type CampaignStatus = 'active' | 'paused' | 'completed';

export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'bridged'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'busy'
  | 'voicemail';

export type CallDirection = 'outbound' | 'inbound';

export type Disposition =
  | 'sale'
  | 'callback'
  | 'not_interested'
  | 'wrong_number'
  | 'voicemail'
  | 'no_answer'
  | 'dnc_request';

export type CreditTransactionType =
  | 'SUPER_ADMIN_GRANT'
  | 'CALL_OUTBOUND'
  | 'SMS_SENT';

export type CallbackStatus = 'pending' | 'completed' | 'dismissed';

// ============================================================
// DB Row Types (mirrors D1 schema exactly)
// ============================================================

export interface Tenant {
  id: string;
  name: string;
  admin_username: string;
  allocated_credits: number;
  spent_credits: number;
  remaining_balance?: number;
  max_agents: number;
  is_active: number;
  created_at: string;
  assigned_numbers?: string[];
  agent_count?: number;
}

export interface SuperAdmin {
  id: string;
  username: string;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  role: UserRole;
  tenant_id: string | null;
  status?: string;
  assigned_phone_number?: string | null;
  telnyx_credential_id?: string | null;
  telnyx_sip_username?: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  username: string;
  email: string;
  tenant_id?: string | null;
  telnyx_credential_id: string | null;
  telnyx_sip_username: string | null;
  status: AgentStatus;
  current_call_log_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  caller_id_number: string;
  dial_ratio: number;
  max_attempts_per_lead: number;
  retry_delay_minutes: number;
  script: string | null;
  tenant_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  campaign_id: string;
  batch_id?: string | null;
  assigned_user_id?: string | null;
  tenant_id?: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string;
  timezone: string | null;
  status: LeadStatus;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  do_not_call: number; // 0 | 1 (SQLite boolean)
  consent_on_file: number; // 0 | 1
  custom_fields: string | null; // JSON blob
  created_at: string;
  updated_at: string | null;
}


export interface CallLog {
  id: string;
  tenant_id?: string | null;
  lead_id: string | null;
  agent_id: string | null;
  campaign_id: string | null;
  telnyx_call_control_id: string | null;
  agent_leg_call_control_id: string | null;
  direction: CallDirection;
  status: CallStatus;
  disposition: Disposition | null;
  disposition_notes: string | null;
  started_at: string | null;
  start_time?: string | null;
  answered_at: string | null;
  ended_at: string | null;
  end_time?: string | null;
  duration_seconds: number | null;
  duration?: number | null;
  hangup_cause: string | null;
  setup_duration_ms: number | null;
  failure_category: string | null;
  recording_url: string | null;
  created_at: string;
}

export interface PhoneInventoryItem {
  phone_number: string;
  friendly_name: string | null;
  telnyx_id: string | null;
  assigned_tenant_id: string | null;
  assigned_tenant_name?: string | null;
  assigned_agent_id: string | null;
  assigned_agent_username?: string | null;
  status: string;
  created_at: string;
}

export interface CreditLedgerEntry {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  amount: number;
  type: CreditTransactionType;
  reference_id: string | null;
  balance_after: number;
  created_at: string;
}

export interface Message {
  id: string;
  tenant_id: string;
  from_number: string;
  to_number: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  agent_id: string | null;
  created_at: string;
}

export interface Callback {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  phone_number: string;
  contact_name: string | null;
  scheduled_time: string;
  assigned_agent_id: string | null;
  assigned_agent_name?: string | null;
  status: CallbackStatus;
  notes: string | null;
  created_at: string;
}

// ============================================================
// Client State (base64-encoded in Telnyx client_state field)
// ============================================================

export interface ClientState {
  leg: 'lead' | 'agent';
  leadId: string;
  agentId: string;
  campaignId: string;
  callLogId: string;
}

// ============================================================
// API Request / Response shapes
// ============================================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SuperAdminStats {
  active_tenants: number;
  total_agents: number;
  live_calls: number;
  total_allocated_credits: number;
  total_spent_credits: number;
  telnyx_balance: number;
  telnyx_currency: string;
}

export interface TelnyxBalanceResponse {
  balance: number;
  currency: string;
  credit_limit: number;
}

export interface CreateTenantBody {
  name: string;
  admin_username: string;
  admin_password: string;
  max_agents?: number;
  initial_credits?: number;
  phone_numbers?: string[];
}

export interface AllocateCreditsBody {
  amount: number;
  notes?: string;
}

export interface AssignNumbersBody {
  tenant_id: string;
  phone_numbers: string[];
}

export interface SendMessageBody {
  to: string;
  from?: string;
  body: string;
}

export interface CreateCallbackBody {
  lead_id?: string;
  phone_number: string;
  contact_name?: string;
  scheduled_time: string;
  assigned_agent_id?: string;
  notes?: string;
}

export interface UpdateAgentStatusBody {
  status: AgentStatus;
}

export interface CreateCampaignBody {
  name: string;
  caller_id_number: string;
  dial_ratio?: number;
  max_attempts_per_lead?: number;
  retry_delay_minutes?: number;
  script?: string;
}

export interface UpdateCampaignBody {
  name?: string;
  status?: CampaignStatus;
  caller_id_number?: string;
  dial_ratio?: number;
  max_attempts_per_lead?: number;
  retry_delay_minutes?: number;
  script?: string;
}

export interface CreateLeadBody {
  campaign_id?: string;
  first_name?: string;
  last_name?: string;
  phone_number: string;
  timezone?: string;
  consent_on_file?: boolean;
  custom_fields?: Record<string, unknown>;
}

export interface BulkCreateLeadsBody {
  leads: CreateLeadBody[];
}

export interface UpdateLeadBody {
  do_not_call?: boolean;
  status?: LeadStatus;
  next_attempt_at?: string;
}

export interface DispositionBody {
  disposition: Disposition;
  notes?: string;
  callback_time?: string;
  callback_notes?: string;
}

export interface ManualCallBody {
  agentId: string;
  phoneNumber: string;
  leadId?: string;
  campaignId?: string;
}

export interface WebrtcTokenResponse {
  token: string;
}

// ============================================================
// Telnyx Webhook Event Types
// ============================================================

export type TelnyxEventType =
  | 'call.initiated'
  | 'call.answered'
  | 'call.hangup'
  | 'call.bridged'
  | 'call.machine.premium.detection.ended'
  | 'call.machine.premium.greeting.ended'
  | 'call.speak.ended'
  | 'call.recording.saved'
  | 'message.received'
  | 'message.sent'
  | 'message.finalized';

export interface TelnyxWebhookEvent {
  data: {
    event_type: TelnyxEventType;
    id: string;
    occurred_at: string;
    payload: TelnyxCallPayload & Record<string, any>;
  };
  meta: {
    attempt: number;
    delivered_to: string;
  };
}

export interface TelnyxCallPayload {
  call_control_id: string;
  call_leg_id: string;
  call_session_id: string;
  client_state?: string;
  connection_id: string;
  direction: 'incoming' | 'outgoing';
  from: string;
  to: string;
  state: string;
  hangup_cause?: string;
  hangup_source?: string;
  result?: 'human' | 'machine' | 'not_sure' | 'silence';
  recording_urls?: { mp3?: string; wav?: string };
}
