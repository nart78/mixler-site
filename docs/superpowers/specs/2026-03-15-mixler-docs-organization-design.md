# Design: Mixler Docs Organization

**Date:** 2026-03-15
**Status:** Approved

---

## Problem

Mixler's CLAUDE.md is dense with inline operational procedures (12-step event creation workflow, full schema, curl commands, rules). This duplicates content already in docs/ runbooks and creates two sources of truth. It also makes CLAUDE.md expensive to load and hard to scan.

Separately, the admin panel -- the most frequently used operational surface -- has no documentation at all.

---

## Solution

Two changes:

1. **Slim CLAUDE.md** to a lightweight reference index. Remove all procedural detail. Keep only: deploy commands, brand rules, Supabase connection info, and a Documentation section pointing to all docs.

2. **Create `docs/runbooks/admin-guide.md`** covering all 8 active admin screens in detail (Dashboard, Events, Event Edit, Orders, Attendees, Coupons, Customers, Scan). Note that Messages is in-progress (Twilio not connected).

---

## CLAUDE.md After Slim

CLAUDE.md retains five short sections:

### Deploy
The two-command deploy sequence as a copy-paste block:
```
rsync ... (existing command)
ssh ... generate-og.sh
```
Plus the git push reminder.

### Brand
A short inline table:
- No purple. Blue `#153db6`, pink `#ff3465`, gray `#f5f5f7`
- Fonts: League Spartan / Inter
- Voice: warm, Calgary, no em dashes

### Structure
Keep the existing brief directory listing:
- `admin/` -- admin interface
- `supabase/migrations/` -- database migrations
- `scripts/` -- utility scripts
- `images/` -- event images

### Supabase
Two lines only:
- URL
- Keys: `~/mixler-site/.env` (SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY). Use service key for writes.

### Documentation
Expanded index pointing to all docs including the new admin-guide.

**Removed from CLAUDE.md:**
- Full Events Table Schema (lives in `docs/architecture.md`)
- 12-step Event Creation Workflow (lives in `docs/runbooks/new-event.md`)
- Updating Events curl command (lives in `docs/runbooks/new-event.md`)
- Cancelling/Completing Events section (lives in `docs/runbooks/new-event.md`)
- Rules list at bottom (removed -- content already covered by existing runbooks)

---

## admin-guide.md Structure

Location: `docs/runbooks/admin-guide.md`

### Overview
- URL: `mixler.ca/admin/`
- Requires a logged-in Supabase account with admin privileges
- Sidebar navigation: Dashboard, Events, Orders, Attendees, Coupons, Customers, Messages, Scan

### Screen: Dashboard (`/admin/index.html` — default landing)
- Summary stats: total revenue, month revenue, total tickets sold
- Revenue chart (Chart.js)
- Recent orders table: order number, buyer, event, amount
- Read-only. Starting point when opening the admin panel.

### Screen: Events (`/admin/events.html`)
- Lists all events with status badges
- Actions per event: Edit, View on site, change status (draft/published/cancelled/completed)
- "New Event" button navigates to the event edit form for a blank record
- Tip: use the filter to show only published events when checking live state

### Screen: Event Edit (`/admin/event-edit.html`)
Full field reference for the edit form:

| Field | Notes |
|-------|-------|
| Title | Display name |
| Slug | URL-safe, must be unique. Format: `name-month-year` |
| Short Description | Max 200 chars. Shows on event cards. |
| Full Description | Multi-line. Each line renders as a `<p>`. |
| Status | draft / published / cancelled / completed |
| Category | Optional grouping |
| Image | Upload or provide URL. Stored at `/images/{slug}/main.jpg` |
| Date TBD toggle | Sets date to 2099-12-31 |
| Date / Start Time / End Time | Standard date/time pickers |
| Venue Name + Address | Shown on event detail page |
| Capacity / Price | Price in dollars (converted to cents on save) |
| Early Bird Price + Deadline | Optional |
| Tax Rate | Percentage (5 = 5% GST) |
| Pass CC Fee | Always leave checked |
| Cancellation Policy + Cutoff Hours | Shown to buyers at checkout |
| Max Tickets Per Order | Default 10 |
| **Group Discount** | `min_qty` (integer) + `discount_pct` (integer percent). Auto-applied at checkout when buyer selects >= min_qty tickets. Stored in `custom_fields.volume_discount`. |

Save updates the database via PATCH. After saving, deploy + regenerate OG if image or title changed.

### Screen: Orders (`/admin/orders.html`)
- Shows all orders across all events
- Columns: order ID, customer name/email, event, quantity, total, status, date
- Filter by event to see orders for a specific event
- No bulk actions. Orders are read-only in the admin panel.

### Screen: Attendees (`/admin/attendees.html`)
- Per-event attendee list
- Select an event from the dropdown to load attendees
- Shows: name, email, ticket count, order date
- Use this for door lists or exporting attendee info before an event

### Screen: Coupons (`/admin/coupons.html`)
Create and manage discount codes. Fields:

| Field | Notes |
|-------|-------|
| Code | Uppercase string, e.g. SPRING25 |
| Description | Internal label for the coupon |
| Discount Type | Percentage (%) or Fixed Amount ($) |
| Discount Value | Number. For percentage: 25 = 25%. For fixed: 25 = $25. |
| Minimum Order | Minimum cart value to apply. 0 = no minimum. |
| Max Total Uses | 0 = unlimited |
| Max Uses Per Customer | 0 = unlimited |
| Restrict to Event | Optional. Limits the coupon to one specific event. |
| Valid From / Valid Until | Optional date range. Leave blank for always active. |
| Status | Active / Inactive |

To deactivate a coupon mid-campaign, set Status to Inactive.

### Screen: Customers (`/admin/customers.html`)
- Customer list aggregated from the `orders` table, grouped by buyer email (not Supabase auth.users)
- Search by email or name
- Shows: email, name, total orders, total spent
- Click a customer to see their full order history and attendee records
- Export CSV button downloads all customers
- No edit capability -- customer data is derived from order records

### Screen: Scan (`/admin/scan.html`)
- Mobile-optimized QR code scanner for event check-in
- Designed to run on a phone at the door
- Flow: select the event from the dropdown, tap Start Scanning, point camera at ticket QR code
- On scan: validates ticket against Supabase, marks as checked-in, shows green (valid) or red (invalid/already used)
- Requires an active internet connection (no offline mode)
- Tip: load the page and select the event before arriving at the venue to avoid connectivity issues at the door

### Screen: Messages (`/admin/messages.html`)
**Not yet active.** Twilio integration is in-progress. Do not use this screen. No messages will be sent.

---

## CLAUDE.md Documentation Section (after update)

```
## Documentation

- Architecture overview: `docs/architecture.md`
- Adding a new event: `docs/runbooks/new-event.md`
- Deploying to VPS: `docs/runbooks/deploy.md`
- Admin panel guide: `docs/runbooks/admin-guide.md`
- ADR: Why Supabase: `docs/decisions/ADR-001-supabase-backend.md`
```

---

## Files Changed

| File | Action |
|------|--------|
| `CLAUDE.md` | Slim: remove Event Management section and Rules. Keep deploy, brand, supabase, docs. |
| `docs/runbooks/admin-guide.md` | Create new |
| `docs/architecture.md` | No changes needed (schema already there) |
| `docs/runbooks/new-event.md` | (1) Fix volume_discount field names: change `threshold` → `min_qty` and `discount_bps` → `discount_pct`. (2) Add "Updating Events" section with the PATCH curl command (currently only in CLAUDE.md, has no doc home). (3) Add "Cancelling/Completing Events" section. |
