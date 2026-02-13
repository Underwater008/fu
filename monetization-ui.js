// monetization-ui.js — Auth bar, rewards panel, gift UI, share card generation
import { getUser, onAuthChange, sendMagicLink, logout, updateDraws } from './auth.js';
import { claimShareReward, canShare, getShareCooldownRemaining } from './rewards.js';
import { showRewardedAd } from './ads.js';
import { purchaseDraws, DRAW_BUNDLES } from './payments.js';
import { createGift, canGift } from './gifting.js';
import { CONFIG } from './config.js';
import { RARITY_TIERS } from './gacha.js';

// --- Init ---
export function initMonetizationUI() {
  wireAuthButtons();
  wireRewardsPanel();
  renderPurchaseBundles();

  // Set initial auth state
  const user = getUser();
  updateAuthUI(user);

  // Listen for changes
  onAuthChange(updateAuthUI);

  // Update share cooldown timer
  setInterval(updateShareCooldown, 1000);
}

// --- Auth UI ---
function updateAuthUI(user) {
  const loggedOut = document.getElementById('auth-logged-out');
  const loggedIn = document.getElementById('auth-logged-in');
  const drawCounter = document.getElementById('draw-counter');

  if (!loggedOut || !loggedIn) return;

  if (user) {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'flex';
    document.getElementById('auth-email').textContent = user.display_name || user.email;
    if (drawCounter) drawCounter.textContent = `🎫 ×${user.draws_remaining || 0}`;
  } else {
    loggedOut.style.display = 'flex';
    loggedIn.style.display = 'none';
  }
}

function wireAuthButtons() {
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const btnSendLink = document.getElementById('btn-send-link');
  const btnCloseLogin = document.getElementById('btn-close-login');
  const loginModal = document.getElementById('login-modal');

  if (btnLogin) {
    btnLogin.addEventListener('click', () => {
      if (loginModal) loginModal.style.display = 'flex';
    });
  }

  if (btnCloseLogin) {
    btnCloseLogin.addEventListener('click', () => {
      if (loginModal) loginModal.style.display = 'none';
    });
  }

  if (btnSendLink) {
    btnSendLink.addEventListener('click', async () => {
      const emailInput = document.getElementById('login-email');
      const status = document.getElementById('login-status');
      const email = emailInput?.value?.trim();
      if (!email) return;

      try {
        btnSendLink.disabled = true;
        btnSendLink.textContent = 'Sending...';
        await sendMagicLink(email);

        if (CONFIG.isProd) {
          if (status) status.textContent = 'Check your email for the magic link!';
        } else {
          // Dev mode: instant login
          if (loginModal) loginModal.style.display = 'none';
        }
      } catch (e) {
        if (status) status.textContent = 'Error: ' + e.message;
      } finally {
        btnSendLink.disabled = false;
        btnSendLink.textContent = 'Send Magic Link';
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await logout();
    });
  }
}

// --- Rewards Panel ---
function wireRewardsPanel() {
  const btnClose = document.getElementById('btn-close-rewards');
  const btnShare = document.getElementById('btn-share-draw');
  const btnAd = document.getElementById('btn-watch-ad');
  const btnReferral = document.getElementById('btn-copy-referral');

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      const panel = document.getElementById('rewards-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      const user = getUser();
      if (!user) return;

      // Use Web Share API
      try {
        const shareUrl = `${window.location.origin}${window.location.pathname}?ref=${user.referral_code}`;
        if (navigator.share) {
          await navigator.share({
            title: '福 Fortune Gacha',
            text: 'Try your luck with the Fortune Gacha!',
            url: shareUrl,
          });
        } else {
          await navigator.clipboard.writeText(shareUrl);
        }
        const result = await claimShareReward();
        if (result) {
          btnShare.textContent = `+${result.draws} Draws!`;
          setTimeout(() => { btnShare.textContent = 'Share → 10 Draws'; }, 2000);
          updateAuthUI(getUser());
        }
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Share failed:', e);
      }
    });
  }

  if (btnAd) {
    btnAd.addEventListener('click', async () => {
      btnAd.disabled = true;
      btnAd.textContent = 'Watching...';
      const result = await showRewardedAd();
      if (result.success) {
        btnAd.textContent = '+1 Draw!';
        const adCount = document.getElementById('ad-count');
        if (adCount) adCount.textContent = `${result.adsWatchedToday}/${CONFIG.ads.maxPerDay} today`;
        updateAuthUI(getUser());
      } else {
        btnAd.textContent = 'Daily limit reached';
      }
      setTimeout(() => {
        btnAd.disabled = false;
        btnAd.textContent = 'Watch Ad → 1 Draw';
      }, 2000);
    });
  }

  if (btnReferral) {
    btnReferral.addEventListener('click', async () => {
      const user = getUser();
      if (!user) return;
      const refUrl = `${window.location.origin}${window.location.pathname}?ref=${user.referral_code}`;
      try {
        await navigator.clipboard.writeText(refUrl);
        btnReferral.textContent = 'Copied!';
        setTimeout(() => { btnReferral.textContent = 'Copy Invite Link'; }, 2000);
      } catch {
        btnReferral.textContent = refUrl;
      }
    });
  }
}

