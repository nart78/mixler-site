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

    const htmlBody = `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
        <div style="background: #153db6; padding: 32px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 28px; margin: 0; font-family: 'League Spartan', Arial, sans-serif;">MIXLER</h1>
        </div>
        <div style="padding: 32px 24px;">
          <h2 style="color: #153db6; font-size: 22px; margin: 0 0 12px;">Your Ticket is Here!</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #374151;">
            Hey ${firstName}, your ticket for <strong>${event_title || 'the event'}</strong> is attached as a PDF.
          </p>
          <p style="font-size: 15px; line-height: 1.6; color: #374151;">
            Show the QR code on the attached ticket at the door for entry.
          </p>
          ${order_number ? `<p style="font-size: 13px; color: #9ca3af; margin-top: 24px;">Order #${order_number}</p>` : ''}
        </div>
        <div style="background: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af;">
          <a href="https://staging.mixler.ca" style="color: #153db6; text-decoration: none;">staging.mixler.ca</a>
        </div>
      </div>
    `;

    const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS') || 'Mixler <tickets@staging.mixler.ca>';

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
