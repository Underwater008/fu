# Web Monetization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add monetization, auth, and viral features to the Fu gacha game for Chinese New Year seasonal launch.

**Architecture:** Dual-storage abstraction (localStorage for dev, Supabase for prod) behind a unified API. New modules (`config.js`, `storage.js`, `auth.js`, `rewards.js`, `ads.js`, `payments.js`, `gifting.js`) wrap around the existing `gacha.js` and `main.js` with minimal modifications to existing code. Draw gating via `draws_remaining` counter replaces unlimited free draws.

**Tech Stack:** Vite, Three.js (existing), Supabase (Auth + Postgres + Edge Functions), Stripe Checkout, Google AdSense rewarded ads, Web Share API.

---

## Feature Summary

| Feature | Details |
|---------|---------|
| Auth | Magic link email via Supabase Auth |
| Storage | localStorage (dev) / Supabase (prod), env flag |
| Pity | Guaranteed 5★+ at 50 draws, 6★ at 90 draws |
| Daily login | 7-day streak cycle: 1,1,2,1,2,2,3+guaranteed 4★ |
| Share-to-draw | Share → 10 draws, 15 min cooldown |
| Referral | 1st friend signup → 30 draws, each after → 10 draws |
| Rewarded ads | Watch ad → 1 draw, max 10/day |
| Stripe | 10 draws $0.99, 60 draws $4.99, 130 draws $9.99 |
| Gifting | Send duplicate characters via 24h expiry link |
| Welcome bonus | 10 free draws on signup |

## Data Model

### profiles
```sql
create table profiles (
  id uuid primary key references auth.users(id),
  email text,
  display_name text,
  draws_remaining int default 10,
  total_draws int default 0,
  pity_counter int default 0,
  login_streak int default 0,
  last_login_date date,
  last_share_time timestamptz,
  referral_code text unique,
  referred_by uuid references profiles(id),
  referral_count int default 0,
  ad_draws_today int default 0,
  ad_draws_date date,
  created_at timestamptz default now()
);
```

### collections
```sql
create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  character text not null,
  rarity int not null,
  category_name text not null,
  count int default 1,
  max_stars int not null,
  first_drawn_at timestamptz default now(),
  unique(user_id, character)
);
```

### transactions
```sql
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  type text not null, -- 'stripe', 'ad_reward', 'share', 'daily_login', 'referral', 'welcome'
  draws_granted int not null,
  stripe_session_id text,
  created_at timestamptz default now()
);
```

### gifts
```sql
create table gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references profiles(id) on delete cascade,
  character text not null,
  rarity int not null,
  category_name text not null,
  token text unique not null,
  claimed_by uuid references profiles(id),
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
```

---

## Task 1: Config & Environment Setup

**Files:**
- Create: `config.js`
- Create: `.env.example`
- Modify: `index.html` (add Supabase + Stripe script tags)

**Step 1: Create config.js**

```js
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
    welcomeDraws: 10,
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
```

**Step 2: Create .env.example**

```
VITE_USE_SUPABASE=false
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_STRIPE_PK=
VITE_STRIPE_PRICE_10=
VITE_STRIPE_PRICE_60=
VITE_STRIPE_PRICE_130=
VITE_AD_CLIENT=
VITE_AD_SLOT=
```

**Step 3: Add .env to .gitignore**

Append `.env` and `.env.local` to existing `.gitignore`.

**Step 4: Commit**

```bash
git add config.js .env.example .gitignore
git commit -m "feat: add environment config and feature flags"
```

---

## Task 2: Storage Abstraction Layer

**Files:**
- Create: `storage.js`

**Step 1: Create storage.js with dual backend**

