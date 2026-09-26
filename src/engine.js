import {
  MODEL_BY_ID,
  MODELS,
  COLOR_BY_ID,
  COLORS,
  COUNTRIES,
  ROLES,
  ROLE_BY_ID,
  SETTINGS,
  SUPPORT_BY_ID,
  PLAYER_PROFILES,
  STORAGE_VERSION,
  TOTAL_TURNS,
  TURNS_PER_PLAYER,
  RULESETS,
  ROOKIE_BONUSES,
  rulesetOf,
  createCardPool,
  cardName,
  cardSignature,
  seededRandom,
  DEALER_ORDER,
} from './data.js';
import { COLOR_POINTS, MAKER_POINTS } from './data.js';

export const countBy = (cards, key) =>
  cards.reduce((counts, card) => {
    const value = key(card);
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});

// A full hand of 86 GTs: 7 cards in standard, 5 in rookie.
export const isMasterHand = (hand, size = 7) =>
  hand.length === size &&
  new Set(hand.map((card) => card.id)).size === size &&
  hand.every((card) => card.type === 'vehicle' && card.modelId === '86');

function finishMaster(state, playerId, source) {
  const player = state.players[playerId];
  state.masterVictory = { playerId, turn: state.turnNumber, source };
  state.phase = 'finished';
  state.currentPlayer = playerId;
  state.history.push({
    type: '86-master',
    actor: playerId,
    turn: state.turnNumber,
    cards: structuredClone(player.hand),
    text: `${player.name}が86 MASTER完成！86 GTを${rulesetOf(state).handSize}枚揃え、特殊勝利で即フィニッシュ。`,
  });
  return state;
}

function settleInitialDeal(state) {
  const master = state.players.find((player) => isMasterHand(player.hand, rulesetOf(state).handSize));
  return master ? finishMaster(state, master.id, 'deal') : state;
}

const modelGroups = (models) =>
  Object.entries(models)
    .filter(([, count]) => count >= 2)
    .map(([modelId, count]) => ({
      modelId,
      name: MODEL_BY_ID[modelId].name,
      count,
      points: 10 * count * (count - 1) * MODEL_BY_ID[modelId].multiplier,
    }))
    .sort((a, b) => b.points - a.points);

// Rookie: the same car sets, and one color bonus — four of a color, all five
// alike (Full Paint) or all five different (Rainbow). No makers, supports or countries.
function scoreRookieHand(hand) {
  const vehicles = hand.filter((card) => card.type === 'vehicle');
  const models = countBy(vehicles, (card) => card.modelId);
  const colors = countBy(vehicles, (card) => card.colorId);
  const groups = modelGroups(models);
  const [bestColor, bestCount] = Object.entries(colors).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    [null, 0],
  );
  const colorName = bestColor ? COLOR_BY_ID[bestColor].name : '';
  const fiveCars = vehicles.length === 5;
  const modelKinds = Object.keys(models).length;
  const role =
    fiveCars && bestCount === 5
      ? { id: 'fullpaint', name: 'フルペイント', points: ROOKIE_BONUSES.fullpaint }
      : fiveCars && Object.keys(colors).length === 5 && modelKinds === 5
        ? { id: 'rainbow', name: 'レインボー', points: ROOKIE_BONUSES.rainbow }
        : null;
  const attribute =
    !role && bestCount === 4
      ? { type: 'color', id: bestColor, count: 4, label: `${colorName}の車 4枚`, points: ROOKIE_BONUSES.color4 }
      : null;
  const missingColors = COLORS.filter((color) => !colors[color.id]).map((color) => color.id);
  const roleGoals = [
    ...(bestCount === 4 && !role
      ? [{ id: 'fullpaint', name: 'フルペイント', points: ROOKIE_BONUSES.fullpaint, needed: 1, colors: [bestColor] }]
      : []),
    ...(Math.max(5 - Object.keys(colors).length, 5 - modelKinds) === 1 && !role
      ? [{ id: 'rainbow', name: 'レインボー', points: ROOKIE_BONUSES.rainbow, needed: 1, colors: missingColors }]
      : []),
  ];
  const attributeGoals =
    bestCount === 3
      ? [
          {
            type: 'color',
            id: bestColor,
            count: 3,
            target: 4,
            needed: 1,
            points: ROOKIE_BONUSES.color4,
            label: `${colorName}の車`,
          },
        ]
      : [];
  const vehiclePoints = groups.reduce((sum, group) => sum + group.points, 0);
  return {
    total: vehiclePoints + (attribute?.points || 0) + (role?.points || 0),
    specialWin: isMasterHand(hand, 5) ? '86-master' : null,
    vehiclePoints,
    attributePoints: attribute?.points || 0,
    rolePoints: role?.points || 0,
    role,
    roleGoals,
    supportPoints: 0,
    groups,
    attribute,
    attributes: attribute ? [attribute] : [],
    attributeGoals,
    support: null,
    supports: [],
    settingGroups: [],
    modelCounts: models,
    makerCounts: countBy(vehicles, (card) => MODEL_BY_ID[card.modelId].maker),
  };
}

export function scoreHand(hand, mode = 'standard') {
  if (mode === 'rookie') return scoreRookieHand(hand);
  return hand.some((card) => card.type === 'order') ? scoreWithOrder(hand) : scoreStandardHand(hand);
}

