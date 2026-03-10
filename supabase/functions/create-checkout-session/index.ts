import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const {
      event_slug,
      ticket_type_id,
      quantity,
      attendees,
      coupon_code,
      buyer_name,
      buyer_email,
      buyer_phone,
    } = await req.json();

    // Validate required fields
    if (!event_slug || !quantity || !attendees || !buyer_name || !buyer_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate attendees have names
    if (!Array.isArray(attendees) || attendees.length !== quantity) {
      return new Response(
        JSON.stringify({ error: 'Attendee count must match quantity' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    for (const a of attendees) {
      if (!a.full_name || !a.full_name.trim()) {
        return new Response(
          JSON.stringify({ error: 'Each attendee must have a name' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Fetch event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('slug', event_slug)
      .eq('status', 'published')
      .single();

    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: 'Event not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check max tickets per order
    if (quantity > (event.max_tickets_per_order || 10)) {
      return new Response(
        JSON.stringify({ error: `Maximum ${event.max_tickets_per_order || 10} tickets per order` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine pricing from ticket type or event
    let pricePerTicketCents = event.price_cents;
    let ticketTypeName = 'General Admission';
    let ticketTypeRecord = null;

    if (ticket_type_id) {
      const { data: tt, error: ttError } = await supabase
        .from('ticket_types')
        .select('*')
        .eq('id', ticket_type_id)
        .eq('event_id', event.id)
        .eq('is_active', true)
        .single();

      if (ttError || !tt) {
        return new Response(
          JSON.stringify({ error: 'Ticket type not found or unavailable' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check ticket type capacity
      if (tt.capacity > 0 && (tt.tickets_sold + quantity) > tt.capacity) {
        return new Response(
          JSON.stringify({ error: `Only ${tt.capacity - tt.tickets_sold} tickets of this type remain` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check sales window
      const now = new Date();
      if (tt.sales_start && new Date(tt.sales_start) > now) {
        return new Response(
          JSON.stringify({ error: 'Ticket sales have not started yet' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (tt.sales_end && new Date(tt.sales_end) < now) {
        return new Response(
          JSON.stringify({ error: 'Ticket sales have ended' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      pricePerTicketCents = tt.price_cents;
      ticketTypeName = tt.name;
      ticketTypeRecord = tt;
    }

    // Check early bird pricing (from event level)
    if (
      event.early_bird_price_cents &&
      event.early_bird_deadline &&
      new Date(event.early_bird_deadline) > new Date() &&
      !ticket_type_id
    ) {
      pricePerTicketCents = event.early_bird_price_cents;
    }

    // Check overall event capacity
    const spotsLeft = event.capacity - event.tickets_sold;
    if (quantity > spotsLeft) {
      return new Response(
        JSON.stringify({ error: `Only ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate pricing
    let subtotalCents = pricePerTicketCents * quantity;
    let discountCents = 0;
    let couponId = null;

    // Validate coupon if provided
    if (coupon_code) {
      const { data: coupon, error: couponError } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', coupon_code.toUpperCase().trim())
        .eq('is_active', true)
        .single();

      if (!couponError && coupon) {
        const now = new Date();
        const validFrom = coupon.valid_from ? new Date(coupon.valid_from) <= now : true;
        const validUntil = coupon.valid_until ? new Date(coupon.valid_until) >= now : true;
        const withinMaxUses = coupon.max_uses ? coupon.times_used < coupon.max_uses : true;
        const eventMatch = coupon.event_id ? coupon.event_id === event.id : true;

        if (validFrom && validUntil && withinMaxUses && eventMatch) {
          if (coupon.discount_type === 'percentage') {
            discountCents = Math.round(subtotalCents * (coupon.discount_value / 100));
          } else {
            discountCents = Math.min(coupon.discount_value, subtotalCents);
          }

          if (coupon.min_order_cents && subtotalCents < coupon.min_order_cents) {
            discountCents = 0;
          } else {
            couponId = coupon.id;
          }
        }
      }
    }

    // Volume discount calculation
    let volumeDiscountCents = 0;
    const volDiscount = event.custom_fields?.volume_discount;
    let isVolumeDiscount = false;
    if (volDiscount && quantity >= volDiscount.min_qty && volDiscount.discount_pct > 0) {
      volumeDiscountCents = Math.round(subtotalCents * volDiscount.discount_pct / 100);
    }

    // Use whichever discount is larger (volume vs coupon)
    if (volumeDiscountCents > 0 && volumeDiscountCents >= discountCents) {
      discountCents = volumeDiscountCents;
      couponId = null; // Don't attribute to coupon
      isVolumeDiscount = true;
    }

    const afterDiscount = subtotalCents - discountCents;
    const taxRateBps = event.tax_rate_bps || 500; // 500 = 5% GST
    const taxCents = Math.round(afterDiscount * taxRateBps / 10000);
    const ccFeeCents = event.pass_cc_fee ? Math.round((afterDiscount + taxCents) * 300 / 10000) : 0; // 3% CC fee
    const totalCents = afterDiscount + taxCents + ccFeeCents;

    // Get user ID from custom header if logged in
    let userId = null;
    const userToken = req.headers.get('x-user-token');
    if (userToken) {
      const { data: { user } } = await supabase.auth.getUser(userToken);
      if (user) userId = user.id;
    }

    // Create pending order with inventory hold (30 min)
    const reservedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        event_id: event.id,
        ticket_type_id: ticket_type_id || null,
        quantity,
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        tax_cents: taxCents,
        cc_fee_cents: ccFeeCents,
        total_cents: totalCents,
        coupon_id: couponId,
        payment_status: 'pending',
        buyer_name,
        buyer_email,
        buyer_phone: buyer_phone || null,
        reserved_until: reservedUntil,
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return new Response(
        JSON.stringify({ error: 'Failed to create order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create attendee rows
    const attendeeRows = attendees.map((a: any) => ({
      order_id: order.id,
      event_id: event.id,
      ticket_type_id: ticket_type_id || null,
      full_name: a.full_name.trim(),
      email: a.email?.trim() || null,
      phone: a.phone?.trim() || null,
    }));

    const { error: attendeeError } = await supabase
      .from('attendees')
      .insert(attendeeRows);

    if (attendeeError) {
      console.error('Attendee creation error:', attendeeError);
      // Clean up the order
      await supabase.from('orders').delete().eq('id', order.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create attendee records' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Stripe Checkout Session
    const lineItems: any[] = [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: `${event.title} - ${ticketTypeName}`,
          description: `${quantity} ticket${quantity > 1 ? 's' : ''} for ${event.title}`,
        },
        unit_amount: pricePerTicketCents,
      },
      quantity,
    }];

    // Add CC processing fee as a line item
    if (ccFeeCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'cad',
          product_data: {
            name: 'Card processing fee (3%)',
          },
          unit_amount: ccFeeCents,
        },
        quantity: 1,
      });
    }

    // Add tax as a separate line item
    if (taxCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'cad',
          product_data: {
            name: 'GST (5%)',
            description: 'Goods and Services Tax',
          },
          unit_amount: taxCents,
        },
        quantity: 1,
      });
    }

    // Apply discount as a coupon in Stripe
    let stripeCouponId = undefined;
    if (discountCents > 0) {
      const stripeCoupon = await stripe.coupons.create({
        amount_off: discountCents,
        currency: 'cad',
        duration: 'once',
        name: isVolumeDiscount
          ? `Group discount (${volDiscount!.discount_pct}% off)`
          : coupon_code ? `Coupon: ${coupon_code}` : 'Discount',
      });
      stripeCouponId = stripeCoupon.id;
    }

    const sessionConfig: any = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.get('origin') || 'https://staging.mixler.ca'}/order-confirmation.html?order=${order.order_number}`,
      cancel_url: `${req.headers.get('origin') || 'https://staging.mixler.ca'}/checkout.html?slug=${event_slug}`,
      customer_email: buyer_email,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        event_id: event.id,
        event_slug: event_slug,
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min expiry (Stripe minimum)
    };

    if (stripeCouponId) {
      sessionConfig.discounts = [{ coupon: stripeCouponId }];
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Update order with Stripe session ID
    await supabase
      .from('orders')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', order.id);

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        order_number: order.order_number,
        session_id: session.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Checkout error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
