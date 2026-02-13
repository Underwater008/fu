// ============================================================
// Fortune Gacha — 3D ASCII Fortune Experience with Gacha Mechanics
// State machine: arrival -> draw -> fortune -> (draw again loop)
// ============================================================
import * as THREE from 'three';
import vertexShader from './particleVertex.glsl?raw';
import fragmentShader from './particleFragment.glsl?raw';
import {
    performDrawWithPity, performMultiDrawWithPity,
    saveToCollection, saveMultiToCollection,
    FULL_CHAR_BLESSINGS, RARITY_TIERS,
    BLESSING_CATEGORIES as GACHA_CATEGORIES,
    getCollectionProgress, getCollectionByCategory,
} from './gacha.js';
import { getUser, onAuthChange, restoreSession, updateDraws } from './auth.js';
import { claimDailyLogin, getPityCounter, incrementPity, resetPity } from './rewards.js';
import { initAds } from './ads.js';
import { getPaymentResult } from './payments.js';
import { claimGift, getGiftTokenFromUrl, returnExpiredGifts } from './gifting.js';
import { initMonetizationUI, setCurrentDrawResult, showSingleFortuneActions, hideSingleFortuneActions, showMultiShareButton, hideMultiShareButton, setDetailDraw } from './monetization-ui.js';
import { loadCollection } from './gacha.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

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
let charToUV = {};

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
    }
}
window.addEventListener('resize', resize);
resize();

// --- Responsive Layout Helpers ---
function isLandscape() {
    return window.innerWidth > window.innerHeight * 1.2;
}

function getClusterSpread() {
    const baseSpread = Math.min(cols, rows) * 0.40 * cellSize;
    if (isLandscape()) {
        // On landscape/desktop, cap spread to keep cluster proportional
        return Math.min(baseSpread, window.innerHeight * 0.28);
    }
    return baseSpread;
}

// Responsive grid layout for multi-pull (portrait 2×5, landscape 5×2)
function getMultiGridLayout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = !isLandscape();
    const multiCols = portrait ? 2 : 5;
    const multiRows = portrait ? 5 : 2;
    const gridW = w * (portrait ? 0.92 : 0.85);
    const gridH = h * (portrait ? 0.72 : 0.55);
    const scaleFactor = portrait ? 0.38 : 0.35;
    // Shift grid upward slightly in portrait to leave room for buttons at bottom
    const gridTopY = portrait ? h * 0.06 : (h - gridH) / 2;
    const startX = (w - gridW) / 2 + (gridW / multiCols) / 2;
    const startY = gridTopY + (gridH / multiRows) / 2;
    const stepX = gridW / multiCols;
    const stepY = gridH / multiRows;
    const cardW = stepX - 8;
    const cardH = stepY - 8;
    const gridBottom = gridTopY + gridH;
    return { multiCols, multiRows, gridW, gridH, startX, startY, stepX, stepY, cardW, cardH, scaleFactor, gridBottom };
}

