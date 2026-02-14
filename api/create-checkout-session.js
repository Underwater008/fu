// api/create-checkout-session.js — Creates a Stripe Checkout Session server-side
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map bundle IDs to price IDs and draw counts
const BUNDLES = {
  draws10:  { priceId: process.env.VITE_STRIPE_PRICE_10,  draws: 10 },
  draws60:  { priceId: process.env.VITE_STRIPE_PRICE_60,  draws: 60 },
  draws130: { priceId: process.env.VITE_STRIPE_PRICE_130, draws: 130 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bundleId, userId, origin } = req.body || {};

  if (!bundleId || !userId || !origin) {
    return res.status(400).json({ error: 'Missing bundleId, userId, or origin' });
  }

  const bundle = BUNDLES[bundleId];
  if (!bundle || !bundle.priceId) {
    return res.status(400).json({ error: 'Invalid bundle' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: bundle.priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `${origin}?payment=success&bundle=${bundleId}`,
      cancel_url: `${origin}?payment=cancel`,
      client_reference_id: userId,
      metadata: { bundleId, draws: String(bundle.draws) },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Failed to create checkout session:', err);
    return res.status(500).json({ error: err.message });
  }
}
