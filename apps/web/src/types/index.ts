// apps/web/src/types/index.ts
// Re-export shared types + add frontend-specific augmentations

export type {
  Agent,
  AgentStatus,
  Campaign,
  Lead,
  CallLog,
  CallStatus,
  Disposition,
  LeadStatus,
  CampaignStatus,
  ClientState,
  PaginatedResponse,
  UpdateAgentStatusBody,
  DispositionBody,
  ManualCallBody,
  WebrtcTokenResponse,
  TelnyxWebhookEvent,
} from '@nextgendial/shared-types';

// Frontend-only: active call state surfaced by useTelnyxClient
export interface ActiveCall {
  /** The Telnyx SDK call object */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdkCall: any;
  /** Destination number for outbound calls */
  destinationNumber: string | null;
  /** Call log ID for context fetching */
  callLogId: string | null;
  /** lead-leg call_control_id, from client_state */
  leadCallControlId: string | null;
  isMuted: boolean;
  isHeld: boolean;
}