```js
// storage.js — Dual storage abstraction (localStorage dev / Supabase prod)
import { CONFIG } from './config.js';

// ---- localStorage backend ----
const LS_KEYS = {
  profile: 'fu_profile',
  collection: 'fu_gacha_collection',
  stats: 'fu_gacha_stats',
  transactions: 'fu_transactions',
  gifts: 'fu_gifts',
};

function lsGet(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

const localBackend = {
  // Profile
  async getProfile(userId) {
    return lsGet(LS_KEYS.profile, null);
  },
  async upsertProfile(profile) {
    lsSet(LS_KEYS.profile, profile);
    return profile;
  },

  // Collection
  async getCollection(userId) {
    return lsGet(LS_KEYS.collection, {});
  },
  async upsertCollectionItem(userId, char, data) {
    const coll = lsGet(LS_KEYS.collection, {});
    coll[char] = data;
    lsSet(LS_KEYS.collection, coll);
    return data;
  },

  // Transactions
  async addTransaction(userId, tx) {
    const txs = lsGet(LS_KEYS.transactions, []);
    txs.push({ ...tx, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    lsSet(LS_KEYS.transactions, txs);
  },

  // Gifts
  async createGift(gift) {
    const gifts = lsGet(LS_KEYS.gifts, []);
    gifts.push(gift);
    lsSet(LS_KEYS.gifts, gifts);
    return gift;
  },
  async getGiftByToken(token) {
    const gifts = lsGet(LS_KEYS.gifts, []);
    return gifts.find(g => g.token === token) || null;
  },
  async claimGift(token, claimerId) {
    const gifts = lsGet(LS_KEYS.gifts, []);
    const gift = gifts.find(g => g.token === token);
    if (gift) {
      gift.claimed_by = claimerId;
      gift.claimed_at = new Date().toISOString();
      lsSet(LS_KEYS.gifts, gifts);
    }
    return gift;
  },
};

// ---- Supabase backend ----
let supabase = null;

async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  return supabase;
}

const supabaseBackend = {
  async getProfile(userId) {
    const sb = await getSupabase();
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data;
  },
  async upsertProfile(profile) {
    const sb = await getSupabase();
    const { data } = await sb.from('profiles').upsert(profile).select().single();
    return data;
  },
  async getCollection(userId) {
    const sb = await getSupabase();
    const { data } = await sb.from('collections').select('*').eq('user_id', userId);
    const coll = {};
    for (const row of (data || [])) {
      coll[row.character] = row;
    }
    return coll;
  },
  async upsertCollectionItem(userId, char, itemData) {
    const sb = await getSupabase();
    const { data } = await sb.from('collections')
      .upsert({ user_id: userId, character: char, ...itemData }, { onConflict: 'user_id,character' })
      .select().single();
    return data;
  },
  async addTransaction(userId, tx) {
    const sb = await getSupabase();
    await sb.from('transactions').insert({ user_id: userId, ...tx });
  },
  async createGift(gift) {
    const sb = await getSupabase();
    const { data } = await sb.from('gifts').insert(gift).select().single();
    return data;
  },
  async getGiftByToken(token) {
    const sb = await getSupabase();
    const { data } = await sb.from('gifts').select('*').eq('token', token).single();
    return data;
  },
  async claimGift(token, claimerId) {
    const sb = await getSupabase();
    const { data } = await sb.from('gifts')
      .update({ claimed_by: claimerId, claimed_at: new Date().toISOString() })
      .eq('token', token).is('claimed_by', null)
      .select().single();
    return data;
  },
};

// ---- Export active backend ----
export const storage = CONFIG.isProd ? supabaseBackend : localBackend;
```

**Step 2: Commit**

```bash
git add storage.js
git commit -m "feat: add dual storage abstraction layer"
```

---

## Task 3: Auth Module

**Files:**
- Create: `auth.js`

**Step 1: Create auth.js**

```js
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
  // Find referrer by code — in localStorage dev, scan profiles is not practical,
  // so referral tracking is prod-only (Supabase).
  // Stub for dev: just log it.
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
```

**Step 2: Commit**

```bash
git add auth.js
git commit -m "feat: add auth module with magic link login"
```

---

## Task 4: Pity System in gacha.js

**Files:**
- Modify: `gacha.js` — add pity logic to `performDraw()`

**Step 1: Add pity-aware draw function**

Add a new export `performDrawWithPity(pityCounter)` that wraps `performDraw()`:

