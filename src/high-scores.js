import { COLOR_BY_ID, MODEL_BY_ID, SETTING_BY_ID, SUPPORT_BY_ID } from './data.js';

// The player's own high scores, kept in this browser. Standard and rookie
// scores differ in scale, so each mode has its own ranking.
export const SCORES_KEY = '86-master-scores-v1';
// Grand Prix totals (four races) rank apart from single races.
export const SCORE_MODES = ['standard', 'rookie', 'grandprix'];
export const TOP_COUNT = 5;
const KEEP_PER_MODE = 50;

const JST = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// Stored as UTC ISO time; shown as JST, e.g. "2026/09/26 14:05".
export function formatJst(iso) {
  const parts = Object.fromEntries(JST.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

// A card as it looked, not its id: ids follow the deck's make-up, which may change.
const cardSnapshot = (card) =>
  card.type === 'vehicle'
    ? { type: 'vehicle', modelId: card.modelId, colorId: card.colorId, settingId: card.settingId }
    : card.type === 'order'
      ? { type: 'order' }
      : { type: 'support', supportId: card.supportId };

// One finished match from the player's seat (id 0). The id keeps a reloaded
// results screen from recording the same match twice. The role is kept by name
// (null when none) with the final hand; records saved before these were added have neither field.
export function scoreEntry(state, rows, now = new Date()) {
  const row = rows.find((candidate) => candidate.player.id === 0);
  return {
    id: `${state.options.mode || 'standard'}:${state.seed}:${state.turnNumber}:${row.score.total}`,
    mode: state.options.mode || 'standard',
    score: row.score.total,
    rank: row.rank,
    master: state.masterVictory?.playerId === 0,
    role: row.score.role?.name || null,
    hand: row.player.hand.map(cardSnapshot),
    at: now.toISOString(),
    seed: state.seed,
  };
}

const knownCard = (card) =>
  card?.type === 'vehicle'
    ? Boolean(MODEL_BY_ID[card.modelId] && COLOR_BY_ID[card.colorId] && SETTING_BY_ID[card.settingId])
    : card?.type === 'order' || (card?.type === 'support' && Boolean(SUPPORT_BY_ID[card.supportId]));

// The recorded hand, ready to draw, or null for older records and cards no longer in the game.
export const recordedHand = (entry) =>
  Array.isArray(entry.hand) && entry.hand.length && entry.hand.every(knownCard) ? entry.hand : null;

// A finished Grand Prix from the player's seat: the four-race total and final rank.
export function grandPrixEntry(gp, rows, now = new Date()) {
  const row = rows.find((candidate) => candidate.playerId === 0);
  return {
    id: 'grandprix:' + gp.id,
    mode: 'grandprix',
    score: row.total,
    rank: row.rank,
    master: gp.races.some((race) => race.master === 0),
    at: now.toISOString(),
    seed: gp.id,
  };
}

const ordered = (a, b) => b.score - a.score || a.at.localeCompare(b.at);

// Adds an entry once, and keeps the best KEEP_PER_MODE of each mode.
export function addScore(list, entry) {
  if (list.some((item) => item.id === entry.id)) return list;
  const next = [...list, entry];
  return SCORE_MODES.flatMap((mode) =>
    next
      .filter((item) => item.mode === mode)
      .sort(ordered)
      .slice(0, KEEP_PER_MODE),
  );
}

export const topScores = (list, mode, count = TOP_COUNT) =>
  list
    .filter((item) => item.mode === mode)
    .sort(ordered)
    .slice(0, count);

// Position of an entry in its mode's ranking (1-based), or null if not kept.
export function scorePosition(list, entry) {
  const index = topScores(list, entry.mode, KEEP_PER_MODE).findIndex((item) => item.id === entry.id);
  return index < 0 ? null : index + 1;
}

// Saved data comes from the browser; drop anything malformed.
export function parseScores(text) {
  try {
    const list = JSON.parse(text || '[]');
    return Array.isArray(list)
      ? list.filter(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            SCORE_MODES.includes(item.mode) &&
            Number.isFinite(item.score) &&
            Number.isInteger(item.rank) &&
            (item.role == null || typeof item.role === 'string') &&
            (item.hand === undefined || Array.isArray(item.hand)) &&
            !Number.isNaN(Date.parse(item.at)),
        )
      : [];
  } catch {
    return [];
  }
}
