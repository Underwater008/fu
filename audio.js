// ============================================================
// audio.js — Dual YouTube Players (Instrumental + Vocal)
// ============================================================

let audioCtx = null;
let sfxGain = null;
let isMuted = false;
let bgmStarted = false;

// --- YouTube Player State ---
let playerInst = null;
let playerVocal = null;
let readyInst = false;
let readyVocal = false;

// ID -NA4IJbjhB8 = Instrumental
// ID eIQqtWOA12c = Vocal (Lyrics)
const ID_INST = '-NA4IJbjhB8';
const ID_VOCAL = 'eIQqtWOA12c';

// Settings
let masterVolume = 25;
let vocalOffset = 0; // ms to shift vocal track relative to instrumental
let activeTrack = 'inst'; // 'inst' or 'vocal'
let fadeInterval = null;

// Load YouTube IFrame API
function loadYouTubeAPI() {
    if (window.YT) {
        initPlayers();
        return;
    }
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
        initPlayers();
    };
}

function initPlayers() {
    // 1. Instrumental Player
    playerInst = new YT.Player('youtube-bgm', {
        height: '1', width: '1',
        videoId: ID_INST,
        playerVars: {
            'playsinline': 1, 'controls': 0, 'disablekb': 1,
            'fs': 0, 'loop': 1, 'playlist': ID_INST,
            'origin': window.location.origin
        },
        events: {
            'onReady': (e) => onPlayerReady(e, 'inst'),
            'onStateChange': (e) => onPlayerStateChange(e, 'inst'),
            'onError': (e) => console.error('Inst Error:', e.data)
        }
    });

    // 2. Vocal Player
    playerVocal = new YT.Player('youtube-vocal', {
        height: '1', width: '1',
        videoId: ID_VOCAL,
        playerVars: {
            'playsinline': 1, 'controls': 0, 'disablekb': 1,
            'fs': 0, 'loop': 1, 'playlist': ID_VOCAL,
            'origin': window.location.origin
        },
        events: {
            'onReady': (e) => onPlayerReady(e, 'vocal'),
            'onStateChange': (e) => onPlayerStateChange(e, 'vocal'),
            'onError': (e) => console.error('Vocal Error:', e.data)
        }
    });
}

function onPlayerReady(event, type) {
    if (type === 'inst') readyInst = true;
    if (type === 'vocal') readyVocal = true;

    // Initial state: Inst = Volume, Vocal = 0
    if (type === 'inst') event.target.setVolume(isMuted ? 0 : masterVolume);
    if (type === 'vocal') event.target.setVolume(0);

    // Mute if global mute is on
    if (isMuted) event.target.mute();

    // If both ready and we started, play
    if (readyInst && readyVocal && bgmStarted) {
        playBoth();
    }
}

function onPlayerStateChange(event, type) {
    // 0 = Ended, 1 = Playing, 2 = Paused
    if (event.data === 0) { // Loop manually
        event.target.playVideo();
    } 
    // If one pauses unexpectedly, try to resume
    if (event.data === 2 && bgmStarted && !isMuted) {
        event.target.playVideo();
    }
}

function playBoth() {
    if (!playerInst || !playerVocal) return;
    playerInst.playVideo();
    playerVocal.playVideo();
    // Sync vocal to inst
    syncPlayers();
}

function pauseBoth() {
    if (!playerInst || !playerVocal) return;
    playerInst.pauseVideo();
    playerVocal.pauseVideo();
}

function syncPlayers() {
    if (!playerInst || !playerVocal) return;
    const t = playerInst.getCurrentTime();
    // Apply offset if needed
    const vocalT = Math.max(0, t + (vocalOffset / 1000));
    
    // Only seek if diff is significant (> 0.2s) to avoid stutter
    const currentVocalT = playerVocal.getCurrentTime();
    if (Math.abs(currentVocalT - vocalT) > 0.2) {
        playerVocal.seekTo(vocalT, true);
        console.log(`Synced Vocal to ${vocalT.toFixed(2)} (Inst: ${t.toFixed(2)})`);
    }
}

// --- Switching Logic ---

export function switchToVocal() {
    setTrack('vocal');
}

export function switchToInst() {
    setTrack('inst');
}

