// ads.js — Google Ad Placement API (H5 Games Ads) rewarded ad integration
import { CONFIG } from './config.js';
import { canWatchAd, claimAdReward } from './rewards.js';

let adReady = false;

export function initAds() {
  if (!CONFIG.ads.adClient) {
    console.log('[ads] No ad client configured, skipping');
    return;
  }
  // Configure the Ad Placement API
  window.adConfig({
    preloadAdBreaks: 'on',
    sound: 'on',
    onReady: () => { adReady = true; },
  });
}

export async function showRewardedAd() {
  if (!(await canWatchAd())) {
    return { success: false, reason: 'daily_limit' };
  }

  // Dev mode: simulate instantly when no ad client configured
  if (!CONFIG.ads.adClient) {
    console.log('[ads] Simulating rewarded ad (dev mode)');
    const result = await claimAdReward();
    return { success: true, ...result };
  }

  return new Promise((resolve) => {
    window.adBreak({
      type: 'reward',
      name: 'reward-draws',
      beforeReward: (showAdFn) => {
        // Called when an ad is available; showAdFn triggers the ad.
        // Since this is called within the user's click handler, invoke immediately.
        showAdFn();
      },
      beforeAd: () => {
        // Pause game audio while ad plays
        document.dispatchEvent(new CustomEvent('ad-playing', { detail: { playing: true } }));
      },
      adViewed: async () => {
        // Player watched the full ad — grant reward
        const result = await claimAdReward();
        resolve({ success: true, ...result });
      },
      adDismissed: () => {
        // Player dismissed the ad early — no reward
        resolve({ success: false, reason: 'dismissed' });
      },
      afterAd: () => {
        // Resume game audio
        document.dispatchEvent(new CustomEvent('ad-playing', { detail: { playing: false } }));
      },
      adBreakDone: (placementInfo) => {
        // Called if no ad was available at all
        if (placementInfo.breakStatus === 'notReady' || placementInfo.breakStatus === 'frequencyCapped') {
          resolve({ success: false, reason: 'no_ad_available' });
        }
      },
    });
  });
}

export function isAdAvailable() {
  return adReady || !CONFIG.ads.adClient; // dev mode always available
}
