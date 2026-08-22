-- ============================================================
-- NextGenDial Auto-Dialer — Initial Schema
-- Migration: 0001_init_schema
-- ============================================================

-- ============================================
-- Agents
-- ============================================
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telnyx_credential_id TEXT,        -- Telnyx Telephony Credential resource ID (mints login JWTs)
  telnyx_sip_username TEXT,         -- SIP username; bridge target is sip:{username}@sip.telnyx.com
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('offline','available','dialing','on_call','wrap_up','break')),
  current_call_log_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Campaigns
-- ============================================
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused'
    CHECK (status IN ('active','paused','completed')),
  caller_id_number TEXT NOT NULL,       -- E.164 Telnyx number for this campaign
  dial_ratio REAL NOT NULL DEFAULT 1.0, -- reserved for a future predictive-dialer phase
  max_attempts_per_lead INTEGER NOT NULL DEFAULT 3,
  retry_delay_minutes INTEGER NOT NULL DEFAULT 60,
  script TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Leads
-- ============================================
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT NOT NULL,           -- E.164, e.g. +923001234567
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dialing','contacted','completed','failed','dnc')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  do_not_call INTEGER NOT NULL DEFAULT 0,     -- compliance gate, checked before every dial
  consent_on_file INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT,                         -- JSON blob for campaign-specific fields
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_leads_dialable ON leads(campaign_id, status, do_not_call, next_attempt_at);
CREATE INDEX idx_leads_phone ON leads(phone_number);

-- ============================================
-- Call Logs
-- ============================================
CREATE TABLE call_logs (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  telnyx_call_control_id TEXT UNIQUE,         -- lead leg's call_control_id; primary webhook correlation key
  agent_leg_call_control_id TEXT,             -- second leg dialed to the agent's WebRTC session
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','ringing','answered','bridged','completed','failed','no_answer','busy','voicemail')),
  disposition TEXT,             -- sale, callback, not_interested, wrong_number, voicemail, no_answer, dnc_request
  disposition_notes TEXT,
  started_at TEXT,
  answered_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  hangup_cause TEXT,            -- raw Telnyx hangup_cause from the call.hangup webhook
  recording_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_call_logs_agent ON call_logs(agent_id);
CREATE INDEX idx_call_logs_campaign ON call_logs(campaign_id);
CREATE INDEX idx_call_logs_ccid ON call_logs(telnyx_call_control_id);
CREATE INDEX idx_call_logs_agent_ccid ON call_logs(agent_leg_call_control_id);