```js
// Add after existing performDraw() function in gacha.js

export function performDrawWithPity(pityCounter) {
    // Guaranteed 6★ at 90 pity
    if (pityCounter >= 89) {
        return forceRarity(0); // tierIdx 0 = 6-star
    }
    // Guaranteed 5★+ at 50 pity
    if (pityCounter >= 49) {
        const roll = Math.random();
        if (roll < 0.5) return forceRarity(0); // 50% chance 6-star
        return forceRarity(1); // 50% chance 5-star
    }
    return performDraw();
}

export function performMultiDrawWithPity(pityCounter) {
    const draws = [];
    let pity = pityCounter;
    for (let i = 0; i < 10; i++) {
        const draw = performDrawWithPity(pity);
        draws.push(draw);
        if (draw.tierIndex <= 1) {
            pity = 0; // reset pity on 5★+
        } else {
            pity++;
        }
    }
    draws.sort((a, b) => a.tierIndex - b.tierIndex);
    return { draws, newPityCounter: pity };
}

function forceRarity(tierIdx) {
    const tier = RARITY_TIERS[tierIdx];
    const catIndices = TIER_CATEGORIES[tierIdx];
    const catIdx = catIndices[Math.floor(Math.random() * catIndices.length)];
    const category = BLESSING_CATEGORIES[catIdx];
    const chars = [...category.chars];
    const char = chars[Math.floor(Math.random() * chars.length)];
    const blessing = FULL_CHAR_BLESSINGS[char] || { phrase: char + '运亨通', english: 'Fortune and blessings upon you' };
    return { char, rarity: tier, tierIndex: tierIdx, category, blessing };
}
```

Note: `TIER_CATEGORIES` must be exported or `forceRarity` placed inside `gacha.js` where it has access.

**Step 2: Commit**

```bash
git add gacha.js
git commit -m "feat: add pity system to gacha draws"
```

---

## Task 5: Rewards Module

**Files:**
- Create: `rewards.js`

**Step 1: Create rewards.js**

```js
// rewards.js — Daily login, share-to-draw, referral, ad rewards
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { getUser, updateDraws, refreshProfile } from './auth.js';

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
```

**Step 2: Commit**

```bash
git add rewards.js
git commit -m "feat: add rewards module (daily login, share, referral, ads)"
```

---

## Task 6: Gifting Module

**Files:**
- Create: `gifting.js`

**Step 1: Create gifting.js**

```js
// gifting.js — Send duplicate characters to friends via 24h expiry links
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { getUser } from './auth.js';

export async function createGift(character, rarity, categoryName) {
  const user = getUser();
  if (!user) throw new Error('Not logged in');

  // Verify user has a duplicate (count > 1)
  const collection = await storage.getCollection(user.id);
  const item = collection[character];
  if (!item || item.count <= 1) throw new Error('No duplicate to gift');

  // Decrement count
  item.count -= 1;
  await storage.upsertCollectionItem(user.id, character, item);

  // Create gift record
  const token = crypto.randomUUID().slice(0, 12);
  const gift = {
    sender_id: user.id,
    character,
    rarity,
    category_name: categoryName,
    token,
    claimed_by: null,
    claimed_at: null,
    expires_at: new Date(Date.now() + CONFIG.gift.expiryMs).toISOString(),
    created_at: new Date().toISOString(),
  };
  await storage.createGift(gift);

  // Generate share URL
  const baseUrl = window.location.origin + window.location.pathname;
  const giftUrl = `${baseUrl}?gift=${token}`;

  return { gift, url: giftUrl };
}

export async function claimGift(token) {
  const user = getUser();
  if (!user) throw new Error('Not logged in');

  const gift = await storage.getGiftByToken(token);
  if (!gift) throw new Error('Gift not found');
  if (gift.claimed_by) throw new Error('Already claimed');
  if (new Date(gift.expires_at) < new Date()) throw new Error('Gift expired');

  // Claim it
  await storage.claimGift(token, user.id);

  // Add to claimer's collection
  const collection = await storage.getCollection(user.id);
  const existing = collection[gift.character];
  if (existing) {
    existing.count += 1;
    existing.max_stars = Math.max(existing.max_stars, gift.rarity);
    await storage.upsertCollectionItem(user.id, gift.character, existing);
  } else {
    await storage.upsertCollectionItem(user.id, gift.character, {
      character: gift.character,
      rarity: gift.rarity,
      category_name: gift.category_name,
      count: 1,
      max_stars: gift.rarity,
      first_drawn_at: new Date().toISOString(),
    });
  }

  return gift;
}

export async function returnExpiredGifts() {
  // In prod this would be a Supabase cron job / edge function.
  // In dev (localStorage), check on app load.
  if (CONFIG.isProd) return;

  const user = getUser();
  if (!user) return;

  const gifts = JSON.parse(localStorage.getItem('fu_gifts') || '[]');
  const now = new Date();
  for (const gift of gifts) {
    if (gift.sender_id === user.id && !gift.claimed_by && new Date(gift.expires_at) < now) {
      // Return to sender
      const collection = await storage.getCollection(user.id);
      const item = collection[gift.character];
      if (item) {
        item.count += 1;
        await storage.upsertCollectionItem(user.id, gift.character, item);
      }
      gift.claimed_by = '__expired__';
      gift.claimed_at = now.toISOString();
    }
  }
  localStorage.setItem('fu_gifts', JSON.stringify(gifts));
}

export function getGiftTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('gift') || null;
}

export function canGift(collectionItem) {
  return collectionItem && collectionItem.count > 1;
}
```

