import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        
        // Obtener los detalles de la suscripción
        const subscription = await stripe.subscriptions.retrieve(session.subscription) as Stripe.Subscription;
        
        // Guardar la información en Supabase
        const { error } = await supabase
          .from('subscriptions')
          .insert({
            user_id: session.client_reference_id,
            subscription_id: subscription.id,
            status: subscription.status,
            current_period_end: new Date(subscription.current_period_end).toISOString(),
            current_period_start: new Date(subscription.current_period_start).toISOString(),
            price_id: subscription.items.data[0].price.id,
            cancel_at_period_end: subscription.cancel_at_period_end,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (error) {
          console.error('Error saving subscription:', error);
          throw error;
        }

        console.log('Subscription saved:', subscription.id);
        break;
      }
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        console.log('Subscription created:', subscription);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        console.log('Subscription updated:', subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        console.log('Subscription cancelled:', subscription);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 }
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
