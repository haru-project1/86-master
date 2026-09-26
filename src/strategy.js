import { MODELS, MODEL_BY_ID, cardName, rulesetOf } from './data.js';
import { scoreHand, publicKnownCards } from './engine.js';

export function publicAvailability(state, playerId = 0) {
  const known = publicKnownCards(state);
  const out = [...state.archive, ...state.removed].map((entry) => entry.card);
  return Object.fromEntries(
    MODELS.map((model) => {
      const own = state.players[playerId].hand.filter((card) => card.modelId === model.id).length;
      const gone = out.filter((card) => card.modelId === model.id).length;
      const pickup = Number(state.pickup?.card.modelId === model.id);
      const revealed = known.reduce(
        (sum, entries, id) =>
          id === playerId
            ? sum
            : sum + entries.filter((entry) => entry.card.modelId === model.id).reduce((n, entry) => n + entry.count, 0),
        0,
      );
      return [
        model.id,
        {
          own,
          gone,
          pickup,
          revealed,
          remaining: model.count - own - gone,
          unseen: Math.max(0, model.count - own - gone - pickup - revealed),
        },
      ];
    }),
  );
}

export function masterProgress(state, hand = state.players[0].hand, playerId = 0) {
  const availability = publicAvailability(state, playerId)['86'];
  const count = hand.filter((card) => card.modelId === '86').length;
  const frozen =
    state.finalLap && state.finalLap.declarer !== playerId
      ? state.finalLap.hand.filter((card) => card.modelId === '86').length
      : 0;
  return {
    count,
    needed: Math.max(0, rulesetOf(state).handSize - count),
    unseen: availability.unseen,
    revealed: availability.revealed,
    pickup: state.phase === 'draw' && state.currentPlayer === playerId ? availability.pickup : 0,
    impossible: MODEL_BY_ID['86'].count - availability.gone - frozen < rulesetOf(state).handSize,
    locked: state.finalLap?.declarer === playerId,
  };
}

// Only cards acquired publicly and not subsequently discarded are considered.
// This is a possible fit, not an estimate of the opponent's full hand or score.
export function publicOffer(observation, card) {
  // In the final laps the discard passes to the next remaining turn, skipping the declarer.
  const final = observation.finalLap;
  const turn = final?.remaining.indexOf(observation.playerId);
  const recipient = final ? (turn < 0 ? undefined : final.remaining[turn + 1]) : (observation.playerId + 1) % 4;
  if (final && recipient === undefined)
    return {
      recipient,
      gain: 0,
      signal: false,
      message: '次の相手はすでに手番を終えています。この捨て札は拾われません。',
    };
  const known = observation.known[recipient].flatMap((entry) => Array.from({ length: entry.count }, () => entry.card));
  if (!card || !known.length)
    return { recipient, gain: 0, signal: false, message: '公開された拾得情報はまだありません。相手の狙いは不明です。' };
  const before = scoreHand(known, observation.mode).total;
  const combined = [...known, card];
  const after =
    combined.length <= (observation.handSize || 7)
      ? scoreHand(combined, observation.mode).total
      : Math.max(
          ...known.map(
            (_, index) =>
              scoreHand(
                combined.filter((_, position) => position !== index),
                observation.mode,
              ).total,
          ),
        );
  const gain = Math.max(0, after - before);
  const matching = card.type === 'vehicle' && known.some((other) => other.modelId === card.modelId);
  const part =
    card.type === 'vehicle' &&
    known.find(
      (other) =>
        other.type === 'support' &&
        (other.supportId === 'tires' ||
          other.supportId === 'ecu' ||
          (other.supportId === 'oil' && MODEL_BY_ID[card.modelId].maker === 'TOYOTA') ||
          (other.supportId === 'flag' &&
            known.some(
              (car) => car.type === 'vehicle' && MODEL_BY_ID[car.modelId].country === MODEL_BY_ID[card.modelId].country,
            ))),
    );
  let message = '公開された札との明確な組み合わせは未確認です。';
  const masterDanger =
    card.modelId === '86' && known.filter((other) => other.modelId === '86').length >= (observation.handSize || 7) - 1;
  if (masterDanger) message = '相手は86を6枚公開拾得済み。この札を渡すと86 MASTERで即勝利する可能性があります。';
  else if (matching) message = cardName(card) + 'を公開拾得済み。同じ車種の組を伸ばす可能性があります。';
  else if (gain > 0) message = '公開拾得した札と組み合わせて、ボーナスが伸びる可能性があります。';
  else if (part) message = cardName(part) + 'を公開拾得済み。この車を活用できる可能性があります。';
  // `strong` leaves out the generic "any car fits this support" case, for per-card warnings.
  return {
    recipient,
    gain,
    signal: Boolean(matching || part || gain),
    strong: Boolean(matching || gain >= 20 || masterDanger),
    message,
  };
}

export function sortHand(hand, order = 'model') {
  if (order === 'draw') return [...hand];
  // A dealer order leads, then cars, then supports.
  const rank = { order: 0, vehicle: 1, support: 2 };
  return [...hand].sort((a, b) => {
    if (a.type !== b.type) return rank[a.type] - rank[b.type];
    if (a.type === 'support') return a.supportId.localeCompare(b.supportId) || a.id.localeCompare(b.id);
    const key = order === 'setting' ? 'settingId' : order === 'color' ? 'colorId' : 'modelId';
    return (
      a[key].localeCompare(b[key]) ||
      a.modelId.localeCompare(b.modelId) ||
      a.colorId.localeCompare(b.colorId) ||
      a.id.localeCompare(b.id)
    );
  });
}
