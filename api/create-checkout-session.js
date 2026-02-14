// api/create-checkout-session.js — Creates a Stripe PaymentIntent for embedded payment
import Stripe from 'stripe';

function getStripeClient() {
  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(secretKey);
}

// Map bundle IDs to amounts (cents) and draw counts
const BUNDLES = {
  draws10:  { amount: 99,  draws: 10 },
  draws60:  { amount: 499, draws: 60 },
  draws130: { amount: 999, draws: 130 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bundleId, userId } = req.body || {};

  if (!bundleId || !userId) {
    return res.status(400).json({ error: 'Missing bundleId or userId' });
  }

  const bundle = BUNDLES[bundleId];
  if (!bundle) {
    return res.status(400).json({ error: 'Invalid bundle' });
  }

  try {
    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: bundle.amount,
      currency: 'usd',
      metadata: { bundleId, draws: String(bundle.draws), userId },
      automatic_payment_methods: { enabled: true },
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Failed to create payment intent:', err);
    return res.status(500).json({ error: err.message });
  }
}
