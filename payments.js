// payments.js — Stripe Checkout integration for draw purchases
import { CONFIG } from './config.js';
import { getUser, updateDraws } from './auth.js';
import { storage } from './storage.js';

const DRAW_BUNDLES = [
  { id: 'draws10',  draws: 10,  price: '$0.99',  label: '10 Draws',  priceKey: 'draws10' },
  { id: 'draws60',  draws: 60,  price: '$4.99',  label: '60 Draws',  savings: 'Save 17%', priceKey: 'draws60' },
  { id: 'draws130', draws: 130, price: '$9.99',  label: '130 Draws', savings: 'Save 23%', priceKey: 'draws130' },
];

export { DRAW_BUNDLES };

let stripe = null;

async function getStripe() {
  if (stripe) return stripe;
  if (!CONFIG.stripe.publishableKey) {
    // No Stripe key configured
    return null;
  }
  // Load Stripe.js
  if (!window.Stripe) {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }
  stripe = window.Stripe(CONFIG.stripe.publishableKey);
  return stripe;
}

export async function purchaseDraws(bundleId) {
  const user = getUser();
  if (!user) throw new Error('Not logged in');

  const bundle = DRAW_BUNDLES.find(b => b.id === bundleId);
  if (!bundle) throw new Error('Invalid bundle');

  // Dev mode: simulate purchase
  if (!CONFIG.isProd) {
    // Dev mode: simulate purchase
    await updateDraws(bundle.draws);
    await storage.addTransaction(user.id, {
      type: 'stripe',
      draws_granted: bundle.draws,
      stripe_session_id: 'dev-' + crypto.randomUUID().slice(0, 8),
    });
    return { success: true, draws: bundle.draws };
  }

  if (!CONFIG.stripe.publishableKey) {
    throw new Error('Stripe is not configured');
  }

  // Prod: redirect to Stripe Checkout
  const stripeInstance = await getStripe();
  if (!stripeInstance) throw new Error('Stripe not available');

  const priceId = CONFIG.stripe.prices[bundle.priceKey];
  if (!priceId) throw new Error('Price not configured');

  const { error } = await stripeInstance.redirectToCheckout({
    lineItems: [{ price: priceId, quantity: 1 }],
    mode: 'payment',
    successUrl: `${window.location.origin}${window.location.pathname}?payment=success&bundle=${bundleId}`,
    cancelUrl: `${window.location.origin}${window.location.pathname}?payment=cancel`,
    clientReferenceId: user.id,
  });
  if (error) throw error;
}

// Handle return from Stripe Checkout.
// SECURITY: This only reads URL params for UI feedback (e.g., showing a toast).
// Draws must NEVER be credited here — fulfillment must happen server-side
// via a Stripe webhook (checkout.session.completed) that verifies the session
// and credits draws through a SECURITY DEFINER function.
export function getPaymentResult() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const bundleId = params.get('bundle');
  if (payment && bundleId) {
    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete('payment');
    url.searchParams.delete('bundle');
    window.history.replaceState({}, '', url);
    return { status: payment, bundleId };
  }
  return null;
}
