// storage.js — Dual storage abstraction (localStorage dev / Supabase prod)
import { CONFIG } from './config.js';
import { getSupabaseClient } from './supabase-client.js';

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
const supabaseBackend = {
  async getProfile(userId) {
    const sb = await getSupabaseClient();
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data;
  },
  async upsertProfile(profile) {
    const sb = await getSupabaseClient();
    const { data } = await sb.from('profiles').upsert(profile).select().single();
    return data;
  },
  async getCollection(userId) {
    const sb = await getSupabaseClient();
    const { data } = await sb.from('collections').select('*').eq('user_id', userId);
    const coll = {};
    for (const row of (data || [])) {
      coll[row.character] = row;
    }
    return coll;
  },
  async upsertCollectionItem(userId, char, itemData) {
    const sb = await getSupabaseClient();
    const { data } = await sb.from('collections')
      .upsert({ user_id: userId, character: char, ...itemData }, { onConflict: 'user_id,character' })
      .select().single();
    return data;
  },
  async addTransaction(userId, tx) {
    const sb = await getSupabaseClient();
    await sb.from('transactions').insert({ user_id: userId, ...tx });
  },
  async createGift(gift) {
    const sb = await getSupabaseClient();
    const { data } = await sb.from('gifts').insert(gift).select().single();
    return data;
  },
  async getGiftByToken(token) {
    const sb = await getSupabaseClient();
    // Uses SECURITY DEFINER function to bypass restricted SELECT RLS
    const { data } = await sb.rpc('get_gift_by_token', { p_token: token });
    return data;
  },
  async claimGift(token, claimerId) {
    const sb = await getSupabaseClient();
    const { data } = await sb.from('gifts')
      .update({ claimed_by: claimerId, claimed_at: new Date().toISOString() })
      .eq('token', token).is('claimed_by', null)
      .select().single();
    return data;
  },
};

// ---- Export active backend ----
export const storage = CONFIG.isProd ? supabaseBackend : localBackend;
