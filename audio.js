// ============================================================
// audio.js — Festive BGM (YouTube) & SFX (Web Audio API)
// ============================================================

let audioCtx = null;
let sfxGain = null;
let isMuted = false;
let bgmStarted = false;

// --- YouTube Player State ---
let ytPlayer = null;
let ytReady = false;
const VIDEO_ID = '-NA4IJbjhB8'; 

// Load YouTube IFrame API
function loadYouTubeAPI() {
    if (window.YT) return; // Already loaded
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
        ytPlayer = new YT.Player('youtube-bgm', {
            height: '1',
            width: '1',
            videoId: VIDEO_ID,
            playerVars: {
                'playsinline': 1,
                'controls': 0,
                'disablekb': 1,
                'fs': 0,
                'loop': 1,
                'playlist': VIDEO_ID, // Required for loop to work
                'origin': window.location.origin // Fixes the "postMessage" origin mismatch error
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    };
}

function onPlayerReady(event) {
    ytReady = true;
    event.target.setVolume(25); // Set BGM volume (0-100)
    if (isMuted) {
        event.target.mute();
    }
    if (bgmStarted) {
        event.target.playVideo();
    }
}

function onPlayerError(event) {
    console.error('YouTube Player Error:', event.data);
}

function onPlayerStateChange(event) {
    // 0 = Ended, 1 = Playing, 2 = Paused, 3 = Buffering, 5 = Cued
    if (event.data === 0) { // Ended
        event.target.playVideo();
    } else if (event.data === 2) { // Paused
        // If it paused but we expect it to be playing, force resume
        if (bgmStarted && !isMuted) {
            event.target.playVideo();
        }
    }
}

// Initialize Audio Context for SFX and Load YouTube API
export function initAudio() {
    // SFX Setup
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sfxGain = audioCtx.createGain();
            sfxGain.gain.value = 0.3;
            sfxGain.connect(audioCtx.destination);
        } catch (e) {
            console.warn('Web Audio API not supported or blocked', e);
        }
    }
    
    // BGM Setup
    loadYouTubeAPI();
}

export function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {
            // Ignore auto-play errors; we will try again on next interaction
        });
    }
    // Also try to play video if it was supposed to be playing
    if (bgmStarted && ytReady && ytPlayer && ytPlayer.playVideo) {
         ytPlayer.playVideo();
    }
}

export function startBGM() {
    bgmStarted = true;
    if (ytReady && ytPlayer && ytPlayer.playVideo) {
        ytPlayer.playVideo();
    }
    resumeAudio();
}

export function stopBGM() {
    bgmStarted = false;
    if (ytReady && ytPlayer && ytPlayer.pauseVideo) {
        ytPlayer.pauseVideo();
    }
}

export function toggleMute() {
    isMuted = !isMuted;
    
    // Mute SFX
    if (audioCtx) {
        // We can't mute the context easily without affecting everything, 
        // so we just mute the sfxGain or use a master gain if we had one.
        // Re-implementing master gain logic briefly for SFX:
        if (sfxGain) {
             sfxGain.gain.setTargetAtTime(isMuted ? 0 : 0.3, audioCtx.currentTime, 0.1);
        }
    }

    // Mute BGM
    if (ytReady && ytPlayer) {
        if (isMuted) {
            ytPlayer.mute();
        } else {
            ytPlayer.unMute();
            // Ensure volume is reset (sometimes unMute sets it to default)
            ytPlayer.setVolume(25);
            if (bgmStarted) ytPlayer.playVideo();
        }
    }
    
    return isMuted;
}

export function isBGMMuted() {
    return isMuted;
}

// --- SFX: Draw whoosh ---
export function playSfxDraw() {
    if (!audioCtx || !sfxGain || isMuted) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.15, now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(env);
    env.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.6);
}

// --- SFX: Card reveal chime ---
export function playSfxReveal(stars) {
    if (!audioCtx || !sfxGain || isMuted) return;
    const now = audioCtx.currentTime;
    const baseFreq = stars >= 6 ? 880 : stars >= 5 ? 659 : stars >= 4 ? 523 : 440;

    for (let i = 0; i < 3; i++) {
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = baseFreq * (1 + i * 0.5);
        const vol = (0.12 - i * 0.03);
        env.gain.setValueAtTime(0, now + i * 0.08);
        env.gain.linearRampToValueAtTime(vol, now + i * 0.08 + 0.02);
        env.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6);
        osc.connect(env);
        env.connect(sfxGain);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.7);
    }
}
