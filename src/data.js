export const MODELS = [
  {
    id: '86',
    name: '86 GT',
    mark: '86',
    maker: 'TOYOTA',
    makerJa: 'トヨタ',
    country: '日本',
    generation: 'ZN6',
    count: 8,
    rarity: 'C',
    multiplier: 1,
  },
  {
    id: 'supra',
    name: 'GR SUPRA',
    mark: 'SUPRA',
    maker: 'TOYOTA',
    makerJa: 'トヨタ',
    country: '日本',
    generation: 'A90',
    count: 8,
    rarity: 'C',
    multiplier: 1,
  },
  {
    id: 'a110',
    name: 'A110',
    mark: 'A110',
    maker: 'ALPINE',
    makerJa: 'アルピーヌ',
    country: 'フランス',
    generation: 'A110',
    count: 8,
    rarity: 'C',
    multiplier: 1,
  },
  {
    id: 'exige',
    name: 'EXIGE',
    mark: 'EXIGE',
    maker: 'LOTUS',
    makerJa: 'ロータス',
    country: 'イギリス',
    generation: 'SERIES 3',
    count: 8,
    rarity: 'C',
    multiplier: 1,
  },
  {
    id: '4c',
    name: '4C',
    mark: '4C',
    maker: 'ALFA ROMEO',
    makerJa: 'アルファロメオ',
    country: 'イタリア',
    generation: '960',
    count: 8,
    rarity: 'C',
    multiplier: 1,
  },
  {
    id: 'm4',
    name: 'M4',
    mark: 'M4',
    maker: 'BMW',
    makerJa: 'BMW',
    country: 'ドイツ',
    generation: 'F82',
    count: 8,
    rarity: 'C',
    multiplier: 1,
  },
  {
    id: 'gtr',
    name: 'GT-R NISMO',
    mark: 'GT-R',
    maker: 'NISSAN',
    makerJa: '日産',
    country: '日本',
    generation: 'R35',
    count: 6,
    rarity: 'R',
    multiplier: 1.5,
  },
  {
    id: 'cayman',
    name: '718 CAYMAN S',
    mark: '718',
    maker: 'PORSCHE',
    makerJa: 'ポルシェ',
    country: 'ドイツ',
    generation: '982',
    count: 6,
    rarity: 'R',
    multiplier: 1.5,
  },
  {
    id: 'gt3',
    name: '911 GT3',
    mark: '911',
    maker: 'PORSCHE',
    makerJa: 'ポルシェ',
    country: 'ドイツ',
    generation: '991',
    count: 6,
    rarity: 'R',
    multiplier: 1.5,
  },
  {
    id: 'nsx',
    name: 'NSX',
    mark: 'NSX',
    maker: 'HONDA',
    makerJa: 'ホンダ',
    country: '日本',
    generation: 'NC1',
    count: 6,
    rarity: 'R',
    multiplier: 1.5,
  },
  {
    id: '488',
    name: '488 GTB',
    mark: '488',
    maker: 'FERRARI',
    makerJa: 'フェラーリ',
    country: 'イタリア',
    generation: 'F142',
    count: 4,
    rarity: 'SR',
    multiplier: 2.5,
  },
  {
    id: 'huracan',
    name: 'HURACÁN',
    mark: 'HURACÁN',
    maker: 'LAMBORGHINI',
    makerJa: 'ランボルギーニ',
    country: 'イタリア',
    generation: 'LP610-4',
    count: 4,
    rarity: 'SR',
    multiplier: 2.5,
  },
];
export const MODEL_BY_ID = Object.fromEntries(MODELS.map((model) => [model.id, model]));
export const COLORS = [
  { id: 'red', name: '赤', hex: '#df4c47' },
  { id: 'blue', name: '青', hex: '#4282cc' },
  { id: 'white', name: '白', hex: '#c9cbd0' },
  { id: 'black', name: '黒', hex: '#424953' },
  { id: 'yellow', name: '黄', hex: '#d8ae35' },
];
export const COLOR_BY_ID = Object.fromEntries(COLORS.map((color) => [color.id, color]));
export const SETTINGS = [
  { id: 'corner', name: 'コーナー重視', short: 'コーナー', symbol: 'C' },
  { id: 'acceleration', name: '加速重視', short: '加速', symbol: 'A' },
  { id: 'stability', name: '安定重視', short: '安定', symbol: 'S' },
];
export const SETTING_BY_ID = Object.fromEntries(SETTINGS.map((setting) => [setting.id, setting]));
export const COLOR_POINTS = [0, 0, 0, 0, 30, 60, 100, 150];
export const MAKER_POINTS = [0, 0, 0, 0, 15, 30, 50, 75];
export const SUPPORTS = [
  {
    id: 'oil',
    name: 'トヨタ純正オイル',
    label: 'ENGINE OIL',
    mark: 'OIL',
    condition: 'トヨタ車2枚から育つ',
    description: 'トヨタ車2 / 3 / 4 / 5 / 6枚で＋40 / 60 / 85 / 110 / 135点。86とスープラを混ぜてもOK。',
    max: 135,
    levels: [
      { count: 2, points: 40 },
      { count: 3, points: 60 },
      { count: 4, points: 85 },
      { count: 5, points: 110 },
      { count: 6, points: 135 },
    ],
  },
  {
    id: 'flag',
    name: '国旗デカール',
    label: 'FLAG DECAL',
    mark: 'FLAG',
    condition: '同じ国の車3枚から育つ',
    description:
      '同じ国の車3 / 4 / 5 / 6枚で＋30 / 50 / 75 / 100点。日本・ドイツ・イタリア・フランス・イギリスの5か国。',
    max: 100,
    levels: [
      { count: 3, points: 30 },
      { count: 4, points: 50 },
      { count: 5, points: 75 },
      { count: 6, points: 100 },
    ],
  },
  {
    id: 'tires',
    name: 'ハイグリップタイヤ',
    label: 'GRIP TIRES',
    mark: 'GRIP',
    condition: '同じ設定の異なる車種',
    description:
      '同じセッティングの異なる2 / 3 / 4 / 5 / 6車種で＋20 / 60 / 120 / 190 / 270点。同車種は1種類と数えます。',
    max: 270,
    levels: [
      { count: 2, points: 20 },
      { count: 3, points: 60 },
      { count: 4, points: 120 },
      { count: 5, points: 190 },
      { count: 6, points: 270 },
    ],
  },
  {
    id: 'ecu',
    name: 'スポーツECU',
    label: 'SPORTS ECU',
    mark: 'ECU',
    condition: '異なる車種のペアを作る',
    description: '2枚以上ある車種が1 / 2 / 3種類で＋40 / 100 / 180点。同車種4枚は1組として数えます。',
    max: 180,
    levels: [
      { count: 1, points: 40 },
      { count: 2, points: 100 },
      { count: 3, points: 180 },
    ],
  },
];
export const SUPPORT_BY_ID = Object.fromEntries(SUPPORTS.map((support) => [support.id, support]));
// Role bonuses: only the highest role that is met scores, like attributes and supports.
// Listed from the highest points down, so the first role met is the one that scores.
export const ROLES = [
  {
    id: 'fullpaint',
    name: 'フルペイント',
    condition: '車7枚がすべて同じ色',
    description: '車7枚をすべて同じ色でそろえると＋100点。色の属性点とは別に加点します。サポートは持てません。',
    points: 100,
  },
  {
    id: 'supercar',
    name: 'スーパーカー・ガレージ',
    condition: '488 GTBとHURACÁNを2枚ずつ以上',
    description: 'SRの488 GTBとHURACÁNを、それぞれ2枚以上そろえると＋80点。車種点とは別に加点します。',
    points: 80,
    models: ['488', 'huracan'],
  },
  {
    id: 'worldtour',
    name: 'ワールドツアー',
    condition: '5か国すべて＋ペア1組以上',
    description:
      '日本・ドイツ・イタリア・フランス・イギリスの車を1枚以上ずつ入れ、同じ車種のペアを1組以上作ると＋60点。',
    points: 60,
  },
  {
    id: 'showroom',
    name: 'ショールーム',
    condition: '同じ車種5枚以上が5色すべて違う',
    description:
      '同じ車種を5枚以上そろえ、その車種で赤・青・白・黒・黄の5色がすべてあれば＋50点。4色しかないSR（488 GTB・HURACÁN）では成立しません。',
    points: 50,
  },
  {
    id: 'rainbow',
    name: 'レインボー',
    condition: '車7枚で5色すべて・5車種以上',
    description: '車7枚に赤・青・白・黒・黄の5色がすべてあり、車種が5種類以上なら＋40点。サポートは持てません。',
    points: 40,
  },
];
export const ROLE_BY_ID = Object.fromEntries(ROLES.map((role) => [role.id, role]));
export const COUNTRIES = ['日本', 'ドイツ', 'イタリア', 'フランス', 'イギリス'];
export const PLAYER_PROFILES = [
  { name: 'YOU', title: 'あなたのガレージ', style: 'steady', symbol: '01' },
  { name: 'REN', title: '堅実なコレクター', style: 'steady', symbol: '02' },
  { name: 'KAI', title: '大きな役を狙う', style: 'bold', symbol: '03' },
  { name: 'AOI', title: '柔軟なチューナー', style: 'flexible', symbol: '04' },
];
export const TOTAL_TURNS = 60;
export const TURNS_PER_PLAYER = 15;
export const STORAGE_VERSION = 2;
// Rookie mode: a 5-card hand, cars only, 8 laps, no burns, blocks or Final Lap.
export const RULESETS = {
  standard: {
    id: 'standard',
    name: 'スタンダード',
    handSize: 7,
    supports: true,
    turnsPerPlayer: TURNS_PER_PLAYER,
    pickupBurn: true,
    blocks: true,
    finalLap: true,
  },
  rookie: {
    id: 'rookie',
    name: 'ルーキー',
    handSize: 5,
    supports: false,
    turnsPerPlayer: 8,
    pickupBurn: false,
    blocks: false,
    finalLap: false,
  },
};
// Rookie scoring: car sets as in standard, plus one color bonus.
// Rainbow needs five different cars too: a single model's copies rotate through the colors.
export const ROOKIE_BONUSES = { color4: 30, fullpaint: 100, rainbow: 50 };
// Saves made before modes existed are standard matches.
export const rulesetOf = (state) => RULESETS[state?.options?.mode] || RULESETS.standard;

