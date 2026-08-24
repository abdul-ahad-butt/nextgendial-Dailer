-- Migration number: 0005 	 2026-08-23T21:01:00Z
-- Add missing timestamp and duration columns to call_logs table

ALTER TABLE call_logs ADD COLUMN start_time TEXT DEFAULT (datetime('now'));
ALTER TABLE call_logs ADD COLUMN end_time TEXT;
ALTER TABLE call_logs ADD COLUMN duration INTEGER;
