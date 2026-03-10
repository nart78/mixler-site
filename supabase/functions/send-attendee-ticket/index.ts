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
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { pdf_base64, recipient_email, attendee_name, event_title, order_number } = await req.json();

    if (!pdf_base64 || !recipient_email) {
      return new Response(
        JSON.stringify({ error: 'pdf_base64 and recipient_email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient_email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firstName = (attendee_name || 'Guest').split(' ')[0];

    const siteUrl = Deno.env.get('SITE_URL') || 'https://mixler.ca';

    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; background-color: #f5f5f7; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f7; padding: 32px 0;">
          <tr><td align="center">
            <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width: 520px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">

              <!-- Logo header -->
              <tr>
                <td style="background-color: #153db6; padding: 28px 32px; text-align: center;">
                  <img src="${siteUrl}/images/mixler-white-wide.png" alt="Mixler" width="140" style="display: block; margin: 0 auto; max-width: 140px; height: auto;" />
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding: 36px 32px 32px;">
                  <h1 style="color: #ff3465; font-size: 24px; font-weight: 700; margin: 0 0 16px; line-height: 1.2;">Your Ticket is Here!</h1>
                  <p style="font-size: 15px; line-height: 1.7; color: #374151; margin: 0 0 8px;">
                    Hey ${firstName}, your ticket for <strong>${event_title || 'the event'}</strong> is attached as a PDF.
                  </p>
                  <p style="font-size: 15px; line-height: 1.7; color: #374151; margin: 0 0 24px;">
                    Show the QR code on the attached ticket at the door for entry.
                  </p>

                  <!-- Ticket info card -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f7; border-radius: 8px; border-left: 4px solid #ff3465;">
                    <tr>
                      <td style="padding: 20px 24px;">
                        <p style="font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Event</p>
                        <p style="font-size: 16px; font-weight: 700; color: #153db6; margin: 0 0 12px;">${event_title || 'Mixler Event'}</p>
                        ${order_number ? `<p style="font-size: 12px; color: #6b7280; margin: 0;">Order #${order_number}</p>` : ''}
                      </td>
                    </tr>
                  </table>

                  <p style="font-size: 13px; color: #9ca3af; margin: 24px 0 0; line-height: 1.5;">
                    Open the attached PDF and present the QR code at check-in. You can also save it to your phone for quick access.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding: 0 32px 28px; text-align: center;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr><td style="border-top: 1px solid #e5e7eb; padding-top: 20px;">
                      <p style="font-size: 12px; color: #9ca3af; margin: 0;">
                        <a href="${siteUrl}" style="color: #153db6; text-decoration: none; font-weight: 600;">mixler.ca</a>
                      </p>
                    </td></tr>
                  </table>
                </td>
              </tr>

            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;

    const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS') || 'Mixler <tickets@mixler.ca>';

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: recipient_email,
        subject: `Your Ticket for ${event_title || 'Mixler Event'}`,
        html: htmlBody,
        attachments: [
          {
            filename: `mixler-ticket-${(attendee_name || 'guest').toLowerCase().replace(/\s+/g, '-')}.pdf`,
            content: pdf_base64,
          },
        ],
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend API error:', resendData);
      return new Response(
        JSON.stringify({ error: resendData?.message || 'Failed to send email' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log to email_log
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    await supabase.from('email_log').insert({
      id: crypto.randomUUID(),
      recipient_email,
      template_name: 'attendee_ticket',
      subject: `Your Ticket for ${event_title || 'Mixler Event'}`,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, email_id: resendData.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('send-attendee-ticket error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