**Step 2: Commit**

```bash
git add gifting.js
git commit -m "feat: add gifting module for duplicate character sharing"
```

---

## Task 7: Ads Module

**Files:**
- Create: `ads.js`

**Step 1: Create ads.js**

```js
// ads.js — Google AdSense rewarded ad integration
import { CONFIG } from './config.js';
import { canWatchAd, claimAdReward } from './rewards.js';

let adLoaded = false;

export function initAds() {
  if (!CONFIG.ads.adClient) {
    console.log('[ads] No ad client configured, skipping');
    return;
  }
  // Load Google AdSense script
  const script = document.createElement('script');
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.dataset.adClient = CONFIG.ads.adClient;
  document.head.appendChild(script);
  script.onload = () => { adLoaded = true; };
}

export async function showRewardedAd() {
  if (!(await canWatchAd())) {
    return { success: false, reason: 'daily_limit' };
  }

  // In dev mode without real ads, simulate instantly
  if (!adLoaded || !CONFIG.ads.adClient) {
    console.log('[ads] Simulating rewarded ad (dev mode)');
    const result = await claimAdReward();
    return { success: true, ...result };
  }

  // In prod, trigger Google rewarded ad
  // This is a simplified integration — actual implementation depends on
  // Google's rewarded ad API for web which may use AdMob or AdSense experiments
  return new Promise((resolve) => {
    // Placeholder for actual Google rewarded ad API call
    // On ad completion callback:
    claimAdReward().then(result => {
      resolve({ success: true, ...result });
    });
  });
}

export function isAdAvailable() {
  return adLoaded || !CONFIG.ads.adClient; // dev mode always available
}
```

**Step 2: Commit**

```bash
git add ads.js
git commit -m "feat: add rewarded ads module"
```

---

## Task 8: Payments Module (Stripe)

**Files:**
- Create: `payments.js`

**Step 1: Create payments.js**

```js
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

let stripe = null;

async function getStripe() {
  if (stripe) return stripe;
  if (!CONFIG.stripe.publishableKey) {
    console.log('[payments] No Stripe key configured');
    return null;
  }
  // Load Stripe.js
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
  if (!CONFIG.isProd || !CONFIG.stripe.publishableKey) {
    console.log(`[payments] Simulating purchase: ${bundle.label}`);
    await updateDraws(bundle.draws);
    await storage.addTransaction(user.id, {
      type: 'stripe',
      draws_granted: bundle.draws,
      stripe_session_id: 'dev-' + crypto.randomUUID().slice(0, 8),
    });
    return { success: true, draws: bundle.draws };
  }

  // Prod: redirect to Stripe Checkout
  const stripeInstance = await getStripe();
  if (!stripeInstance) throw new Error('Stripe not available');

  const priceId = CONFIG.stripe.prices[bundle.priceKey];
  if (!priceId) throw new Error('Price not configured');

  const { error } = await stripeInstance.redirectToCheckout({
    lineItems: [{ price: priceId, quantity: 1 }],
    mode: 'payment',
    successUrl: `${window.location.origin}${window.location.pathname}?payment=success&bundle=${bundleId}`,
    cancelUrl: `${window.location.origin}${window.location.pathname}?payment=cancel`,
    clientReferenceId: user.id,
  });
  if (error) throw error;
}

// Handle return from Stripe Checkout
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
```

