-- Migration number: 0015
-- Enterprise Multi-Tenant Hierarchy, Phone Inventory, Credit Ledger, Messaging, and Callbacks

-- 1. Organizations / Tenants
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

-- 2. Super Admin Credentials
CREATE TABLE IF NOT EXISTS super_admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Scope Agents and Users to Tenant
-- (SQLite supports ADD COLUMN)
ALTER TABLE agents ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE leads ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE call_logs ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

-- 4. Global Phone Number Inventory
CREATE TABLE IF NOT EXISTS phone_inventory (
  phone_number TEXT PRIMARY KEY,
  friendly_name TEXT,
  telnyx_id TEXT,
  assigned_tenant_id TEXT REFERENCES tenants(id),
  assigned_agent_id TEXT REFERENCES agents(id),
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Audit & Credit Ledger
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  amount REAL NOT NULL, -- Positive for allocation, negative for call deduction
  type TEXT NOT NULL,   -- 'SUPER_ADMIN_GRANT', 'CALL_OUTBOUND', 'SMS_SENT'
  reference_id TEXT,    -- call_id or transaction_id
  balance_after REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Inbound & Outbound SMS Messages
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

-- 7. Callbacks Queue
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

CREATE INDEX IF NOT EXISTS idx_tenants_admin_user ON tenants(admin_username);
CREATE INDEX IF NOT EXISTS idx_phone_inv_tenant ON phone_inventory(assigned_tenant_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tenant ON credit_ledger(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_callbacks_tenant_sched ON callbacks(tenant_id, scheduled_time, status);
