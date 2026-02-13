// ============================================================
// gacha.js — Fortune Gacha Mechanics
// Pure data + logic, no DOM/rendering
// ============================================================

// --- Rarity Tiers (weighted probabilities) ---
export const RARITY_TIERS = [
    { stars: 6, weight: 3,  label: '天赐鸿福', labelEn: 'Heavenly Fortune', color: '#FF4500', glow: 'rgba(255,69,0,0.5)',   burstRGB: [255, 69, 0] },
    { stars: 5, weight: 7,  label: '吉星高照', labelEn: 'Auspicious Stars', color: '#B070FF', glow: 'rgba(176,112,255,0.5)', burstRGB: [176, 112, 255] },
    { stars: 4, weight: 15, label: '福泽绵长', labelEn: 'Enduring Blessings', color: '#4DA6FF', glow: 'rgba(77,166,255,0.5)', burstRGB: [77, 166, 255] },
    { stars: 3, weight: 25, label: '心想事成', labelEn: 'Wishes Come True', color: '#4ADE80', glow: 'rgba(74,222,128,0.5)', burstRGB: [74, 222, 128] },
    { stars: 2, weight: 50, label: '迎春纳福', labelEn: 'Welcoming Fortune',   color: '#B0BEC5', glow: 'rgba(176,190,197,0.5)', burstRGB: [176, 190, 197] },
];

// --- Blessing Categories (9 categories) ---
export const BLESSING_CATEGORIES = [
    { name: '五福临门', nameEn: 'Five Blessings', chars: '福禄寿喜财',              r: 255, g: 45,  b: 45,  color: '#FF2D2D' },
    { name: '招财进宝', nameEn: 'Wealth',         chars: '富贵发金玉宝余丰盛利旺隆昌', r: 255, g: 215, b: 0,   color: '#FFD700' },
    { name: '岁岁平安', nameEn: 'Peace',          chars: '安康宁泰和平顺健',          r: 0,   g: 255, b: 159, color: '#00FF9F' },
    { name: '喜气洋洋', nameEn: 'Joy',            chars: '乐欢庆禧祺嘉春',            r: 255, g: 120, b: 80,  color: '#FF7850' },
    { name: '厚德载物', nameEn: 'Virtue',         chars: '德善仁义忠信孝慧恩',         r: 255, g: 200, b: 50,  color: '#FFC832' },
    { name: '花好月圆', nameEn: 'Love',           chars: '爱合圆满美馨雅',             r: 255, g: 130, b: 180, color: '#FF82B4' },
    { name: '吉祥如意', nameEn: 'Auspicious',     chars: '吉祥瑞如意祝运',             r: 180, g: 255, b: 80,  color: '#B4FF50' },
    { name: '神兽庇佑', nameEn: 'Mythical',       chars: '龙凤麟鹤华',                r: 255, g: 180, b: 50,  color: '#FFB432' },
    { name: '步步高升', nameEn: 'Achievement',    chars: '成升登高兴进',               r: 80,  g: 220, b: 255, color: '#50DCFF' },
];

// --- Tier → Category mapping (which categories can appear at which rarity) ---
const TIER_CATEGORIES = [
    [0],          // 6-star: Five Blessings only
    [7, 8],       // 5-star: Mythical, Achievement
    [4, 5],       // 4-star: Virtue, Love
    [2, 6],       // 3-star: Peace, Auspicious
    [1, 3],       // 2-star: Wealth, Joy
];