function updateShareCooldown() {
  const cooldownEl = document.getElementById('share-cooldown');
  if (!cooldownEl) return;
  const remaining = getShareCooldownRemaining();
  if (remaining <= 0) {
    cooldownEl.textContent = '';
    return;
  }
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  cooldownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Purchase Bundles ---
function renderPurchaseBundles() {
  const container = document.getElementById('purchase-bundles');
  if (!container) return;

  container.innerHTML = '';
  for (const bundle of DRAW_BUNDLES) {
    const btn = document.createElement('button');
    btn.className = 'btn-purchase';
    btn.innerHTML = `
      <span class="purchase-draws">${bundle.label}</span>
      <span class="purchase-price">${bundle.price}</span>
      ${bundle.savings ? `<span class="purchase-savings">${bundle.savings}</span>` : ''}
    `;
    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        btn.querySelector('.purchase-price').textContent = '...';
        const result = await purchaseDraws(bundle.id);
        if (result?.success) {
          btn.querySelector('.purchase-price').textContent = `+${result.draws}!`;
          updateAuthUI(getUser());
          setTimeout(() => {
            btn.querySelector('.purchase-price').textContent = bundle.price;
            btn.disabled = false;
          }, 2000);
        }
      } catch (e) {
        btn.querySelector('.purchase-price').textContent = bundle.price;
        btn.disabled = false;
        console.error('Purchase failed:', e);
      }
    });
    container.appendChild(btn);
  }
}

// --- Share Card Image Generation ---
export function generateShareCard(drawResult) {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');

  // Red gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, 800);
  grad.addColorStop(0, '#8B0000');
  grad.addColorStop(0.5, '#CC0000');
  grad.addColorStop(1, '#8B0000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 600, 800);

  // Gold border
  ctx.strokeStyle = drawResult.rarity.color;
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, 560, 760);

  // Rarity glow border
  ctx.shadowColor = drawResult.rarity.glow;
  ctx.shadowBlur = 30;
  ctx.strokeRect(20, 20, 560, 760);
  ctx.shadowBlur = 0;

  // Character (large, centered)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = drawResult.rarity.glow;
  ctx.shadowBlur = 20;
  ctx.font = '180px "Ma Shan Zheng", serif';
  ctx.fillText(drawResult.char, 300, 320);
  ctx.shadowBlur = 0;

  // Stars
  const stars = drawResult.rarity.stars;
  const starStr = '★'.repeat(stars);
  ctx.fillStyle = drawResult.rarity.color;
  ctx.font = '32px sans-serif';
  ctx.fillText(starStr, 300, 400);

  // Tier label
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '20px sans-serif';
  ctx.fillText(drawResult.rarity.label, 300, 440);

  // Category
  ctx.fillStyle = drawResult.category.color;
  ctx.font = '18px sans-serif';
  ctx.fillText(drawResult.category.name + ' · ' + drawResult.category.nameEn, 300, 480);

  // Divider
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(100, 520);
  ctx.lineTo(500, 520);
  ctx.stroke();

  // Blessing phrase
  ctx.fillStyle = '#FFD700';
  ctx.font = '36px "Ma Shan Zheng", serif';
  ctx.fillText(drawResult.blessing.phrase, 300, 580);

  // English
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'italic 18px sans-serif';
  ctx.fillText(drawResult.blessing.english, 300, 620);

  // Branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '14px sans-serif';
  ctx.fillText('福 Fortune Gacha', 300, 740);
  ctx.fillText(window.location.origin, 300, 760);

  return canvas.toDataURL('image/png');
}

export async function shareResult(drawResult) {
  const imageDataUrl = generateShareCard(drawResult);
  const blob = await (await fetch(imageDataUrl)).blob();
  const file = new File([blob], 'fortune.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: `I drew ${drawResult.char} — ${drawResult.blessing.english}`,
      files: [file],
    });
  } else {
    // Fallback: download image
    const a = document.createElement('a');
    a.href = imageDataUrl;
    a.download = 'fortune.png';
    a.click();
  }
}
