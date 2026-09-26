import { MODEL_BY_ID, SUPPORT_BY_ID, COLOR_BY_ID, SETTING_BY_ID } from './data.js';

// Keep the approved artwork whole; typeset changed game values in their footer
// slots so the art and the scoring data agree.

// Each setting gets its own shape and colour. The printed art drew corner and
// stability as the same road icon, and a setting other than the printed one
// kept the wrong icon, so the whole slot between the footer rules is redrawn
// for every car. Shapes are drawn around (0, 0) at about 80 units wide.
const SETTING_ICONS = {
  corner: {
    color: '#c9442e',
    shape:
      '<path d="M-26 34V-4a26 26 0 0 1 52 0v8" fill="none" stroke-width="13" stroke-linecap="round"/><path d="M8 2h36L26 36z" stroke="none"/>',
  },
  acceleration: {
    color: '#1f6db5',
    shape:
      '<path d="M-36-28L-8 0l-28 28M0-28L28 0 0 28" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  stability: {
    color: '#2b8a57',
    shape: '<path d="M0-38l33 12v27c0 21-15 32-33 39-18-7-33-18-33-39v-27z" stroke="none"/>',
  },
};
const settingShape = (id) =>
  `<g fill="${SETTING_ICONS[id].color}" stroke="${SETTING_ICONS[id].color}">${SETTING_ICONS[id].shape}</g>`;

// A small inline icon for text beside the cards (hand status, card details).
export function settingIconMarkup(id) {
  return `<svg class="setting-icon setting-${id}" viewBox="-44 -44 88 88" aria-hidden="true">${settingShape(id)}</svg>`;
}

export function settingLabelMarkup(card) {
  if (card.type !== 'vehicle' || !SETTING_ICONS[card.settingId]) return '';
  return (
    '<svg class="card-setting-label" viewBox="0 0 1024 1536" aria-hidden="true"><rect class="setting-paper" x="318" y="1294" width="412" height="128"/><g transform="translate(420 1360)">' +
    settingShape(card.settingId) +
    '</g><text x="606" y="1362" text-anchor="middle" dominant-baseline="middle" fill="#202322" font-size="34" font-weight="800">' +
    SETTING_BY_ID[card.settingId].name +
    '</text></svg>'
  );
}

export function multiplierLabelMarkup(card) {
  if (card.type !== 'vehicle') return '';
  const model = MODEL_BY_ID[card.modelId];
  const printed = { C: 1, R: 1.5, SR: 2 }[model.rarity];
  if (model.multiplier === printed) return '';
  return (
    '<svg class="card-multiplier-label" viewBox="0 0 1024 1536" aria-hidden="true"><rect x="758" y="1295" width="218" height="82" fill="#f6efd9"/><text x="864" y="1365" text-anchor="middle" fill="#171717" font-size="90" font-weight="900" font-family="Arial Black, Arial, sans-serif" textLength="204" lengthAdjust="spacingAndGlyphs">×' +
    model.multiplier +
    '</text></svg>'
  );
}

// Support values printed on the approved artwork; changed steps are typeset over
// their slots (x = column centre on the 1024×1536 art).
const PRINTED_SUPPORT_POINTS = {
  ecu: { points: [20, 70, 180], centres: [195, 510, 828] },
};

export function supportValueLabelMarkup(card) {
  const printed = card.type === 'support' && PRINTED_SUPPORT_POINTS[card.supportId];
  if (!printed) return '';
  const cells = SUPPORT_BY_ID[card.supportId].levels
    .map((level, index) => ({ points: level.points, centre: printed.centres[index], was: printed.points[index] }))
    .filter((cell) => cell.points !== cell.was);
  if (!cells.length) return '';
  return (
    '<svg class="card-multiplier-label card-support-label" viewBox="0 0 1024 1536" aria-hidden="true">' +
    cells
      .map((cell) => {
        const text = '+' + cell.points;
        const width = text.length * 50;
        return (
          `<rect x="${cell.centre - 110}" y="1260" width="220" height="76" fill="#f0eee2"/>` +
          `<text x="${cell.centre}" y="1326" text-anchor="middle" fill="#161616" font-size="80" font-weight="900" font-style="italic" font-family="Arial Black, Arial, sans-serif" textLength="${width}" lengthAdjust="spacingAndGlyphs">${text}</text>`
        );
      })
      .join('') +
    '</svg>'
  );
}

// src is the 1024×1536 delivery image; thumb the 360×540 copy for cards drawn small.
export function cardArt(card) {
  if (card.type === 'order')
    return {
      src: 'assets/cards/game-v1/dealer-order.jpg',
      thumb: 'assets/cards/game-v1/thumb/dealer-order.jpg',
      rarity: 'sp',
      name: 'ディーラーオーダー',
    };
  if (card.type === 'support' && SUPPORT_BY_ID[card.supportId]) {
    const key = 'support-' + card.supportId;
    return {
      src: 'assets/cards/game-v1/' + key + '.jpg',
      thumb: 'assets/cards/game-v1/thumb/' + key + '.jpg',
      rarity: 'support',
      name: SUPPORT_BY_ID[card.supportId].name,
    };
  }
  const model = MODEL_BY_ID[card.modelId];
  const color = COLOR_BY_ID[card.colorId];
  if (card.type !== 'vehicle' || !model || !color) throw new Error('Unknown card artwork');
  const key = card.modelId + '-' + card.colorId;
  return {
    src: 'assets/cards/game-v1/' + key + '.jpg',
    thumb: 'assets/cards/game-v1/thumb/' + key + '.jpg',
    rarity: model.rarity.toLowerCase(),
    name: model.name + '・' + color.name,
  };
}
