import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { code, event_id, subtotal_cents } = await req.json();

    if (!code) {
      return new Response(
        JSON.stringify({ valid: false, error: 'No coupon code provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single();

    if (error || !coupon) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Invalid coupon code' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate date range
    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return new Response(
        JSON.stringify({ valid: false, error: 'This coupon is not yet active' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return new Response(
        JSON.stringify({ valid: false, error: 'This coupon has expired' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check usage limits
    if (coupon.max_uses && coupon.times_used >= coupon.max_uses) {
      return new Response(
        JSON.stringify({ valid: false, error: 'This coupon has been fully redeemed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check event restriction
    if (coupon.event_id && coupon.event_id !== event_id) {
      return new Response(
        JSON.stringify({ valid: false, error: 'This coupon is not valid for this event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check minimum order
    if (coupon.min_order_cents && subtotal_cents && subtotal_cents < coupon.min_order_cents) {
      const minOrder = (coupon.min_order_cents / 100).toFixed(2);
      return new Response(
        JSON.stringify({ valid: false, error: `Minimum order of $${minOrder} required` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate discount
    let discountCents = 0;
    if (subtotal_cents) {
      if (coupon.discount_type === 'percentage') {
        discountCents = Math.round(subtotal_cents * (coupon.discount_value / 100));
      } else {
        discountCents = Math.min(coupon.discount_value, subtotal_cents);
      }
    }

    return new Response(
      JSON.stringify({
        valid: true,
        coupon: {
          code: coupon.code,
          discount_type: coupon.discount_type,
          discount_value: coupon.discount_value,
          description: coupon.description,
        },
        discount_cents: discountCents,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Coupon validation error:', err);
    return new Response(
      JSON.stringify({ valid: false, error: 'Validation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
