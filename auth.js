// auth.js — Magic link email auth (Supabase prod / mock localStorage dev)
// Supports anonymous users: every visitor gets a UUID on first visit.
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { getSupabaseClient } from './supabase-client.js';

let currentUser = null;
let authListeners = [];
const LS_ANON_BOOTSTRAPPED = 'fu_anon_bootstrapped';

export function onAuthChange(callback) {
  authListeners.push(callback);
  return () => { authListeners = authListeners.filter(cb => cb !== callback); };
}

function notifyListeners() {
  authListeners.forEach(cb => cb(currentUser));
}

export function getUser() {
  return currentUser;
}

export function isAnonymous() {
  return currentUser?.is_anonymous === true;
}

export function applyProfilePatch(patch, shouldNotify = true) {
  if (!patch) return currentUser;
  currentUser = { ...(currentUser || {}), ...patch };
  if (shouldNotify) notifyListeners();
  return currentUser;
}

// --- Shared profile template ---
function createDefaultProfile(userId, email, isAnonymous = false) {
  return {
    id: userId,
    email: email || null,
    display_name: email ? email.split('@')[0] : 'Guest',
    draws_remaining: isAnonymous ? CONFIG.rewards.anonymousWelcomeDraws : CONFIG.rewards.welcomeDraws,
    total_draws: 0,
    pity_counter: 0,
    login_streak: 0,
    last_login_date: null,
    last_share_time: null,
    referral_code: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    referred_by: null,
    referral_count: 0,
    ad_draws_today: 0,
    ad_draws_date: null,
    is_anonymous: isAnonymous,
    created_at: new Date().toISOString(),
  };
}

// --- Dev mode (localStorage) ---
async function devLogin(email) {
  const userId = 'local-' + btoa(email).slice(0, 12);
  let profile = await storage.getProfile(userId);
  if (!profile) {
    profile = createDefaultProfile(userId, email, false);
    await storage.upsertProfile(profile);
    await storage.addTransaction(userId, { type: 'welcome', draws_granted: CONFIG.rewards.welcomeDraws });
  }
  currentUser = profile;
  localStorage.setItem('fu_auth_email', email);
  localStorage.removeItem('fu_anon_id');
  notifyListeners();
  return profile;
}

async function devCreateAnonymous() {
  const anonId = 'anon-' + crypto.randomUUID().slice(0, 12);
  const profile = createDefaultProfile(anonId, null, true);
  await storage.upsertProfile(profile);
  await storage.addTransaction(anonId, { type: 'welcome', draws_granted: CONFIG.rewards.anonymousWelcomeDraws });
  currentUser = profile;
  localStorage.setItem('fu_anon_id', anonId);
  notifyListeners();
  return profile;
}

async function devLinkAnonymous(email) {
  if (!currentUser) throw new Error('No anonymous user to link');
  currentUser.email = email;
  currentUser.display_name = email.split('@')[0];
  currentUser.is_anonymous = false;
  await storage.upsertProfile(currentUser);
  localStorage.removeItem('fu_anon_id');
  localStorage.setItem('fu_auth_email', email);
  notifyListeners();
  return currentUser;
}

function devLogout() {
  currentUser = null;
  localStorage.removeItem('fu_auth_email');
  localStorage.removeItem('fu_anon_id');
  notifyListeners();
  // Immediately create fresh anonymous session
  devCreateAnonymous();
}

async function devRestore() {
  // Try email session first
  const email = localStorage.getItem('fu_auth_email');
  if (email) return devLogin(email);
  // Try restoring anonymous session
  const anonId = localStorage.getItem('fu_anon_id');
  if (anonId) {
    const profile = await storage.getProfile(anonId);
    if (profile) {
      currentUser = profile;
      notifyListeners();
      return profile;
    }
  }
  // No session — return null (anonymous user created lazily on first draw)
  return null;
}

// --- Prod mode (Supabase) ---
async function prodSendMagicLink(email) {
  const sb = await getSupabaseClient();
  const { error } = await sb.auth.signInWithOtp({ email });
  if (error) throw error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAnonymousAuthUser(user) {
  return user?.is_anonymous === true || !user?.email;
}

async function loadProfileWithRetry(userId, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const profile = await storage.getProfile(userId);
    if (profile) return profile;
    if (attempt < maxAttempts) {
      await delay(120 * attempt);
    }
  }
  return null;
}

async function ensureProfileForSessionUser(sessionUser) {
  let profile = await loadProfileWithRetry(sessionUser.id);
  if (profile) return profile;

  profile = createDefaultProfile(sessionUser.id, sessionUser.email ?? null, isAnonymousAuthUser(sessionUser));
  return storage.upsertProfile(profile);
}

async function prodCreateAnonymous() {
  const sb = await getSupabaseClient();
  // Reuse existing session if available (prevents duplicate signups on reload)
  const { data: existing } = await sb.auth.getSession();
  if (existing?.session?.user) {
    const profile = await ensureProfileForSessionUser(existing.session.user);
    currentUser = profile;
    if (profile?.is_anonymous) {
      try { localStorage.setItem(LS_ANON_BOOTSTRAPPED, '1'); } catch {}
    }
    notifyListeners();
    return profile;
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    if ((error.message || '').includes('Database error creating anonymous user')) {
      throw new Error('Anonymous signup failed in Supabase. Check Auth anonymous provider settings and the handle_new_user trigger.');
    }
    throw error;
  }
  const profile = await ensureProfileForSessionUser(data.user);
  currentUser = profile;
  try { localStorage.setItem(LS_ANON_BOOTSTRAPPED, '1'); } catch {}
  notifyListeners();
  return profile;
}

