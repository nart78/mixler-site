-- Create client_actions table for AEOthis dashboard
CREATE TABLE IF NOT EXISTS client_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_slug text NOT NULL,
  action_id text NOT NULL,
  checked boolean DEFAULT false NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (client_slug, action_id)
);

-- Enable RLS
ALTER TABLE client_actions ENABLE ROW LEVEL SECURITY;

-- Allow anon to read all rows
CREATE POLICY "anon_read_client_actions"
  ON client_actions FOR SELECT
  TO anon
  USING (true);

-- Allow anon to insert
CREATE POLICY "anon_insert_client_actions"
  ON client_actions FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon to update
CREATE POLICY "anon_update_client_actions"
  ON client_actions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_client_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_actions_updated_at
  BEFORE UPDATE ON client_actions
  FOR EACH ROW EXECUTE FUNCTION update_client_actions_updated_at();