export const dealerOrderCard = (playerId) => ({ id: 'order-' + playerId, type: 'order' });

// The dealer order becomes the car that scores the hand highest ("delivered"),
// among the model and colour pairs the deck really has (no blue 488 or red
// Huracán). Settings only matter to the tyre support, so other hands try one.
// The CPU scores the same hands over and over, so recent results are kept.
const orderScores = new Map();
function scoreWithOrder(hand) {
  const key = hand.map((card) => card.id).join(',');
  if (orderScores.has(key)) return orderScores.get(key);
  const order = hand.find((card) => card.type === 'order');
  const rest = hand.filter((card) => card !== order);
  const settings = rest.some((card) => card.supportId === 'tires') ? SETTINGS : SETTINGS.slice(0, 1);
  let best = null;
  for (const [modelId, colorId] of ORDER_CARS)
    for (const setting of settings) {
      const car = { id: order.id, type: 'vehicle', modelId, colorId, settingId: setting.id };
      const score = scoreStandardHand([...rest, car]);
      if (!best || score.total > best.total) best = { ...score, delivered: car };
    }
  // 86 MASTER needs seven real 86 GTs.
  best.specialWin = null;
  if (orderScores.size > 4000) orderScores.clear();
  orderScores.set(key, best);
  return best;
}

function scoreStandardHand(hand) {
  const vehicles = hand.filter((card) => card.type === 'vehicle');
  const models = countBy(vehicles, (card) => card.modelId);
  const colors = countBy(vehicles, (card) => card.colorId);
  const makers = countBy(vehicles, (card) => MODEL_BY_ID[card.modelId].maker);
  const countries = countBy(vehicles, (card) => MODEL_BY_ID[card.modelId].country);
  const groups = modelGroups(models);
  const attributes = [];
  for (const [colorId, count] of Object.entries(colors)) {
    if (count >= 4)
      attributes.push({
        type: 'color',
        id: colorId,
        count,
        label: COLOR_BY_ID[colorId].name + 'の車 ' + count + '枚',
        points: COLOR_POINTS[count] || 0,
      });
  }
  for (const [maker, count] of Object.entries(makers)) {
    if (count >= 4)
      attributes.push({
        type: 'maker',
        id: maker,
        count,
        label: maker + ' ' + count + '枚',
        points: MAKER_POINTS[count] || 0,
      });
  }
  attributes.sort((a, b) => b.points - a.points || a.label.localeCompare(b.label));
  const settingGroups = SETTINGS.map((setting) => ({
    ...setting,
    models: [...new Set(vehicles.filter((card) => card.settingId === setting.id).map((card) => card.modelId))],
  }));
  const supports = hand
    .filter((card) => card.type === 'support')
    .map((card) => {
      const data = SUPPORT_BY_ID[card.supportId];
      let count = 0,
        unit = '',
        targetIds = [],
        detail = '',
        country = null;
      if (card.supportId === 'oil') {
        count = makers.TOYOTA || 0;
        unit = 'トヨタ車';
        detail = unit + ' ' + count + '枚';
        targetIds = vehicles.filter((c) => MODEL_BY_ID[c.modelId].maker === 'TOYOTA').map((c) => c.id);
      } else if (card.supportId === 'flag') {
        // The country with the most cars counts; ties keep the first country in card order.
        [country, count] = Object.entries(countries).reduce(
          (best, entry) => (entry[1] > best[1] ? entry : best),
          [null, 0],
        );
        unit = (country || '同じ国') + 'の車';
        detail = unit + ' ' + count + '枚';
        targetIds = vehicles.filter((c) => MODEL_BY_ID[c.modelId].country === country).map((c) => c.id);
      } else if (card.supportId === 'tires') {
        const group = settingGroups.slice().sort((a, b) => b.models.length - a.models.length)[0];
        count = group.models.length;
        unit = group.name + 'の異なる車種';
        detail = group.name + ' ' + count + '車種';
        targetIds = vehicles.filter((c) => c.settingId === group.id).map((c) => c.id);
      } else if (card.supportId === 'ecu') {
        count = groups.length;
        unit = '異なる車種のペア';
        detail = count + '種類のペア';
        targetIds = vehicles.filter((c) => models[c.modelId] >= 2).map((c) => c.id);
      }
      const level = data.levels.filter((level) => count >= level.count).at(-1);
      const nextLevel = data.levels.find((level) => level.count > count);
      const next = nextLevel ? { ...nextLevel, needed: nextLevel.count - count, unit } : null;
      const missing = next
        ? unit +
          ' あと' +
          next.needed +
          (card.supportId === 'ecu' ? '組' : card.supportId === 'tires' ? '車種' : '枚') +
          'で＋' +
          next.points +
          '点'
        : '最大ボーナス達成';
      return {
        cardId: card.id,
        supportId: card.supportId,
        name: data.name,
        points: level?.points || 0,
        readiness: Math.min(1, count / data.levels[0].count),
        count,
        detail,
        next,
        missing,
        targetIds,
        country,
      };
    })
    .sort((a, b) => b.points - a.points || a.cardId.localeCompare(b.cardId));
  const vehiclePoints = groups.reduce((sum, group) => sum + group.points, 0);
  const attribute = attributes[0] || null;
  const attributeGoals = [];
  const maxCars = hand.some((card) => card.type === 'support') ? 6 : 7;
  for (const [type, counts, points] of [
    ['color', colors, COLOR_POINTS],
    ['maker', makers, MAKER_POINTS],
  ]) {
    for (const [id, count] of Object.entries(counts)) {
      const target = Math.max(4, count + 1);
      if (count >= 2 && target <= maxCars && points[target] > (attribute?.points || 0))
        attributeGoals.push({
          type,
          id,
          count,
          target,
          needed: target - count,
          points: points[target],
          label: type === 'color' ? COLOR_BY_ID[id].name + 'の車' : id,
        });
    }
  }
  attributeGoals.sort((a, b) => a.needed - b.needed || b.points - a.points);
  const support = supports.find((candidate) => candidate.points > 0) || null;
  const { role, roleGoals } = scoreRoles(vehicles, colors, countries, groups.length);
  return {
    total: vehiclePoints + (attribute?.points || 0) + (support?.points || 0) + (role?.points || 0),
    specialWin: isMasterHand(hand) ? '86-master' : null,
    vehiclePoints,
    attributePoints: attribute?.points || 0,
    rolePoints: role?.points || 0,
    role,
    roleGoals,
    supportPoints: support?.points || 0,
    groups,
    attribute,
    attributes,
    attributeGoals,
    support,
    supports,
    settingGroups,
    modelCounts: models,
    makerCounts: makers,
  };
}

