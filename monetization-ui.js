// monetization-ui.js — Auth bar, rewards panel, gift UI, share card generation
import { getUser, onAuthChange, sendMagicLink, linkAnonymousToEmail, isAnonymous, logout } from './auth.js';
import { claimShareReward, canShare, getShareCooldownRemaining, getAdCooldownRemaining, getLoginCooldownRemaining, claimDailyLogin } from './rewards.js';
import { showRewardedAd } from './ads.js';
import { purchaseDraws, DRAW_BUNDLES } from './payments.js';
import { createGift, canGift } from './gifting.js';
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { RARITY_TIERS } from './gacha.js';

// Track current draw result for share buttons
let _currentDrawResult = null;
let _currentDetailDraw = null;

// Preload QR code image for share posters
import qrUrl from './image/newqrcode.png';
const qrImg = new Image();
qrImg.crossOrigin = 'anonymous';
qrImg.src = qrUrl;

// Reference to the WebGL renderer canvas (3D scene only, no UI text)
let _sceneCanvas = null;
export function setSceneCanvas(canvas) { _sceneCanvas = canvas; }

// Preload poster font characters for canvas rendering (cn-font-split needs explicit load)
const POSTER_CHARS = '\u798F\u591A\u626B\u7801\u62BD\u65B0\u5E74\u7EB3';
const POSTER_FONT = '"TsangerZhoukeZhengdabangshu"';
document.fonts.ready.then(() => {
  document.fonts.load(`72px ${POSTER_FONT}`, POSTER_CHARS).catch(() => {});
});
// Hidden DOM node to trigger unicode-range matching
const _fontProbe = document.createElement('span');
_fontProbe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;font-size:20px;font-family:"TsangerZhoukeZhengdabangshu",serif';
_fontProbe.textContent = POSTER_CHARS;
document.documentElement.appendChild(_fontProbe);

export function setCurrentDrawResult(drawResult) {
  _currentDrawResult = drawResult;
}

// --- Init ---
export function initMonetizationUI() {
  wireAuthButtons();
  wireRewardsPanel();
  wireDrawCounter();
  wireShareButtons();
  wireDetailActions();
  renderPurchaseBundles();

  // Set initial auth state
  const user = getUser();
  updateAuthUI(user);

  // Listen for changes
  onAuthChange(updateAuthUI);

  // Update cooldown timers
  setInterval(updateLoginCooldown, 1000);
  setInterval(updateShareCooldown, 1000);
  setInterval(updateAdCooldown, 1000);
  updateLoginCooldown();
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
  // Visibility is controlled by .visible class in updateUIVisibility()

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
        if (status) {
          status.textContent = e.isInfo ? e.message : 'Error: ' + e.message;
          status.style.color = e.isInfo ? '' : '#ff6b6b';
        }
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

// --- Draw Counter (opens rewards panel on click) ---
export function openRewardsPanel() {
  const panel = document.getElementById('rewards-panel');
  const backdrop = document.getElementById('rewards-panel-backdrop');
  if (panel) panel.style.display = 'flex';
  if (backdrop) backdrop.style.display = 'block';
}
function closeRewardsPanel() {
  const panel = document.getElementById('rewards-panel');
  const backdrop = document.getElementById('rewards-panel-backdrop');
  if (panel) panel.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
}
function wireDrawCounter() {
  const drawCounterFloat = document.getElementById('draw-counter-float');
  if (drawCounterFloat) {
    drawCounterFloat.style.cursor = 'pointer';
    drawCounterFloat.addEventListener('click', openRewardsPanel);
  }
}

// --- Rewards Panel ---
function wireRewardsPanel() {
  const btnClose = document.getElementById('btn-close-rewards');
  const btnShare = document.getElementById('btn-share-draw');
  const btnAd = document.getElementById('btn-watch-ad');
  const btnReferral = document.getElementById('btn-copy-referral');
  const btnLogin = document.getElementById('login-streak-btn');

  const backdrop = document.getElementById('rewards-panel-backdrop');

  if (btnClose) {
    btnClose.addEventListener('click', closeRewardsPanel);
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeRewardsPanel);
  }

  if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
      const user = getUser();
      if (!user) return;
      btnLogin.disabled = true;
      try {
        const result = await claimDailyLogin();
        if (result) {
          _loginJustClaimed = true;
          btnLogin.querySelector('.rewards-btn-badge').textContent = `+${result.draws} Claimed!`;
          updateAuthUI(getUser());
          setTimeout(() => { _loginJustClaimed = false; }, 2000);
        } else {
          _loginJustClaimed = true;
          btnLogin.querySelector('.rewards-btn-badge').textContent = 'Already claimed';
          setTimeout(() => { _loginJustClaimed = false; }, 2000);
        }
      } catch (e) {
        console.warn('Daily login claim failed:', e);
        btnLogin.disabled = false;
      }
    });
  }

  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      const user = getUser();
      if (!user) return;

      try {
        // Generate and share a web poster image
        await sharePoster();
        const result = await claimShareReward();
        if (result) {
          btnShare.innerHTML = `<span>+${result.draws} Draws!</span>`;
          setTimeout(() => { btnShare.innerHTML = '<span>Share</span><span class="rewards-btn-badge">+10</span>'; }, 2000);
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
      btnAd.innerHTML = '<span>Watching...</span>';
      const result = await showRewardedAd();
      if (result.success) {
        btnAd.innerHTML = '<span>+6 Draws!</span>';
        updateAuthUI(getUser());
      } else {
        btnAd.innerHTML = '<span>Daily limit reached</span>';
      }
      setTimeout(() => {
        btnAd.disabled = false;
        btnAd.innerHTML = '<span>Ad</span><span class="rewards-btn-badge">+6</span>';
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
        btnReferral.innerHTML = '<span>Invite</span><span class="rewards-btn-badge">Copied!</span>';
        setTimeout(() => {
          btnReferral.innerHTML = '<span>Invite</span><span class="rewards-btn-badge">+30</span>';
        }, 2000);
      } catch {
        btnReferral.innerHTML = '<span>Invite</span><span class="rewards-btn-badge">Copied!</span>';
        setTimeout(() => {
          btnReferral.innerHTML = '<span>Invite</span><span class="rewards-btn-badge">+30</span>';
        }, 2000);
      }
    });
  }
}

