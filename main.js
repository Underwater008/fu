// ============================================================
// Fortune Gacha — 3D ASCII Fortune Experience with Gacha Mechanics
// State machine: arrival -> draw -> fortune -> (draw again loop)
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import vertexShader from './particleVertex.glsl?raw';
import fragmentShader from './particleFragment.glsl?raw';
import {
    performDrawWithPity, performMultiDrawWithPity,
    saveToCollection, saveMultiToCollection,
    FULL_CHAR_BLESSINGS, RARITY_TIERS,
    BLESSING_CATEGORIES as GACHA_CATEGORIES,
    getCollectionProgress, getCollectionByCategory,
} from './gacha.js';
import {
    initAudio, resumeAudio, startBGM, toggleMute, isBGMMuted,
    playSfxDraw, playSfxReveal, switchToVocal, switchToInst, initMusicSystem
} from './audio.js';
import { getUser, onAuthChange, restoreSession, ensureUser, spendDraws, getReferralFromUrl, applyReferral } from './auth.js';
import { getPityCounter, incrementPity, resetPity, setPityCounter } from './rewards.js';
import { initAds } from './ads.js';
import { getPaymentResult } from './payments.js';
import { claimGift, getGiftTokenFromUrl, returnExpiredGifts } from './gifting.js';
import { initMonetizationUI, openRewardsPanel, setCurrentDrawResult, showSingleFortuneActions, hideSingleFortuneActions, showMultiShareButton, hideMultiShareButton, setDetailDraw, setSceneCanvas } from './monetization-ui.js';
import { loadCollection } from './gacha.js';
// --- HTML escape helper (prevent XSS in innerHTML) ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Preload Local Audio
initMusicSystem();

// Prevent pinch-zoom on iOS Safari (ignores viewport meta)
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', e => e.preventDefault(), { passive: false });

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const IS_COARSE_POINTER = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const DRAW_LAUNCH_PROFILE = IS_COARSE_POINTER
    ? {
        morphSpeedMul: 0.45,
        intensityMul: 0.84,
        blurMul: 0.62,
        trailSpawnMul: 0.58,
        outerGlow: false,
    }
    : {
        morphSpeedMul: 1.0,
        intensityMul: 1.0,
        blurMul: 1.0,
        trailSpawnMul: 1.0,
        outerGlow: true,
    };

// --- Configuration ---
const CONFIG = {
    bg: '#990000', // Crimson
    glowRed: '#FF2D2D',
    glowGold: '#FFD700',
    glowGreen: '#00FF9F',
    // Transition durations (ms)
    scatterDur: 450,
    scrambleDur: 900,
    convergeDur: 450,
    settleDur: 250,
    // Draw phase: seconds before Fu bursts into particles
    fuExplodeDelay: 2.0,
    // Draw phase: independent timing controls (seconds)
    fuRiseDuration: 0.8,
    fuShrinkDuration: 0.8,
    fuShrinkEndScale: 0.18,
    // Draw camera timing (seconds)
    fuCameraPullbackDuration: 0.45,
    fuCameraReturnDuration: 0.7,
    // Firework shell rise time (seconds) before burst
    shellRiseDuration: 2.5,
};

const LUCKY_CHARS_BY_DENSITY = [
    ' ', '\u00B7', '\u4E00', '\u4EBA', '\u5341', '\u5927', '\u5409', '\u5E73', '\u5B89', '\u548C',
    '\u6625', '\u5229', '\u5174', '\u65FA', '\u53D1', '\u91D1', '\u8D35', '\u5BCC', '\u8D22', '\u5BFF',
    '\u7984', '\u559C', '\u9F99', '\u51E4', '\u798F',
];

const ALL_LUCKY = '\u798F\u7984\u5BFF\u559C\u8D22\u5BCC\u8D35\u53D1\u91D1\u7389\u5B9D\u4F59\u4E30\u76DB\u5229\u65FA\u9686\u660C\u5174\u8FDB\u5B89\u5EB7\u5B81\u6CF0\u548C\u5E73\u987A\u5065\u4E50\u6B22\u5E86\u79A7\u797A\u5609\u6625\u5FB7\u5584\u4EC1\u4E49\u5FE0\u4FE1\u5B5D\u6167\u6069\u7231\u5408\u5706\u6EE1\u7F8E\u99A8\u96C5\u5409\u7965\u745E\u5982\u610F\u795D\u8FD0\u9F99\u51E4\u9E9F\u9E64\u534E\u6210\u5347\u767B\u9AD8';

// --- Calligraphy Fonts ---
const CALLI_FONTS = [
    '"Zhi Mang Xing"',
    '"Liu Jian Mao Cao"',
    '"Ma Shan Zheng"',
    '"TsangerZhoukeZhengdabangshu"',
    '"hongleixingshu"',
    '"qiantubifengshouxieti"',
    '"\u5CC4\u5C71\u7891\u7BC6\u4F53"',
];
const FONT_DISPLAY_NAMES = [
    '\u6307\u8292\u661F',
    '\u67F3\u5EFA\u6BDB\u8349',
    '\u9A6C\u5584\u653F',
    '\u4ED3\u8033\u5468\u73C2\u6B63\u5927\u699C\u4E66',
    '\u9E3F\u96F7\u884C\u4E66\u7B80\u4F53',
    '\u5343\u56FE\u7B14\u950B\u624B\u5199\u4F53',
    '\u5CC4\u5C71\u7891\u7BC6\u4F53',
];
const chosenFont = CALLI_FONTS[Math.floor(Math.random() * CALLI_FONTS.length)];
// Fixed font for multi-pull cards — uses @chinese-fonts package with full CJK coverage
// so all characters (main + blessing phrase) render consistently in calligraphy.
const MULTI_CARD_FONT = '"TsangerZhoukeZhengdabangshu"';

// Preload MULTI_CARD_FONT for all characters used on cards (main + blessing phrases).
// cn-font-split uses unicode-range, and canvas fillText won't trigger on-demand loading.
(function preloadMultiCardFont() {
    const allPhraseChars = Object.values(FULL_CHAR_BLESSINGS).map(b => b.phrase).join('');
    const unique = [...new Set([...ALL_LUCKY, ...allPhraseChars])].join('');
    document.fonts.load(`20px ${MULTI_CARD_FONT}`, unique).catch(() => {});
    // Also inject a hidden DOM element to trigger unicode-range matching
    const el = document.createElement('span');
    el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;font-size:1px;visibility:hidden;pointer-events:none;';
    el.style.fontFamily = 'TsangerZhoukeZhengdabangshu, serif';
    el.textContent = unique;
    document.documentElement.appendChild(el);
})();

// --- Daji title font cycling ---
let dajiFontIdx = 2; // Start with Ma Shan Zheng
let dajiFontTransition = null; // { oldFont, startTime }
let dajiFontAutoTimer = 0;
const DAJI_AUTO_INTERVAL = 4.5;

function getDajiFont() { return CALLI_FONTS[dajiFontIdx]; }

function cycleDajiFont(dir) {
    const oldFont = CALLI_FONTS[dajiFontIdx];
    let newIdx;
    do { newIdx = Math.floor(Math.random() * CALLI_FONTS.length); } while (newIdx === dajiFontIdx && CALLI_FONTS.length > 1);
    dajiFontIdx = newIdx;
    dajiFontTransition = { oldFont, startTime: globalTime };
    dajiFontAutoTimer = globalTime;
}

// --- Math ---
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

const FU_GLYPH = '\u798F';
const FU_METRIC_TEST_SIZE = 256;
const fuVisualOffsetRatioByFont = new Map();

function getFuVisualOffsetRatio(fontFamily) {
    if (fuVisualOffsetRatioByFont.has(fontFamily)) return fuVisualOffsetRatioByFont.get(fontFamily);

    const metricCanvas = document.createElement('canvas');
    const metricCtx = metricCanvas.getContext('2d');
    metricCtx.font = `${FU_METRIC_TEST_SIZE}px ${fontFamily}, serif`;
    metricCtx.textAlign = 'center';
    metricCtx.textBaseline = 'alphabetic';
    const m = metricCtx.measureText(FU_GLYPH);

    const ascent = m.actualBoundingBoxAscent || FU_METRIC_TEST_SIZE * 0.5;
    const descent = m.actualBoundingBoxDescent || FU_METRIC_TEST_SIZE * 0.5;
    const ratio = (ascent - descent) / (2 * FU_METRIC_TEST_SIZE);

    fuVisualOffsetRatioByFont.set(fontFamily, ratio);
    return ratio;
}

function getFuVisualCenterY(baseY, fontFamily, fontSize) {
    return baseY + getFuVisualOffsetRatio(fontFamily) * fontSize;
}

// --- 3D Projection ---
const SCENE_FOV = 500;

function project3D(x, y, z, fov) {
    const scale = fov / (fov + z);
    return {
        screenX: x * scale + window.innerWidth / 2,
        screenY: y * scale + window.innerHeight / 2,
        scale,
    };
}

function gridToWorld(col, row) {
    return {
        x: (col - cols / 2) * cellSize,
        y: (row - rows / 2) * cellSize,
    };
}

// --- Responsive Grid ---
let cellSize, cols, rows, gridW, gridH, offsetX, offsetY;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

// Forward-declare Three.js variables so resize() can reference them safely
let glRenderer, glScene, glCamera, particlesMesh;
let composer, bloomPass, chromaticPass, shockwavePass;
let charToUV = {};

// --- Post-processing state ---
let ppChromatic = 0;       // chromatic aberration strength (0 = off)
let ppBloomStrength = 0.12; // current bloom strength
let ppBloomTarget = 0.12;  // target bloom strength (lerps)
let ppShockwaves = [];     // { cx, cy, startTime, duration, maxRadius, strength }
let speedLinesActive = false;

// --- Chromatic Aberration Shader ---
const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        strength: { value: 0.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float strength;
        varying vec2 vUv;
        void main() {
            vec2 center = vec2(0.5);
            vec2 dir = vUv - center;
            float dist = length(dir);
            vec2 offset = dir * strength * dist;
            float r = texture2D(tDiffuse, vUv + offset).r;
            vec4 base = texture2D(tDiffuse, vUv);
            float b = texture2D(tDiffuse, vUv - offset).b;
            gl_FragColor = vec4(r, base.g, b, base.a);
        }
    `
};

// --- Shockwave Distortion Shader ---
const ShockwaveShader = {
    uniforms: {
        tDiffuse: { value: null },
        shockCenter: { value: new THREE.Vector2(0.5, 0.5) },
        shockRadius: { value: 0.0 },
        shockWidth: { value: 0.06 },
        shockStrength: { value: 0.0 },
        aspectRatio: { value: 1.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 shockCenter;
        uniform float shockRadius;
        uniform float shockWidth;
        uniform float shockStrength;
        uniform float aspectRatio;
        varying vec2 vUv;
        void main() {
            vec2 uv = vUv;
            vec2 delta = uv - shockCenter;
            delta.x *= aspectRatio;
            float dist = length(delta);
            float ringDist = abs(dist - shockRadius);
            if (ringDist < shockWidth && shockStrength > 0.001) {
                float factor = (1.0 - ringDist / shockWidth);
                factor = factor * factor * shockStrength;
                vec2 dir = normalize(delta);
                dir.x /= aspectRatio;
                uv += dir * factor * 0.04;
            }
            gl_FragColor = texture2D(tDiffuse, uv);
        }
    `
};

function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    cellSize = Math.max(10, Math.floor(vmin * 0.028));
    cols = Math.floor(window.innerWidth / cellSize);
    rows = Math.floor(window.innerHeight / cellSize);
    gridW = cols * cellSize;
    gridH = rows * cellSize;
    offsetX = (window.innerWidth - gridW) / 2;
    offsetY = (window.innerHeight - gridH) / 2;

    if (glRenderer) {
        glRenderer.setSize(window.innerWidth, window.innerHeight);
        glRenderer.setPixelRatio(dpr);
        const fov = 2 * Math.atan(window.innerHeight / (2 * SCENE_FOV)) * (180 / Math.PI);
        glCamera.fov = fov;
        glCamera.aspect = window.innerWidth / window.innerHeight;
        glCamera.updateProjectionMatrix();
        if (composer) composer.setSize(window.innerWidth, window.innerHeight);
        if (shockwavePass) shockwavePass.uniforms.aspectRatio.value = window.innerWidth / window.innerHeight;
    }
}
window.addEventListener('resize', resize);
resize();

// --- Responsive Layout Helpers ---
const CLUSTER_SIZE_MULTIPLIER = 1.28;
const LANDSCAPE_CLUSTER_CAP_RATIO = 0.33;

function isLandscape() {
    return window.innerWidth > window.innerHeight * 1.2;
}

function getClusterSpread() {
    const baseSpread = Math.min(cols, rows) * 0.40 * cellSize * CLUSTER_SIZE_MULTIPLIER;
    if (isLandscape()) {
        // On landscape/desktop, cap spread to keep cluster proportional
        return Math.min(baseSpread, window.innerHeight * LANDSCAPE_CLUSTER_CAP_RATIO);
    }
    return baseSpread;
}

// Responsive grid layout for multi-pull (portrait 5×2, landscape 10×1)
function getMultiGridLayout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = !isLandscape();
    // Portrait: 5×2 grid; Landscape/Desktop: 10×1 row of tall fortune-stick cards.
    const multiCols = portrait ? 5 : 10;
    const multiRows = portrait ? 2 : 1;
    const gridW = portrait ? w * 0.92 : w * 0.88;
    // Desktop: tall cards filling most of the screen height (fortune-stick look).
    const gridH = portrait ? h * 0.72 : h * 0.74;
    const scaleFactor = portrait ? 0.30 : 0.28;
    // Shift grid upward to leave room for bottom controls/hints.
    const gridTopY = portrait ? h * 0.06 : h * 0.04;
    const startX = (w - gridW) / 2 + (gridW / multiCols) / 2;
    const startY = gridTopY + (gridH / multiRows) / 2;
    const stepX = gridW / multiCols;
    const stepY = gridH / multiRows;
    // Desktop: add more horizontal gap between stick-cards.
    const cardW = portrait ? stepX - 8 : stepX - 14;
    const cardHeightScale = portrait ? 0.94 : 0.96;
    const cardH = stepY * cardHeightScale;
    const gridBottom = gridTopY + gridH;
    return { multiCols, multiRows, gridW, gridH, startX, startY, stepX, stepY, cardW, cardH, scaleFactor, gridBottom };
}

// Responsive layout params for fortune/arrival overlay text positions
function getLayout() {
    if (isLandscape()) {
        const maxCharSize = Math.min(cellSize * 5, window.innerHeight * 0.11);
        return {
            starsY: 0.22,
            charY: 0.13,
            tierY: 0.61,
            tierEnY: 0.65,
            cardTop: 0.19,
            cardBottom: 0.71,
            clusterYOffset: 0.09,
            cardWidth: 0.42,
            categoryY: 0.70,
            phraseY: 0.77,
            englishY: 0.82,
            hintY: 0.90,
            hintSubY: 0.93,
            charFontSize: maxCharSize,
            arrivalTitleY: 0.12,
            arrivalSubY: 0.17,
            arrivalHintY: 0.83,
            arrivalHintSubY: 0.87,
            arrivalFuSize: Math.min(window.innerHeight * 0.45, window.innerWidth * 0.30),
            multiHintY: 0.85,
            multiHintSubY: 0.88,
        };
    }
    return {
        starsY: 0.27,
        charY: 0.18,
        tierY: 0.60,
        tierEnY: 0.63,
        cardTop: 0.25,
        cardBottom: 0.70,
        clusterYOffset: 0.07,
        cardWidth: 0.62,
        categoryY: 0.61,
        phraseY: 0.71,
        englishY: 0.77,
        hintY: 0.87,
        hintSubY: 0.91,
        charFontSize: cellSize * 5,
        arrivalTitleY: 0.15,
        arrivalSubY: 0.20,
        arrivalHintY: 0.78,
        arrivalHintSubY: 0.82,
        arrivalFuSize: Math.min(window.innerWidth, window.innerHeight) * 0.55,
        multiHintY: 0.85,
        multiHintSubY: 0.88,
    };
}

function getSwipeHintText(isMulti) {
    return {
        mainText: isMulti ? '\u2191  Swipe Up to Draw \u00D710  \u2191' : '\u2191  Swipe Up to Draw Fortune  \u2191',
        subText: isMulti ? '\u4E0A\u6ED1\u5341\u8FDE' : '\u4E0A\u6ED1\u62BD\u7B7E',
    };
}

function getSwipeHintSizes() {
    return {
        hintSize: isLandscape() ? Math.min(cellSize * 1.6, window.innerHeight * 0.035) : cellSize * 1.6,
        hintSubSize: isLandscape() ? Math.min(cellSize * 1.2, window.innerHeight * 0.027) : cellSize * 1.2,
    };
}

function getSwipeHintHopOffset() {
    const hopPhase = globalTime % 3.0;
    if (hopPhase >= 0.9) return 0;
    const decay = 1 - hopPhase / 0.9;
    return -Math.abs(Math.sin((hopPhase / 0.9) * Math.PI * 3)) * 0.012 * decay;
}

// --- Three.js Setup (Hybrid Rendering) ---
const ATLAS_COLS = 20;
const ATLAS_ROWS = 20;
const CELL_PX = 96;

function initThreeJS() {
    // 1. Renderer
    glRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
    glRenderer.setSize(window.innerWidth, window.innerHeight);
    glRenderer.setPixelRatio(dpr);
    setSceneCanvas(glRenderer.domElement);

    // 2. Camera
    const fov = 2 * Math.atan(window.innerHeight / (2 * SCENE_FOV)) * (180 / Math.PI);
    glCamera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 1, 3000);
    glCamera.position.set(0, 0, SCENE_FOV);
    glCamera.lookAt(0, 0, 0);

    // 3. Scene
    glScene = new THREE.Scene();

    // 4. Texture Atlas
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_COLS * CELL_PX;
    atlasCanvas.height = ATLAS_ROWS * CELL_PX;
    const actx = atlasCanvas.getContext('2d');

    actx.fillStyle = '#000';
    actx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);

    // Collect all unique characters
    const uniqueChars = new Set([
        ...LUCKY_CHARS_BY_DENSITY,
        ...ALL_LUCKY.split(''),
        ...Object.keys(FULL_CHAR_BLESSINGS),
        '\u00B7', '\u2605',
    ]);

    actx.font = `${Math.floor(CELL_PX * 0.88)}px "Courier New", "SF Mono", monospace`;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    actx.fillStyle = '#FFFFFF';
    actx.shadowColor = 'white';
    actx.shadowBlur = CELL_PX * 0.04;

    let idx = 0;
    uniqueChars.forEach(char => {
        if (idx >= ATLAS_COLS * ATLAS_ROWS) return;
        const col = idx % ATLAS_COLS;
        const row = Math.floor(idx / ATLAS_COLS);
        const x = col * CELL_PX + CELL_PX / 2;
        const y = row * CELL_PX + CELL_PX / 2;

        actx.fillText(char, x, y);

        charToUV[char] = {
            u: col / ATLAS_COLS,
            v: 1.0 - (row + 1) / ATLAS_ROWS
        };
        idx++;
    });

    // Bake calligraphy font variants for cluster characters
    const clusterChars = LUCKY_CHARS_BY_DENSITY.filter(c => c !== ' ');
    for (let fi = 0; fi < CALLI_FONTS.length; fi++) {
        actx.font = `${Math.floor(CELL_PX * 0.88)}px ${CALLI_FONTS[fi]}, "Courier New", monospace`;
        for (const char of clusterChars) {
            if (idx >= ATLAS_COLS * ATLAS_ROWS) break;
            const col = idx % ATLAS_COLS;
            const row = Math.floor(idx / ATLAS_COLS);
            const x = col * CELL_PX + CELL_PX / 2;
            const y = row * CELL_PX + CELL_PX / 2;
            actx.fillText(char, x, y);
            charToUV[char + '|' + fi] = {
                u: col / ATLAS_COLS,
                v: 1.0 - (row + 1) / ATLAS_ROWS
            };
            idx++;
        }
    }

    const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.minFilter = THREE.LinearFilter;

    // 5. InstancedMesh
    const MAX_PARTICLES = 10000;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            atlas: { value: atlasTexture },
            cellSize: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquation: THREE.AddEquation,
        depthWrite: false,
        depthTest: false
    });

    particlesMesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);

    const instanceColor = new Float32Array(MAX_PARTICLES * 3);
    const instanceAlpha = new Float32Array(MAX_PARTICLES);
    const instanceUV = new Float32Array(MAX_PARTICLES * 2);
    const instanceScale = new Float32Array(MAX_PARTICLES);

    particlesMesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(instanceColor, 3));
    particlesMesh.geometry.setAttribute('instanceAlpha', new THREE.InstancedBufferAttribute(instanceAlpha, 1));
    particlesMesh.geometry.setAttribute('instanceUV', new THREE.InstancedBufferAttribute(instanceUV, 2));
    particlesMesh.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(instanceScale, 1));

    particlesMesh.frustumCulled = false;
    glScene.add(particlesMesh);

    // 6. Post-processing pipeline
    composer = new EffectComposer(glRenderer);
    const renderPass = new RenderPass(glScene, glCamera);
    renderPass.clearAlpha = 0;
    composer.addPass(renderPass);

    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.12,  // strength — very subtle glow, keep characters readable
        0.35,  // radius
        0.45   // threshold — high so only the brightest spots bloom
    );
    composer.addPass(bloomPass);

    shockwavePass = new ShaderPass(ShockwaveShader);
    shockwavePass.uniforms.aspectRatio.value = window.innerWidth / window.innerHeight;
    shockwavePass.enabled = false;
    composer.addPass(shockwavePass);

    chromaticPass = new ShaderPass(ChromaticAberrationShader);
    chromaticPass.enabled = false;
    composer.addPass(chromaticPass);
}

// --- Grid Buffer (for ASCII elements) ---
let grid = [];
function clearGrid() {
    grid = new Array(rows * cols).fill(null);
}
function setCell(col, row, depth, char, r, g, b, alpha) {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    const idx = row * cols + col;
    const existing = grid[idx];
    if (existing && existing.depth <= depth) return;
    grid[idx] = { char, r, g, b, alpha, depth };
}

// --- Character Sampling ---
function sampleCharacterShape(char, resolution, fontOverride) {
    const off = document.createElement('canvas');
    const octx = off.getContext('2d', { willReadFrequently: true });
    const charCount = [...char].length;
    const w = resolution * charCount;
    const h = resolution;
    off.width = w;
    off.height = h;

    octx.fillStyle = '#000';
    octx.fillRect(0, 0, w, h);
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const font = fontOverride || '"SimSun", "STSong", "Songti SC", "Noto Serif SC", serif';
    octx.font = `bold ${Math.floor(resolution * 0.85)}px ${font}`;
    octx.fillText(char, w / 2, h / 2);

    const imageData = octx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const points = [];
    const step = charCount > 1 ? 2 : 1;
    for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
            const idx = (y * w + x) * 4;
            const brightness = data[idx] / 255;
            if (brightness > 0.1) {
                points.push({
                    nx: (x / w) * 2 - 1,
                    ny: (y / h) * 2 - 1,
                    brightness,
                    aspect: charCount,
                });
            }
        }
    }
    return points;
}

function selectCharByLuminance(luminance) {
    const idx = Math.floor(luminance * (LUCKY_CHARS_BY_DENSITY.length - 1));
    return LUCKY_CHARS_BY_DENSITY[Math.max(0, Math.min(idx, LUCKY_CHARS_BY_DENSITY.length - 1))];
}

function lerpColor(luminance) {
    const r = 255;
    const g = Math.floor(45 + luminance * (215 - 45));
    const b = Math.floor(45 - luminance * 45);
    return { r, g, b };
}

// --- Shape Data (sampled after fonts load) ---
let fuShape = [];
let dajiShape = []; // fallback shape for non-seeded init
let currentDrawShape = []; // shape for current gacha draw
let fontsReady = false;

// --- Gacha State ---
let currentDrawResult = null;
let multiDrawResults = null;
let isMultiMode = false;
let currentDrawsList = null; // module-scoped (was currentDrawsList)
let multiFlipState = null; // { revealedCount, cardElements[] }
let multiFortuneState = null; // Canvas-integrated multi fortune display

// Force-load all calligraphy fonts with ALL characters used in the app
const ALL_FONT_CHARS = ALL_LUCKY + '\u00B7\u4E00\u4EBA\u5341\u5927\u99AC\u9A6C\u9F20\u725B\u864E\u5154\u9F8D\u86C7\u7F8A\u7334\u96DE\u72D7\u8C6C';
const EXTRA_HORSE_FONTS = ['"Long Cang"', '"ZCOOL XiaoWei"'];
Promise.all([
    ...CALLI_FONTS.map(f => document.fonts.load(`64px ${f}`, ALL_FONT_CHARS)),
    ...EXTRA_HORSE_FONTS.map(f => document.fonts.load(`64px ${f}`, '\u99AC\u9A6C').catch(() => {})),
]).then(() => {
    fuShape = sampleCharacterShape('\u798F', 64, chosenFont);
    dajiShape = sampleCharacterShape('\u5927\u5409', 64);
    fontsReady = true;
    initThreeJS();

    // Show UI buttons for arrival state
    updateUIVisibility();
});

// --- 3D Character Cluster ---
let daji3DParticles = [];
let daji3DEntryTime = 0;
let daji3DFromSeed = false;
let hoveredIdx = -1;

function initDaji3D(seedParticles) {
    daji3DParticles = [];
    hoveredIdx = -1;
    daji3DFromSeed = false;
    hideTooltip();
    if (Array.isArray(seedParticles) && seedParticles.length > 0) {
        daji3DParticles = seedParticles.map((p) => ({ ...p }));
        daji3DFromSeed = true;
        daji3DEntryTime = globalTime;
        return;
    }
    if (!fontsReady) return;

    // Use current draw shape if available, otherwise fallback
    const shapeSource = (currentDrawShape && currentDrawShape.length > 0) ? currentDrawShape : dajiShape;
    const spread = getClusterSpread();
    const depth = spread * 0.4;

    for (const pt of shapeSource) {
        const lum = Math.min(1, pt.brightness + 0.08);
        const char = selectCharByLuminance(lum);
        if (char === ' ') continue;
        const color = lerpColor(lum);

        daji3DParticles.push({
            baseX: pt.nx * spread * 0.8 * pt.aspect,
            baseY: pt.ny * spread * 0.8,
            origZ: (Math.random() - 0.5) * depth,
            char,
            fontIdx: Math.random() < 0.7 ? Math.floor(Math.random() * CALLI_FONTS.length) : null,
            r: color.r, g: color.g, b: color.b,
            alpha: 0.3 + lum * 0.7,
            lum,
            phase: Math.random() * Math.PI * 2,
        });
    }
    daji3DEntryTime = globalTime;
}

// Shared dummy object for setMatrixAt
const _dummy = new THREE.Object3D();

// Replaces render3DDaji with GPU rendering
function updateDajiToGPU(skipRender) {
    if (!particlesMesh) return 0;
    if (!daji3DParticles.length) {
        particlesMesh.count = 0;
        return 0;
    }

    const spread = getClusterSpread();
    const entryT = Math.min(1, (globalTime - daji3DEntryTime) / 1.2);
    const zInflate = daji3DFromSeed ? 1 : easeInOut(entryT);
    const blendT = daji3DFromSeed ? Math.min(1, (globalTime - daji3DEntryTime) / 0.6) : 1;
    const breatheDelay = daji3DFromSeed ? 0 : 0.5;
    const breatheRamp = daji3DFromSeed
        ? 1
        : Math.min(1, Math.max(0, (globalTime - daji3DEntryTime - breatheDelay) / 0.8));
    const breatheAmp = spread * 0.06 * breatheRamp;

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;

    const maxCount = instColor.count;
    const count = Math.min(daji3DParticles.length, maxCount);

    const clusterH = spread * 0.5;
    const highlightPos = Math.sin(globalTime * 0.8) * 0.3;
    const clusterYShift = (getLayout().clusterYOffset || 0) * window.innerHeight;

    for (let i = 0; i < count; i++) {
        const p = daji3DParticles[i];
        const z = p.origZ * zInflate + Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;
        const isHovered = i === hoveredIdx;
        const hoverPush = isHovered ? -80 : 0;

        _dummy.position.set(p.baseX, -p.baseY + clusterYShift, -(z + hoverPush));
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(i, _dummy.matrix);

        // Desktop: much softer particles (triple additive blending compounds brightness)
        const _desktop = isLandscape();
        let alpha = p.alpha * (_desktop ? 0.10 : 0.85);
        alpha = Math.min(_desktop ? 0.032 : 0.6, alpha);
        if (isHovered) alpha = 1.0;

        const yNorm = clusterH > 0 ? p.baseY / clusterH : 0;
        const gradT = Math.max(0, Math.min(1, (yNorm + 1) * 0.5));
        const hDist = Math.abs(yNorm - highlightPos);
        const highlight = Math.max(0, 1 - hDist * 3);

        const metalR = Math.min(255, Math.floor(lerp(255, 180, gradT) + highlight * 55));
        const metalG = Math.min(255, Math.floor(lerp(225, 130, gradT) + highlight * 40));
        const metalB = Math.min(255, Math.floor(lerp(50, 10, gradT) + highlight * 50));

        const gr = lerp(p.r, metalR, blendT) / 255;
        const gg = lerp(p.g, metalG, blendT) / 255;
        const gb = lerp(p.b, metalB, blendT) / 255;

        instColor.setXYZ(i, isHovered ? 1.0 : gr, isHovered ? 0.97 : gg, isHovered ? 0.86 : gb);
        instAlpha.setX(i, alpha);

        const uv = (p.fontIdx != null && charToUV[p.char + '|' + p.fontIdx]) || charToUV[p.char];
        if (uv) instUV.setXY(i, uv.u, uv.v);

        let scale = cellSize * (_desktop ? 0.30 : 0.85);
        if (isHovered) scale *= 2.2;
        instScale.setX(i, scale);
    }

    particlesMesh.count = count;
    particlesMesh.instanceMatrix.needsUpdate = true;
    instColor.needsUpdate = true;
    instAlpha.needsUpdate = true;
    instUV.needsUpdate = true;
    instScale.needsUpdate = true;

    if (!skipRender) renderAndCompositeGL();
    return count;
}

