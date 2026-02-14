// ============================================================
// gacha.js — Fortune Gacha Mechanics
// Pure data + logic, no DOM/rendering
// ============================================================

// --- Rarity Tiers (weighted probabilities) ---
export const RARITY_TIERS = [
    { stars: 7, weight: 1,  label: '五福临门', labelEn: 'Five Blessings United', color: '#FF0000', glow: 'rgba(255,0,0,0.7)',     burstRGB: [255, 0, 0] },
    { stars: 6, weight: 3,  label: '天赐鸿福', labelEn: 'Heavenly Fortune',      color: '#FF4500', glow: 'rgba(255,69,0,0.5)',    burstRGB: [255, 69, 0] },
    { stars: 5, weight: 7,  label: '吉星高照', labelEn: 'Auspicious Stars',      color: '#B070FF', glow: 'rgba(176,112,255,0.5)', burstRGB: [176, 112, 255] },
    { stars: 4, weight: 15, label: '福泽绵长', labelEn: 'Enduring Blessings',    color: '#4DA6FF', glow: 'rgba(77,166,255,0.5)',  burstRGB: [77, 166, 255] },
    { stars: 3, weight: 25, label: '心想事成', labelEn: 'Wishes Come True',      color: '#4ADE80', glow: 'rgba(74,222,128,0.5)',  burstRGB: [74, 222, 128] },
    { stars: 2, weight: 50, label: '迎春纳福', labelEn: 'Welcoming Fortune',     color: '#B0BEC5', glow: 'rgba(176,190,197,0.5)', burstRGB: [176, 190, 197] },
];

// --- Blessing Categories (9 categories) ---
export const BLESSING_CATEGORIES = [
    { name: '五福临门', nameEn: 'Five Blessings', chars: '福禄寿喜财',                  r: 255, g: 45,  b: 45,  color: '#FF2D2D' },
    { name: '招财进宝', nameEn: 'Wealth',         chars: '富贵发金玉宝余丰盛利旺隆昌银珠', r: 255, g: 215, b: 0,   color: '#FFD700' },
    { name: '岁岁平安', nameEn: 'Peace',          chars: '安康宁泰和平顺健静悠稳',        r: 0,   g: 255, b: 159, color: '#00FF9F' },
    { name: '喜气洋洋', nameEn: 'Joy',            chars: '乐欢庆禧祺嘉春笑悦怡',          r: 255, g: 120, b: 80,  color: '#FF7850' },
    { name: '厚德载物', nameEn: 'Virtue',         chars: '德善仁义忠信孝慧恩礼廉',        r: 255, g: 200, b: 50,  color: '#FFC832' },
    { name: '花好月圆', nameEn: 'Love',           chars: '爱合圆满美馨雅缘情甜',           r: 255, g: 130, b: 180, color: '#FF82B4' },
    { name: '吉祥如意', nameEn: 'Auspicious',     chars: '吉祥瑞如意祝运幸兆贺',           r: 180, g: 255, b: 80,  color: '#B4FF50' },
    { name: '神兽庇佑', nameEn: 'Mythical',       chars: '龙凤麟鹤华麒凰鹿',              r: 255, g: 180, b: 50,  color: '#FFB432' },
    { name: '步步高升', nameEn: 'Achievement',    chars: '成升登高兴进达辉',               r: 80,  g: 220, b: 255, color: '#50DCFF' },
];