function formatCooldown(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatLongCooldown(ms) {
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

let _loginJustClaimed = false;

function updateLoginCooldown() {
  if (_loginJustClaimed) return;
  const btn = document.getElementById('login-streak-btn');
  if (!btn) return;
  const remaining = getLoginCooldownRemaining();
  if (remaining <= 0) {
    btn.disabled = false;
    btn.querySelector('.rewards-btn-badge').textContent = '+6 daily';
  } else {
    btn.disabled = true;
    btn.querySelector('.rewards-btn-badge').textContent = formatLongCooldown(remaining);
  }
}

function updateShareCooldown() {
  const btn = document.getElementById('btn-share-draw');
  if (!btn) return;
  const remaining = getShareCooldownRemaining();
  if (remaining <= 0) {
    btn.disabled = false;
    btn.innerHTML = '<span>Share</span><span class="rewards-btn-badge">+10</span>';
  } else {
    btn.disabled = true;
    btn.innerHTML = `<span>Share</span><span class="rewards-btn-badge">${formatCooldown(remaining)}</span>`;
  }
}

function updateAdCooldown() {
  const btn = document.getElementById('btn-watch-ad');
  if (!btn) return;
  const remaining = getAdCooldownRemaining();
  if (remaining <= 0) {
    btn.disabled = false;
    btn.innerHTML = '<span>Ad</span><span class="rewards-btn-badge">+6</span>';
  } else {
    btn.disabled = true;
    btn.innerHTML = `<span>Ad</span><span class="rewards-btn-badge">${formatCooldown(remaining)}</span>`;
  }
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
    btnGift.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_currentDetailDraw) return;
      const user = getUser();
      if (!user) return;
      // Show gift modal with character info
      const modal = document.getElementById('gift-modal');
      const desc = document.getElementById('gift-modal-desc');
      const emailInput = document.getElementById('gift-email');
      const status = document.getElementById('gift-status');
      if (!modal) return;
      desc.textContent = `Send "${_currentDetailDraw.char}" to a friend`;
      emailInput.value = '';
      status.textContent = '';
      modal.style.display = '';
      emailInput.focus();
    });
  }

  // Gift modal handlers
  const giftModal = document.getElementById('gift-modal');
  const btnSendGift = document.getElementById('btn-send-gift');
  const btnCloseGift = document.getElementById('btn-close-gift');

  if (btnCloseGift) {
    btnCloseGift.addEventListener('click', () => {
      giftModal.style.display = 'none';
    });
  }
  if (giftModal) {
    giftModal.addEventListener('click', (e) => {
      if (e.target === giftModal) giftModal.style.display = 'none';
    });
  }

  if (btnSendGift) {
    btnSendGift.addEventListener('click', async () => {
      const emailInput = document.getElementById('gift-email');
      const status = document.getElementById('gift-status');
      const email = emailInput.value.trim();
      if (!email || !emailInput.validity.valid) {
        status.textContent = 'Please enter a valid email';
        return;
      }
      if (!_currentDetailDraw) return;

      try {
        btnSendGift.disabled = true;
        btnSendGift.textContent = 'Sending...';
        const result = await createGift(
          _currentDetailDraw.char,
          _currentDetailDraw.rarity.stars,
          _currentDetailDraw.category.name,
          email
        );
        await navigator.clipboard.writeText(result.url);
        status.textContent = 'Gift sent! Link copied to clipboard';
        btnSendGift.textContent = 'Sent!';
        // Update the gift button count in the detail popup
        const btnGiftEl = document.getElementById('btn-detail-gift');
        if (btnGiftEl) {
          const collection = await storage.getCollection(getUser().id);
          const item = collection[_currentDetailDraw.char];
          if (item && item.count > 1) {
            btnGiftEl.textContent = `Gift (×${item.count - 1})`;
          } else {
            btnGiftEl.style.display = 'none';
          }
        }
        setTimeout(() => {
          giftModal.style.display = 'none';
          btnSendGift.textContent = 'Send Gift';
          btnSendGift.disabled = false;
        }, 1500);
      } catch (err) {
        status.textContent = err.message === 'No duplicate to gift' ? 'No duplicate available' : 'Failed to send gift';
        btnSendGift.textContent = 'Send Gift';
        btnSendGift.disabled = false;
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
        } else {
          btn.querySelector('.purchase-price').textContent = bundle.price;
          btn.disabled = false;
        }
      } catch (e) {
        console.error('[purchase] failed:', e);
        btn.querySelector('.purchase-price').textContent = bundle.price;
        btn.disabled = false;
      }
    });
    container.appendChild(btn);
  }
}

