-- Migration number: 0016
-- Agent Credits, Assigned Numbers, and Leads/Batches Scoping

-- 1. Agent Credits and Phone Lines on agents table
ALTER TABLE agents ADD COLUMN allocated_credits REAL DEFAULT 0.00;
ALTER TABLE agents ADD COLUMN spent_credits REAL DEFAULT 0.00;
ALTER TABLE agents ADD COLUMN assigned_phone_number TEXT;
ALTER TABLE agents ADD COLUMN current_call_id TEXT;
ALTER TABLE agents ADD COLUMN total_calls INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN total_talk_time_seconds INTEGER DEFAULT 0;

-- 2. Agent Credits and Phone Lines on users table
ALTER TABLE users ADD COLUMN allocated_credits REAL DEFAULT 0.00;
ALTER TABLE users ADD COLUMN spent_credits REAL DEFAULT 0.00;
ALTER TABLE users ADD COLUMN assigned_phone_number TEXT;

-- 3. Ensure leads table exists with tenant and assignment references
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  batch_id TEXT,
  phone_number TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status TEXT DEFAULT 'pending',
  assigned_user_id TEXT REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Ensure lead_batches table exists
CREATE TABLE IF NOT EXISTS lead_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  file_name TEXT NOT NULL,
  total_leads INTEGER DEFAULT 0,
  processed_leads INTEGER DEFAULT 0,
  assigned_user_id TEXT,
  assignment_mode TEXT DEFAULT 'assigned',
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Ensure call_recordings table exists
CREATE TABLE IF NOT EXISTS call_recordings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agent_id TEXT REFERENCES users(id),
  call_control_id TEXT,
  call_log_id TEXT,
  agent_username TEXT,
  destination_number TEXT,
  direction TEXT DEFAULT 'outbound',
  duration_seconds INTEGER DEFAULT 0,
  r2_key TEXT,
  recording_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_batch ON leads(tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON lead_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recordings_tenant ON call_recordings(tenant_id);
