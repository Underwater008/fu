// rewards.js — Daily login, share-to-draw, referral, ad rewards
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { getUser, updateDraws } from './auth.js';

// --- Daily Login ---
export async function claimDailyLogin() {
  const user = getUser();
  if (!user) return null;

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

  const isFirst = (user.referral_count || 0) === 0;
  const draws = isFirst ? CONFIG.rewards.firstReferralDraws : CONFIG.rewards.subsequentReferralDraws;

  user.referral_count = (user.referral_count || 0) + 1;
  user.draws_remaining += draws;
  await storage.upsertProfile(user);
  await storage.addTransaction(user.id, { type: 'referral', draws_granted: draws });

  return { draws, referralCount: user.referral_count };
}

// --- Ad Reward ---
export async function canWatchAd() {
  const user = getUser();
  if (!user) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (user.ad_draws_date !== today) return true; // new day
  return (user.ad_draws_today || 0) < CONFIG.ads.maxPerDay;
}

export async function claimAdReward() {
  const user = getUser();
  if (!user) return null;
  if (!(await canWatchAd())) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (user.ad_draws_date !== today) {
    user.ad_draws_today = 0;
    user.ad_draws_date = today;
  }
  user.ad_draws_today += 1;
  user.draws_remaining += 1;
  await storage.upsertProfile(user);
  await storage.addTransaction(user.id, { type: 'ad_reward', draws_granted: 1 });

  return { draws: 1, adsWatchedToday: user.ad_draws_today };
}

// --- Pity tracking ---
export async function incrementPity() {
  const user = getUser();
  if (!user) return 0;
  user.pity_counter = (user.pity_counter || 0) + 1;
  user.total_draws = (user.total_draws || 0) + 1;
  await storage.upsertProfile(user);
  return user.pity_counter;
}

export async function resetPity() {
  const user = getUser();
  if (!user) return;
  user.pity_counter = 0;
  await storage.upsertProfile(user);
}

export function getPityCounter() {
  const user = getUser();
  return user?.pity_counter || 0;
}
