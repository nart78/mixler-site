-- ============================================
-- Mixler Event Platform - Ticketing System
-- Migration 003: Ticket types, categories, tags,
-- coupons, QR codes, recurring events, and more.
-- ============================================

-- ============================================
-- NEW ENUMS
-- ============================================

CREATE TYPE discount_type AS ENUM ('percentage', 'fixed');
CREATE TYPE recurrence_type AS ENUM ('none', 'daily', 'weekly', 'biweekly', 'monthly');
CREATE TYPE rsvp_status AS ENUM ('going', 'maybe', 'not_going', 'invited');

-- ============================================
-- NEW TABLES
-- ============================================

-- Event Categories
CREATE TABLE event_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#153db6',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tags (flexible event labeling)
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event-Tag junction table
CREATE TABLE event_tags (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
);

-- Ticket Types (multiple pricing tiers per event)
CREATE TABLE ticket_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 0,
  tickets_sold INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  sales_start TIMESTAMPTZ,
  sales_end TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  max_per_order INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Coupons / Discount Codes
CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  discount_type discount_type NOT NULL DEFAULT 'percentage',
  discount_value INTEGER NOT NULL DEFAULT 0,
  min_order_cents INTEGER DEFAULT 0,
  max_uses INTEGER,
  times_used INTEGER DEFAULT 0,
  max_uses_per_user INTEGER DEFAULT 1,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RSVPs (for free events or invitations)
CREATE TABLE rsvps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status rsvp_status DEFAULT 'invited',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, email)
);

-- Email Log (track all sent emails)
CREATE TABLE email_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  template_name TEXT,
  subject TEXT,
  status message_status DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referral Codes
CREATE TABLE referral_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  discount_value INTEGER DEFAULT 500,
  times_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event Photos (post-event gallery)
CREATE TABLE event_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ALTER EXISTING TABLES
-- ============================================

-- Events: add category, recurrence, location coords, custom fields, cancellation, tax, max tickets
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES event_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence recurrence_type DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
  ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_place_id TEXT,
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cancellation_policy TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_cutoff_hours INTEGER DEFAULT 48,
  ADD COLUMN IF NOT EXISTS is_cancellable BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_tickets_per_order INTEGER DEFAULT 10;

-- Orders: add ticket type, pricing breakdown, Stripe fields, coupon, refund, inventory hold, referral
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ticket_type_id UUID REFERENCES ticket_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS referral_code_id UUID REFERENCES referral_codes(id) ON DELETE SET NULL;

-- Attendees: add ticket type, QR code, check-in details, transfer support
ALTER TABLE attendees
  ADD COLUMN IF NOT EXISTS ticket_type_id UUID REFERENCES ticket_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qr_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferred_from_id UUID REFERENCES attendees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