// Colours each model comes in (SR models have four), and the cars a dealer order can become.
const MODEL_COLORS = createCardPool().reduce((map, card) => {
  if (card.type === 'vehicle') (map[card.modelId] ??= new Set()).add(card.colorId);
  return map;
}, {});
const ORDER_CARS = MODELS.flatMap((model) =>
  COLORS.filter((color) => MODEL_COLORS[model.id].has(color.id)).map((color) => [model.id, color.id]),
);

// Showroom: one model in all five colours. The target is the model closest to it.
function showroomState(vehicles) {
  const byModel = {};
  for (const card of vehicles) (byModel[card.modelId] ??= new Set()).add(card.colorId);
  let best = null;
  for (const model of MODELS) {
    const have = byModel[model.id];
    if (!have || MODEL_COLORS[model.id].size < COLORS.length) continue;
    if (!best || have.size > best.have.size) best = { model: model.id, have };
  }
  return best
    ? {
        needed: COLORS.length - best.have.size,
        model: best.model,
        colors: COLORS.filter((color) => !best.have.has(color.id)).map((color) => color.id),
      }
    : { needed: COLORS.length, model: null, colors: [] };
}

// The best role met, and the roles within two cars, with the colors, countries or cars still missing.
// `roles` lets old saves be scored without the roles added after them.
function scoreRoles(vehicles, colors, countries, pairs, roles = ROLES) {
  const modelCounts = countBy(vehicles, (card) => card.modelId);
  const models = Object.keys(modelCounts).length;
  const supercars = ROLE_BY_ID.supercar.models
    .map((id) => ({ id, needed: Math.max(0, 2 - (modelCounts[id] || 0)) }))
    .filter((model) => model.needed);
  const [bestColor, bestColorCount] = Object.entries(colors).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    [null, 0],
  );
  const missingColors = COLORS.filter((color) => !colors[color.id]).map((color) => color.id);
  const missingCountries = COUNTRIES.filter((country) => !countries[country]);
  const state = {
    // Cars short of the goal; a 7-card hand trades a support or an off-goal car for each.
    fullpaint: { needed: 7 - bestColorCount, colors: bestColor ? [bestColor] : [] },
    worldtour: { needed: missingCountries.length + Number(!pairs), countries: missingCountries },
    rainbow: {
      needed: Math.max(missingColors.length, 5 - models, 7 - vehicles.length),
      colors: missingColors,
    },
    supercar: { needed: supercars.reduce((sum, model) => sum + model.needed, 0), models: supercars },
    showroom: showroomState(vehicles),
  };
  const met = roles.filter((role) => state[role.id].needed === 0);
  const role = met.length ? { id: met[0].id, name: met[0].name, points: met[0].points } : null;
  const roleGoals = roles
    .filter(
      (goal) =>
        state[goal.id].needed > 0 &&
        state[goal.id].needed <= 2 &&
        goal.points > (role?.points || 0) &&
        (goal.id !== 'fullpaint' || bestColorCount >= 5),
    )
    .map((goal) => ({ id: goal.id, name: goal.name, points: goal.points, ...state[goal.id] }));
  return { role, roleGoals };
}