// --- Share Card Image Generation ---
export function generateShareCard(drawResult) {
  const W = 1080, H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Red gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#8B0000');
  grad.addColorStop(0.5, '#CC0000');
  grad.addColorStop(1, '#8B0000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle texture pattern
  ctx.globalAlpha = 0.03;
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    ctx.fillStyle = '#FFD700';
    ctx.font = `${40 + Math.random() * 60}px "TsangerZhoukeZhengdabangshu", serif`;
    ctx.fillText('福', x, y);
  }
  ctx.globalAlpha = 1;

  // Gold border
  ctx.strokeStyle = drawResult.rarity.color;
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, W - 72, H - 72);

  // Inner border
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  // Rarity glow border
  ctx.shadowColor = drawResult.rarity.glow;
  ctx.shadowBlur = 50;
  ctx.strokeStyle = drawResult.rarity.color;
  ctx.lineWidth = 3;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.shadowBlur = 0;

  const F = '"TsangerZhoukeZhengdabangshu", serif';

  // Character (large, centered)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = drawResult.rarity.glow;
  ctx.shadowBlur = 40;
  ctx.font = `320px ${F}`;
  ctx.fillText(drawResult.char, W / 2, 520);
  ctx.shadowBlur = 0;

  // Stars
  const stars = drawResult.rarity.stars;
  const starStr = '\u2605'.repeat(stars);
  ctx.fillStyle = drawResult.rarity.color;
  ctx.font = `56px ${F}`;
  ctx.fillText(starStr, W / 2, 640);

  // Tier label
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = `36px ${F}`;
  ctx.fillText(drawResult.rarity.label, W / 2, 710);

  // Tier label English
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = `24px ${F}`;
  ctx.fillText(drawResult.rarity.labelEn || '', W / 2, 750);

  // Category
  ctx.fillStyle = drawResult.category.color;
  ctx.font = `32px ${F}`;
  ctx.fillText(drawResult.category.name, W / 2, 810);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = `22px ${F}`;
  ctx.fillText(drawResult.category.nameEn, W / 2, 848);

  // Divider
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(180, 900);
  ctx.lineTo(W - 180, 900);
  ctx.stroke();

  // Blessing phrase
  ctx.fillStyle = '#FFD700';
  ctx.font = `64px ${F}`;
  ctx.fillText(drawResult.blessing.phrase, W / 2, 1000);

  // English
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = `italic 28px ${F}`;
  ctx.fillText(drawResult.blessing.english, W / 2, 1060);

  // Branding text (left-aligned, larger)
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = `48px ${F}`;
  ctx.fillText('\u626B\u7801\u62BD\u798F', 72, H - 170);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = `28px ${F}`;
  ctx.fillText('Scan to try your fortune', 72, H - 122);
  ctx.fillStyle = 'rgba(255, 215, 0, 0.45)';
  ctx.font = `24px ${F}`;
  ctx.fillText(window.location.origin, 72, H - 82);

  // QR code (bottom-right, no background frame)
  if (qrImg.complete && qrImg.naturalWidth > 0) {
    const qrSize = 180;
    const qrX = W - 60 - qrSize;
    const qrY = H - 60 - qrSize;
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  }

  return canvas.toDataURL('image/png');
}

