import { MODEL_BY_ID, seededRandom } from './data.js';
import { scoreHand, isMasterHand, countBy, currentLap, finalLapTarget, FINAL_LAP_RULES } from './engine.js';
import { publicOffer } from './strategy.js';

// Decision utility only. The displayed score remains the normal hand score.
const MASTER_VALUE = 10000;
// Observations carry the mode; older callers and tests default to standard.
const sizeOf = (observation) => observation.handSize || 7;
const modeOf = (observation) => observation.mode || 'standard';
// Rookie CPUs pass on the best discard now and then, so younger players can keep up.
const ROOKIE_SLIP = 0.3;
function masterChance(hand, unseen, draws, size = 7) {
  if (hand.filter((card) => card.modelId === '86').length !== size - 1) return 0;
  const hits = unseen.filter((card) => card.modelId === '86').length;
  let miss = 1;
  for (let draw = 0; draw < Math.min(draws, unseen.length); draw++)
    miss *= Math.max(0, unseen.length - hits - draw) / (unseen.length - draw);
  return 1 - miss;
}

function valueHand(hand, observation, unseen = observation.unseen) {
  if (isMasterHand(hand, sizeOf(observation))) return MASTER_VALUE;
  const score = scoreHand(
    observation.ignoreSupports ? hand.filter((card) => card.type !== 'support') : hand,
    modeOf(observation),
  );
  if (observation.turnsRemaining <= 1) return score.total;
  const available = countBy(
    unseen.filter((card) => card.type === 'vehicle'),
    (card) => card.modelId,
  );
  const horizon = Math.min(5, observation.turnsRemaining - 1);
  const styleWeight = observation.style === 'bold' ? 0.65 : observation.style === 'flexible' ? 0.36 : 0.44;
  let potential = 0;
  for (const [modelId, count] of Object.entries(score.modelCounts)) {
    const probability = 1 - (1 - (available[modelId] || 0) / Math.max(1, unseen.length)) ** horizon;
    potential += probability * 20 * count * MODEL_BY_ID[modelId].multiplier * styleWeight;
  }
  const supportPotential = Math.max(
    0,
    ...score.supports.map((support) => {
      if (!support.next) return 0;
      let outs = 0;
      if (support.supportId === 'oil') {
        outs = unseen.filter((c) => c.type === 'vehicle' && MODEL_BY_ID[c.modelId].maker === 'TOYOTA').length;
      } else if (support.supportId === 'flag') {
        outs = unseen.filter(
          (c) => c.type === 'vehicle' && (!support.country || MODEL_BY_ID[c.modelId].country === support.country),
        ).length;
      } else if (support.supportId === 'ecu') {
        outs = unseen.filter((c) => c.type === 'vehicle' && score.modelCounts[c.modelId] === 1).length;
      } else {
        outs = Math.max(
          ...score.settingGroups
            .filter((g) => g.models.length === support.count)
            .map(
              (g) =>
                unseen.filter((c) => c.type === 'vehicle' && c.settingId === g.id && !g.models.includes(c.modelId))
                  .length,
            ),
        );
      }
      const chance = (1 - (1 - outs / Math.max(1, unseen.length)) ** horizon) ** support.next.needed;
      // Only the best support will score; carrying a second part has an opportunity cost.
      return chance * Math.max(0, support.next.points - score.supportPoints);
    }),
  );
  potential += supportPotential * (observation.style === 'flexible' ? 0.7 : 0.45);
  const attributePotential = Math.max(
    0,
    ...score.attributeGoals.map((goal) => {
      const outs = unseen.filter(
        (card) =>
          card.type === 'vehicle' &&
          (goal.type === 'color' ? card.colorId === goal.id : MODEL_BY_ID[card.modelId].maker === goal.id),
      ).length;
      const chance = (1 - (1 - outs / Math.max(1, unseen.length)) ** horizon) ** goal.needed;
      return chance * (goal.points - score.attributePoints);
    }),
  );
  potential += attributePotential * (observation.style === 'flexible' ? 0.4 : 0.25);
  // Roles: cars of a missing color, country or model (or the one color being gathered) are the outs;
  // for Showroom, the target model in a missing color.
  const rolePotential = Math.max(
    0,
    ...score.roleGoals.map((goal) => {
      const outs = unseen.filter(
        (card) =>
          card.type === 'vehicle' &&
          (goal.id === 'showroom'
            ? card.modelId === goal.model && goal.colors.includes(card.colorId)
            : goal.colors
              ? goal.colors.includes(card.colorId)
              : goal.models
                ? goal.models.some((model) => model.id === card.modelId)
                : goal.countries.includes(MODEL_BY_ID[card.modelId].country)),
      ).length;
      const chance = (1 - (1 - outs / Math.max(1, unseen.length)) ** horizon) ** goal.needed;
      return chance * (goal.points - score.rolePoints);
    }),
  );
  potential += rolePotential * (observation.style === 'flexible' ? 0.4 : 0.25);
  return score.total + potential + masterChance(hand, unseen, horizon, sizeOf(observation)) * 160 * styleWeight;
}

