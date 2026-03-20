# MailerLite Event-Specific Groups -- Auto-Sync Ticket Buyers

**Date:** 2026-03-10
**Status:** Approved

## Problem

When tickets are purchased on mixler.ca, buyer and attendee emails are added to a single generic MailerLite group. There is no way to email only the people attending a specific event (e.g. "Launchpad") without manual work.

## Solution

Auto-create a MailerLite group per event. When tickets are purchased, add the buyer and all friend attendees to that event's group automatically.

## Changes

### 1. Database: New column on `events`

Add `mailerlite_group_id TEXT` to the `events` table. Stores the MailerLite group ID returned by their API.

### 2. New Edge Function: `create-mailerlite-group`

- Input: `event_id`
- Fetches event title and date from Supabase
- Calls MailerLite API `POST /api/groups` with name derived from event (e.g. "Puppy Yoga Apr 2026")
- Saves returned group ID back to `events.mailerlite_group_id`
- Called after event creation by the Event Agent workflow
- Idempotent: if `mailerlite_group_id` already set, skips creation

### 3. Modify `send-order-email` Edge Function

After existing subscriber upsert and generic group assignment, add:

- Read `mailerlite_group_id` from the event record (already fetched via order join)
- If set, add buyer's MailerLite subscriber ID to the event-specific group
- For each friend attendee with an email, also add them to the event-specific group

No new API calls beyond the group assignment (subscriber upsert already happens).

### 4. Update Event Agent CLAUDE.md

Add step to event creation workflow: after inserting event + ticket type, call `create-mailerlite-group` function.

### 5. Backfill existing events

Run `create-mailerlite-group` once for each existing published event. Existing attendees can be backfilled by querying the `attendees` table and upserting them to the new groups.

## Data Flow

```
Event created
  -> create-mailerlite-group
  -> MailerLite API creates group "Event Name Mon YYYY"
  -> group ID saved to events.mailerlite_group_id

Ticket purchased
  -> stripe-webhook triggers send-order-email
  -> send-order-email upserts buyer to MailerLite (existing)
  -> adds buyer to generic order group (existing)
  -> adds buyer to event-specific group (NEW)
  -> upserts friend attendee emails (existing)
  -> adds friends to event-specific group (NEW)
```

## What Does NOT Change

- Checkout flow and latency (group assignment is post-payment)
- Stripe integration
- Generic order confirmation group (retained for cross-event marketing)
- Admin UI
- Newsletter subscription flow

## MailerLite Setup Required

None. Groups are created automatically via the API.

## Files Affected

| File | Change |
|------|--------|
| `supabase/migrations/` | New migration adding `mailerlite_group_id` column |
| `supabase/functions/create-mailerlite-group/index.ts` | New Edge Function |
| `supabase/functions/send-order-email/index.ts` | Add event group assignment for buyer + friends |
| `~/mixler-events/CLAUDE.md` | Add group creation step to event workflow |
