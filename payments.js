// payments.js — Stripe Payment Element integration for draw purchases
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
  if (!CONFIG.stripe.publishableKey) return null;
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
    await updateDraws(bundle.draws);
    await storage.addTransaction(user.id, {
      type: 'stripe',
      draws_granted: bundle.draws,
      stripe_session_id: 'dev-' + crypto.randomUUID().slice(0, 8),
    });
    return { success: true, draws: bundle.draws };
  }

  // Prod: show embedded payment form
  return showPaymentModal(bundle, user);
}

async function showPaymentModal(bundle, user) {
  const modal = document.getElementById('payment-modal');
  const titleEl = document.getElementById('payment-title');
  const descEl = document.getElementById('payment-desc');
  const mountEl = document.getElementById('payment-element');
  const statusEl = document.getElementById('payment-status');
  const payBtn = document.getElementById('btn-pay');
  const cancelBtn = document.getElementById('btn-close-payment');

  // Reset state
  titleEl.textContent = `Buy ${bundle.label}`;
  descEl.textContent = `${bundle.draws} draws for ${bundle.price}`;
  statusEl.textContent = '';
  statusEl.className = 'payment-status';
  payBtn.disabled = true;
  payBtn.textContent = 'Pay';
  mountEl.innerHTML = '';

  modal.style.display = 'flex';

  // Load Stripe and create PaymentIntent
  const stripeInstance = await getStripe();
  if (!stripeInstance) {
    statusEl.textContent = 'Stripe not available';
    statusEl.className = 'payment-status error';
    return;
  }

  statusEl.textContent = 'Loading...';
  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundleId: bundle.id, userId: user.id }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    statusEl.textContent = err.error || 'Failed to initialize payment';
    statusEl.className = 'payment-status error';
    return;
  }

  const { clientSecret } = await res.json();
  statusEl.textContent = '';

  // Mount Payment Element with dark theme to match the app
  const elements = stripeInstance.elements({
    clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#FFD700',
        colorBackground: 'rgba(30, 5, 5, 0.95)',
        colorText: '#ffffff',
        colorDanger: '#f87171',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        borderRadius: '10px',
      },
      rules: {
        '.Input': {
          border: '1px solid rgba(255, 215, 0, 0.3)',
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
        },
        '.Input:focus': {
          border: '1px solid rgba(255, 215, 0, 0.6)',
          boxShadow: '0 0 8px rgba(255, 215, 0, 0.2)',
        },
        '.Label': {
          color: 'rgba(255, 255, 255, 0.7)',
        },
      },
    },
  });

  const paymentElement = elements.create('payment');
  paymentElement.mount(mountEl);

  paymentElement.on('ready', () => {
    payBtn.disabled = false;
  });

  // Handle payment submission
  return new Promise((resolve) => {
    const cleanup = () => {
      modal.style.display = 'none';
      payBtn.replaceWith(payBtn.cloneNode(true));
      cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    // Cancel button
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    }, { once: true });

    // Close on backdrop click
    const backdropHandler = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(null);
      }
    };
    modal.addEventListener('click', backdropHandler);

    // Pay button
    payBtn.addEventListener('click', async () => {
      payBtn.disabled = true;
      payBtn.textContent = 'Processing...';
      statusEl.textContent = '';
      statusEl.className = 'payment-status';

      const { error } = await stripeInstance.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}${window.location.pathname}?payment=success&bundle=${bundle.id}`,
        },
        redirect: 'if_required',
      });

      if (error) {
        statusEl.textContent = error.message;
        statusEl.className = 'payment-status error';
        payBtn.disabled = false;
        payBtn.textContent = 'Pay';
      } else {
        // Payment succeeded without redirect
        statusEl.textContent = `Payment successful! +${bundle.draws} draws`;
        statusEl.className = 'payment-status success';
        payBtn.textContent = 'Done!';
        modal.removeEventListener('click', backdropHandler);
        setTimeout(() => {
          cleanup();
          // Reload to pick up credited draws from webhook
          window.location.reload();
        }, 1500);
        resolve({ success: true, draws: bundle.draws });
      }
    }, { once: true });
  });
}

// Handle return from Stripe (3D Secure redirect).
// SECURITY: This only reads URL params for UI feedback.
// Draws are credited server-side via webhook.
export function getPaymentResult() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const bundleId = params.get('bundle');
  if (payment && bundleId) {
    const url = new URL(window.location.href);
    url.searchParams.delete('payment');
    url.searchParams.delete('bundle');
    // Also clean Stripe redirect params
    url.searchParams.delete('payment_intent');
    url.searchParams.delete('payment_intent_client_secret');
    url.searchParams.delete('redirect_status');
    window.history.replaceState({}, '', url);
    return { status: payment, bundleId };
  }
  return null;
}