Note: In production, draw crediting should happen server-side via Stripe webhook → Supabase Edge Function, not via the client-side redirect. The client redirect is only for showing a success message. The webhook ensures payment verification.

**Step 2: Commit**

```bash
git add payments.js
git commit -m "feat: add Stripe payments module"
```

---

## Task 9: Integrate Draw Gating into main.js

**Files:**
- Modify: `main.js`

This is the critical integration point. The existing code calls `performDraw()` and `performMultiDraw()` freely. We need to:

1. Import the new modules
2. Gate draws behind `draws_remaining` check
3. Use pity-aware draw functions
4. Update pity counter after each draw
5. Show "Get More Draws" when empty

**Step 1: Add imports at top of main.js (after existing imports, line 14)**

```js
import { CONFIG as APP_CONFIG } from './config.js';
import { getUser, onAuthChange, restoreSession, sendMagicLink, logout, updateDraws, getReferralFromUrl } from './auth.js';
import { performDrawWithPity, performMultiDrawWithPity } from './gacha.js';
import { claimDailyLogin, claimShareReward, canShare, getShareCooldownRemaining, getPityCounter, incrementPity, resetPity } from './rewards.js';
import { showRewardedAd, initAds } from './ads.js';
import { purchaseDraws, DRAW_BUNDLES, getPaymentResult } from './payments.js';
import { createGift, claimGift, getGiftTokenFromUrl, returnExpiredGifts, canGift } from './gifting.js';
```

**Step 2: Modify handleSwipeUp() (line 3572) to check draws_remaining**

Replace the draw triggers in `handleSwipeUp()` to check balance:

```js
function handleSwipeUp() {
    if (state === 'arrival' && fontsReady) {
        const user = getUser();
        const drawsNeeded = selectedMode === 'multi' ? 10 : 1;

        if (user && user.draws_remaining < drawsNeeded) {
            showRewardsPanel(); // new function — opens the rewards/purchase drawer
            return;
        }

        if (user) {
            updateDraws(-drawsNeeded); // deduct draws
        }

        if (selectedMode === 'multi') {
            startMultiPull();
        } else {
            isMultiMode = false;
            changeState('draw');
        }
    } else if (state === 'fortune') {
        // ... (existing fortune → draw-again logic, same gating)
    }
}
```

**Step 3: Modify performDraw calls to use pity-aware versions**

In `initDrawAnimation()` (around line 1127), replace:
```js
// OLD:
currentDrawResult = performDraw();
// NEW:
const pity = getPityCounter();
currentDrawResult = performDrawWithPity(pity);
if (currentDrawResult.tierIndex <= 1) {
    resetPity();
} else {
    incrementPity();
}
```

In `startMultiPull()` (around line 2922), replace:
```js
// OLD:
multiDrawResults = performMultiDraw();
// NEW:
const pity = getPityCounter();
const { draws, newPityCounter } = performMultiDrawWithPity(pity);
multiDrawResults = draws;
// Update pity counter to new value
const user = getUser();
if (user) {
    user.pity_counter = newPityCounter;
    // storage.upsertProfile(user) happens via incrementPity/resetPity
}
```

**Step 4: Add init code at bottom of main.js (before requestAnimationFrame)**