export function createGame(seed = String(Date.now()), options = {}) {
  const mode = options.mode === 'rookie' ? 'rookie' : 'standard';
  const rules = RULESETS[mode];
  const blocks = rules.blocks && options.blocks !== false;
  const finalLap = rules.finalLap && options.finalLap !== false;
  const random = seededRandom(seed);
  const deck = createCardPool(mode);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const starter = options.starter ?? Math.floor(random() * 4);
  const players = PLAYER_PROFILES.map((profile, id) => ({
    ...profile,
    id,
    hand: [],
    turnsTaken: 0,
    blockAvailable: blocks,
  }));
  for (let round = 0; round < rules.handSize; round++)
    for (let offset = 0; offset < 4; offset++) players[(starter + offset) % 4].hand.push(deck.pop());
  // A dealer order takes the place of the last card dealt, which goes under the stock.
  const dealerOrder = mode === 'standard' ? validDealerOrder(options.dealerOrder) : [];
  for (const id of dealerOrder) {
    deck.unshift(players[id].hand.pop());
    players[id].hand.push(dealerOrderCard(id));
  }
  const state = {
    version: STORAGE_VERSION,
    scoringVersion: SCORING_VERSION,
    seed: String(seed),
    options: {
      blocks,
      finalLap,
      ...(mode === 'rookie' ? { mode } : {}),
      ...(dealerOrder.length ? { dealerOrder } : {}),
      ...(options.grandPrix ? { grandPrix: { id: String(options.grandPrix.id), round: options.grandPrix.round } } : {}),
    },
    starter,
    deck,
    players,
    currentPlayer: starter,
    phase: 'draw',
    turnNumber: 0,
    pickup: null,
    archive: [],
    removed: [],
    acquired: null,
    finalLap: null,
    masterVictory: null,
    history: [
      {
        type: 'start',
        actor: starter,
        turn: 0,
        text:
          players[starter].name +
          (!finalLap
            ? `からスタート。全員${rules.turnsPerPlayer}手番です。`
            : 'からスタート。最大15手番、ファイナルラップで早期決着もできます。'),
      },
      ...dealerOrder.map((id) => ({
        type: 'dealer-order',
        actor: id,
        turn: 0,
        text: `${DEALER_ORDER.dealer}から${players[id].name}へ${DEALER_ORDER.name}。どの車にもなる1枚です。`,
      })),
    ],
  };
  return settleInitialDeal(state);
}

// Seats that receive a dealer order: distinct seat numbers, in seat order.
function validDealerOrder(seats) {
  if (seats == null) return [];
  requireRule(
    Array.isArray(seats) &&
      seats.length < 4 &&
      seats.every((id) => Number.isInteger(id) && id >= 0 && id < 4) &&
      new Set(seats).size === seats.length,
    'ディーラーオーダーの指定が不正です。',
  );
  return [...seats].sort((a, b) => a - b);
}

function requireRule(condition, message) {
  if (!condition) throw new Error(message);
}
function log(state, event) {
  state.history.push({ ...event, turn: state.turnNumber, actor: state.currentPlayer });
}

// The target falls each lap: an early declaration needs a stronger hand. The
// other three then take two rounds of final turns, two cards per turn.
export const FINAL_LAP_RULES = Object.freeze({
  minimumLap: 8,
  startScore: 300,
  scoreStep: 25,
  rounds: 2,
  minimumDeck: 12,
});
// A lap includes all four seats; LAP 08 through LAP 15 are the last eight laps.
export const currentLap = (state) =>
  Math.min(TURNS_PER_PLAYER, Math.floor(Math.max(0, state.turnNumber - Number(state.phase === 'finished')) / 4) + 1);
export const finalLapTarget = (lap) =>
  lap < FINAL_LAP_RULES.minimumLap
    ? null
    : FINAL_LAP_RULES.startScore - FINAL_LAP_RULES.scoreStep * (lap - FINAL_LAP_RULES.minimumLap);
// Saves declared before the falling target used one round and a fixed 120 points.
const finalRounds = (final) => final.rounds ?? 1;
export const finalLapOrder = (declarer, rounds = FINAL_LAP_RULES.rounds) =>
  Array.from({ length: rounds }, () => [1, 2, 3].map((offset) => (declarer + offset) % 4)).flat();
export const acquisitionCount = (state) => (state.finalLap ? 2 : 1);
export const discardCount = (state) => (state.phase === 'discard' ? acquisitionCount(state) : 0);
export const acquiredIds = (state) => state.acquired?.cardIds || (state.acquired ? [state.acquired.cardId] : []);

export function finalLapEligibility(state, cardId) {
  if (state.options.finalLap === false) return { eligible: false, reason: 'ファイナルラップなしの対戦です' };
  if (state.finalLap) return { eligible: false, reason: 'ファイナルラップ進行中' };
  if (state.phase !== 'discard') return { eligible: false, reason: 'カードを取得し、捨てる札を選ぶと宣言できます' };
  const player = state.players[state.currentPlayer];
  if (currentLap(state) < FINAL_LAP_RULES.minimumLap)
    return { eligible: false, reason: '残り8 LAP（LAP 08）から宣言できます' };
  if (state.deck.length < FINAL_LAP_RULES.minimumDeck)
    return { eligible: false, reason: `宣言には山札が残り${FINAL_LAP_RULES.minimumDeck}枚以上必要です` };
  if (!legalDiscards(state).some((card) => card.id === cardId))
    return { eligible: false, reason: '捨てる札を1枚選んでください' };
  const score = scoreHand(player.hand.filter((card) => card.id !== cardId)).total;
  const target = finalLapTarget(currentLap(state));
  return {
    eligible: score >= target,
    score,
    target,
    reason: score >= target ? '宣言すると手札を公開・固定します' : `このLAPは捨てた後の7枚で${target}点以上が必要です`,
  };
}

