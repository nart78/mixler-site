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

    const now = new Date().toISOString();

    // Fetch pending messages that are due
    const { data: messages, error: msgError } = await supabase
      .from('scheduled_messages')
      .select('*, events(title, event_date, start_time, location_name)')
      .eq('status', 'pending')
      .lte('send_at', now)
      .limit(50);

    if (msgError) {
      console.error('Error fetching messages:', msgError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch messages' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No pending messages' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mailerliteToken = Deno.env.get('MAILERLITE_API_TOKEN');
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFrom = Deno.env.get('TWILIO_FROM_NUMBER');

    let processed = 0;
    let errors = 0;

    for (const msg of messages) {
      try {
        // Mark as processing
        await supabase
          .from('scheduled_messages')
          .update({ status: 'sent' })
          .eq('id', msg.id);

        // Get attendees for this event (completed orders only)
        const { data: attendees } = await supabase
          .from('attendees')
          .select('id, full_name, email, phone, orders!inner(payment_status)')
          .eq('event_id', msg.event_id)
          .eq('orders.payment_status', 'completed');

        if (!attendees || attendees.length === 0) {
          console.log(`No attendees for message ${msg.id}`);
          processed++;
          continue;
        }

        // Replace template variables in message body
        const event = msg.events;
        const replaceVars = (text: string, attendee: any) => {
          return text
            .replace(/\{name\}/g, attendee.full_name || '')
            .replace(/\{event\}/g, event?.title || '')
            .replace(/\{date\}/g, event?.event_date || '')
            .replace(/\{time\}/g, event?.start_time || '')
            .replace(/\{venue\}/g, event?.location_name || '');
        };

        for (const attendee of attendees) {
          const messageBody = replaceVars(msg.message_body, attendee);
          let logStatus = 'pending';
          let twilioSidResult = null;
          let logError = null;

          if (msg.type === 'email' && attendee.email) {
            // Send email via Mailerlite (upsert subscriber + trigger)
            if (mailerliteToken) {
              try {
                const nameParts = (attendee.full_name || '').split(' ');
                await fetch('https://connect.mailerlite.com/api/subscribers', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${mailerliteToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    email: attendee.email,
                    fields: {
                      name: nameParts[0] || '',
                      last_name: nameParts.slice(1).join(' '),
                      event_name: event?.title || '',
                      event_date: event?.event_date || '',
                      event_time: event?.start_time || '',
                      event_location: event?.location_name || '',
                    },
                    status: 'active',
                  }),
                });

                // If a reminder group ID is configured, add to it
                const reminderGroupId = Deno.env.get('MAILERLITE_REMINDER_GROUP_ID');
                if (reminderGroupId) {
                  // Get subscriber ID first
                  const subRes = await fetch(
                    `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(attendee.email)}`,
                    {
                      headers: { 'Authorization': `Bearer ${mailerliteToken}` },
                    }
                  );
                  if (subRes.ok) {
                    const subData = await subRes.json();
                    await fetch(
                      `https://connect.mailerlite.com/api/subscribers/${subData.data.id}/groups/${reminderGroupId}`,
                      {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${mailerliteToken}`,
                          'Content-Type': 'application/json',
                        },
                      }
                    );
                  }
                }

                logStatus = 'sent';
              } catch (emailErr: any) {
                logError = emailErr.message;
                logStatus = 'failed';
              }
            } else {
              logError = 'Mailerlite not configured';
            }
          } else if (msg.type === 'sms' && attendee.phone) {
            // Send SMS via Twilio
            if (twilioSid && twilioToken && twilioFrom) {
              try {
                const twilioRes = await fetch(
                  `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
                      'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                      To: attendee.phone,
                      From: twilioFrom,
                      Body: messageBody,
                    }).toString(),
                  }
                );

                if (twilioRes.ok) {
                  const twilioData = await twilioRes.json();
                  twilioSidResult = twilioData.sid;
                  logStatus = 'sent';
                } else {
                  const errBody = await twilioRes.text();
                  logError = `Twilio error ${twilioRes.status}: ${errBody}`;
                  logStatus = 'failed';
                }
              } catch (smsErr: any) {
                logError = smsErr.message;
                logStatus = 'failed';
              }
            } else {
              logError = 'Twilio not configured';
            }
          } else {
            logError = msg.type === 'sms' ? 'No phone number' : 'No email address';
          }

          // Log to message_log
          await supabase.from('message_log').insert({
            id: crypto.randomUUID(),
            scheduled_message_id: msg.id,
            attendee_id: attendee.id,
            status: logStatus,
            twilio_sid: twilioSidResult,
            error_message: logError,
            sent_at: logStatus === 'sent' ? new Date().toISOString() : null,
          });
        }

        processed++;
      } catch (msgErr: any) {
        console.error(`Error processing message ${msg.id}:`, msgErr);
        errors++;

        // Mark message as failed
        await supabase
          .from('scheduled_messages')
          .update({ status: 'failed' })
          .eq('id', msg.id);
      }
    }

    return new Response(
      JSON.stringify({ processed, errors, total: messages.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('send-scheduled-messages error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