```js
// --- Monetization init ---
(async () => {
  initAds();
  await restoreSession();

  // Handle gift claim from URL
  const giftToken = getGiftTokenFromUrl();
  if (giftToken) {
    try {
      const gift = await claimGift(giftToken);
      // Show gift claim notification (TODO: add UI)
      console.log('Gift claimed:', gift.character);
    } catch (e) {
      console.warn('Gift claim failed:', e.message);
    }
  }

  // Handle payment return
  const paymentResult = getPaymentResult();
  if (paymentResult?.status === 'success') {
    // Show success notification (TODO: add UI)
    console.log('Payment successful');
  }

  // Return expired gifts (dev mode)
  await returnExpiredGifts();

  // Daily login check
  const loginReward = await claimDailyLogin();
  if (loginReward) {
    // Show daily login notification (TODO: add UI)
    console.log('Daily login reward:', loginReward);
  }

  // Listen for auth changes to update UI
  onAuthChange((user) => {
    updateAuthUI(user);
  });
})();
```

**Step 5: Commit**

```bash
git add main.js
git commit -m "feat: integrate draw gating, pity, and monetization into main loop"
```

---

## Task 10: UI — Auth Bar & Draw Counter

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `main.js` (add UI render functions)

**Step 1: Add auth bar and rewards panel HTML to index.html (after `<canvas>`, before bottom-controls)**

```html
<!-- Auth bar -->
<div id="auth-bar" class="auth-bar">
    <div id="auth-logged-out" class="auth-section">
        <button id="btn-login" class="btn-auth">Sign In</button>
    </div>
    <div id="auth-logged-in" class="auth-section" style="display:none">
        <span id="auth-email" class="auth-email"></span>
        <span id="draw-counter" class="draw-counter">🎫 ×10</span>
        <button id="btn-logout" class="btn-auth btn-small">Logout</button>
    </div>
</div>

<!-- Login modal -->
<div id="login-modal" class="modal-overlay" style="display:none">
    <div class="modal-card">
        <h2>Sign In</h2>
        <p>Enter your email to receive a magic link</p>
        <input type="email" id="login-email" placeholder="your@email.com" class="input-email" />
        <button id="btn-send-link" class="btn-action btn-primary">Send Magic Link</button>
        <button id="btn-close-login" class="btn-action btn-secondary">Cancel</button>
        <p id="login-status" class="login-status"></p>
    </div>
</div>

<!-- Rewards panel (slide-up drawer) -->
<div id="rewards-panel" class="rewards-panel" style="display:none">
    <div class="rewards-header">
        <h2>Get More Draws</h2>
        <button id="btn-close-rewards" class="btn-close">✕</button>
    </div>
    <div class="rewards-content">
        <!-- Daily login -->
        <div class="reward-section">
            <h3>Daily Login</h3>
            <div id="login-streak" class="streak-dots"></div>
        </div>
        <!-- Share -->
        <div class="reward-section">
            <button id="btn-share-draw" class="btn-reward">Share → 10 Draws</button>
            <span id="share-cooldown" class="cooldown-text"></span>
        </div>
        <!-- Watch ad -->
        <div class="reward-section">
            <button id="btn-watch-ad" class="btn-reward">Watch Ad → 1 Draw</button>
            <span id="ad-count" class="cooldown-text"></span>
        </div>
        <!-- Referral -->
        <div class="reward-section">
            <h3>Invite Friends</h3>
            <p class="reward-desc">1st friend: 30 draws | Each after: 10 draws</p>
            <button id="btn-copy-referral" class="btn-reward">Copy Invite Link</button>
            <span id="referral-stats" class="cooldown-text"></span>
        </div>
        <!-- Buy draws -->
        <div class="reward-section">
            <h3>Buy Draws</h3>
            <div id="purchase-bundles" class="purchase-grid"></div>
        </div>
    </div>
</div>
```

**Step 2: Add styles to style.css**

Add auth-bar, modal, rewards panel, and draw counter styles. Key design notes:
- Auth bar: fixed top-right, glassmorphism, non-intrusive
- Draw counter: gold badge, pulses on change
- Rewards panel: slide-up from bottom, dark glass background
- Purchase buttons: gold border, price + savings label
- All responsive, mobile-first

**Step 3: Add UI logic functions to main.js**