export function acquireCard(previous, source) {
  requireRule(previous.phase === 'draw', 'カードを取得できる手番ではありません。');
  const count = acquisitionCount(previous);
  requireRule(previous.deck.length >= count, '山札が足りません。');
  requireRule(source === 'deck' || source === 'pickup', '取得元を選んでください。');
  requireRule(source !== 'pickup' || previous.pickup, '拾える捨て札がありません。');
  const state = structuredClone(previous);
  const player = state.players[state.currentPlayer];
  let card;
  if (source === 'pickup') {
    card = state.pickup.card;
    state.pickup = null;
    log(state, { type: 'pickup', card, text: player.name + 'が ' + cardName(card) + ' を拾いました。' });
    // Standard burns a stock card so every turn uses one; rookie keeps pickups simple.
    if (rulesetOf(state).pickupBurn) {
      const removed = state.deck.pop();
      state.removed.push({ card: removed, by: player.id, reason: 'pickup', turn: state.turnNumber });
      log(state, { type: 'burn', card: removed, text: cardName(removed) + ' を山札から公開除外。' });
    }
  } else card = state.deck.pop();
  const cards = [card];
  if (count === 2) cards.push(state.deck.pop());
  const drawn = count - Number(source === 'pickup');
  if (drawn) log(state, { type: 'draw', text: player.name + 'が山札から' + drawn + '枚引きました。' });
  player.hand.push(...cards);
  state.acquired = { cardId: card.id, cardIds: cards.map((item) => item.id), source };
  state.phase = 'discard';
  return state;
}

export function legalDiscards(state) {
  if (state.phase !== 'discard') return [];
  return state.players[state.currentPlayer].hand.filter(
    (card) => card.type !== 'order' && !(state.acquired.source === 'pickup' && card.id === state.acquired.cardId),
  );
}

export function canUseBlock(state) {
  return (
    state.phase === 'discard' &&
    state.deck.length > 0 &&
    (!state.finalLap || state.finalLap.remaining.length > 1) &&
    state.players[state.currentPlayer].blockAvailable
  );
}

// The offered card alone becomes pickable; other final-turn discards enter the archive.
export function discardCard(previous, cardId, useBlock = false, options = {}) {
  requireRule(previous.phase === 'discard', '先にカードを取得してください。');
  const ids = Array.isArray(cardId) ? cardId : [cardId];
  const legal = new Set(legalDiscards(previous).map((card) => card.id));
  requireRule(
    ids.length === discardCount(previous) && new Set(ids).size === ids.length,
    '捨てるカードを' + discardCount(previous) + '枚選んでください。',
  );
  const hand = previous.players[previous.currentPlayer].hand;
  requireRule(
    !ids.some((id) => hand.find((card) => card.id === id)?.type === 'order'),
    `${DEALER_ORDER.name}は捨てられません。`,
  );
  requireRule(
    ids.every((id) => legal.has(id)),
    '拾ったカードは、この手番では捨てられません。',
  );
  requireRule(!useBlock || canUseBlock(previous), '今はブロックラインを使えません。');
  const offerId = options.offerId || ids.at(-1);
  requireRule(ids.includes(offerId), '次の人へ渡す札は、選んだ捨て札から指定してください。');
  const completesMaster = isMasterHand(
    previous.players[previous.currentPlayer].hand.filter((card) => !ids.includes(card.id)),
    rulesetOf(previous).handSize,
  );
  if (options.declareFinalLap && !completesMaster) {
    const eligibility = finalLapEligibility(previous, ids[0]);
    requireRule(eligibility.eligible, eligibility.reason);
  }
  const state = structuredClone(previous);
  const player = state.players[state.currentPlayer];
  const discarded = ids.map((id) => player.hand.find((card) => card.id === id));
  player.hand = player.hand.filter((card) => !ids.includes(card.id));
  if (state.pickup) state.archive.push(state.pickup);
  state.pickup = null;
  for (const card of discarded.filter((card) => card.id !== offerId)) {
    state.archive.push({ card, by: player.id, turn: state.turnNumber, reason: 'final-lap' });
    log(state, {
      type: 'archive',
      card,
      text: player.name + 'が ' + cardName(card) + ' を公開捨て札へ。次の人は拾えません。',
    });
  }
  const card = discarded.find((card) => card.id === offerId);
  if (useBlock) {
    player.blockAvailable = false;
    state.removed.push({ card, by: player.id, reason: 'block', turn: state.turnNumber });
    log(state, { type: 'block', card, text: player.name + 'がブロックライン。' + cardName(card) + ' は拾えません。' });
  } else {
    state.pickup = { card, by: player.id, turn: state.turnNumber };
    log(state, { type: 'discard', card, text: player.name + 'が ' + cardName(card) + ' を捨てました。' });
  }
  player.turnsTaken++;
  state.turnNumber++;
  state.acquired = null;
  // Record the responder's completed turn before ending, so stock consumption
  // and the unplayed final-lap seats remain recoverable in the saved state.
  if (state.finalLap) {
    state.finalLap.remaining.shift();
    state.finalLap.completed.push(player.id);
  }
  if (completesMaster) return finishMaster(state, player.id, 'discard');
  if (options.declareFinalLap) {
    state.finalLap = {
      declarer: player.id,
      score: scoreHand(player.hand).total,
      hand: structuredClone(player.hand),
      declaredTurn: state.turnNumber,
      minimumLap: FINAL_LAP_RULES.minimumLap,
      targetScore: finalLapTarget(currentLap(previous)),
      rounds: FINAL_LAP_RULES.rounds,
      remaining: finalLapOrder(player.id),
      completed: [],
    };
    state.history.push({
      type: 'final-lap',
      actor: player.id,
      turn: state.turnNumber - 1,
      cards: structuredClone(player.hand),
      text:
        player.name +
        'がファイナルラップ宣言！' +
        state.finalLap.score +
        '点で手札を公開・固定。ほかの3人は2周、各手番で2枚取得できます。',
    });
  }
  const lastTurn = state.turnNumber >= 4 * rulesetOf(state).turnsPerPlayer || !state.deck.length;
  if (state.finalLap ? !state.finalLap.remaining.length : lastTurn) state.phase = 'finished';
  else {
    state.phase = 'draw';
    state.currentPlayer = state.finalLap ? state.finalLap.remaining[0] : (state.currentPlayer + 1) % 4;
  }
  return state;
}