// --- Full Blessings Map (88 characters, each with baseStars) ---
export const FULL_CHAR_BLESSINGS = {
    // ═══ 五福临门 · Five Blessings (all 7★) ═══
    '福': { baseStars: 7, charEn: 'Fortune',    phrase: '福星高照', english: 'The star of fortune shines bright' },
    '禄': { baseStars: 7, charEn: 'Prosperity', phrase: '高官厚禄', english: 'High rank and generous reward' },
    '寿': { baseStars: 7, charEn: 'Longevity',  phrase: '福寿双全', english: 'Both blessings and longevity' },
    '喜': { baseStars: 7, charEn: 'Happiness',  phrase: '双喜临门', english: 'Double happiness at the door' },
    '财': { baseStars: 7, charEn: 'Wealth',     phrase: '财源广进', english: 'Wealth flowing from all directions' },
    // ═══ 招财进宝 · Wealth ═══
    '金': { baseStars: 6, charEn: 'Gold',       phrase: '金玉满堂', english: 'Gold and jade fill the hall' },
    '宝': { baseStars: 6, charEn: 'Treasure',   phrase: '招财进宝', english: 'Bringing in wealth and treasure' },
    '富': { baseStars: 5, charEn: 'Rich',       phrase: '富贵有余', english: 'Wealth and abundance to spare' },
    '发': { baseStars: 5, charEn: 'Prosper',    phrase: '恭喜发财', english: 'Wishing you great prosperity' },
    '贵': { baseStars: 4, charEn: 'Noble',      phrase: '荣华富贵', english: 'Glory, splendor, and riches' },
    '玉': { baseStars: 4, charEn: 'Jade',       phrase: '金枝玉叶', english: 'Golden branches, jade leaves' },
    '银': { baseStars: 4, charEn: 'Silver',     phrase: '银装素裹', english: 'Dressed in silver frost' },
    '盛': { baseStars: 3, charEn: 'Flourish',   phrase: '繁荣昌盛', english: 'Prosperous and flourishing' },
    '旺': { baseStars: 3, charEn: 'Thriving',   phrase: '人丁兴旺', english: 'A growing and prosperous family' },
    '昌': { baseStars: 3, charEn: 'Prosper',    phrase: '国运昌盛', english: 'National destiny flourishing' },
    '珠': { baseStars: 3, charEn: 'Pearl',      phrase: '珠光宝气', english: 'Shimmering with pearls and jewels' },
    '余': { baseStars: 2, charEn: 'Surplus',    phrase: '年年有余', english: 'Surplus and abundance every year' },
    '丰': { baseStars: 2, charEn: 'Abundance',  phrase: '五谷丰登', english: 'Bumper grain harvest' },
    '利': { baseStars: 2, charEn: 'Profit',     phrase: '开岁大利', english: 'Great profit in the new year' },
    '隆': { baseStars: 2, charEn: 'Grand',      phrase: '隆盛昌达', english: 'Grand and flourishing' },
    // ═══ 岁岁平安 · Peace ═══
    '安': { baseStars: 6, charEn: 'Peace',      phrase: '岁岁平安', english: 'Peace and safety year after year' },
    '康': { baseStars: 5, charEn: 'Health',     phrase: '健康长寿', english: 'Health and longevity' },
    '泰': { baseStars: 5, charEn: 'Harmony',    phrase: '国泰民安', english: 'National peace, people safe' },
    '和': { baseStars: 4, charEn: 'Harmony',    phrase: '和气生财', english: 'Harmony brings prosperity' },
    '健': { baseStars: 4, charEn: 'Vigor',      phrase: '身体健康', english: 'Strong health of body' },
    '平': { baseStars: 3, charEn: 'Peace',      phrase: '四季平安', english: 'Peace through all four seasons' },
    '宁': { baseStars: 3, charEn: 'Serenity',   phrase: '宁静致远', english: 'Tranquility leads to greatness' },
    '静': { baseStars: 3, charEn: 'Calm',       phrase: '岁月静好', english: 'Tranquil and serene days' },
    '顺': { baseStars: 2, charEn: 'Smooth',     phrase: '万事顺利', english: 'All things go smoothly' },
    '悠': { baseStars: 2, charEn: 'Leisurely',  phrase: '悠然自得', english: 'At ease and content' },
    '稳': { baseStars: 2, charEn: 'Steady',     phrase: '稳如泰山', english: 'Steady as Mount Tai' },
    // ═══ 喜气洋洋 · Joy ═══
    '禧': { baseStars: 6, charEn: 'Bliss',      phrase: '恭贺新禧', english: 'Congratulations and new joy' },
    '庆': { baseStars: 5, charEn: 'Celebrate',  phrase: '普天同庆', english: 'The whole world celebrates' },
    '嘉': { baseStars: 5, charEn: 'Splendid',   phrase: '嘉年华会', english: 'A grand festival gathering' },
    '春': { baseStars: 4, charEn: 'Spring',     phrase: '春风得意', english: 'Success on the spring breeze' },
    '乐': { baseStars: 4, charEn: 'Joy',        phrase: '快乐无忧', english: 'Joy without worry' },
    '欢': { baseStars: 3, charEn: 'Delight',    phrase: '合家欢乐', english: 'The whole family rejoices' },
    '祺': { baseStars: 3, charEn: 'Auspicious', phrase: '吉祥如意', english: 'Lucky and as you wish' },
    '笑': { baseStars: 2, charEn: 'Laugh',      phrase: '笑口常开', english: 'Always smiling and joyful' },
    '悦': { baseStars: 2, charEn: 'Pleased',    phrase: '赏心悦目', english: 'Delightful to the heart and eye' },
    '怡': { baseStars: 2, charEn: 'Joyful',     phrase: '心旷神怡', english: 'Carefree and content in spirit' },
    // ═══ 厚德载物 · Virtue ═══
    '德': { baseStars: 6, charEn: 'Virtue',         phrase: '厚德载物', english: 'Great virtue carries all' },
    '仁': { baseStars: 5, charEn: 'Benevolence',    phrase: '仁者无敌', english: 'The benevolent are invincible' },
    '慧': { baseStars: 5, charEn: 'Wisdom',         phrase: '慧心巧思', english: 'Wise heart, clever mind' },
    '善': { baseStars: 4, charEn: 'Goodness',       phrase: '上善若水', english: 'The greatest good is like water' },
    '义': { baseStars: 4, charEn: 'Righteousness',  phrase: '义薄云天', english: 'Righteousness reaching the clouds' },
    '忠': { baseStars: 3, charEn: 'Loyalty',        phrase: '忠义双全', english: 'Both loyal and righteous' },
    '信': { baseStars: 3, charEn: 'Trust',          phrase: '言而有信', english: 'True to one\'s word' },
    '孝': { baseStars: 3, charEn: 'Filial Piety',   phrase: '百善孝先', english: 'Of all virtues, filial piety first' },
    '恩': { baseStars: 2, charEn: 'Grace',          phrase: '恩重如山', english: 'Kindness as heavy as mountains' },
    '礼': { baseStars: 2, charEn: 'Propriety',      phrase: '知书达礼', english: 'Learned and courteous' },
    '廉': { baseStars: 2, charEn: 'Integrity',      phrase: '清正廉明', english: 'Upright and incorruptible' },
    // ═══ 花好月圆 · Love ═══
    '爱': { baseStars: 6, charEn: 'Love',       phrase: '大爱无疆', english: 'Great love knows no bounds' },
    '缘': { baseStars: 5, charEn: 'Fate',       phrase: '缘定三生', english: 'Fated across three lifetimes' },
    '馨': { baseStars: 5, charEn: 'Fragrance',  phrase: '温馨美满', english: 'Warm and blissful' },
    '圆': { baseStars: 4, charEn: 'Wholeness',  phrase: '花好月圆', english: 'Flowers bloom, moon is full' },
    '满': { baseStars: 4, charEn: 'Fullness',   phrase: '圆圆满满', english: 'Perfectly complete in every way' },
    '美': { baseStars: 3, charEn: 'Beauty',     phrase: '十全十美', english: 'Perfection in every way' },
    '合': { baseStars: 3, charEn: 'Unity',      phrase: '百年好合', english: 'A hundred years of harmony' },
    '雅': { baseStars: 2, charEn: 'Elegance',   phrase: '雅量高致', english: 'Elegant and magnanimous spirit' },
    '情': { baseStars: 2, charEn: 'Affection',  phrase: '情深似海', english: 'Love deep as the ocean' },
    '甜': { baseStars: 2, charEn: 'Sweet',      phrase: '甜蜜美满', english: 'Sweet and blissful' },
    // ═══ 吉祥如意 · Auspicious ═══
    '瑞': { baseStars: 6, charEn: 'Auspicious',  phrase: '瑞气盈门', english: 'Auspicious energy fills the door' },
    '吉': { baseStars: 5, charEn: 'Lucky',       phrase: '吉祥如意', english: 'Good fortune as you wish' },
    '祥': { baseStars: 5, charEn: 'Auspicious',  phrase: '龙凤呈祥', english: 'Dragon and phoenix bring fortune' },
    '如': { baseStars: 4, charEn: 'As Wished',   phrase: '称心如意', english: 'Everything goes as desired' },
    '意': { baseStars: 4, charEn: 'Wish',        phrase: '万事如意', english: 'All things as you wish' },
    '祝': { baseStars: 3, charEn: 'Blessing',    phrase: '祝福满满', english: 'Brimming with blessings' },
    '运': { baseStars: 3, charEn: 'Fortune',     phrase: '鸿运当头', english: 'Great fortune on its way' },
    '幸': { baseStars: 2, charEn: 'Lucky',       phrase: '幸福美满', english: 'Happiness and fulfillment' },
    '兆': { baseStars: 2, charEn: 'Omen',        phrase: '吉兆连连', english: 'Auspicious omens abound' },
    '贺': { baseStars: 2, charEn: 'Congratulate', phrase: '恭贺新春', english: 'Celebrating the new spring' },
    // ═══ 神兽庇佑 · Mythical ═══
    '龙': { baseStars: 6, charEn: 'Dragon',     phrase: '龙马精神', english: 'The vigor of dragons and horses' },
    '凤': { baseStars: 5, charEn: 'Phoenix',    phrase: '凤鸣朝阳', english: 'Phoenix singing to the rising sun' },
    '麟': { baseStars: 5, charEn: 'Qilin',      phrase: '凤毛麟角', english: 'Rare as phoenix feathers' },
    '鹤': { baseStars: 4, charEn: 'Crane',      phrase: '鹤寿延年', english: 'Longevity of the crane' },
    '麒': { baseStars: 4, charEn: 'Qilin',      phrase: '麒麟送子', english: 'The qilin brings blessed children' },
    '华': { baseStars: 3, charEn: 'Splendor',   phrase: '荣华富贵', english: 'Prosperity and splendor' },
    '凰': { baseStars: 3, charEn: 'Phoenix',    phrase: '凤凰于飞', english: 'Phoenix in graceful flight' },
    '鹿': { baseStars: 2, charEn: 'Deer',       phrase: '鹿鸣呦呦', english: 'The auspicious deer calls gently' },
    // ═══ 步步高升 · Achievement ═══
    '高': { baseStars: 6, charEn: 'Height',     phrase: '高瞻远瞩', english: 'Far-sighted vision' },
    '成': { baseStars: 5, charEn: 'Success',    phrase: '马到成功', english: 'Success upon arrival' },
    '登': { baseStars: 5, charEn: 'Ascend',     phrase: '五子登科', english: 'All five sons pass the exam' },
    '升': { baseStars: 4, charEn: 'Rise',       phrase: '步步高升', english: 'Rising higher step by step' },
    '兴': { baseStars: 4, charEn: 'Flourish',   phrase: '兴旺发达', english: 'Flourishing and thriving' },
    '进': { baseStars: 3, charEn: 'Advance',    phrase: '招财进宝', english: 'Attracting wealth and treasure' },
    '达': { baseStars: 3, charEn: 'Reach',      phrase: '飞黄腾达', english: 'Soaring to great heights' },
    '辉': { baseStars: 2, charEn: 'Radiance',   phrase: '光辉灿烂', english: 'Radiant and brilliant' },
};

