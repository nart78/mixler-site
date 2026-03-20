# Mixler Site: Architecture

## Overview

Mixler (mixler.ca) is Calgary's adult social events platform. Users browse events, purchase tickets, and manage orders. The platform is intentionally low-infrastructure: static HTML/CSS/JS frontend served from an IONOS VPS, with Supabase providing all backend capabilities (database, auth, REST API, edge functions).

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Static HTML + vanilla JS | No framework. Pages are self-contained HTML files. |
| Backend | Supabase (PostgreSQL) | Managed DB, auth, REST API, realtime, edge functions |
| Hosting | IONOS VPS (198.71.51.250) | Nginx serves static files |
| Web server | Nginx | Reverse proxy + static file serving |
| SSL | Certbot | Let's Encrypt certificates |
| DNS | Cloudflare | NS: mark/priscilla.ns.cloudflare.com; domain registered at Namecheap |
| Email | DreamHost (hello@mixler.ca) + Resend (transactional) | Resend handles ticket confirmation emails |
| Repository | GitHub: nart78/mixler-site | Main branch is production |

---

## Page Inventory

| Page | File | Role |
|------|------|------|
| Home / Events | `index.html` | Event listings, hero, featured events |
| Events list | `events.html` | Full paginated event catalog |
| Event detail | `event.html` | Single event page with ticket purchase CTA |
| Checkout | `checkout.html` | Ticket selection, payment, order submission |
| Order confirmation | `order-confirmation.html` | Post-purchase confirmation with ticket download |
| Login | `login.html` | Supabase auth (email magic link or password) |
| Account | `account.html` | Order history, ticket access, profile |
| Brand facts | `brand-facts.html` | AEO brand facts page (machine-readable brand info) |
| Privacy policy | `privacy.html` | PIPEDA-compliant privacy policy |
| Data deletion | `data-deletion.html` | User data deletion request page |

---

## JavaScript Modules

| Module | File | Responsibilities |
|--------|------|----------------|
| Auth | `auth.js` | Supabase session management, login/logout, session persistence |
| Supabase client | `supabase-client.js` | Initializes Supabase JS client with URL and anon key |
| Ticket PDF | `ticket-pdf.js` | Generates downloadable ticket PDF client-side |
| Components | `components.js` | Shared UI components (header, footer, nav) |
| Utils | `utils.js` | Shared helpers: date formatting, price formatting, slug generation |

---

## Supabase Schema

### `events` Table (key fields)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `title` | text | |
| `slug` | text | Unique. Format: `{name}-{month}-{year}` (e.g., `pottery-night-march-2026`) |
| `description` | text | Full HTML description |
| `short_description` | text | 1-2 sentence teaser |
| `location_name` | text | Venue name |
| `location_address` | text | Full street address |
| `event_date` | DATE | Use `2099-12-31` for TBD dates |
| `start_time` | time | |
| `end_time` | time | |
| `capacity` | integer | |
| `tickets_sold` | integer | Updated by checkout edge function |
| `price_cents` | integer | Price in cents. $30 = 3000 |
| `early_bird_price_cents` | integer | Optional |
| `image_url` | text | Relative path: `/images/{slug}/main.jpg` |
| `status` | text | `draft`, `published`, `cancelled`, `completed` |
| `custom_fields` | JSONB | Variable per event: `puppies` array, `volume_discount` object, etc. |
| `cancellation_policy` | text | |
| `cancellation_cutoff_hours` | integer | |
| `is_cancellable` | boolean | |
| `tax_rate_bps` | integer | Tax in basis points. 5% = 500 |
| `max_tickets_per_order` | integer | |
| `pass_cc_fee` | boolean | Always set `true` |

### `ticket_types` Table

Every event must have at least one matching row in `ticket_types`. Checkout reads ticket price from `ticket_types.price_cents`, not from the events table directly. If a ticket_type row is missing, checkout will fail silently or error.

### Migrations

Tracked in `supabase/migrations/`. Six migration files: five numbered (001-005) and one timestamped. Apply in order. Never modify existing migration files; always add a new one.

---

## MailerLite Integration

When a new event is published, a MailerLite group is created for that event via a Supabase edge function:

- Function location: `supabase/functions/create-mailerlite-group/`
- Group name convention: matches the event title
- Purpose: collects attendee emails for pre-event communication and post-event follow-up

---

## SEO and AEO Content

| Content type | Location | Count | Purpose |
|-------------|---------|-------|---------|
| Activity guide pages | `activities/` | 70+ | Long-tail SEO for Calgary activities |
| Curated guide pages | `guides/` | 27 | Curated lists (e.g., "Best Date Night Activities in Calgary") |
| Schema markup | Inline on event pages | Per-event | JSON-LD for events, breadcrumbs, organization |
| SEO generator | `seo/generate.py` | Script | Generates sitemap and meta tags |

---

## Deployment Workflow

See `docs/runbooks/deploy.md` for the full runbook.

```bash
# 1. Push to GitHub
git add [specific files]
git commit -m "description"
git push origin main

# 2. Deploy to VPS
rsync -avz \
  --exclude='.git' \
  --exclude='supabase' \
  --exclude='scripts' \
  --exclude='CLAUDE.md' \
  --exclude='seo' \
  . root@198.71.51.250:/var/www/mixler.ca/

# 3. Regenerate OG images (required after every deploy)
ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"
```

---

## Brand Rules

| Rule | Detail |
|------|--------|
| No purple | Purple is strictly forbidden. All accents and headings use blue. |
| Primary blue | `#153db6` |
| Accent pink | `#ff3465` |
| Background gray | `#f5f5f7` |
| Heading font | League Spartan |
| Body font | Inter |
| Tone | Warm, inviting, casual Calgary voice |
| No em dashes | Use periods or restructure sentences |

---

## Critical Rules

1. **ticket_types must match events.** Every event row must have a corresponding `ticket_types` row. Checkout uses `ticket_types.price_cents`. Missing rows break checkout.
2. **Use the service key for writes.** RLS policies block the anon key from inserting or updating. Always use `SUPABASE_SERVICE_KEY` for any data mutation. Anon key is for reads only.
3. **Prices are in cents.** Store `$30.00` as `3000`. Never store dollar amounts directly.
4. **Always set `pass_cc_fee: true`** on new events unless explicitly instructed otherwise.
5. **OG images must be regenerated** after every deploy that changes event data or images.