export function chooseDiscard(
  observation,
  acquiredCardId = observation.acquired?.cardId,
  source = observation.acquired?.source,
) {
  if (observation.hand.length === 9) return chooseFinalDiscards(observation, acquiredCardId, source);
  let best = null;
  const candidates = [];
  for (const card of observation.hand) {
    // A dealer order stays in hand; a card picked up this turn cannot go back.
    if (card.type === 'order' || (source === 'pickup' && card.id === acquiredCardId)) continue;
    const hand = observation.hand.filter((candidate) => candidate.id !== card.id);
    const fit = observation.known ? publicOffer(observation, card) : { gain: 0 };
    const defensiveWeight = observation.blockAvailable && observation.deckCount > 0 ? 0.02 : 0.12;
    const value = valueHand(hand, observation) - Math.min(10, fit.gain * defensiveWeight);
    const candidate = {
      cardId: card.id,
      cardIds: [card.id],
      value,
      masterWin: isMasterHand(hand, sizeOf(observation)),
      score: scoreHand(
        observation.ignoreSupports ? hand.filter((card) => card.type !== 'support') : hand,
        modeOf(observation),
      ).total,
    };
    candidates.push(candidate);
    if (
      !best ||
      value > best.value + 0.000001 ||
      (Math.abs(value - best.value) < 0.000001 && candidate.score > best.score)
    )
      best = candidate;
  }
  if (modeOf(observation) === 'rookie' && !best.masterWin && candidates.length > 1) {
    const random = seededRandom(observation.decisionSeed + ':rookie');
    if (random() < ROOKIE_SLIP) {
      const others = candidates.filter((candidate) => candidate !== best);
      return others[Math.floor(random() * others.length)];
    }
  }
  return best;
}

const DEALER_ORDER_DRAWS = 24;
const spread = (cards, count) =>
  cards.length <= count
    ? cards
    : Array.from({ length: count }, (_, index) => cards[Math.floor((index * cards.length) / count)]);

export function chooseAcquisition(observation) {
  if (!observation.pickup || !observation.unseen.length) return 'deck';
  if (
    observation.hand.filter((card) => card.modelId === '86').length === sizeOf(observation) - 1 &&
    observation.pickup.card.modelId === '86'
  )
    return 'pickup';
  if (observation.finalLap) return chooseFinalAcquisition(observation);
  const picked = observation.pickup.card;
  const pickupValue = chooseDiscard({ ...observation, hand: [...observation.hand, picked] }, picked.id, 'pickup').value;
  // Average over every publicly possible card, never the actual next card. A hand
  // with a dealer order scores each hand 60 ways, so it averages over an evenly
  // spread sample instead (the unseen cards are listed model by model).
  const draws = observation.hand.some((card) => card.type === 'order')
    ? spread(observation.unseen, DEALER_ORDER_DRAWS)
    : observation.unseen;
  let drawValue = 0;
  for (const card of draws) {
    const unseen = observation.unseen.filter((candidate) => candidate.id !== card.id);
    drawValue += chooseDiscard({ ...observation, hand: [...observation.hand, card], unseen }, card.id, 'deck').value;
  }
  drawValue /= draws.length;
  return pickupValue >= drawValue + (observation.style === 'bold' ? 0.7 : 0) ? 'pickup' : 'deck';
}

export function shouldBlock(observation, cardId) {
  if (!observation.blockAvailable || observation.deckCount === 0 || observation.finalLap?.remaining.length === 1)
    return false;
  const card = observation.hand.find((candidate) => candidate.id === cardId);
  const fit = publicOffer(observation, card);
  const threshold = observation.turnsRemaining > 7 ? 45 : 20;
  return fit.gain >= threshold || (observation.turnsRemaining <= 3 && fit.signal);
}

