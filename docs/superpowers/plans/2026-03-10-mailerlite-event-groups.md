# MailerLite Event-Specific Groups Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create a MailerLite group per event and add all ticket buyers + friend attendees to the event's group at purchase time.

**Architecture:** Add a `mailerlite_group_id` column to `events`. New Edge Function creates the group via MailerLite API on event creation. Existing `send-order-email` gets extended to assign subscribers to the event-specific group alongside the existing generic group.

**Tech Stack:** Supabase (Postgres + Edge Functions/Deno), MailerLite REST API v2

**Spec:** `docs/superpowers/specs/2026-03-10-mailerlite-event-groups-design.md`

---

## Chunk 1: Database + Edge Function + send-order-email modification

### Task 1: Add `mailerlite_group_id` column to events table

**Files:**
- Create: `supabase/migrations/004_mailerlite_group_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add MailerLite group ID column to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS mailerlite_group_id TEXT;

COMMENT ON COLUMN events.mailerlite_group_id IS 'MailerLite group ID for event-specific subscriber list, auto-created on event creation';
```

- [ ] **Step 2: Apply the migration to Supabase**

Run against the Supabase project using the service role key:

```bash
source ~/mixler-site/.env
curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "ALTER TABLE events ADD COLUMN IF NOT EXISTS mailerlite_group_id TEXT;"}'
```

If RPC isn't available, run the SQL directly via the Supabase Dashboard SQL editor.

- [ ] **Step 3: Verify the column exists**

```bash
source ~/mixler-site/.env
curl -s "${SUPABASE_URL}/rest/v1/events?select=mailerlite_group_id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}"
```

Expected: JSON response (not an error about unknown column).

- [ ] **Step 4: Commit**

```bash
cd ~/mixler-site
git add supabase/migrations/004_mailerlite_group_id.sql
git commit -m "feat: add mailerlite_group_id column to events table"
```

---

### Task 2: Create `create-mailerlite-group` Edge Function