// --- Full Blessings Map (70+ characters) ---
export const FULL_CHAR_BLESSINGS = {
    '福': { charEn: 'Fortune', phrase: '福星高照', english: 'The star of fortune shines bright' },
    '禄': { charEn: 'Prosperity', phrase: '高官厚禄', english: 'High rank and generous reward' },
    '寿': { charEn: 'Longevity', phrase: '福寿双全', english: 'Both blessings and longevity' },
    '喜': { charEn: 'Happiness', phrase: '双喜临门', english: 'Double happiness at the door' },
    '财': { charEn: 'Wealth', phrase: '财源广进', english: 'Wealth flowing from all directions' },
    '富': { charEn: 'Rich', phrase: '富贵有余', english: 'Wealth and abundance to spare' },
    '贵': { charEn: 'Noble', phrase: '荣华富贵', english: 'Glory, splendor, and riches' },
    '发': { charEn: 'Prosper', phrase: '恭喜发财', english: 'Wishing you great prosperity' },
    '金': { charEn: 'Gold', phrase: '金玉满堂', english: 'Gold and jade fill the hall' },
    '玉': { charEn: 'Jade', phrase: '金枝玉叶', english: 'Golden branches, jade leaves' },
    '宝': { charEn: 'Treasure', phrase: '招财进宝', english: 'Bringing in wealth and treasure' },
    '余': { charEn: 'Surplus', phrase: '年年有余', english: 'Surplus and abundance every year' },
    '丰': { charEn: 'Abundance', phrase: '五谷丰登', english: 'Bumper grain harvest' },
    '盛': { charEn: 'Flourish', phrase: '繁荣昌盛', english: 'Prosperous and flourishing' },
    '利': { charEn: 'Profit', phrase: '开岁大利', english: 'Great profit in the new year' },
    '旺': { charEn: 'Thriving', phrase: '人丁兴旺', english: 'A growing and prosperous family' },
    '隆': { charEn: 'Grand', phrase: '隆盛昌达', english: 'Grand and flourishing' },
    '昌': { charEn: 'Prosper', phrase: '国运昌盛', english: 'National destiny flourishing' },
    '安': { charEn: 'Peace', phrase: '岁岁平安', english: 'Peace and safety year after year' },
    '康': { charEn: 'Health', phrase: '健康长寿', english: 'Health and longevity' },
    '宁': { charEn: 'Serenity', phrase: '宁静致远', english: 'Tranquility leads to greatness' },
    '泰': { charEn: 'Harmony', phrase: '国泰民安', english: 'National peace, people safe' },
    '和': { charEn: 'Harmony', phrase: '和气生财', english: 'Harmony brings prosperity' },
    '平': { charEn: 'Peace', phrase: '四季平安', english: 'Peace through all four seasons' },
    '顺': { charEn: 'Smooth', phrase: '万事顺利', english: 'All things go smoothly' },
    '健': { charEn: 'Vigor', phrase: '身体健康', english: 'Strong health of body' },
    '乐': { charEn: 'Joy', phrase: '快乐无忧', english: 'Joy without worry' },
    '欢': { charEn: 'Delight', phrase: '合家欢乐', english: 'The whole family rejoices' },
    '庆': { charEn: 'Celebrate', phrase: '普天同庆', english: 'The whole world celebrates' },
    '禧': { charEn: 'Bliss', phrase: '恭贺新禧', english: 'Congratulations and new joy' },
    '祺': { charEn: 'Auspicious', phrase: '吉祥如意', english: 'Lucky and as you wish' },
    '嘉': { charEn: 'Splendid', phrase: '嘉年华会', english: 'A grand festival gathering' },
    '春': { charEn: 'Spring', phrase: '春风得意', english: 'Success on the spring breeze' },
    '德': { charEn: 'Virtue', phrase: '厚德载物', english: 'Great virtue carries all' },
    '善': { charEn: 'Goodness', phrase: '上善若水', english: 'The greatest good is like water' },
    '仁': { charEn: 'Benevolence', phrase: '仁者无敌', english: 'The benevolent are invincible' },
    '义': { charEn: 'Righteousness', phrase: '义薄云天', english: 'Righteousness reaching the clouds' },
    '忠': { charEn: 'Loyalty', phrase: '忠义双全', english: 'Both loyal and righteous' },
    '信': { charEn: 'Trust', phrase: '言而有信', english: 'True to one\'s word' },
    '孝': { charEn: 'Filial Piety', phrase: '百善孝先', english: 'Of all virtues, filial piety first' },
    '慧': { charEn: 'Wisdom', phrase: '慧心巧思', english: 'Wise heart, clever mind' },
    '恩': { charEn: 'Grace', phrase: '恩重如山', english: 'Kindness as heavy as mountains' },
    '爱': { charEn: 'Love', phrase: '大爱无疆', english: 'Great love knows no bounds' },
    '合': { charEn: 'Unity', phrase: '百年好合', english: 'A hundred years of harmony' },
    '圆': { charEn: 'Wholeness', phrase: '花好月圆', english: 'Flowers bloom, moon is full' },
    '满': { charEn: 'Fullness', phrase: '圆圆满满', english: 'Perfectly complete in every way' },
    '美': { charEn: 'Beauty', phrase: '十全十美', english: 'Perfection in every way' },
    '馨': { charEn: 'Fragrance', phrase: '温馨美满', english: 'Warm and blissful' },
    '雅': { charEn: 'Elegance', phrase: '雅量高致', english: 'Elegant and magnanimous spirit' },
    '吉': { charEn: 'Lucky', phrase: '吉祥如意', english: 'Good fortune as you wish' },
    '祥': { charEn: 'Auspicious', phrase: '龙凤呈祥', english: 'Dragon and phoenix bring fortune' },
    '瑞': { charEn: 'Auspicious', phrase: '瑞气盈门', english: 'Auspicious energy fills the door' },
    '如': { charEn: 'As Wished', phrase: '称心如意', english: 'Everything goes as desired' },
    '意': { charEn: 'Wish', phrase: '万事如意', english: 'All things as you wish' },
    '祝': { charEn: 'Blessing', phrase: '祝福满满', english: 'Brimming with blessings' },
    '运': { charEn: 'Fortune', phrase: '鸿运当头', english: 'Great fortune on its way' },
    '龙': { charEn: 'Dragon', phrase: '龙马精神', english: 'The vigor of dragons and horses' },
    '凤': { charEn: 'Phoenix', phrase: '凤鸣朝阳', english: 'Phoenix singing to the rising sun' },
    '麟': { charEn: 'Qilin', phrase: '凤毛麟角', english: 'Rare as phoenix feathers' },
    '鹤': { charEn: 'Crane', phrase: '鹤寿延年', english: 'Longevity of the crane' },
    '华': { charEn: 'Splendor', phrase: '荣华富贵', english: 'Prosperity and splendor' },
    '成': { charEn: 'Success', phrase: '马到成功', english: 'Success upon arrival' },
    '升': { charEn: 'Rise', phrase: '步步高升', english: 'Rising higher step by step' },
    '登': { charEn: 'Ascend', phrase: '五子登科', english: 'All five sons pass the exam' },
    '高': { charEn: 'Height', phrase: '高瞻远瞩', english: 'Far-sighted vision' },
    '兴': { charEn: 'Flourish', phrase: '兴旺发达', english: 'Flourishing and thriving' },
    '进': { charEn: 'Advance', phrase: '招财进宝', english: 'Attracting wealth and treasure' },
};

