import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DELAY_MINUTES = 15;

serve(async (req) => {
  // Only callable server-to-server (cron). No CORS headers needed.
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const cutoff = new Date(Date.now() - DELAY_MINUTES * 60 * 1000).toISOString();

    // Find cancelled events whose 15-minute window has passed and email not yet sent
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, title, event_date, start_time, end_time, location_name, cancellation_reason')
      .eq('status', 'cancelled')
      .eq('cancellation_email_sent', false)
      .not('cancellation_scheduled_at', 'is', null)
      .lte('cancellation_scheduled_at', cutoff);

    if (eventsError) throw eventsError;

    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) throw new Error('RESEND_API_KEY not configured');

    const formatDate = (d: string) => {
      const date = new Date(d + 'T00:00:00');
      return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    };
    const formatTime = (t: string) => {
      const [h, m] = t.split(':');
      const d = new Date();
      d.setHours(+h, +m);
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    let totalSent = 0;
    let totalFailed = 0;

    for (const event of events) {
      // Mark as sent immediately to prevent double-sends if cron overlaps
      await supabase
        .from('events')
        .update({ cancellation_email_sent: true })
        .eq('id', event.id);

      // Fetch all paid orders for this event
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, buyer_email, buyer_name, order_number, quantity, total_cents')
        .eq('event_id', event.id)
        .eq('payment_status', 'completed');

      if (ordersError) {
        console.error(`Failed to fetch orders for event ${event.id}:`, ordersError);
        continue;
      }

      if (!orders || orders.length === 0) {
        console.log(`Event ${event.id}: no paid orders, skipping email send.`);
        continue;
      }

      const eventDate = formatDate(event.event_date);
      const timeStr = formatTime(event.start_time) + (event.end_time ? ' - ' + formatTime(event.end_time) : '');
      const location = event.location_name || '';

      const reasonBlock = event.cancellation_reason
        ? `<div style="background:#f5f5f7;border-left:4px solid #153db6;border-radius:4px;padding:16px 20px;margin:24px 0 0;"><p style="margin:0;font-size:15px;color:#444444;line-height:1.6;">${event.cancellation_reason}</p></div>`
        : '';

      for (const order of orders) {
        const firstName = order.buyer_name.split(' ')[0];
        const dateLocation = location
          ? `<strong>${eventDate} at ${timeStr}</strong> at ${location}`
          : `<strong>${eventDate} at ${timeStr}</strong>`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${event.title} has been cancelled</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f7;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="background:#153db6;padding:28px 40px;text-align:center;">
              <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">mixler</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#ff3465;text-transform:uppercase;letter-spacing:1.5px;">Event Update</p>
              <h1 style="margin:0 0 28px;font-size:26px;font-weight:800;color:#111111;line-height:1.2;">${event.title} has been cancelled</h1>

              <p style="margin:0 0 16px;font-size:16px;color:#444444;line-height:1.6;">Hey ${firstName},</p>
              <p style="margin:0 0 0;font-size:16px;color:#444444;line-height:1.6;">We're sorry to let you know that <strong>${event.title}</strong>, scheduled for ${dateLocation}, won't be going ahead.</p>

              ${reasonBlock}

              <div style="background:#eff6ff;border-radius:12px;padding:24px;margin:28px 0;">
                <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#153db6;">Your refund</p>
                <p style="margin:0;font-size:15px;color:#444444;line-height:1.6;">If you purchased tickets, your full refund will be processed to your original payment method within 5-10 business days. If you have any questions, just reply to this email and we'll sort it out.</p>
              </div>

              <p style="margin:0 0 32px;font-size:16px;color:#444444;line-height:1.6;">We hope to see you at a future Mixler event. There's always something worth showing up for.</p>

              <a href="https://mixler.ca/events.html" style="display:inline-block;background:#153db6;color:#ffffff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:50px;text-decoration:none;">Browse upcoming events</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #eeeeee;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#999999;">Questions? Reply to this email or reach us at <a href="mailto:hello@mixler.ca" style="color:#153db6;text-decoration:none;">hello@mixler.ca</a></p>
              <p style="margin:0;font-size:12px;color:#bbbbbb;">Mixler &mdash; Calgary, AB</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Mixler <hello@mixler.ca>',
              to: [order.buyer_email],
              subject: `${event.title} has been cancelled`,
              html,
            }),
          });

          const emailStatus = res.ok ? 'sent' : 'failed';
          const errorBody = res.ok ? null : await res.text();

          if (!res.ok) {
            console.error(`Failed to send to ${order.buyer_email}:`, errorBody);
            totalFailed++;
          } else {
            totalSent++;
          }

          await supabase.from('email_log').insert({
            id: crypto.randomUUID(),
            event_id: event.id,
            order_id: order.id,
            recipient_email: order.buyer_email,
            template_name: 'event_cancellation',
            subject: `${event.title} has been cancelled`,
            status: emailStatus,
            error_message: errorBody || null,
            sent_at: res.ok ? new Date().toISOString() : null,
          });
        } catch (emailErr: any) {
          console.error(`Email error for ${order.buyer_email}:`, emailErr.message);
          totalFailed++;
        }
      }
    }

    console.log(`Cancellation cron: sent=${totalSent} failed=${totalFailed}`);
    return new Response(
      JSON.stringify({ processed: events.length, emails_sent: totalSent, emails_failed: totalFailed }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('send-cancellation-email error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
