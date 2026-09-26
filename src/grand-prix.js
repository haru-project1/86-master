// Grand Prix: four standard races, and the highest total is champion. Each seat
// starts one race. Before the final race the WORLD CAR DEALER sends a dealer
// order to the last-placed driver (every driver tied for last; nobody if all tie).
import { standings } from './engine.js';

export const GRAND_PRIX_KEY = '86-master-grandprix-v1';
export const GRAND_PRIX_ROUNDS = 4;
// 86 MASTER ends a race at once, so it counts as a fixed score in the totals.
export const MASTER_POINTS = 860;

// blocks applies to every race; assisted marks a series the CPU finished for the player.
export function createGrandPrix(id, starter, blocks = true) {
  return { version: 1, id: String(id), starter, blocks, assisted: false, races: [] };
}

export const nextRound = (gp) => gp.races.length + 1;
export const isGrandPrixOver = (gp) => gp.races.length >= GRAND_PRIX_ROUNDS;
export const roundStarter = (gp, round) => (gp.starter + round - 1) % 4;

// What each seat adds to the totals from a finished race.
export function racePoints(state) {
  const rows = standings(state);
  return state.players.map((player) =>
    state.masterVictory?.playerId === player.id
      ? MASTER_POINTS
      : rows.find((row) => row.player.id === player.id).score.total,
  );
}

// Adds a finished race once; anything else (another Grand Prix, a replayed round) is ignored.
export function recordRace(gp, state) {
  const link = state.options.grandPrix;
  if (!link || link.id !== gp.id || link.round !== nextRound(gp) || state.phase !== 'finished') return gp;
  return {
    ...gp,
    races: [
      ...gp.races,
      { round: link.round, seed: state.seed, points: racePoints(state), master: state.masterVictory?.playerId ?? null },
    ],
  };
}

export const grandPrixTotals = (gp, races = gp.races.length) =>
  [0, 1, 2, 3].map((id) => gp.races.slice(0, races).reduce((sum, race) => sum + race.points[id], 0));

// Seats by total, highest first; equal totals share a rank.
export function grandPrixStandings(gp, races = gp.races.length) {
  const totals = grandPrixTotals(gp, races);
  const order = [0, 1, 2, 3].sort((a, b) => totals[b] - totals[a] || a - b);
  return order.map((playerId) => ({
    playerId,
    total: totals[playerId],
    rank: 1 + totals.filter((total) => total > totals[playerId]).length,
  }));
}

export function dealerOrderSeats(gp) {
  if (gp.races.length !== GRAND_PRIX_ROUNDS - 1) return [];
  const totals = grandPrixTotals(gp);
  const lowest = Math.min(...totals);
  const seats = [0, 1, 2, 3].filter((id) => totals[id] === lowest);
  return seats.length < 4 ? seats : [];
}

// createGame options for the next race.
export function nextRaceOptions(gp) {
  const round = nextRound(gp);
  const dealerOrder = dealerOrderSeats(gp);
  return {
    starter: roundStarter(gp, round),
    grandPrix: { id: gp.id, round },
    ...(dealerOrder.length ? { dealerOrder } : {}),
  };
}

// Saved data comes from the browser; anything malformed starts no Grand Prix.
export function parseGrandPrix(text) {
  try {
    const gp = JSON.parse(text || 'null');
    const valid =
      gp &&
      gp.version === 1 &&
      typeof gp.id === 'string' &&
      Number.isInteger(gp.starter) &&
      gp.starter >= 0 &&
      gp.starter < 4 &&
      typeof gp.blocks === 'boolean' &&
      typeof gp.assisted === 'boolean' &&
      Array.isArray(gp.races) &&
      gp.races.length <= GRAND_PRIX_ROUNDS &&
      gp.races.every(
        (race, index) =>
          race &&
          race.round === index + 1 &&
          typeof race.seed === 'string' &&
          Array.isArray(race.points) &&
          race.points.length === 4 &&
          race.points.every(Number.isFinite) &&
          (race.master === null || (Number.isInteger(race.master) && race.master >= 0 && race.master < 4)),
      );
    return valid ? gp : null;
  } catch {
    return null;
  }
}
