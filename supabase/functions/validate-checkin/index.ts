import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://mixler.ca',
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

    const { qr_code, action, search_query, event_id } = await req.json();

    // Manual search by name or order number
    if (action === 'search') {
      if (!search_query || !event_id) {
        return new Response(
          JSON.stringify({ error: 'search_query and event_id required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const query = search_query.trim().toLowerCase();

      // Search attendees by name, email, or order number
      const { data: attendees } = await supabase
        .from('attendees')
        .select('*, orders!inner(order_number, buyer_name, buyer_email, payment_status), events(title, event_date, start_time), ticket_types(name)')
        .eq('event_id', event_id)
        .eq('orders.payment_status', 'completed');

      const results = (attendees || []).filter(a =>
        a.full_name?.toLowerCase().includes(query) ||
        a.email?.toLowerCase().includes(query) ||
        a.orders?.order_number?.toLowerCase().includes(query)
      );

      return new Response(
        JSON.stringify({ results: results.slice(0, 20) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // QR code lookup
    if (action === 'lookup' || !action) {
      if (!qr_code) {
        return new Response(
          JSON.stringify({ error: 'qr_code required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: attendee, error } = await supabase
        .from('attendees')
        .select('*, orders!inner(order_number, buyer_name, buyer_email, payment_status), events(title, event_date, start_time, location_name), ticket_types(name)')
        .eq('qr_code', qr_code)
        .eq('orders.payment_status', 'completed')
        .single();

      if (error || !attendee) {
        return new Response(
          JSON.stringify({ error: 'Ticket not found or invalid', valid: false }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ attendee, valid: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check in / check out
    if (action === 'checkin') {
      if (!qr_code) {
        return new Response(
          JSON.stringify({ error: 'qr_code required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get current state
      const { data: attendee } = await supabase
        .from('attendees')
        .select('id, checked_in, full_name')
        .eq('qr_code', qr_code)
        .single();

      if (!attendee) {
        return new Response(
          JSON.stringify({ error: 'Attendee not found', valid: false }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (attendee.checked_in) {
        return new Response(
          JSON.stringify({ error: 'Already checked in', already_checked_in: true, attendee_name: attendee.full_name }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check in
      const { error: updateError } = await supabase
        .from('attendees')
        .update({
          checked_in: true,
          checked_in_at: new Date().toISOString(),
        })
        .eq('id', attendee.id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: 'Failed to check in' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, attendee_name: attendee.full_name }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Undo check-in
    if (action === 'undo_checkin') {
      const { data: attendee } = await supabase
        .from('attendees')
        .select('id')
        .eq('qr_code', qr_code)
        .single();

      if (!attendee) {
        return new Response(
          JSON.stringify({ error: 'Attendee not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase
        .from('attendees')
        .update({ checked_in: false, checked_in_at: null })
        .eq('id', attendee.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