export async function shareResult(drawResult) {
  const imageDataUrl = generateShareCard(drawResult);
  const title = `I drew ${drawResult.char} — ${drawResult.blessing.english}`;
  await showSharePreview(imageDataUrl, 'fortune.png', title);
}

// --- Web Poster Generation (main page share) ---
export function generateWebPoster() {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1. Dark red gradient base
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#3A0000');
  bgGrad.addColorStop(0.35, '#8B0000');
  bgGrad.addColorStop(0.65, '#CC0000');
  bgGrad.addColorStop(1, '#3A0000');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Subtle radial glow behind the character
  const radGrad = ctx.createRadialGradient(W / 2, H * 0.48, 0, W / 2, H * 0.48, 500);
  radGrad.addColorStop(0, 'rgba(255, 180, 0, 0.15)');
  radGrad.addColorStop(0.5, 'rgba(200, 50, 0, 0.08)');
  radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, W, H);

  // 3. Faint decorative 福 texture scattered in background
  ctx.save();
  ctx.globalAlpha = 0.025;
  ctx.fillStyle = '#FFD700';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    ctx.font = `${30 + Math.random() * 50}px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif`;
    ctx.fillText('\u798F', x, y);
  }
  ctx.restore();

  // 4. Gold border frame
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(52, 52, W - 104, H - 104);

  // 5. Large centered 福 character with glow
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fuY = H * 0.46;

  // Multi-layer glow effect
  ctx.shadowColor = 'rgba(255, 200, 50, 0.6)';
  ctx.shadowBlur = 80;
  ctx.fillStyle = 'rgba(255, 215, 0, 0.08)';
  ctx.font = '520px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText('\u798F', W / 2, fuY);

  ctx.shadowBlur = 50;
  ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
  ctx.fillText('\u798F', W / 2, fuY);

  ctx.shadowColor = 'rgba(255, 180, 0, 0.8)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#FFD700';
  ctx.font = '480px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText('\u798F', W / 2, fuY);
  ctx.shadowBlur = 0;

  // "新年纳福" below the big 福
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = 'rgba(255, 200, 50, 0.4)';
  ctx.shadowBlur = 15;
  ctx.font = '72px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText('\u65B0\u5E74\u7EB3\u798F', W / 2, fuY + 380);
  ctx.shadowBlur = 0;

  // English below
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = 'italic 44px "Roboto Slab", serif';
  ctx.fillText('Embrace Fortune in the New Year', W / 2, fuY + 450);

  // 6. Top: "FUDUODUO" (main) + "福多多" (subtitle)
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
  ctx.shadowBlur = 15;
  ctx.font = '600 104px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.letterSpacing = '12px';
  ctx.fillText('FUDUODUO', W / 2, 190);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255, 215, 0, 0.4)';
  ctx.font = '112px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText('\u798F\u591A\u591A', W / 2, 310);

  // Bottom gradient for QR readability
  const botGrad = ctx.createLinearGradient(0, H - 380, 0, H);
  botGrad.addColorStop(0, 'rgba(40, 0, 0, 0)');
  botGrad.addColorStop(0.5, 'rgba(40, 0, 0, 0.45)');
  botGrad.addColorStop(1, 'rgba(40, 0, 0, 0.85)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, H - 380, W, 380);

  // 7. Bottom section — text + QR code
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '72px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText('\u626B\u7801\u62BD\u798F', 80, H - 290);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '44px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText('Scan to try your fortune', 80, H - 220);

  ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
  ctx.font = '40px "TsangerZhoukeZhengdabangshu", "Ma Shan Zheng", serif';
  ctx.fillText(window.location.origin, 80, H - 155);

  // QR code (bottom-right, no background frame)
  if (qrImg.complete && qrImg.naturalWidth > 0) {
    const qrSize = 220;
    const qrX = W - 60 - qrSize;
    const qrY = H - 60 - qrSize;
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  }

  return canvas.toDataURL('image/png');
}

