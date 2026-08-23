DROP TABLE IF EXISTS leads;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','agent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  assigned_user_id TEXT NOT NULL REFERENCES users(id),
  phone_number TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','calling','completed','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX idx_leads_assigned_status ON leads(assigned_user_id, status);
