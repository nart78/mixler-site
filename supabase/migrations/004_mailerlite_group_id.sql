-- Add MailerLite group ID column to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS mailerlite_group_id TEXT;

COMMENT ON COLUMN events.mailerlite_group_id IS 'MailerLite group ID for event-specific subscriber list, auto-created on event creation';