// --- Tooltip ---
const tooltip = document.createElement('div');
Object.assign(tooltip.style, {
    position: 'fixed',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.2s ease',
    background: 'rgba(10, 10, 10, 0.92)',
    border: '1px solid rgba(255, 215, 0, 0.4)',
    borderRadius: '8px',
    padding: '14px 18px',
    textAlign: 'center',
    fontFamily: '"Courier New", "SF Mono", monospace',
    zIndex: '100',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    boxShadow: '0 0 24px rgba(255, 45, 45, 0.15), 0 0 8px rgba(255, 215, 0, 0.1)',
    maxWidth: '220px',
    minWidth: '140px',
});
tooltip.innerHTML = '<div id="tt-char" style="font-size:36px;color:#FFD700;margin-bottom:6px;text-shadow:0 0 12px rgba(255,215,0,0.5)"></div>'
    + '<div id="tt-phrase" style="font-size:15px;color:#FF2D2D;margin-bottom:4px"></div>'
    + '<div id="tt-english" style="font-size:11px;color:#FFD700;opacity:0.65"></div>';
document.body.appendChild(tooltip);

function showTooltip(char, screenX, screenY) {
    const blessing = FULL_CHAR_BLESSINGS[char];
    if (!blessing) { hideTooltip(); return; }

    document.getElementById('tt-char').textContent = char;
    document.getElementById('tt-phrase').textContent = blessing.phrase;
    document.getElementById('tt-english').textContent = blessing.english;

    const ttW = 200;
    const ttH = 110;
    let left = screenX - ttW / 2;
    let top = screenY - ttH - 30;

    left = Math.max(8, Math.min(window.innerWidth - ttW - 8, left));
    if (top < 8) top = screenY + 40;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.opacity = '1';
}

function hideTooltip() {
    tooltip.style.opacity = '0';
}

function updateHover(clientX, clientY) {
    if (daji3DParticles.length === 0) { hoveredIdx = -1; hideTooltip(); return; }

    const spread = getClusterSpread();
    const entryT = Math.min(1, (globalTime - daji3DEntryTime) / 1.2);
    const zInflate = daji3DFromSeed ? 1 : easeInOut(entryT);
    const blendT = daji3DFromSeed ? Math.min(1, (globalTime - daji3DEntryTime) / 0.6) : 1;
    const breatheAmp = spread * 0.06 * (daji3DFromSeed ? blendT : zInflate);

    let bestIdx = -1, bestDist = Infinity;

    for (let i = 0; i < daji3DParticles.length; i++) {
        const p = daji3DParticles[i];
        if (!FULL_CHAR_BLESSINGS[p.char]) continue;
        const z = p.origZ * zInflate + Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;
        const proj = project3D(p.baseX, p.baseY, z, SCENE_FOV);
        const dx = proj.screenX - clientX;
        const dy = proj.screenY - clientY;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }

    const threshold = cellSize * 2.5;
    if (bestDist > threshold * threshold) {
        hoveredIdx = -1;
        hideTooltip();
        return;
    }

    if (bestIdx !== hoveredIdx) {
        hoveredIdx = bestIdx;
        const p = daji3DParticles[bestIdx];
        const z = p.origZ * zInflate + Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;
        const proj = project3D(p.baseX, p.baseY, z, SCENE_FOV);
        showTooltip(p.char, proj.screenX, proj.screenY);
    }
}

// --- Background Particles ---
const bgParticles = [];
function initBgParticles() {
    for (let i = 0; i < 40; i++) {
        bgParticles.push({
            col: Math.random() * cols,
            row: Math.random() * rows,
            vx: (Math.random() - 0.5) * 0.02,
            vy: (Math.random() - 0.5) * 0.02,
            char: ALL_LUCKY[Math.floor(Math.random() * ALL_LUCKY.length)],
            alpha: 0.03 + Math.random() * 0.08,
            phase: Math.random() * Math.PI * 2,
            changeTimer: Math.random() * 200,
        });
    }
}
initBgParticles();

function updateBgParticles(time) {
    for (const p of bgParticles) {
        p.col += p.vx;
        p.row += p.vy;
        p.changeTimer--;
        if (p.col < 0) p.col += cols;
        if (p.col >= cols) p.col -= cols;
        if (p.row < 0) p.row += rows;
        if (p.row >= rows) p.row -= rows;
        if (p.changeTimer <= 0) {
            p.char = ALL_LUCKY[Math.floor(Math.random() * ALL_LUCKY.length)];
            p.changeTimer = 100 + Math.random() * 200;
        }
        const col = Math.floor(p.col);
        const row = Math.floor(p.row);
        const flicker = p.alpha + Math.sin(p.phase + time * 1.5) * 0.02;
        setCell(col, row, 999, p.char, 255, 215, 0, Math.max(0.01, flicker));
    }
}

// --- Scanlines ---
function drawScanlines() {
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#fff';
    for (let y = 0; y < canvas.height; y += 4 * dpr) {
        ctx.fillRect(0, y, canvas.width, 1 * dpr);
    }
    ctx.restore();
}

// --- Render ASCII Grid to Canvas ---
function renderGrid() {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = CONFIG.bg;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const fontSize = cellSize;
    ctx.font = `${fontSize}px ${chosenFont}, "Courier New", "SF Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = grid[row * cols + col];
            if (!cell) continue;
            const x = offsetX + col * cellSize + cellSize / 2;
            const y = offsetY + row * cellSize + cellSize / 2;
            if (cell.alpha > 0.3) {
                ctx.shadowColor = `rgba(${cell.r}, ${cell.g}, ${cell.b}, ${cell.alpha * 0.6})`;
                ctx.shadowBlur = cellSize * cell.alpha * 1.2;
            } else {
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
            }
            ctx.fillStyle = `rgba(${cell.r}, ${cell.g}, ${cell.b}, ${cell.alpha})`;
            ctx.fillText(cell.char, x, y);
        }
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
    drawScanlines();
}

// --- Draw the calligraphy Fu directly on canvas ---
function drawCalligraphyFu(alpha) {
    ctx.save();
    ctx.scale(dpr, dpr);

    const L = getLayout();
    const fuSize = L.arrivalFuSize;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${fuSize}px ${chosenFont}, serif`;

    const visualCy = getFuVisualCenterY(cy, chosenFont, fuSize);

    // Outer glow layer
    ctx.globalAlpha = alpha * 0.3;
    ctx.shadowColor = CONFIG.glowGold;
    ctx.shadowBlur = fuSize * 0.15;
    ctx.fillStyle = CONFIG.glowGold;
    ctx.fillText('\u798F', cx, visualCy);

    // Main character
    ctx.globalAlpha = alpha;
    ctx.shadowColor = CONFIG.glowGold;
    ctx.shadowBlur = fuSize * 0.06;
    ctx.fillStyle = CONFIG.glowGold;
    ctx.fillText('\u798F', cx, visualCy);

    ctx.shadowBlur = 0;
    ctx.restore();
}

// --- Draw a frosted-glass card backdrop ---
function drawCardAt(cx, cy, cw, ch, alpha, borderColor, fillColor) {
    const cardX = cx - cw / 2;
    const cardY = cy - ch / 2;
    const r = 10;

    function traceDevicePath() {
        ctx.beginPath();
        ctx.moveTo((cardX + r) * dpr, cardY * dpr);
        ctx.lineTo((cardX + cw - r) * dpr, cardY * dpr);
        ctx.quadraticCurveTo((cardX + cw) * dpr, cardY * dpr, (cardX + cw) * dpr, (cardY + r) * dpr);
        ctx.lineTo((cardX + cw) * dpr, (cardY + ch - r) * dpr);
        ctx.quadraticCurveTo((cardX + cw) * dpr, (cardY + ch) * dpr, (cardX + cw - r) * dpr, (cardY + ch) * dpr);
        ctx.lineTo((cardX + r) * dpr, (cardY + ch) * dpr);
        ctx.quadraticCurveTo(cardX * dpr, (cardY + ch) * dpr, cardX * dpr, (cardY + ch - r) * dpr);
        ctx.lineTo(cardX * dpr, (cardY + r) * dpr);
        ctx.quadraticCurveTo(cardX * dpr, cardY * dpr, (cardX + r) * dpr, cardY * dpr);
        ctx.closePath();
    }
    function traceCSSPath() {
        ctx.beginPath();
        ctx.moveTo(cardX + r, cardY);
        ctx.lineTo(cardX + cw - r, cardY);
        ctx.quadraticCurveTo(cardX + cw, cardY, cardX + cw, cardY + r);
        ctx.lineTo(cardX + cw, cardY + ch - r);
        ctx.quadraticCurveTo(cardX + cw, cardY + ch, cardX + cw - r, cardY + ch);
        ctx.lineTo(cardX + r, cardY + ch);
        ctx.quadraticCurveTo(cardX, cardY + ch, cardX, cardY + ch - r);
        ctx.lineTo(cardX, cardY + r);
        ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
        ctx.closePath();
    }

    // Blur pass
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    traceDevicePath();
    ctx.clip();
    ctx.filter = 'blur(12px)';
    ctx.globalAlpha = 1;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    ctx.restore();

    // Fill + border
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = alpha;
    traceCSSPath();
    ctx.fillStyle = fillColor || 'rgba(80, 10, 10, 0.4)';
    ctx.fill();
    ctx.strokeStyle = borderColor || 'rgba(255, 215, 0, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

// Lightweight card rect (no blur pass) — for 10-card multi-fortune grid
function drawMultiCardRect(cx, cy, cw, ch, alpha, borderColor, fillColor, midFillColor, bottomFillColor) {
    const cardX = cx - cw / 2;
    const cardY = cy - ch / 2;
    const r = 8;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(cardX + r, cardY);
    ctx.lineTo(cardX + cw - r, cardY);
    ctx.quadraticCurveTo(cardX + cw, cardY, cardX + cw, cardY + r);
    ctx.lineTo(cardX + cw, cardY + ch - r);
    ctx.quadraticCurveTo(cardX + cw, cardY + ch, cardX + cw - r, cardY + ch);
    ctx.lineTo(cardX + r, cardY + ch);
    ctx.quadraticCurveTo(cardX, cardY + ch, cardX, cardY + ch - r);
    ctx.lineTo(cardX, cardY + r);
    ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
    ctx.closePath();
    // Frosted-glass body: soft white tint gradient instead of dark fill.
    const glassFill = ctx.createLinearGradient(cardX, cardY, cardX, cardY + ch);
    glassFill.addColorStop(0, fillColor || 'rgba(242, 248, 255, 0.22)');
    glassFill.addColorStop(0.5, midFillColor || 'rgba(236, 245, 255, 0.12)');
    glassFill.addColorStop(1, bottomFillColor || 'rgba(228, 238, 252, 0.08)');
    ctx.fillStyle = glassFill;
    ctx.fill();

    // Frost highlight band on upper half.
    ctx.save();
    ctx.clip();
    const sheen = ctx.createLinearGradient(cardX, cardY, cardX, cardY + ch * 0.62);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
    sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.08)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(cardX, cardY, cw, ch * 0.62);
    ctx.restore();

    // Outer + inner edge for glass-panel definition.
    ctx.strokeStyle = borderColor || 'rgba(235, 245, 255, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    const ir = Math.max(4, r - 1.5);
    const inset = 1.2;
    ctx.moveTo(cardX + inset + ir, cardY + inset);
    ctx.lineTo(cardX + cw - inset - ir, cardY + inset);
    ctx.quadraticCurveTo(cardX + cw - inset, cardY + inset, cardX + cw - inset, cardY + inset + ir);
    ctx.lineTo(cardX + cw - inset, cardY + ch - inset - ir);
    ctx.quadraticCurveTo(cardX + cw - inset, cardY + ch - inset, cardX + cw - inset - ir, cardY + ch - inset);
    ctx.lineTo(cardX + inset + ir, cardY + ch - inset);
    ctx.quadraticCurveTo(cardX + inset, cardY + ch - inset, cardX + inset, cardY + ch - inset - ir);
    ctx.lineTo(cardX + inset, cardY + inset + ir);
    ctx.quadraticCurveTo(cardX + inset, cardY + inset, cardX + inset + ir, cardY + inset);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
}

function drawCard(yTop, yBottom, alpha, widthFraction) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cardW = w * (widthFraction || 0.7);
    const cardX = (w - cardW) / 2;
    const cardY = h * yTop;
    const cardH = h * (yBottom - yTop);
    const r = 16;

    // Helper: trace the rounded rect path (in CSS-pixel coords)
    function tracePath() {
        ctx.beginPath();
        ctx.moveTo(cardX + r, cardY);
        ctx.lineTo(cardX + cardW - r, cardY);
        ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + r);
        ctx.lineTo(cardX + cardW, cardY + cardH - r);
        ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH);
        ctx.lineTo(cardX + r, cardY + cardH);
        ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - r);
        ctx.lineTo(cardX, cardY + r);
        ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
        ctx.closePath();
    }

    // 1) Blur pass: clip to card shape, redraw canvas content blurred
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to device pixels
    // Scale path coords to device pixels
    ctx.beginPath();
    ctx.moveTo((cardX + r) * dpr, cardY * dpr);
    ctx.lineTo((cardX + cardW - r) * dpr, cardY * dpr);
    ctx.quadraticCurveTo((cardX + cardW) * dpr, cardY * dpr, (cardX + cardW) * dpr, (cardY + r) * dpr);
    ctx.lineTo((cardX + cardW) * dpr, (cardY + cardH - r) * dpr);
    ctx.quadraticCurveTo((cardX + cardW) * dpr, (cardY + cardH) * dpr, (cardX + cardW - r) * dpr, (cardY + cardH) * dpr);
    ctx.lineTo((cardX + r) * dpr, (cardY + cardH) * dpr);
    ctx.quadraticCurveTo(cardX * dpr, (cardY + cardH) * dpr, cardX * dpr, (cardY + cardH - r) * dpr);
    ctx.lineTo(cardX * dpr, (cardY + r) * dpr);
    ctx.quadraticCurveTo(cardX * dpr, cardY * dpr, (cardX + r) * dpr, cardY * dpr);
    ctx.closePath();
    ctx.clip();
    ctx.filter = 'blur(16px)';
    ctx.globalAlpha = 1;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    ctx.restore();

    // 2) Tint + border
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = alpha || 0.5;
    tracePath();
    ctx.fillStyle = 'rgba(80, 10, 10, 0.35)';
    ctx.fill();
    // Subtle gold border
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

