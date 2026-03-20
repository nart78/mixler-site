-- Migration 006: Enforce that an event cannot be published without an active ticket type.
-- The checkout page reads price from ticket_types, not events. A published event with no
-- ticket type row will silently show $0.00 at checkout.

CREATE OR REPLACE FUNCTION enforce_ticket_type_on_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' AND (OLD IS NULL OR OLD.status != 'published') THEN
    IF NOT EXISTS (
      SELECT 1 FROM ticket_types
      WHERE event_id = NEW.id AND is_active = true
    ) THEN
      RAISE EXCEPTION
        'Cannot publish event "%" without an active ticket type. Insert a ticket_types row first.',
        NEW.title;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER require_ticket_type_before_publish
  BEFORE INSERT OR UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION enforce_ticket_type_on_publish();
