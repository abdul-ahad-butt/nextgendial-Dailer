-- ============================================
-- Migration: 0013_sticky_routing_and_recording_r2
-- ============================================

-- Sticky callback routing: tracks which agent last called each number
-- from which system number. Used for inbound call routing (callbacks).
CREATE TABLE IF NOT EXISTS outbound_call_map (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_number TEXT NOT NULL,     -- system/agent number the call went out FROM
  to_number TEXT NOT NULL,       -- the lead/customer number that was dialed
  last_call_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_number, to_number) -- one record per (from, to) pair; upserted on each call
);

CREATE INDEX IF NOT EXISTS idx_ocm_to_number ON outbound_call_map(to_number, from_number);
CREATE INDEX IF NOT EXISTS idx_ocm_agent_id ON outbound_call_map(agent_id);

-- Add R2 storage key to call_recordings (durable storage reference)
ALTER TABLE call_recordings ADD COLUMN r2_key TEXT;
ALTER TABLE call_recordings ADD COLUMN direction TEXT DEFAULT 'outbound';
ALTER TABLE call_recordings ADD COLUMN call_log_id TEXT REFERENCES call_logs(id) ON DELETE SET NULL;
