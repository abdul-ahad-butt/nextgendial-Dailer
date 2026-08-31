-- Migration number: 0014
-- Purpose: Add setup_duration_ms and failure_category to call_logs for smarter diagnostics.

ALTER TABLE call_logs ADD COLUMN setup_duration_ms INTEGER;
ALTER TABLE call_logs ADD COLUMN failure_category TEXT;