// Responsive layout params for fortune/arrival overlay text positions
function getLayout() {
    if (isLandscape()) {
        const maxCharSize = Math.min(cellSize * 5, window.innerHeight * 0.11);
        return {
            starsY: 0.06,
            charY: 0.14,
            tierY: 0.21,
            cardTop: 0.02,
            cardBottom: 0.24,
            cardWidth: 0.35,
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
        starsY: 0.08,
        charY: 0.15,
        tierY: 0.22,
        cardTop: 0.04,
        cardBottom: 0.26,
        cardWidth: 0.5,
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

// --- Three.js Setup (Hybrid Rendering) ---
const ATLAS_COLS = 20;
const ATLAS_ROWS = 20;
const CELL_PX = 64;

function initThreeJS() {
    // 1. Renderer
    glRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    glRenderer.setSize(window.innerWidth, window.innerHeight);
    glRenderer.setPixelRatio(dpr);

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
        '\u00B7',
    ]);

    actx.font = `bold ${Math.floor(CELL_PX * 0.7)}px "Courier New", "SF Mono", monospace`;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    actx.fillStyle = '#FFFFFF';
    actx.shadowColor = 'white';
    actx.shadowBlur = CELL_PX * 0.12;

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
        actx.font = `bold ${Math.floor(CELL_PX * 0.7)}px ${CALLI_FONTS[fi]}, "Courier New", monospace`;
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
    const octx = off.getContext('2d');
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
let multiFlipState = null; // { revealedCount, cardElements[] }
let multiFortuneState = null; // Canvas-integrated multi fortune display

// Force-load all calligraphy fonts with ALL characters used in the app
const ALL_FONT_CHARS = ALL_LUCKY + '\u00B7\u4E00\u4EBA\u5341\u5927';
Promise.all(
    CALLI_FONTS.map(f => document.fonts.load(`64px ${f}`, ALL_FONT_CHARS))
).then(() => {
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

    for (let i = 0; i < count; i++) {
        const p = daji3DParticles[i];
        const z = p.origZ * zInflate + Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;
        const isHovered = i === hoveredIdx;
        const hoverPush = isHovered ? -80 : 0;

        _dummy.position.set(p.baseX, -p.baseY, -(z + hoverPush));
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(i, _dummy.matrix);

        let alpha = p.alpha * 1.25;
        alpha = Math.min(0.8, alpha);
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

        let scale = cellSize * 0.85;
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

    // Measure actual bounding box to compute true visual center
    const m = ctx.measureText('\u798F');
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    const visualCy = cy + (ascent - descent) / 2;

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
function drawMultiCardRect(cx, cy, cw, ch, alpha, borderColor, fillColor) {
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
    ctx.fillStyle = fillColor || 'rgba(80, 10, 10, 0.5)';
    ctx.fill();
    ctx.strokeStyle = borderColor || 'rgba(255, 215, 0, 0.15)';
    ctx.lineWidth = 1.2;
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

// Render Three.js particles and composite onto the Canvas 2D
function renderAndCompositeGL() {
    if (!glRenderer || !glScene || !glCamera) return;
    glRenderer.render(glScene, glCamera);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glRenderer.domElement, 0, 0);
    ctx.restore();
}

// Updates GPU buffers for generic particle list
function updateProjectedGlyphsToGPU(glyphs) {
    if (!particlesMesh) return;
    if (!glyphs.length) {
        particlesMesh.count = 0;
        return;
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

    renderAndCompositeGL();
}

// ============================================================
// STATE MACHINE
// ============================================================
let state = 'arrival';
let stateTime = 0;
let globalTime = 0;
let stateStartGlobal = 0;
let drawToFortuneSeed = null;

function changeState(newState) {
    state = newState;
    stateStartGlobal = globalTime;
    stateTime = 0;

    if (newState === 'draw') {
        initDrawAnimation();
    }
    if (newState === 'fortune') {
        if (isMultiMode) {
            // Multi-mode: seed particles from morph (seamless transition)
            buildMultiDajiFromMorph();
            drawToFortuneSeed = null;
            multiFlipState = null;
            initMultiFortuneState();
            // Clear fireworks
            fwShells.length = 0;
            fwTrail.length = 0;
            fwParticles.length = 0;
            fwLaunchTimer = 99999;
            fwLaunchCount = 0;
        } else {
            if (drawToFortuneSeed && drawToFortuneSeed.length > 0) {
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
            showMultiShareButton();
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
function updateArrival() {
    updateBgParticles(globalTime);
    // Update tap-triggered firework particles
    if (hasTapFireworks()) updateFireworkPhysics();
}

function renderArrivalOverlay() {
    // Render tap-triggered fireworks in arrival state
    if (hasTapFireworks()) appendFireworksToGPU(0);

    const fadeIn = Math.min(1, stateTime / 1.0);
    const L = getLayout();
    drawCalligraphyFu(fadeIn);

    const textFade = Math.min(1, stateTime / 1.5);
    const titleSize = isLandscape() ? Math.min(cellSize * 2, window.innerHeight * 0.04) : cellSize * 2;
    const subSize = isLandscape() ? Math.min(cellSize * 1.1, window.innerHeight * 0.025) : cellSize * 1.1;
    drawOverlayText('\u65B0\u5E74\u7EB3\u798F', L.arrivalTitleY, CONFIG.glowGold, textFade * 0.8, titleSize);
    drawOverlayText('A Blessing Awaits', L.arrivalSubY, CONFIG.glowGold, textFade * 0.5, subSize);

    const hintFade = Math.min(1, Math.max(0, (stateTime - 1.5) / 0.5));
    const pulse = 0.4 + Math.sin(globalTime * 3) * 0.2;
    const hopPhase = globalTime % 3.0;
    let hopOffset = 0;
    if (hopPhase < 0.9) {
        const decay = 1 - hopPhase / 0.9;
        hopOffset = -Math.abs(Math.sin(hopPhase / 0.9 * Math.PI * 3)) * 0.012 * decay;
    }

    // Dynamic text based on mode
    const isMulti = selectedMode === 'multi';
    const mainText = isMulti ? '\u2191  \u4E0A\u6ED1\u5341\u8FDE  \u2191' : '\u2191  \u4E0A\u6ED1\u62BD\u7B7E  \u2191';
    const subText = isMulti ? 'Swipe Up to Draw \u00D710' : 'Swipe Up to Draw Fortune';

    const hintSize = isLandscape() ? Math.min(cellSize * 1.6, window.innerHeight * 0.035) : cellSize * 1.6;
    const hintSubSize = isLandscape() ? Math.min(cellSize * 1.1, window.innerHeight * 0.025) : cellSize * 1.1;
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

const DRAW_LAUNCH = CONFIG.fuExplodeDelay;
const DRAW_RISE = CONFIG.fuRiseDuration;
const DRAW_SHRINK = CONFIG.fuShrinkDuration;
const DRAW_SHRINK_END_SCALE = CONFIG.fuShrinkEndScale;
const DRAW_CAMERA_PULLBACK = CONFIG.fuCameraPullbackDuration;
const DRAW_CAMERA_RETURN = CONFIG.fuCameraReturnDuration;
const DRAW_SCATTER = DRAW_LAUNCH + 1.2;
const DRAW_REFORM = DRAW_SCATTER + 1.1;
const DRAW_SETTLE = DRAW_REFORM + 0.4;

function initDrawAnimation() {
    morphParticles = [];
    launchTrail = [];
    burstFlash = 0;
    fuEndScreenPositions = [];
    drawToFortuneSeed = null;
    if (!fontsReady) return;

    let drawsToAnimate = [];

    // Perform the gacha draw (or use pre-set multi draw result)
    if (!isMultiMode) {
        const pity = getPityCounter();
        currentDrawResult = performDrawWithPity(pity);
        saveToCollection(currentDrawResult);
        if (currentDrawResult.tierIndex <= 1) {
            resetPity();
        } else {
            incrementPity();
        }
        drawsToAnimate = [currentDrawResult];
    } else {
        drawsToAnimate = multiDrawResults;
    }

    // Grid layout configuration for 10x (responsive: portrait 2×5, landscape 5×2)
    const grid = getMultiGridLayout();
    const multiCols = grid.multiCols;
    const multiRows = grid.multiRows;
    const scaleFactor = isMultiMode ? grid.scaleFactor : 1.0;

    const startX = grid.startX;
    const startY = grid.startY;
    const stepX = grid.stepX;
    const stepY = grid.stepY;

    // Pre-compute where each 福 ends up (screen coords) before exploding
    drawsToAnimate.forEach((drawRes, idx) => {
        if (isMultiMode) {
            const c = idx % multiCols;
            const r = Math.floor(idx / multiCols);
            fuEndScreenPositions.push({ x: startX + c * stepX, y: startY + r * stepY });
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
        }

        // 2. Sample shape — proportionally scaled with cluster size
        const res = isMultiMode ? Math.round(50 * scaleFactor) : 50;
        const shape = sampleCharacterShape(drawRes.char, res);

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
    window.currentDrawsList = drawsToAnimate;
}

function updateDraw() {
    updateBgParticles(globalTime);

    const t = stateTime;

    // --- LAUNCH: trail sparks behind rising Fu ---
    if (t < DRAW_LAUNCH) {
        const riseT = Math.min(1, t / Math.max(0.001, DRAW_RISE));
        const launchT = easeInOut(riseT);

        const draws = window.currentDrawsList || [currentDrawResult];
        const count = draws.length;

        // Grid config for multi — use responsive layout
        const grid = getMultiGridLayout();

        for (let i = 0; i < count; i++) {
            let cx, cy;
            // Calculate current position of the "Fu"
            if (count > 1) {
                const c = i % grid.multiCols;
                const r = Math.floor(i / grid.multiCols);
                const targetX = grid.startX + c * grid.stepX;
                const targetY = grid.startY + r * grid.stepY;
                const originX = window.innerWidth * 0.2 + (i / (count - 1)) * window.innerWidth * 0.6;
                const originY = window.innerHeight * 0.9;
                
                // We need 3D world coords for the trail spawn
                // Canvas is 2D, but trails are 3D.
                // We project 2D canvas pos back to 3D plane Z=0 roughly
                const curX2D = lerp(originX, targetX, launchT);
                const curY2D = lerp(originY, targetY, launchT);
                
                // Approximate World Coords from Screen Coords
                // ScreenX = WorldX * scale + W/2
                // WorldX = (ScreenX - W/2) / scale
                // At Z=0, scale = 1 (fov/(fov+0)) = 1
                cx = curX2D - window.innerWidth / 2;
                cy = curY2D - window.innerHeight / 2; // +y is down on screen, +y is down in world logic here

            } else {
                const fuRow = lerp(rows * 0.5, rows * 0.20, launchT);
                const fuCol = cols / 2;
                const fuPos = gridToWorld(fuCol, fuRow);
                cx = fuPos.x;
                cy = fuPos.y;
            }

            if (Math.random() < (count > 1 ? 0.3 : 0.6)) { // Less dense per trail for multi
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
    if (t >= DRAW_LAUNCH && t < DRAW_LAUNCH + 0.15) {
        burstFlash = 1 - (t - DRAW_LAUNCH) / 0.15;
        for (const p of morphParticles) p.active = true;
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
                const settleT = Math.min(1, (t - DRAW_REFORM) / Math.max(0.001, DRAW_SETTLE - DRAW_REFORM));
                const eased = easeInOut(settleT);
                p.x = lerp(p.x, p.targetX, eased);
                p.y = lerp(p.y, p.targetY, eased);
                p.z = lerp(p.z, p.targetZ, eased);
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

    if (t >= DRAW_SETTLE + 0.3) {
        if (isMultiMode) {
            // Multi-mode: particles will be seeded in changeState via buildMultiDajiFromMorph
            drawToFortuneSeed = null;
            changeState('fortune');
        } else {
            const seeded = buildDajiSeedFromMorph();
            drawToFortuneSeed = seeded.length > 0 ? seeded : null;
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
    console.log(`[buildMultiDajiFromMorph] morphParticles: ${morphParticles.length}, active: ${activeCount}, daji3DParticles: ${daji3DParticles.length}`);
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
        });
    }

    multiFortuneState = {
        cards,
        revealedCount: 0,
        allRevealedTime: 0,
        burstParticles: [],
    };
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

        // Check if this particle's card has been revealed
        let alpha = p.alpha * 1.25;
        alpha = Math.min(0.8, alpha);
        let extraX = 0, extraY = 0;
        let colorBoost = 1;

        // Anticipation: particles brighten and pulse before high-rarity reveal
        if (p.anticipating && !p.fadingOut) {
            const pulse = 0.7 + Math.sin(globalTime * 12 + p.phase * 2) * 0.3;
            alpha = Math.min(1.0, alpha * 1.8 * pulse);
            colorBoost = 1.5;
        }

        if (p.fadingOut) {
            const fadeT = Math.min(1, (globalTime - p.fadeStartTime) / 0.7);
            // Bright flash at start, then fast fade
            const flashBoost = fadeT < 0.15 ? 1.5 : 1;
            alpha *= (1 - fadeT) * flashBoost;
            // Stronger burst outward with easing
            const burstEase = 1 - Math.pow(1 - fadeT, 2);
            extraX = p.burstVx * burstEase * spread * 4;
            extraY = p.burstVy * burstEase * spread * 4;
            if (fadeT >= 1) continue; // fully faded, skip
        }

        const z = p.origZ + Math.sin(globalTime * 1.5 + p.phase) * breatheAmp;

        _dummy.position.set(p.baseX + extraX, -(p.baseY + extraY), -z);
        _dummy.updateMatrix();
        particlesMesh.setMatrixAt(visibleCount, _dummy.matrix);

        // Metallic gold gradient
        const yNorm = clusterH > 0 ? p.baseY / clusterH : 0;
        const gradT = Math.max(0, Math.min(1, (yNorm + 1) * 0.5));
        const hDist = Math.abs(yNorm - highlightPos);
        const highlight = Math.max(0, 1 - hDist * 3);

        const metalR = Math.min(255, Math.floor(lerp(255, 180, gradT) + highlight * 55));
        const metalG = Math.min(255, Math.floor(lerp(225, 130, gradT) + highlight * 40));
        const metalB = Math.min(255, Math.floor(lerp(50, 10, gradT) + highlight * 50));

        const blendT = Math.min(1, entryT);
        const gr = lerp(p.r, metalR, blendT) / 255;
        const gg = lerp(p.g, metalG, blendT) / 255;
        const gb = lerp(p.b, metalB, blendT) / 255;

        instColor.setXYZ(visibleCount, Math.min(1, gr * colorBoost), Math.min(1, gg * colorBoost), Math.min(1, gb * colorBoost));
        instAlpha.setX(visibleCount, alpha);

        const uv = (p.fontIdx != null && charToUV[p.char + '|' + p.fontIdx]) || charToUV[p.char];
        if (uv) instUV.setXY(visibleCount, uv.u, uv.v);

        let scale = cellSize * 0.85 * scaleFactor;
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

function renderMultiCards() {
    if (!multiFortuneState) return;
    const fadeIn = Math.min(1, stateTime / 0.5);

    for (const card of multiFortuneState.cards) {
        const revealAge = card.revealed ? (globalTime - card.revealTime) : -1;
        const alpha = fadeIn * (card.revealed ? 0.7 : 0.6);
        const borderColor = card.revealed
            ? card.draw.rarity.glow
            : 'rgba(255, 215, 0, 0.15)';
        const fillColor = card.revealed
            ? 'rgba(40, 5, 5, 0.45)'
            : 'rgba(80, 10, 10, 0.5)';

        // Use lightweight card (no blur pass) for performance with 10 cards
        drawMultiCardRect(card.centerX, card.centerY, card.cardW, card.cardH, alpha, borderColor, fillColor);

        // REVEAL FLASH: bright white→rarity-color flash that fades quickly
        if (card.revealed && revealAge < 0.5) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const flashT = revealAge / 0.5;
            const flashAlpha = (1 - flashT) * 0.7;
            const x = card.centerX - card.cardW / 2;
            const y = card.centerY - card.cardH / 2;
            const rd = 10;
            ctx.beginPath();
            ctx.moveTo(x + rd, y);
            ctx.lineTo(x + card.cardW - rd, y);
            ctx.quadraticCurveTo(x + card.cardW, y, x + card.cardW, y + rd);
            ctx.lineTo(x + card.cardW, y + card.cardH - rd);
            ctx.quadraticCurveTo(x + card.cardW, y + card.cardH, x + card.cardW - rd, y + card.cardH);
            ctx.lineTo(x + rd, y + card.cardH);
            ctx.quadraticCurveTo(x, y + card.cardH, x, y + card.cardH - rd);
            ctx.lineTo(x, y + rd);
            ctx.quadraticCurveTo(x, y, x + rd, y);
            ctx.closePath();
            // White flash → rarity color
            const flashColor = flashT < 0.3 ? 'white' : card.draw.rarity.color;
            ctx.globalAlpha = flashAlpha;
            ctx.fillStyle = flashColor;
            ctx.shadowColor = card.draw.rarity.color;
            ctx.shadowBlur = 20 * (1 - flashT);
            ctx.fill();
            ctx.restore();
        }

        // Draw rarity-colored border glow for revealed cards
        if (card.revealed) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const x = card.centerX - card.cardW / 2;
            const y = card.centerY - card.cardH / 2;
            const glowPulse = revealAge < 1 ? 0.5 + Math.sin(revealAge * Math.PI * 3) * 0.2 : 0.3;
            ctx.globalAlpha = fadeIn * glowPulse;
            ctx.shadowColor = card.draw.rarity.color;
            ctx.shadowBlur = 12 + (revealAge < 0.5 ? (1 - revealAge * 2) * 15 : 0);
            ctx.strokeStyle = card.draw.rarity.color;
            ctx.lineWidth = revealAge < 0.3 ? 3 : 1.5;
            ctx.beginPath();
            const r = 10;
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + card.cardW - r, y);
            ctx.quadraticCurveTo(x + card.cardW, y, x + card.cardW, y + r);
            ctx.lineTo(x + card.cardW, y + card.cardH - r);
            ctx.quadraticCurveTo(x + card.cardW, y + card.cardH, x + card.cardW - r, y + card.cardH);
            ctx.lineTo(x + r, y + card.cardH);
            ctx.quadraticCurveTo(x, y + card.cardH, x, y + card.cardH - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
        }

        // ANTICIPATION for 5+ star: shake + glow buildup before reveal
        if (card.anticipating && card.anticipateStart) {
            const anticAge = globalTime - card.anticipateStart;
            const anticT = Math.min(1, anticAge / card.anticipateDuration);
            const stars = card.draw.rarity.stars;

            ctx.save();
            ctx.scale(dpr, dpr);
            const x = card.centerX - card.cardW / 2;
            const y = card.centerY - card.cardH / 2;

            // Shake: increasing intensity
            const shakeIntensity = anticT * (stars >= 6 ? 6 : 3.5);
            const shakeX = Math.sin(anticAge * 35) * shakeIntensity;
            const shakeY = Math.cos(anticAge * 28) * shakeIntensity * 0.6;
            ctx.translate(shakeX, shakeY);

            // Glow buildup: rarity color glow intensifying around card
            const glowIntensity = anticT * anticT;
            const glowSize = 15 + glowIntensity * (stars >= 6 ? 40 : 25);
            ctx.globalAlpha = glowIntensity * 0.8;
            ctx.shadowColor = card.draw.rarity.color;
            ctx.shadowBlur = glowSize;
            ctx.strokeStyle = card.draw.rarity.color;
            ctx.lineWidth = 2 + glowIntensity * 3;
            ctx.beginPath();
            const rd = 10;
            ctx.moveTo(x + rd, y);
            ctx.lineTo(x + card.cardW - rd, y);
            ctx.quadraticCurveTo(x + card.cardW, y, x + card.cardW, y + rd);
            ctx.lineTo(x + card.cardW, y + card.cardH - rd);
            ctx.quadraticCurveTo(x + card.cardW, y + card.cardH, x + card.cardW - rd, y + card.cardH);
            ctx.lineTo(x + rd, y + card.cardH);
            ctx.quadraticCurveTo(x, y + card.cardH, x, y + card.cardH - rd);
            ctx.lineTo(x, y + rd);
            ctx.quadraticCurveTo(x, y, x + rd, y);
            ctx.closePath();
            ctx.stroke();

            // 6-star: inner radiant glow fill
            if (stars >= 6 && anticT > 0.4) {
                const innerT = (anticT - 0.4) / 0.6;
                ctx.globalAlpha = innerT * 0.3;
                ctx.fillStyle = card.draw.rarity.color;
                ctx.fill();
            }

            ctx.restore();
        }

        // Draw "福" on unrevealed cards as hint
        if (!card.revealed && !card.anticipating) {
            ctx.save();
            ctx.scale(dpr, dpr);
            const hintSize = Math.min(card.cardW, card.cardH) * 0.35;
            ctx.font = `bold ${hintSize}px "Ma Shan Zheng", serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = fadeIn * 0.2;
            ctx.fillStyle = CONFIG.glowGold;
            ctx.fillText('\u798F', card.centerX, card.centerY);
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
        const revealT = Math.min(1, (globalTime - card.revealTime) / 0.5);
        if (revealT <= 0) continue;

        const dr = card.draw;
        const cx = card.centerX;
        const cy = card.centerY;
        const cw = card.cardW;
        const ch = card.cardH;

        // Clip to card bounds
        ctx.save();
        const clipX = cx - cw / 2;
        const clipY = cy - ch / 2;
        ctx.beginPath();
        ctx.rect(clipX, clipY, cw, ch);
        ctx.clip();

        const alpha = revealT;
        const unit = Math.min(cw, ch); // Base dimension for text sizing

        // Stars
        const starsStr = '\u2605'.repeat(dr.rarity.stars) + '\u2606'.repeat(6 - dr.rarity.stars);
        const starsSize = Math.max(7, unit * 0.1);
        ctx.font = `${starsSize}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = dr.rarity.color;
        ctx.shadowColor = dr.rarity.color;
        ctx.shadowBlur = 4;
        ctx.fillText(starsStr, cx, cy - ch * 0.39);

        // Main character
        const charSize = Math.max(14, unit * 0.45);
        ctx.font = `bold ${charSize}px ${getDajiFont()}, serif`;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = CONFIG.glowGold;
        ctx.shadowColor = CONFIG.glowGold;
        ctx.shadowBlur = charSize * 0.15;
        ctx.fillText(dr.char, cx, cy - ch * 0.07);

        // Tier label
        const tierSize = Math.max(6, unit * 0.08);
        ctx.font = `${tierSize}px "Courier New", monospace`;
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = dr.rarity.color;
        ctx.shadowBlur = 3;
        ctx.fillText(dr.rarity.label, cx, cy + ch * 0.26);

        // Blessing phrase
        const phraseSize = Math.max(6, unit * 0.07);
        ctx.font = `${phraseSize}px "Courier New", monospace`;
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = CONFIG.glowRed;
        ctx.shadowColor = CONFIG.glowRed;
        ctx.shadowBlur = 2;
        ctx.fillText(dr.blessing.phrase, cx, cy + ch * 0.39);

        ctx.restore();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

function revealCard(index) {
    if (!multiFortuneState || index < 0 || index >= multiFortuneState.cards.length) return;
    const card = multiFortuneState.cards[index];
    if (card.revealed || card.anticipating) return;

    const stars = card.draw.rarity.stars;

    // 5+ star: anticipation phase before reveal
    if (stars >= 5) {
        card.anticipating = true;
        card.anticipateStart = globalTime;
        card.anticipateDuration = stars >= 6 ? 0.9 : 0.55;
        // Slow-pulse the particles during anticipation (brighten them)
        for (const p of daji3DParticles) {
            if (p.drawIndex === index) p.anticipating = true;
        }
        // Delayed actual reveal
        const delay = card.anticipateDuration * 1000;
        setTimeout(() => executeReveal(index), delay);
        return;
    }

    // Normal reveal (2-4 stars)
    executeReveal(index);
}

function executeReveal(index) {
    if (!multiFortuneState || index < 0 || index >= multiFortuneState.cards.length) return;
    const card = multiFortuneState.cards[index];
    if (card.revealed) return;

    const stars = card.draw.rarity.stars;
    card.revealed = true;
    card.revealTime = globalTime;
    card.anticipating = false;
    multiFortuneState.revealedCount++;

    // Mark matching daji particles as fading out with burst direction
    for (const p of daji3DParticles) {
        if (p.drawIndex === index && !p.fadingOut) {
            p.fadingOut = true;
            p.anticipating = false;
            p.fadeStartTime = globalTime;
            const dx = p.baseX - (card.centerX - window.innerWidth / 2);
            const dy = p.baseY - (card.centerY - window.innerHeight / 2);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            // 5+ stars: much stronger outward burst
            const burstPower = stars >= 6 ? 3.0 : stars >= 5 ? 2.0 : 1.0;
            p.burstVx = (dx / dist) * (burstPower + Math.random() * burstPower);
            p.burstVy = (dy / dist) * (burstPower + Math.random() * burstPower);
        }
    }

    // Screen flash
    if (stars >= 4) {
        triggerScreenFlash(stars);
    }

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

    if (multiFortuneState.revealedCount < multiFortuneState.cards.length) {
        // "Tap to Reveal" hint
        const hintFade = Math.min(1, Math.max(0, (stateTime - 0.8) / 0.5));
        const pulse = 0.5 + Math.sin(globalTime * 3) * 0.2;
        const hintSize = isLandscape() ? Math.min(cellSize * 1.2, window.innerHeight * 0.028) : cellSize * 1.2;
        drawOverlayText('\u70B9\u51FB\u7FFB\u5F00 \u00B7 Tap to Reveal', L.multiHintY, CONFIG.glowGold, hintFade * pulse, hintSize);
    } else {
        // Swipe-up hint after all revealed (same as single draw)
        const revealAge = globalTime - multiFortuneState.allRevealedTime;
        if (revealAge > 1.0) {
            const hintFade = Math.min(1, (revealAge - 1.0) / 0.5);
            const pulse = 0.4 + Math.sin(globalTime * 3) * 0.2;
            const isMulti = selectedMode === 'multi';
            const mainText = isMulti ? '\u2191 \u518D\u6765\u5341\u8FDE \u2191' : '\u2191 \u518D\u62BD\u4E00\u6B21 \u2191';
            const subText = isMulti ? 'Swipe Up to Draw \u00D710' : 'Swipe Up to Draw Again';
            const hintSize = isLandscape() ? Math.min(cellSize * 1.2, window.innerHeight * 0.028) : cellSize * 1.2;
            const hintSubSize = isLandscape() ? Math.min(cellSize * 0.9, window.innerHeight * 0.02) : cellSize * 0.9;
            drawOverlayText(mainText, L.hintY, CONFIG.glowGold, hintFade * pulse, hintSize);
            drawOverlayText(subText, L.hintSubY, CONFIG.glowGold, hintFade * pulse, hintSubSize);
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
    const hintY = L.multiHintY * window.innerHeight;
    const hintSize = isLandscape() ? Math.min(cellSize * 1.2, window.innerHeight * 0.028) : cellSize * 1.2;
    const hitH = hintSize * 2;
    const hitW = window.innerWidth * 0.6;
    return Math.abs(screenX - window.innerWidth / 2) < hitW / 2 &&
           Math.abs(screenY - hintY) < hitH;
}

function revealNextUnrevealedCard() {
    if (!multiFortuneState) return;
    for (let i = 0; i < multiFortuneState.cards.length; i++) {
        if (!multiFortuneState.cards[i].revealed && !multiFortuneState.cards[i].anticipating) {
            revealCard(i);
            return;
        }
    }
}

function resetMultiFortune() {
    multiFortuneState = null;
    multiFlipState = null;
    isMultiMode = false;
    multiDrawResults = null;
    daji3DParticles = [];
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
            const lum = Math.min(1, gp + 0.08);
            const seed = lerpColor(lum);
            r = lerp(drawR, seed.r, settleSt);
            g = lerp(drawG, seed.g, settleSt);
            b = lerp(drawB, seed.b, settleSt);
            const seedAlpha = 0.3 + lum * 0.7;
            const pulseAlpha = Math.min(1, (0.5 + gp * 0.5) * (1 + Math.sin(settleSt * Math.PI) * 0.3));
            alpha = lerp(pulseAlpha, seedAlpha, settleSt);
            size = lerp(size, 1.1, settleSt);
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

    updateProjectedGlyphsToGPU(glyphs);
}

function renderDrawOverlay() {
    const t = stateTime;
    renderDrawParticles3D(t);

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
        const draws = window.currentDrawsList || [currentDrawResult];
        const count = draws.length;

        // Grid config for multi — use responsive layout
        const grid = getMultiGridLayout();

        if (count > 1) {
            // Multi: 10 福 characters rising from bottom, spreading to their grid positions
            const baseSize = isLandscape() ? Math.min(vmin * 0.08, window.innerHeight * 0.07) : vmin * 0.08;
            const fuSize = baseSize * lerp(1, 0.5, shrinkEased);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = CONFIG.glowGold;
            ctx.shadowColor = CONFIG.glowGold;

            const morphSpeed = 1.2 + riseT * 4.5;
            const morphPhase = t * morphSpeed;
            const fontCount = CALLI_FONTS.length;

            for (let i = 0; i < count; i++) {
                const c = i % grid.multiCols;
                const r = Math.floor(i / grid.multiCols);
                const targetX = grid.startX + c * grid.stepX;
                const targetY = grid.startY + r * grid.stepY;

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
                const intensity = 1 + riseT * 1.8;
                const alphaScale = 0.8;

                ctx.font = `${fuSize}px ${CALLI_FONTS[fontA]}, serif`;
                ctx.globalAlpha = Math.min(1, 0.25 * intensity) * (1 - crossFade) * alphaScale;
                ctx.shadowBlur = fuSize * 0.12 * intensity;
                ctx.fillText('\u798F', cx, cy);
                ctx.globalAlpha = (1 - crossFade) * alphaScale;
                ctx.shadowBlur = fuSize * 0.05 * intensity;
                ctx.fillText('\u798F', cx, cy);

                ctx.font = `${fuSize}px ${CALLI_FONTS[fontB]}, serif`;
                ctx.globalAlpha = Math.min(1, 0.25 * intensity) * crossFade * alphaScale;
                ctx.shadowBlur = fuSize * 0.12 * intensity;
                ctx.fillText('\u798F', cx, cy);
                ctx.globalAlpha = crossFade * alphaScale;
                ctx.shadowBlur = fuSize * 0.05 * intensity;
                ctx.fillText('\u798F', cx, cy);
            }
        } else {
            // Single (Original behavior)
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight * lerp(0.5, 0.20, riseEased);
            const baseSize = getLayout().arrivalFuSize;
            const fuSize = baseSize * lerp(1, DRAW_SHRINK_END_SCALE, shrinkEased);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const morphSpeed = 1.2 + riseT * 4.5;
            const morphPhase = t * morphSpeed;
            const fontCount = CALLI_FONTS.length;
            const rawIdx = (morphPhase % fontCount + fontCount) % fontCount;
            const fontA = Math.floor(rawIdx) % fontCount;
            const fontB = (fontA + 1) % fontCount;
            const crossFade = rawIdx - Math.floor(rawIdx);
            const intensity = 1 + riseT * 2.5;

            ctx.font = `${fuSize}px ${CALLI_FONTS[fontA]}, serif`;
            ctx.globalAlpha = Math.min(1, 0.3 * intensity) * (1 - crossFade);
            ctx.shadowColor = CONFIG.glowGold;
            ctx.shadowBlur = fuSize * 0.2 * intensity;
            ctx.fillStyle = CONFIG.glowGold;
            ctx.fillText('\u798F', cx, cy);
            ctx.globalAlpha = (1 - crossFade);
            ctx.shadowBlur = fuSize * 0.08 * intensity;
            ctx.fillText('\u798F', cx, cy);

            ctx.font = `${fuSize}px ${CALLI_FONTS[fontB]}, serif`;
            ctx.globalAlpha = Math.min(1, 0.3 * intensity) * crossFade;
            ctx.shadowBlur = fuSize * 0.2 * intensity;
            ctx.fillText('\u798F', cx, cy);
            ctx.globalAlpha = crossFade;
            ctx.shadowBlur = fuSize * 0.08 * intensity;
            ctx.fillText('\u798F', cx, cy);
        }

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // Burst flash — one per 福, at each 福's end position
    if (burstFlash > 0) {
        ctx.save();
        ctx.scale(dpr, dpr);

        const draws = window.currentDrawsList || [currentDrawResult];
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

// --- Fortune overlay with gacha-specific reveal ---
function renderFortuneOverlay() {
    // Multi-mode: canvas-integrated particle + card display
    if (isMultiMode && multiFortuneState) {
        // 1. Frosted glass cards (behind particles)
        renderMultiCards();
        // 2. GPU particles on top (additive blend)
        updateMultiDajiToGPU(true);
        renderAndCompositeGL();
        // 3. Revealed card text (on top of everything)
        renderMultiCardText();
        // 4. Hints
        renderMultiHints();
        return;
    }

    // Combined GPU render: character cluster + fireworks in one pass
    const dajiCount = updateDajiToGPU(true);

    if ((currentDrawResult && currentDrawResult.rarity.stars >= 4 &&
        (fwShells.length || fwTrail.length || fwParticles.length)) || hasTapFireworks()) {
        appendFireworksToGPU(dajiCount);
    } else {
        renderAndCompositeGL();
    }

    if (!currentDrawResult) return;

    const fadeIn = Math.min(1, stateTime / 0.9);
    const dr = currentDrawResult;
    const L = getLayout();

    // --- Single mode ---
    {
        const topCardFade = Math.min(1, Math.max(0, (stateTime - 0.3) / 0.6));
        drawCard(L.cardTop, L.cardBottom, topCardFade * 0.8, L.cardWidth);

        // --- Single character title with font cycling ---
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

        // --- Stars line ---
        const starsFade = Math.min(1, Math.max(0, (stateTime - 0.3) / 0.6));
        const starsFull = '\u2605'.repeat(dr.rarity.stars);
        const starsEmpty = '\u2606'.repeat(6 - dr.rarity.stars);
        const starsSize = isLandscape() ? Math.min(cellSize * 1.4, window.innerHeight * 0.03) : cellSize * 1.4;
        drawOverlayText(starsFull + starsEmpty, L.starsY, dr.rarity.color, starsFade * 0.85, starsSize);

        // --- Tier label ---
        const tierFade = Math.min(1, Math.max(0, (stateTime - 0.5) / 0.7));
        const tierLabel = dr.rarity.label + ' \u00B7 ' + dr.rarity.labelEn;
        const tierSize = isLandscape() ? Math.min(cellSize * 1.0, window.innerHeight * 0.022) : cellSize * 1.0;
        drawOverlayText(tierLabel, L.tierY, dr.rarity.color, tierFade * 0.7, tierSize);
    }

    // --- Blessing phrase + english ---
    const blessFade = Math.min(1, Math.max(0, (stateTime - 0.5) / 0.9));
    const phraseSize = isLandscape() ? Math.min(cellSize * 1.5, window.innerHeight * 0.032) : cellSize * 1.5;
    const engSize = isLandscape() ? Math.min(cellSize * 1, window.innerHeight * 0.022) : cellSize * 1;
    drawOverlayText(dr.blessing.phrase, L.phraseY, CONFIG.glowRed, blessFade * 0.7, phraseSize);
    drawOverlayText(dr.blessing.english, L.englishY, CONFIG.glowGold, blessFade * 0.5, engSize);

    // --- Hint to draw again ---
    if (stateTime > 2.5) {
        const hintFade = Math.min(1, (stateTime - 2.5) / 0.5);
        const pulse = 0.4 + Math.sin(globalTime * 3) * 0.2;

        const isMulti = selectedMode === 'multi';
        const mainText = isMulti ? '\u2191 \u518D\u6765\u5341\u8FDE \u2191' : '\u2191 \u518D\u62BD\u4E00\u6B21 \u2191';
        const subText = isMulti ? 'Swipe Up to Draw \u00D710' : 'Swipe Up to Draw Again';

        const hintSize = isLandscape() ? Math.min(cellSize * 1.2, window.innerHeight * 0.028) : cellSize * 1.2;
        const hintSubSize = isLandscape() ? Math.min(cellSize * 0.9, window.innerHeight * 0.02) : cellSize * 0.9;
        drawOverlayText(mainText, L.hintY, CONFIG.glowGold, hintFade * pulse, hintSize);
        drawOverlayText(subText, L.hintSubY, CONFIG.glowGold, hintFade * pulse, hintSubSize);
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

// const btnMultiPull = document.getElementById('btn-multi-pull'); // Removed
const modeSwitch = document.getElementById('mode-switch');
const multiOverlay = document.getElementById('multi-overlay');
const multiGrid = document.getElementById('multi-grid');
const multiDetail = document.getElementById('multi-detail');
const detailCard = document.getElementById('detail-card');
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

function startMultiPull() {
    const pity = getPityCounter();
    const { draws, newPityCounter } = performMultiDrawWithPity(pity);
    multiDrawResults = draws;
    saveMultiToCollection(multiDrawResults);
    const user = getUser();
    if (user) {
        user.pity_counter = newPityCounter;
    }

    // Find the best (highest rarity, i.e., lowest tierIndex) result
    let best = multiDrawResults[0];
    for (const d of multiDrawResults) {
        if (d.tierIndex < best.tierIndex) best = d;
    }
    currentDrawResult = best;
    isMultiMode = true;
    multiFlipState = null;
    multiFortuneState = null;

    // Reset state for draw animation
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
    console.log('[showMultiCardsWithFlip] Called with', draws?.length, 'draws, multiOverlay:', !!multiOverlay, 'multiGrid:', !!multiGrid);
    if (!draws || !draws.length) return;

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

        const starsStr = '\u2605'.repeat(draw.rarity.stars) + '\u2606'.repeat(6 - draw.rarity.stars);
        front.innerHTML = `
            <div class="card-front-inner">
                <div class="mc-stars">${starsStr}</div>
                <div class="mc-char">${draw.char}</div>
                <div class="mc-tier">${draw.rarity.label}</div>
                <div class="mc-phrase">${draw.blessing.phrase}</div>
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
            if (card.classList.contains('anticipate-5') || card.classList.contains('anticipate-6')) return;

            const stars = draw.rarity.stars;
            if (stars >= 5) {
                // Slow-motion: anticipation shake → slow flip → screen flash
                const anticClass = 'anticipate-' + stars;
                const slowClass = 'slow-flip-' + stars;
                card.classList.add(anticClass);
                const anticDuration = stars >= 6 ? 700 : 500;
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

// (Duplicate onAllCardsRevealed removed)

// (Duplicate updateMultiActionsVisibility removed)

function showMultiDetail(draw) {
    const detailStars = document.getElementById('detail-stars');
    const detailCategory = document.getElementById('detail-category');
    const detailCharacter = document.getElementById('detail-character');
    const detailPhrase = document.getElementById('detail-phrase');
    const detailEnglish = document.getElementById('detail-english');
    const detailTier = document.getElementById('detail-tier');

    detailCard.style.setProperty('--card-color', draw.rarity.color);
    detailCard.style.setProperty('--card-glow', draw.rarity.glow);

    detailStars.textContent = '\u2605'.repeat(draw.rarity.stars) + '\u2606'.repeat(6 - draw.rarity.stars);
    detailStars.style.color = draw.rarity.color;
    detailCategory.textContent = '[ ' + draw.category.name + ' ]';
    detailCategory.style.color = draw.category.color;
    detailCharacter.textContent = draw.char;
    detailPhrase.textContent = draw.blessing.phrase;
    detailEnglish.textContent = draw.blessing.english;
    detailTier.textContent = draw.rarity.label + ' \u00B7 ' + draw.rarity.labelEn;
    detailTier.style.color = draw.rarity.color;

    multiDetail.classList.add('visible');

    // Pass to monetization UI for share/gift buttons
    const coll = loadCollection();
    setDetailDraw(draw, coll[draw.char] || null);
}

function hideMultiDetail() {
    multiDetail.classList.remove('visible');
}

function hideMultiOverlay() {
    console.log('[hideMultiOverlay] Called, stack:', new Error().stack?.split('\n').slice(1, 3).join(' | '));
    multiOverlay.classList.remove('visible');
    multiDetail.classList.remove('visible');
    hideHoverDetail();
    multiFlipState = null;
    isMultiMode = false;
    multiDrawResults = null;
}

// Multi-fortune action buttons (now floating over canvas)
if (btnMultiSingle) {
    btnMultiSingle.addEventListener('click', (e) => {
        e.stopPropagation();
        resetMultiFortune();
        selectedMode = 'single';
        updateModeSwitchUI();
        changeState('draw');
    });
}

if (btnMultiAgain) {
    btnMultiAgain.addEventListener('click', (e) => {
        e.stopPropagation();
        startMultiPull();
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
            if (!card.revealed && !card.anticipating) {
                const idx = i;
                const stars = card.draw.rarity.stars;
                setTimeout(() => revealCard(idx), delay);
                // Add extra time for high-rarity anticipation animations
                delay += stars >= 6 ? 1100 : stars >= 5 ? 750 : 100;
            }
        }
    });
}

// Detail popup — click to dismiss
if (multiDetail) {
    multiDetail.addEventListener('click', (e) => {
        if (e.target === multiDetail) {
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
const btnDrawFromCollection = document.getElementById('btn-draw-from-collection');
const btnCloseCollection = document.getElementById('btn-close-collection');

function showCollectionPanel() {
    const progress = getCollectionProgress();
    const categories = getCollectionByCategory();

    // Update progress / stats
    if (collectionProgress) {
        collectionProgress.className = 'collection-stats';
        collectionProgress.innerHTML =
            `<div class="stat-item">
                <div class="stat-value">${progress.collected}</div>
                <div class="stat-label">Collected</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${progress.total}</div>
                <div class="stat-label">Total</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${progress.percentage}%</div>
                <div class="stat-label">Completion</div>
            </div>`;
    }

    // Build grid
    if (collectionGrid) {
        collectionGrid.className = 'collection-content';
        collectionGrid.innerHTML = '';
        
        // Helper to determine stars from category index (reverse mapped from TIER_CATEGORIES)
        // 0->6, 7/8->5, 4/5->4, 2/6->3, 1/3->2
        const getStars = (idx) => {
            if (idx === 0) return 6;
            if (idx === 7 || idx === 8) return 5;
            if (idx === 4 || idx === 5) return 4;
            if (idx === 2 || idx === 6) return 3;
            return 2;
        };

        let cardIdx = 0;
        categories.forEach((cat, idx) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'collection-category-group';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'collection-category-title';
            titleDiv.innerHTML = `${cat.name} <span>${cat.nameEn}</span>`;
            groupDiv.appendChild(titleDiv);

            const gridDiv = document.createElement('div');
            gridDiv.className = 'collection-grid-new';

            const catStars = getStars(idx);

            for (const item of cat.items) {
                const card = document.createElement('div');
                const isCollected = item.collected;
                // Use maxStars if collected, otherwise default to category stars
                const stars = isCollected ? item.maxStars : catStars;
                
                let rarityClass = '';
                if (stars >= 6) rarityClass = ' r6';
                else if (stars === 5) rarityClass = ' r5';
                
                card.className = `collection-card ${isCollected ? 'collected' : 'uncollected'}${rarityClass}`;
                
                // Content
                const charText = item.char;
                const charEnText = (item.blessing && item.blessing.charEn) ? item.blessing.charEn : '';
                const nameText = item.blessing ? item.blessing.phrase : '???';

                card.innerHTML = `
                    <div class="card-inner">
                        <div class="card-char">${charText}</div>
                        <div class="card-english">${charEnText}</div>
                        <div class="card-meta">
                            <div class="card-name">${nameText}</div>
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
                        const rarity = RARITY_TIERS.find(t => t.stars === stars) || RARITY_TIERS[4]; // default to lowest
                        
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

if (btnDrawFromCollection) {
    btnDrawFromCollection.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCollectionPanel();
        if (isMultiMode) {
            resetMultiFortune();
        }
        if (state === 'fortune' || state === 'arrival') {
            isMultiMode = false;
            daji3DParticles = [];
            hoveredIdx = -1;
            if (particlesMesh) particlesMesh.count = 0;
            hideTooltip();
            changeState('draw');
        }
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
    const collVisible = collectionPanel && collectionPanel.classList.contains('visible');
    // Mode Switch: visible in arrival, single fortune, and multi fortune after all revealed
    if (modeSwitch) {
        if (!collVisible && (state === 'arrival' || (state === 'fortune' && (!isMultiMode || allMultiRevealed))) && fontsReady) {
            modeSwitch.classList.add('visible');
        } else {
            modeSwitch.classList.remove('visible');
        }
    }

    // Collection FAB: visible in arrival, single fortune, and multi fortune after all revealed
    if (btnCollection) {
        if (!collVisible && (state === 'arrival' || (state === 'fortune' && (!isMultiMode || allMultiRevealed)))) {
            btnCollection.classList.add('visible');
        } else {
            btnCollection.classList.remove('visible');
        }
    }

    // Reveal All button: visible when multi-fortune cards are showing and not all revealed
    const btnRevealAll = document.getElementById('btn-reveal-all');
    if (btnRevealAll) {
        if (multiFortuneState && multiFortuneState.revealedCount < multiFortuneState.cards.length) {
            btnRevealAll.style.display = 'block';
        } else {
            btnRevealAll.style.display = 'none';
        }
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
            } else {
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
        // Tap → firework burst (not during multi-fortune card display)
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
                } else {
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

function handleSwipeUp() {
    if (state === 'arrival' && fontsReady) {
        const user = getUser();
        const drawsNeeded = selectedMode === 'multi' ? 10 : 1;

        if (user && user.draws_remaining < drawsNeeded) {
            showRewardsPanel();
            return;
        }

        if (user) {
            updateDraws(-drawsNeeded);
        }

        if (selectedMode === 'multi') {
            startMultiPull();
        } else {
            isMultiMode = false;
            changeState('draw');
        }
    } else if (state === 'fortune') {
        // Block swipe-up if multi-mode cards not all revealed yet
        if (isMultiMode && multiFortuneState && multiFortuneState.revealedCount < multiFortuneState.cards.length) {
            return;
        }

        // Clean up multi-fortune state
        if (isMultiMode) {
            resetMultiFortune();
        }

        const user = getUser();
        const drawsNeeded = selectedMode === 'multi' ? 10 : 1;

        if (user && user.draws_remaining < drawsNeeded) {
            showRewardsPanel();
            return;
        }

        if (user) {
            updateDraws(-drawsNeeded);
        }

        // Draw again loop
        daji3DParticles = [];
        hoveredIdx = -1;
        if (particlesMesh) particlesMesh.count = 0;
        hideTooltip();

        if (selectedMode === 'multi') {
            startMultiPull();
        } else {
            isMultiMode = false;
            changeState('draw');
        }
    }
}

// Rewards panel opener (implemented in monetization-ui.js)
function showRewardsPanel() {
    const panel = document.getElementById('rewards-panel');
    if (panel) panel.style.display = 'flex';
}

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

        switch (state) {
            case 'arrival':  renderArrivalOverlay(); break;
            case 'draw':     renderDrawOverlay(); break;
            case 'fortune':  renderFortuneOverlay(); break;
        }
    } catch (err) {
        console.error('[frame error]', err);
        // Safety: if draw crashed, force transition to fortune for multi-mode
        if (state === 'draw' && isMultiMode && multiDrawResults) {
            console.warn('[safety] Forcing transition to fortune after draw error');
            changeState('fortune');
        }
    }

    requestAnimationFrame(frame);
}

// --- Monetization init ---
(async () => {
  initAds();
  await restoreSession();

  // Handle gift claim from URL
  const giftToken = getGiftTokenFromUrl();
  if (giftToken) {
    try {
      const gift = await claimGift(giftToken);
      console.log('Gift claimed:', gift.character);
    } catch (e) {
      console.warn('Gift claim failed:', e.message);
    }
  }

  // Handle payment return
  const paymentResult = getPaymentResult();
  if (paymentResult?.status === 'success') {
    console.log('Payment successful');
  }

  // Return expired gifts (dev mode)
  await returnExpiredGifts();

  // Daily login check
  const loginReward = await claimDailyLogin();
  if (loginReward) {
    console.log('Daily login reward:', loginReward);
  }

  // Initialize monetization UI (auth bar, rewards panel, etc.)
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
