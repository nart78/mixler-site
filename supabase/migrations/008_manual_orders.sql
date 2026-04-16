-- Manual order support: payment method label + email preferences for e-transfer confirmation flow

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'stripe'
    CHECK (payment_method IN ('stripe', 'offline_etransfer', 'comp')),
  ADD COLUMN IF NOT EXISTS send_buyer_email_on_confirm BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS send_attendee_emails_on_confirm BOOLEAN DEFAULT TRUE;

-- Backfill: every existing order is a Stripe order
UPDATE orders SET payment_method = 'stripe' WHERE payment_method IS NULL;