// All unique characters across all categories
export const ALL_CHARS = [...new Set(BLESSING_CATEGORIES.flatMap(c => [...c.chars]))];

// --- Build per-character tier mapping from baseStars ---
// char → category index lookup
const CHAR_TO_CAT = {};
BLESSING_CATEGORIES.forEach((cat, idx) => {
    for (const ch of cat.chars) CHAR_TO_CAT[ch] = idx;
});

// tier index → array of characters at that rarity
const TIER_CHARS = RARITY_TIERS.map(() => []);
for (const [ch, info] of Object.entries(FULL_CHAR_BLESSINGS)) {
    const tierIdx = RARITY_TIERS.findIndex(t => t.stars === info.baseStars);
    if (tierIdx >= 0) TIER_CHARS[tierIdx].push(ch);
}

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

    // 2. Pick a random character assigned to this tier
    const chars = TIER_CHARS[tierIdx];
    const char = chars[Math.floor(Math.random() * chars.length)];

    // 3. Look up category and blessing
    const catIdx = CHAR_TO_CAT[char];
    const category = BLESSING_CATEGORIES[catIdx];
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

    // Only relocate if it's 4★+ (tierIndex <= 3) — no need for commons
    if (arr[bestIdx].tierIndex <= 3) {
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
    const chars = TIER_CHARS[tierIdx];
    const char = chars[Math.floor(Math.random() * chars.length)];
    const catIdx = CHAR_TO_CAT[char];
    const category = BLESSING_CATEGORIES[catIdx];
    const blessing = FULL_CHAR_BLESSINGS[char] || { phrase: char + '运亨通', english: 'Fortune and blessings upon you' };
    return { char, rarity: tier, tierIndex: tierIdx, category, blessing };
}