// Chinese-style ornamental frame for the single fortune card.
function drawChineseOrnamentalBorder(x, y, w, h, alpha, auraColor, stars) {
    const baseAlpha = Math.max(0, alpha || 0);
    if (baseAlpha <= 0.001) return;
    const tier = Math.max(1, Math.min(7, Number.isFinite(stars) ? Math.floor(stars) : 3));
    const tierT = (tier - 1) / 6;

    ctx.save();
    ctx.scale(dpr, dpr);

    const minSide = Math.min(w, h);
    const insetOuter = Math.max(2, minSide * 0.011);
    const insetInner = insetOuter * 2.2;
    const insetCore = insetInner + Math.max(1.2, minSide * 0.01);
    const radius = Math.max(8, minSide * 0.04);

    // Soft rarity-tinted halo; stronger at higher stars.
    ctx.globalAlpha = baseAlpha * (0.16 + tier * 0.03);
    ctx.shadowColor = auraColor || 'rgba(255, 215, 0, 0.6)';
    ctx.shadowBlur = Math.max(8, minSide * (0.055 + tier * 0.011));
    ctx.strokeStyle = auraColor || 'rgba(255, 215, 0, 0.6)';
    ctx.lineWidth = 1.2 + tier * 0.12;
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.stroke();

    // Main frame: gold outside + cinnabar inside.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = baseAlpha * 0.9;
    ctx.strokeStyle = `rgba(255, 215, 0, ${0.7 + tierT * 0.18})`;
    ctx.lineWidth = 1.05 + tier * 0.09;
    roundRectPath(
        ctx,
        x + insetOuter,
        y + insetOuter,
        w - insetOuter * 2,
        h - insetOuter * 2,
        Math.max(4, radius - insetOuter)
    );
    ctx.stroke();

    ctx.globalAlpha = baseAlpha * (0.48 + tierT * 0.2);
    ctx.strokeStyle = 'rgba(145, 22, 22, 0.9)';
    ctx.lineWidth = 0.95 + tier * 0.05;
    roundRectPath(
        ctx,
        x + insetInner,
        y + insetInner,
        w - insetInner * 2,
        h - insetInner * 2,
        Math.max(3, radius - insetInner)
    );
    ctx.stroke();

    // 3+ stars: add a third inner line to make frame denser.
    if (tier >= 3) {
        ctx.globalAlpha = baseAlpha * (0.38 + tierT * 0.18);
        ctx.strokeStyle = 'rgba(255, 225, 160, 0.7)';
        ctx.lineWidth = 0.85 + tier * 0.04;
        roundRectPath(
            ctx,
            x + insetCore,
            y + insetCore,
            w - insetCore * 2,
            h - insetCore * 2,
            Math.max(2.2, radius - insetCore)
        );
        ctx.stroke();
    }

    // Corner ornaments inspired by key-pattern motifs.
    const cornerLen = Math.max(12, minSide * (0.09 + tierT * 0.05));
    const step = cornerLen * (0.36 + tierT * 0.06);
    const edgePad = insetInner + 1.5;

    ctx.globalAlpha = baseAlpha * (0.82 + tierT * 0.15);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.lineWidth = 1.2 + tier * 0.09;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function drawCorner(ax, ay, dirX, dirY) {
        ctx.beginPath();
        ctx.moveTo(ax + dirX * cornerLen, ay);
        ctx.lineTo(ax, ay);
        ctx.lineTo(ax, ay + dirY * cornerLen);

        ctx.moveTo(ax + dirX * step, ay);
        ctx.lineTo(ax + dirX * step, ay + dirY * step);
        ctx.lineTo(ax, ay + dirY * step);

        if (tier >= 3) {
            ctx.moveTo(ax + dirX * (step * 1.75), ay);
            ctx.lineTo(ax + dirX * (step * 1.75), ay + dirY * (step * 0.55));
            ctx.lineTo(ax + dirX * (step * 1.1), ay + dirY * (step * 0.55));
        }

        if (tier >= 5) {
            const hookX = ax + dirX * (step * 2.2);
            const hookY = ay + dirY * (step * 0.78);
            ctx.moveTo(hookX, ay);
            ctx.quadraticCurveTo(hookX + dirX * (step * 0.18), hookY, hookX - dirX * (step * 0.18), hookY + dirY * (step * 0.3));
        }
        ctx.stroke();
    }

    drawCorner(x + edgePad, y + edgePad, 1, 1);
    drawCorner(x + w - edgePad, y + edgePad, -1, 1);
    drawCorner(x + edgePad, y + h - edgePad, 1, -1);
    drawCorner(x + w - edgePad, y + h - edgePad, -1, -1);

    // Top and bottom center "seal" accents.
    const centerHalf = Math.min(w * 0.12, minSide * 0.22);
    const centerGap = centerHalf * 0.24;
    const tick = Math.max(3, minSide * 0.012);
    const midX = x + w / 2;
    const topY = y + edgePad;
    const botY = y + h - edgePad;

    ctx.beginPath();
    ctx.moveTo(midX - centerHalf, topY);
    ctx.lineTo(midX - centerGap, topY);
    ctx.moveTo(midX + centerGap, topY);
    ctx.lineTo(midX + centerHalf, topY);
    ctx.moveTo(midX - centerHalf * 0.55, topY);
    ctx.lineTo(midX - centerHalf * 0.55, topY + tick);
    ctx.moveTo(midX + centerHalf * 0.55, topY);
    ctx.lineTo(midX + centerHalf * 0.55, topY + tick);

    ctx.moveTo(midX - centerHalf, botY);
    ctx.lineTo(midX - centerGap, botY);
    ctx.moveTo(midX + centerGap, botY);
    ctx.lineTo(midX + centerHalf, botY);
    ctx.moveTo(midX - centerHalf * 0.55, botY);
    ctx.lineTo(midX - centerHalf * 0.55, botY - tick);
    ctx.moveTo(midX + centerHalf * 0.55, botY);
    ctx.lineTo(midX + centerHalf * 0.55, botY - tick);
    ctx.stroke();

    // 4+ stars: side center emblems.
    if (tier >= 4) {
        const leftX = x + edgePad;
        const rightX = x + w - edgePad;
        const sideHalf = Math.min(h * 0.08, minSide * 0.12);
        const sideGap = sideHalf * 0.26;

        ctx.beginPath();
        ctx.moveTo(leftX, y + h / 2 - sideHalf);
        ctx.lineTo(leftX, y + h / 2 - sideGap);
        ctx.moveTo(leftX, y + h / 2 + sideGap);
        ctx.lineTo(leftX, y + h / 2 + sideHalf);
        ctx.moveTo(leftX, y + h / 2 - sideHalf * 0.5);
        ctx.lineTo(leftX + tick, y + h / 2 - sideHalf * 0.5);
        ctx.moveTo(leftX, y + h / 2 + sideHalf * 0.5);
        ctx.lineTo(leftX + tick, y + h / 2 + sideHalf * 0.5);

        ctx.moveTo(rightX, y + h / 2 - sideHalf);
        ctx.lineTo(rightX, y + h / 2 - sideGap);
        ctx.moveTo(rightX, y + h / 2 + sideGap);
        ctx.lineTo(rightX, y + h / 2 + sideHalf);
        ctx.moveTo(rightX, y + h / 2 - sideHalf * 0.5);
        ctx.lineTo(rightX - tick, y + h / 2 - sideHalf * 0.5);
        ctx.moveTo(rightX, y + h / 2 + sideHalf * 0.5);
        ctx.lineTo(rightX - tick, y + h / 2 + sideHalf * 0.5);
        ctx.stroke();
    }

    // 5+ stars: ruyi-cloud accents near center top/bottom.
    if (tier >= 5) {
        const cloudW = Math.min(centerHalf * 0.95, minSide * 0.16);
        const cloudDepth = Math.max(4, minSide * 0.018);
        const cloudTopY = topY + tick * 1.4;
        const cloudBotY = botY - tick * 1.4;

        ctx.globalAlpha = baseAlpha * (0.78 + (tier === 6 ? 0.14 : 0));
        ctx.beginPath();
        ctx.moveTo(midX - cloudW, cloudTopY);
        ctx.bezierCurveTo(
            midX - cloudW * 0.72, cloudTopY + cloudDepth,
            midX - cloudW * 0.28, cloudTopY + cloudDepth,
            midX, cloudTopY
        );
        ctx.bezierCurveTo(
            midX + cloudW * 0.28, cloudTopY - cloudDepth,
            midX + cloudW * 0.72, cloudTopY - cloudDepth,
            midX + cloudW, cloudTopY
        );

        ctx.moveTo(midX - cloudW, cloudBotY);
        ctx.bezierCurveTo(
            midX - cloudW * 0.72, cloudBotY - cloudDepth,
            midX - cloudW * 0.28, cloudBotY - cloudDepth,
            midX, cloudBotY
        );
        ctx.bezierCurveTo(
            midX + cloudW * 0.28, cloudBotY + cloudDepth,
            midX + cloudW * 0.72, cloudBotY + cloudDepth,
            midX + cloudW, cloudBotY
        );
        ctx.stroke();
    }

    // 6 stars: imperial pulse ring + corner seal dots.
    if (tier >= 6) {
        const pulse = 0.5 + Math.sin(globalTime * 3.4) * 0.25;
        const pulseInset = Math.max(1, insetOuter * 0.45);
        const dotR = Math.max(1.5, minSide * 0.007);

        ctx.globalAlpha = baseAlpha * (0.28 + pulse * 0.22);
        ctx.strokeStyle = 'rgba(255, 230, 150, 0.92)';
        ctx.shadowColor = auraColor || 'rgba(255, 200, 120, 0.7)';
        ctx.shadowBlur = Math.max(10, minSide * 0.1);
        ctx.lineWidth = 1.1;
        roundRectPath(
            ctx,
            x + pulseInset,
            y + pulseInset,
            w - pulseInset * 2,
            h - pulseInset * 2,
            Math.max(4, radius - pulseInset)
        );
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.globalAlpha = baseAlpha * (0.75 + pulse * 0.2);
        ctx.fillStyle = 'rgba(255, 228, 150, 0.95)';
        const dotOffset = edgePad + cornerLen * 0.72;
        const dots = [
            [x + dotOffset, y + edgePad],
            [x + w - dotOffset, y + edgePad],
            [x + dotOffset, y + h - edgePad],
            [x + w - dotOffset, y + h - edgePad],
        ];
        for (const [dx, dy] of dots) {
            ctx.beginPath();
            ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();
}

// --- Draw text overlay ---
function drawOverlayText(text, yFraction, color, alpha, size, fontOverride) {
    ctx.save();
    ctx.scale(dpr, dpr);
    const fontSize = size || Math.max(12, cellSize * 1.2);
    const font = fontOverride || '"Courier New", "SF Mono", monospace';
    ctx.font = `${fontSize}px ${font}, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color || CONFIG.glowGreen;
    ctx.globalAlpha = alpha ?? 0.6;
    ctx.shadowColor = color || CONFIG.glowGreen;
    ctx.shadowBlur = fontSize * 0.4;
    ctx.fillText(text, window.innerWidth / 2, window.innerHeight * yFraction);
    ctx.shadowBlur = 0;
    ctx.restore();
}

// --- Draw 3D text overlay (multi-pass glow + depth + highlight) ---
function drawOverlayText3D(text, yFraction, color, alpha, size, fontOverride) {
    ctx.save();
    ctx.scale(dpr, dpr);
    const fontSize = size || Math.max(12, cellSize * 1.2);
    const font = fontOverride || '"Courier New", "SF Mono", monospace';
    ctx.font = `${fontSize}px ${font}, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * yFraction;
    const baseAlpha = alpha ?? 0.6;

    // Pass 1: Wide outer glow (neon halo)
    ctx.globalAlpha = baseAlpha * 0.3;
    ctx.fillStyle = color || CONFIG.glowGreen;
    ctx.shadowColor = color || CONFIG.glowGreen;
    ctx.shadowBlur = fontSize * 1.2;
    ctx.fillText(text, cx, cy);

    // Pass 2: 3D depth shadow (dark offset behind text)
    ctx.shadowBlur = 0;
    ctx.globalAlpha = baseAlpha * 0.4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillText(text, cx + fontSize * 0.02, cy + fontSize * 0.04);

    // Pass 3: Main fill with medium glow
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = color || CONFIG.glowGreen;
    ctx.shadowColor = color || CONFIG.glowGreen;
    ctx.shadowBlur = fontSize * 0.5;
    ctx.fillText(text, cx, cy);

    // Pass 4: Bright highlight (specular, shifted up-left)
    ctx.shadowBlur = 0;
    ctx.globalAlpha = baseAlpha * 0.25;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, cx - fontSize * 0.01, cy - fontSize * 0.02);

    ctx.shadowBlur = 0;
    ctx.restore();
}

// Render Three.js particles and composite onto the Canvas 2D
function renderAndCompositeGL() {
    if (!glRenderer || !glScene || !glCamera) return;

    // Update post-processing parameters
    ppBloomStrength += (ppBloomTarget - ppBloomStrength) * 0.12;
    if (bloomPass) bloomPass.strength = ppBloomStrength;

    // Chromatic aberration decay
    ppChromatic *= 0.92;
    if (chromaticPass) {
        chromaticPass.enabled = ppChromatic > 0.0005;
        chromaticPass.uniforms.strength.value = ppChromatic;
    }

    // Shockwave update
    if (shockwavePass) {
        let best = null;
        for (let i = ppShockwaves.length - 1; i >= 0; i--) {
            const sw = ppShockwaves[i];
            const age = globalTime - sw.startTime;
            if (age > sw.duration) { ppShockwaves.splice(i, 1); continue; }
            if (!best || age < (globalTime - best.startTime)) best = sw;
        }
        if (best) {
            const age = globalTime - best.startTime;
            const t = age / best.duration;
            const eased = 1 - Math.pow(1 - t, 2);
            shockwavePass.uniforms.shockCenter.value.set(best.cx, best.cy);
            shockwavePass.uniforms.shockRadius.value = eased * best.maxRadius;
            shockwavePass.uniforms.shockStrength.value = best.strength * (1 - t);
            shockwavePass.enabled = true;
        } else {
            shockwavePass.enabled = false;
        }
    }

    if (composer) {
        composer.render();
    } else {
        glRenderer.render(glScene, glCamera);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glRenderer.domElement, 0, 0);
    ctx.restore();
}

// Updates GPU buffers for generic particle list
function updateProjectedGlyphsToGPU(glyphs, skipRender) {
    if (!particlesMesh) return 0;
    if (!glyphs.length) {
        particlesMesh.count = 0;
        if (!skipRender) renderAndCompositeGL();
        return 0;
    }

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;

    const maxCount = particlesMesh.geometry.getAttribute('instanceColor').count;
    const count = Math.min(glyphs.length, maxCount);

    for (let i = 0; i < count; i++) {
        const g = glyphs[i];

        _dummy.position.set(g.x, -g.y, -g.z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(i, _dummy.matrix);

        instColor.setXYZ(i, g.r / 255, g.g / 255, g.b / 255);
        instAlpha.setX(i, g.alpha);

        const uv = (g.fontIdx != null && charToUV[g.char + '|' + g.fontIdx]) || charToUV[g.char];
        if (uv) instUV.setXY(i, uv.u, uv.v);

        instScale.setX(i, cellSize * (g.size || 1));
    }

    particlesMesh.count = count;
    particlesMesh.instanceMatrix.needsUpdate = true;
    instColor.needsUpdate = true;
    instAlpha.needsUpdate = true;
    instUV.needsUpdate = true;
    instScale.needsUpdate = true;

    if (!skipRender) renderAndCompositeGL();
    return count;
}

// ============================================================
// STATE MACHINE
// ============================================================
let state = 'arrival';
let isOverlayActive = true;
let stateTime = 0;
let globalTime = 0;
let stateStartGlobal = 0;
let drawToFortuneSeed = null;
let fortuneUseDrawMorph = false;
let pendingInstSwitchTimer = null;
const VOCAL_HOLD_AFTER_FORTUNE_MS = 2000;
const VOCAL_HOLD_AFTER_MULTI_FORTUNE_MS = 2000;

function changeState(newState) {
    if (pendingInstSwitchTimer) {
        clearTimeout(pendingInstSwitchTimer);
        pendingInstSwitchTimer = null;
    }

    state = newState;
    stateStartGlobal = globalTime;
    stateTime = 0;

    if (newState === 'draw') {
        playSfxDraw();
        initDrawAnimation();
        switchToVocal();
        // Restart arrival flames during draw
        arrivalParticles = [];
        arrivalSpawnCarry = 0;
        arrivalLastT = globalTime;
        flamesActive = true;
    }
    if (newState === 'fortune') {
        const holdMs = isMultiMode ? VOCAL_HOLD_AFTER_MULTI_FORTUNE_MS : VOCAL_HOLD_AFTER_FORTUNE_MS;
        pendingInstSwitchTimer = setTimeout(() => {
            pendingInstSwitchTimer = null;
            if (state === 'fortune') switchToInst();
        }, holdMs);
        if (isMultiMode) {
            // Multi-mode: seed particles from morph (seamless transition)
            buildMultiDajiFromMorph();
            drawToFortuneSeed = null;
            multiFlipState = null;
            initMultiFortuneState();
            // Reset camera to center for fortune phase
            camTarget.scale = 1.0;
            cam.focusX = window.innerWidth / 2;
            cam.focusY = window.innerHeight / 2;
            godRayAlpha = 0;
            meteorParticles = [];
            // Clear fireworks
            fwShells.length = 0;
            fwTrail.length = 0;
            fwParticles.length = 0;
            fwLaunchTimer = 99999;
            fwLaunchCount = 0;
        } else {
            if (currentDrawResult) playSfxReveal(currentDrawResult.rarity.stars);
            if (fortuneUseDrawMorph) {
                // Keep using morphParticles directly; avoid rebuilding into a new cluster.
                daji3DParticles = [];
                hoveredIdx = -1;
                hideTooltip();
                drawToFortuneSeed = null;
            } else if (drawToFortuneSeed && drawToFortuneSeed.length > 0) {
                initDaji3D(drawToFortuneSeed);
                drawToFortuneSeed = null;
            } else {
                initDaji3D();
            }
            // Only launch fireworks for 4+ star draws
            if (currentDrawResult && currentDrawResult.rarity.stars >= 4) {
                initFireworks();
            } else {
                // Clear any leftover firework state
                fwShells.length = 0;
                fwTrail.length = 0;
                fwParticles.length = 0;
                fwLaunchTimer = 99999;
                fwLaunchCount = 0;
            }
        }
        // Reset font transition for new fortune display
        dajiFontTransition = null;
        dajiFontAutoTimer = globalTime;
    }

    // Share button visibility
    if (newState === 'fortune') {
        setCurrentDrawResult(currentDrawResult);
        if (isMultiMode) {
            hideSingleFortuneActions();
            hideMultiShareButton();
        } else {
            showSingleFortuneActions();
            hideMultiShareButton();
        }
    } else {
        hideSingleFortuneActions();
        hideMultiShareButton();
    }

    updateUIVisibility();
}

// ============================================================
// ARRIVAL
// ============================================================
let arrivalParticles = [];
let arrivalSpawnCarry = 0;
let arrivalLastT = 0;
let flamesActive = false;

// Calm, cohesive "ember" glyphs behind the start overlay (welcome screen).
const ARRIVAL_FLAMES = {
    // Target particles per second (time-based), clamped by maxParticles.
    // Higher rate + shorter life => denser, flame-like plume from the bottom.
    spawnRate: IS_COARSE_POINTER ? 40 : 50,
    maxParticles: IS_COARSE_POINTER ? 500 : 650,
    // Spawn region (world coords where origin is screen center)
    xSpreadFrac: 0.95,      // fraction of screen width (spread across entire bottom)
    yStartPad: 22,          // px below bottom edge
    yStartJitter: 46,       // px additional random depth below bottom edge
    zSpread: 140,           // px depth variation
    // Motion (px/sec)
    riseMin: 80,
    riseMax: 180,
    buoyancy: 18,           // px/sec^2 upward accel (gentle lift)
    riseClamp: 300,         // max |vy| to avoid absurd speeds on long frames
    // Lateral drift is driven by a shared wind field for coherence.
    windAmpMin: 12,
    windAmpMax: 50,
    windFreq: 0.95,         // radians/sec multiplier (more turbulent)
    centerPull: 0.08,       // 1/sec, pulls vx back toward x=0 so plume stays coherent
    velDragMin: 2.8,        // 1/sec (higher = follows wind quicker)
    velDragMax: 5.0,
    // Lifetime (sec) — shorter for faster fade
    lifeMin: 1.4,
    lifeMax: 1.7,
    // Visuals
    alphaMul: 0.62,         // overall opacity (additive blending gets bright fast)
    flickerFreq: 5.0,
    flickerAmp: 0.10,
    sparkFrac: 0.12,        // fraction of particles that are tiny hot sparks ('·')
    // Keep the effect in the lower/middle of the screen; no need to reach the top.
    topFadeStart: 0.38,     // h01 where fade begins (0 bottom, 1 top) — fades sooner
    topFadeEnd: 0.65,       // h01 where fade ends — fades out quicker
};

const ARRIVAL_FLAME_CHARS = ['福', '吉', '安', '喜', '财', '禄', '寿'];

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function updateArrivalFlames() {
    // Time-based update for consistent motion across refresh rates.
    const dt = Math.min(
        0.05,
        Math.max(0.001, (globalTime - (arrivalLastT || globalTime - 1 / 60)))
    );
    arrivalLastT = globalTime;

    // Spawn new particles (overlay or draw/fortune flames)
    if (isOverlayActive || flamesActive) {
        // Small emitter breathing; keep subtle so motion reads as "fire" not bursts.
        const rateFlicker = 0.92 + 0.12 * (0.5 + 0.5 * Math.sin(globalTime * 2.0));
        arrivalSpawnCarry += (ARRIVAL_FLAMES.spawnRate * rateFlicker) * dt;
        let spawnCount = Math.floor(arrivalSpawnCarry);
        arrivalSpawnCarry -= spawnCount;

        // Safety: don't let long stalls dump a huge burst.
        spawnCount = Math.min(spawnCount, 8);

        const bottomY = window.innerHeight / 2;

        for (let i = 0; i < spawnCount; i++) {
            if (arrivalParticles.length >= ARRIVAL_FLAMES.maxParticles) break;

            // Spread uniformly across the bottom of the screen.
            const xAmp = window.innerWidth * ARRIVAL_FLAMES.xSpreadFrac * 0.5;
            const x = (Math.random() * 2 - 1) * xAmp;
            const y = bottomY + ARRIVAL_FLAMES.yStartPad + Math.random() * ARRIVAL_FLAMES.yStartJitter; // Start below screen

            // Two populations: flame glyphs + tiny hot sparks. Both are still characters.
            const spark = Math.random() < ARRIVAL_FLAMES.sparkFrac;

            // Size: large particles so characters are easily readable.
            const size = spark
                ? cellSize * (1.0 + Math.random() * 1.2)
                : cellSize * (2.2 + Math.random() * Math.random() * 3.5);

            // Narrower life variance so all particles fade at similar times.
            const lifeScale = spark ? (0.75 + Math.random() * 0.20) : (0.90 + Math.random() * 0.10);
            const lifeSec = (ARRIVAL_FLAMES.lifeMin + Math.random() * (ARRIVAL_FLAMES.lifeMax - ARRIVAL_FLAMES.lifeMin)) * lifeScale;

            // Gentle rise so characters stay readable.
            const riseBase = ARRIVAL_FLAMES.riseMin + Math.random() * (ARRIVAL_FLAMES.riseMax - ARRIVAL_FLAMES.riseMin);
            const riseMul = spark ? (0.8 + Math.random() * 0.4) : (0.7 + Math.random() * 0.3);
            const vy = -Math.min(ARRIVAL_FLAMES.riseClamp, riseBase * riseMul);

            // Sparks follow wind less; flames sway more.
            const windAmp = spark
                ? ARRIVAL_FLAMES.windAmpMin * (0.20 + Math.random() * 0.55)
                : ARRIVAL_FLAMES.windAmpMin + Math.random() * (ARRIVAL_FLAMES.windAmpMax - ARRIVAL_FLAMES.windAmpMin);

            const drag = spark
                ? ARRIVAL_FLAMES.velDragMax * (1.1 + Math.random() * 1.1)
                : ARRIVAL_FLAMES.velDragMin + Math.random() * (ARRIVAL_FLAMES.velDragMax - ARRIVAL_FLAMES.velDragMin);

            // Keep base hue fairly consistent; avoid visible "color banding" at the bottom.
            const heat0 = spark ? (1.00 + Math.random() * 0.12) : (0.88 + Math.random() * 0.12);
            
            arrivalParticles.push({
                x: x,
                y: y,
                z: (Math.random() - 0.5) * ARRIVAL_FLAMES.zSpread,
                vx: 0,
                vy,
                life: 1.0,
                decay: 1 / Math.max(0.001, lifeSec), // per-second decay (life: 1 → 0)
                size: size,
                char: spark ? '\u00B7' : ARRIVAL_FLAME_CHARS[Math.floor(Math.random() * ARRIVAL_FLAME_CHARS.length)],
                fontIdx: Math.floor(Math.random() * CALLI_FONTS.length),
                heat0,
                phase: Math.random() * Math.PI * 2,
                windAmp,
                drag,
                spark: spark ? 1 : 0,
            });
        }
    }

    // Update physics — hoist shared multiplications out of the loop
    const wf = globalTime * ARRIVAL_FLAMES.windFreq;
    const wf063 = globalTime * (ARRIVAL_FLAMES.windFreq * 0.63);
    const wf24 = globalTime * (ARRIVAL_FLAMES.windFreq * 2.4);
    const centerPull = ARRIVAL_FLAMES.centerPull;
    const buoyancy = ARRIVAL_FLAMES.buoyancy;
    const buoyancyDt = buoyancy * dt;
    const riseClamp = -ARRIVAL_FLAMES.riseClamp;

    let alive = 0;
    for (let i = 0; i < arrivalParticles.length; i++) {
        const p = arrivalParticles[i];
        p.life -= p.decay * dt;
        if (p.life <= 0) continue;

        const heat = Math.max(0, Math.min(1, p.life * (p.heat0 || 1)));

        // Coherent wind field: smooth, shared motion (less chaotic than per-particle jitter).
        const heatWind = p.windAmp * (0.55 + 0.45 * heat);
        const windBase =
            Math.sin(wf + p.phase + p.y * 0.003) * heatWind +
            Math.sin(wf063 + p.phase * 1.7) * (heatWind * 0.35);
        const windCrackle =
            Math.sin(wf24 + p.phase * 2.1 + p.y * 0.007) * (heatWind * 0.12) * (0.4 + 0.6 * heat);

        // Keep the plume coherent by gently pulling velocity back to center.
        const windTarget = (windBase + windCrackle) - p.x * centerPull;

        // Exponential approach to the wind target velocity (damped).
        const follow = 1 - Math.exp(-p.drag * dt);
        p.vx += (windTarget - p.vx) * follow;

        // Slight upward acceleration to feel more like flame lift (buoyancy).
        if (buoyancyDt > 0) {
            p.vy -= buoyancyDt * (0.35 + 0.65 * heat);
            if (p.vy < riseClamp) p.vy = riseClamp;
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        arrivalParticles[alive++] = p;
    }
    arrivalParticles.length = alive;
}

function appendArrivalFlamesToGPU(startIdx) {
    if (!particlesMesh) return startIdx;

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;
    const maxCount = instColor.count;

    // Direct typed array access — avoids per-call overhead of setXYZ/setX/setXY
    const colorArr = instColor.array;
    const alphaArr = instAlpha.array;
    const uvArr = instUV.array;
    const scaleArr = instScale.array;
    const matArr = particlesMesh.instanceMatrix.array;

    // Hoist shared per-frame values out of the loop
    const bottomY = window.innerHeight * 0.5;
    const invHeight = 1 / Math.max(1, window.innerHeight);
    const flickBase = globalTime * ARRIVAL_FLAMES.flickerFreq;
    const flickBase17 = globalTime * (ARRIVAL_FLAMES.flickerFreq * 1.7);
    const flickAmp = ARRIVAL_FLAMES.flickerAmp;
    const flickAmp035 = flickAmp * 0.35;
    const alphaMul = ARRIVAL_FLAMES.alphaMul;
    const topFadeStart = ARRIVAL_FLAMES.topFadeStart;
    const topFadeEnd = ARRIVAL_FLAMES.topFadeEnd;

    let idx = startIdx;

    for (const p of arrivalParticles) {
        if (idx >= maxCount) break;

        // Flicker effect
        const age = 1 - p.life;
        const heat = Math.max(0, Math.min(1, p.life * (p.heat0 || 1)));

        // Height within the screen (0 = bottom edge, 1 = top edge)
        const h01 = Math.max(0, Math.min(1.2, (bottomY - p.y) * invHeight));
        const core = 1 - smoothstep(0.00, 0.22, h01);

        const fadeIn = smoothstep(0.00, 0.08, age);
        const fadeOut = smoothstep(0.00, 0.30, p.life);
        const topFade = 1 - smoothstep(topFadeStart, topFadeEnd, h01);

        let flicker =
            0.84 +
            Math.sin(flickBase + p.phase) * flickAmp +
            Math.sin(flickBase17 + p.phase * 2.3) * flickAmp035;
        if (flicker < 0.35) flicker = 0.35;
        else if (flicker > 1.25) flicker = 1.25;

        // Hotter and brighter at the base, cooling as it rises.
        const alpha = fadeIn * fadeOut * topFade * flicker * alphaMul * (0.75 + core * 0.55) * (0.72 + heat * 0.55);

        // Skip fully transparent particles — no GPU work needed
        if (alpha < 0.01) continue;

        // Scale: keep particles large and stable so glyphs stay readable.
        const swell = 0.85 + Math.sin(Math.min(1, age) * Math.PI) * 0.20;
        const scale = p.size * swell * (0.90 + heat * 0.15);

        // Write matrix directly (translation-only, identity rotation/scale in matrix)
        // InstancedMesh matrix is column-major 4x4: [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, tx,ty,tz,1]
        const mi = idx * 16;
        matArr[mi]     = 1; matArr[mi+1]  = 0; matArr[mi+2]  = 0; matArr[mi+3]  = 0;
        matArr[mi+4]   = 0; matArr[mi+5]  = 1; matArr[mi+6]  = 0; matArr[mi+7]  = 0;
        matArr[mi+8]   = 0; matArr[mi+9]  = 0; matArr[mi+10] = 1; matArr[mi+11] = 0;
        matArr[mi+12]  = p.x; matArr[mi+13] = -p.y; matArr[mi+14] = -p.z; matArr[mi+15] = 1;

        // Heat-based flame tint
        const cool = 1 - heat;
        let rr, gg, bb;
        if (cool < 0.40) {
            const t = cool / 0.40;
            rr = 255;
            gg = lerp(205, 150, t);
            bb = lerp(80, 35, t);
        } else if (cool < 0.82) {
            const t = (cool - 0.40) / 0.42;
            rr = 255;
            gg = lerp(150, 75, t);
            bb = lerp(35, 10, t);
        } else {
            const t = (cool - 0.82) / 0.18;
            rr = lerp(255, 140, t);
            gg = lerp(75, 22, t);
            bb = lerp(10, 8, t);
        }

        // Tiny sparks run hotter (slightly whiter).
        if (p.spark) {
            rr = lerp(rr, 255, 0.20);
            gg = lerp(gg, 250, 0.20);
            bb = lerp(bb, 230, 0.15);
        }

        const ci = idx * 3;
        colorArr[ci]     = rr / 255;
        colorArr[ci + 1] = gg / 255;
        colorArr[ci + 2] = bb / 255;
        alphaArr[idx] = alpha;
        scaleArr[idx] = scale;

        const uv = (p.fontIdx != null && charToUV[p.char + '|' + p.fontIdx]) || charToUV[p.char];
        if (uv) {
            const ui = idx * 2;
            uvArr[ui]     = uv.u;
            uvArr[ui + 1] = uv.v;
        }

        idx++;
    }

    // We don't commit here; we return index so fireworks can append after us
    return idx;
}

function updateArrival() {
    updateBgParticles(globalTime);
    updateArrivalFlames();
    // Update tap-triggered firework particles
    if (hasTapFireworks()) updateFireworkPhysics();
}

function renderArrivalOverlay() {
    // 1. Render WebGL Particles (Flames + Fireworks)
    let gpuIdx = 0;
    
    // Append Flames
    gpuIdx = appendArrivalFlamesToGPU(gpuIdx);
    
    // Append Fireworks (if any) and Render
    if (hasTapFireworks()) {
        appendFireworksToGPU(gpuIdx); // This calls renderAndCompositeGL
    } else {
        // Manually update and render if no fireworks
        if (particlesMesh) {
            particlesMesh.count = gpuIdx;
            particlesMesh.instanceMatrix.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceColor.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceUV.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceScale.needsUpdate = true;
        }
        renderAndCompositeGL();
    }

    if (isOverlayActive) return;

    const fadeIn = Math.min(1, stateTime / 1.0);
    const L = getLayout();
    drawCalligraphyFu(fadeIn);

    const textFade = Math.min(1, stateTime / 1.5);
    const titleSize = isLandscape() ? Math.min(cellSize * 2, window.innerHeight * 0.04) : cellSize * 2;
    drawOverlayText('\u65B0\u5E74\u7EB3\u798F', L.arrivalTitleY, CONFIG.glowGold, textFade * 0.8, titleSize);
    drawOverlayText('A Blessing Awaits', L.arrivalSubY, CONFIG.glowGold, textFade * 0.8, titleSize);

    const hintFade = Math.min(1, Math.max(0, (stateTime - 1.5) / 0.5));
    const pulse = 0.4 + Math.sin(globalTime * 3) * 0.2;
    const hopOffset = getSwipeHintHopOffset();

    // Dynamic text based on mode
    const { mainText, subText } = getSwipeHintText(selectedMode === 'multi');
    const { hintSize, hintSubSize } = getSwipeHintSizes();
    drawOverlayText(mainText, L.arrivalHintY + hopOffset, CONFIG.glowGold, hintFade * pulse, hintSize);
    drawOverlayText(subText, L.arrivalHintSubY + hopOffset, CONFIG.glowGold, hintFade * pulse, hintSubSize);
}

// ============================================================
// DRAW
// ============================================================
let morphParticles = [];
let launchTrail = [];
let burstFlash = 0;
let fuEndScreenPositions = []; // screen-coord positions where each 福 ends up before exploding
let drawBurstTriggered = false;

// --- Cinematic Camera System ---
const cam = { x: 0, y: 0, scale: 1, shake: 0, focusX: 0, focusY: 0 };
let camTarget = { x: 0, y: 0, scale: 1 };

function updateCam() {
    cam.x += (camTarget.x - cam.x) * 0.08;
    cam.y += (camTarget.y - cam.y) * 0.08;
    cam.scale += (camTarget.scale - cam.scale) * 0.06;
    // Decay shake
    cam.shake *= 0.88;
}

function applyCamToCanvas() {
    const sx = cam.shake > 0.3 ? (Math.random() - 0.5) * cam.shake : 0;
    const sy = cam.shake > 0.3 ? (Math.random() - 0.5) * cam.shake : 0;
    // Use CSS transform for uniform camera on both 2D + GL
    const tx = cam.x + sx;
    const ty = cam.y + sy;
    if (cam.scale !== 1 || tx !== 0 || ty !== 0) {
        canvas.style.transformOrigin = `${cam.focusX}px ${cam.focusY}px`;
        canvas.style.transform = `scale(${cam.scale}) translate(${tx}px, ${ty}px)`;
    } else {
        canvas.style.transform = '';
    }
}

function resetCam() {
    camTarget.x = 0; camTarget.y = 0; camTarget.scale = 1;
    cam.x = 0; cam.y = 0; cam.scale = 1; cam.shake = 0;
    cam.focusX = 0; cam.focusY = 0;
}

function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

// --- Speed Lines (radial during draw LAUNCH) ---
function renderSpeedLines() {
    if (!isMultiMode || bestStarsInBatch < 4) return;
    const t = stateTime;
    if (t > DRAW_SCATTER + 0.5) return;

    const w = window.innerWidth, h = window.innerHeight;
    const cx = w / 2, cy = h * 0.4;

    ctx.save();
    ctx.scale(dpr, dpr);

    const count = bestStarsInBatch >= 6 ? 28 : bestStarsInBatch >= 5 ? 20 : 12;
    const baseAlpha = bestStarsInBatch >= 6 ? 0.07 : bestStarsInBatch >= 5 ? 0.05 : 0.035;
    const colors = getMeteorColor(bestStarsInBatch);

    const fadeIn = Math.min(1, t / 0.3);
    const fadeOut = t > DRAW_LAUNCH ? Math.max(0, 1 - (t - DRAW_LAUNCH) / 0.5) : 1;

    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + globalTime * 0.05;
        const innerR = 40 + Math.sin(i * 1.7 + globalTime * 2) * 15;
        const outerR = Math.max(w, h) * 0.9;
        const halfAng = (0.003 + Math.random() * 0.004);

        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle - halfAng) * outerR, cy + Math.sin(angle - halfAng) * outerR);
        ctx.lineTo(cx + Math.cos(angle + halfAng) * outerR, cy + Math.sin(angle + halfAng) * outerR);
        ctx.closePath();

        const flicker = 0.5 + Math.sin(i * 2.3 + globalTime * 3) * 0.5;
        ctx.globalAlpha = baseAlpha * flicker * fadeIn * fadeOut;
        ctx.fillStyle = colors.head;
        ctx.fill();
    }

    ctx.restore();
}

// --- Meteor Shower (rarity color tell) ---
let meteorParticles = [];
let bestStarsInBatch = 0; // Highest rarity in multi draw

// --- God Rays ---
let godRayAlpha = 0;
let godRayColor = '#FFD700';

// Rarity → meteor color mapping (same language as Genshin/HSR)
function getMeteorColor(stars) {
    if (stars >= 6) return { head: '#FFD700', trail: '#FF4500', glow: 'rgba(255,69,0,0.6)' };
    if (stars >= 5) return { head: '#D8A0FF', trail: '#A855F7', glow: 'rgba(168,85,247,0.5)' };
    if (stars >= 4) return { head: '#7BB8FF', trail: '#3B82F6', glow: 'rgba(59,130,246,0.4)' };
    return { head: '#FFFFFF', trail: '#94A3B8', glow: 'rgba(200,200,200,0.3)' };
}

function spawnMeteors() {
    const w = window.innerWidth, h = window.innerHeight;
    const colors = getMeteorColor(bestStarsInBatch);
    const count = bestStarsInBatch >= 6 ? 6 : bestStarsInBatch >= 5 ? 4 : 2;
    for (let i = 0; i < count; i++) {
        const delay = i * 0.15 + Math.random() * 0.1;
        const startX = w * (0.3 + Math.random() * 0.5);
        const startY = -20 - Math.random() * 60;
        // Shoot diagonally across screen
        const angle = Math.PI * 0.55 + (Math.random() - 0.5) * 0.35;
        const speed = 8 + Math.random() * 6;
        meteorParticles.push({
            x: startX, y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1, decay: 0.008 + Math.random() * 0.004,
            size: 3 + Math.random() * 3,
            trail: [], maxTrail: 25 + Math.floor(Math.random() * 15),
            delay, age: 0,
            colors,
        });
    }
}

function updateAndRenderMeteors() {
    if (!meteorParticles.length) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    let alive = 0;
    for (let i = 0; i < meteorParticles.length; i++) {
        const m = meteorParticles[i];
        m.age += 0.016;
        if (m.age < m.delay) { meteorParticles[alive++] = m; continue; }

        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > m.maxTrail) m.trail.shift();
        m.x += m.vx;
        m.y += m.vy;
        m.vy += 0.06; // slight gravity arc
        m.life -= m.decay;
        if (m.life <= 0) continue;

        // Trail
        for (let j = 0; j < m.trail.length; j++) {
            const t = j / m.trail.length;
            const pt = m.trail[j];
            ctx.globalAlpha = t * m.life * 0.6;
            ctx.fillStyle = m.colors.trail;
            ctx.shadowColor = m.colors.glow;
            ctx.shadowBlur = 6 * t;
            const s = m.size * t * 0.7;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, s, 0, Math.PI * 2);
            ctx.fill();
        }

        // Head (bright)
        ctx.globalAlpha = m.life;
        ctx.fillStyle = m.colors.head;
        ctx.shadowColor = m.colors.head;
        ctx.shadowBlur = m.size * 5;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
        ctx.fill();
        // Extra glow pass
        ctx.globalAlpha = m.life * 0.5;
        ctx.shadowBlur = m.size * 12;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * 0.5, 0, Math.PI * 2);
        ctx.fill();

        meteorParticles[alive++] = m;
    }
    meteorParticles.length = alive;

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

function renderGodRays(cx, cy) {
    if (godRayAlpha <= 0.01) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    const rayCount = 12;
    const maxLen = Math.max(window.innerWidth, window.innerHeight) * 0.8;
    const rotSpeed = globalTime * 0.15;

    for (let i = 0; i < rayCount; i++) {
        const angle = (Math.PI * 2 * i) / rayCount + rotSpeed;
        const wobble = Math.sin(globalTime * 2.5 + i * 1.7) * 0.04;
        const halfWidth = 0.06 + Math.sin(globalTime * 1.8 + i * 2.3) * 0.025;
        const a1 = angle + wobble - halfWidth;
        const a2 = angle + wobble + halfWidth;
        const rayAlpha = godRayAlpha * (0.4 + Math.sin(globalTime * 3 + i) * 0.15);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxLen);
        grad.addColorStop(0, godRayColor);
        grad.addColorStop(0.3, godRayColor);
        grad.addColorStop(1, 'transparent');

        ctx.globalAlpha = rayAlpha;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a1) * maxLen, cy + Math.sin(a1) * maxLen);
        ctx.lineTo(cx + Math.cos(a2) * maxLen, cy + Math.sin(a2) * maxLen);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

const DRAW_LAUNCH = CONFIG.fuExplodeDelay;
const DRAW_RISE = CONFIG.fuRiseDuration;
const DRAW_SHRINK = CONFIG.fuShrinkDuration;
const DRAW_SHRINK_END_SCALE = CONFIG.fuShrinkEndScale;
const DRAW_CAMERA_PULLBACK = CONFIG.fuCameraPullbackDuration;
const DRAW_CAMERA_RETURN = CONFIG.fuCameraReturnDuration;
const DRAW_SCATTER = DRAW_LAUNCH + 1.2;
const DRAW_REFORM = DRAW_SCATTER + 1.1;
const DRAW_SETTLE = DRAW_REFORM + 0.4;
const DRAW_TO_FORTUNE_DELAY = 0.3;
// Desktop uses fewer, subtler particles; mobile keeps current density.
const SINGLE_DRAW_PARTICLE_MAX_COUNT_MOBILE = 600;
const SINGLE_DRAW_PARTICLE_MAX_COUNT_DESKTOP = 140;
const SINGLE_DRAW_PARTICLE_KEEP_BASE = 0.36;
const SINGLE_DRAW_PARTICLE_KEEP_BRIGHTNESS_BIAS = 0.26;
const SINGLE_DRAW_PARTICLE_CORE_BRIGHTNESS = 0.84;

function pseudoRandom01(seed) {
    let x = seed | 0;
    x ^= x >>> 13;
    x = Math.imul(x, 1274126177);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967295;
}

