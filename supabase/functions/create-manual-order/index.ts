import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://www.mixler.ca',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify caller is an admin
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonResponse({ error: 'Authorization required' }, 401);
    }
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) {
      return jsonResponse({ error: 'Invalid auth token' }, 401);
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (!profile?.is_admin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const body = await req.json();

    // Extract and validate inputs
    const {
      event_id,
      ticket_type_id,
      quantity,
      price_per_ticket_cents,
      attendees,
      buyer,
      allow_oversell,
      send_buyer_email,
      send_attendee_emails,
    } = body;

    if (!event_id || typeof event_id !== 'string') return jsonResponse({ error: 'event_id required' }, 400);
    if (!ticket_type_id || typeof ticket_type_id !== 'string') return jsonResponse({ error: 'ticket_type_id required' }, 400);
    if (!Number.isInteger(quantity) || quantity < 1) return jsonResponse({ error: 'quantity must be a positive integer' }, 400);
    if (!Number.isInteger(price_per_ticket_cents) || price_per_ticket_cents < 0) {
      return jsonResponse({ error: 'price_per_ticket_cents must be a non-negative integer' }, 400);
    }
    if (!Array.isArray(attendees) || attendees.length !== quantity) {
      return jsonResponse({ error: 'attendees must be an array with length equal to quantity' }, 400);
    }
    for (const a of attendees) {
      if (!a?.full_name || typeof a.full_name !== 'string' || !a.full_name.trim()) {
        return jsonResponse({ error: 'Each attendee must have a non-empty full_name' }, 400);
      }
    }
    if (!buyer?.name || !buyer?.email) {
      return jsonResponse({ error: 'buyer.name and buyer.email are required' }, 400);
    }

    // Fetch event
    const { data: event, error: eventErr } = await supabase
      .from('events')
      .select('id, title, status, capacity, tickets_sold, max_tickets_per_order, tax_rate_bps, mailerlite_group_id')
      .eq('id', event_id)
      .single();
    if (eventErr || !event) return jsonResponse({ error: 'Event not found' }, 404);
    if (event.status !== 'published') return jsonResponse({ error: 'Event is not published' }, 400);

    // Fetch ticket type
    const { data: ticketType, error: ttErr } = await supabase
      .from('ticket_types')
      .select('id, name, price_cents, capacity, tickets_sold, is_active')
      .eq('id', ticket_type_id)
      .eq('event_id', event_id)
      .single();
    if (ttErr || !ticketType) return jsonResponse({ error: 'Ticket type not found for this event' }, 404);
    if (!ticketType.is_active) return jsonResponse({ error: 'Ticket type is not active' }, 400);

    // Quantity cap
    if (quantity > (event.max_tickets_per_order || 10)) {
      return jsonResponse({ error: `Maximum ${event.max_tickets_per_order || 10} tickets per order` }, 400);
    }

    // Capacity check (with oversell override)
    if (!allow_oversell) {
      if (event.capacity > 0 && (event.tickets_sold + quantity) > event.capacity) {
        return jsonResponse({
          error: `Not enough capacity. ${event.capacity - event.tickets_sold} spots remain. Set allow_oversell to override.`,
          code: 'OVER_CAPACITY',
        }, 400);
      }
      if (ticketType.capacity > 0 && (ticketType.tickets_sold + quantity) > ticketType.capacity) {
        return jsonResponse({
          error: `Not enough ticket-type capacity. ${ticketType.capacity - ticketType.tickets_sold} remain. Set allow_oversell to override.`,
          code: 'OVER_CAPACITY',
        }, 400);
      }
    }

    // Pricing
    const subtotalCents = price_per_ticket_cents * quantity;
    const taxRateBps = event.tax_rate_bps || 500;
    const taxCents = Math.round(subtotalCents * taxRateBps / 10000);
    const ccFeeCents = 0; // never applies to manual orders
    const totalCents = subtotalCents + taxCents + ccFeeCents;

    const isComp = price_per_ticket_cents === 0;
    const paymentMethod = isComp ? 'comp' : 'offline_etransfer';
    const paymentStatus = isComp ? 'completed' : 'pending';

    // Insert order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: null,
        event_id,
        ticket_type_id,
        quantity,
        subtotal_cents: subtotalCents,
        discount_cents: 0,
        tax_cents: taxCents,
        cc_fee_cents: ccFeeCents,
        total_cents: totalCents,
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        buyer_name: buyer.name,
        buyer_email: buyer.email,
        buyer_phone: buyer.phone || null,
        reserved_until: null,
        send_buyer_email_on_confirm: !!send_buyer_email,
        send_attendee_emails_on_confirm: !!send_attendee_emails,
      })
      .select()
      .single();

    if (orderErr) {
      console.error('Order insert failed:', orderErr);
      return jsonResponse({ error: 'Failed to create order', details: orderErr.message }, 500);
    }

    // Insert attendees (qr_code is auto-generated by the BEFORE INSERT trigger)
    const attendeeRows = attendees.map((a: any) => ({
      order_id: order.id,
      event_id,
      ticket_type_id,
      full_name: a.full_name.trim(),
      email: a.email?.trim() || null,
      phone: a.phone?.trim() || null,
    }));

    const { error: attErr } = await supabase.from('attendees').insert(attendeeRows);
    if (attErr) {
      console.error('Attendee insert failed:', attErr);
      await supabase.from('orders').delete().eq('id', order.id);
      return jsonResponse({ error: 'Failed to create attendees', details: attErr.message }, 500);
    }

    let mailerliteWarning: string | null = null;

    if (isComp) {
      // Comp path: fire send-order-email, which handles buyer email + MailerLite enrollment
      // for buyer and all attendees with emails in one call.
      if (send_buyer_email) {
        try {
          const emailRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-order-email`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ order_id: order.id }),
          });
          if (!emailRes.ok) {
            const errBody = await emailRes.text();
            console.error('send-order-email failed:', errBody);
            mailerliteWarning = 'Order created but confirmation email may have failed to send.';
          }
        } catch (err: any) {
          console.error('send-order-email error:', err);
          mailerliteWarning = 'Order created but confirmation email may have failed to send.';
        }
      } else {
        // Admin chose not to send the buyer email. We still need to enroll
        // buyer + attendees in the event MailerLite group.
        const warn = await enrollInMailerLite({
          mailerliteToken: Deno.env.get('MAILERLITE_API_TOKEN'),
          eventGroupId: event.mailerlite_group_id,
          buyer,
          attendees,
        });
        if (warn) mailerliteWarning = warn;
      }

      return jsonResponse({
        ok: true,
        order_id: order.id,
        order_number: order.order_number,
        status: 'completed',
        payment_method: 'comp',
        send_attendee_emails,
        mailerlite_warning: mailerliteWarning,
      }, 200);
    }

    // E-transfer path: order sits pending. No emails fire. Enroll in MailerLite immediately
    // so the buyer and attendees land on the event mailing list regardless of payment status.
    const warn = await enrollInMailerLite({
      mailerliteToken: Deno.env.get('MAILERLITE_API_TOKEN'),
      eventGroupId: event.mailerlite_group_id,
      buyer,
      attendees,
    });
    if (warn) mailerliteWarning = warn;

    return jsonResponse({
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      status: 'pending',
      payment_method: 'offline_etransfer',
      total_cents: totalCents,
      mailerlite_warning: mailerliteWarning,
    }, 200);

  } catch (err: any) {
    console.error('create-manual-order error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500);
  }
});

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
