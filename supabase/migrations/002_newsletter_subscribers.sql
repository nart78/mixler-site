-- Newsletter subscribers table
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone can subscribe (insert)
CREATE POLICY newsletter_insert ON newsletter_subscribers
  FOR INSERT WITH CHECK (TRUE);

-- Only admins can view/manage subscribers
CREATE POLICY newsletter_admin_select ON newsletter_subscribers
  FOR SELECT USING (public.is_admin());

CREATE POLICY newsletter_admin_all ON newsletter_subscribers
  FOR ALL USING (public.is_admin());