function filterSingleDrawShapePoints(shape, drawIdx) {
    if (!Array.isArray(shape) || shape.length === 0) return shape;
    const maxCount = isLandscape() ? SINGLE_DRAW_PARTICLE_MAX_COUNT_DESKTOP : SINGLE_DRAW_PARTICLE_MAX_COUNT_MOBILE;
    const filtered = [];
    for (let i = 0; i < shape.length; i++) {
        const pt = shape[i];
        if (pt.brightness >= SINGLE_DRAW_PARTICLE_CORE_BRIGHTNESS) {
            filtered.push(pt);
            continue;
        }
        const keepThreshold = Math.min(1, SINGLE_DRAW_PARTICLE_KEEP_BASE + pt.brightness * SINGLE_DRAW_PARTICLE_KEEP_BRIGHTNESS_BIAS);
        const seed = Math.imul(drawIdx + 1, 73856093) ^ Math.imul(i + 1, 19349663);
        if (pseudoRandom01(seed) <= keepThreshold) filtered.push(pt);
    }
    const source = filtered.length > 0 ? filtered : shape;
    if (source.length <= maxCount) return source;

    // Keep global shape coverage by selecting one candidate per contiguous segment.
    const capped = [];
    const stride = source.length / maxCount;
    for (let seg = 0; seg < maxCount; seg++) {
        const segStart = Math.floor(seg * stride);
        const nextStart = Math.floor((seg + 1) * stride);
        const segEnd = Math.min(source.length - 1, Math.max(segStart, nextStart - 1));

        let bestIdx = segStart;
        let bestScore = -1;
        for (let i = segStart; i <= segEnd; i++) {
            const jitterSeed = Math.imul(drawIdx + 1, 1597334677) ^ Math.imul(i + 1, 3812015801);
            const jitter = pseudoRandom01(jitterSeed);
            const score = source[i].brightness * 0.8 + jitter * 0.2;
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        capped.push(source[bestIdx]);
    }
    return capped;
}

function initDrawAnimation() {
    morphParticles = [];
    launchTrail = [];
    burstFlash = 0;
    drawBurstTriggered = false;
    fortuneUseDrawMorph = false;
    fuEndScreenPositions = [];
    drawToFortuneSeed = null;
    meteorParticles = [];
    godRayAlpha = 0;
    resetCam();
    if (!fontsReady) return;

    // Multi-pull: set god ray color (meteors disabled)
    if (isMultiMode && bestStarsInBatch >= 4) {
        const mc = getMeteorColor(bestStarsInBatch);
        godRayColor = mc.trail;
    }

    let drawsToAnimate = [];

    // Perform the gacha draw (or use pre-set multi draw result)
    if (!isMultiMode) {
        const pity = getPityCounter();
        currentDrawResult = performDrawWithPity(pity);
        saveToCollection(currentDrawResult);
        if (currentDrawResult.tierIndex <= 2) {
            resetPity().catch(() => {});
        } else {
            incrementPity().catch(() => {});
        }
        drawsToAnimate = [currentDrawResult];
    } else {
        drawsToAnimate = multiDrawResults;
    }

    // Grid layout configuration for 10x (responsive: 5×2)
    const grid = getMultiGridLayout();
    const multiCols = grid.multiCols;
    const multiRows = grid.multiRows;
    const scaleFactor = isMultiMode ? grid.scaleFactor : 1.0;

    const startX = grid.startX;
    const startY = grid.startY;
    const stepX = grid.stepX;
    const stepY = grid.stepY;

    // Pre-compute where each 福 ends up (screen coords) before exploding
    // For stick cards, offset upward so particles form at the character text position.
    const _stickLayout = grid.cardH > grid.cardW * 2.5;
    const _charYOff = _stickLayout ? grid.cardH * 0.18 : grid.cardH * 0.02;
    drawsToAnimate.forEach((drawRes, idx) => {
        if (isMultiMode) {
            const c = idx % multiCols;
            const r = Math.floor(idx / multiCols);
            fuEndScreenPositions.push({ x: startX + c * stepX, y: (startY + r * stepY) - _charYOff });
        } else {
            fuEndScreenPositions.push({ x: window.innerWidth / 2, y: window.innerHeight * 0.20 });
        }
    });

    drawsToAnimate.forEach((drawRes, idx) => {
        // 1. Target center = where the reformed character forms (world coords, 0,0 = screen center)
        let targetCenterX = 0;
        let targetCenterY = 0;

        if (isMultiMode) {
            targetCenterX = fuEndScreenPositions[idx].x - window.innerWidth / 2;
            targetCenterY = fuEndScreenPositions[idx].y - window.innerHeight / 2;
        } else {
            // Offset cluster upward to match fortune layout position
            const yOff = (getLayout().clusterYOffset || 0) * window.innerHeight;
            targetCenterY = -yOff;
        }

        // 2. Sample shape — proportionally scaled with cluster size
        const res = isMultiMode ? Math.round(50 * scaleFactor) : 50;
        const sampledShape = sampleCharacterShape(drawRes.char, res);
        const shape = isMultiMode ? sampledShape : filterSingleDrawShapePoints(sampledShape, idx);

        const spread = getClusterSpread() * scaleFactor;
        const depth = spread * 0.4;
        
        const drawTargets = shape.map(pt => ({
            x: pt.nx * spread * 0.5 * pt.aspect + targetCenterX,
            y: pt.ny * spread * 0.5 + targetCenterY,
            z: (Math.random() - 0.5) * depth,
            brightness: pt.brightness,
        }));

        for (let i = 0; i < drawTargets.length; i++) {
            const tgt = drawTargets[i];
            const angle = Math.random() * Math.PI * 2;
            const scatterRadius = spread * (0.8 + Math.random() * 1.2);


            // Scatter center = where the 福 explodes (screen coords → world coords)
            const fuEnd = fuEndScreenPositions[idx];
            const scatterOriginX = fuEnd.x - window.innerWidth / 2;
            const scatterOriginY = fuEnd.y - window.innerHeight / 2;

            morphParticles.push({
                x: scatterOriginX, // Initial burst pos
                y: scatterOriginY,
                z: 0,
                startX: scatterOriginX,
                startY: scatterOriginY,
                startZ: 0,
                scatterX: scatterOriginX + Math.cos(angle) * scatterRadius,
                scatterY: scatterOriginY + Math.sin(angle) * scatterRadius,
                scatterZ: (Math.random() - 0.5) * depth * 1.6,
                targetX: tgt.x,
                targetY: tgt.y,
                targetZ: tgt.z,
                char: ALL_LUCKY[Math.floor(Math.random() * ALL_LUCKY.length)],
                scrambleTimer: 0,
                finalChar: selectCharByLuminance(tgt.brightness),
                brightness: tgt.brightness,
                phase: Math.random() * Math.PI * 2,
                fontIdx: Math.random() < 0.7 ? Math.floor(Math.random() * CALLI_FONTS.length) : null,
                active: false,
                drawIndex: idx // Keep track which character this belongs to
            });
        }
        
        // Add Launch Trails (the "Fu" shooting up)
        // We only need trails if we are in the launch phase.
        // In single mode, the trail generation is in updateDraw loop.
        // But we can pre-seed some properties here or handle it in updateDraw.
        // Actually, let's modify updateDraw to handle multiple launch trails.
        // Here we just define the "launch targets" to be used in updateDraw.
        // We'll attach metadata to the array or a separate object.
    });
    
    // For single mode compatibility with existing updateDraw logic:
    // We'll update updateDraw to handle `drawsToAnimate` count.
    
    // Store for updateDraw to use
    currentDrawsList = drawsToAnimate;
}

function updateDraw() {
    updateBgParticles(globalTime);
    updateCam();
    if (flamesActive) updateArrivalFlames();

    const t = stateTime;

    // --- Camera choreography for multi-pull ---
    if (isMultiMode) {
        // During draw, focus on screen center
        cam.focusX = window.innerWidth / 2;
        cam.focusY = window.innerHeight / 2;
        if (t < DRAW_LAUNCH * 0.5) {
            // Slow zoom out as 福 rises
            camTarget.scale = 0.92;
        } else if (t < DRAW_LAUNCH) {
            // Hold wide
            camTarget.scale = 0.92;
        } else if (t < DRAW_SCATTER) {
            // BURST: camera shake + slight zoom in
            if (t < DRAW_LAUNCH + 0.05) cam.shake = bestStarsInBatch >= 5 ? 14 : 8;
            camTarget.scale = 1.0;
        } else if (t < DRAW_REFORM) {
            // Reform: ease back
            camTarget.scale = 1.0;
        } else {
            // Settle: normalize
            camTarget.scale = 1.0;
        }
        // God rays during scatter/reform for 4+ star batches
        if (bestStarsInBatch >= 4) {
            if (t >= DRAW_LAUNCH && t < DRAW_REFORM + 0.5) {
                const rayT = Math.min(1, (t - DRAW_LAUNCH) / 0.4);
                const rayFade = t > DRAW_REFORM ? Math.max(0, 1 - (t - DRAW_REFORM) / 0.5) : 1;
                godRayAlpha = rayT * rayFade * (bestStarsInBatch >= 6 ? 0.18 : bestStarsInBatch >= 5 ? 0.12 : 0.07);
            } else {
                godRayAlpha *= 0.9;
            }
        }
    }

    // --- LAUNCH: trail sparks behind rising Fu ---
    if (t < DRAW_LAUNCH) {
        const riseT = Math.min(1, t / Math.max(0.001, DRAW_RISE));
        const launchT = easeInOut(riseT);

        const draws = currentDrawsList || [currentDrawResult];
        const count = draws.length;

        // Grid config for multi — use responsive layout
        const grid = getMultiGridLayout();

        for (let i = 0; i < count; i++) {
            let cx, cy;
            // Calculate current position of the "Fu" — match renderDrawOverlay positions
            if (count > 1) {
                const c = i % grid.multiCols;
                const r = Math.floor(i / grid.multiCols);
                const _isStick = grid.cardH > grid.cardW * 2.5;
                const _charOff = _isStick ? grid.cardH * 0.18 : grid.cardH * 0.02;
                const targetX = grid.startX + c * grid.stepX;
                const targetY = (grid.startY + r * grid.stepY) - _charOff;
                // Match the 福 character origin (all from center bottom)
                const originX = window.innerWidth / 2;
                const originY = window.innerHeight * 0.85;

                const curX2D = lerp(originX, targetX, launchT);
                const curY2D = lerp(originY, targetY, launchT);

                // Screen coords to world coords (at Z=0, scale = 1)
                cx = curX2D - window.innerWidth / 2;
                cy = curY2D - window.innerHeight / 2;

            } else {
                const fuRow = lerp(rows * 0.5, rows * 0.20, launchT);
                const fuCol = cols / 2;
                const fuPos = gridToWorld(fuCol, fuRow);
                cx = fuPos.x;
                cy = fuPos.y;
            }

            if (Math.random() < (count > 1 ? 0.3 : 0.6) * DRAW_LAUNCH_PROFILE.trailSpawnMul) { // Less dense per trail for multi
                launchTrail.push({
                    x: cx + (Math.random() - 0.5) * cellSize * 4,
                    y: cy + cellSize * (0.9 + Math.random() * 2.2),
                    z: (Math.random() - 0.5) * cellSize * 3,
                    vx: (Math.random() - 0.5) * cellSize * 0.08,
                    vy: cellSize * (0.08 + Math.random() * 0.12),
                    vz: (Math.random() - 0.5) * cellSize * 0.06,
                    char: ALL_LUCKY[Math.floor(Math.random() * ALL_LUCKY.length)],
                    life: 1,
                    decay: 0.015 + Math.random() * 0.025,
                });
            }
        }
    }

    // --- BURST FLASH ---
    // Trigger once when launch ends so low FPS can't skip particle activation.
    if (!drawBurstTriggered && t >= DRAW_LAUNCH) {
        drawBurstTriggered = true;
        for (const p of morphParticles) p.active = true;
    }
    if (t >= DRAW_LAUNCH && t < DRAW_LAUNCH + 0.15) {
        burstFlash = 1 - (t - DRAW_LAUNCH) / 0.15;
    } else if (t >= DRAW_LAUNCH + 0.15) {
        burstFlash = 0;
    }

    // --- Morph particles ---
    if (t >= DRAW_LAUNCH) {
        for (const p of morphParticles) {
            if (!p.active) continue;

            if (t < DRAW_SCATTER) {
                const st = (t - DRAW_LAUNCH) / (DRAW_SCATTER - DRAW_LAUNCH);
                const eased = 1 - Math.pow(1 - st, 2);
                p.x = lerp(p.startX, p.scatterX, eased);
                p.y = lerp(p.startY, p.scatterY, eased);
                p.z = lerp(p.startZ, p.scatterZ, eased);

                const wobble = st * cellSize * 0.8;
                p.x += Math.sin(p.phase + globalTime * 4) * wobble;
                p.y += Math.cos(p.phase + globalTime * 3) * wobble;
                p.z += Math.sin(p.phase * 0.7 + globalTime * 3.2) * wobble * 1.4;

                p.scrambleTimer -= 1;
                if (p.scrambleTimer <= 0) {
                    p.char = ALL_LUCKY[Math.floor(Math.random() * ALL_LUCKY.length)];
                    p.scrambleTimer = 2 + Math.random() * 3;
                }
            } else if (t < DRAW_REFORM) {
                const st = (t - DRAW_SCATTER) / (DRAW_REFORM - DRAW_SCATTER);
                const eased = easeInOut(st);
                p.x = lerp(p.scatterX, p.targetX, eased);
                p.y = lerp(p.scatterY, p.targetY, eased);
                p.z = lerp(p.scatterZ, p.targetZ, eased);
                const wobble = (1 - eased) * cellSize * 0.8;
                p.x += Math.sin(p.phase + globalTime * 4) * wobble;
                p.y += Math.cos(p.phase + globalTime * 3) * wobble;
                p.z += Math.sin(p.phase * 0.7 + globalTime * 3.2) * wobble * 1.4;
                p.scrambleTimer -= 1;
                if (p.scrambleTimer <= 0) {
                    p.char = st > 0.4
                        ? p.finalChar
                        : ALL_LUCKY[Math.floor(Math.random() * ALL_LUCKY.length)];
                    p.scrambleTimer = 2 + st * 12;
                }
            } else {
                // After reform, keep particles where they already are (no extra settle motion).
                p.char = p.finalChar;
            }
        }
    }

    // --- Update trail sparks ---
    const worldBottom = (rows * 0.5 + 2) * cellSize;
    let tw = 0;
    for (let i = 0; i < launchTrail.length; i++) {
        const s = launchTrail[i];
        s.x += s.vx;
        s.y += s.vy;
        s.z += s.vz;
        s.vx *= 0.98;
        s.vz *= 0.98;
        s.life -= s.decay;
        if (s.life > 0 && s.y < worldBottom) launchTrail[tw++] = s;
    }
    launchTrail.length = tw;

    if (t >= DRAW_SETTLE + DRAW_TO_FORTUNE_DELAY) {
        if (isMultiMode) {
            // Multi-mode: particles will be seeded in changeState via buildMultiDajiFromMorph
            drawToFortuneSeed = null;
            changeState('fortune');
        } else {
            // Keep reformed draw particles as-is in fortune (no rebuild/snap).
            fortuneUseDrawMorph = true;
            drawToFortuneSeed = null;
            changeState('fortune');
        }
    }
}

function buildDajiSeedFromMorph() {
    const seeded = [];
    for (const p of morphParticles) {
        if (!p.active) continue;
        const lum = Math.min(1, p.brightness + 0.08);
        const char = p.finalChar || selectCharByLuminance(lum);
        if (char === ' ') continue;
        const color = lerpColor(lum);
        seeded.push({
            baseX: p.x,
            baseY: p.y,
            origZ: p.targetZ,
            char,
            fontIdx: p.fontIdx,
            r: color.r,
            g: color.g,
            b: color.b,
            alpha: 0.3 + lum * 0.7,
            lum,
            phase: p.phase,
        });
    }
    return seeded;
}

// ============================================================
// MULTI-FORTUNE: Canvas-integrated particle + card system
// ============================================================

function buildMultiDajiFromMorph() {
    daji3DParticles = [];
    daji3DFromSeed = true;
    daji3DEntryTime = globalTime;

    let activeCount = 0;
    for (const p of morphParticles) {
        if (!p.active) continue;
        activeCount++;
        const lum = Math.min(1, p.brightness + 0.08);
        const char = p.finalChar || selectCharByLuminance(lum);
        if (char === ' ') continue;
        const color = lerpColor(lum);
        daji3DParticles.push({
            baseX: p.targetX,
            baseY: p.targetY,
            origZ: p.targetZ,
            char,
            fontIdx: p.fontIdx,
            r: color.r,
            g: color.g,
            b: color.b,
            alpha: 0.3 + lum * 0.7,
            lum,
            phase: p.phase,
            drawIndex: p.drawIndex,
            // Reveal animation state
            fadingOut: false,
            fadeStartTime: 0,
            burstVx: 0,
            burstVy: 0,
        });
    }
}

function initMultiFortuneState() {
    const grid = getMultiGridLayout();

    const cards = [];
    for (let i = 0; i < multiDrawResults.length; i++) {
        const c = i % grid.multiCols;
        const r = Math.floor(i / grid.multiCols);
        cards.push({
            draw: multiDrawResults[i],
            centerX: grid.startX + c * grid.stepX,
            centerY: grid.startY + r * grid.stepY,
            cardW: grid.cardW,
            cardH: grid.cardH,
            revealed: false,
            revealTime: 0,
            // New states for 3D effects
            converging: false,
            convergeStartTime: 0,
            convergeDuration: 0,
            flipping: false,
            flipStartTime: 0,
        });
    }

    multiFortuneState = {
        cards,
        revealedCount: 0,
        allRevealedTime: 0,
        burstParticles: [],
    };
    // Reset post-processing state
    ppShockwaves = [];
    ppChromatic = 0;
    ppBloomTarget = 0.12;
}

function updateMultiDajiToGPU(skipRender) {
    if (!particlesMesh) return 0;
    if (!daji3DParticles.length) {
        particlesMesh.count = 0;
        return 0;
    }

    const scaleFactor = getMultiGridLayout().scaleFactor;
    const spread = getClusterSpread() * scaleFactor;
    const entryT = Math.min(1, (globalTime - daji3DEntryTime) / 0.6);
    const breatheAmp = spread * 0.06;

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;

    const maxCount = instColor.count;
    const count = Math.min(daji3DParticles.length, maxCount);

    const clusterH = spread * 0.5;
    const highlightPos = Math.sin(globalTime * 0.8) * 0.3;

    let visibleCount = 0;
    for (let i = 0; i < count; i++) {
        const p = daji3DParticles[i];

        let alpha = p.alpha * 1.25;
        alpha = Math.min(0.8, alpha);
        let extraX = 0, extraY = 0;
        let colorBoost = 1;
        let goldShift = 0; // 0 = normal metallic, 1 = pure bright gold

        // Anticipation: particles brighten and pulse before high-rarity reveal
        if (p.anticipating && !p.fadingOut && !p.converging) {
            const pulse = 0.7 + Math.sin(globalTime * 12 + p.phase * 2) * 0.3;
            alpha = Math.min(1.0, alpha * 1.8 * pulse);
            colorBoost = 1.5;
        }

        // CONVERGENCE: particles rush toward card center, brighten to gold
        if (p.converging && !p.fadingOut) {
            const ct = Math.min(1, (globalTime - p.convergeStartTime) / p.convergeDuration);
            const eased = easeInOut(ct);
            // Move toward card center
            extraX = (p.convergeTargetX - p.baseX) * eased;
            extraY = (p.convergeTargetY - p.baseY) * eased;
            // Brighten dramatically
            alpha = Math.min(1.0, alpha * (1 + ct * 3));
            colorBoost = 1 + ct * 2;
            goldShift = ct; // shift to pure gold
            // Scale down as they converge (compress into point)
            // handled below in scale calculation
        }

        if (p.fadingOut) {
            const fadeT = Math.min(1, (globalTime - p.fadeStartTime) / 0.7);
            const flashBoost = fadeT < 0.15 ? 2.0 : 1;
            alpha *= (1 - fadeT) * flashBoost;
            const burstEase = 1 - Math.pow(1 - fadeT, 2);
            extraX = p.burstVx * burstEase * spread * 5;
            extraY = p.burstVy * burstEase * spread * 5;
            if (fadeT >= 1) continue;
        }

        const z = p.origZ + Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;

        _dummy.position.set(p.baseX + extraX, -(p.baseY + extraY), -z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(visibleCount, _dummy.matrix);

        // Metallic gold gradient (base)
        const yNorm = clusterH > 0 ? p.baseY / clusterH : 0;
        const gradT = Math.max(0, Math.min(1, (yNorm + 1) * 0.5));
        const hDist = Math.abs(yNorm - highlightPos);
        const highlight = Math.max(0, 1 - hDist * 3);

        let metalR = Math.min(255, Math.floor(lerp(255, 180, gradT) + highlight * 55));
        let metalG = Math.min(255, Math.floor(lerp(225, 130, gradT) + highlight * 40));
        let metalB = Math.min(255, Math.floor(lerp(50, 10, gradT) + highlight * 50));

        // Gold shift during convergence
        if (goldShift > 0) {
            metalR = Math.floor(lerp(metalR, 255, goldShift));
            metalG = Math.floor(lerp(metalG, 240, goldShift));
            metalB = Math.floor(lerp(metalB, 120, goldShift));
        }

        const blendT = Math.min(1, entryT);
        const gr = lerp(p.r, metalR, blendT) / 255;
        const gg = lerp(p.g, metalG, blendT) / 255;
        const gb = lerp(p.b, metalB, blendT) / 255;

        instColor.setXYZ(visibleCount, Math.min(1, gr * colorBoost), Math.min(1, gg * colorBoost), Math.min(1, gb * colorBoost));
        instAlpha.setX(visibleCount, alpha);

        const uv = (p.fontIdx != null && charToUV[p.char + '|' + p.fontIdx]) || charToUV[p.char];
        if (uv) instUV.setXY(visibleCount, uv.u, uv.v);

        let scale = cellSize * lerp(1.1, 0.85, entryT) * scaleFactor;
        // Convergence: shrink as they rush to center
        if (p.converging && !p.fadingOut) {
            const ct = Math.min(1, (globalTime - p.convergeStartTime) / p.convergeDuration);
            scale *= lerp(1, 0.3, ct * ct);
        }
        instScale.setX(visibleCount, scale);
        visibleCount++;
    }

    particlesMesh.count = visibleCount;
    particlesMesh.instanceMatrix.needsUpdate = true;
    instColor.needsUpdate = true;
    instAlpha.needsUpdate = true;
    instUV.needsUpdate = true;
    instScale.needsUpdate = true;

    if (!skipRender) renderAndCompositeGL();
    return visibleCount;
}

// Helper: draw a rounded rect path at given position
function roundRectPath(ctxRef, x, y, w, h, r) {
    ctxRef.beginPath();
    ctxRef.moveTo(x + r, y);
    ctxRef.lineTo(x + w - r, y);
    ctxRef.quadraticCurveTo(x + w, y, x + w, y + r);
    ctxRef.lineTo(x + w, y + h - r);
    ctxRef.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctxRef.lineTo(x + r, y + h);
    ctxRef.quadraticCurveTo(x, y + h, x, y + h - r);
    ctxRef.lineTo(x, y + r);
    ctxRef.quadraticCurveTo(x, y, x + r, y);
    ctxRef.closePath();
}

function renderMultiCards() {
    if (!multiFortuneState) return;
    const fadeIn = Math.min(1, stateTime / 0.5);
    const FLIP_DURATION = 0.55; // seconds for 3D flip

    for (const card of multiFortuneState.cards) {
        const revealAge = card.revealed ? (globalTime - card.revealTime) : -1;

        // === 3D CARD FLIP ANIMATION ===
        if (card.flipping) {
            const flipAge = globalTime - card.flipStartTime;
            const flipT = Math.min(1, flipAge / FLIP_DURATION);
            if (flipT >= 1) card.flipping = false;

            const angle = flipT * Math.PI; // 0 → PI
            const cosA = Math.cos(angle);
            const scaleX = Math.abs(cosA);
            const isBack = cosA > 0; // first half = back, second half = front

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.translate(card.centerX, card.centerY);

            // Perspective distortion: slight vertical stretch at midpoint
            const perspSkew = Math.sin(angle) * 0.06;
            ctx.transform(Math.max(0.02, scaleX), 0, 0, 1 + perspSkew, 0, 0);

            // Drop shadow during flip
            if (scaleX < 0.7) {
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 12 * (1 - scaleX);
                ctx.shadowOffsetX = (1 - scaleX) * 8 * Math.sign(cosA);
            }

            const hw = card.cardW / 2, hh = card.cardH / 2;
            const rd = 8;

            if (isBack) {
                // BACK FACE: frosted glass with 福
                roundRectPath(ctx, -hw, -hh, card.cardW, card.cardH, rd);
                const backGlass = ctx.createLinearGradient(-hw, -hh, -hw, hh);
                backGlass.addColorStop(0, 'rgba(255, 228, 150, 0.34)');
                backGlass.addColorStop(0.55, 'rgba(255, 202, 100, 0.2)');
                backGlass.addColorStop(1, 'rgba(222, 142, 36, 0.14)');
                ctx.fillStyle = backGlass;
                ctx.globalAlpha = fadeIn * 0.95;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 220, 125, 0.58)';
                ctx.lineWidth = 1;
                ctx.stroke();
                // 福 character
                const _stickFlip = card.cardH > card.cardW * 2.5;
                const hintSize = _stickFlip ? card.cardW * 0.55 : Math.min(card.cardW, card.cardH) * 0.35;
                ctx.font = `bold ${hintSize}px "Ma Shan Zheng", serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.globalAlpha = fadeIn * 0.25;
                ctx.fillStyle = CONFIG.glowGold;
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.fillText('\u798F', 0, _stickFlip ? -card.cardH * 0.18 : -card.cardH * 0.02);
            } else {
                // FRONT FACE: revealed card with rarity styling
                const [rr, rg, rb] = card.draw.rarity.burstRGB || [236, 245, 255];
                roundRectPath(ctx, -hw, -hh, card.cardW, card.cardH, rd);
                const frontGlass = ctx.createLinearGradient(-hw, -hh, -hw, hh);
                frontGlass.addColorStop(0, `rgba(${rr}, ${rg}, ${rb}, 0.30)`);
                frontGlass.addColorStop(0.55, `rgba(${rr}, ${rg}, ${rb}, 0.18)`);
                frontGlass.addColorStop(1, 'rgba(236, 246, 255, 0.12)');
                ctx.fillStyle = frontGlass;
                ctx.globalAlpha = fadeIn * 0.9;
                ctx.fill();
                ctx.strokeStyle = card.draw.rarity.color;
                ctx.lineWidth = 2;
                ctx.shadowColor = card.draw.rarity.color;
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 0;
                ctx.stroke();
            }

            // Card edge at midpoint (golden edge)
            if (scaleX < 0.12) {
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = 'rgba(220, 190, 80, 0.9)';
                ctx.fillRect(-1.5, -hh, 3, card.cardH);
            }

            ctx.restore();
            continue; // Skip normal card rendering during flip
        }

        // === NORMAL CARD RENDERING ===
        // Convergence glow: brightens at the character position (where particles converge)
        if (card.converging) {
            const ct = Math.min(1, (globalTime - card.convergeStartTime) / card.convergeDuration);
            ctx.save();
            ctx.scale(dpr, dpr);
            const _stkGlow = card.cardH > card.cardW * 2.5;
            const glowCY = card.centerY - (_stkGlow ? card.cardH * 0.18 : card.cardH * 0.02);
            const glowR = Math.min(card.cardW, card.cardH) * 0.4 * (1 + ct);
            const grad = ctx.createRadialGradient(
                card.centerX, glowCY, 0,
                card.centerX, glowCY, glowR
            );
            grad.addColorStop(0, `rgba(255, 240, 120, ${ct * 0.6})`);
            grad.addColorStop(0.5, `rgba(255, 200, 50, ${ct * 0.3})`);
            grad.addColorStop(1, 'rgba(255, 200, 50, 0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = grad;
            ctx.fillRect(card.centerX - glowR, glowCY - glowR, glowR * 2, glowR * 2);
            ctx.globalCompositeOperation = 'source-over';
            ctx.restore();
        }

        const [rr, rg, rb] = card.draw.rarity.burstRGB || [236, 245, 255];
        const alpha = fadeIn * (card.revealed ? 0.9 : 0.8);
        const borderColor = card.revealed ? card.draw.rarity.glow : 'rgba(255, 220, 125, 0.5)';
        const fillColor = card.revealed ? `rgba(${rr}, ${rg}, ${rb}, 0.30)` : 'rgba(255, 225, 140, 0.3)';
        const midFillColor = card.revealed ? `rgba(${rr}, ${rg}, ${rb}, 0.18)` : 'rgba(255, 200, 95, 0.2)';
        const bottomFillColor = card.revealed ? `rgba(${rr}, ${rg}, ${rb}, 0.12)` : 'rgba(222, 140, 30, 0.14)';

        drawMultiCardRect(card.centerX, card.centerY, card.cardW, card.cardH, alpha, borderColor, fillColor, midFillColor, bottomFillColor);

        // REVEAL FLASH: bright white→rarity-color flash
        if (card.revealed && revealAge < 0.5) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const flashT = revealAge / 0.5;
            const flashAlpha = (1 - flashT) * 0.8;
            roundRectPath(ctx, card.centerX - card.cardW / 2, card.centerY - card.cardH / 2, card.cardW, card.cardH, 10);
            const flashColor = flashT < 0.3 ? 'white' : card.draw.rarity.color;
            ctx.globalAlpha = flashAlpha;
            ctx.fillStyle = flashColor;
            ctx.shadowColor = card.draw.rarity.color;
            ctx.shadowBlur = 25 * (1 - flashT);
            ctx.fill();
            ctx.restore();
        }

        // Rarity-colored border glow for revealed cards
        if (card.revealed && revealAge >= 0.5) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const glowPulse = revealAge < 1.5 ? 0.5 + Math.sin(revealAge * Math.PI * 2) * 0.2 : 0.3;
            ctx.globalAlpha = fadeIn * glowPulse;
            ctx.shadowColor = card.draw.rarity.color;
            ctx.shadowBlur = 10;
            ctx.strokeStyle = card.draw.rarity.color;
            ctx.lineWidth = 1.5;
            roundRectPath(ctx, card.centerX - card.cardW / 2, card.centerY - card.cardH / 2, card.cardW, card.cardH, 10);
            ctx.stroke();
            ctx.restore();
        }

        // ANTICIPATION for 5+ star: shake + glow buildup
        if (card.anticipating && card.anticipateStart) {
            const anticAge = globalTime - card.anticipateStart;
            const anticT = Math.min(1, anticAge / card.anticipateDuration);
            const stars = card.draw.rarity.stars;

            ctx.save();
            ctx.scale(dpr, dpr);
            const x = card.centerX - card.cardW / 2;
            const y = card.centerY - card.cardH / 2;

            const shakeIntensity = anticT * (stars >= 6 ? 6 : 3.5);
            const shakeX = Math.sin(anticAge * 35) * shakeIntensity;
            const shakeY = Math.cos(anticAge * 28) * shakeIntensity * 0.6;
            ctx.translate(shakeX, shakeY);

            const glowIntensity = anticT * anticT;
            const glowSize = 15 + glowIntensity * (stars >= 6 ? 40 : 25);
            ctx.globalAlpha = glowIntensity * 0.8;
            ctx.shadowColor = card.draw.rarity.color;
            ctx.shadowBlur = glowSize;
            ctx.strokeStyle = card.draw.rarity.color;
            ctx.lineWidth = 2 + glowIntensity * 3;
            roundRectPath(ctx, x, y, card.cardW, card.cardH, 10);
            ctx.stroke();

            if (stars >= 6 && anticT > 0.4) {
                const innerT = (anticT - 0.4) / 0.6;
                ctx.globalAlpha = innerT * 0.3;
                ctx.fillStyle = card.draw.rarity.color;
                ctx.fill();
            }
            ctx.restore();
        }

        // 福 hint on unrevealed cards
        if (!card.revealed && !card.anticipating && !card.converging) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const _isStick = card.cardH > card.cardW * 2.5;
            const hintSize = _isStick ? card.cardW * 0.55 : Math.min(card.cardW, card.cardH) * 0.35;
            ctx.font = `bold ${hintSize}px "Ma Shan Zheng", serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = fadeIn * (_isStick ? 0.15 : 0.2);
            ctx.fillStyle = CONFIG.glowGold;
            ctx.fillText('\u798F', card.centerX, card.centerY - (_isStick ? card.cardH * 0.18 : card.cardH * 0.02));
            ctx.restore();
        }
    }
}

function renderMultiCardText() {
    if (!multiFortuneState) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    for (const card of multiFortuneState.cards) {
        if (!card.revealed) continue;
        // Don't show text until card flip completes
        if (card.flipping) continue;
        const FLIP_DUR = 0.55;
        const textDelay = FLIP_DUR + 0.05; // wait for flip + tiny gap
        const timeSinceReveal = globalTime - card.revealTime;
        if (timeSinceReveal < textDelay) continue;
        const revealT = Math.min(1, (timeSinceReveal - textDelay) / 0.4);
        if (revealT <= 0) continue;

        const dr = card.draw;
        const cx = card.centerX;
        const cy = card.centerY;
        const cw = card.cardW;
        const ch = card.cardH;
        const isStick = ch > cw * 2.5; // Fortune-stick proportions (tall & narrow)

        // Clip to card bounds
        ctx.save();
        const clipX = cx - cw / 2;
        const clipY = cy - ch / 2;
        ctx.beginPath();
        ctx.rect(clipX, clipY, cw, ch);
        ctx.clip();

        const alpha = revealT;
        const unit = Math.min(cw, ch); // Base dimension for text sizing

        if (isStick) {
            // === FORTUNE-STICK LAYOUT (desktop) ===
            // Tall narrow card: stars → character → phrase laid out with generous vertical spacing.
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Stars — compact row at top
            const starsStr = '\u2605'.repeat(dr.rarity.stars);
            const starsSize = Math.max(10, cw * 0.12);
            ctx.font = `${starsSize}px "Courier New", monospace`;
            ctx.globalAlpha = alpha * 0.7;
            ctx.fillStyle = dr.rarity.color;
            ctx.shadowColor = dr.rarity.color;
            ctx.shadowBlur = 4;
            ctx.letterSpacing = '1px';
            ctx.fillText(starsStr, cx, cy - ch * 0.40);

            // Main character — large, centered
            const charSize = Math.max(18, cw * 0.62);
            ctx.font = `${charSize}px ${MULTI_CARD_FONT}, serif`;
            ctx.globalAlpha = alpha * 0.92;
            ctx.fillStyle = CONFIG.glowGold;
            ctx.shadowColor = CONFIG.glowGold;
            ctx.shadowBlur = charSize * 0.06;
            ctx.fillText(dr.char, cx, cy - ch * 0.18);

            // English name — small, below character
            const charEn = dr.blessing ? (dr.blessing.charEn || '') : '';
            if (charEn) {
                const enSize = Math.max(8, cw * 0.1);
                ctx.font = `${enSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
                ctx.globalAlpha = alpha * 0.35;
                ctx.fillStyle = '#FFD700';
                ctx.shadowBlur = 0;
                ctx.fillText(charEn, cx, cy - ch * 0.04);
            }

            // Blessing phrase — vertical column with generous spacing
            const phraseChars = Array.from(dr.blessing.phrase || '');
            const phraseSize = Math.max(11, cw * 0.18);
            ctx.font = `${phraseSize}px ${MULTI_CARD_FONT}, serif`;
            ctx.globalAlpha = alpha * 0.55;
            ctx.fillStyle = CONFIG.glowRed;
            ctx.shadowColor = CONFIG.glowRed;
            ctx.shadowBlur = 2;
            const phraseTopY = cy + ch * 0.08;
            const phraseBottomY = cy + ch * 0.44;
            let phraseStep = phraseSize * 1.35; // generous spacing
            if (phraseChars.length > 1) {
                phraseStep = Math.min(phraseStep, (phraseBottomY - phraseTopY) / (phraseChars.length - 1));
                phraseStep = Math.max(phraseSize * 0.9, phraseStep);
            }
            const phraseBlockH = (phraseChars.length - 1) * phraseStep;
            const phraseStartY = phraseTopY + ((phraseBottomY - phraseTopY) - phraseBlockH) / 2;
            for (let i = 0; i < phraseChars.length; i++) {
                ctx.fillText(phraseChars[i], cx, phraseStartY + i * phraseStep);
            }
        } else {
            // === STANDARD LAYOUT (mobile 5×2) ===
            // Stars (vertical stack)
            const starsChars = Array.from('\u2605'.repeat(dr.rarity.stars) + '\u2606'.repeat(Math.max(0, 7 - dr.rarity.stars)));
            const starsSize = Math.max(13, unit * 0.17);
            ctx.font = `${starsSize}px "Courier New", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = alpha * 0.85;
            ctx.fillStyle = dr.rarity.color;
            ctx.shadowColor = dr.rarity.color;
            ctx.shadowBlur = 4;
            const starsTopY = cy - ch * 0.42;
            const starsBottomY = cy - ch * 0.10;
            let starsStep = Math.max(starsSize * 0.98, 10);
            if (starsChars.length > 1) {
                starsStep = Math.min(starsStep, (starsBottomY - starsTopY) / (starsChars.length - 1));
                starsStep = Math.max(8.5, starsStep);
            }
            for (let i = 0; i < starsChars.length; i++) {
                ctx.fillText(starsChars[i], cx, starsTopY + i * starsStep);
            }

            // Main character
            const charSize = Math.max(14, unit * 0.45);
            ctx.font = `${charSize}px ${MULTI_CARD_FONT}, serif`;
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = CONFIG.glowGold;
            ctx.shadowColor = CONFIG.glowGold;
            ctx.shadowBlur = charSize * 0.08;
            ctx.fillText(dr.char, cx, cy - ch * 0.02);

            // Blessing phrase (vertical stack)
            const phraseChars = Array.from(dr.blessing.phrase || '');
            const phraseSize = Math.max(13, unit * 0.15);
            ctx.font = `${phraseSize}px ${MULTI_CARD_FONT}, serif`;
            ctx.globalAlpha = alpha * 0.6;
            ctx.fillStyle = CONFIG.glowRed;
            ctx.shadowColor = CONFIG.glowRed;
            ctx.shadowBlur = 2;
            const phraseTopY = cy + ch * 0.18;
            const phraseBottomY = cy + ch * 0.48;
            let phraseStep = Math.max(phraseSize * 1.02, 11);
            if (phraseChars.length > 1) {
                phraseStep = Math.min(phraseStep, (phraseBottomY - phraseTopY) / (phraseChars.length - 1));
                phraseStep = Math.max(9, phraseStep);
            }
            for (let i = 0; i < phraseChars.length; i++) {
                ctx.fillText(phraseChars[i], cx, phraseTopY + i * phraseStep);
            }
        }

        ctx.restore();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

function revealCard(index) {
    if (!multiFortuneState || index < 0 || index >= multiFortuneState.cards.length) return;
    const card = multiFortuneState.cards[index];
    if (card.revealed || card.anticipating || card.converging) return;

    const stars = card.draw.rarity.stars;

    // 5+ star: anticipation phase (shake + glow) before convergence
    if (stars >= 5) {
        card.anticipating = true;
        card.anticipateStart = globalTime;
        card.anticipateDuration = stars >= 7 ? 1.2 : (stars >= 6 ? 0.9 : 0.55);
        for (const p of daji3DParticles) {
            if (p.drawIndex === index) p.anticipating = true;
        }
        const delay = card.anticipateDuration * 1000;
        setTimeout(() => startConvergence(index), delay);
        return;
    }

    // Normal reveal (2-4 stars): skip anticipation, go straight to convergence
    startConvergence(index);
}

// Phase 2: Golden convergence — particles rush to card center
function startConvergence(index) {
    if (!multiFortuneState || index < 0 || index >= multiFortuneState.cards.length) return;
    const card = multiFortuneState.cards[index];
    if (card.revealed) return;

    const stars = card.draw.rarity.stars;
    card.anticipating = false;
    card.converging = true;
    card.convergeStartTime = globalTime;
    card.convergeDuration = stars >= 7 ? 0.8 : (stars >= 6 ? 0.6 : (stars >= 5 ? 0.5 : 0.3));

    // Mark particles as converging toward where the main character text will appear
    const isStick = card.cardH > card.cardW * 2.5;
    const charOffsetY = isStick ? card.cardH * 0.18 : card.cardH * 0.02;
    const cardWorldCX = card.centerX - window.innerWidth / 2;
    const cardWorldCY = (card.centerY - charOffsetY) - window.innerHeight / 2;
    for (const p of daji3DParticles) {
        if (p.drawIndex === index) {
            p.converging = true;
            p.anticipating = false;
            p.convergeStartTime = globalTime;
            p.convergeDuration = card.convergeDuration;
            p.convergeTargetX = cardWorldCX;
            p.convergeTargetY = cardWorldCY;
        }
    }

    // Camera begins to zoom in for 5+
    if (stars >= 5) {
        cam.focusX = card.centerX;
        cam.focusY = card.centerY;
        camTarget.scale = stars >= 6 ? 1.2 : 1.12;
    }

    // Bloom ramp-up during convergence (subtle)
    ppBloomTarget = stars >= 6 ? 1.0 : stars >= 5 ? 0.8 : 0.5;

    setTimeout(() => finishReveal(index), card.convergeDuration * 1000);
}

// Phase 3: Burst + Reveal — the climax
function finishReveal(index) {
    if (!multiFortuneState || index < 0 || index >= multiFortuneState.cards.length) return;
    const card = multiFortuneState.cards[index];
    if (card.revealed) return;

    const stars = card.draw.rarity.stars;
    card.revealed = true;
    card.revealTime = globalTime;
    card.converging = false;
    card.flipping = true;
    card.flipStartTime = globalTime;
    multiFortuneState.revealedCount++;
    playSfxReveal(stars);

    // BLOOM SPIKE then decay (keep subtle so text stays readable)
    ppBloomTarget = stars >= 7 ? 2.0 : (stars >= 6 ? 1.5 : (stars >= 5 ? 1.0 : 0.6));
    setTimeout(() => { ppBloomTarget = 0.12; }, stars >= 7 ? 500 : 350);

    // CAMERA SHAKE + zoom back
    if (stars >= 5) {
        cam.shake = stars >= 7 ? 20 : (stars >= 6 ? 14 : 8);
        camTarget.scale = stars >= 7 ? 1.45 : (stars >= 6 ? 1.3 : 1.18);
        const easeBackDelay = stars >= 7 ? 1200 : (stars >= 6 ? 900 : 600);
        setTimeout(() => { camTarget.scale = 1.0; }, easeBackDelay);
    } else if (stars >= 4) {
        cam.shake = 4;
    }

    // CHROMATIC ABERRATION spike
    ppChromatic = stars >= 7 ? 0.025 : (stars >= 6 ? 0.018 : (stars >= 5 ? 0.01 : 0.004));

    // Character position offset (same as text rendering position)
    const _isStick = card.cardH > card.cardW * 2.5;
    const _charOffY = _isStick ? card.cardH * 0.18 : card.cardH * 0.02;
    const _charCY = card.centerY - _charOffY;

    // SHOCKWAVE distortion — centered on character position
    if (stars >= 4) {
        ppShockwaves.push({
            cx: card.centerX / window.innerWidth,
            cy: 1 - _charCY / window.innerHeight,
            startTime: globalTime,
            duration: stars >= 7 ? 0.9 : (stars >= 6 ? 0.7 : 0.5),
            maxRadius: stars >= 7 ? 0.7 : (stars >= 6 ? 0.55 : (stars >= 5 ? 0.4 : 0.25)),
            strength: stars >= 7 ? 1.0 : (stars >= 6 ? 0.8 : (stars >= 5 ? 0.5 : 0.25)),
        });
        // Double shockwave for 6+ star
        if (stars >= 6) {
            setTimeout(() => {
                ppShockwaves.push({
                    cx: card.centerX / window.innerWidth,
                    cy: 1 - _charCY / window.innerHeight,
                    startTime: globalTime,
                    duration: stars >= 7 ? 0.8 : 0.6,
                    maxRadius: stars >= 7 ? 0.9 : 0.7,
                    strength: stars >= 7 ? 0.6 : 0.4,
                });
            }, 150);
        }
        // Triple shockwave for 7-star only
        if (stars >= 7) {
            setTimeout(() => {
                ppShockwaves.push({
                    cx: card.centerX / window.innerWidth,
                    cy: 1 - _charCY / window.innerHeight,
                    startTime: globalTime,
                    duration: 0.7,
                    maxRadius: 1.0,
                    strength: 0.3,
                });
            }, 350);
        }
    }

    // BURST particles outward from character position
    const cardWorldCX = card.centerX - window.innerWidth / 2;
    const cardWorldCY = _charCY - window.innerHeight / 2;
    for (const p of daji3DParticles) {
        if (p.drawIndex === index && !p.fadingOut) {
            p.fadingOut = true;
            p.converging = false;
            p.fadeStartTime = globalTime;
            // Burst from card center outward (radial explosion)
            const angle = Math.random() * Math.PI * 2;
            const burstPower = stars >= 7 ? 6.0 : (stars >= 6 ? 4.5 : (stars >= 5 ? 3.0 : 1.5));
            const speed = burstPower * (0.5 + Math.random());
            p.burstVx = Math.cos(angle) * speed;
            p.burstVy = Math.sin(angle) * speed;
        }
    }

    // Screen flash
    if (stars >= 4) triggerScreenFlash(stars);

    if (multiFortuneState.revealedCount >= multiFortuneState.cards.length) {
        multiFortuneState.allRevealedTime = globalTime;
        onAllMultiCardsRevealed();
    }
}

function onAllMultiCardsRevealed() {
    // Hide reveal-all button and DOM action buttons
    const btnRevealAll = document.getElementById('btn-reveal-all');
    if (btnRevealAll) btnRevealAll.style.display = 'none';
    if (btnMultiSingle) btnMultiSingle.style.display = 'none';
    if (btnMultiCollection) btnMultiCollection.style.display = 'none';
    if (btnMultiAgain) btnMultiAgain.style.display = 'none';

    // Show mode switch + collection FAB (same as single draw)
    updateUIVisibility();
}


function renderMultiHints() {
    if (!multiFortuneState) return;
    const L = getLayout();
    const { hintSize, hintSubSize } = getSwipeHintSizes();

    if (multiFortuneState.revealedCount < multiFortuneState.cards.length) {
        // "Tap to Reveal" hint
        const hintFade = Math.min(1, Math.max(0, (stateTime - 0.8) / 0.5));
        const pulse = 0.5 + Math.sin(globalTime * 3) * 0.2;
        drawOverlayText('\u70B9\u51FB\u7FFB\u5F00 \u00B7 Tap to Reveal', L.multiHintY, CONFIG.glowGold, hintFade * pulse, hintSize);
    } else {
        // Swipe-up hint after all revealed (same as single draw)
        const revealAge = globalTime - multiFortuneState.allRevealedTime;
        if (revealAge > 1.0) {
            const hintFade = Math.min(1, (revealAge - 1.0) / 0.5);
            const pulse = 0.4 + Math.sin(globalTime * 3) * 0.2;
            const hopOffset = getSwipeHintHopOffset();
            const { mainText, subText } = getSwipeHintText(selectedMode === 'multi');
            const swipeHintOffsetY = 0.05;
            drawOverlayText(mainText, L.arrivalHintY + swipeHintOffsetY + hopOffset, CONFIG.glowGold, hintFade * pulse, hintSize);
            drawOverlayText(subText, L.arrivalHintSubY + swipeHintOffsetY + hopOffset, CONFIG.glowGold, hintFade * pulse, hintSubSize);
        }
    }
}

function hitTestMultiCard(screenX, screenY) {
    if (!multiFortuneState) return -1;
    for (let i = 0; i < multiFortuneState.cards.length; i++) {
        const card = multiFortuneState.cards[i];
        if (Math.abs(screenX - card.centerX) < card.cardW / 2 &&
            Math.abs(screenY - card.centerY) < card.cardH / 2) {
            return i;
        }
    }
    return -1;
}

function hitTestMultiHint(screenX, screenY) {
    if (!multiFortuneState) return false;
    const L = getLayout();
    const { hintSize } = getSwipeHintSizes();
    const hintY = L.multiHintY * window.innerHeight;
    const hitH = hintSize * 2;
    const hitW = window.innerWidth * 0.6;
    return Math.abs(screenX - window.innerWidth / 2) < hitW / 2 &&
           Math.abs(screenY - hintY) < hitH;
}

function revealNextUnrevealedCard() {
    if (!multiFortuneState) return;
    for (let i = 0; i < multiFortuneState.cards.length; i++) {
        const c = multiFortuneState.cards[i];
        if (!c.revealed && !c.anticipating && !c.converging) {
            revealCard(i);
            return;
        }
    }
}

function hitTestSingleFortuneCard(screenX, screenY) {
    if (state !== 'fortune' || isMultiMode || !currentDrawResult) return false;
    const L = getLayout();
    const w = window.innerWidth, h = window.innerHeight;
    const cardW = w * L.cardWidth;
    const cardTop = h * L.cardTop;
    const cardBottom = h * L.cardBottom;
    const cardLeft = (w - cardW) / 2;
    return screenX >= cardLeft && screenX <= cardLeft + cardW &&
           screenY >= cardTop && screenY <= cardBottom;
}

function resetMultiFortune() {
    multiFortuneState = null;
    multiFlipState = null;
    isMultiMode = false;
    multiDrawResults = null;
    daji3DParticles = [];
    meteorParticles = [];
    godRayAlpha = 0;
    // Reset post-processing effects
    ppShockwaves = [];
    ppChromatic = 0;
    ppBloomTarget = 0.12;
    ppBloomStrength = 0.12;
    resetCam();
    canvas.style.transform = '';
    if (particlesMesh) particlesMesh.count = 0;
    // Hide DOM buttons
    const btnRevealAll = document.getElementById('btn-reveal-all');
    if (btnRevealAll) btnRevealAll.style.display = 'none';

    if (btnMultiSingle) btnMultiSingle.style.display = 'none';
    if (btnMultiCollection) btnMultiCollection.style.display = 'none';
    if (btnMultiAgain) btnMultiAgain.style.display = 'none';
    // Hide detail popup
    if (multiDetail) multiDetail.classList.remove('visible');
}

function renderDrawParticles3D(t) {
    const glyphs = [];

    for (const s of launchTrail) {
        glyphs.push({
            x: s.x,
            y: s.y,
            z: s.z,
            char: s.char,
            r: 255,
            g: Math.floor(190 + s.life * 65),
            b: Math.floor(35 + s.life * 40),
            alpha: s.life * 0.68,
            size: 0.72 + s.life * 0.35,
            glow: 0.9,
            blur: 0.8,
        });
    }

    const spread = getClusterSpread();
    const breatheAmp = spread * 0.06;

    for (const p of morphParticles) {
        if (!p.active) continue;
        const gp = p.brightness;
        const drawR = 255;
        const drawG = 180 + gp * 75;
        const drawB = gp * 50;
        let r = drawR, g = drawG, b = drawB;
        let alpha, size = 0.95 + gp * 0.45;

        if (t < DRAW_SCATTER) {
            const st = (t - DRAW_LAUNCH) / (DRAW_SCATTER - DRAW_LAUNCH);
            const fade = 1 - st;
            const flicker = Math.sin(globalTime * 25 + p.phase * 3) * 0.25 * fade;
            alpha = Math.min(1, Math.max(0.1, (0.6 + gp * 0.3) + flicker));
            const sizeWobble = Math.sin(globalTime * 18 + p.phase * 2) * 0.3 * fade;
            size *= (1 + sizeWobble);
        } else if (t < DRAW_REFORM) {
            const st = (t - DRAW_SCATTER) / (DRAW_REFORM - DRAW_SCATTER);
            const fade = st;
            const pulse = Math.sin(globalTime * 8 + p.phase) * 0.2 * fade;
            alpha = Math.min(1, Math.max(0.2, (0.6 + gp * 0.3) + pulse));
            const breathe = Math.sin(globalTime * 6 + p.phase) * 0.15 * fade;
            size *= (1 + breathe);
        } else {
            const settleSt = Math.min(1, (t - DRAW_REFORM) / (DRAW_SETTLE - DRAW_REFORM));
            const easedSettle = easeInOut(settleSt);
            const lum = Math.min(1, gp + 0.08);
            const seed = lerpColor(lum);
            r = lerp(drawR, seed.r, settleSt);
            g = lerp(drawG, seed.g, settleSt);
            b = lerp(drawB, seed.b, settleSt);
            const seedAlpha = 0.3 + lum * 0.7;
            // Continue reform oscillations, fading them out smoothly
            const fadeOut = 1 - easedSettle;
            const pulse = Math.sin(globalTime * 8 + p.phase) * 0.2 * fadeOut;
            const reformBaseAlpha = 0.6 + gp * 0.3;
            alpha = Math.min(1, Math.max(0.2, lerp(reformBaseAlpha + pulse, seedAlpha, easedSettle)));
            // Continue breathe effect on size, fading out smoothly
            const breathe = Math.sin(globalTime * 6 + p.phase) * 0.15 * fadeOut;
            size *= (1 + breathe);
            size = lerp(size, 1.1, easedSettle);
        }

        let breatheMix = 0;
        if (t >= DRAW_REFORM) {
            breatheMix = 1;
        } else if (t > DRAW_SCATTER) {
            const reformProgress = (t - DRAW_SCATTER) / (DRAW_REFORM - DRAW_SCATTER);
            breatheMix = Math.max(0, reformProgress - 0.5) * 2;
        }

        const breathing = Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;
        const renderZ = p.z + breathing * breatheMix;

        // In multi-mode, uniformly scale particle size with cluster (same proportions as single)
        const drawScale = isMultiMode ? getMultiGridLayout().scaleFactor : 1.0;
        glyphs.push({
            x: p.x,
            y: p.y,
            z: renderZ,
            char: p.char,
            fontIdx: p.fontIdx,
            r: Math.round(r),
            g: Math.round(g),
            b: Math.round(b),
            alpha: alpha * drawScale,
            size: size * drawScale,
            glow: 0.7,
            blur: 0.65,
        });
    }

    // Append flames behind draw particles if active
    if (flamesActive || arrivalParticles.length > 0) {
        let gpuIdx = updateProjectedGlyphsToGPU(glyphs, true);
        gpuIdx = appendArrivalFlamesToGPU(gpuIdx);
        if (particlesMesh) {
            particlesMesh.count = gpuIdx;
            particlesMesh.instanceMatrix.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceColor.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceUV.needsUpdate = true;
            particlesMesh.geometry.attributes.instanceScale.needsUpdate = true;
        }
        renderAndCompositeGL();
    } else {
        updateProjectedGlyphsToGPU(glyphs);
    }
}

function renderDrawOverlay() {
    const t = stateTime;

    // Speed lines — render BEFORE everything as background energy
    if (isMultiMode) renderSpeedLines();

    // Meteor shower — render BEFORE particles so they're behind
    if (isMultiMode) updateAndRenderMeteors();

    renderDrawParticles3D(t);

    // God rays — render after particles for additive glow
    if (isMultiMode && godRayAlpha > 0.01) {
        renderGodRays(window.innerWidth / 2, window.innerHeight * 0.4);
    }

    // Launch: draw Fu rising upward and shrinking
    if (t < DRAW_LAUNCH) {
        const riseT = Math.min(1, t / Math.max(0.001, DRAW_RISE));
        const shrinkT = Math.min(1, t / Math.max(0.001, DRAW_SHRINK));
        const riseEased = easeInOut(riseT);
        const shrinkEased = easeInOut(shrinkT);

        ctx.save();
        ctx.scale(dpr, dpr);

        const vmin = Math.min(window.innerWidth, window.innerHeight);
        
        // Single vs Multi Logic
        const draws = currentDrawsList || [currentDrawResult];
        const count = draws.length;

        // Grid config for multi — use responsive layout
        const grid = getMultiGridLayout();

        if (count > 1) {
            // Multi: 10 福 characters rising from bottom, spreading to their grid positions
            const baseSize = isLandscape() ? Math.min(vmin * 0.08, window.innerHeight * 0.07) : vmin * 0.08;
            const fuSize = baseSize * lerp(1, 0.5, shrinkEased);

            ctx.textAlign = 'center';
            // Use alphabetic baseline so per-font visual-center correction stays accurate.
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = CONFIG.glowGold;
            ctx.shadowColor = CONFIG.glowGold;

            const morphSpeed = (1.2 + riseT * 4.5) * DRAW_LAUNCH_PROFILE.morphSpeedMul;
            const morphPhase = t * morphSpeed;
            const fontCount = CALLI_FONTS.length;

            const _stickRise = grid.cardH > grid.cardW * 2.5;
            const _charRiseOff = _stickRise ? grid.cardH * 0.18 : grid.cardH * 0.02;
            for (let i = 0; i < count; i++) {
                const c = i % grid.multiCols;
                const r = Math.floor(i / grid.multiCols);
                const targetX = grid.startX + c * grid.stepX;
                const targetY = (grid.startY + r * grid.stepY) - _charRiseOff;

                // Each 福 rises from bottom center, spreading out to its grid target
                const bottomX = window.innerWidth / 2;
                const bottomY = window.innerHeight * 0.85;
                const cx = lerp(bottomX, targetX, riseEased);
                const cy = lerp(bottomY, targetY, riseEased);

                // Stagger font morph slightly per character
                const iPhase = morphPhase + i * 0.3;
                const rawIdx = (iPhase % fontCount + fontCount) % fontCount;
                const fontA = Math.floor(rawIdx) % fontCount;
                const fontB = (fontA + 1) % fontCount;
                const crossFade = rawIdx - Math.floor(rawIdx);
                const blend = easeInOut(crossFade);
                let alphaA = 1 - blend;
                let alphaB = blend;
                if (IS_COARSE_POINTER) {
                    // Mobile fallback: avoid dual-glyph overlap by fading out A, then fading in B.
                    if (blend < 0.5) {
                        alphaA = lerp(1, 0.35, blend / 0.5);
                        alphaB = 0;
                    } else {
                        alphaA = 0;
                        alphaB = lerp(0.35, 1, (blend - 0.5) / 0.5);
                    }
                }
                const intensity = (1 + riseT * 1.8) * DRAW_LAUNCH_PROFILE.intensityMul;
                const alphaScale = 0.8;
                const fontAName = CALLI_FONTS[fontA];
                const fontBName = CALLI_FONTS[fontB];
                const cyA = getFuVisualCenterY(cy, fontAName, fuSize);
                const cyB = getFuVisualCenterY(cy, fontBName, fuSize);

                ctx.font = `${fuSize}px ${fontAName}, serif`;
                if (DRAW_LAUNCH_PROFILE.outerGlow) {
                    ctx.globalAlpha = Math.min(1, 0.25 * intensity) * alphaA * alphaScale;
                    ctx.shadowBlur = fuSize * 0.12 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
                    ctx.fillText('\u798F', cx, cyA);
                }
                ctx.globalAlpha = alphaA * alphaScale;
                ctx.shadowBlur = fuSize * 0.05 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
                ctx.fillText('\u798F', cx, cyA);

                ctx.font = `${fuSize}px ${fontBName}, serif`;
                if (DRAW_LAUNCH_PROFILE.outerGlow) {
                    ctx.globalAlpha = Math.min(1, 0.25 * intensity) * alphaB * alphaScale;
                    ctx.shadowBlur = fuSize * 0.12 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
                    ctx.fillText('\u798F', cx, cyB);
                }
                ctx.globalAlpha = alphaB * alphaScale;
                ctx.shadowBlur = fuSize * 0.05 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
                ctx.fillText('\u798F', cx, cyB);
            }
        } else {
            // Single (Original behavior)
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight * lerp(0.5, 0.20, riseEased);
            const baseSize = getLayout().arrivalFuSize;
            const fuSize = baseSize * lerp(1, DRAW_SHRINK_END_SCALE, shrinkEased);

            ctx.textAlign = 'center';
            // Use alphabetic baseline so per-font visual-center correction stays accurate.
            ctx.textBaseline = 'alphabetic';

            const morphSpeed = (1.2 + riseT * 4.5) * DRAW_LAUNCH_PROFILE.morphSpeedMul;
            const morphPhase = t * morphSpeed;
            const fontCount = CALLI_FONTS.length;
            const rawIdx = (morphPhase % fontCount + fontCount) % fontCount;
            const fontA = Math.floor(rawIdx) % fontCount;
            const fontB = (fontA + 1) % fontCount;
            const crossFade = rawIdx - Math.floor(rawIdx);
            const blend = easeInOut(crossFade);
            let alphaA = 1 - blend;
            let alphaB = blend;
            if (IS_COARSE_POINTER) {
                // Mobile fallback: avoid dual-glyph overlap by fading out A, then fading in B.
                if (blend < 0.5) {
                    alphaA = lerp(1, 0.35, blend / 0.5);
                    alphaB = 0;
                } else {
                    alphaA = 0;
                    alphaB = lerp(0.35, 1, (blend - 0.5) / 0.5);
                }
            }
            const intensity = (1 + riseT * 2.5) * DRAW_LAUNCH_PROFILE.intensityMul;
            const fontAName = CALLI_FONTS[fontA];
            const fontBName = CALLI_FONTS[fontB];
            const cyA = getFuVisualCenterY(cy, fontAName, fuSize);
            const cyB = getFuVisualCenterY(cy, fontBName, fuSize);

            ctx.font = `${fuSize}px ${fontAName}, serif`;
            ctx.shadowColor = CONFIG.glowGold;
            ctx.fillStyle = CONFIG.glowGold;
            if (DRAW_LAUNCH_PROFILE.outerGlow) {
                ctx.globalAlpha = Math.min(1, 0.3 * intensity) * alphaA;
                ctx.shadowBlur = fuSize * 0.2 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
                ctx.fillText('\u798F', cx, cyA);
            }
            ctx.globalAlpha = alphaA;
            ctx.shadowBlur = fuSize * 0.08 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
            ctx.fillText('\u798F', cx, cyA);

            ctx.font = `${fuSize}px ${fontBName}, serif`;
            if (DRAW_LAUNCH_PROFILE.outerGlow) {
                ctx.globalAlpha = Math.min(1, 0.3 * intensity) * alphaB;
                ctx.shadowBlur = fuSize * 0.2 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
                ctx.fillText('\u798F', cx, cyB);
            }
            ctx.globalAlpha = alphaB;
            ctx.shadowBlur = fuSize * 0.08 * intensity * DRAW_LAUNCH_PROFILE.blurMul;
            ctx.fillText('\u798F', cx, cyB);
        }

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // Burst flash — one per 福, at each 福's end position
    if (burstFlash > 0) {
        ctx.save();
        ctx.scale(dpr, dpr);

        const draws = currentDrawsList || [currentDrawResult];
        for (let i = 0; i < fuEndScreenPositions.length; i++) {
            const pos = fuEndScreenPositions[i];
            const draw = draws[i] || currentDrawResult;
            const bx = pos.x;
            const by = pos.y;

            const rarityScale = draw
                ? (0.2 + draw.rarity.stars * 0.05)
                : 0.4;
            const baseRadius = Math.min(window.innerWidth, window.innerHeight) * rarityScale * burstFlash;
            const radius = isMultiMode ? baseRadius * 0.35 : baseRadius;

            let burstR = 255, burstG = 255, burstB = 220;
            if (draw) {
                const cat = draw.category;
                burstR = Math.floor(lerp(255, cat.r, 0.3));
                burstG = Math.floor(lerp(255, cat.g, 0.3));
                burstB = Math.floor(lerp(220, cat.b, 0.3));
            }

            const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
            const flashMul = isMultiMode ? 0.2 : 1.0;
            gradient.addColorStop(0, `rgba(${burstR}, ${burstG}, ${burstB}, ${burstFlash * 0.8 * flashMul})`);
            gradient.addColorStop(0.4, `rgba(${burstR}, ${burstG}, ${Math.floor(burstB * 0.8)}, ${burstFlash * 0.4 * flashMul})`);
            gradient.addColorStop(1, `rgba(${burstR}, ${burstG}, 0, 0)`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        }

        ctx.restore();
    }
}

// ============================================================
// FORTUNE — Drawn character displayed with gacha reveal
// ============================================================
function renderDaji(alpha) {
    const shapeSource = (currentDrawShape && currentDrawShape.length > 0) ? currentDrawShape : dajiShape;
    const dajiGridSize = getClusterSpread() / cellSize;
    const centerCol = cols / 2;
    const centerRow = rows / 2;
    for (const pt of shapeSource) {
        const col = Math.floor(centerCol + pt.nx * dajiGridSize * 0.5 * pt.aspect);
        const row = Math.floor(centerRow + pt.ny * dajiGridSize * 0.5);
        const lum = Math.min(1, pt.brightness + 0.08);
        const char = selectCharByLuminance(lum);
        if (char === ' ') continue;
        const color = lerpColor(lum);
        setCell(col, row, 0, char, color.r, color.g, color.b, Math.min(1, (0.3 + lum * 0.7) * alpha));
    }
}

function updateFortune() {
    updateBgParticles(globalTime);
    updateCam();
    if (flamesActive || arrivalParticles.length > 0) updateArrivalFlames();
    // Update firework physics if we have fireworks active (4+ stars or tap fireworks)
    if ((currentDrawResult && currentDrawResult.rarity.stars >= 4) || hasTapFireworks()) {
        updateFireworkPhysics();
    }
    // Auto-cycle font when idle (single mode only)
    if (!isMultiMode && !dajiFontTransition && stateTime > 1.5 && globalTime - dajiFontAutoTimer > DAJI_AUTO_INTERVAL) {
        dajiFontAutoTimer = globalTime;
        cycleDajiFont(1);
    }
    // Multi-mode safety: ensure state exists
    if (isMultiMode && multiDrawResults && multiDrawResults.length > 1 && !multiFortuneState && stateTime > 0.1) {
        buildMultiDajiFromMorph();
        initMultiFortuneState();
    }
    // Stop flame spawning after card reveal
    if (flamesActive) {
        if (isMultiMode) {
            // Stop after all cards revealed
            if (multiFortuneState && multiFortuneState.revealedCount >= multiFortuneState.cards.length) {
                flamesActive = false;
            }
        } else {
            // Stop after single card is fully visible (card fade complete ~0.9s)
            if (stateTime > 1.0) {
                flamesActive = false;
            }
        }
    }
}

// --- Morph sparkles for title transitions ---
function drawMorphSparkles(cx, cy, fontSize, t, alpha) {
    const count = 14;
    const spread = fontSize * 1.5;
    for (let i = 0; i < count; i++) {
        const seed = i * 137.508;
        const lifePhase = ((t * 2.5 + i / count) % 1);
        const sparkAlpha = Math.sin(lifePhase * Math.PI) * alpha * 0.6;
        if (sparkAlpha < 0.02) continue;
        const angle = seed + globalTime * (1.2 + (i % 3) * 0.4);
        const r = spread * (0.15 + lifePhase * 0.85);
        const sx = cx + Math.cos(angle) * r;
        const sy = cy + Math.sin(angle) * r * 0.3;
        const size = 1 + (1 - lifePhase) * 2.5;
        ctx.globalAlpha = sparkAlpha;
        ctx.fillStyle = CONFIG.glowGold;
        ctx.shadowColor = CONFIG.glowGold;
        ctx.shadowBlur = size * 5;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- Single character title entrance (adapted from renderDajiTitleEntrance) ---
function renderCharTitleEntrance(stateT, font) {
    if (!currentDrawResult) return;
    const ch = currentDrawResult.char;
    const L = getLayout();
    const fontSize = L.charFontSize;
    const entranceDur = 1.3;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * L.charY;

    if (stateT >= entranceDur) {
        drawOverlayText(ch, L.charY, CONFIG.glowGold, 0.9, L.charFontSize, font);
        return;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.font = `${fontSize}px ${font}, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const delay = 0;
    const dur = entranceDur - 0.1;
    const charT = Math.max(0, Math.min(1, (stateT - delay) / dur));
    if (charT <= 0) { ctx.restore(); return; }

    let scale;
    if (charT < 0.35) {
        scale = lerp(1.8, 0.93, easeInOut(charT / 0.35));
    } else if (charT < 0.6) {
        scale = lerp(0.93, 1.06, easeInOut((charT - 0.35) / 0.25));
    } else {
        scale = lerp(1.06, 1.0, easeInOut((charT - 0.6) / 0.4));
    }

    const alpha = Math.min(0.9, charT * 3);
    const glowMult = 1 + Math.max(0, 1 - charT * 1.5) * 2.5;
    const dropY = Math.max(0, 1 - charT * 2.5) * fontSize * 0.1;

    ctx.save();
    ctx.translate(cx, cy + dropY);
    ctx.scale(scale, scale);

    ctx.globalAlpha = alpha * 0.35 * glowMult;
    ctx.fillStyle = CONFIG.glowGold;
    ctx.shadowColor = CONFIG.glowGold;
    ctx.shadowBlur = fontSize * 0.25 * glowMult;
    ctx.fillText(ch, 0, 0);

    ctx.globalAlpha = alpha;
    ctx.shadowBlur = fontSize * 0.12;
    ctx.fillText(ch, 0, 0);

    ctx.restore();

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

// --- Single character morph transition (adapted from renderDajiMorph) ---
function renderCharMorph(t, fadeIn, oldFont, newFont) {
    if (!currentDrawResult) return;
    const ch = currentDrawResult.char;

    ctx.save();
    ctx.scale(dpr, dpr);

    const L = getLayout();
    const fontSize = L.charFontSize;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * L.charY;
    const baseAlpha = fadeIn * 0.9;

    ctx.font = `${fontSize}px ${oldFont}, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const DISSOLVE_END = 0.3;
    const SCRAMBLE_START = 0.1;
    const SCRAMBLE_END = 0.7;
    const FORM_START = 0.45;

    const sparkleEnv = t < 0.15 ? t / 0.15 : (t > 0.85 ? (1 - t) / 0.15 : 1);
    drawMorphSparkles(cx, cy, fontSize, t, baseAlpha * sparkleEnv);

    if (t < DISSOLVE_END) {
        const dt = t / DISSOLVE_END;
        ctx.font = `${fontSize}px ${oldFont}, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const charT = Math.max(0, Math.min(1, dt));
        const shakeX = Math.sin(globalTime * 35) * charT * fontSize * 0.05;
        const shakeY = Math.cos(globalTime * 28) * charT * fontSize * 0.035;
        const driftY = -charT * charT * fontSize * 0.1;
        const alpha = baseAlpha * (1 - charT * charT);
        const aber = charT * fontSize * 0.025;
        const px = cx + shakeX;
        const py = cy + shakeY + driftY;

        if (aber > 0.5) {
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = '#FF4444';
            ctx.shadowColor = '#FF4444';
            ctx.shadowBlur = fontSize * 0.12;
            ctx.fillText(ch, px - aber, py);
            ctx.fillStyle = '#FFEE44';
            ctx.shadowColor = '#FFEE44';
            ctx.fillText(ch, px + aber, py + aber * 0.3);
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = CONFIG.glowGold;
        ctx.shadowColor = CONFIG.glowGold;
        ctx.shadowBlur = fontSize * (0.15 + charT * 0.25);
        ctx.fillText(ch, px, py);
    }

    if (t >= SCRAMBLE_START && t < SCRAMBLE_END) {
        const st = (t - SCRAMBLE_START) / (SCRAMBLE_END - SCRAMBLE_START);
        const speed = lerp(18, 3, st * st);
        const scrambleIdx = Math.floor(globalTime * speed);
        const envelope = st < 0.15 ? st / 0.15 : (st > 0.7 ? (1 - st) / 0.3 : 1);

        ctx.font = `${fontSize}px ${st < 0.5 ? oldFont : newFont}, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const scramChar = ALL_LUCKY[scrambleIdx % ALL_LUCKY.length];
        const waveY = Math.sin(globalTime * 5) * fontSize * 0.035;
        const waveX = Math.cos(globalTime * 3.5) * fontSize * 0.02;
        const px = cx + waveX;
        const py = cy + waveY;
        const pulse = 1 + Math.sin(globalTime * 8) * 0.05;

        ctx.save();
        ctx.translate(px, py);
        ctx.scale(pulse, pulse);
        ctx.globalAlpha = baseAlpha * envelope * 0.7;
        ctx.fillStyle = CONFIG.glowGold;
        ctx.shadowColor = CONFIG.glowGold;
        ctx.shadowBlur = fontSize * 0.2;
        ctx.fillText(scramChar, 0, 0);
        ctx.restore();
    }

    if (t >= FORM_START) {
        const ft = (t - FORM_START) / (1 - FORM_START);
        ctx.font = `${fontSize}px ${newFont}, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const charT = Math.max(0, Math.min(1, ft));
        const easedT = easeInOut(charT);

        let scale;
        if (charT < 0.45) {
            scale = easedT / 0.45 * 1.1;
        } else if (charT < 0.7) {
            scale = lerp(1.1, 0.97, easeInOut((charT - 0.45) / 0.25));
        } else {
            scale = lerp(0.97, 1.0, easeInOut((charT - 0.7) / 0.3));
        }

        const riseY = (1 - easedT) * fontSize * 0.12;
        const glowPulse = 1 + Math.sin(charT * Math.PI) * 0.5;

        ctx.save();
        ctx.translate(cx, cy + riseY);
        ctx.scale(scale, scale);

        ctx.globalAlpha = baseAlpha * easedT * 0.35 * glowPulse;
        ctx.fillStyle = CONFIG.glowGold;
        ctx.shadowColor = CONFIG.glowGold;
        ctx.shadowBlur = fontSize * 0.3 * glowPulse;
        ctx.fillText(ch, 0, 0);

        ctx.globalAlpha = baseAlpha * easedT;
        ctx.shadowBlur = fontSize * 0.12;
        ctx.fillText(ch, 0, 0);

        ctx.restore();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

// --- Append stars to GPU buffer (for single draw result) ---
// 3-layer per star: glow halo, main body with spin, bright core
function appendStarsToGPU(startIdx, starsCount, centerY, colorHex, elapsedTime) {
    if (!particlesMesh) return startIdx;

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;
    const maxCount = instColor.count;
    let idx = startIdx;

    const stars = starsCount;
    const starSpacing = cellSize * 2.2;
    const totalWidth = (stars - 1) * starSpacing;
    const startX = -totalWidth / 2;

    const c = new THREE.Color(colorHex);
    const cBright = new THREE.Color(colorHex).lerp(new THREE.Color('#FFFFFF'), 0.4);
    const uv = charToUV['\u2605'];

    // Per-star staggered stamp-in: each star appears after the previous
    const stampStart = 0.5;   // first star begins at this stateTime
    const stampDelay = 0.25;  // delay between each star
    const stampDur = 0.4;     // each star's pop-in duration

    for (let i = 0; i < stars; i++) {
        if (idx + 2 >= maxCount) break;

        // Per-star entrance progress: 0 = not yet, 0..1 = animating, 1 = fully in
        const starTime = elapsedTime - (stampStart + i * stampDelay);
        if (starTime < 0) continue; // this star hasn't appeared yet
        const t = Math.min(1, starTime / stampDur);
        // Overshoot ease: pops in big then settles (like a stamp)
        const ease = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
        const overshoot = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.3 : 1;
        const entranceScale = ease * overshoot;
        const entranceAlpha = ease;

        const x = startX + i * starSpacing;
        const baseY = -centerY + cellSize * 0.1;
        const z = -SCENE_FOV * 0.1;

        // Layer 1: Soft glow halo (behind, subtle)
        const glowPulse = (0.12 + Math.sin(globalTime * 2.5 + i * 1.3) * 0.05) * entranceAlpha;
        _dummy.position.set(x, baseY, z + 5);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);
        instColor.setXYZ(idx, cBright.r, cBright.g, cBright.b);
        instAlpha.setX(idx, glowPulse);
        if (uv) instUV.setXY(idx, uv.u, uv.v);
        instScale.setX(idx, cellSize * 3.5 * entranceScale);
        idx++;

        // Layer 2: Main star (crisp, bright, dominant shape)
        const rotAngle = globalTime * 1.8 + i * 0.9;
        const yRotFactor = 0.8 + Math.abs(Math.cos(rotAngle)) * 0.2;
        const shimmer = (0.95 + Math.sin(globalTime * 5 + i * 2.1) * 0.05) * entranceAlpha;
        _dummy.position.set(x, baseY, z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);
        instColor.setXYZ(idx, c.r, c.g, c.b);
        instAlpha.setX(idx, shimmer);
        if (uv) instUV.setXY(idx, uv.u, uv.v);
        instScale.setX(idx, cellSize * 2.5 * yRotFactor * entranceScale);
        idx++;

        // Layer 3: Tiny specular highlight (center sparkle)
        const corePulse = (0.4 + Math.sin(globalTime * 7 + i * 3.7) * 0.3) * entranceAlpha;
        _dummy.position.set(x, baseY, z - 2);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);
        instColor.setXYZ(idx, 1.0, 1.0, 0.95);
        instAlpha.setX(idx, corePulse * 0.3);
        if (uv) instUV.setXY(idx, uv.u, uv.v);
        instScale.setX(idx, cellSize * 0.9 * entranceScale);
        idx++;
    }

    particlesMesh.count = idx;
    return idx;
}

// Reuse draw-phase reformed particles directly in fortune (single mode).
function appendStaticMorphToGPU(startIdx = 0) {
    if (!particlesMesh) return startIdx;

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;
    const maxCount = instColor.count;
    const spread = getClusterSpread();
    const breatheAmp = spread * 0.06;

    let idx = startIdx;
    for (const p of morphParticles) {
        if (!p.active || idx >= maxCount) continue;

        const lum = Math.min(1, p.brightness + 0.08);
        const color = lerpColor(lum);
        const char = (p.char && p.char !== ' ')
            ? p.char
            : ((p.finalChar && p.finalChar !== ' ') ? p.finalChar : '\u00B7');

        const breathing = Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;
        _dummy.position.set(p.x, -p.y, -(p.z + breathing));
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);

        instColor.setXYZ(idx, color.r / 255, color.g / 255, color.b / 255);
        instAlpha.setX(idx, 0.3 + lum * 0.7);

        const uv = (p.fontIdx != null && charToUV[char + '|' + p.fontIdx]) || charToUV[char];
        if (uv) instUV.setXY(idx, uv.u, uv.v);

        instScale.setX(idx, cellSize * 1.1);
        idx++;
    }

    particlesMesh.count = idx;
    particlesMesh.instanceMatrix.needsUpdate = true;
    instColor.needsUpdate = true;
    instAlpha.needsUpdate = true;
    instUV.needsUpdate = true;
    instScale.needsUpdate = true;

    return idx;
}

// --- Fortune overlay with gacha-specific reveal ---
function renderFortuneOverlay() {
    // Multi-mode: canvas-integrated particle + card display
    if (isMultiMode && multiFortuneState) {
        // 1. Frosted glass cards (behind particles) — includes 3D flip
        renderMultiCards();
        // 2. GPU particles on top (additive blend + bloom + post-fx)
        updateMultiDajiToGPU(true);
        // 2b. Append arrival flames if active
        if (flamesActive || arrivalParticles.length > 0) {
            const flameIdx = appendArrivalFlamesToGPU(particlesMesh ? particlesMesh.count : 0);
            if (particlesMesh) {
                particlesMesh.count = flameIdx;
                particlesMesh.instanceMatrix.needsUpdate = true;
                particlesMesh.geometry.attributes.instanceColor.needsUpdate = true;
                particlesMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
                particlesMesh.geometry.attributes.instanceUV.needsUpdate = true;
                particlesMesh.geometry.attributes.instanceScale.needsUpdate = true;
            }
        }
        renderAndCompositeGL();
        // 4. Revealed card text (on top of everything)
        renderMultiCardText();
        // 5. Hints
        renderMultiHints();
        return;
    }

    if (!currentDrawResult) {
        updateDajiToGPU(false);
        return;
    }

    const fadeIn = Math.min(1, stateTime / 0.9);
    const dr = currentDrawResult;
    const L = getLayout();

    // --- Single mode ---
    
    // 1. Draw Card Background (behind particles)
    const cardTop = L.cardTop;
    const cardBottom = L.cardBottom;
    const cardW = window.innerWidth * L.cardWidth;
    const cardX = (window.innerWidth - cardW) / 2;
    const cardY = window.innerHeight * cardTop;
    const cardH = window.innerHeight * (cardBottom - cardTop);
    
    const cardFade = Math.min(1, Math.max(0, (stateTime - 0.3) / 0.6));
    if (cardFade > 0.01) {
        // Frosted glass card background (blur + tint)
        drawCard(L.cardTop, L.cardBottom, cardFade * 0.85, L.cardWidth);

        // Traditional Chinese ornamental frame with subtle rarity aura.
        drawChineseOrnamentalBorder(cardX, cardY, cardW, cardH, cardFade * 0.95, dr.rarity.color, dr.rarity.stars);
    }

    // 2. Update GPU particles (skip render)
    let gpuIdx = fortuneUseDrawMorph
        ? appendStaticMorphToGPU(0)
        : updateDajiToGPU(true);

    // 3. Append arrival flames (during draw-to-fortune transition)
    if (flamesActive || arrivalParticles.length > 0) {
        gpuIdx = appendArrivalFlamesToGPU(gpuIdx);
    }

    // 4. Add Stars as GPU particles (stamped in one by one)
    if (cardFade > 0.01 && stateTime > 0.4) {
        gpuIdx = appendStarsToGPU(gpuIdx, dr.rarity.stars, (L.starsY * window.innerHeight) - window.innerHeight/2, dr.rarity.color, stateTime);
    }

    // 5. Commit final particle count and render
    if (particlesMesh) {
        particlesMesh.count = gpuIdx;
        particlesMesh.instanceMatrix.needsUpdate = true;
        particlesMesh.geometry.attributes.instanceColor.needsUpdate = true;
        particlesMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
        particlesMesh.geometry.attributes.instanceUV.needsUpdate = true;
        particlesMesh.geometry.attributes.instanceScale.needsUpdate = true;
    }
    if ((dr.rarity.stars >= 4 && (fwShells.length || fwTrail.length || fwParticles.length)) || hasTapFireworks()) {
        appendFireworksToGPU(gpuIdx);
    } else {
        renderAndCompositeGL();
    }

    // 5. Draw Text (Character + Blessing) on top
    if (dajiFontTransition) {
        const transDur = 1.2;
        const tt = (globalTime - dajiFontTransition.startTime) / transDur;
        if (tt >= 1) {
            dajiFontTransition = null;
            drawOverlayText(dr.char, L.charY, CONFIG.glowGold, fadeIn * 0.9, L.charFontSize, getDajiFont());
        } else {
            renderCharMorph(tt, fadeIn, dajiFontTransition.oldFont, getDajiFont());
        }
    } else if (stateTime < 1.5) {
        renderCharTitleEntrance(stateTime, getDajiFont());
    } else {
        drawOverlayText(dr.char, L.charY, CONFIG.glowGold, fadeIn * 0.9, L.charFontSize, getDajiFont());
    }

    // --- Top card subtitle (use blessing text, not rarity tier) ---
    const tierFade = Math.min(1, Math.max(0, (stateTime - 0.5) / 0.7));
    const tierSizeCn = isLandscape() ? Math.min(cellSize * 1.1, window.innerHeight * 0.025) : cellSize * 1.1;
    const tierSizeEn = isLandscape() ? Math.min(cellSize * 1.0, window.innerHeight * 0.022) : cellSize * 1.0;
    drawOverlayText3D(dr.blessing.phrase, L.tierY, CONFIG.glowRed, tierFade * 0.8, tierSizeCn);
    drawOverlayText3D(dr.blessing.english, L.tierEnY, CONFIG.glowGold, tierFade * 0.8, tierSizeEn);

    // --- Hint to draw again ---
    if (stateTime > 2.5) {
        const hintFade = Math.min(1, (stateTime - 2.5) / 0.5);
        const pulse = 0.4 + Math.sin(globalTime * 3) * 0.2;
        const hopOffset = getSwipeHintHopOffset();
        const { mainText, subText } = getSwipeHintText(selectedMode === 'multi');
        const { hintSize, hintSubSize } = getSwipeHintSizes();
        drawOverlayText(mainText, L.arrivalHintY + hopOffset, CONFIG.glowGold, hintFade * pulse, hintSize);
        drawOverlayText(subText, L.arrivalHintSubY + hopOffset, CONFIG.glowGold, hintFade * pulse, hintSubSize);
    }
}

// ============================================================
// FIREWORKS — Lucky character bursts (for 4+ star draws)
// ============================================================

// Firework color categories (separate from gacha categories)
const FW_CATEGORIES = [
    { chars: '\u798F\u7984\u5BFF\u559C\u8D22', r: 255, g: 45, b: 45 },
    { chars: '\u8D22\u5BCC\u8D35\u53D1\u91D1\u7389\u5B9D\u4F59\u4E30\u76DB\u5229\u65FA', r: 255, g: 215, b: 0 },
    { chars: '\u5B89\u5EB7\u5B81\u6CF0\u548C\u5E73\u987A\u5065', r: 0, g: 255, b: 159 },
    { chars: '\u559C\u4E50\u6B22\u5E86\u79A7\u797A\u5609\u6625', r: 255, g: 120, b: 80 },
    { chars: '\u5FB7\u5584\u4EC1\u4E49\u5FE0\u4FE1\u5B5D\u6167\u6069', r: 255, g: 200, b: 50 },
    { chars: '\u7231\u5408\u5706\u6EE1\u7F8E\u99A8\u96C5', r: 255, g: 130, b: 180 },
    { chars: '\u5409\u7965\u745E\u5982\u610F\u795D\u8FD0', r: 180, g: 255, b: 80 },
    { chars: '\u9F99\u51E4\u9E9F\u9E64\u534E', r: 255, g: 180, b: 50 },
    { chars: '\u6210\u5347\u767B\u9AD8', r: 80, g: 220, b: 255 },
];

const fwShells = [];
const fwTrail = [];
const fwParticles = [];
let fwLaunchTimer = 0;
let fwLaunchCount = 0;

function launchShell() {
    const cat = FW_CATEGORIES[Math.floor(Math.random() * FW_CATEGORIES.length)];
    const launchCol = cols * (0.15 + Math.random() * 0.7);
    const targetCol = launchCol + (Math.random() - 0.5) * cols * 0.12;
    const start = gridToWorld(launchCol, rows + 2);
    const target = gridToWorld(targetCol, rows * (0.1 + Math.random() * 0.3));
    const startZ = (Math.random() - 0.5) * cellSize * 8;
    fwShells.push({
        x: start.x,
        y: start.y,
        z: startZ,
        startX: start.x,
        startY: start.y,
        startZ,
        targetX: target.x,
        targetY: target.y,
        targetZ: (Math.random() - 0.5) * cellSize * 12,
        launchTime: globalTime,
        duration: CONFIG.shellRiseDuration * (0.85 + Math.random() * 0.3),
        cat,
    });
    fwLaunchCount++;
}

function burstShell(shell) {
    const count = 35 + Math.floor(Math.random() * 25);
    const { chars, r, g, b } = shell.cat;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
        const speed = cellSize * (0.08 + Math.random() * 0.08);
        fwParticles.push({
            x: shell.x, y: shell.y, z: shell.z,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            vz: (Math.random() - 0.5) * speed * 0.4,
            char: chars[Math.floor(Math.random() * chars.length)],
            r, g, b,
            life: 0.4 + Math.random() * 0.25,
            decay: 0.012 + Math.random() * 0.010,
            gravity: cellSize * (0.0005 + Math.random() * 0.0008),
            drag: 0.975,
            trailSegs: [],
            lastTrailTime: globalTime,
        });
    }
}

// --- Tap-to-burst firework at screen coordinates ---
function tapBurstAtScreen(screenX, screenY) {
    // Convert screen coords to world coords (at z=0, scale=1)
    const worldX = screenX - window.innerWidth / 2;
    const worldY = screenY - window.innerHeight / 2;
    const cat = FW_CATEGORIES[Math.floor(Math.random() * FW_CATEGORIES.length)];
    const count = 30 + Math.floor(Math.random() * 20);
    const { chars, r, g, b } = cat;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
        const speed = cellSize * (0.06 + Math.random() * 0.07);
        fwParticles.push({
            x: worldX, y: worldY, z: (Math.random() - 0.5) * cellSize * 4,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            vz: (Math.random() - 0.5) * speed * 0.4,
            char: chars[Math.floor(Math.random() * chars.length)],
            r, g, b,
            life: 0.4 + Math.random() * 0.25,
            decay: 0.012 + Math.random() * 0.010,
            gravity: cellSize * (0.0005 + Math.random() * 0.0008),
            drag: 0.975,
            trailSegs: [],
            lastTrailTime: globalTime,
        });
    }
}

function hasTapFireworks() {
    return fwParticles.length > 0 || fwShells.length > 0 || fwTrail.length > 0;
}

function initFireworks() {
    fwShells.length = 0;
    fwTrail.length = 0;
    fwParticles.length = 0;
    fwLaunchTimer = 0;
    fwLaunchCount = 0;

    for (let i = 0; i < 2; i++) {
        launchShell();
    }
}

function updateFireworkPhysics() {
    // Auto-launch on a timer (only during fortune state with 4+ star draws)
    if (state === 'fortune' && currentDrawResult && currentDrawResult.rarity.stars >= 4) {
        fwLaunchTimer--;
        if (fwLaunchTimer <= 0) {
            launchShell();
            fwLaunchTimer = fwLaunchCount < 3
                ? 40 + Math.random() * 30
                : 70 + Math.random() * 80;
        }
    }

    const halfW = cols * cellSize * 0.5;
    const halfH = rows * cellSize * 0.5;

    // Shells
    let sw = 0;
    for (let i = 0; i < fwShells.length; i++) {
        const s = fwShells[i];
        const t = (globalTime - s.launchTime) / s.duration;
        const eased = 1 - Math.pow(1 - Math.min(t, 1), 2);
        s.x = lerp(s.startX, s.targetX, eased);
        s.y = lerp(s.startY, s.targetY, eased);
        s.z = lerp(s.startZ, s.targetZ, eased);

        const trailSpawn = Math.max(1, Math.floor((1 - eased) * 2.8));
        for (let j = 0; j < trailSpawn; j++) {
            fwTrail.push({
                x: s.x + (Math.random() - 0.5) * cellSize * 0.35,
                y: s.y + cellSize * (0.12 + Math.random() * 0.32),
                z: s.z + (Math.random() - 0.5) * cellSize * 0.6,
                vx: (Math.random() - 0.5) * cellSize * 0.03,
                vy: cellSize * (0.07 + Math.random() * 0.04),
                vz: (Math.random() - 0.5) * cellSize * 0.03,
                char: '\u00B7',
                r: s.cat.r, g: s.cat.g, b: s.cat.b,
                life: 0.35 + Math.random() * 0.45,
                decay: 0.03 + Math.random() * 0.04,
            });
        }
        if (t >= 1) {
            burstShell(s);
        } else {
            fwShells[sw++] = s;
        }
    }
    fwShells.length = sw;

    // Shell trails
    let trw = 0;
    for (let i = 0; i < fwTrail.length; i++) {
        const t = fwTrail[i];
        t.x += t.vx;
        t.y += t.vy;
        t.z += t.vz;
        t.vx *= 0.95;
        t.vz *= 0.95;
        t.life -= t.decay;
        if (t.life > 0 && t.y <= halfH + cellSize * 3) fwTrail[trw++] = t;
    }
    fwTrail.length = trw;

    // Particles
    const FW_TRAIL_INTERVAL = 0.06;
    const FW_MAX_TRAIL_SEGS = 14;
    let pw = 0;
    for (let i = 0; i < fwParticles.length; i++) {
        const p = fwParticles[i];
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.vz *= p.drag;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.life -= p.decay;

        if (globalTime - p.lastTrailTime >= FW_TRAIL_INTERVAL && p.life > 0.05) {
            p.trailSegs.push({ x: p.x, y: p.y, z: p.z });
            p.lastTrailTime = globalTime;
            if (p.trailSegs.length > FW_MAX_TRAIL_SEGS) p.trailSegs.shift();
        }

        if (
            p.life > 0
            && p.y <= halfH + cellSize * 6
            && p.x >= -halfW - cellSize * 8
            && p.x <= halfW + cellSize * 8
            && p.z >= -SCENE_FOV * 0.9
            && p.z <= SCENE_FOV * 1.5
        ) {
            fwParticles[pw++] = p;
        }
    }
    fwParticles.length = pw;
}

function renderFireworks3D() {
    const glyphs = [];

    for (const s of fwShells) {
        glyphs.push({
            x: s.x,
            y: s.y,
            z: s.z,
            char: '\u00B7',
            r: s.cat.r,
            g: s.cat.g,
            b: s.cat.b,
            alpha: 0.9,
            size: 1.0,
            glow: 1.0,
            blur: 0.9,
        });
    }

    for (const t of fwTrail) {
        glyphs.push({
            x: t.x,
            y: t.y,
            z: t.z,
            char: t.char,
            r: t.r,
            g: t.g,
            b: t.b,
            alpha: t.life * 0.7,
            size: 0.7 + t.life * 0.3,
            glow: 0.9,
            blur: 0.85,
        });
    }

    for (const p of fwParticles) {
        const alpha = Math.max(0.05, p.life * p.life);
        glyphs.push({
            x: p.x,
            y: p.y,
            z: p.z,
            char: p.char,
            r: p.r,
            g: p.g,
            b: p.b,
            alpha,
            size: 0.92 + alpha * 0.5,
            glow: 0.65,
            blur: 0.62,
        });

        const segCount = p.trailSegs.length;
        for (let ti = 0; ti < segCount; ti++) {
            const seg = p.trailSegs[ti];
            const ageFrac = segCount > 1 ? ti / (segCount - 1) : 1;
            const segAlpha = alpha * (0.2 + ageFrac * 0.6);
            glyphs.push({
                x: seg.x,
                y: seg.y,
                z: seg.z,
                char: p.char,
                r: p.r,
                g: p.g,
                b: p.b,
                alpha: segAlpha,
                size: 0.6 + ageFrac * 0.35,
                glow: 0.5,
                blur: 0.5,
            });
        }
    }

    updateProjectedGlyphsToGPU(glyphs);
}

// Append firework particles to GPU buffer starting at startIdx (after daji particles)
function appendFireworksToGPU(startIdx) {
    if (!particlesMesh) return;

    const instColor = particlesMesh.geometry.attributes.instanceColor;
    const instAlpha = particlesMesh.geometry.attributes.instanceAlpha;
    const instUV = particlesMesh.geometry.attributes.instanceUV;
    const instScale = particlesMesh.geometry.attributes.instanceScale;
    const maxCount = instColor.count;

    let idx = startIdx;

    for (const s of fwShells) {
        if (idx >= maxCount) break;
        _dummy.position.set(s.x, -s.y, -s.z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);
        instColor.setXYZ(idx, s.cat.r / 255, s.cat.g / 255, s.cat.b / 255);
        instAlpha.setX(idx, 0.9);
        const uv = charToUV['\u00B7'];
        if (uv) instUV.setXY(idx, uv.u, uv.v);
        instScale.setX(idx, cellSize);
        idx++;
    }

    for (const t of fwTrail) {
        if (idx >= maxCount) break;
        _dummy.position.set(t.x, -t.y, -t.z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);
        instColor.setXYZ(idx, t.r / 255, t.g / 255, t.b / 255);
        instAlpha.setX(idx, t.life * 0.7);
        const uv = charToUV[t.char];
        if (uv) instUV.setXY(idx, uv.u, uv.v);
        instScale.setX(idx, cellSize * (0.7 + t.life * 0.3));
        idx++;
    }

    for (const p of fwParticles) {
        if (idx >= maxCount) break;
        const alpha = Math.max(0.05, p.life * p.life);
        _dummy.position.set(p.x, -p.y, -p.z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(idx, _dummy.matrix);
        instColor.setXYZ(idx, p.r / 255, p.g / 255, p.b / 255);
        instAlpha.setX(idx, alpha);
        const uv = charToUV[p.char];
        if (uv) instUV.setXY(idx, uv.u, uv.v);
        instScale.setX(idx, cellSize * (0.92 + alpha * 0.5));
        idx++;

        const segCount = p.trailSegs.length;
        for (let ti = 0; ti < segCount; ti++) {
            if (idx >= maxCount) break;
            const seg = p.trailSegs[ti];
            const ageFrac = segCount > 1 ? ti / (segCount - 1) : 1;
            const segAlpha = alpha * (0.2 + ageFrac * 0.6);
            const segScale = cellSize * (0.6 + ageFrac * 0.35);
            _dummy.position.set(seg.x, -seg.y, -seg.z);
            _dummy.updateMatrix();
            particlesMesh.setMatrixAt(idx, _dummy.matrix);
            instColor.setXYZ(idx, p.r / 255, p.g / 255, p.b / 255);
            instAlpha.setX(idx, segAlpha);
            if (uv) instUV.setXY(idx, uv.u, uv.v);
            instScale.setX(idx, segScale);
            idx++;
        }
    }

    particlesMesh.count = idx;
    particlesMesh.instanceMatrix.needsUpdate = true;
    instColor.needsUpdate = true;
    instAlpha.needsUpdate = true;
    instUV.needsUpdate = true;
    instScale.needsUpdate = true;

    renderAndCompositeGL();
}

// ============================================================
// MULTI-PULL (10-pull) SYSTEM
// ============================================================

const modeSwitch = document.getElementById('mode-switch');
const multiOverlay = document.getElementById('multi-overlay');
const multiGrid = document.getElementById('multi-grid');
const multiDetail = document.getElementById('multi-detail');
const detailCard = document.getElementById('detail-card');
let multiDetailShowTime = 0; // Guard against synthetic click dismissing detail on mobile
const btnMultiSingle = document.getElementById('btn-multi-single');
const btnMultiCollection = document.getElementById('btn-multi-collection');
const btnMultiAgain = document.getElementById('btn-multi-again');

let selectedMode = 'single'; // 'single' or 'multi'

if (modeSwitch) {
    modeSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedMode = selectedMode === 'single' ? 'multi' : 'single';
        updateModeSwitchUI();
    });
}

function updateModeSwitchUI() {
    if (!modeSwitch) return;
    if (selectedMode === 'multi') {
        modeSwitch.classList.add('multi');
    } else {
        modeSwitch.classList.remove('multi');
    }
}

async function startMultiPull() {
    const pity = getPityCounter();
    const { draws, newPityCounter } = performMultiDrawWithPity(pity);
    multiDrawResults = draws;
    saveMultiToCollection(multiDrawResults);
    const user = getUser();
    if (user) {
        user.pity_counter = newPityCounter;
        await setPityCounter(newPityCounter);
    }

    // Find the best (highest rarity, i.e., lowest tierIndex) result
    let best = multiDrawResults[0];
    for (const d of multiDrawResults) {
        if (d.tierIndex < best.tierIndex) best = d;
    }
    currentDrawResult = best;
    bestStarsInBatch = best.rarity.stars;
    isMultiMode = true;
    multiFlipState = null;
    multiFortuneState = null;

    // Reset state for draw animation
    meteorParticles = [];
    resetCam();
    daji3DParticles = [];
    hoveredIdx = -1;
    if (particlesMesh) particlesMesh.count = 0;
    hideTooltip();
    hideHoverDetail();

    // Hide action buttons
    const btnRevealAll = document.getElementById('btn-reveal-all');
    if (btnRevealAll) btnRevealAll.style.display = 'none';

    if (btnMultiSingle) btnMultiSingle.style.display = 'none';
    if (btnMultiCollection) btnMultiCollection.style.display = 'none';
    if (btnMultiAgain) btnMultiAgain.style.display = 'none';

    changeState('draw');
}

async function attemptPaidPull(mode = selectedMode) {
    const drawsNeeded = mode === 'multi' ? 10 : 1;
    const user = getUser() || await ensureUser();

    if (!user || user.draws_remaining < drawsNeeded) {
        showRewardsPanel();
        return false;
    }

    let spent = false;
    try {
        spent = await spendDraws(drawsNeeded);
    } catch (err) {
        showRewardsPanel();
        return false;
    }
    if (!spent) {
        showRewardsPanel();
        return false;
    }

    try {
        if (state === 'fortune' && isMultiMode) {
            resetMultiFortune();
        }

        if (state === 'fortune') {
            daji3DParticles = [];
            hoveredIdx = -1;
            if (particlesMesh) particlesMesh.count = 0;
            hideTooltip();
        }

        if (mode === 'multi') {
            await startMultiPull();
        } else {
            isMultiMode = false;
            changeState('draw');
        }
    } catch (err) {
        return false;
    }
    return true;
}
// ... (triggerScreenFlash, etc.)

// ... (showMultiCardsWithFlip calls updateMultiActionsVisibility)

function onAllCardsRevealed() {
    updateMultiActionsVisibility(true);
}

function updateMultiActionsVisibility(allRevealed) {
    const btnRevealAll = document.getElementById('btn-reveal-all');
    if (btnRevealAll) btnRevealAll.style.display = allRevealed ? 'none' : 'block';
    
    // Show action buttons when revealed
    if (btnMultiSingle) btnMultiSingle.style.display = allRevealed ? 'block' : 'none';
    if (btnMultiCollection) btnMultiCollection.style.display = allRevealed ? 'block' : 'none';
    if (btnMultiAgain) btnMultiAgain.style.display = allRevealed ? 'block' : 'none';
}

// --- Screen flash for high rarity card flips ---
function triggerScreenFlash(stars) {
    const flash = document.createElement('div');
    flash.className = 'multi-screen-flash flash-' + stars;
    document.body.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove());
}

// --- Hover tooltip element ---
const multiHoverTip = document.createElement('div');
multiHoverTip.id = 'multi-hover-tip';
multiHoverTip.innerHTML = `
    <div class="mht-category"></div>
    <div class="mht-phrase"></div>
    <div class="mht-english"></div>
`;
document.body.appendChild(multiHoverTip);

function showHoverDetail(cardEl, draw) {
    multiHoverTip.querySelector('.mht-category').textContent = draw.category.name;
    multiHoverTip.querySelector('.mht-phrase').textContent = draw.blessing.phrase;
    multiHoverTip.querySelector('.mht-english').textContent = draw.blessing.english;

    const rect = cardEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - 100;
    let top = rect.top - 70;
    if (top < 8) top = rect.bottom + 8;
    left = Math.max(8, Math.min(window.innerWidth - 208, left));

    multiHoverTip.style.left = left + 'px';
    multiHoverTip.style.top = top + 'px';
    multiHoverTip.style.opacity = '1';
}

function hideHoverDetail() {
    multiHoverTip.style.opacity = '0';
}

function showMultiCardsWithFlip(draws) {
    if (!draws || !draws.length) return;
    if (!multiGrid || !multiOverlay) return;

    multiFlipState = { revealedCount: 0, cardElements: [] };
    multiGrid.innerHTML = '';

    draws.forEach((draw, i) => {
        const card = document.createElement('div');
        card.className = 'multi-card';
        card.dataset.index = i;
        card.dataset.rarity = draw.rarity.stars;
        card.style.setProperty('--mc-color', draw.rarity.color);
        card.style.setProperty('--mc-glow', draw.rarity.glow);
        card.style.animationDelay = (i * 0.06) + 's';

        const flipper = document.createElement('div');
        flipper.className = 'card-flipper';

        // Card back
        const back = document.createElement('div');
        back.className = 'card-face card-back';
        back.innerHTML = `
            <div class="card-back-pattern"></div>
            <div class="card-back-fu">\u798F</div>
            <div class="card-back-border"></div>
        `;

        // Card front
        const front = document.createElement('div');
        front.className = 'card-face card-front';
        front.style.setProperty('--mc-color', draw.rarity.color);
        front.style.setProperty('--mc-glow', draw.rarity.glow);

        const starsStr = '\u2605'.repeat(draw.rarity.stars) + '\u2606'.repeat(Math.max(0, 7 - draw.rarity.stars));
        front.innerHTML = `
            <div class="card-front-inner">
                <div class="mc-stars">${starsStr}</div>
                <div class="mc-char">${escapeHtml(draw.char)}</div>
                <div class="mc-phrase">${escapeHtml(draw.blessing.phrase)}</div>
            </div>
            <div class="card-rarity-glow"></div>
        `;

        flipper.appendChild(back);
        flipper.appendChild(front);
        card.appendChild(flipper);

        // Click handler
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (card.classList.contains('flipped')) {
                showMultiDetail(draw);
                return;
            }
            // Prevent double-click during anticipation
            if (card.classList.contains('anticipate-5') || card.classList.contains('anticipate-6') || card.classList.contains('anticipate-7')) return;

            const stars = draw.rarity.stars;
            if (stars >= 5) {
                // Slow-motion: anticipation shake → slow flip → screen flash
                const anticClass = 'anticipate-' + stars;
                const slowClass = 'slow-flip-' + stars;
                card.classList.add(anticClass);
                const anticDuration = stars >= 7 ? 1000 : (stars >= 6 ? 700 : 500);
                setTimeout(() => {
                    card.classList.remove(anticClass);
                    card.classList.add(slowClass);
                    // Force reflow so browser registers the base transform before flipping
                    void card.offsetHeight;
                    card.classList.add('flipped');
                    triggerScreenFlash(stars);
                    multiFlipState.revealedCount++;
                    if (multiFlipState.revealedCount >= draws.length) {
                        onAllCardsRevealed();
                    }
                }, anticDuration);
            } else {
                card.classList.add('flipped');
                multiFlipState.revealedCount++;
                if (multiFlipState.revealedCount >= draws.length) {
                    onAllCardsRevealed();
                }
            }
        });

        // Hover for revealed cards
        card.addEventListener('mouseenter', () => {
            if (card.classList.contains('flipped')) {
                showHoverDetail(card, draw);
            }
        });
        card.addEventListener('mouseleave', () => {
            hideHoverDetail();
        });

        multiGrid.appendChild(card);
        multiFlipState.cardElements.push(card);
    });

    multiOverlay.classList.add('visible');
    updateMultiActionsVisibility(false);
    updateUIVisibility();
}

function showMultiDetail(draw) {
    const detailStars = document.getElementById('detail-stars');
    const detailCategory = document.getElementById('detail-category');
    const detailCharacter = document.getElementById('detail-character');
    const detailCharEn = document.getElementById('detail-char-en');
    const detailSoundBtn = document.getElementById('btn-detail-sound');
    const detailPhrase = document.getElementById('detail-phrase');
    const detailEnglish = document.getElementById('detail-english');
    const detailMeaning = document.getElementById('detail-meaning');

    detailCard.style.setProperty('--card-color', draw.rarity.color);
    detailCard.style.setProperty('--card-glow', draw.rarity.glow);
    for (let i = 1; i <= 7; i++) detailCard.classList.remove('stars-' + i);
    detailCard.classList.add('stars-' + Math.max(1, Math.min(7, draw.rarity.stars || 1)));

    detailStars.textContent = '\u2605'.repeat(draw.rarity.stars) + '\u2606'.repeat(Math.max(0, 7 - draw.rarity.stars));
    detailStars.style.color = draw.rarity.color;
    detailCategory.innerHTML = escapeHtml(draw.rarity.label) + '<br><span class="detail-category-en">' + escapeHtml(draw.rarity.labelEn) + '</span>';
    detailCategory.style.color = draw.rarity.color;
    detailCharacter.textContent = draw.char;

    // English name of the character
    const charEn = draw.blessing ? draw.blessing.charEn : '';
    detailCharEn.textContent = charEn || '';

    // Idiom
    detailPhrase.textContent = draw.blessing ? draw.blessing.phrase : '';
    detailEnglish.textContent = draw.blessing ? draw.blessing.english : '';

    // Meaning section — bilingual explanation
    if (detailMeaning && draw.blessing) {
        const meaningCn = '\u300C' + draw.char + '\u300D\u2014\u2014' + draw.blessing.phrase;
        const meaningEn = '"' + (charEn || draw.char) + '" \u2014 ' + draw.blessing.english;
        detailMeaning.innerHTML = '<span style="color:rgba(255,215,0,0.5)">' + escapeHtml(meaningCn) + '</span><br>' + escapeHtml(meaningEn);
    }

    // TTS: Character pronunciation (button under the detail card)
    if (detailSoundBtn) {
        detailSoundBtn.classList.remove('playing');
        detailSoundBtn.title = `Play pronunciation: ${draw.char}`;
        detailSoundBtn.onclick = () => speakText(draw.char, 'zh-CN', detailSoundBtn);
    }

    multiDetail.classList.add('visible');
    multiDetailShowTime = performance.now();

    // Pass to monetization UI for share/gift buttons
    const coll = loadCollection();
    setDetailDraw(draw, coll[draw.char] || null);
}

// --- Text-to-Speech helper ---
function speakText(text, lang, btnEl) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang || 'zh-CN';
    utter.rate = 0.85;
    utter.pitch = 1;
    if (btnEl) btnEl.classList.add('playing');
    utter.onend = () => { if (btnEl) btnEl.classList.remove('playing'); };
    utter.onerror = () => { if (btnEl) btnEl.classList.remove('playing'); };
    window.speechSynthesis.speak(utter);
}

function hideMultiDetail() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    const detailSoundBtn = document.getElementById('btn-detail-sound');
    if (detailSoundBtn) detailSoundBtn.classList.remove('playing');
    multiDetail.classList.remove('visible');
}

function hideMultiOverlay() {
    if (multiOverlay) multiOverlay.classList.remove('visible');
    if (multiDetail) multiDetail.classList.remove('visible');
    hideHoverDetail();
    multiFlipState = null;
    isMultiMode = false;
    multiDrawResults = null;
}

// Multi-fortune action buttons (now floating over canvas)
if (btnMultiSingle) {
    btnMultiSingle.addEventListener('click', async (e) => {
        e.stopPropagation();
        selectedMode = 'single';
        updateModeSwitchUI();
        await attemptPaidPull('single');
    });
}

if (btnMultiAgain) {
    btnMultiAgain.addEventListener('click', async (e) => {
        e.stopPropagation();
        await attemptPaidPull('multi');
    });
}

if (btnMultiCollection) {
    btnMultiCollection.addEventListener('click', (e) => {
        e.stopPropagation();
        // Hide multi action buttons while collection is open (don't reset state)
        if (btnMultiSingle) btnMultiSingle.style.display = 'none';
        if (btnMultiCollection) btnMultiCollection.style.display = 'none';
        if (btnMultiAgain) btnMultiAgain.style.display = 'none';
        showCollectionPanel();
    });
}

// Reveal All button — now reveals canvas cards
const btnRevealAll = document.getElementById('btn-reveal-all');
if (btnRevealAll) {
    btnRevealAll.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!multiFortuneState || !multiDrawResults) return;
        let delay = 0;
        for (let i = 0; i < multiFortuneState.cards.length; i++) {
            const card = multiFortuneState.cards[i];
            if (!card.revealed && !card.anticipating && !card.converging) {
                const idx = i;
                const stars = card.draw.rarity.stars;
                setTimeout(() => revealCard(idx), delay);
                // Add extra time for anticipation + convergence animations
                delay += stars >= 7 ? 2500 : (stars >= 6 ? 1800 : (stars >= 5 ? 1200 : 400));
            }
        }
    });
}

// Detail popup — click to dismiss
if (multiDetail) {
    multiDetail.addEventListener('click', (e) => {
        // Guard: ignore synthetic click from the touch that opened the detail (mobile)
        if (e.target === multiDetail && performance.now() - multiDetailShowTime > 400) {
            hideMultiDetail();
        }
    });
}

// ============================================================
// COLLECTION PANEL
// ============================================================

const btnCollection = document.getElementById('btn-collection');
const collectionPanel = document.getElementById('collection-panel');
const collectionGrid = document.getElementById('collection-grid');
const collectionProgress = document.getElementById('collection-progress');
const btnCloseCollection = document.getElementById('btn-close-collection');

function showCollectionPanel() {
    const progress = getCollectionProgress();
    const categories = getCollectionByCategory();

    // Update progress — right half of status row
    if (collectionProgress) {
        collectionProgress.className = 'collection-progress-center';
        const r = 38, circ = 2 * Math.PI * r;
        const offset = circ - (circ * progress.percentage / 100);
        collectionProgress.innerHTML =
            `<div class="progress-ring-wrap">
                <svg viewBox="0 0 90 90">
                    <defs>
                        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="rgba(255,180,0,0.7)"/>
                            <stop offset="50%" stop-color="#FFD700"/>
                            <stop offset="100%" stop-color="rgba(255,240,160,1)"/>
                        </linearGradient>
                    </defs>
                    <circle class="progress-ring-bg" cx="45" cy="45" r="${r}"/>
                    <circle class="progress-ring-glow" cx="45" cy="45" r="${r}"
                        stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
                    <circle class="progress-ring-fill" cx="45" cy="45" r="${r}"
                        stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
                </svg>
                <div class="progress-ring-center">
                    <span class="progress-pct">${progress.percentage}<span class="progress-pct-sign">%</span></span>
                </div>
            </div>
            <div class="progress-stats">
                <div>
                    <div class="stat-row">
                        <span class="stat-row-value">${progress.collected}</span>
                        <span class="stat-row-divider">/</span>
                        <span class="stat-row-total">${progress.total}</span>
                    </div>
                    <div class="stat-row-label">Collected</div>
                </div>
            </div>`;
        // Animate ring fill after paint
        requestAnimationFrame(() => {
            const fillCircle = collectionProgress.querySelector('.progress-ring-fill');
            const glowCircle = collectionProgress.querySelector('.progress-ring-glow');
            if (fillCircle) fillCircle.style.strokeDashoffset = offset;
            if (glowCircle) glowCircle.style.strokeDashoffset = offset;
        });
    }

    // Build grid
    if (collectionGrid) {
        collectionGrid.className = 'collection-content';
        collectionGrid.innerHTML = '';
        
        let cardIdx = 0;
        categories.forEach((cat, idx) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'collection-category-group';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'collection-category-title';
            const collectedInCat = cat.items.filter(it => it.collected).length;
            titleDiv.innerHTML = `${escapeHtml(cat.nameEn)} <span>${escapeHtml(cat.name)}</span><span class="collection-category-count">${Number(collectedInCat)}/${Number(cat.items.length)}</span>`;
            groupDiv.appendChild(titleDiv);

            const gridDiv = document.createElement('div');
            gridDiv.className = 'collection-grid-new';

            for (const item of cat.items) {
                const card = document.createElement('div');
                const isCollected = item.collected;
                // Use maxStars if collected, otherwise baseStars from character data
                const baseStars = (item.blessing && item.blessing.baseStars) || 2;
                const stars = isCollected ? Math.max(item.maxStars, baseStars) : baseStars;

                let rarityClass = '';
                if (stars >= 7) rarityClass = ' r7';
                else if (stars >= 6) rarityClass = ' r6';
                else if (stars === 5) rarityClass = ' r5';
                
                card.className = `collection-card ${isCollected ? 'collected' : 'uncollected'}${rarityClass}`;
                
                // Content
                const charText = item.char;
                const charEnText = (item.blessing && item.blessing.charEn) ? item.blessing.charEn : '';
                const nameText = item.blessing ? item.blessing.phrase : '???';

                card.innerHTML = `
                    <div class="card-inner">
                        <div class="card-char">${escapeHtml(charText)}</div>
                        <div class="card-english">${escapeHtml(charEnText)}</div>
                        <div class="card-meta">
                            <div class="card-name">${escapeHtml(nameText)}</div>
                            <div class="card-stars">${'\u2605'.repeat(stars)}</div>
                        </div>
                    </div>
                `;

                // Stagger the entry animation per card
                const charEl = card.querySelector('.card-char');
                if (charEl) {
                    const delay = (cardIdx * 0.04) + 's';
                    charEl.style.animationDelay = `${delay}, calc(${delay} + 0.6s)`;
                }
                cardIdx++;

                if (isCollected) {
                    card.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Find rarity object from RARITY_TIERS matching stars
                        const rarity = RARITY_TIERS.find(t => t.stars === stars) || RARITY_TIERS[5]; // default to lowest
                        
                        const drawObj = {
                            char: item.char,
                            rarity: rarity,
                            category: cat, // cat has name, nameEn, color from getCollectionByCategory
                            blessing: item.blessing
                        };
                        showMultiDetail(drawObj);
                    });
                }
                
                gridDiv.appendChild(card);
            }

            groupDiv.appendChild(gridDiv);
            collectionGrid.appendChild(groupDiv);
        });
    }

    if (collectionPanel) collectionPanel.classList.add('visible');
    updateUIVisibility();
}

function hideCollectionPanel() {
    if (collectionPanel) collectionPanel.classList.remove('visible');
    updateUIVisibility();
}

if (btnCollection) {
    btnCollection.addEventListener('click', (e) => {
        e.stopPropagation();
        showCollectionPanel();
    });
}

if (btnCloseCollection) {
    btnCloseCollection.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCollectionPanel();
    });
}

// ============================================================
// UI VISIBILITY
// ============================================================

function updateUIVisibility() {
    const allMultiRevealed = multiFortuneState && multiFortuneState.revealedCount >= multiFortuneState.cards.length;
    const hasPendingMultiReveals = multiFortuneState && multiFortuneState.revealedCount < multiFortuneState.cards.length;
    const collVisible = collectionPanel && collectionPanel.classList.contains('visible');
    // Mode Switch: visible in arrival, single fortune, and multi fortune after all revealed
    if (modeSwitch) {
        if (!isOverlayActive && !collVisible && (state === 'arrival' || (state === 'fortune' && (!isMultiMode || allMultiRevealed))) && fontsReady) {
            modeSwitch.classList.add('visible');
        } else {
            modeSwitch.classList.remove('visible');
        }
    }

    // Collection FAB: visible in arrival, single fortune, and multi fortune after all revealed
    if (btnCollection) {
        if (!isOverlayActive && !collVisible && (state === 'arrival' || (state === 'fortune' && (!isMultiMode || allMultiRevealed)))) {
            btnCollection.classList.add('visible');
        } else {
            btnCollection.classList.remove('visible');
        }
    }

    // Draw counter: visible together with collection and toggle
    const drawCounterFloat = document.getElementById('draw-counter-float');
    if (drawCounterFloat) {
        if (!isOverlayActive && !collVisible && (state === 'arrival' || (state === 'fortune' && (!isMultiMode || allMultiRevealed)))) {
            drawCounterFloat.classList.add('visible');
        } else {
            drawCounterFloat.classList.remove('visible');
        }
    }

    // Mute button: visible when overlay is gone
    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
        if (!isOverlayActive) {
            btnMute.classList.add('visible');
        } else {
            btnMute.classList.remove('visible');
        }
    }

    // Reveal All button: visible when multi-fortune cards are showing and not all revealed
    const btnRevealAll = document.getElementById('btn-reveal-all');
    if (btnRevealAll) {
        if (state === 'fortune' && isMultiMode && hasPendingMultiReveals) {
            btnRevealAll.style.display = 'block';
        } else {
            btnRevealAll.style.display = 'none';
        }
    }

    // Multi share button: only after all multi cards are revealed
    if (state === 'fortune' && isMultiMode && allMultiRevealed && !collVisible) {
        showMultiShareButton();
    } else {
        hideMultiShareButton();
    }

}

// ============================================================
// SWIPE / TAP / HOVER
// ============================================================
let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
let touchMoved = false;
let touchHoldTimer = null;
let touchLastX = 0, touchLastY = 0;
let lastTouchEndTime = 0; // Prevent synthesized mouse events on mobile

canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    touchStartTime = performance.now();
    touchMoved = false;
    if (touchHoldTimer) clearTimeout(touchHoldTimer);
    if (state === 'fortune' && !multiFortuneState) {
        touchHoldTimer = setTimeout(() => {
            if (!touchMoved) updateHover(touchLastX, touchLastY);
        }, 250);
    }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    if (Math.abs(t.clientX - touchStartX) > 10 || Math.abs(t.clientY - touchStartY) > 10) {
        touchMoved = true;
        if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; }
    }
    if (state === 'fortune' && !multiFortuneState) updateHover(t.clientX, t.clientY);
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
    if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = null; }
    lastTouchEndTime = performance.now();
    hoveredIdx = -1;
    hideTooltip();
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - touchStartX;
    const dy = touchStartY - endY;
    const dt = performance.now() - touchStartTime;

    // Multi-fortune card tap detection
    if (state === 'fortune' && isMultiMode && multiFortuneState && !touchMoved && dt < 300) {
        const cardIdx = hitTestMultiCard(endX, endY);
        if (cardIdx >= 0) {
            const card = multiFortuneState.cards[cardIdx];
            if (!card.revealed) {
                revealCard(cardIdx);
            } else if (!card.flipping || (globalTime - card.flipStartTime > 0.55)) {
                showMultiDetail(card.draw);
            }
            return;
        }
        // Tap on "点击翻开" hint text → reveal next unrevealed card
        if (hitTestMultiHint(endX, endY) && multiFortuneState.revealedCount < multiFortuneState.cards.length) {
            revealNextUnrevealedCard();
            return;
        }
    }

    if (state === 'fortune' && !isMultiMode && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
        cycleDajiFont(dx > 0 ? 1 : -1);
    } else if (dy > 50 && dt < 500) {
        handleSwipeUp();
    } else if (!touchMoved && dt < 300 && (state === 'arrival' || (state === 'fortune' && !multiFortuneState))) {
        // Single-pull fortune: tap on character card → show detail popup
        if (state === 'fortune' && !isMultiMode && hitTestSingleFortuneCard(endX, endY)) {
            showMultiDetail(currentDrawResult);
            return;
        }
        // Tap → firework burst
        tapBurstAtScreen(endX, endY);
    }
}, { passive: true });

// Desktop hover
canvas.addEventListener('mousemove', (e) => {
    if (state === 'fortune' && !multiFortuneState && mouseDown) updateHover(e.clientX, e.clientY);
});
canvas.addEventListener('mouseleave', () => {
    hoveredIdx = -1;
    hideTooltip();
});

// Desktop mouse drag
let mouseStartX = 0, mouseStartY = 0, mouseDown = false;
let mouseHoldTimer = null;
canvas.addEventListener('mousedown', (e) => {
    // Skip synthesized mouse events from touch (within 500ms of last touch)
    if (performance.now() - lastTouchEndTime < 500) return;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseDown = true;
    if (mouseHoldTimer) clearTimeout(mouseHoldTimer);
    if (state === 'fortune' && !multiFortuneState) {
        mouseHoldTimer = setTimeout(() => {
            updateHover(e.clientX, e.clientY);
        }, 250);
    }
});
canvas.addEventListener('mouseup', (e) => {
    if (mouseHoldTimer) { clearTimeout(mouseHoldTimer); mouseHoldTimer = null; }
    // Skip synthesized mouse events from touch
    if (performance.now() - lastTouchEndTime < 500) { mouseDown = false; return; }
    hoveredIdx = -1;
    hideTooltip();
    if (mouseDown) {
        const dy = mouseStartY - e.clientY;
        const dx = Math.abs(e.clientX - mouseStartX);

        // Multi-fortune card click detection
        if (state === 'fortune' && isMultiMode && multiFortuneState && dy < 20 && dx < 20) {
            const cardIdx = hitTestMultiCard(e.clientX, e.clientY);
            if (cardIdx >= 0) {
                const card = multiFortuneState.cards[cardIdx];
                if (!card.revealed) {
                    revealCard(cardIdx);
                } else if (!card.flipping || (globalTime - card.flipStartTime > 0.55)) {
                    showMultiDetail(card.draw);
                }
                mouseDown = false;
                return;
            }
            // Click on "点击翻开" hint text → reveal next unrevealed card
            if (hitTestMultiHint(e.clientX, e.clientY) && multiFortuneState.revealedCount < multiFortuneState.cards.length) {
                revealNextUnrevealedCard();
                mouseDown = false;
                return;
            }
        }

        if (dy > 50) {
            handleSwipeUp();
        } else if (dy < 20 && dx < 20 && (state === 'arrival' || state === 'fortune')) {
            // Single-pull fortune: click on character card → show detail popup
            if (state === 'fortune' && !isMultiMode && hitTestSingleFortuneCard(e.clientX, e.clientY)) {
                showMultiDetail(currentDrawResult);
                mouseDown = false;
                return;
            }
            // Click → firework burst
            tapBurstAtScreen(e.clientX, e.clientY);
        }
    }
    mouseDown = false;
});

// Desktop scroll wheel
canvas.addEventListener('wheel', (e) => {
    if (e.deltaY < -30) handleSwipeUp();
}, { passive: true });

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        handleSwipeUp();
    }
    if (state === 'fortune' && !multiFortuneState) {
        if (e.code === 'ArrowLeft') { e.preventDefault(); cycleDajiFont(-1); }
        if (e.code === 'ArrowRight') { e.preventDefault(); cycleDajiFont(1); }
    }
});

async function handleSwipeUp() {
    ensureAudio();
    try {
        if (state === 'arrival' && fontsReady) {
            await attemptPaidPull(selectedMode);
        } else if (state === 'fortune') {
            // Block swipe-up if multi-mode cards not all revealed yet
            if (isMultiMode && multiFortuneState && multiFortuneState.revealedCount < multiFortuneState.cards.length) {
                return;
            }
            await attemptPaidPull(selectedMode);
        }
    } catch (err) {
        // swipe handling failed — silently ignore
    }
}

// ============================================================
// START OVERLAY & CNY COUNTDOWN
// ============================================================
const CNY_DATES = [
    { year: 2025, date: new Date('2025-01-29T00:00:00') },
    { year: 2026, date: new Date('2026-02-17T00:00:00') },
    { year: 2027, date: new Date('2027-02-06T00:00:00') },
];

function initStartOverlay() {
    const overlay = document.getElementById('start-overlay');
    const countdownEl = document.getElementById('cny-countdown');
    const labelTopEl = document.getElementById('cny-label-top');
    const labelBottomEl = document.getElementById('cny-label-bottom');

    if (!overlay) return;

    // Horse "馬" canvas font-morphing (same technique as single draw)
    const horseCanvas = document.getElementById('horse-canvas');
    let horseMorphRunning = true;
    if (horseCanvas) {
        const hCtx = horseCanvas.getContext('2d');
        const dpr = devicePixelRatio || 1;
        let lastCanvasW = 0, lastCanvasH = 0;

        // Direct font entries — use known web fonts, no pixel detection needed
        const horseFontEntries = [
            ...CALLI_FONTS.map(f => ({ font: f, char: '\u9A6C' })),
            { font: '"Long Cang"', char: '\u9A6C' },
            { font: '"ZCOOL XiaoWei"', char: '\u9A6C' },
            { font: '"Noto Serif TC"', char: '\u99AC' },
        ];
        const horseFontCount = horseFontEntries.length;

        // Zodiac characters for scramble phase (matching Google Fonts text subset)
        const ZODIAC_ALL = ['鼠','牛','虎','兔','龍','蛇','馬','羊','猴','雞','狗','豬'];

        // Phase durations (mirrors single-draw fortune flow)
        const ENTRANCE_DUR = 1.3;   // scale bounce entrance (first cycle only)
        const HOLD_DUR = 2.0;       // stable hold
        const MORPH_DUR = 1.2;      // dissolve→scramble→form
        const firstCycleDur = ENTRANCE_DUR + HOLD_DUR + MORPH_DUR;
        const normalCycleDur = HOLD_DUR + MORPH_DUR;
        const startT = performance.now();
        let currentFontIdx = Math.floor(Math.random() * horseFontCount);
        const GOLD = '#FFD700';

        // --- Sparkles (copied from drawMorphSparkles) ---
        function horseSparkles(cx, cy, fontSize, t, alpha) {
            const count = 14;
            const spread = fontSize * 1.5;
            const time = (performance.now() - startT) / 1000;
            for (let i = 0; i < count; i++) {
                const seed = i * 137.508;
                const lifePhase = ((t * 2.5 + i / count) % 1);
                const sparkAlpha = Math.sin(lifePhase * Math.PI) * alpha * 0.6;
                if (sparkAlpha < 0.02) continue;
                const angle = seed + time * (1.2 + (i % 3) * 0.4);
                const r = spread * (0.15 + lifePhase * 0.85);
                const sx = cx + Math.cos(angle) * r;
                const sy = cy + Math.sin(angle) * r * 0.3;
                const size = 1 + (1 - lifePhase) * 2.5;
                hCtx.globalAlpha = sparkAlpha;
                hCtx.fillStyle = GOLD;
                hCtx.shadowColor = GOLD;
                hCtx.shadowBlur = size * 5;
                hCtx.beginPath();
                hCtx.arc(sx, sy, size, 0, Math.PI * 2);
                hCtx.fill();
            }
        }

        function drawHorse(now) {
            if (!horseMorphRunning) return;

            // Resize canvas buffer every frame if CSS size changed
            const cssW = horseCanvas.offsetWidth;
            const cssH = horseCanvas.offsetHeight;
            if (cssW !== lastCanvasW || cssH !== lastCanvasH) {
                lastCanvasW = cssW;
                lastCanvasH = cssH;
                horseCanvas.width = cssW * dpr;
                horseCanvas.height = cssH * dpr;
                hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            if (cssW === 0 || cssH === 0) { requestAnimationFrame(drawHorse); return; }

            const elapsed = (now - startT) / 1000;
            const fontSize = cssW * 0.6;
            const cx = cssW / 2;
            const cy = cssH / 2;

            hCtx.clearRect(0, 0, cssW, cssH);

            // First cycle includes entrance; subsequent cycles skip it
            let cycleT, fontCycle;
            if (elapsed < firstCycleDur) {
                cycleT = elapsed;
                fontCycle = 0;
            } else {
                const afterFirst = elapsed - firstCycleDur;
                fontCycle = 1 + Math.floor(afterFirst / normalCycleDur);
                cycleT = ENTRANCE_DUR + (afterFirst % normalCycleDur); // offset past entrance
            }
            const fontIdx = (currentFontIdx + fontCycle) % horseFontCount;
            const nextFontIdx = (fontIdx + 1) % horseFontCount;
            const entry = horseFontEntries[fontIdx];
            const nextEntry = horseFontEntries[nextFontIdx];
            const horseChar = entry.char;

            hCtx.textAlign = 'center';
            hCtx.textBaseline = 'middle';

            if (cycleT < ENTRANCE_DUR) {
                // === ENTRANCE: scale bounce + glow burst (like renderCharTitleEntrance) ===
                const dur = ENTRANCE_DUR - 0.1;
                const charT = Math.max(0, Math.min(1, cycleT / dur));

                let scale;
                if (charT < 0.35) {
                    scale = lerp(1.8, 0.93, easeInOut(charT / 0.35));
                } else if (charT < 0.6) {
                    scale = lerp(0.93, 1.06, easeInOut((charT - 0.35) / 0.25));
                } else {
                    scale = lerp(1.06, 1.0, easeInOut((charT - 0.6) / 0.4));
                }

                const alpha = Math.min(0.9, charT * 3);
                const glowMult = 1 + Math.max(0, 1 - charT * 1.5) * 2.5;
                const dropY = Math.max(0, 1 - charT * 2.5) * fontSize * 0.1;

                hCtx.save();
                hCtx.translate(cx, cy + dropY);
                hCtx.scale(scale, scale);
                hCtx.font = `${fontSize}px ${entry.font}, "Noto Serif TC", serif`;

                hCtx.globalAlpha = alpha * 0.35 * glowMult;
                hCtx.fillStyle = GOLD;
                hCtx.shadowColor = GOLD;
                hCtx.shadowBlur = fontSize * 0.25 * glowMult;
                hCtx.fillText(horseChar, 0, 0);

                hCtx.globalAlpha = alpha;
                hCtx.shadowBlur = fontSize * 0.12;
                hCtx.fillText(horseChar, 0, 0);

                hCtx.restore();

            } else if (cycleT < ENTRANCE_DUR + HOLD_DUR) {
                // === HOLD: breathing glow + scale pulse ===
                const holdT = cycleT - ENTRANCE_DUR;
                const settle = easeInOut(Math.min(1, holdT / 0.6)); // 0.6s ease from morph glow
                const breath = Math.sin(holdT * 2.2) * 0.5 + 0.5;
                const scale = lerp(1.0, 1 + breath * 0.04, settle);
                const glowAlpha = lerp(0.35, 0.1 + breath * 0.2, settle);
                const blurSize = lerp(fontSize * 0.3, fontSize * (0.08 + breath * 0.15), settle);

                // Fading sparkles carried over from morph phase
                /*
                if (holdT < 0.8) {
                    const sparkFade = 1 - easeInOut(holdT / 0.8);
                    horseSparkles(cx, cy, fontSize, 1.0 + holdT, 0.9 * sparkFade);
                }
                */

                hCtx.save();
                hCtx.translate(cx, cy);
                hCtx.scale(scale, scale);
                hCtx.font = `${fontSize}px ${entry.font}, "Noto Serif TC", serif`;

                hCtx.globalAlpha = glowAlpha;
                hCtx.fillStyle = GOLD;
                hCtx.shadowColor = GOLD;
                hCtx.shadowBlur = blurSize;
                hCtx.fillText(horseChar, 0, 0);

                hCtx.globalAlpha = 0.9;
                hCtx.shadowBlur = lerp(fontSize * 0.12, fontSize * 0.06, settle);
                hCtx.fillText(horseChar, 0, 0);

                hCtx.restore();

            } else {
                // === MORPH: dissolve → scramble → form (like renderCharMorph) ===
                const t = (cycleT - ENTRANCE_DUR - HOLD_DUR) / MORPH_DUR; // 0→1
                const baseAlpha = 0.9;

                const DISSOLVE_END = 0.3;
                const SCRAMBLE_START = 0.1;
                const SCRAMBLE_END = 0.7;
                const FORM_START = 0.45;

                // Sparkles — keep alive until end so hold phase can continue them
                /*
                const sparkleEnv = t < 0.15 ? t / 0.15 : 1;
                horseSparkles(cx, cy, fontSize, t, baseAlpha * sparkleEnv);
                */

                // Dissolve old char
                if (t < DISSOLVE_END) {
                    const dt = t / DISSOLVE_END;
                    hCtx.font = `${fontSize}px ${entry.font}, "Noto Serif TC", serif`;
                    hCtx.textAlign = 'center';
                    hCtx.textBaseline = 'middle';

                    const shakeX = Math.sin(elapsed * 35) * dt * fontSize * 0.05;
                    const shakeY = Math.cos(elapsed * 28) * dt * fontSize * 0.035;
                    const driftY = -dt * dt * fontSize * 0.1;
                    const alpha = baseAlpha * (1 - dt * dt);
                    const aber = dt * fontSize * 0.025;
                    const px = cx + shakeX;
                    const py = cy + shakeY + driftY;

                    if (aber > 0.5) {
                        hCtx.globalAlpha = alpha * 0.3;
                        hCtx.fillStyle = '#FF4444';
                        hCtx.shadowColor = '#FF4444';
                        hCtx.shadowBlur = fontSize * 0.12;
                        hCtx.fillText(horseChar, px - aber, py);
                        hCtx.fillStyle = '#FFEE44';
                        hCtx.shadowColor = '#FFEE44';
                        hCtx.fillText(horseChar, px + aber, py + aber * 0.3);
                    }

                    hCtx.globalAlpha = alpha;
                    hCtx.fillStyle = GOLD;
                    hCtx.shadowColor = GOLD;
                    hCtx.shadowBlur = fontSize * (0.15 + dt * 0.25);
                    hCtx.fillText(horseChar, px, py);
                }

                // Scramble through zodiac chars
                if (t >= SCRAMBLE_START && t < SCRAMBLE_END) {
                    const st = (t - SCRAMBLE_START) / (SCRAMBLE_END - SCRAMBLE_START);
                    const speed = lerp(18, 3, st * st);
                    const scrambleIdx = Math.floor(elapsed * speed);
                    const envelope = st < 0.15 ? st / 0.15 : (st > 0.7 ? (1 - st) / 0.3 : 1);

                    hCtx.font = `${fontSize}px ${(st < 0.5 ? entry : nextEntry).font}, "Noto Serif TC", serif`;
                    hCtx.textAlign = 'center';
                    hCtx.textBaseline = 'middle';

                    const scramChar = ZODIAC_ALL[scrambleIdx % ZODIAC_ALL.length];
                    const waveY = Math.sin(elapsed * 5) * fontSize * 0.035;
                    const waveX = Math.cos(elapsed * 3.5) * fontSize * 0.02;
                    const pulse = 1 + Math.sin(elapsed * 8) * 0.05;

                    hCtx.save();
                    hCtx.translate(cx + waveX, cy + waveY);
                    hCtx.scale(pulse, pulse);
                    hCtx.globalAlpha = baseAlpha * envelope * 0.7;
                    hCtx.fillStyle = GOLD;
                    hCtx.shadowColor = GOLD;
                    hCtx.shadowBlur = fontSize * 0.2;
                    hCtx.fillText(scramChar, 0, 0);
                    hCtx.restore();
                }

                // Form new char
                if (t >= FORM_START) {
                    const ft = (t - FORM_START) / (1 - FORM_START);
                    hCtx.font = `${fontSize}px ${nextEntry.font}, "Noto Serif TC", serif`;
                    hCtx.textAlign = 'center';
                    hCtx.textBaseline = 'middle';

                    const charT = Math.max(0, Math.min(1, ft));
                    const easedT = easeInOut(charT);

                    let scale;
                    if (charT < 0.45) {
                        scale = easedT / 0.45 * 1.1;
                    } else if (charT < 0.7) {
                        scale = lerp(1.1, 0.97, easeInOut((charT - 0.45) / 0.25));
                    } else {
                        scale = lerp(0.97, 1.0, easeInOut((charT - 0.7) / 0.3));
                    }

                    const riseY = (1 - easedT) * fontSize * 0.12;
                    const glowPulse = 1 + Math.sin(charT * Math.PI) * 0.5;

                    hCtx.save();
                    hCtx.translate(cx, cy + riseY);
                    hCtx.scale(scale, scale);

                    hCtx.globalAlpha = baseAlpha * easedT * 0.35 * glowPulse;
                    hCtx.fillStyle = GOLD;
                    hCtx.shadowColor = GOLD;
                    hCtx.shadowBlur = fontSize * 0.3 * glowPulse;
                    hCtx.fillText(nextEntry.char, 0, 0);

                    hCtx.globalAlpha = baseAlpha * easedT;
                    hCtx.shadowBlur = fontSize * 0.12;
                    hCtx.fillText(nextEntry.char, 0, 0);

                    hCtx.restore();
                }
            }

            hCtx.globalAlpha = 1;
            hCtx.shadowBlur = 0;
            hCtx.shadowColor = 'transparent';

            requestAnimationFrame(drawHorse);
        }
        requestAnimationFrame(drawHorse);
    }



    const updateTime = () => {
        if (overlay.style.opacity === '0' || overlay.style.display === 'none') return;

        const now = new Date();
        const nextTarget = CNY_DATES.find(d => d.date > now);
        
        if (nextTarget) {
            const diff = nextTarget.date - now;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
            const mins = Math.floor((diff / 1000 / 60) % 60);
            const secs = Math.floor((diff / 1000) % 60);
            
            const zodiac = getZodiac(nextTarget.year);
            const dateStr = `${nextTarget.date.getFullYear()}.${String(nextTarget.date.getMonth() + 1).padStart(2, '0')}.${String(nextTarget.date.getDate()).padStart(2, '0')}`;
            
            const pad = n => String(n).padStart(2, '0');
            countdownEl.innerHTML = `
                <div class="countdown-unit"><span class="countdown-number">${days}</span><span class="countdown-label">Days</span></div>
                <span class="countdown-separator">:</span>
                <div class="countdown-unit"><span class="countdown-number">${pad(hours)}</span><span class="countdown-label">Hrs</span></div>
                <span class="countdown-separator">:</span>
                <div class="countdown-unit"><span class="countdown-number">${pad(mins)}</span><span class="countdown-label">Min</span></div>
                <span class="countdown-separator">:</span>
                <div class="countdown-unit"><span class="countdown-number">${pad(secs)}</span><span class="countdown-label">Sec</span></div>`;
            labelTopEl.innerHTML = `
                <div class="cny-label-en">Until Year of the <span class="cny-label-highlight">${escapeHtml(zodiac.element)} ${escapeHtml(zodiac.en)}</span></div>`;
            labelBottomEl.innerHTML = `
                <div class="cny-label-cn">
                    <span class="cny-label-char">${escapeHtml(zodiac.ganZhi)}</span>
                    <span class="cny-label-date">${escapeHtml(dateStr)}</span>
                </div>`;
        } else {
            // If no future date in our list, find the most recent past date
            let lastTarget = CNY_DATES[CNY_DATES.length - 1];
            for (let i = CNY_DATES.length - 1; i >= 0; i--) {
                if (CNY_DATES[i].date <= now) {
                    lastTarget = CNY_DATES[i];
                    break;
                }
            }
            
            const diff = now - lastTarget.date;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            
            const zodiac = getZodiac(lastTarget.year);
            const dateStr = `${lastTarget.date.getFullYear()}.${String(lastTarget.date.getMonth() + 1).padStart(2, '0')}.${String(lastTarget.date.getDate()).padStart(2, '0')}`;
            
            countdownEl.innerHTML = `
                <div class="countdown-unit"><span class="countdown-number">${days}</span><span class="countdown-label">Days Ago</span></div>`;
            labelTopEl.innerHTML = `
                <div class="cny-label-en">Since Year of the <span class="cny-label-highlight">${escapeHtml(zodiac.element)} ${escapeHtml(zodiac.en)}</span></div>`;
            labelBottomEl.innerHTML = `
                <div class="cny-label-cn">
                    <span class="cny-label-char">${escapeHtml(zodiac.ganZhi)}</span>
                    <span class="cny-label-date">${escapeHtml(dateStr)}</span>
                </div>`;
        }

        requestAnimationFrame(updateTime);
    };
    
    requestAnimationFrame(updateTime);

    // 2. Interaction — swipe up to enter (+ tap fallback)
    function enterApp() {
        localStorage.setItem('fu_has_entered', 'true');
        isOverlayActive = false;
        ensureAudio();
        horseMorphRunning = false;
        updateUIVisibility();
        
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.visibility = 'hidden';
            overlay.style.display = 'none';
        }, 500);
    }

    let startTouchY = 0, startTouchTime = 0;
    overlay.addEventListener('touchstart', (e) => {
        startTouchY = e.touches[0].clientY;
        startTouchTime = performance.now();
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
        const dy = startTouchY - e.changedTouches[0].clientY;
        const dt = performance.now() - startTouchTime;
        if (dy > 50 && dt < 500) enterApp(); // swipe up
    }, { passive: true });

    // Desktop: click anywhere or press Enter/Space
    overlay.addEventListener('click', (e) => {
        // Don't trigger on seal link clicks
        if (e.target.closest('.start-seal-link')) return;
        enterApp();
    });

    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && overlay.style.display !== 'none') {
            e.preventDefault();
            enterApp();
        }
    });
}

function getZodiac(year) {
    const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    const elements = ['Wood', 'Wood', 'Fire', 'Fire', 'Earth', 'Earth', 'Metal', 'Metal', 'Water', 'Water'];

    const stemIdx = (year - 4) % 10;
    const stem = stems[stemIdx];
    const branch = branches[(year - 4) % 12];
    const ganZhi = `${stem}${branch}年`;
    const element = elements[stemIdx];

    const animals = [
        { en: 'Rat', cn: '鼠' },
        { en: 'Ox', cn: '牛' },
        { en: 'Tiger', cn: '虎' },
        { en: 'Rabbit', cn: '兔' },
        { en: 'Dragon', cn: '龍' },
        { en: 'Snake', cn: '蛇' },
        { en: 'Horse', cn: '馬' },
        { en: 'Goat', cn: '羊' },
        { en: 'Monkey', cn: '猴' },
        { en: 'Rooster', cn: '雞' },
        { en: 'Dog', cn: '狗' },
        { en: 'Pig', cn: '豬' }
    ];

    const animal = animals[(year - 4) % 12];
    return { ...animal, ganZhi, element };
}

// Rewards panel opener — delegates to monetization-ui.js (shows panel + backdrop)
function showRewardsPanel() {
    openRewardsPanel();
}

// ============================================================
// AUDIO — BGM + Mute Toggle
// ============================================================
let audioInited = false;
function ensureAudio() {
    if (!audioInited) {
        audioInited = true;
        initAudio();
        startBGM();
    } else {
        resumeAudio();
    }
}

// Mute button
const btnMute = document.getElementById('btn-mute');
if (btnMute) {
    btnMute.addEventListener('click', (e) => {
        e.stopPropagation();
        ensureAudio();
        const muted = toggleMute();
        btnMute.classList.toggle('muted', muted);
    });
}

// Init Start Screen
initStartOverlay();

// ============================================================
// MAIN LOOP
// ============================================================
const startTime = performance.now();

function frame(now) {
    try {
        globalTime = (now - startTime) / 1000;
        stateTime = globalTime - stateStartGlobal;

        clearGrid();

        switch (state) {
            case 'arrival':  updateArrival(); break;
            case 'draw':     updateDraw(); break;
            case 'fortune':  updateFortune(); break;
        }

        // Camera follow during draw launch
        let camShift = 0;
        if (state === 'draw') {
            if (stateTime < DRAW_LAUNCH) {
                if (stateTime < DRAW_CAMERA_PULLBACK) {
                    const pullbackT = Math.min(1, stateTime / Math.max(0.001, DRAW_CAMERA_PULLBACK));
                    camShift = -easeInOut(pullbackT) * cellSize * 3;
                } else {
                    camShift = -cellSize * 3;
                }
            } else {
                const returnT = Math.min(1, (stateTime - DRAW_LAUNCH) / Math.max(0.001, DRAW_CAMERA_RETURN));
                camShift = -(1 - easeInOut(returnT)) * cellSize * 3;
            }
            offsetY += camShift;
        }

        renderGrid();

        if (camShift !== 0) offsetY -= camShift;

        // Reset particle count
        if (particlesMesh) particlesMesh.count = 0;

        // Apply cinematic camera (CSS transform — uniform for 2D + GL)
        if ((state === 'draw' || state === 'fortune') && isMultiMode) {
            applyCamToCanvas();
        } else if (canvas.style.transform) {
            canvas.style.transform = '';
        }

        switch (state) {
            case 'arrival':  renderArrivalOverlay(); break;
            case 'draw':     renderDrawOverlay(); break;
            case 'fortune':  renderFortuneOverlay(); break;
        }
    } catch (err) {
        console.error('[frame error]', err);
        // Safety: if draw crashed, force transition to fortune for multi-mode
        if (state === 'draw' && isMultiMode && multiDrawResults) {
            changeState('fortune');
        }
    }

    requestAnimationFrame(frame);
}

// --- Monetization init ---
(async () => {
  initAds();

  try {
    await restoreSession();
  } catch (e) {
    console.warn('Session restore failed:', e);
  }

  // Always create anonymous user on page load if none exists
  if (!getUser()) {
    try {
      await ensureUser();
    } catch (e) {
      console.warn('Anonymous user creation failed:', e);
    }
  }

  // Handle referral from ?ref= parameter
  const referralCode = getReferralFromUrl();
  if (referralCode) {
    try {
      await applyReferral(referralCode);
    } catch (e) {
      console.warn('Referral failed:', e);
    }
  }

  // Handle gift claim from URL
  const giftToken = getGiftTokenFromUrl();
  if (giftToken) {
    try {
      await claimGift(giftToken);
    } catch (e) {
      // gift claim failed — user will see the normal UI state
    }
  }

  // Handle payment return
  const paymentResult = getPaymentResult();
  if (paymentResult?.status === 'success') {
    // payment success handled by Stripe webhook in production
  }

  try {
    // Return expired gifts (dev mode)
    await returnExpiredGifts();
  } catch (e) {
    console.warn('Return expired gifts failed:', e);
  }

  // Initialize monetization UI (auth bar, rewards panel, etc.)
  // This must always run so buttons and click handlers are wired up.
  initMonetizationUI();

  // Listen for auth changes to update UI
  onAuthChange((user) => {
    const drawCounter = document.getElementById('draw-counter');
    if (drawCounter && user) {
      drawCounter.textContent = `🎫 ×${user.draws_remaining || 0}`;
    }
  });
})();

requestAnimationFrame(frame);
