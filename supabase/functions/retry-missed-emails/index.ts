import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentOrders } = await supabase
      .from('orders')
      .select('id, order_number')
      .eq('payment_status', 'completed')
      .gte('created_at', cutoff);

    if (!recentOrders || recentOrders.length === 0) {
      return new Response(JSON.stringify({ checked: 0, retried: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: sentEmails } = await supabase
      .from('email_log')
      .select('order_id')
      .eq('template_name', 'order_confirmation')
      .in('order_id', recentOrders.map(o => o.id));

    const sentOrderIds = new Set((sentEmails || []).map(e => e.order_id));
    const missed = recentOrders.filter(o => !sentOrderIds.has(o.id));

    if (missed.length === 0) {
      return new Response(JSON.stringify({ checked: recentOrders.length, retried: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results = [];
    for (const order of missed) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-order-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ order_id: order.id }),
        });
        results.push({ order: order.order_number, status: res.ok ? 'sent' : res.status });
        if (!res.ok) {
          console.error(`Retry failed for ${order.order_number}: ${res.status}`);
        }
      } catch (err: any) {
        results.push({ order: order.order_number, error: err.message });
        console.error(`Retry error for ${order.order_number}:`, err.message);
      }
    }

    console.log(`Retried ${missed.length} missed emails:`, JSON.stringify(results));

    return new Response(JSON.stringify({
      checked: recentOrders.length,
      retried: missed.length,
      results,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('retry-missed-emails error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
