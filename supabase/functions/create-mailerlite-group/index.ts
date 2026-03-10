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