// All unique characters across all categories
export const ALL_CHARS = [...new Set(BLESSING_CATEGORIES.flatMap(c => [...c.chars]))];

// --- Core Draw Functions ---

export function performDraw() {
    // 1. Weighted random: pick a rarity tier
    const totalWeight = RARITY_TIERS.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * totalWeight;
    let tierIdx = RARITY_TIERS.length - 1;
    for (let i = 0; i < RARITY_TIERS.length; i++) {
        roll -= RARITY_TIERS[i].weight;
        if (roll <= 0) { tierIdx = i; break; }
    }
    const tier = RARITY_TIERS[tierIdx];

    // 2. Pick a category valid for this tier
    const catIndices = TIER_CATEGORIES[tierIdx];
    const catIdx = catIndices[Math.floor(Math.random() * catIndices.length)];
    const category = BLESSING_CATEGORIES[catIdx];

    // 3. Pick a random character from that category
    const chars = [...category.chars];
    const char = chars[Math.floor(Math.random() * chars.length)];

    // 4. Get blessing
    const blessing = FULL_CHAR_BLESSINGS[char] || { phrase: char + '运亨通', english: 'Fortune and blessings upon you' };

    return { char, rarity: tier, tierIndex: tierIdx, category, blessing };
}

// Shuffle draws for suspense: best card lands near the end, rest are random.
// Mimics gacha games where the rare card is a dramatic late reveal.
function shuffleDrawsWithSuspense(draws) {
    // Fisher-Yates shuffle
    const arr = [...draws];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    // Find the best (lowest tierIndex = highest rarity) card
    let bestIdx = 0;
    for (let i = 1; i < arr.length; i++) {
        if (arr[i].tierIndex < arr[bestIdx].tierIndex) bestIdx = i;
    }

    // Only relocate if it's 4★+ (tierIndex <= 2) — no need for commons
    if (arr[bestIdx].tierIndex <= 2) {
        // Move best card to one of the last 3 positions (index 7, 8, or 9)
        const targetPos = 7 + Math.floor(Math.random() * 3);
        if (bestIdx !== targetPos) {
            [arr[bestIdx], arr[targetPos]] = [arr[targetPos], arr[bestIdx]];
        }
    }

    return arr;
}

