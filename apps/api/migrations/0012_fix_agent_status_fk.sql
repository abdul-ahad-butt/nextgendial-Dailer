-- ============================================================
-- Migration: 0012_fix_agent_status_fk
-- 
-- Problem: agent_status.user_id references users(id) with the
-- default ON DELETE RESTRICT behaviour (SQLite default).  When
-- auth.ts ran `INSERT OR REPLACE INTO users` the engine would
-- DELETE the old users row first, which caused:
--   SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed
-- because agent_status still referenced the deleted row.
--
-- Fix: Recreate agent_status with ON DELETE CASCADE so that if
-- a user row is ever deleted or replaced, the child row is
-- automatically removed rather than raising a constraint error.
-- ============================================================

-- 1. Preserve existing rows
CREATE TABLE IF NOT EXISTS agent_status_backup AS
  SELECT * FROM agent_status;

-- 2. Drop the old table (drops the old FK definition too)
DROP TABLE IF EXISTS agent_status;

-- 3. Recreate with ON DELETE CASCADE
CREATE TABLE agent_status (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'offline'
               CHECK (status IN ('available', 'break', 'offline', 'dialing', 'on_call', 'wrap_up')),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Restore rows that still have a parent in users
INSERT INTO agent_status (user_id, status, changed_at)
  SELECT b.user_id, b.status, b.changed_at
  FROM agent_status_backup b
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = b.user_id);

-- 5. Clean up backup
DROP TABLE IF EXISTS agent_status_backup;
