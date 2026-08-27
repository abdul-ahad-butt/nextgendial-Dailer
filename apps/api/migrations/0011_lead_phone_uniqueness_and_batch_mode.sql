-- ============================================================
-- Migration: 0011_lead_phone_uniqueness_and_batch_mode
--
-- 1. Add assignment_mode to lead_batches
--    'assigned'  → leads are locked to the assigned agent only
--    'pool'      → any available agent can pull these leads
--
-- 2. Add a UNIQUE constraint on leads.phone_number so the upload
--    endpoint can use INSERT OR IGNORE to skip true duplicates.
--    We rebuild the table because SQLite doesn't support ADD UNIQUE.
-- ============================================================

-- Step 1: add assignment_mode to lead_batches (safe ALTER)
ALTER TABLE lead_batches ADD COLUMN assignment_mode TEXT NOT NULL DEFAULT 'assigned'
  CHECK (assignment_mode IN ('assigned', 'pool'));

-- Step 2: rebuild leads with UNIQUE phone_number
-- (SQLite doesn't allow ALTER TABLE ADD UNIQUE on an existing column)
CREATE TABLE leads_new (
  id                TEXT PRIMARY KEY,
  assigned_user_id  TEXT REFERENCES users(id),
  batch_id          TEXT REFERENCES lead_batches(id),
  phone_number      TEXT NOT NULL UNIQUE,           -- deduplicate globally
  first_name        TEXT,
  last_name         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','calling','completed','failed')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT
);

-- Copy existing data (any pre-existing duplicate phones: keep first row per phone)
INSERT OR IGNORE INTO leads_new
  (id, assigned_user_id, batch_id, phone_number, first_name, last_name, status, created_at, updated_at)
SELECT id, assigned_user_id, batch_id, phone_number, first_name, last_name, status, created_at, updated_at
FROM leads;

DROP TABLE leads;
ALTER TABLE leads_new RENAME TO leads;

-- Recreate indexes
CREATE INDEX idx_leads_assigned_status ON leads(assigned_user_id, status);
CREATE INDEX idx_leads_batch_id         ON leads(batch_id);
CREATE INDEX idx_leads_phone            ON leads(phone_number);
