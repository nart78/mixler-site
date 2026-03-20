# Mixler Site

## Deployment
- Repo: `nart78/mixler-site`
- IONOS VPS (198.71.51.250), domain: mixler.ca
- Nginx serving from `/var/www/mixler.ca/`
- Static HTML/CSS/JS + Supabase backend
- Deploy: `rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ --exclude='.git' --exclude='supabase' --exclude='scripts' --exclude='CLAUDE.md' --exclude='.github' --exclude='og' --exclude='seo'`
- **Always push to git and deploy to VPS after making changes.**
- After deploy, regenerate OG link previews: `ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"`

## When a Deploy Is Required

- **Always deploy**: changes to any `.html`, `.css`, or `.js` file in the project root or `css/`/`js/` directories.
- **No deploy needed**: DB-only changes (migrations, Edge Function updates, event data). These go directly to Supabase.
- After every deploy, regenerate OG previews (see Deployment section).
- Do not deploy during a live event unless it is an emergency fix.

## Brand Rules
- **NO purple anywhere.** All headings/accents use blue (#153db6).
- Colors: Blue #153db6, Pink #ff3465, Light gray #f5f5f7
- Fonts: League Spartan (headings), Inter (body)
- Never use em dashes in copy
- Writing voice: warm, inviting, casual but not sloppy. Calgary local feel.

## Structure
- `index.html`, `login.html`, `account.html`, `events.html`, `event.html`
- `admin/` — admin interface (see Admin section below)
- `supabase/migrations/` — database migrations
- `scripts/` — utility scripts
- `images/` — event images directory

## Supabase

- URL: `https://dnuygqdmzjswroyzvkjb.supabase.co`
- Anon key: see `~/mixler-site/.env` (SUPABASE_ANON_KEY) — read-only public data (events, ticket_types). Never use for writes.
- Service key: see `~/mixler-site/.env` (SUPABASE_SERVICE_KEY) — all writes and admin operations. Never expose in client-side code.
- REST API: `{SUPABASE_URL}/rest/v1/events`

## Edge Functions

Located at `supabase/functions/`. Deploy with: `npx supabase functions deploy <name> --project-ref dnuygqdmzjswroyzvkjb`

| Function | Called from | Purpose | Safe to modify? |
|---|---|---|---|
| `checkout-signup` | Browser (checkout) | Creates confirmed user account | Ask first |
| `create-checkout-session` | Browser (checkout) | Creates Stripe session + order | Ask first |
| `stripe-webhook` | Stripe (server) | Handles payment events, updates order status | Never without approval |
| `send-order-email` | stripe-webhook (server) | Sends confirmation email to buyer | Yes |
| `send-cancellation-email` | Admin dashboard (server) | Sends cancellation notice to all paid buyers | Ask first |
| `send-attendee-ticket` | server | Sends ticket PDF to attendee | Yes |
| `validate-coupon` | Browser (checkout) | Validates and applies coupon codes | Yes |
| `validate-checkin` | Browser (admin/scan) | Validates ticket QR at door | Ask first |
| `newsletter-subscribe` | Browser | Adds email to MailerLite | Yes |
| `join-activity-waitlist` | Browser | Adds to waitlist for an activity | Yes |
| `create-mailerlite-group` | server (event creation workflow) | Creates per-event email list in MailerLite | Yes |

## Image Requirements

Images are used as full-bleed backgrounds on event cards and detail pages:
- **Event detail page**: full container width × 350px tall (`background-size: cover`)
- **Event cards (listing page)**: full card width × 380px min-height (`background-size: cover`)
- **Recommended upload size**: 1200 × 500px minimum, JPG or PNG
- Keep under 500KB for page performance
- Name images to match the event slug: `images/puppy-yoga-apr-2026.jpg`

## Custom Fields (JSONB)

`custom_fields` is a flexible JSON column on the `events` table — extra data specific to that event type. Currently documented keys:

```json
{
  "puppies": [
    { "name": "Biscuit", "breed": "Golden Retriever", "image": "images/puppies/biscuit.jpg" }
  ],
  "volume_discount": { "min_qty": 4, "discount_pct": 15 }
}
```

- `puppies` — renders a "Meet the Puppies" grid on the event page. Each entry needs `name`, `breed`, `image`.
- `volume_discount` — auto-applies a group discount at checkout when buyer selects `min_qty` or more tickets. Also editable via the admin UI (Group Discount section in event-edit.html).
- New keys can be added freely — they are ignored by the frontend unless explicitly coded in `event.html`.

## Stripe Test Mode

A test mode environment was used previously but is not currently active.
- Test keys start with `sk_test_` / `pk_test_`. Live keys start with `sk_live_` / `pk_live_`.
- To switch: update `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env` and in Supabase Edge Function secrets.
- Test card: `4242 4242 4242 4242`, any future expiry, any CVC.
- **Never mix test and live keys.** Check `~/mixler-site/.env` to confirm which environment you're in before any Stripe work.

## Admin Interface

Located at `admin/`. Protected by client-side auth check (admin role required).

| File | Purpose | Sensitivity |
|---|---|---|
| `index.html` | Dashboard home | Low |
| `events.html` | Admin event list | Low |
| `event-edit.html` | Edit event details, group discounts | Medium |
| `coupons.html` | Create and manage coupon codes | Medium |
| `messages.html` | Event messaging | Medium |
| `orders.html` | View all orders | High — live payment data |
| `attendees.html` | Attendee list per event | High — personal data |
| `customers.html` | Customer list | High — personal data |
| `scan.html` | Live check-in scanner | High — do not touch during a live event |

## Event Management

### Events Table Schema

```
id              UUID (auto-generated)
title           TEXT NOT NULL
slug            TEXT UNIQUE NOT NULL (URL-safe, e.g. "puppy-yoga-apr-2026")
description     TEXT (multi-line, rendered as <p> per line)
short_description TEXT (max ~200 chars, for event cards)
location_name   TEXT
location_address TEXT
event_date      DATE (use '2099-12-31' for TBD events)
start_time      TIME
end_time        TIME
capacity        INTEGER
tickets_sold    INTEGER (default 0)
price_cents     INTEGER (e.g. 4000 = $40.00)
early_bird_price_cents INTEGER (optional) — discounted price available before early_bird_deadline
early_bird_deadline    TIMESTAMPTZ (optional) — checkout switches to regular price_cents after this date
image_url       TEXT (relative path, e.g. "images/PuppyYoga.jpg")
status          ENUM: draft, published, cancelled, completed
custom_fields   JSONB (see Custom Fields section)
cancellation_policy TEXT
cancellation_cutoff_hours INTEGER (default 48)
is_cancellable  BOOLEAN (default true)
tax_rate_bps    INTEGER (default 500 = 5%)
max_tickets_per_order INTEGER (default 10)
pass_cc_fee     BOOLEAN (default false)
category_id     UUID (optional, FK to event_categories)
```

> `pass_cc_fee` defaults to `false` in the schema but must always be explicitly set to `true` when inserting events. The DB default is a safety net only.
>
> `early_bird_price_cents` / `early_bird_deadline`: used to offer a lower "buy early" price before a cutoff date. The checkout page handles the price switch automatically. Always set both fields together — one without the other is invalid.

### Event Creation Workflow

1. **Gather details** from Johnny: title, date, time, location, price, capacity, description, any special content (photos, partners, etc.)
2. **Generate slug**: lowercase, hyphenated, include month+year (e.g. "puppy-yoga-apr-2026")
3. **Write description**: Engaging, on-brand copy. No em dashes. Keep it warm and inviting.
4. **Handle assets**: Download any external images to `~/mixler-site/images/`. Organize in subdirectories if needed (e.g. `images/puppies/`).
5. **Insert event** via Supabase REST API using the service role key. **Always set `pass_cc_fee: true`** to pass the 3% credit card fee to the buyer.
6. **Create ticket type**: After inserting the event, **always** insert a matching row in `ticket_types`:
   ```
   POST {SUPABASE_URL}/rest/v1/ticket_types
   {
     "event_id": "<new event UUID>",
     "name": "General Admission",
     "price_cents": <same as event price_cents>,
     "capacity": <same as event capacity>,
     "is_active": true,
     "sort_order": 0,
     "max_per_order": 10
   }
   ```
   **CRITICAL**: The checkout page uses `ticket_types.price_cents`, NOT `events.price_cents`. If you skip this step, the event will show as $0.00 at checkout. A DB trigger (migration 006) will also block publishing the event without this row.
7. **Create MailerLite group** for the event (so ticket buyers are auto-added to an event-specific email list):
   ```bash
   source ~/mixler-site/.env
   curl -s -X POST "${SUPABASE_URL}/functions/v1/create-mailerlite-group" \
     -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"event_id": "<new event UUID>"}'
   ```
   Verify the response contains `"success": true` and a `group_id`. If it fails, do not proceed — the email list will be missing for this event.
8. **Handle custom content**: If the event has special features (e.g. puppy profiles), store data in `custom_fields` JSONB. See Custom Fields section.
9. **Deploy** (see Deployment section above)
10. **Regenerate OG previews**: `ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"`
11. **Git commit and push** all new/changed files

### Updating Events

```bash
curl -s -X PATCH "{SUPABASE_URL}/rest/v1/events?slug=eq.{slug}" \
  -H "apikey: {SERVICE_KEY}" \
  -H "Authorization: Bearer {SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"field": "new_value"}'
```

### Cancelling / Completing Events

- Set `status` to `cancelled` or `completed` via PATCH
- Cancelled events stop showing on the public events page
- Completed events stop showing but preserve data
- **When cancelling**: the admin dashboard triggers `send-cancellation-email`, which emails all buyers with a completed order. Do not cancel an event without confirming this step runs.

### Rules

- Always confirm event details with Johnny before inserting
- Always deploy + regenerate OG after creating/updating events
- Always git commit and push changes
- Price is stored in cents (multiply dollars by 100)
- Slug must be unique. Check existing events before inserting.

## Protected Files and Off-Limits Operations

**Never modify without Johnny's explicit approval:**
- `supabase/migrations/` — migrations run against the live DB and cannot be rolled back easily. Write new migration files; never edit existing ones. If a migration has a bug, write a corrective migration (007, 008, etc.) — never edit the original.
- `.env` — contains production keys. Never commit, overwrite, or log its contents.
- `supabase/functions/stripe-webhook/index.ts` — payment processing. Any change here risks silent order failures or double-charges.
- `admin/orders.html`, `admin/attendees.html`, `admin/customers.html` — contain live payment and personal data.
- `admin/scan.html` — the live check-in scanner. Do not modify during an active event.

**Never do these without asking first:**
- Delete any row from `orders`, `attendees`, or `ticket_types` in the live DB.
- Change `payment_status` on any order directly (always goes through Stripe webhook).
- Run `git push --force` or reset the main branch.
- Modify Stripe webhook endpoint URL or secret in the Supabase dashboard.
- Change Nginx config on the VPS (`/etc/nginx/sites-available/mixler.ca`).
- Deploy during a live event (unless it is an emergency fix).

**Known incident log:**
- 2026-03: `client_actions` migration from AEOthis was accidentally applied to the Mixler Supabase project. Dropped manually. Root cause: wrong project selected during migration run.
- 2026-03: Git and VPS diverged — commits existed on VPS that were not in origin. Fixed by reconciling all three. Root cause: direct edits on VPS without committing first.

## Planned Features (Not Yet Built)

### Admin-triggered refunds
Issuing a refund from `admin/orders.html` should automatically trigger a refund in Stripe. Currently refunds require going into the Stripe dashboard manually.

What needs to be built:
- New Edge Function `process-refund` — takes `order_id`, calls Stripe API to refund `stripe_payment_id`, updates `payment_status` to `refunded` and `refund_amount_cents` in the orders table
- Refund button in `admin/orders.html` order detail view
- Safety checks: block if already refunded, block if no `stripe_payment_id` on the order, confirm dialog before firing
- The existing `charge.refunded` handler in `stripe-webhook` already updates the DB when Stripe fires the refund event, so the DB update may be handled automatically once Stripe processes it — verify this before writing duplicate update logic

## Documentation

- Architecture overview: `docs/architecture.md`
- Adding a new event: `docs/runbooks/new-event.md`
- Deploying to VPS: `docs/runbooks/deploy.md`
- ADR: Why Supabase: `docs/decisions/ADR-001-supabase-backend.md`

## Open Questions

At the start of each session, check `UNKNOWNS.md`.
If there are open questions, ask Johnny if any have been resolved before starting work.
If the file has no open questions, skip this step.
If you discover a new gap during the session, add it.