export function publicKnownCards(state) {
  const known = state.players.map(() => new Map());
  for (const event of state.history) {
    if (!event.card) continue;
    const signature = cardSignature(event.card);
    const bucket = known[event.actor];
    if (event.type === 'pickup') {
      const old = bucket.get(signature);
      bucket.set(signature, { card: event.card, count: (old?.count || 0) + 1 });
    } else if (event.type === 'discard' || event.type === 'block' || event.type === 'archive') {
      const old = bucket.get(signature);
      if (old?.count === 1) bucket.delete(signature);
      else if (old) bucket.set(signature, { ...old, count: old.count - 1 });
    }
  }
  if (state.finalLap) {
    const bucket = known[state.finalLap.declarer];
    bucket.clear();
    for (const card of state.finalLap.hand) {
      const key = cardSignature(card);
      bucket.set(key, { card, count: (bucket.get(key)?.count || 0) + 1 });
    }
  }
  return known.map((map) => [...map.values()]);
}

// The AI boundary intentionally excludes opponents' hands and the actual draw pile.
export function getObservation(state, playerId = state.currentPlayer) {
  const player = state.players[playerId];
  const known = publicKnownCards(state);
  const unavailableIds = new Set(
    [
      ...player.hand,
      ...state.archive.map((entry) => entry.card),
      ...state.removed.map((entry) => entry.card),
      ...(state.pickup ? [state.pickup.card] : []),
    ].map((card) => card.id),
  );
  const rules = rulesetOf(state);
  let unseen = createCardPool(rules.id).filter((card) => !unavailableIds.has(card.id));
  for (let id = 0; id < 4; id++) {
    if (id === playerId) continue;
    for (const entry of known[id]) {
      for (let copy = 0; copy < entry.count; copy++) {
        const index = unseen.findIndex((card) => cardSignature(card) === cardSignature(entry.card));
        if (index >= 0) unseen.splice(index, 1);
      }
    }
  }
  return structuredClone({
    playerId,
    style: player.style,
    hand: player.hand,
    pickup: state.pickup,
    deckCount: state.deck.length,
    turnsRemaining: state.finalLap
      ? state.finalLap.remaining.filter((id) => id === playerId).length
      : rules.turnsPerPlayer - player.turnsTaken,
    mode: rules.id,
    handSize: rules.handSize,
    turnsTaken: player.turnsTaken,
    finalLapEnabled: state.options.finalLap !== false,
    finalLap: state.finalLap || null,
    turnNumber: state.turnNumber,
    blockAvailable: player.blockAvailable,
    acquired: state.acquired,
    known,
    unseen,
    decisionSeed: state.seed + ':' + state.turnNumber + ':' + playerId,
  });
}

export function standings(state) {
  const rows = state.players
    .map((player) => ({
      player,
      score: scoreHand(player.hand, rulesetOf(state).id),
      masterWinner: state.masterVictory?.playerId === player.id,
    }))
    .sort((a, b) => Number(b.masterWinner) - Number(a.masterWinner) || b.score.total - a.score.total);
  let rank = 1;
  return rows.map((row, index) => {
    if (index && (row.masterWinner !== rows[index - 1].masterWinner || row.score.total < rows[index - 1].score.total))
      rank = index + 1;
    return { ...row, rank };
  });
}