**Files:**
- Create: `supabase/functions/create-mailerlite-group/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const mailerliteToken = Deno.env.get('MAILERLITE_API_TOKEN');
    if (!mailerliteToken) {
      return new Response(
        JSON.stringify({ error: 'MAILERLITE_API_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { event_id } = await req.json();
    if (!event_id) {
      return new Response(
        JSON.stringify({ error: 'event_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, event_date, mailerlite_group_id')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: 'Event not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Idempotent: skip if group already exists
    if (event.mailerlite_group_id) {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          group_id: event.mailerlite_group_id,
          message: 'Group already exists for this event',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build group name: "Event Title Mon YYYY"
    const date = new Date(event.event_date + 'T00:00:00');
    const monthYear = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const groupName = `${event.title} ${monthYear}`;

    // Create group in MailerLite
    const createRes = await fetch('https://connect.mailerlite.com/api/groups', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mailerliteToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: groupName }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error('MailerLite group creation failed:', errBody);
      return new Response(
        JSON.stringify({ error: `MailerLite API error: ${createRes.status}`, details: errBody }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const groupData = await createRes.json();
    const groupId = groupData?.data?.id;

    if (!groupId) {
      return new Response(
        JSON.stringify({ error: 'No group ID returned from MailerLite' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save group ID back to event
    const { error: updateError } = await supabase
      .from('events')
      .update({ mailerlite_group_id: String(groupId) })
      .eq('id', event_id);

    if (updateError) {
      console.error('Failed to save group ID to event:', updateError);
      return new Response(
        JSON.stringify({ error: 'Group created but failed to save ID to event', group_id: groupId }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Created MailerLite group "${groupName}" (${groupId}) for event ${event.title}`);

    return new Response(
      JSON.stringify({
        success: true,
        group_id: String(groupId),
        group_name: groupName,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('create-mailerlite-group error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 2: Deploy the Edge Function**

```bash
cd ~/mixler-site
npx supabase functions deploy create-mailerlite-group --no-verify-jwt
```

- [ ] **Step 3: Test with an existing event**

Get an event ID from Supabase, then call the function:

```bash
source ~/mixler-site/.env
# Get a published event ID
EVENT_ID=$(curl -s "${SUPABASE_URL}/rest/v1/events?status=eq.published&select=id,title&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

echo "Testing with event: $EVENT_ID"

curl -s -X POST "${SUPABASE_URL}/functions/v1/create-mailerlite-group" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"event_id\": \"$EVENT_ID\"}"
```

Expected: `{"success": true, "group_id": "...", "group_name": "..."}`

- [ ] **Step 4: Verify idempotency (run again)**

Run the same curl command again.

Expected: `{"success": true, "skipped": true, "group_id": "...", "message": "Group already exists for this event"}`

- [ ] **Step 5: Verify group ID saved to event row**

```bash
source ~/mixler-site/.env
curl -s "${SUPABASE_URL}/rest/v1/events?id=eq.${EVENT_ID}&select=title,mailerlite_group_id" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}"
```

Expected: JSON with `mailerlite_group_id` populated.

- [ ] **Step 6: Commit**

```bash
cd ~/mixler-site
git add supabase/functions/create-mailerlite-group/index.ts
git commit -m "feat: add create-mailerlite-group Edge Function"
```

---

### Task 3: Modify `send-order-email` to add subscribers to event-specific group

**Files:**
- Modify: `supabase/functions/send-order-email/index.ts`

The key changes:
1. Add `mailerlite_group_id` to the event fields fetched from the order join
2. After adding buyer to generic group, also add to event group
3. After adding each friend attendee to generic group, also add to event group

- [ ] **Step 1: Update the order query to include `mailerlite_group_id`**

Change line 32 from:

```typescript
      .select('*, events(title, event_date, start_time, end_time, location_name, location_address)')
```

to:

```typescript
      .select('*, events(title, event_date, start_time, end_time, location_name, location_address, mailerlite_group_id)')
```

- [ ] **Step 2: Add event group assignment for the buyer**

After the block that adds the buyer to the generic order confirmation group (after line 148), insert a helper function and add the buyer to the event group. Insert after line 148 (the `console.log` about no group configured):

```typescript
        // Helper: add subscriber to event-specific group
        const eventGroupId = event.mailerlite_group_id;
        const addToEventGroup = async (subscriberId: string) => {
          if (!eventGroupId || !subscriberId) return;
          try {
            const res = await fetch(
              `https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${eventGroupId}`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${mailerliteToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            if (res.ok) {
              console.log(`Added subscriber ${subscriberId} to event group ${eventGroupId}`);
            } else {
              const errBody = await res.text();
              console.error(`Event group add failed for ${subscriberId}:`, errBody);
            }
          } catch (err: any) {
            console.error(`Event group add error for ${subscriberId}:`, err.message);
          }
        };
```

Then, right after the buyer is added to the generic order confirmation group (after the `subscriberId` is obtained around line 122), add:

```typescript
            // Add buyer to event-specific group
            await addToEventGroup(subscriberId);
```

- [ ] **Step 3: Add event group assignment for friend attendees**

Inside the `for (const attendee of attendeeEmails)` loop, after the friend is added to the generic order group (around line 189), add:

```typescript
                // Add friend to event-specific group
                await addToEventGroup(attSubId);
```

- [ ] **Step 4: Deploy the updated function**

```bash
cd ~/mixler-site
npx supabase functions deploy send-order-email --no-verify-jwt
```

- [ ] **Step 5: Verify by checking Supabase function logs**

The next ticket purchase on any event with a `mailerlite_group_id` set will log:
`Added subscriber <id> to event group <group_id>`

Check logs:
```bash
npx supabase functions logs send-order-email --limit 20
```

- [ ] **Step 6: Commit**

```bash
cd ~/mixler-site
git add supabase/functions/send-order-email/index.ts
git commit -m "feat: add ticket buyers to event-specific MailerLite group"
```

---

### Task 4: Backfill existing published events

**Files:** None (one-time script run)

- [ ] **Step 1: Create MailerLite groups for all published events**

```bash
source ~/mixler-site/.env
# Get all published events without a mailerlite_group_id
EVENTS=$(curl -s "${SUPABASE_URL}/rest/v1/events?status=eq.published&mailerlite_group_id=is.null&select=id,title" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}")

echo "$EVENTS" | python3 -c "
import sys, json
events = json.load(sys.stdin)
print(f'Found {len(events)} events to backfill')
for e in events:
    print(f'  - {e[\"title\"]} ({e[\"id\"]})')
"
```

Then for each event, call the Edge Function:

```bash
echo "$EVENTS" | python3 -c "
import sys, json, subprocess
events = json.load(sys.stdin)
for e in events:
    print(f'Creating group for: {e[\"title\"]}')
    # Call will be done via curl in the next step
    print(e['id'])
" | while read EVENT_ID; do
  curl -s -X POST "${SUPABASE_URL}/functions/v1/create-mailerlite-group" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"event_id\": \"$EVENT_ID\"}"
  echo ""
done
```

- [ ] **Step 2: Verify all published events now have group IDs**

```bash
source ~/mixler-site/.env
curl -s "${SUPABASE_URL}/rest/v1/events?status=eq.published&select=title,mailerlite_group_id" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

Expected: All published events show a `mailerlite_group_id` value.

---

### Task 5: Update Event Agent CLAUDE.md

**Files:**
- Modify: `~/mixler-events/CLAUDE.md`

- [ ] **Step 1: Add MailerLite group creation step to the Event Creation Workflow**

After step 6 (Create ticket type), add a new step 7:

```markdown
7. **Create MailerLite group** for the event (so ticket buyers are auto-added to an event-specific email list):
   ```bash
   source ~/mixler-site/.env
   curl -s -X POST "${SUPABASE_URL}/functions/v1/create-mailerlite-group" \
     -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"event_id": "<new event UUID>"}'
   ```
   Verify the response contains `"success": true` and a `group_id`.
```

Renumber subsequent steps (old 7 becomes 8, old 8 becomes 9, etc.).

- [ ] **Step 2: Commit**

```bash
cd ~/mixler-events
git add CLAUDE.md
git commit -m "docs: add MailerLite group creation step to event workflow"
```

---

### Task 6: Final push

- [ ] **Step 1: Push all commits**

```bash
cd ~/mixler-site && git push
cd ~/mixler-events && git push
```
