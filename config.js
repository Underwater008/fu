// config.js — Environment configuration
const isProd = import.meta.env.VITE_USE_SUPABASE === 'true';

export const CONFIG = {
  isProd,
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  },
  stripe: {
    publishableKey: import.meta.env.VITE_STRIPE_PK || '',
    prices: {
      draws10: import.meta.env.VITE_STRIPE_PRICE_10 || '',
      draws60: import.meta.env.VITE_STRIPE_PRICE_60 || '',
      draws130: import.meta.env.VITE_STRIPE_PRICE_130 || '',
    },
  },
  ads: {
    adClient: import.meta.env.VITE_AD_CLIENT || '',
    adSlot: import.meta.env.VITE_AD_SLOT || '',
    maxPerDay: 10,
  },
  rewards: {
    welcomeDraws: 99,
    anonymousWelcomeDraws: 99,
    shareDraws: 10,
    shareCooldownMs: 15 * 60 * 1000, // 15 minutes
    firstReferralDraws: 30,
    subsequentReferralDraws: 10,
    dailyLoginRewards: [1, 1, 2, 1, 2, 2, 3], // day 1-7
    dailyLoginDay7Guaranteed4Star: true,
    pity5StarAt: 50,
    pity6StarAt: 90,
  },
  gift: {
    expiryMs: 24 * 60 * 60 * 1000, // 24 hours
  },
};
