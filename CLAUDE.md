# Mixler Site

## Deployment
- Repo: `nart78/mixler-site`
- IONOS VPS (198.71.51.250), domain: mixler.ca
- Nginx serving from `/var/www/mixler.ca/`
- Static HTML/CSS/JS + Supabase backend
- Deploy: `rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ --exclude='.git' --exclude='supabase' --exclude='scripts' --exclude='CLAUDE.md' --exclude='.github' --exclude='og' --exclude='seo'`
- **Always push to git and deploy to VPS after making changes.**
- After deploy, regenerate OG link previews: `ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"`

## Brand Rules
- **NO purple anywhere.** All headings/accents use blue (#153db6).
- Colors: Blue #153db6, Pink #ff3465, Light gray #f5f5f7
- Fonts: League Spartan (headings), Inter (body)
- Never use em dashes in copy
- Writing voice: warm, inviting, casual but not sloppy. Calgary local feel.

## Structure
- `index.html`, `login.html`, `account.html`, `events.html`, `event.html`
- `admin/` — admin interface
- `supabase/migrations/` — database migrations
- `scripts/` — utility scripts
- `images/` — event images directory

## Supabase

- URL: `https://dnuygqdmzjswroyzvkjb.supabase.co`
- Anon key: see `~/mixler-site/.env` (SUPABASE_ANON_KEY)
- Service key: see `~/mixler-site/.env` (SUPABASE_SERVICE_KEY)
- Always use the **service role key** for inserts/updates (anon key is blocked by RLS)
- REST API: `{SUPABASE_URL}/rest/v1/events`

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
early_bird_price_cents INTEGER (optional)
early_bird_deadline TIMESTAMPTZ (optional)
image_url       TEXT (relative path, e.g. "images/PuppyYoga.jpg")
status          ENUM: draft, published, cancelled, completed
custom_fields   JSONB (flexible, e.g. {"puppies": [...], "dress_code": "Casual"})
cancellation_policy TEXT
cancellation_cutoff_hours INTEGER (default 48)
is_cancellable  BOOLEAN (default true)
tax_rate_bps    INTEGER (default 500 = 5%)
max_tickets_per_order INTEGER (default 10)
pass_cc_fee     BOOLEAN (default false)
category_id     UUID (optional, FK to event_categories)
```

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
   **CRITICAL**: The checkout page uses `ticket_types.price_cents`, NOT `events.price_cents`. If you skip this step, the event will show as $0.00 at checkout.
7. **Create MailerLite group** for the event (so ticket buyers are auto-added to an event-specific email list):
   ```bash
   source ~/mixler-site/.env
   curl -s -X POST "${SUPABASE_URL}/functions/v1/create-mailerlite-group" \
     -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"event_id": "<new event UUID>"}'
   ```
   Verify the response contains `"success": true` and a `group_id`.
8. **Handle custom content**: If the event has special features (e.g. puppy profiles), store data in `custom_fields` JSONB. The event.html template supports:
   - `custom_fields.puppies` - Array of {name, breed, image} rendered as a "Meet the Puppies" grid
   - `custom_fields.volume_discount` - Object with `min_qty` (integer) and `discount_pct` (integer). Auto-applies discount at checkout when buyer selects min_qty or more tickets. Example: `{"min_qty": 4, "discount_pct": 15}` = 15% off for 4+ tickets. Also configurable via admin UI (Group Discount section in event edit form).
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

### Rules

- Always confirm event details with Johnny before inserting
- Always deploy + regenerate OG after creating/updating events
- Always git commit and push changes
- Price is stored in cents (multiply dollars by 100)
- Slug must be unique. Check existing events before inserting.
