// monetization-ui.js — Auth bar, rewards panel, gift UI, share card generation
import { getUser, onAuthChange, sendMagicLink, linkAnonymousToEmail, isAnonymous, logout } from './auth.js';
import { claimShareReward, canShare, getShareCooldownRemaining } from './rewards.js';
import { showRewardedAd } from './ads.js';
import { purchaseDraws, DRAW_BUNDLES } from './payments.js';
import { createGift, canGift } from './gifting.js';
import { CONFIG } from './config.js';
import { RARITY_TIERS } from './gacha.js';

// Track current draw result for share buttons
let _currentDrawResult = null;
let _currentDetailDraw = null;

export function setCurrentDrawResult(drawResult) {
  _currentDrawResult = drawResult;
}

// --- Init ---
export function initMonetizationUI() {
  wireAuthButtons();
  wireRewardsPanel();
  wireShareButtons();
  wireDetailActions();
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
  const drawCounterFloat = document.getElementById('draw-counter-float');

  if (!loggedOut || !loggedIn) return;

  // Always show draw counter when user exists (including anonymous)
  if (drawCounter && user) {
    drawCounter.textContent = `🎫 ×${user.draws_remaining || 0}`;
  }
  if (drawCounterFloat) {
    drawCounterFloat.style.display = user ? '' : 'none';
  }

  const btnAuthUser = document.getElementById('btn-auth-user');

  if (user && !user.is_anonymous) {
    // Fully authenticated user
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'flex';
    const displayName = user.display_name || user.email || 'User';
    document.getElementById('auth-email').textContent = displayName;
    // Show truncated ID on the button
    if (btnAuthUser) {
      btnAuthUser.textContent = displayName;
    }
  } else {
    // Anonymous user or no user — show sign-in button
    loggedOut.style.display = '';
    loggedIn.style.display = 'none';
    // Close dropdown when logging out
    const dropdown = document.getElementById('auth-dropdown');
    if (dropdown) dropdown.style.display = 'none';
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
        if (isAnonymous()) {
          await linkAnonymousToEmail(email);
        } else {
          await sendMagicLink(email);
        }

        if (CONFIG.isProd && !isAnonymous()) {
          if (status) status.textContent = 'Check your email for the magic link!';
        } else {
          // Dev mode or anonymous link: instant login
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
      const dropdown = document.getElementById('auth-dropdown');
      if (dropdown) dropdown.style.display = 'none';
      await logout();
    });
  }

  // User ID button toggles dropdown
  const btnAuthUser = document.getElementById('btn-auth-user');
  const authDropdown = document.getElementById('auth-dropdown');
  if (btnAuthUser && authDropdown) {
    btnAuthUser.addEventListener('click', (e) => {
      e.stopPropagation();
      authDropdown.style.display = authDropdown.style.display === 'none' ? 'flex' : 'none';
    });
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!authDropdown.contains(e.target) && e.target !== btnAuthUser) {
        authDropdown.style.display = 'none';
      }
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

// --- Share Result Buttons (fortune screen) ---
function wireShareButtons() {
  const btnShareSingle = document.getElementById('btn-share-single');
  const btnShareMulti = document.getElementById('btn-share-multi');

  const handleShare = async () => {
    if (!_currentDrawResult) return;
    try {
      await shareResult(_currentDrawResult);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Share failed:', e);
    }
  };

  if (btnShareSingle) btnShareSingle.addEventListener('click', handleShare);
  if (btnShareMulti) btnShareMulti.addEventListener('click', handleShare);
}

// Show/hide single fortune share button
export function showSingleFortuneActions() {
  const el = document.getElementById('single-fortune-actions');
  if (el) el.classList.add('visible');
}
export function hideSingleFortuneActions() {
  const el = document.getElementById('single-fortune-actions');
  if (el) el.classList.remove('visible');
}

// Show share button in multi-fortune actions
export function showMultiShareButton() {
  const wrap = document.getElementById('multi-fortune-share-actions');
  const btn = document.getElementById('btn-share-multi');
  if (wrap) wrap.classList.add('visible');
  if (btn) btn.style.display = '';
}
export function hideMultiShareButton() {
  const wrap = document.getElementById('multi-fortune-share-actions');
  const btn = document.getElementById('btn-share-multi');
  if (wrap) wrap.classList.remove('visible');
  if (btn) btn.style.display = 'none';
}

// --- Detail Popup Actions (share + gift from collection) ---
function wireDetailActions() {
  const btnShare = document.getElementById('btn-detail-share');
  const btnGift = document.getElementById('btn-detail-gift');

  if (btnShare) {
    btnShare.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!_currentDetailDraw) return;
      try {
        await shareResult(_currentDetailDraw);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Share failed:', e);
      }
    });
  }

  if (btnGift) {
    btnGift.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!_currentDetailDraw) return;
      const user = getUser();
      if (!user) return;

      try {
        btnGift.disabled = true;
        btnGift.textContent = 'Sending...';
        const result = await createGift(
          _currentDetailDraw.char,
          _currentDetailDraw.rarity.stars,
          _currentDetailDraw.category.name
        );
        // Share the gift URL
        if (navigator.share) {
          await navigator.share({
            title: `A gift from 福 Fortune Gacha!`,
            text: `I'm gifting you ${_currentDetailDraw.char}!`,
            url: result.url,
          });
        } else {
          await navigator.clipboard.writeText(result.url);
        }
        btnGift.textContent = 'Sent!';
        setTimeout(() => {
          btnGift.textContent = 'Gift';
          btnGift.disabled = false;
        }, 2000);
      } catch (err) {
        btnGift.textContent = err.message === 'No duplicate to gift' ? 'No duplicate' : 'Failed';
        setTimeout(() => {
          btnGift.textContent = 'Gift';
          btnGift.disabled = false;
        }, 2000);
      }
    });
  }
}

// Called by main.js when detail popup opens
export function setDetailDraw(drawObj, collectionItem) {
  _currentDetailDraw = drawObj;
  const btnGift = document.getElementById('btn-detail-gift');
  if (btnGift) {
    // Show gift button only if user has duplicates of this character
    if (collectionItem && collectionItem.count > 1) {
      btnGift.style.display = '';
      btnGift.textContent = `Gift (×${collectionItem.count - 1})`;
    } else {
      btnGift.style.display = 'none';
    }
  }
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
        // purchase failed — user sees the price restored
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
