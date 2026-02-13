// ============================================================
// audio.js — Dual Local Audio Players (Instrumental + Vocal)
// ============================================================

let audioCtx = null;
let instBuffer = null;
let vocalBuffer = null;

let instSource = null;
let vocalSource = null;

let bgmGain = null;
let instGain = null;
let vocalGain = null;
let sfxGain = null;

let isMuted = false;
let bgmStarted = false;

// Audio Files
const FILE_INST = 'audio/inst.mp3';
const FILE_VOCAL = 'audio/vocal.mp3';
const BGM_VOLUME = 0.2;

// Settings
let activeTrack = 'inst'; // 'inst' or 'vocal'
let fadeInterval = null;

// --- Initialization ---

export function initMusicSystem() {
    // Music system initializes with audio context
    if (!audioCtx) {
        initAudio();
    }
}

export function initAudio() {
    if (audioCtx) return;
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        
        // --- Gain Node Graph ---
        // instSource -> instGain -> bgmGain -> destination
        // vocalSource -> vocalGain -> bgmGain -> destination
        // sfxSource -> sfxGain -> destination

        bgmGain = audioCtx.createGain();
        bgmGain.gain.value = BGM_VOLUME;
        bgmGain.connect(audioCtx.destination);
        
        instGain = audioCtx.createGain();
        instGain.gain.value = 1.0;
        instGain.connect(bgmGain);
        
        vocalGain = audioCtx.createGain();
        vocalGain.gain.value = 0.0; // Start with vocal muted
        vocalGain.connect(bgmGain);
        
        sfxGain = audioCtx.createGain();
        sfxGain.gain.value = 0.3;
        sfxGain.connect(audioCtx.destination);
        
        loadBuffers();
        initDebugPanel();
        
    } catch (e) {
        console.warn('Web Audio API error', e);
    }
}

async function loadBuffers() {
    try {
        const [instRes, vocalRes] = await Promise.all([
            fetch(FILE_INST),
            fetch(FILE_VOCAL)
        ]);
        
        const [instData, vocalData] = await Promise.all([
            instRes.arrayBuffer(),
            vocalRes.arrayBuffer()
        ]);
        
        instBuffer = await audioCtx.decodeAudioData(instData);
        vocalBuffer = await audioCtx.decodeAudioData(vocalData);
        
        console.log('Audio buffers loaded');
        
        if (bgmStarted) {
            playBoth();
        }
    } catch (e) {
        console.error('Failed to load audio buffers:', e);
    }
}

export function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(()=>{});
    }
}

// --- Playback Control ---

export function startBGM() {
    if (bgmStarted) return;
    bgmStarted = true;
    resumeAudio();
    playBoth();
}

export function stopBGM() {
    bgmStarted = false;
    stopSources();
}

function stopSources() {
    if (instSource) {
        try { instSource.stop(); } catch(e){}
        instSource.disconnect();
        instSource = null;
    }
    if (vocalSource) {
        try { vocalSource.stop(); } catch(e){}
        vocalSource.disconnect();
        vocalSource = null;
    }
}

function playBoth() {
    if (!instBuffer || !vocalBuffer || !audioCtx) return;
    
    // Stop any existing sources first to avoid overlap
    stopSources();
    
    // Create new sources
    instSource = audioCtx.createBufferSource();
    instSource.buffer = instBuffer;
    instSource.loop = true;
    instSource.connect(instGain);
    
    vocalSource = audioCtx.createBufferSource();
    vocalSource.buffer = vocalBuffer;
    vocalSource.loop = true;
    vocalSource.connect(vocalGain);
    
    // Start perfectly synced
    const startTime = audioCtx.currentTime + 0.05; // Schedule slightly in future
    instSource.start(startTime);
    vocalSource.start(startTime);
    
    // Apply current active track state immediately
    updateGains(0); // instant update
}


// --- Switching Logic ---

export function switchToVocal() {
    setTrack('vocal');
}

export function switchToInst() {
    setTrack('inst');
}

function setTrack(trackName) {
    if (activeTrack === trackName) return;
    activeTrack = trackName;
    
    // UI Update
    const btnInst = document.getElementById('btn-inst');
    const btnVocal = document.getElementById('btn-vocal');
    if (btnInst && btnVocal) {
        btnInst.style.background = trackName === 'inst' ? '#444' : '';
        btnVocal.style.background = trackName === 'vocal' ? '#800' : '';
    }

    updateGains(0.3); // 300ms crossfade
    updateDebugStatus(`Switched to ${trackName}`);
}

function updateGains(duration = 0.3) {
    if (!audioCtx || !instGain || !vocalGain) return;
    
    const now = audioCtx.currentTime;
    // Cancel scheduled values to allow rapid switching
    instGain.gain.cancelScheduledValues(now);
    vocalGain.gain.cancelScheduledValues(now);
    
    // Determine target gains
    const targetInst = activeTrack === 'inst' ? 1.0 : 0.0;
    const targetVocal = activeTrack === 'vocal' ? 1.0 : 0.0;
    
    if (duration <= 0) {
        instGain.gain.setValueAtTime(targetInst, now);
        vocalGain.gain.setValueAtTime(targetVocal, now);
    } else {
        instGain.gain.setTargetAtTime(targetInst, now, duration / 3); // timeConstant approx duration/3
        vocalGain.gain.setTargetAtTime(targetVocal, now, duration / 3);
    }
}


export function toggleMute() {
    isMuted = !isMuted;
    
    if (audioCtx) {
        const now = audioCtx.currentTime;
        // Mute Master BGM Gain
        if (bgmGain) {
            bgmGain.gain.cancelScheduledValues(now);
            bgmGain.gain.setTargetAtTime(isMuted ? 0 : BGM_VOLUME, now, 0.1);
        }
        // Mute SFX Gain
        if (sfxGain) {
            sfxGain.gain.cancelScheduledValues(now);
            sfxGain.gain.setTargetAtTime(isMuted ? 0 : 0.3, now, 0.1);
        }
    }
    
    return isMuted;
}

export function isBGMMuted() {
    return isMuted;
}

export function isAudioPlaying() {
    if (isMuted) return false;
    return bgmStarted && audioCtx && audioCtx.state === 'running';
}


// --- Debug Panel Logic ---
function initDebugPanel() {
    const btnPlay = document.getElementById('btn-play-both');
    const btnPause = document.getElementById('btn-pause-both');
    const btnSync = document.getElementById('btn-sync'); // Unused in local mode (perfect sync)
    const btnInst = document.getElementById('btn-inst');
    const btnVocal = document.getElementById('btn-vocal');
    const rangeVol = document.getElementById('debug-vol'); // Not used, master is fixed 1.0
    const inputOffset = document.getElementById('debug-offset'); // Not used
    const btnHide = document.getElementById('btn-hide-debug');
    const panel = document.getElementById('audio-debug-panel');

    if (!btnPlay) return;

    btnPlay.onclick = () => { startBGM(); };
    btnPause.onclick = () => { stopBGM(); };
    
    btnInst.onclick = () => setTrack('inst');
    btnVocal.onclick = () => setTrack('vocal');
    
    btnHide.onclick = () => {
        panel.style.display = 'none';
    };
}

function updateDebugStatus(msg) {
    const el = document.getElementById('debug-status');
    if (el) el.textContent = msg;
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