// Scoring version 3 replaced the BMW-only aero kit with the flag decal and
// raised the first two ECU steps. Support points under version 2 rules:
const LEGACY_SUPPORT_LEVELS = {
  oil: [
    [2, 40],
    [3, 60],
    [4, 85],
    [5, 110],
    [6, 135],
  ],
  aero: [
    [1, 25],
    [2, 65],
    [3, 105],
    [4, 145],
  ],
  tires: [
    [2, 20],
    [3, 60],
    [4, 120],
    [5, 190],
    [6, 270],
  ],
  ecu: [
    [1, 20],
    [2, 70],
    [3, 180],
  ],
};
function legacySupportPoints(hand) {
  const vehicles = hand.filter((card) => card.type === 'vehicle');
  const makers = countBy(vehicles, (card) => MODEL_BY_ID[card.modelId].maker);
  const models = countBy(vehicles, (card) => card.modelId);
  const counts = {
    oil: makers.TOYOTA || 0,
    aero: makers.BMW || 0,
    tires: Math.max(
      ...SETTINGS.map(
        (setting) => new Set(vehicles.filter((c) => c.settingId === setting.id).map((c) => c.modelId)).size,
      ),
    ),
    ecu: Object.values(models).filter((count) => count >= 2).length,
  };
  return Math.max(
    0,
    ...hand
      .filter((card) => card.type === 'support')
      .map(
        (card) =>
          LEGACY_SUPPORT_LEVELS[card.supportId].filter(([count]) => counts[card.supportId] >= count).at(-1)?.[1] || 0,
      ),
  );
}
const LEGACY_AERO_NAME = 'M Performance エアロ';

// Raised whenever a rule change alters the score of a hand already declared.
const SCORING_VERSION = 6;
// The scoring version each role arrived in; the first roles came with version 4.
const ROLE_SINCE = { supercar: 5, showroom: 6 };

// The role points a declared hand had under the roles of its save's version.
function legacyRolePoints(hand, version) {
  if (version == null || version < 4) return 0;
  const vehicles = hand.filter((card) => card.type === 'vehicle');
  const roles = ROLES.filter((role) => (ROLE_SINCE[role.id] ?? 4) <= version);
  const { role } = scoreRoles(
    vehicles,
    countBy(vehicles, (card) => card.colorId),
    countBy(vehicles, (card) => MODEL_BY_ID[card.modelId].country),
    modelGroups(countBy(vehicles, (card) => card.modelId)).length,
    roles,
  );
  return role?.points || 0;
}

// Old saves store the declaration's score. Upgrade only an exact match for the
// former SR ×2 formula and support tables; malformed or modified saves must still fail validation.
export function restoreGame(saved) {
  const version = saved?.scoringVersion;
  const legacy = version == null || version < 3;
  // The two aero cards become the two flag decals wherever the save refers to them.
  const state = JSON.parse(
    legacy
      ? JSON.stringify(saved)
          .replace(/"aero-([01])"/g, '"flag-$1"')
          .replaceAll('"supportId":"aero"', '"supportId":"flag"')
          .replaceAll(LEGACY_AERO_NAME, SUPPORT_BY_ID.flag.name)
      : JSON.stringify(saved),
  );
  const final = state?.finalLap;
  // Version 4 added role bonuses and later versions more roles (ROLE_SINCE), which no earlier declaration included.
  if (final && (version == null || version < SCORING_VERSION)) {
    // Frozen hands were scored under the rules current when declared.
    const current = scoreHand(final.hand);
    const srIncrease =
      version == null
        ? current.groups.reduce((sum, group) => {
            const model = MODEL_BY_ID[group.modelId];
            return sum + (model.rarity === 'SR' ? 10 * group.count * (group.count - 1) * (model.multiplier - 2) : 0);
          }, 0)
        : 0;
    const supportPoints = legacy ? legacySupportPoints(saved.finalLap.hand) : current.supportPoints;
    const legacyScore =
      current.total -
      srIncrease -
      current.supportPoints +
      supportPoints -
      current.rolePoints +
      legacyRolePoints(final.hand, version);
    if (final.score !== current.total && final.score === legacyScore) {
      const oldScore = final.score;
      final.score = current.total;
      for (const event of state.history)
        if (event.type === 'final-lap' && event.actor === final.declarer) {
          event.text = event.text.replace(oldScore + '点で手札を公開・固定', final.score + '点で手札を公開・固定');
        }
    }
  }
  assertState(state);
  state.scoringVersion = SCORING_VERSION;
  return state.phase === 'draw' && state.turnNumber === 0 ? settleInitialDeal(state) : state;
}

