-- Activity waitlist: stores email signups per activity for demand analytics
-- activity_waitlist_groups: stores MailerLite group IDs per activity (idempotent group creation)

CREATE TABLE IF NOT EXISTS activity_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  activity_slug TEXT NOT NULL,
  activity_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_waitlist_slug ON activity_waitlist(activity_slug);
CREATE INDEX IF NOT EXISTS idx_activity_waitlist_email ON activity_waitlist(email);

-- Allow duplicate email+slug (user may sign up again after months)
-- No unique constraint intentionally -- dedup at query time if needed.

CREATE TABLE IF NOT EXISTS activity_waitlist_groups (
  activity_slug TEXT PRIMARY KEY,
  activity_name TEXT NOT NULL,
  mailerlite_group_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE activity_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_waitlist_groups ENABLE ROW LEVEL SECURITY;

-- Public: no direct access (all writes go through the edge function with service role key)
-- No SELECT policy needed on activity_waitlist (analytics only, admin use)
-- activity_waitlist_groups is read-only for the edge function (service role bypasses RLS)

-- Allow public SELECT on event_categories so the PostgREST join works with anon key
-- (needed by pseo-activity.js to filter events by category slug)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_categories' AND policyname = 'Public read event_categories'
  ) THEN
    CREATE POLICY "Public read event_categories"
      ON event_categories FOR SELECT
      USING (true);
  END IF;
END $$;
