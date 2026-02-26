-- ============================================
-- Mixler Event Platform - Initial Schema
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
CREATE TYPE message_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE message_type AS ENUM ('sms', 'email');

-- ============================================
-- TABLES
-- ============================================

-- Profiles (extends Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  short_description TEXT,
  location_name TEXT,
  location_address TEXT,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  capacity INTEGER NOT NULL DEFAULT 0,
  tickets_sold INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  early_bird_price_cents INTEGER,
  early_bird_deadline TIMESTAMPTZ,
  image_url TEXT,
  status event_status DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_status payment_status DEFAULT 'pending',
  square_payment_id TEXT,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attendees (individual people per order, for group purchases)
CREATE TABLE attendees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  checked_in BOOLEAN DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Waitlist
CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  notified BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, email)
);

-- Scheduled Messages
CREATE TABLE scheduled_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  message_body TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status message_status DEFAULT 'pending',
  type message_type DEFAULT 'sms',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message Log (per-attendee delivery tracking)
CREATE TABLE message_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheduled_message_id UUID NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE,
  attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  status message_status DEFAULT 'pending',
  twilio_sid TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_date ON events(event_date);
CREATE INDEX idx_events_slug ON events(slug);
CREATE INDEX idx_orders_event ON orders(event_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(payment_status);
CREATE INDEX idx_attendees_event ON attendees(event_id);
CREATE INDEX idx_attendees_order ON attendees(order_id);
CREATE INDEX idx_waitlist_event ON waitlist(event_id);
CREATE INDEX idx_waitlist_position ON waitlist(event_id, position);
CREATE INDEX idx_scheduled_messages_status ON scheduled_messages(status, send_at);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Generate order number (MXL-XXXXXX)
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 5) AS INTEGER)), 0) + 1
  INTO next_num
  FROM orders;
  NEW.order_number := 'MXL-' || LPAD(next_num::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL OR NEW.order_number = '')
  EXECUTE FUNCTION generate_order_number();

-- Update tickets_sold on completed order
CREATE OR REPLACE FUNCTION update_tickets_sold()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'completed' AND (OLD IS NULL OR OLD.payment_status != 'completed') THEN
    UPDATE events
    SET tickets_sold = tickets_sold + NEW.quantity
    WHERE id = NEW.event_id;
  END IF;
  IF NEW.payment_status = 'refunded' AND OLD.payment_status = 'completed' THEN
    UPDATE events
    SET tickets_sold = GREATEST(tickets_sold - NEW.quantity, 0)
    WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_order_status_change
  AFTER INSERT OR UPDATE OF payment_status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_tickets_sold();

-- Auto-assign waitlist position
CREATE OR REPLACE FUNCTION assign_waitlist_position()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(MAX(position), 0) + 1
  INTO NEW.position
  FROM waitlist
  WHERE event_id = NEW.event_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_waitlist_position
  BEFORE INSERT ON waitlist
  FOR EACH ROW
  EXECUTE FUNCTION assign_waitlist_position();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;

-- Admin check function (SECURITY DEFINER to avoid infinite recursion on profiles RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles: users can read/update their own profile, admins can read all
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY profiles_admin_select ON profiles
  FOR SELECT USING (public.is_admin());

-- Events: anyone can read published events, admins can do everything
CREATE POLICY events_select_published ON events
  FOR SELECT USING (status = 'published');

CREATE POLICY events_admin_all ON events
  FOR ALL USING (public.is_admin());

-- Orders: users can read their own, admins can read all
CREATE POLICY orders_select_own ON orders
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY orders_insert ON orders
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY orders_admin_all ON orders
  FOR ALL USING (public.is_admin());

-- Attendees: users can read attendees for their orders, admins can read all
CREATE POLICY attendees_select_own ON attendees
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = attendees.order_id AND orders.user_id = auth.uid())
  );

CREATE POLICY attendees_admin_all ON attendees
  FOR ALL USING (public.is_admin());

-- Waitlist: anyone can insert (signup), admins can manage
CREATE POLICY waitlist_insert ON waitlist
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY waitlist_admin_all ON waitlist
  FOR ALL USING (public.is_admin());

-- Scheduled Messages & Log: admin only
CREATE POLICY messages_admin_all ON scheduled_messages
  FOR ALL USING (public.is_admin());

CREATE POLICY message_log_admin_all ON message_log
  FOR ALL USING (public.is_admin());

-- ============================================
-- SEED: Sample events for testing
-- ============================================

INSERT INTO events (title, slug, description, short_description, location_name, location_address, event_date, start_time, end_time, capacity, price_cents, status) VALUES
(
  'Friday Night Mixer',
  'friday-night-mixer-mar-2026',
  'Join us for a relaxed Friday evening of great conversations, new faces, and good vibes. Our mixers are designed to make it easy to connect with other adults in Calgary who are looking for genuine friendships and fun nights out. Icebreakers included, awkward silences not.',
  'A relaxed Friday evening of great conversations and new faces in downtown Calgary.',
  'The National on 10th',
  '341 10 Ave SW, Calgary, AB',
  '2026-03-07',
  '19:00',
  '22:00',
  40,
  2500,
  'published'
),
(
  'Trivia & Drinks',
  'trivia-drinks-mar-2026',
  'Think you''re smart? Prove it. Teams of strangers battle it out over five rounds of trivia while enjoying drinks at one of Kensington''s best spots. You don''t need to know everything, you just need to show up and have a good time.',
  'Team trivia with strangers, drinks, and bragging rights in Kensington.',
  'The Brasserie',
  '1154 Kensington Cres NW, Calgary, AB',
  '2026-03-14',
  '19:30',
  '22:30',
  36,
  3000,
  'published'
),
(
  'Speed Friending',
  'speed-friending-mar-2026',
  'Like speed dating, but for friendships. Rotate through short, fun conversations with a room full of interesting people. By the end of the night, you''ll have met everyone and found your people. No pressure, just real connections.',
  'Rotate through quick chats and leave with a room full of new friends.',
  'Craft Beer Market - Beltline',
  '345 10 Ave SW, Calgary, AB',
  '2026-03-21',
  '19:00',
  '21:30',
  30,
  2000,
  'published'
);
