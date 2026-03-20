# Runbook: Adding a New Event

## Prerequisites

- Supabase service key available (required for all inserts)
- Event details confirmed by Johnny
- Event image prepared and ready to upload

---

## Step 1: Gather Event Details from Johnny

Confirm all required fields before proceeding. Do not start inserting until all of these are locked:

- Title
- Date (or confirm it is TBD)
- Location (venue name + full street address)
- Start time and end time
- Description (full) and short description (1-2 sentences)
- Price (general admission, and early bird if applicable)
- Capacity
- Image (provided by Johnny or sourced from approved assets)
- Any custom fields: puppies welcome (array), volume discounts (object), etc.
- Tax rate (confirm whether to apply GST at 5%)
- Cancellation policy details

---

## Step 2: Generate the Slug

Format: `{event-name}-{month}-{year}`

Rules:
- Lowercase, hyphenated only
- Include the month and year to prevent slug collisions across recurring events
- Be specific enough to be unique

Examples:
- `pottery-night-march-2026`
- `singles-trivia-april-2026`
- `puppy-yoga-may-2026`

---

## Step 3: Confirm All Details with Johnny

Before touching the database, present a summary of the event data and wait for explicit approval. Include: title, slug, date, time, location, price, capacity, and any custom fields. Correct any details at this stage, not after insert.

---

## Step 4: Write the Description

- Warm, inviting, casual Calgary voice
- No em dashes. Use periods or restructure sentences.
- Highlight what makes the event fun and social
- Include practical details (what to expect, what's included, what to bring)
- Short description: 1-2 punchy sentences for the event card

---

## Step 5: Handle the Event Image

1. Receive or source the event image
2. Place it at: `images/{slug}/main.jpg`
3. The `image_url` field in the database uses a relative path: `/images/{slug}/main.jpg`
4. Deploy the image to the VPS as part of the deploy step

---

## Step 6: Insert the Event Row

Use the Supabase REST API with the **service key** (anon key will be blocked by RLS).

Key field values to set:

| Field | Value |
|-------|-------|
| `slug` | Generated slug (unique) |
| `event_date` | `YYYY-MM-DD` format, or `2099-12-31` if TBD |
| `price_cents` | Dollar amount multiplied by 100. $35 = 3500 |
| `early_bird_price_cents` | Same rule. Omit if no early bird. |
| `tax_rate_bps` | Basis points. 5% GST = 500 |
| `pass_cc_fee` | Always `true` unless Johnny says otherwise |
| `status` | Set to `draft` on initial insert |
| `image_url` | `/images/{slug}/main.jpg` |

---

## Step 7: Insert the Matching ticket_types Row

**This step is critical.** Every event must have at least one row in the `ticket_types` table. Checkout reads price from `ticket_types.price_cents`. If this row is missing, checkout breaks.

Required fields:
- `event_id`: the UUID of the event just inserted
- `name`: e.g., `General Admission`
- `price_cents`: must match the event's `price_cents`
- `capacity`: total tickets available for this type

If the event has multiple ticket types (e.g., general + VIP), insert one row per type.

---

## Step 8: Handle Custom Fields

If the event has custom fields, insert them as a JSONB object in `custom_fields`.

Common patterns:
- Puppies welcome: `{"puppies": ["yes", "no"]}` (array of options for attendee to select)
- Volume discount: `{"volume_discount": {"threshold": 2, "discount_bps": 1000}}` (buy 2+, 10% off)

Confirm the exact structure with Johnny before inserting.

---

## Step 9: Create the MailerLite Group

Trigger the Supabase edge function to create the MailerLite group for this event:

- Function: `supabase/functions/create-mailerlite-group/`
- This creates a group in MailerLite named after the event
- Used to send pre-event and post-event emails to attendees

---

## Step 10: Set Status to Published

Once everything is in place and verified, update the event status:

```
status: "published"
```

Do not publish until the ticket_types row exists, the image is deployed, and the MailerLite group is created.

---

## Step 11: Deploy and Regenerate OG Images

Deploy the new image and any frontend changes:

```bash
rsync -avz \
  --exclude='.git' \
  --exclude='supabase' \
  --exclude='scripts' \
  --exclude='CLAUDE.md' \
  --exclude='seo' \
  . root@198.71.51.250:/var/www/mixler.ca/

ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"
```

OG image regeneration must run after every deploy. It generates the social share preview images for all events.

---

## Step 12: Git Commit and Push

Stage specific files only. Never use `git add -A`.

```bash
git add images/{slug}/main.jpg [any other changed files]
git commit -m "Add {event title} event"
git push origin main
```

---

## Verification Checklist

- [ ] Event appears on the events listing page
- [ ] Event detail page loads correctly with image, description, and price
- [ ] Checkout flow completes without error
- [ ] Ticket confirmation is generated
- [ ] MailerLite group exists
- [ ] OG image appears when sharing the event URL on Slack or iMessage