```js
function updateAuthUI(user) {
  const loggedOut = document.getElementById('auth-logged-out');
  const loggedIn = document.getElementById('auth-logged-in');
  const drawCounter = document.getElementById('draw-counter');

  if (user) {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'flex';
    document.getElementById('auth-email').textContent = user.email;
    drawCounter.textContent = `🎫 ×${user.draws_remaining || 0}`;
  } else {
    loggedOut.style.display = 'flex';
    loggedIn.style.display = 'none';
  }
}

function showRewardsPanel() {
  document.getElementById('rewards-panel').style.display = 'flex';
  updateRewardsPanel();
}

function updateRewardsPanel() {
  const user = getUser();
  if (!user) return;
  // Update streak dots, share cooldown, ad count, referral stats, purchase buttons
  // ... (implementation per UI element)
}
```

**Step 4: Wire up event listeners for all buttons**

- `btn-login` → show login modal
- `btn-send-link` → call `sendMagicLink(email)`
- `btn-logout` → call `logout()`
- `btn-share-draw` → call Web Share API, then `claimShareReward()`
- `btn-watch-ad` → call `showRewardedAd()`
- `btn-copy-referral` → copy referral link to clipboard
- Purchase buttons → call `purchaseDraws(bundleId)`
- `btn-close-rewards` → hide rewards panel

**Step 5: Commit**

```bash
git add index.html style.css main.js
git commit -m "feat: add auth bar, draw counter, rewards panel, and purchase UI"
```

---

## Task 11: Gift UI in Collection Panel

**Files:**
- Modify: `main.js` (collection rendering)
- Modify: `style.css`

**Step 1: Add "Gift" button to collection items**

In the existing collection rendering code, for each collected character where `count > 1`, add a "Gift" button. On tap:

1. Call `createGift(character, rarity, categoryName)`
2. Get back the gift URL
3. Open Web Share API with the gift URL
4. Show confirmation toast

**Step 2: Add gift claim notification**

When the app loads with `?gift=TOKEN` in the URL:
1. Show a modal: "You received 福 (Fortune) ★★★★★★ from a friend!"
2. Character appears with its rarity glow animation
3. "Add to Collection" button → claims and closes

**Step 3: Commit**

```bash
git add main.js style.css
git commit -m "feat: add gifting UI to collection panel"
```

---

## Task 12: Share Card Image Generation

**Files:**
- Modify: `main.js`

**Step 1: Create share card renderer**

After a pull, generate a shareable image using the existing canvas:

```js
function generateShareCard(drawResult) {
  const shareCanvas = document.createElement('canvas');
  shareCanvas.width = 600;
  shareCanvas.height = 800;
  const sctx = shareCanvas.getContext('2d');

  // Red background with gradient
  // Character in calligraphy font (centered, large)
  // Stars row
  // Blessing phrase + English translation
  // Rarity glow border
  // "福 Fortune Gacha" branding + link at bottom

  return shareCanvas.toDataURL('image/png');
}
```

**Step 2: Wire share button to Web Share API**

```js
async function shareResult(drawResult) {
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
```

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add share card image generation"
```

---

## Task 13: Supabase Schema Migration (Prod Setup)

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Write the migration SQL**

Full SQL with all 4 tables (profiles, collections, transactions, gifts), RLS policies, indexes, and the trigger to create a profile on auth signup.

**Step 2: Document Supabase setup steps**

```
1. Create Supabase project
2. Run migration
3. Enable email auth with magic link
4. Set env vars in .env
5. Deploy edge function for Stripe webhook (optional, for prod payment verification)
```

**Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema migration"
```

---

## Execution Order

Tasks 1-8 are independent modules (can be parallelized).
Task 9 depends on Tasks 1-8 (integration).
Tasks 10-12 depend on Task 9 (UI).
Task 13 is independent (infra).

```
[1: Config] ──┐
[2: Storage] ─┤
[3: Auth] ────┤
[4: Pity] ────┼──▶ [9: Integration] ──▶ [10: Auth UI]
[5: Rewards] ─┤                        [11: Gift UI]
[6: Gifting] ─┤                        [12: Share Card]
[7: Ads] ─────┤
[8: Payments] ┘

[13: Supabase Schema] (independent)
```
