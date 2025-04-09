const express = require('express');
const cors = require('cors');

// Validar variables de entorno requeridas
const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_APP_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} is required but not set.`);
    process.exit(1);
  }
}

// Inicializar Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Inicializar cliente de Supabase
const { createClient } = require('@supabase/supabase-js');

// Verificar variables de Supabase
console.log('Checking Supabase environment variables...');
console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ Set' : '✗ Not set');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Set' : '✗ Not set');

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required Supabase environment variables');
  process.exit(1);
}

console.log('Initializing Supabase client...');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);


// Verificar conexión con Supabase y estructura de la tabla
async function checkSupabaseConnection() {
  try {
    console.log('Testing Supabase connection...');
    
    // Primero intentar una consulta simple
    const { data: testData, error: testError } = await supabase
      .from('subscriptions')
      .select('*')
      .limit(1);
    
    if (testError) {
      console.error('Error connecting to Supabase:', testError);
      if (testError.message.includes('does not exist')) {
        console.error('The subscriptions table does not exist!');
      }
      throw testError;
    }
    
    console.log('Successfully connected to Supabase');
    console.log('Current data in subscriptions table:', testData);
    
    // Verificar estructura de la tabla
    const expectedColumns = [
      'id',
      'user_id',
      'stripe_subscription_id',
      'status',
      'current_period_end',
      'plan_id',
      'created_at',
      'updated_at',
      'payment_method_brand',
      'payment_method_last4',
      'payment_method_exp_month',
      'payment_method_exp_year',
      'stripe_customer_id',
      'cancel_at_period_end',
      'price_id'
    ];
    
    console.log('Verifying table schema...');
    const { error: schemaError } = await supabase
      .from('subscriptions')
      .select(expectedColumns.join(', '))
      .limit(0);
    
    if (schemaError) {
      console.error('Table schema error:', schemaError);
      console.error('Expected columns:', expectedColumns);
      throw schemaError;
    }
    
    console.log('Table schema verified successfully');
    console.log('All required columns exist:', expectedColumns);
    
  } catch (err) {
    console.error('Detailed error:', JSON.stringify(err, null, 2));
    throw new Error(`Supabase initialization failed: ${err.message || JSON.stringify(err)}`);
  }
}

// Inicializar Supabase
checkSupabaseConnection().catch(err => {
  console.error('Fatal: Could not initialize Supabase:', err);
  process.exit(1);
});

const app = express();
const port = process.env.PORT || 3000;

// Verificar configuración
console.log('----------------------------------------');
console.log('CONFIGURATION CHECK');
console.log('Webhook URL should be:', `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`);
console.log('Webhook Secret:', process.env.STRIPE_WEBHOOK_SECRET ? '✓ Set' : '✗ Not set');
console.log('----------------------------------------');

// Configurar middleware para el webhook (antes de express.json)
// Test endpoint
app.get('/api/webhook-test', (req, res) => {
  console.log('Webhook test endpoint called');
  res.json({ status: 'Webhook endpoint is accessible' });
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('----------------------------------------');
  console.log('WEBHOOK RECEIVED');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Raw body:', req.body.toString());
  console.log('----------------------------------------');
  console.log('----------------------------------------');
  console.log('WEBHOOK RECEIVED');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', req.body.toString());
  console.log('----------------------------------------');
  console.log('Webhook received:', req.headers['stripe-signature']);
  const sig = req.headers['stripe-signature'];

  try {
    console.log('Verifying webhook with secret:', process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Webhook Secret:', process.env.STRIPE_WEBHOOK_SECRET);
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Event constructed successfully:', event.type);
    console.log('Webhook verified, event type:', event.type);

    console.log('Event data:', JSON.stringify(event.data, null, 2));
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('----------------------------------------');
        console.log('CHECKOUT SESSION COMPLETED');
        console.log('----------------------------------------');
        const session = event.data.object;
        console.log('Session data:', JSON.stringify(session, null, 2));
        console.log('Client reference ID:', session.client_reference_id);
        console.log('Customer ID:', session.customer);
        console.log('Subscription ID:', session.subscription);
        
        console.log('Processing checkout session:', session);
        // Obtener detalles de la suscripción
        const subscriptionId = session.subscription;
        console.log('Subscription ID:', subscriptionId);
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        console.log('Retrieved subscription:', subscription);
        
        // Preparar datos para Supabase
        const subscriptionData = {
          user_id: session.client_reference_id,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: session.customer,
          price_id: subscription.items.data[0].price.id,
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          plan_id: subscription.items.data[0].plan.id || null,
          // Datos del método de pago
          payment_method_brand: null, // Se actualizará cuando tengamos los detalles del pago
          payment_method_last4: null, // Se actualizará cuando tengamos los detalles del pago
          payment_method_exp_month: null, // Se actualizará cuando tengamos los detalles del pago
          payment_method_exp_year: null, // Se actualizará cuando tengamos los detalles del pago
          // created_at y updated_at son manejados automáticamente por Supabase
          // id es manejado automáticamente por Supabase
        };
        console.log('Saving to Supabase:', subscriptionData);

        // Guardar en Supabase
        console.log('----------------------------------------');
        console.log('SAVING TO SUPABASE');
        console.log('Data to save:', JSON.stringify(subscriptionData, null, 2));
        console.log('----------------------------------------');
        const { data, error } = await supabase
          .from('subscriptions')
          .insert(subscriptionData)
          .select();

        if (error) {
          console.error('Error saving to Supabase:', error);
          console.error('Subscription data that failed:', JSON.stringify(subscriptionData, null, 2));
          throw error;
        }

        console.log('Successfully saved subscription to Supabase:', data);
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

// Configurar middleware general para otras rutas
app.use(cors());
app.use(express.json());

// Ruta de checkout
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

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Manejar señales de cierre
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Performing graceful shutdown...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Performing graceful shutdown...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  server.close(() => {
    console.log('Server closed due to uncaught exception');
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  server.close(() => {
    console.log('Server closed due to unhandled rejection');
    process.exit(1);
  });
});