async function prodLinkAnonymous(email) {
  const sb = await getSupabaseClient();
  // Supabase preserves the same UUID when linking anonymous → email
  const { error } = await sb.auth.updateUser({ email });
  if (error) {
    // Email already linked to another account — fall back to magic link
    await prodSendMagicLink(email);
    throw new Error('This email already has an account. Check your email for a login link.');
  }
  currentUser.email = email;
  currentUser.display_name = email.split('@')[0];
  currentUser.is_anonymous = false;
  await storage.upsertProfile(currentUser);
  notifyListeners();
  return currentUser;
}

async function prodRestore() {
  const sb = await getSupabaseClient();

  // Wait for Supabase to finish restoring the session from localStorage.
  // getSession() only returns the in-memory session and may be null if the
  // client hasn't finished its async initialisation yet. Listening for the
  // INITIAL_SESSION event is the reliable way to detect an existing session.
  // Timeout after 5s so we don't hang forever (iOS Safari may never fire this).
  const session = await new Promise((resolve) => {
    let settled = false;
    const { data: { subscription } } = sb.auth.onAuthStateChange(
      (event, sess) => {
        if (event === 'INITIAL_SESSION' && !settled) {
          settled = true;
          subscription.unsubscribe();
          resolve(sess);
        }
      },
    );
    setTimeout(async () => {
      if (!settled) {
        settled = true;
        subscription.unsubscribe();
        // Fallback: try getSession() directly (session may exist even if event didn't fire)
        try {
          const { data } = await sb.auth.getSession();
          resolve(data?.session ?? null);
        } catch {
          resolve(null);
        }
      }
    }, 5000);
  });

  if (session?.user) {
    const profile = await ensureProfileForSessionUser(session.user);
    currentUser = profile;
    if (profile.is_anonymous) {
      try { localStorage.setItem(LS_ANON_BOOTSTRAPPED, '1'); } catch {}
    }
    notifyListeners();
    return profile;
  }
  // No session — return null (anonymous user created lazily on first draw)
  return null;
}

async function prodLogout() {
  const sb = await getSupabaseClient();
  await sb.auth.signOut();
  currentUser = null;
  notifyListeners();
}

// --- Public API ---
export async function sendMagicLink(email) {
  if (!CONFIG.isProd) {
    return devLogin(email); // instant login in dev
  }
  return prodSendMagicLink(email);
}

export async function linkAnonymousToEmail(email) {
  if (!currentUser?.is_anonymous) {
    return sendMagicLink(email);
  }
  if (!CONFIG.isProd) return devLinkAnonymous(email);
  return prodLinkAnonymous(email);
}

export async function logout() {
  if (!CONFIG.isProd) return devLogout();
  return prodLogout();
}

export async function ensureUser() {
  if (currentUser) return currentUser;
  if (!CONFIG.isProd) {
    await devCreateAnonymous();
  } else {
    await prodCreateAnonymous();
  }
  return currentUser;
}

export async function restoreSession() {
  if (!CONFIG.isProd) return devRestore();
  return prodRestore();
}

// Handle referral param from URL
export function getReferralFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('ref') || null;
}

export async function applyReferral(referralCode) {
  if (!currentUser || currentUser.referred_by) return null;
  if (!referralCode) return null;

  if (CONFIG.isProd) {
    const sb = await getSupabaseClient();
    const { data, error } = await sb.rpc('apply_referral', { p_referral_code: referralCode });
    if (error) { console.warn('Referral RPC error:', error); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.referred_by_id) {
      applyProfilePatch({ referred_by: row.referred_by_id });
      return row;
    }
    return null;
  }

  // Dev mode: record referral locally
  currentUser.referred_by = referralCode;
  await storage.upsertProfile(currentUser);
  notifyListeners();
  return { referred_by_id: referralCode };
}

// Refresh profile from storage
export async function refreshProfile() {
  if (!currentUser) return null;
  currentUser = await storage.getProfile(currentUser.id);
  notifyListeners();
  return currentUser;
}

function isInsufficientDrawError(error) {
  const message = (error?.message || '').toUpperCase();
  return message.includes('INSUFFICIENT_DRAWS');
}

async function devSpendDraws(amount) {
  if (!currentUser || amount <= 0) return false;
  const current = currentUser.draws_remaining || 0;
  if (current < amount) return false;

  currentUser.draws_remaining = current - amount;
  currentUser.total_draws = (currentUser.total_draws || 0) + amount;
  await storage.upsertProfile(currentUser);
  notifyListeners();
  return true;
}

async function prodSpendDraws(amount) {
  if (!currentUser || amount <= 0) return false;

  const sb = await getSupabaseClient();
  const { data, error } = await sb.rpc('spend_draws', { p_amount: amount });
  if (error) {
    if (isInsufficientDrawError(error)) return false;
    throw error;
  }

  if (data) {
    currentUser = Array.isArray(data) ? data[0] : data;
    notifyListeners();
  }
  return true;
}

export async function spendDraws(amount) {
  if (!currentUser || !Number.isFinite(amount) || amount <= 0) return false;
  if (!CONFIG.isProd) return devSpendDraws(amount);
  return prodSpendDraws(amount);
}

// Backward-compatible helper:
// negative delta => secure spend path, positive delta => dev-only direct grant.
export async function updateDraws(delta) {
  if (!Number.isFinite(delta) || delta === 0) return currentUser;
  if (delta < 0) {
    const ok = await spendDraws(Math.abs(delta));
    return ok ? currentUser : null;
  }
  if (!currentUser) return;
  if (CONFIG.isProd) {
    throw new Error('Direct draw grants are disabled in production');
  }
  currentUser.draws_remaining = Math.max(0, (currentUser.draws_remaining || 0) + Math.abs(delta));
  await storage.upsertProfile(currentUser);
  notifyListeners();
  return currentUser;
}
