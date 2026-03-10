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

    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(
        JSON.stringify({ error: 'order_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch order with event and attendees
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, events(title, event_date, start_time, end_time, location_name, location_address)')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: attendees } = await supabase
      .from('attendees')
      .select('full_name, email, qr_code, ticket_types(name)')
      .eq('order_id', order_id);

    const event = order.events;
    const recipientEmail = order.buyer_email;
    const recipientName = order.buyer_name;

    // Format helpers
    const formatDate = (d: string) => {
      const date = new Date(d + 'T00:00:00');
      return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    };
    const formatTime = (t: string) => {
      const [h, m] = t.split(':');
      const date = new Date();
      date.setHours(+h, +m);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };
    const formatPrice = (cents: number) => '$' + (cents / 100).toFixed(2);

    // Build attendee list HTML
    const attendeeListHtml = (attendees || []).map((a: any, i: number) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${a.full_name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${a.ticket_types?.name || 'General'}</td>
      </tr>`
    ).join('');

    const timeStr = formatTime(event.start_time) + (event.end_time ? ' - ' + formatTime(event.end_time) : '');
    const location = [event.location_name, event.location_address].filter(Boolean).join(', ');
    const confirmationUrl = `https://staging.mixler.ca/order-confirmation.html?order=${order.order_number}`;

    // Mailerlite API - upsert subscriber with order data
    const mailerliteToken = Deno.env.get('MAILERLITE_API_TOKEN');

    let emailStatus = 'pending';
    let errorMessage = '';

    if (mailerliteToken) {
      try {
        // Upsert subscriber with custom fields
        const subscriberRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mailerliteToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: recipientEmail,
            fields: {
              name: recipientName.split(' ')[0],
              last_name: recipientName.split(' ').slice(1).join(' '),
              order_number: order.order_number,
              event_name: event.title,
              event_date: formatDate(event.event_date),
              event_time: timeStr,
              event_location: location,
              ticket_count: String(order.quantity),
              total_paid: formatPrice(order.total_cents),
              confirmation_url: confirmationUrl,
            },
            status: 'active',
          }),
        });

        if (!subscriberRes.ok) {
          const errBody = await subscriberRes.text();
          console.error('Mailerlite subscriber upsert failed:', errBody);
          errorMessage = `Mailerlite subscriber error: ${subscriberRes.status}`;
        }

        // Add to order confirmation group if configured
        const orderGroupId = Deno.env.get('MAILERLITE_ORDER_CONFIRM_GROUP_ID');
        if (orderGroupId && subscriberRes.ok) {
          const subData = await subscriberRes.json();
          const subscriberId = subData?.data?.id;

          if (subscriberId) {
            const groupRes = await fetch(
              `https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${orderGroupId}`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${mailerliteToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (groupRes.ok) {
              emailStatus = 'sent';
              console.log(`Added ${recipientEmail} to order confirmation group`);
            } else {
              const errBody = await groupRes.text();
              console.error('Mailerlite group add failed:', errBody);
              errorMessage = `Group add failed: ${groupRes.status}`;
            }
          }
        } else if (!orderGroupId) {
          // No group configured, just mark as sent since subscriber was upserted
          emailStatus = subscriberRes.ok ? 'sent' : 'failed';
          if (!subscriberRes.ok) emailStatus = 'failed';
          console.log('No MAILERLITE_ORDER_CONFIRM_GROUP_ID set. Subscriber upserted, automation trigger skipped.');
        }

        // Upsert additional attendees (friends) who provided an email
        const attendeeEmails = (attendees || [])
          .filter((a: any) => a.email && a.email.toLowerCase() !== recipientEmail.toLowerCase())
          .map((a: any) => ({ email: a.email, name: a.full_name }));

        for (const attendee of attendeeEmails) {
          try {
            const nameParts = attendee.name.trim().split(/\s+/);
            const attRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${mailerliteToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                email: attendee.email,
                fields: {
                  name: nameParts[0] || '',
                  last_name: nameParts.slice(1).join(' ') || '',
                  event_name: event.title,
                  event_date: formatDate(event.event_date),
                },
                status: 'active',
              }),
            });

            if (attRes.ok && orderGroupId) {
              const attData = await attRes.json();
              const attSubId = attData?.data?.id;
              if (attSubId) {
                await fetch(
                  `https://connect.mailerlite.com/api/subscribers/${attSubId}/groups/${orderGroupId}`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${mailerliteToken}`,
                      'Content-Type': 'application/json',
                    },
                  }
                );
              }
              console.log(`Added attendee ${attendee.email} to Mailerlite`);
            } else if (!attRes.ok) {
              const errBody = await attRes.text();
              console.error(`Mailerlite attendee upsert failed for ${attendee.email}:`, errBody);
            }
          } catch (attErr: any) {
            console.error(`Mailerlite attendee error for ${attendee.email}:`, attErr.message);
          }
        }
      } catch (mailErr: any) {
        console.error('Mailerlite API error:', mailErr);
        errorMessage = mailErr.message;
        emailStatus = 'failed';
      }
    } else {
      console.log('No MAILERLITE_API_TOKEN set. Skipping email send.');
      errorMessage = 'Mailerlite not configured';
    }

    // Log to email_log
    await supabase.from('email_log').insert({
      id: crypto.randomUUID(),
      event_id: order.event_id,
      order_id: order.id,
      recipient_email: recipientEmail,
      template_name: 'order_confirmation',
      subject: `Your tickets for ${event.title} - Order ${order.order_number}`,
      status: emailStatus,
      error_message: errorMessage || null,
      sent_at: emailStatus === 'sent' ? new Date().toISOString() : null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        email_status: emailStatus,
        recipient: recipientEmail,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('send-order-email error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
