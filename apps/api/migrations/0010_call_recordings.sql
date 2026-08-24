-- ============================================
-- Migration: 0010_call_recordings
-- ============================================

CREATE TABLE IF NOT EXISTS call_recordings (
  id TEXT PRIMARY KEY,
  call_control_id TEXT,
  agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  agent_username TEXT,
  destination_number TEXT,
  duration_seconds INTEGER,
  recording_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_agent_id ON call_recordings(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_recordings_call_control_id ON call_recordings(call_control_id);
