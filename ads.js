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
