-- Phone Numbers Inventory (SQLite Migration)
CREATE TABLE IF NOT EXISTS phone_numbers (
    id TEXT PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL, -- e.g., '+19564461280'
    friendly_name TEXT,
    telnyx_connection_id TEXT,
    assigned_to_user_id TEXT REFERENCES users(id),
    status TEXT DEFAULT 'active', -- 'active', 'unassigned', 'reserved'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add assigned_phone_number to users table
-- ALTER TABLE users ADD assigned_phone_number TEXT DEFAULT '+19564461280';

-- Seed default purchased Telnyx number
-- INSERT INTO phone_numbers (id, phone_number, friendly_name, status)
-- VALUES ('num_default_01', '+19564461280', 'Main Outbound Line', 'active');
