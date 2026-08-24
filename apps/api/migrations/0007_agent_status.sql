CREATE TABLE IF NOT EXISTS agent_status (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('available', 'break', 'offline')),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