-- Profiles: add SMS consent
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT FALSE;

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ticket_types_event ON ticket_types(event_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_event ON coupons(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_event ON event_tags(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_tag ON event_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_event ON rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_email_log_event ON email_log(event_id);
CREATE INDEX IF NOT EXISTS idx_email_log_order ON email_log(order_id);
CREATE INDEX IF NOT EXISTS idx_event_photos_event ON event_photos(event_id);
CREATE INDEX IF NOT EXISTS idx_attendees_qr ON attendees(qr_code);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_reserved ON orders(reserved_until) WHERE reserved_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-generate QR code on attendee insert
CREATE OR REPLACE FUNCTION generate_qr_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.qr_code IS NULL THEN
    NEW.qr_code := encode(gen_random_bytes(16), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_attendee_qr_code
  BEFORE INSERT ON attendees
  FOR EACH ROW
  EXECUTE FUNCTION generate_qr_code();

-- Update ticket_type.tickets_sold when order is completed/refunded
CREATE OR REPLACE FUNCTION update_ticket_type_sold()
RETURNS TRIGGER AS $$
BEGIN
  -- On order completion, increment ticket_type.tickets_sold
  IF NEW.payment_status = 'completed' AND (OLD IS NULL OR OLD.payment_status != 'completed') THEN
    IF NEW.ticket_type_id IS NOT NULL THEN
      UPDATE ticket_types
      SET tickets_sold = tickets_sold + NEW.quantity
      WHERE id = NEW.ticket_type_id;
    END IF;
  END IF;
  -- On refund, decrement ticket_type.tickets_sold
  IF NEW.payment_status = 'refunded' AND OLD.payment_status = 'completed' THEN
    IF NEW.ticket_type_id IS NOT NULL THEN
      UPDATE ticket_types
      SET tickets_sold = GREATEST(tickets_sold - NEW.quantity, 0)
      WHERE id = NEW.ticket_type_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_order_ticket_type_change
  AFTER INSERT OR UPDATE OF payment_status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_type_sold();

-- Increment coupon.times_used on order completion
CREATE OR REPLACE FUNCTION update_coupon_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'completed' AND (OLD IS NULL OR OLD.payment_status != 'completed') THEN
    IF NEW.coupon_id IS NOT NULL THEN
      UPDATE coupons
      SET times_used = times_used + 1
      WHERE id = NEW.coupon_id;
    END IF;
  END IF;
  -- On refund, decrement coupon usage
  IF NEW.payment_status = 'refunded' AND OLD.payment_status = 'completed' THEN
    IF NEW.coupon_id IS NOT NULL THEN
      UPDATE coupons
      SET times_used = GREATEST(times_used - 1, 0)
      WHERE id = NEW.coupon_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_order_coupon_usage
  AFTER INSERT OR UPDATE OF payment_status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_coupon_usage();

-- Auto-update updated_at for new tables
CREATE TRIGGER update_ticket_types_updated_at
  BEFORE UPDATE ON ticket_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_rsvps_updated_at
  BEFORE UPDATE ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_photos ENABLE ROW LEVEL SECURITY;

-- Event Categories: anyone can read, admins can manage
CREATE POLICY categories_select ON event_categories
  FOR SELECT USING (TRUE);

CREATE POLICY categories_admin_all ON event_categories
  FOR ALL USING (public.is_admin());

-- Tags: anyone can read, admins can manage
CREATE POLICY tags_select ON tags
  FOR SELECT USING (TRUE);

CREATE POLICY tags_admin_all ON tags
  FOR ALL USING (public.is_admin());

-- Event Tags: anyone can read, admins can manage
CREATE POLICY event_tags_select ON event_tags
  FOR SELECT USING (TRUE);

CREATE POLICY event_tags_admin_all ON event_tags
  FOR ALL USING (public.is_admin());

-- Ticket Types: anyone can read active ones for published events, admins can manage
CREATE POLICY ticket_types_select ON ticket_types
  FOR SELECT USING (
    is_active = TRUE AND EXISTS (
      SELECT 1 FROM events WHERE events.id = ticket_types.event_id AND events.status = 'published'
    )
  );

CREATE POLICY ticket_types_admin_all ON ticket_types
  FOR ALL USING (public.is_admin());

-- Coupons: no public read (validated server-side), admins can manage
CREATE POLICY coupons_admin_all ON coupons
  FOR ALL USING (public.is_admin());

-- RSVPs: users can read/manage their own, admins can manage all
CREATE POLICY rsvps_select_own ON rsvps
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY rsvps_insert ON rsvps
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY rsvps_update_own ON rsvps
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY rsvps_admin_all ON rsvps
  FOR ALL USING (public.is_admin());

-- Email Log: admin only
CREATE POLICY email_log_admin_all ON email_log
  FOR ALL USING (public.is_admin());

-- Referral Codes: users can read their own, admins can manage all
CREATE POLICY referral_codes_select_own ON referral_codes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY referral_codes_insert ON referral_codes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY referral_codes_admin_all ON referral_codes
  FOR ALL USING (public.is_admin());

-- Event Photos: anyone can read, admins can manage
CREATE POLICY event_photos_select ON event_photos
  FOR SELECT USING (TRUE);

CREATE POLICY event_photos_admin_all ON event_photos
  FOR ALL USING (public.is_admin());

-- Allow service role / edge functions to insert orders and attendees
-- (Stripe webhook creates orders without a user session)
CREATE POLICY orders_service_insert ON orders
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY orders_service_update ON orders
  FOR UPDATE USING (TRUE);

CREATE POLICY attendees_service_insert ON attendees
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY attendees_service_update ON attendees
  FOR UPDATE USING (TRUE);

-- ============================================
-- CREATE DEFAULT TICKET TYPES FOR EXISTING EVENTS
-- ============================================

-- Migrate existing events to have a "General Admission" ticket type
INSERT INTO ticket_types (event_id, name, price_cents, capacity, tickets_sold, sort_order)
SELECT id, 'General Admission', price_cents, capacity, tickets_sold, 0
FROM events
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_types WHERE ticket_types.event_id = events.id
);
