-- ============================================
-- Migration: 0003_lead_batches
-- ============================================

-- 1. Create lead_batches table
CREATE TABLE lead_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  total_leads INTEGER NOT NULL DEFAULT 0,
  assigned_user_id TEXT REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Rebuild leads table to allow nullable assigned_user_id and add batch_id
CREATE TABLE leads_new (
  id TEXT PRIMARY KEY,
  assigned_user_id TEXT REFERENCES users(id),
  batch_id TEXT REFERENCES lead_batches(id),
  phone_number TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','calling','completed','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- 3. Copy existing data to the new table
INSERT INTO leads_new (id, assigned_user_id, phone_number, first_name, last_name, status, created_at, updated_at)
SELECT id, assigned_user_id, phone_number, first_name, last_name, status, created_at, updated_at
FROM leads;

-- 4. Replace old table
DROP TABLE leads;
ALTER TABLE leads_new RENAME TO leads;

-- 5. Recreate indexes
CREATE INDEX idx_leads_assigned_status ON leads(assigned_user_id, status);
CREATE INDEX idx_leads_batch_id ON leads(batch_id);
