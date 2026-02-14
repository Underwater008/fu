// api/stripe-webhook.js — Vercel serverless function for Stripe webhook
// Handles checkout.session.completed to credit draws after payment
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Map Stripe price amounts (cents) to draw counts
const AMOUNT_TO_DRAWS = {
  99: 10,
  499: 60,
  999: 130,
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for signature verification
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;

    if (!userId) {
      console.error('No client_reference_id in session:', session.id);
      return res.status(400).json({ error: 'Missing user ID' });
    }

    // Get the amount paid to determine draw count
    const amountTotal = session.amount_total;
    const draws = AMOUNT_TO_DRAWS[amountTotal];

    if (!draws) {
      console.error('Unknown amount:', amountTotal, 'session:', session.id);
      return res.status(400).json({ error: 'Unknown purchase amount' });
    }

    // Credit draws via the idempotent database function
    const { data, error } = await supabase.rpc('credit_stripe_purchase', {
      p_user_id: userId,
      p_session_id: session.id,
      p_draws: draws,
    });

    if (error) {
      console.error('Failed to credit draws:', error);
      return res.status(500).json({ error: 'Fulfillment failed' });
    }

    console.log(
      data ? 'Credited' : 'Already processed',
      `${draws} draws for user ${userId}, session ${session.id}`
    );
  }

  return res.status(200).json({ received: true });
}
