// api/stripe-webhook.js — Vercel serverless function for Stripe webhook
// Handles payment_intent.succeeded to credit draws after payment
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

function getStripeClient() {
  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(secretKey);
}

function getSupabaseClient() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase service role not configured');
  }
  return createClient(url, serviceRoleKey);
}

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

  let stripe;
  let supabase;
  try {
    stripe = getStripeClient();
    supabase = getSupabaseClient();
  } catch (err) {
    console.error('Webhook config error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  // Read raw body for signature verification
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const { userId, draws: drawsStr, bundleId } = paymentIntent.metadata || {};

    if (!userId || !drawsStr) {
      console.error('Missing metadata in payment_intent:', paymentIntent.id);
      return res.status(400).json({ error: 'Missing metadata' });
    }

    const draws = parseInt(drawsStr, 10);
    if (!draws || draws <= 0) {
      console.error('Invalid draws in metadata:', drawsStr);
      return res.status(400).json({ error: 'Invalid draws amount' });
    }

    // Credit draws via the idempotent database function
    const { data, error } = await supabase.rpc('credit_stripe_purchase', {
      p_user_id: userId,
      p_session_id: paymentIntent.id,
      p_draws: draws,
    });

    if (error) {
      console.error('Failed to credit draws:', error);
      return res.status(500).json({ error: 'Fulfillment failed' });
    }

    console.log(
      data ? 'Credited' : 'Already processed',
      `${draws} draws for user ${userId}, pi ${paymentIntent.id}`
    );
  }

  return res.status(200).json({ received: true });
}
