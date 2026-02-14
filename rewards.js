// rewards.js — Daily login, share-to-draw, referral, ad rewards
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { getUser, applyProfilePatch } from './auth.js';
import { getSupabaseClient } from './supabase-client.js';

async function callRpc(name, args = {}) {
  const sb = await getSupabaseClient();
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    // If the session expired, refresh and retry once
    if (error.message === 'NOT_AUTHENTICATED') {
      const { error: refreshErr } = await sb.auth.refreshSession();
      if (!refreshErr) {
        const retry = await sb.rpc(name, args);
        if (retry.error) throw retry.error;
        if (Array.isArray(retry.data)) return retry.data[0] || null;
        return retry.data || null;
      }
    }
    throw error;
  }
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

// --- Daily Login ---
export async function claimDailyLogin() {
  const user = getUser();
  if (!user) return null;

  if (CONFIG.isProd) {
    const result = await callRpc('claim_daily_login_reward');
    if (!result) return null;

    applyProfilePatch({
      draws_remaining: result.draws_remaining,
      login_streak: result.streak,
      last_login_date: result.login_date,
    });

    return {
      streak: result.streak,
      draws: result.draws_granted,
      isDay7: result.is_day7,
      guaranteed4Star: result.is_day7 && CONFIG.rewards.dailyLoginDay7Guaranteed4Star,
    };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (user.last_login_date === today) return null; // already claimed

  // Check streak
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = (user.last_login_date === yesterday) ? user.login_streak + 1 : 1;
  if (streak > 7) streak = 1; // reset cycle

  const dayIndex = streak - 1;
  const draws = CONFIG.rewards.dailyLoginRewards[dayIndex] || 1;

  user.login_streak = streak;
  user.last_login_date = today;
  user.draws_remaining += draws;
  await storage.upsertProfile(user);
  await storage.addTransaction(user.id, { type: 'daily_login', draws_granted: draws });

  return {
    streak,
    draws,
    isDay7: streak === 7,
    guaranteed4Star: streak === 7 && CONFIG.rewards.dailyLoginDay7Guaranteed4Star,
  };
}

// --- Share to Draw ---
export async function canShare() {
  const user = getUser();
  if (!user) return false;
  if (!user.last_share_time) return true;
  const elapsed = Date.now() - new Date(user.last_share_time).getTime();
  return elapsed >= CONFIG.rewards.shareCooldownMs;
}

export function getShareCooldownRemaining() {
  const user = getUser();
  if (!user || !user.last_share_time) return 0;
  const elapsed = Date.now() - new Date(user.last_share_time).getTime();
  return Math.max(0, CONFIG.rewards.shareCooldownMs - elapsed);
}

export async function claimShareReward() {
  const user = getUser();
  if (!user) return null;

  if (CONFIG.isProd) {
    const result = await callRpc('claim_share_reward');
    if (!result) return null;

    applyProfilePatch({
      draws_remaining: result.draws_remaining,
      last_share_time: result.last_share_time,
    });

    return { draws: result.draws_granted };
  }

  if (!(await canShare())) return null;

  user.last_share_time = new Date().toISOString();
  user.draws_remaining += CONFIG.rewards.shareDraws;
  await storage.upsertProfile(user);
  await storage.addTransaction(user.id, { type: 'share', draws_granted: CONFIG.rewards.shareDraws });

  return { draws: CONFIG.rewards.shareDraws };
}

// --- Referral ---
export async function claimReferralReward(newUserId) {
  const user = getUser();
  if (!user) return null;

  if (CONFIG.isProd) {
    // Referral rewards are claimed server-side in production
    return null;
  }

  const isFirst = (user.referral_count || 0) === 0;
  const draws = isFirst ? CONFIG.rewards.firstReferralDraws : CONFIG.rewards.subsequentReferralDraws;

  user.referral_count = (user.referral_count || 0) + 1;
  user.draws_remaining += draws;
  await storage.upsertProfile(user);
  await storage.addTransaction(user.id, { type: 'referral', draws_granted: draws });

  return { draws, referralCount: user.referral_count };
}

// --- Ad Reward ---
const AD_DRAWS_PER_WATCH = 6;
const AD_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export async function canWatchAd() {
  const user = getUser();
  if (!user) return false;
  // Check cooldown
  if (user.last_ad_time) {
    const elapsed = Date.now() - new Date(user.last_ad_time).getTime();
    if (elapsed < AD_COOLDOWN_MS) return false;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (user.ad_draws_date !== today) return true; // new day
  return (user.ad_draws_today || 0) < CONFIG.ads.maxPerDay;
}

export function getAdCooldownRemaining() {
  const user = getUser();
  if (!user || !user.last_ad_time) return 0;
  const elapsed = Date.now() - new Date(user.last_ad_time).getTime();
  return Math.max(0, AD_COOLDOWN_MS - elapsed);
}

export async function claimAdReward() {
  const user = getUser();
  if (!user) return null;

  if (CONFIG.isProd) {
    const result = await callRpc('claim_ad_reward');
    if (!result) return null;

    applyProfilePatch({
      draws_remaining: result.draws_remaining,
      ad_draws_today: result.ads_watched_today,
      ad_draws_date: result.ad_draws_date,
      last_ad_time: new Date().toISOString(),
    });

    return {
      draws: result.draws_granted,
      adsWatchedToday: result.ads_watched_today,
    };
  }

  if (!(await canWatchAd())) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (user.ad_draws_date !== today) {
    user.ad_draws_today = 0;
    user.ad_draws_date = today;
  }
  user.ad_draws_today += 1;
  user.last_ad_time = new Date().toISOString();
  user.draws_remaining += AD_DRAWS_PER_WATCH;
  await storage.upsertProfile(user);
  await storage.addTransaction(user.id, { type: 'ad_reward', draws_granted: AD_DRAWS_PER_WATCH });

  return { draws: AD_DRAWS_PER_WATCH, adsWatchedToday: user.ad_draws_today };
}

// --- Pity tracking ---
export async function incrementPity() {
  const user = getUser();
  if (!user) return 0;

  if (CONFIG.isProd) {
    const result = await callRpc('increment_pity_counter');
    const pity = result?.pity_counter || 0;
    applyProfilePatch({ pity_counter: pity });
    return pity;
  }

  user.pity_counter = (user.pity_counter || 0) + 1;
  await storage.upsertProfile(user);
  return user.pity_counter;
}

export async function resetPity() {
  const user = getUser();
  if (!user) return;

  if (CONFIG.isProd) {
    await callRpc('reset_pity_counter');
    applyProfilePatch({ pity_counter: 0 });
    return;
  }

  user.pity_counter = 0;
  await storage.upsertProfile(user);
}

export async function setPityCounter(value) {
  const user = getUser();
  if (!user) return 0;
  const nextValue = Math.max(0, Number(value) || 0);

  if (CONFIG.isProd) {
    const result = await callRpc('set_pity_counter', { p_value: nextValue });
    const pity = result?.pity_counter ?? nextValue;
    applyProfilePatch({ pity_counter: pity });
    return pity;
  }

  user.pity_counter = nextValue;
  await storage.upsertProfile(user);
  return user.pity_counter;
}

export function getPityCounter() {
  const user = getUser();
  return user?.pity_counter || 0;
}
