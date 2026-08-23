-- Phone Numbers Inventory
CREATE TABLE IF NOT EXISTS phone_numbers (
    id TEXT PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL, -- e.g., '+19564461280'
    friendly_name TEXT,
    telnyx_connection_id TEXT,
    assigned_to_user_id TEXT REFERENCES users(id),
    status TEXT DEFAULT 'active', -- 'active', 'unassigned', 'reserved'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add assigned_phone_number to users table if not exists
-- (SQLite ALTER TABLE ADD COLUMN supports DEFAULT)
ALTER TABLE users ADD COLUMN assigned_phone_number TEXT DEFAULT '+19564461280';

-- Seed default purchased Telnyx number
INSERT OR IGNORE INTO phone_numbers (id, phone_number, friendly_name, status)
VALUES ('num_default_01', '+19564461280', 'Main Outbound Line', 'active');