export function assertState(state) {
  requireRule(state.version === STORAGE_VERSION, '保存データの形式が違います。');
  requireRule(['draw', 'discard', 'finished'].includes(state.phase), '進行状態が不正です。');
  requireRule(
    state.players.length === 4 && state.currentPlayer >= 0 && state.currentPlayer < 4,
    'プレーヤー情報が不正です。',
  );
  const all = [
    ...state.deck,
    ...state.players.flatMap((player) => player.hand),
    ...state.archive.map((entry) => entry.card),
    ...state.removed.map((entry) => entry.card),
    ...(state.pickup ? [state.pickup.card] : []),
  ];
  requireRule(!state.options?.mode || RULESETS[state.options.mode], '対戦モードが不正です。');
  const rules = rulesetOf(state);
  // Dealer orders (Grand Prix, standard only) join the pool and never leave their owner's hand.
  const orders = state.options.dealerOrder ?? [];
  requireRule(rules.id === 'standard' || !orders.length, 'ディーラーオーダーはスタンダードだけです。');
  requireRule(
    JSON.stringify(validDealerOrder(orders)) === JSON.stringify(orders),
    'ディーラーオーダーの指定が不正です。',
  );
  for (const id of orders)
    requireRule(
      state.players[id].hand.some((card) => card.id === dealerOrderCard(id).id),
      'ディーラーオーダーの位置が不正です。',
    );
  const pool = [...createCardPool(rules.id), ...orders.map(dealerOrderCard)];
  const expected = new Map(pool.map((card) => [card.id, card]));
  requireRule(
    all.length === pool.length && new Set(all.map((card) => card.id)).size === pool.length,
    'カードの重複または消失があります。',
  );
  for (const card of all)
    requireRule(JSON.stringify(card) === JSON.stringify(expected.get(card.id)), 'カード情報が不正です。');
  for (const player of state.players) {
    requireRule(
      player.hand.length ===
        rules.handSize + (state.phase === 'discard' && player.id === state.currentPlayer ? acquisitionCount(state) : 0),
      '手札の枚数が不正です。',
    );
    requireRule(player.turnsTaken >= 0 && player.turnsTaken <= rules.turnsPerPlayer, '手番数が不正です。');
  }
  requireRule(
    state.players.reduce((sum, player) => sum + player.turnsTaken, 0) === state.turnNumber,
    '手番の集計が一致しません。',
  );
  const final = state.finalLap;
  const master = state.masterVictory;
  if (master) {
    requireRule(
      Number.isInteger(master.playerId) && master.playerId >= 0 && master.playerId < 4,
      '特殊勝利のプレーヤーが不正です。',
    );
    requireRule(
      state.phase === 'finished' &&
        state.acquired === null &&
        state.currentPlayer === master.playerId &&
        master.turn === state.turnNumber &&
        isMasterHand(state.players[master.playerId].hand, rules.handSize),
      '86 MASTERの成立条件が不正です。',
    );
    requireRule(
      master.source === 'deal'
        ? state.turnNumber === 0 && !final
        : master.source === 'discard' && state.players[master.playerId].turnsTaken > 0,
      '86 MASTERの成立タイミングが不正です。',
    );
    const event = state.history.at(-1);
    requireRule(
      event?.type === '86-master' &&
        event.actor === master.playerId &&
        event.turn === master.turn &&
        JSON.stringify(event.cards) === JSON.stringify(state.players[master.playerId].hand),
      '86 MASTERの勝利記録が不正です。',
    );
  }
  if (final) {
    requireRule([1, FINAL_LAP_RULES.rounds].includes(finalRounds(final)), '最後の周回数が不正です。');
    const order = finalLapOrder(final.declarer, finalRounds(final));
    requireRule(Number.isInteger(final.declarer) && final.declarer >= 0 && final.declarer < 4, '宣言者が不正です。');
    requireRule(
      JSON.stringify([...final.completed, ...final.remaining]) === JSON.stringify(order),
      '最後の手番順が不正です。',
    );
    requireRule(
      final.declaredTurn + final.completed.length === state.turnNumber &&
        final.declaredTurn <= TOTAL_TURNS - 6 * finalRounds(final),
      '宣言後の手番数が不正です。',
    );
    // Declarations already saved under the former LAP 04 rule remain valid.
    const minimumLap = final.minimumLap ?? 4;
    const declaredLap = currentLap({ turnNumber: final.declaredTurn - 1 });
    requireRule(
      [4, FINAL_LAP_RULES.minimumLap].includes(minimumLap) && declaredLap >= minimumLap,
      '宣言が早すぎます。',
    );
    // Declarations saved under the fixed 120-point rule carry neither field.
    const legacy = final.targetScore == null && final.rounds == null;
    requireRule(
      legacy || (final.rounds === FINAL_LAP_RULES.rounds && final.targetScore === finalLapTarget(declaredLap)),
      '宣言の条件が不正です。',
    );
    requireRule(
      JSON.stringify(final.hand) === JSON.stringify(state.players[final.declarer].hand) &&
        final.score === scoreHand(final.hand).total &&
        final.score >= (legacy ? 120 : final.targetScore),
      '宣言者の手札・得点が変化しています。',
    );
    requireRule(
      master
        ? final.completed.at(-1) === master.playerId && master.playerId !== final.declarer
        : state.phase === 'finished'
          ? final.remaining.length === 0
          : final.remaining[0] === state.currentPlayer,
      'ファイナルラップの進行が不正です。',
    );
  }
  // Standard stock falls by one card every turn; rookie pickups leave it untouched.
  // Each dealer order put one dealt card back under the stock.
  requireRule(
    !rules.pickupBurn ||
      state.deck.length ===
        TOTAL_TURNS +
          orders.length -
          state.turnNumber -
          (final?.completed.length || 0) -
          (state.phase === 'discard' ? acquisitionCount(state) : 0),
    '山札の消費枚数が不正です。',
  );
  if (state.phase === 'discard')
    requireRule(
      acquiredIds(state).length === acquisitionCount(state) &&
        new Set(acquiredIds(state)).size === acquisitionCount(state) &&
        acquiredIds(state).every((id) => state.players[state.currentPlayer].hand.some((card) => card.id === id)),
      '取得カードが見つかりません。',
    );
  if (state.phase === 'finished' && !final && !master)
    requireRule(
      state.turnNumber === 4 * rules.turnsPerPlayer &&
        state.players.every((player) => player.turnsTaken === rules.turnsPerPlayer),
      '終了の条件が不正です。',
    );
  return true;
}
