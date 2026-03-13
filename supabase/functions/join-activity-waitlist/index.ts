import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, activity_slug, activity_name } = await req.json();

    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'Valid email required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!activity_slug || !activity_name) {
      return new Response(
        JSON.stringify({ error: 'activity_slug and activity_name required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const mailerliteToken = Deno.env.get('MAILERLITE_API_TOKEN');

    // 1. Insert into activity_waitlist (demand analytics)
    const { error: insertError } = await supabase
      .from('activity_waitlist')
      .insert({ email, activity_slug, activity_name });

    if (insertError) {
      console.error('activity_waitlist insert error:', insertError);
      // Non-fatal: continue to MailerLite
    }

    if (!mailerliteToken) {
      console.log('MAILERLITE_API_TOKEN not set -- skipping MailerLite subscription');
      return new Response(
        JSON.stringify({ success: true, mailerlite: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get or create MailerLite group for this activity
    let groupId: string | null = null;

    const { data: existingGroup } = await supabase
      .from('activity_waitlist_groups')
      .select('mailerlite_group_id')
      .eq('activity_slug', activity_slug)
      .single();

    if (existingGroup?.mailerlite_group_id) {
      groupId = existingGroup.mailerlite_group_id;
    } else {
      // Create new group in MailerLite
      const groupName = `Waitlist: ${activity_name} Calgary`;
      const createRes = await fetch('https://connect.mailerlite.com/api/groups', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mailerliteToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: groupName }),
      });

      if (createRes.ok) {
        const groupData = await createRes.json();
        groupId = groupData?.data?.id ? String(groupData.data.id) : null;

        if (groupId) {
          await supabase
            .from('activity_waitlist_groups')
            .insert({ activity_slug, activity_name, mailerlite_group_id: groupId });
        }
      } else {
        const errBody = await createRes.text();
        console.error('MailerLite group creation failed:', errBody);
      }
    }

    // 3. Upsert subscriber in MailerLite
    const subscriberRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mailerliteToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, status: 'active' }),
    });

    if (!subscriberRes.ok) {
      const errBody = await subscriberRes.text();
      console.error('MailerLite subscriber upsert failed:', errBody);
      return new Response(
        JSON.stringify({ success: true, mailerlite: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subData = await subscriberRes.json();
    const subscriberId = subData?.data?.id;

    // 4. Add subscriber to the activity's waitlist group
    if (groupId && subscriberId) {
      const groupAddRes = await fetch(
        `https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${groupId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mailerliteToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!groupAddRes.ok) {
        const errBody = await groupAddRes.text();
        console.error('MailerLite group add failed:', errBody);
      } else {
        console.log(`Added ${email} to waitlist group for ${activity_slug}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, mailerlite: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('join-activity-waitlist error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
