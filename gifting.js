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
