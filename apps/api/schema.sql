-- NextGenDial Enterprise Database Schema
-- Multi-Tenant Telephony Platform with Super Admin, Phone Inventory, Credit Ledger, Messaging & Callbacks

-- 1. Organizations / Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin_username TEXT UNIQUE NOT NULL,
  admin_password_hash TEXT NOT NULL,
  allocated_credits REAL DEFAULT 0.00,
  spent_credits REAL DEFAULT 0.00,
  max_agents INTEGER DEFAULT 5,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Super Admin Credentials Table
CREATE TABLE IF NOT EXISTS super_admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Users Table (Authentication & Accounts)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'agent')),
  tenant_id TEXT REFERENCES tenants(id),
  status TEXT DEFAULT 'offline',
  assigned_phone_number TEXT,
  telnyx_credential_id TEXT,
  telnyx_sip_username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Agents Table (Operational State)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  tenant_id TEXT REFERENCES tenants(id),
  telnyx_credential_id TEXT,
  telnyx_sip_username TEXT,
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('offline','available','dialing','on_call','wrap_up','break','deleted')),
  current_call_log_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Campaigns Table
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused'
    CHECK (status IN ('active','paused','completed')),
  caller_id_number TEXT NOT NULL,
  dial_ratio REAL NOT NULL DEFAULT 1.0,
  max_attempts_per_lead INTEGER NOT NULL DEFAULT 3,
  retry_delay_minutes INTEGER NOT NULL DEFAULT 60,
  script TEXT,
  tenant_id TEXT REFERENCES tenants(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Leads & Batches
CREATE TABLE IF NOT EXISTS lead_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  total_leads INTEGER NOT NULL DEFAULT 0,
  assigned_user_id TEXT REFERENCES users(id),
  tenant_id TEXT REFERENCES tenants(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  assignment_mode TEXT NOT NULL DEFAULT 'assigned' CHECK (assignment_mode IN ('assigned', 'pool'))
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES lead_batches(id),
  assigned_user_id TEXT REFERENCES users(id),
  tenant_id TEXT REFERENCES tenants(id),
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT NOT NULL,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','calling','dialing','contacted','completed','failed','dnc')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  do_not_call INTEGER NOT NULL DEFAULT 0,
  consent_on_file INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 7. Call Logs Table
CREATE TABLE IF NOT EXISTS call_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  telnyx_call_control_id TEXT UNIQUE,
  agent_leg_call_control_id TEXT,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  status TEXT NOT NULL DEFAULT 'initiated',
  disposition TEXT,
  disposition_notes TEXT,
  started_at TEXT,
  start_time TEXT DEFAULT (datetime('now')),
  answered_at TEXT,
  ended_at TEXT,
  end_time TEXT,
  duration_seconds INTEGER,
  duration INTEGER,
  hangup_cause TEXT,
  setup_duration_ms INTEGER,
  failure_category TEXT,
  recording_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Global Phone Number Inventory
CREATE TABLE IF NOT EXISTS phone_inventory (
  phone_number TEXT PRIMARY KEY,
  friendly_name TEXT,
  telnyx_id TEXT,
  assigned_tenant_id TEXT REFERENCES tenants(id),
  assigned_agent_id TEXT REFERENCES agents(id),
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. Audit & Credit Ledger
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  amount REAL NOT NULL,
  type TEXT NOT NULL, -- 'SUPER_ADMIN_GRANT', 'CALL_OUTBOUND', 'SMS_SENT'
  reference_id TEXT,
  balance_after REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. Messages (Inbound / Outbound SMS)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'inbound', 'outbound'
  body TEXT NOT NULL,
  status TEXT DEFAULT 'received',
  agent_id TEXT REFERENCES agents(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. Callbacks Queue
CREATE TABLE IF NOT EXISTS callbacks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id TEXT,
  phone_number TEXT NOT NULL,
  contact_name TEXT,
  scheduled_time DATETIME NOT NULL,
  assigned_agent_id TEXT REFERENCES agents(id),
  status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'dismissed'
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
