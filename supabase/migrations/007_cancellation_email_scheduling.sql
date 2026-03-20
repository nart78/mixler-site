-- Migration 007: Add cancellation email scheduling fields to events.
--
-- When an admin cancels an event, cancellation_scheduled_at is set to NOW().
-- A cron job checks every 5 minutes for events where 15 minutes have passed
-- and cancellation_email_sent is still false. If the event is re-published
-- before 15 minutes elapse, cancellation_scheduled_at is cleared and no
-- email goes out.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cancellation_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_email_sent BOOLEAN NOT NULL DEFAULT false;
