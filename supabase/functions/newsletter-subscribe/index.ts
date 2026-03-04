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
    // Main flow: subscribe to newsletter
    const { name, last_name, email } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Insert into Supabase newsletter_subscribers table
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error: dbError } = await supabase
      .from('newsletter_subscribers')
      .upsert(
        { name: name || '', last_name: last_name || '', email },
        { onConflict: 'email' }
      );

    if (dbError) {
      console.error('DB insert error:', dbError);
    }

    // 2. Upsert subscriber in Mailerlite
    const mailerliteToken = Deno.env.get('MAILERLITE_API_TOKEN');
    if (!mailerliteToken) {
      return new Response(
        JSON.stringify({ success: true, mailerlite: false, message: 'Saved locally, Mailerlite not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subscriberRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mailerliteToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        fields: {
          name: name || '',
          last_name: last_name || '',
        },
        status: 'active',
      }),
    });

    if (!subscriberRes.ok) {
      const errBody = await subscriberRes.text();
      console.error('Mailerlite subscriber upsert failed:', subscriberRes.status, errBody);
      return new Response(
        JSON.stringify({ success: true, mailerlite: false, error: `Mailerlite error: ${subscriberRes.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subData = await subscriberRes.json();
    const subscriberId = subData?.data?.id;

    // 3. Add to newsletter group
    const groupId = Deno.env.get('MAILERLITE_NEWSLETTER_GROUP_ID');
    if (groupId && subscriberId) {
      const groupRes = await fetch(
        `https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${groupId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mailerliteToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!groupRes.ok) {
        const errBody = await groupRes.text();
        console.error('Mailerlite group add failed:', groupRes.status, errBody);
      } else {
        console.log(`Added ${email} to newsletter group ${groupId}`);
      }
    } else if (!groupId) {
      console.log('No MAILERLITE_NEWSLETTER_GROUP_ID set. Subscriber upserted without group assignment.');
    }

    return new Response(
      JSON.stringify({ success: true, mailerlite: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('newsletter-subscribe error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
