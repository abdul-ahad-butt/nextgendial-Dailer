-- Migration: 0017_strict_ledger_two_way_credits.sql
-- Implements strict ledger, available/distributed credits on tenants, balance_credits on agents and users, and credit_transfers audit table.

-- 1. Tenants table: available_credits and distributed_credits
ALTER TABLE tenants ADD COLUMN available_credits REAL DEFAULT 0.00;
ALTER TABLE tenants ADD COLUMN distributed_credits REAL DEFAULT 0.00;

-- 2. Agents & Users table: balance_credits
ALTER TABLE agents ADD COLUMN balance_credits REAL DEFAULT 0.00;
ALTER TABLE users ADD COLUMN balance_credits REAL DEFAULT 0.00;

-- 3. Initial sync for existing data
-- Set agent balance_credits to allocated_credits - spent_credits
UPDATE agents 
SET balance_credits = MAX(0.00, COALESCE(allocated_credits, 0.00) - COALESCE(spent_credits, 0.00))
WHERE balance_credits IS NULL OR balance_credits = 0.00;

UPDATE users 
SET balance_credits = MAX(0.00, COALESCE(allocated_credits, 0.00) - COALESCE(spent_credits, 0.00))
WHERE role = 'agent' AND (balance_credits IS NULL OR balance_credits = 0.00);

-- Sync tenants: distributed_credits = sum of allocated_credits of assigned agents
UPDATE tenants 
SET distributed_credits = COALESCE((
  SELECT SUM(allocated_credits) 
  FROM users 
  WHERE users.tenant_id = tenants.id AND users.role = 'agent' AND COALESCE(users.status, 'offline') != 'deleted'
), 0.00)
WHERE distributed_credits IS NULL OR distributed_credits = 0.00;

-- Set available_credits = allocated_credits - spent_credits - distributed_credits
UPDATE tenants 
SET available_credits = MAX(0.00, COALESCE(allocated_credits, 0.00) - COALESCE(spent_credits, 0.00) - COALESCE(distributed_credits, 0.00))
WHERE available_credits IS NULL OR available_credits = 0.00;

-- 4. Credit Transfers Audit Ledger
CREATE TABLE IF NOT EXISTS credit_transfers (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,  -- 'SUPER_ADMIN', 'TENANT', 'AGENT'
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,    -- 'TENANT', 'AGENT'
  to_id TEXT NOT NULL,
  amount REAL NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_transfers_from ON credit_transfers(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_credit_transfers_to ON credit_transfers(to_type, to_id);
CREATE INDEX IF NOT EXISTS idx_credit_transfers_created_at ON credit_transfers(created_at);