function setTrack(trackName) { // 'inst' or 'vocal'
    if (activeTrack === trackName) return;
    activeTrack = trackName;
    
    // UI Update
    const btnInst = document.getElementById('btn-inst');
    const btnVocal = document.getElementById('btn-vocal');
    if (btnInst && btnVocal) {
        btnInst.style.background = trackName === 'inst' ? '#444' : '';
        btnVocal.style.background = trackName === 'vocal' ? '#800' : '';
    }

    // Crossfade
    if (isMuted) return; // Don't fade if muted, just stay muted
    
    // Simple instant switch for responsiveness, or fast fade
    // Let's do a fast 300ms crossfade
    const steps = 10;
    const duration = 300;
    const stepTime = duration / steps;
    let step = 0;
    
    if (fadeInterval) clearInterval(fadeInterval);
    
    fadeInterval = setInterval(() => {
        step++;
        const ratio = step / steps; // 0 to 1
        
        let volInst, volVocal;
        if (trackName === 'vocal') {
            // Inst: master -> 0
            // Vocal: 0 -> master
            volInst = masterVolume * (1 - ratio);
            volVocal = masterVolume * ratio;
        } else {
            // Inst: 0 -> master
            // Vocal: master -> 0
            volInst = masterVolume * ratio;
            volVocal = masterVolume * (1 - ratio);
        }
        
        if (playerInst) playerInst.setVolume(volInst);
        if (playerVocal) playerVocal.setVolume(volVocal);
        
        if (step >= steps) {
            clearInterval(fadeInterval);
            // Ensure final values
            if (playerInst) playerInst.setVolume(trackName === 'inst' ? masterVolume : 0);
            if (playerVocal) playerVocal.setVolume(trackName === 'vocal' ? masterVolume : 0);
        }
    }, stepTime);
    
    updateDebugStatus(`Switched to ${trackName}`);
}


// --- Main Audio Exports ---

export function initAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sfxGain = audioCtx.createGain();
            sfxGain.gain.value = 0.3;
            sfxGain.connect(audioCtx.destination);
        } catch (e) {
            console.warn('Web Audio API error', e);
        }
    }
    loadYouTubeAPI();
    initDebugPanel();
}

export function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(()=>{});
    }
    if (bgmStarted) {
        // If we think we're playing but players are paused/unstarted, kick them
        if (readyInst && playerInst && playerInst.getPlayerState() !== 1) playerInst.playVideo();
        if (readyVocal && playerVocal && playerVocal.getPlayerState() !== 1) playerVocal.playVideo();
    }
}

export function startBGM() {
    bgmStarted = true;
    resumeAudio();
    playBoth();
}

export function stopBGM() {
    bgmStarted = false;
    pauseBoth();
}

export function toggleMute() {
    isMuted = !isMuted;
    
    // Toggle YouTube Mute & Restore Volume
    if (playerInst) {
        if (isMuted) {
            playerInst.mute();
        } else {
            playerInst.unMute();
            playerInst.setVolume(activeTrack === 'inst' ? masterVolume : 0);
        }
    }
    if (playerVocal) {
        if (isMuted) {
            playerVocal.mute();
        } else {
            playerVocal.unMute();
            playerVocal.setVolume(activeTrack === 'vocal' ? masterVolume : 0);
        }
    }
    
    // Toggle SFX Gain
    if (sfxGain && audioCtx) {
        sfxGain.gain.setTargetAtTime(isMuted ? 0 : 0.3, audioCtx.currentTime, 0.1);
    }
    
    return isMuted;
}

export function isBGMMuted() {
    return isMuted;
}

export function isAudioPlaying() {
    if (isMuted) return false;
    const s1 = playerInst && typeof playerInst.getPlayerState === 'function' ? playerInst.getPlayerState() : -1;
    const s2 = playerVocal && typeof playerVocal.getPlayerState === 'function' ? playerVocal.getPlayerState() : -1;
    return s1 === 1 || s2 === 1;
}


// --- Debug Panel Logic ---
function initDebugPanel() {
    const btnPlay = document.getElementById('btn-play-both');
    const btnPause = document.getElementById('btn-pause-both');
    const btnSync = document.getElementById('btn-sync');
    const btnInst = document.getElementById('btn-inst');
    const btnVocal = document.getElementById('btn-vocal');
    const rangeVol = document.getElementById('debug-vol');
    const inputOffset = document.getElementById('debug-offset');
    const btnHide = document.getElementById('btn-hide-debug');
    const panel = document.getElementById('audio-debug-panel');

    if (!btnPlay) return;

    btnPlay.onclick = () => { bgmStarted = true; playBoth(); };
    btnPause.onclick = () => { bgmStarted = false; pauseBoth(); };
    btnSync.onclick = () => syncPlayers();
    
    btnInst.onclick = () => setTrack('inst');
    btnVocal.onclick = () => setTrack('vocal');
    
    rangeVol.oninput = (e) => {
        masterVolume = parseInt(e.target.value);
        if (activeTrack === 'inst' && playerInst) playerInst.setVolume(masterVolume);
        if (activeTrack === 'vocal' && playerVocal) playerVocal.setVolume(masterVolume);
    };
    
    inputOffset.onchange = (e) => {
        vocalOffset = parseInt(e.target.value);
        syncPlayers();
    };
    
    btnHide.onclick = () => {
        panel.style.display = 'none';
    };
}


// --- SFX (Unchanged) ---
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
