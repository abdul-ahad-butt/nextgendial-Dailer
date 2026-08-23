CREATE TABLE IF NOT EXISTS phone_numbers (
    id TEXT PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL,
    friendly_name TEXT,
    assigned_to_user_id TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO phone_numbers (id, phone_number, friendly_name, status)
VALUES ('num_default_01', '+19564461280', 'Main Outbound Line', 'active');
