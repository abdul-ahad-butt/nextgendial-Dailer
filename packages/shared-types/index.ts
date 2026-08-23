// ============================================================
// Enums / Union Types
// ============================================================

export type AgentStatus =
  | 'offline'
  | 'available'
  | 'dialing'
  | 'on_call'
  | 'wrap_up'
  | 'break';

export type LeadStatus =
  | 'pending'
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

// ============================================================
// DB Row Types (mirrors D1 schema exactly)
// ============================================================

export interface Agent {
  id: string;
  username: string;
  email: string;
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
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  campaign_id: string;
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
  updated_at: string;
}

export interface CallLog {
  id: string;
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
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  hangup_cause: string | null;
  recording_url: string | null;
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
  campaign_id: string;
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
  | 'call.recording.saved';

export interface TelnyxWebhookEvent {
  data: {
    event_type: TelnyxEventType;
    id: string;
    occurred_at: string;
    payload: TelnyxCallPayload;
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
  // For hangup
  hangup_cause?: string;
  hangup_source?: string;
  // For AMD
  result?: 'human' | 'machine' | 'not_sure' | 'silence';
  // For recording
  recording_urls?: { mp3?: string; wav?: string };
}