// Exhaustively compare legal pairs; special victory outranks normal points.
// Before the last final turn, keep the draw potential in view as in normal turns.
function chooseFinalDiscards(observation, acquiredCardId, source) {
  let best = null;
  const legal = observation.hand.filter(
    (card) => card.type !== 'order' && !(source === 'pickup' && card.id === acquiredCardId),
  );
  const fit = (card) => (observation.known ? publicOffer(observation, card).gain : 0);
  for (let a = 0; a < legal.length; a++)
    for (let b = a + 1; b < legal.length; b++) {
      const cards = [legal[a], legal[b]];
      const ids = cards.map((card) => card.id);
      const hand = observation.hand.filter((card) => !ids.includes(card.id));
      const masterWin = isMasterHand(hand);
      const score = scoreHand(hand).total;
      const value = masterWin ? MASTER_VALUE : observation.turnsRemaining > 1 ? valueHand(hand, observation) : score;
      if (best && value < best.value) continue;
      const gains = cards.map(fit);
      const offerIndex = gains[0] <= gains[1] ? 0 : 1;
      const risk = gains[offerIndex];
      if (!best || value > best.value || risk < best.risk)
        best = { cardId: ids[offerIndex], cardIds: ids, score, value, masterWin, risk };
    }
  return best;
}

function chooseFinalAcquisition(observation) {
  const random = seededRandom(observation.decisionSeed + ':final-draw');
  const pool = observation.unseen;
  if (pool.length < 2) return 'deck';
  let deckValue = 0,
    pickupValue = 0;
  // A bounded, reproducible sample of public possibilities keeps UI decisions
  // responsive; fewer for a dealer-order hand, which scores each hand 60 ways.
  const trials = observation.hand.some((card) => card.type === 'order') ? 8 : 24;
  for (let trial = 0; trial < trials; trial++) {
    const a = Math.floor(random() * pool.length);
    let b = Math.floor(random() * (pool.length - 1));
    if (b >= a) b++;
    deckValue += chooseDiscard(
      { ...observation, hand: [...observation.hand, pool[a], pool[b]] },
      pool[a].id,
      'deck',
    ).value;
    pickupValue += chooseDiscard(
      { ...observation, hand: [...observation.hand, observation.pickup.card, pool[a]] },
      observation.pickup.card.id,
      'pickup',
    ).value;
  }
  return pickupValue >= deckValue ? 'pickup' : 'deck';
}

export function shouldDeclareFinalLap(observation, choice) {
  if (
    !choice ||
    observation.finalLap ||
    observation.finalLapEnabled === false ||
    currentLap(observation) < FINAL_LAP_RULES.minimumLap ||
    observation.deckCount < FINAL_LAP_RULES.minimumDeck ||
    choice.score < finalLapTarget(currentLap(observation))
  )
    return false;
  // Public evidence and a rising score target, never the opponents' hidden hands.
  const publicBest = Math.max(
    0,
    ...observation.known
      .filter((_, id) => id !== observation.playerId)
      .map((entries) => scoreHand(entries.flatMap((entry) => Array(entry.count).fill(entry.card))).total),
  );
  const hand = observation.hand.filter((card) => !(choice.cardIds || [choice.cardId]).includes(card.id));
  if (isMasterHand(hand)) return false;
  const futureDraws = Math.min(3, observation.turnsRemaining - 1, Math.floor(observation.deckCount / 4));
  const masterThreat = observation.known.some(
    (entries, id) =>
      id !== observation.playerId &&
      entries.filter((entry) => entry.card.modelId === '86').reduce((n, entry) => n + entry.count, 0) >= 6,
  );
  const waitThreshold = observation.style === 'bold' ? 0.05 : observation.style === 'flexible' ? 0.1 : 0.07;
  if (
    !masterThreat &&
    publicBest < choice.score - 90 &&
    futureDraws >= 2 &&
    masterChance(hand, observation.unseen, futureDraws) >= waitThreshold
  )
    return false;
  const threshold =
    150 + observation.turnsTaken * 6 + (observation.style === 'bold' ? 0 : observation.style === 'flexible' ? 10 : 20);
  return choice.score >= Math.max(threshold, publicBest + 60);
}
