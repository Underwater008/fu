// auth.js — Magic link email auth (Supabase prod / mock localStorage dev)
import { CONFIG } from './config.js';
import { storage } from './storage.js';

let currentUser = null;
let authListeners = [];

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

// --- Dev mode (localStorage) ---
async function devLogin(email) {
  const userId = 'local-' + btoa(email).slice(0, 12);
  let profile = await storage.getProfile(userId);
  if (!profile) {
    profile = {
      id: userId,
      email,
      display_name: email.split('@')[0],
      draws_remaining: CONFIG.rewards.welcomeDraws,
      total_draws: 0,
      pity_counter: 0,
      login_streak: 0,
      last_login_date: null,
      last_share_time: null,
      referral_code: crypto.randomUUID().slice(0, 8),
      referred_by: null,
      referral_count: 0,
      ad_draws_today: 0,
      ad_draws_date: null,
      created_at: new Date().toISOString(),
    };
    await storage.upsertProfile(profile);
    await storage.addTransaction(userId, { type: 'welcome', draws_granted: CONFIG.rewards.welcomeDraws });
  }
  currentUser = profile;
  localStorage.setItem('fu_auth_email', email);
  notifyListeners();
  return profile;
}

function devLogout() {
  currentUser = null;
  localStorage.removeItem('fu_auth_email');
  notifyListeners();
}

async function devRestore() {
  const email = localStorage.getItem('fu_auth_email');
  if (email) return devLogin(email);
  return null;
}

// --- Prod mode (Supabase) ---
async function prodSendMagicLink(email) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  const { error } = await sb.auth.signInWithOtp({ email });
  if (error) throw error;
}

async function prodRestore() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    let profile = await storage.getProfile(session.user.id);
    if (!profile) {
      profile = {
        id: session.user.id,
        email: session.user.email,
        display_name: session.user.email.split('@')[0],
        draws_remaining: CONFIG.rewards.welcomeDraws,
        total_draws: 0,
        pity_counter: 0,
        login_streak: 0,
        last_login_date: null,
        last_share_time: null,
        referral_code: crypto.randomUUID().slice(0, 8),
        referred_by: null,
        referral_count: 0,
        ad_draws_today: 0,
        ad_draws_date: null,
        created_at: new Date().toISOString(),
      };
      await storage.upsertProfile(profile);
      await storage.addTransaction(session.user.id, { type: 'welcome', draws_granted: CONFIG.rewards.welcomeDraws });
    }
    currentUser = profile;
    notifyListeners();
    return profile;
  }
  return null;
}

async function prodLogout() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
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

export async function logout() {
  if (!CONFIG.isProd) return devLogout();
  return prodLogout();
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
  if (!currentUser || currentUser.referred_by) return;
  // Referral tracking is prod-only (Supabase) — in dev, just log it.
  if (!CONFIG.isProd) {
    console.log('[dev] referral code applied:', referralCode);
    return;
  }
  // Prod: Supabase edge function or direct query handles referral credit
}

// Refresh profile from storage
export async function refreshProfile() {
  if (!currentUser) return null;
  currentUser = await storage.getProfile(currentUser.id);
  notifyListeners();
  return currentUser;
}

// Update draws_remaining locally and persist
export async function updateDraws(delta) {
  if (!currentUser) return;
  currentUser.draws_remaining = Math.max(0, (currentUser.draws_remaining || 0) + delta);
  await storage.upsertProfile(currentUser);
  notifyListeners();
}
