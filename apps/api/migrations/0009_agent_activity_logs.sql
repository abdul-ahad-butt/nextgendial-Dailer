-- ============================================
-- Migration: 0009_agent_activity_logs
-- ============================================

CREATE TABLE IF NOT EXISTS agent_activity_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  total_active_seconds INTEGER DEFAULT 0,
  total_break_seconds INTEGER DEFAULT 0,
  total_calls_made INTEGER DEFAULT 0,
  total_talk_time_seconds INTEGER DEFAULT 0,
  date TEXT NOT NULL DEFAULT (date('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_activity_logs_agent_date 
  ON agent_activity_logs(agent_id, date);