export function performDrawWithPity(pityCounter) {
    // Guaranteed 6★ at 90 pity (index 1 = 6-star)
    if (pityCounter >= 89) {
        return forceRarity(1);
    }
    // Guaranteed 5★+ at 50 pity
    if (pityCounter >= 49) {
        const roll = Math.random();
        if (roll < 0.5) return forceRarity(1);
        return forceRarity(2);
    }
    return performDraw();
}

export function performMultiDrawWithPity(pityCounter) {
    const draws = [];
    let pity = pityCounter;
    for (let i = 0; i < 10; i++) {
        const draw = performDrawWithPity(pity);
        draws.push(draw);
        if (draw.tierIndex <= 2) {
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
    return BLESSING_CATEGORIES.map(cat => {
        const items = [...cat.chars].map(ch => ({
            char: ch,
            collected: !!coll[ch],
            count: coll[ch]?.count || 0,
            maxStars: coll[ch]?.maxStars || 0,
            blessing: FULL_CHAR_BLESSINGS[ch],
        }));
        // Sort by baseStars descending within each category
        items.sort((a, b) => (b.blessing?.baseStars || 0) - (a.blessing?.baseStars || 0));
        return {
            ...cat,
            items,
            collectedCount: items.filter(it => it.collected).length,
        };
    });
}
