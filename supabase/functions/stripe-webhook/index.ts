import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

serve(async (req) => {
  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.text();
    const sig = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;

    if (webhookSecret && sig) {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
    } else {
      // In test mode without webhook secret, parse directly
      event = JSON.parse(body);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;

        if (!orderId) {
          console.error('No order_id in session metadata');
          break;
        }

        // Update order to completed
        const { error: orderError } = await supabase
          .from('orders')
          .update({
            payment_status: 'completed',
            stripe_payment_id: session.payment_intent as string,
            reserved_until: null,
          })
          .eq('id', orderId);

        if (orderError) {
          console.error('Failed to update order:', orderError);
          break;
        }

        console.log(`Order ${session.metadata?.order_number} completed`);

        // Trigger confirmation email (fire-and-forget)
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        fetch(`${supabaseUrl}/functions/v1/send-order-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ order_id: orderId }),
        }).catch(err => console.error('Email trigger failed:', err));

        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;

        if (orderId) {
          // Mark order as failed and release inventory
          await supabase
            .from('orders')
            .update({
              payment_status: 'failed',
              reserved_until: null,
            })
            .eq('id', orderId);

          // Delete the attendee rows
          await supabase
            .from('attendees')
            .delete()
            .eq('order_id', orderId);

          console.log(`Order ${session.metadata?.order_number} expired, inventory released`);
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntent = charge.payment_intent as string;

        if (paymentIntent) {
          const { data: order } = await supabase
            .from('orders')
            .select('id, order_number')
            .eq('stripe_payment_id', paymentIntent)
            .single();

          if (order) {
            const refundAmountCents = charge.amount_refunded;
            await supabase
              .from('orders')
              .update({
                payment_status: 'refunded',
                refund_amount_cents: refundAmountCents,
                refunded_at: new Date().toISOString(),
              })
              .eq('id', order.id);

            console.log(`Order ${order.order_number} refunded: ${refundAmountCents} cents`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
