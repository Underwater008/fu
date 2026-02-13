// ============================================================
// audio.js — Festive BGM Generator (Web Audio API, no copyright)
// Generates a Chinese pentatonic-style ambient loop
// ============================================================

let audioCtx = null;
let masterGain = null;
let bgmGain = null;
let sfxGain = null;
let isMuted = false;
let bgmStarted = false;
let bgmTimers = [];

// Chinese pentatonic scale frequencies (C4-based: gong, shang, jue, zhi, yu)
const PENTATONIC = [
    261.63, 293.66, 329.63, 392.00, 440.00, // C4 D4 E4 G4 A4
    523.25, 587.33, 659.25, 783.99, 880.00, // C5 D5 E5 G5 A5
];

// Melody patterns (indices into PENTATONIC) — festive, bright phrases
const MELODY_PHRASES = [
    [4, 3, 2, 0, 2, 3, 4, 4],
    [5, 4, 3, 2, 3, 4, 5, 7],
    [7, 6, 5, 4, 5, 4, 3, 2],
    [0, 2, 4, 5, 4, 3, 2, 0],
    [3, 4, 5, 7, 5, 4, 3, 2],
    [5, 5, 4, 3, 4, 5, 7, 5],
    [2, 3, 4, 5, 7, 5, 4, 3],
    [9, 7, 5, 4, 5, 7, 5, 4],
];

// Note durations in beats (mixed rhythm for musicality)
const RHYTHM_PATTERNS = [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1],
    [1, 1, 1.5, 0.5, 1, 1, 1, 1],
    [2, 1, 1, 1, 1, 1, 1, 0],
];

export function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);

    bgmGain = audioCtx.createGain();
    bgmGain.gain.value = 0.18; // BGM volume — soft background
    bgmGain.connect(masterGain);

    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.3;
    sfxGain.connect(masterGain);
}

export function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// --- Play a single note with envelope ---
function playNote(freq, startTime, duration, volume = 0.15, type = 'sine') {
    if (!audioCtx || !bgmGain) return;

    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    // Gentle attack/decay envelope
    const attack = 0.05;
    const decay = duration * 0.3;
    const sustain = volume * 0.6;
    const release = Math.min(0.4, duration * 0.4);

    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + attack);
    env.gain.linearRampToValueAtTime(sustain, startTime + attack + decay);
    env.gain.setValueAtTime(sustain, startTime + duration - release);
    env.gain.linearRampToValueAtTime(0, startTime + duration);

    osc.connect(env);
    env.connect(bgmGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
}

// --- Play a warm pad chord ---
function playPad(freqs, startTime, duration, volume = 0.04) {
    if (!audioCtx || !bgmGain) return;

    for (const freq of freqs) {
        // Slightly detuned pair for warmth
        for (const detune of [-3, 0, 3]) {
            const osc = audioCtx.createOscillator();
            const env = audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.detune.value = detune;

            env.gain.setValueAtTime(0, startTime);
            env.gain.linearRampToValueAtTime(volume, startTime + 0.8);
            env.gain.setValueAtTime(volume, startTime + duration - 1.2);
            env.gain.linearRampToValueAtTime(0, startTime + duration);

            osc.connect(env);
            env.connect(bgmGain);

            osc.start(startTime);
            osc.stop(startTime + duration + 0.1);
        }
    }
}

// --- Plucked string sound (guzheng-like) ---
function playPluck(freq, startTime, duration, volume = 0.12) {
    if (!audioCtx || !bgmGain) return;

    // Use triangle wave + fast decay for plucked sound
    const osc = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2; // harmonic

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 6, startTime);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.5, startTime + duration * 0.7);

    // Sharp attack, exponential decay
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    const merger = audioCtx.createGain();
    merger.gain.value = 1.0;

    osc.connect(merger);
    osc2.connect(audioCtx.createGain()); // separate gain for harmonic
    const harmGain = audioCtx.createGain();
    harmGain.gain.value = 0.3;
    osc2.connect(harmGain);
    harmGain.connect(merger);

    merger.connect(filter);
    filter.connect(env);
    env.connect(bgmGain);

    osc.start(startTime);
    osc2.start(startTime);
    osc.stop(startTime + duration + 0.1);
    osc2.stop(startTime + duration + 0.1);
}

// --- Schedule one full loop of BGM ---
function scheduleBGMLoop() {
    if (!audioCtx || !bgmGain || isMuted) return;

    const bpm = 72;
    const beatDur = 60 / bpm;
    const now = audioCtx.currentTime + 0.1;

    // Pick random melody phrase and rhythm
    const phraseIdx = Math.floor(Math.random() * MELODY_PHRASES.length);
    const rhythmIdx = Math.floor(Math.random() * RHYTHM_PATTERNS.length);
    const phrase = MELODY_PHRASES[phraseIdx];
    const rhythm = RHYTHM_PATTERNS[rhythmIdx];

    // Pad chord: root + 5th of the phrase's first note
    const rootIdx = phrase[0] % 5;
    const padRoot = PENTATONIC[rootIdx];
    const padFifth = PENTATONIC[(rootIdx + 2) % 5] * (rootIdx + 2 >= 5 ? 1 : 1);
    const loopBeats = rhythm.reduce((a, b) => a + b, 0);
    const loopDuration = loopBeats * beatDur;

    // Background pad
    playPad([padRoot * 0.5, padFifth * 0.5], now, loopDuration + 1, 0.025);

    // Melody notes (plucked guzheng style)
    let t = now;
    for (let i = 0; i < phrase.length; i++) {
        const dur = rhythm[i] * beatDur;
        if (dur > 0) {
            const freq = PENTATONIC[phrase[i]];
            playPluck(freq, t, dur * 0.9, 0.08 + Math.random() * 0.04);

            // Occasional octave doubling for brightness
            if (Math.random() < 0.2) {
                playNote(freq * 2, t + 0.02, dur * 0.5, 0.02, 'sine');
            }
        }
        t += dur;
    }

    // Add gentle bell/chime accent on first beat
    playNote(PENTATONIC[phrase[0]] * 2, now, beatDur * 2, 0.03, 'sine');

    // Schedule next loop (with slight pause between phrases)
    const nextDelay = (loopDuration + 1.5 + Math.random() * 1.0) * 1000;
    const timer = setTimeout(() => scheduleBGMLoop(), nextDelay);
    bgmTimers.push(timer);
}

export function startBGM() {
    if (bgmStarted || !audioCtx) return;
    bgmStarted = true;
    resumeAudio();
    scheduleBGMLoop();
}

export function stopBGM() {
    bgmStarted = false;
    for (const t of bgmTimers) clearTimeout(t);
    bgmTimers = [];
}

export function toggleMute() {
    isMuted = !isMuted;
    if (masterGain) {
        masterGain.gain.linearRampToValueAtTime(
            isMuted ? 0 : 1.0,
            audioCtx.currentTime + 0.15
        );
    }
    if (isMuted) {
        stopBGM();
    } else if (!bgmStarted) {
        bgmStarted = true;
        scheduleBGMLoop();
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