export function performMultiDraw() {
    const draws = [];
    for (let i = 0; i < 10; i++) draws.push(performDraw());
    return shuffleDrawsWithSuspense(draws);
}

// --- Pity-Aware Draw Functions ---

function forceRarity(tierIdx) {
    const tier = RARITY_TIERS[tierIdx];
    const catIndices = TIER_CATEGORIES[tierIdx];
    const catIdx = catIndices[Math.floor(Math.random() * catIndices.length)];
    const category = BLESSING_CATEGORIES[catIdx];
    const chars = [...category.chars];
    const char = chars[Math.floor(Math.random() * chars.length)];
    const blessing = FULL_CHAR_BLESSINGS[char] || { phrase: char + '运亨通', english: 'Fortune and blessings upon you' };
    return { char, rarity: tier, tierIndex: tierIdx, category, blessing };
}

export function performDrawWithPity(pityCounter) {
    // Guaranteed 6★ at 90 pity
    if (pityCounter >= 89) {
        return forceRarity(0);
    }
    // Guaranteed 5★+ at 50 pity
    if (pityCounter >= 49) {
        const roll = Math.random();
        if (roll < 0.5) return forceRarity(0);
        return forceRarity(1);
    }
    return performDraw();
}

export function performMultiDrawWithPity(pityCounter) {
    const draws = [];
    let pity = pityCounter;
    for (let i = 0; i < 10; i++) {
        const draw = performDrawWithPity(pity);
        draws.push(draw);
        if (draw.tierIndex <= 1) {
            pity = 0; // reset pity on 5★+
        } else {
            pity++;
        }
    }
    const shuffled = shuffleDrawsWithSuspense(draws);
    return { draws: shuffled, newPityCounter: pity };
}

// --- Collection Management (localStorage) ---

const COLLECTION_KEY = 'fu_gacha_collection';
const STATS_KEY = 'fu_gacha_stats';

export function loadCollection() {
    try {
        return JSON.parse(localStorage.getItem(COLLECTION_KEY)) || {};
    } catch { return {}; }
}

export function loadStats() {
    try {
        return JSON.parse(localStorage.getItem(STATS_KEY)) || { totalDraws: 0 };
    } catch { return { totalDraws: 0 }; }
}

export function saveToCollection(draw) {
    const coll = loadCollection();
    const key = draw.char;
    if (!coll[key]) {
        coll[key] = {
            char: draw.char,
            maxStars: draw.rarity.stars,
            count: 1,
            firstDrawn: Date.now(),
            categoryName: draw.category.name,
        };
    } else {
        coll[key].count++;
        coll[key].maxStars = Math.max(coll[key].maxStars, draw.rarity.stars);
    }
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(coll));

    const stats = loadStats();
    stats.totalDraws = (stats.totalDraws || 0) + 1;
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function saveMultiToCollection(draws) {
    const coll = loadCollection();
    const stats = loadStats();
    for (const draw of draws) {
        const key = draw.char;
        if (!coll[key]) {
            coll[key] = {
                char: draw.char,
                maxStars: draw.rarity.stars,
                count: 1,
                firstDrawn: Date.now(),
                categoryName: draw.category.name,
            };
        } else {
            coll[key].count++;
            coll[key].maxStars = Math.max(coll[key].maxStars, draw.rarity.stars);
        }
        stats.totalDraws = (stats.totalDraws || 0) + 1;
    }
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(coll));
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function getCollectionProgress() {
    const coll = loadCollection();
    const total = ALL_CHARS.length;
    const collected = Object.keys(coll).length;
    return { collected, total, percentage: total > 0 ? Math.floor(collected / total * 100) : 0 };
}

export function getCollectionByCategory() {
    const coll = loadCollection();
    return BLESSING_CATEGORIES.map(cat => ({
        ...cat,
        items: [...cat.chars].map(ch => ({
            char: ch,
            collected: !!coll[ch],
            count: coll[ch]?.count || 0,
            maxStars: coll[ch]?.maxStars || 0,
            blessing: FULL_CHAR_BLESSINGS[ch],
        })),
        collectedCount: [...cat.chars].filter(ch => !!coll[ch]).length,
    }));
}
