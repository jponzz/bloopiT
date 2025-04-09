const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Inicializar cliente de Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/api/create-checkout', async (req, res) => {
  try {
    const { priceId, userId } = req.body;

    if (!priceId || !userId) {
      return res.status(400).json({ error: 'Price ID and User ID are required' });
    }

    console.log('Creating checkout session with priceId:', priceId);
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      client_reference_id: userId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.NEXT_PUBLIC_APP_URL,
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Error creating checkout session' });
  }
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log('Checkout completed:', session);
        
        // Obtener detalles de la suscripción
        const subscriptionId = session.subscription;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        
        // Guardar en Supabase
        const { error } = await supabase
          .from('subscriptions')
          .insert({
            user_id: session.client_reference_id,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: session.customer,
            price_id: subscription.items.data[0].price.id,
            status: subscription.status,
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end
          });

        if (error) {
          console.error('Error saving to Supabase:', error);
          throw error;
        }
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object;
        console.log('Subscription updated:', updatedSubscription);
        
        // Actualizar en Supabase
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({
            status: updatedSubscription.status,
            current_period_end: new Date(updatedSubscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: updatedSubscription.cancel_at_period_end
          })
          .eq('stripe_subscription_id', updatedSubscription.id);

        if (updateError) {
          console.error('Error updating Supabase:', updateError);
          throw updateError;
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log('Subscription deleted:', deletedSubscription);
        
        // Actualizar estado en Supabase
        const { error: deleteError } = await supabase
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('stripe_subscription_id', deletedSubscription.id);

        if (deleteError) {
          console.error('Error updating Supabase:', deleteError);
          throw deleteError;
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