// Share web poster (for main page share button)
export async function sharePoster() {
  const imageDataUrl = generateWebPoster();
  await showSharePreview(imageDataUrl, 'fuduoduo-poster.png', '\u798F\u591A\u591A Fortune Gacha');
}

// --- Share Preview Modal ---
function showSharePreview(imageDataUrl, filename, title) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('share-preview-backdrop');
    const modal = document.getElementById('share-preview-modal');
    const img = document.getElementById('share-preview-img');
    const btnConfirm = document.getElementById('btn-share-confirm');
    const btnDownload = document.getElementById('btn-share-download');
    const btnClose = document.getElementById('btn-share-close');

    if (!modal || !img) { resolve(); return; }

    img.src = imageDataUrl;
    backdrop.style.display = '';
    modal.style.display = '';

    // Check if Web Share API supports file sharing
    const canShareFiles = (() => {
      try {
        const testBlob = new Blob([''], { type: 'image/png' });
        const testFile = new File([testBlob], 'test.png', { type: 'image/png' });
        return navigator.canShare?.({ files: [testFile] });
      } catch { return false; }
    })();
    btnConfirm.style.display = canShareFiles ? '' : 'none';

    const cleanup = () => {
      backdrop.style.display = 'none';
      modal.style.display = 'none';
      btnConfirm.removeEventListener('click', onShare);
      btnDownload.removeEventListener('click', onDownload);
      btnClose.removeEventListener('click', onClose);
      backdrop.removeEventListener('click', onClose);
    };

    const toFile = async () => {
      const blob = await (await fetch(imageDataUrl)).blob();
      return new File([blob], filename, { type: 'image/png' });
    };

    const onShare = async () => {
      try {
        const file = await toFile();
        await navigator.share({ title, files: [file] });
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Share failed:', e);
      }
      cleanup();
      resolve();
    };

    const onDownload = async () => {
      // Mobile: use native share sheet (has "Save Image" option)
      if (canShareFiles && 'ontouchstart' in window) {
        try {
          const file = await toFile();
          await navigator.share({ files: [file] });
        } catch (e) {
          if (e.name !== 'AbortError') console.warn('Save failed:', e);
        }
      } else {
        // Desktop: normal download
        const a = document.createElement('a');
        a.href = imageDataUrl;
        a.download = filename;
        a.click();
      }
      cleanup();
      resolve();
    };

    const onClose = () => {
      cleanup();
      resolve();
    };

    btnConfirm.addEventListener('click', onShare);
    btnDownload.addEventListener('click', onDownload);
    btnClose.addEventListener('click', onClose);
    backdrop.addEventListener('click', onClose);
  });
}