export function createCardPool(mode = 'standard') {
  let colorIndex = 0;
  const cards = MODELS.flatMap((model, modelIndex) =>
    Array.from({ length: model.count }, (_, copy) => {
      const settingOffset = modelIndex >= 10 ? modelIndex - 10 : modelIndex;
      return {
        id: model.id + '-' + copy,
        type: 'vehicle',
        modelId: model.id,
        colorId: COLORS[colorIndex++ % COLORS.length].id,
        settingId: SETTINGS[(copy + settingOffset) % SETTINGS.length].id,
      };
    }),
  );
  if (!RULESETS[mode].supports) return cards;
  for (const support of SUPPORTS) {
    for (let copy = 0; copy < 2; copy++)
      cards.push({ id: support.id + '-' + copy, type: 'support', supportId: support.id });
  }
  return cards;
}

// Grand Prix: before the final round the WORLD CAR DEALER sends the last-placed
// driver a dealer order — not part of the deck, never discarded, and scored as
// whichever car suits the hand best. It never counts toward 86 MASTER.
export const DEALER_ORDER = {
  name: 'ディーラーオーダー',
  dealer: 'ワールドカーディーラー',
  description:
    'どの車にもなる1枚。決着時に、手札が最も高くなる車種・色・セッティングの車として数えます（納車）。捨てられず、86 MASTERには使えません。',
};

export function cardName(card) {
  if (card.type === 'order') return DEALER_ORDER.name;
  return card.type === 'vehicle' ? MODEL_BY_ID[card.modelId].name : SUPPORT_BY_ID[card.supportId].name;
}

export function cardSignature(card) {
  if (card.type === 'order') return 'order';
  return card.type === 'vehicle' ? [card.modelId, card.colorId, card.settingId].join(':') : 'support:' + card.supportId;
}

export function seedNumber(value) {
  let number = 2166136261;
  for (const char of String(value)) {
    number ^= char.charCodeAt(0);
    number = Math.imul(number, 16777619);
  }
  return number >>> 0;
}

export function seededRandom(seed) {
  let state = seedNumber(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
