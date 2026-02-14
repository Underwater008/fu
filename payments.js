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

export async function purchaseDraws(bundleId) {
  const user = getUser();
  if (!user) throw new Error('Not logged in');

  const bundle = DRAW_BUNDLES.find(b => b.id === bundleId);
  if (!bundle) throw new Error('Invalid bundle');

  // Dev mode: simulate purchase
  if (!CONFIG.isProd) {
    await updateDraws(bundle.draws);
    await storage.addTransaction(user.id, {
      type: 'stripe',
      draws_granted: bundle.draws,
      stripe_session_id: 'dev-' + crypto.randomUUID().slice(0, 8),
    });
    return { success: true, draws: bundle.draws };
  }

  // Prod: create checkout session server-side, then redirect
  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bundleId: bundle.id,
      userId: user.id,
      origin: window.location.origin,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create checkout session');
  }

  const { url } = await res.json();
  window.location.href = url;
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
