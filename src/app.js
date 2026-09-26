import {
  MODELS,
  MODEL_BY_ID,
  COLOR_BY_ID,
  SETTING_BY_ID,
  SUPPORTS,
  SUPPORT_BY_ID,
  ROLES,
  ROOKIE_BONUSES,
  rulesetOf,
  createCardPool,
  cardName,
  COLOR_POINTS,
  MAKER_POINTS,
  DEALER_ORDER,
  seededRandom,
} from './data.js';
import {
  cardArt,
  settingIconMarkup,
  settingLabelMarkup,
  multiplierLabelMarkup,
  supportValueLabelMarkup,
} from './card-art.js';
import {
  createGame,
  scoreHand,
  acquireCard,
  discardCard,
  legalDiscards,
  canUseBlock,
  getObservation,
  standings,
  restoreGame,
  publicKnownCards,
  acquisitionCount,
  acquiredIds,
  discardCount,
  finalLapEligibility,
  finalLapTarget,
  currentLap,
  FINAL_LAP_RULES,
} from './engine.js';
import { chooseAcquisition, chooseDiscard, shouldBlock, shouldDeclareFinalLap } from './cpu.js';

import { publicOffer, sortHand, publicAvailability, masterProgress } from './strategy.js';
import { orderedHand, moveHandCard, bindHandDrag } from './hand-order.js';
import { configureSound, playSound, unlockSound } from './sound.js';
import {
  GRAND_PRIX_KEY,
  GRAND_PRIX_ROUNDS,
  MASTER_POINTS,
  createGrandPrix,
  dealerOrderSeats,
  grandPrixStandings,
  isGrandPrixOver,
  nextRaceOptions,
  nextRound,
  parseGrandPrix,
  recordRace,
} from './grand-prix.js';
import {
  SCORES_KEY,
  SCORE_MODES,
  grandPrixEntry,
  addScore,
  formatJst,
  parseScores,
  recordedHand,
  scoreEntry,
  scorePosition,
  topScores,
} from './high-scores.js';

const app = document.querySelector('#app');
const SAVE_KEY = '86-master-match-v2';
const PREFS_KEY = '86-master-prefs-v1';
let highScores = [];
try {
  highScores = parseScores(localStorage.getItem(SCORES_KEY));
} catch {}
// The entry recorded for the match that just ended, and the ranking the dialog shows.
let lastScoreEntry = null;
// The 86 MASTER finish plays its celebration first, then the dialog the finish opens
// otherwise: the Grand Prix standings, or the high scores it recorded.
let afterMaster = null;
let scoresMode = 'standard';
// CPU driver portraits (assets/characters). Looked up by name so saved matches need no change.
const DRIVER_AVATARS = { REN: 'ren', KAI: 'kai', AOI: 'aoi' };
const avatarMarkup = (player, className = 'driver-avatar') =>
  DRIVER_AVATARS[player.name]
    ? `<img class="${className}" src="assets/characters/${DRIVER_AVATARS[player.name]}.jpg" alt="" width="256" height="256" decoding="async" draggable="false">`
    : '';
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
// Tag for markup templates: a line break and the indentation after it are source layout
// only and are removed. Interpolated values are inserted as-is; pass text through escape().
const markup = (strings, ...values) =>
  strings.reduce(
    (out, part, index) => out + part.replace(/\n\s*/g, '') + (index < values.length ? values[index] : ''),
    '',
  );
// The current match's rules: hand size, laps and which standard features are on.
const rules = () => rulesetOf(game);
const scoreOf = (hand) => scoreHand(hand, rules().id);
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase();
let prefs = { fast: false, blocks: true, sort: 'model', shine: true, sound: true, volume: 0.6, mode: 'standard' };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
} catch {}
configureSound({ enabled: prefs.sound, volume: prefs.volume });
scoresMode = SCORE_MODES.includes(prefs.mode) ? prefs.mode : 'standard';
// Browsers start audio only after a user gesture.
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, unlockSound, { capture: true });
let game,
  handOrder = [],
  scoreUpdateNotice = '';
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
  game = restoreGame(saved);
  if (saved.scoringVersion == null) scoreUpdateNotice = '手札と進行状況を引き継ぎ、得点をSR×2.5で再計算しました。';
  else if (saved.scoringVersion < 3 && JSON.stringify(saved).includes('"supportId":"aero"'))
    scoreUpdateNotice = 'エアロは国旗デカールに置き換わりました。手札と進行状況はそのまま引き継いでいます。';
  handOrder = Array.isArray(game.handOrder)
    ? game.handOrder
    : sortHand(game.players[0].hand, 'model').map((card) => card.id);
  delete game.handOrder;
} catch {
  game = createGame(freshSeed(), { blocks: prefs.blocks, mode: prefs.mode });
}
let selectedId = null,
  selectedIds = [],
  finalLapArmed = false,
  blockArmed = false,
  modal = null,
  historyTab = 'log',
  autoPlay = false,
  cpuTimer = null,
  notice = scoreUpdateNotice;
let reorderMode = false,
  movingCardId = null,
  reorderMessage = '';
const cardPool = createCardPool();
let inspectedId = null,
  inspectionReturn = null,
  modalOpener = null,
  resultPlayerId = game.masterVictory?.playerId ?? 0;

// The Grand Prix a race belongs to. A saved series the current race does not
// name is stale (the player moved on) and is dropped.
let grandPrix = parseGrandPrix(localStorage.getItem(GRAND_PRIX_KEY));
if (grandPrix && game.options.grandPrix?.id !== grandPrix.id) grandPrix = null;
if (grandPrix) grandPrix = recordRace(grandPrix, game);
saveGrandPrix();
const inGrandPrix = () => Boolean(grandPrix && game.options.grandPrix?.id === grandPrix.id);

function saveGrandPrix() {
  try {
    if (grandPrix) localStorage.setItem(GRAND_PRIX_KEY, JSON.stringify(grandPrix));
    else localStorage.removeItem(GRAND_PRIX_KEY);
  } catch {}
}

function save() {
  handOrder = orderedHand(game.players[0].hand, handOrder).map((card) => card.id);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...game, handOrder }));
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function visibleHand() {
  return prefs.sort === 'manual'
    ? orderedHand(game.players[0].hand, handOrder)
    : sortHand(game.players[0].hand, prefs.sort);
}

function selectMovingCard(cardId) {
  if (!reorderMode || modal || !game.players[0].hand.some((card) => card.id === cardId)) return;
  movingCardId = cardId;
  reorderMessage = '';
  render();
  app.querySelector(`[data-action="move-select"][data-card-id="${cardId}"]`)?.focus({ preventScroll: true });
}

function moveVisibleCard(cardId, position) {
  if (!reorderMode || modal) return;
  const hand = visibleHand();
  if (!hand.some((card) => card.id === cardId) || position < 0 || position >= hand.length) return;
  handOrder = moveHandCard(hand, cardId, position).map((card) => card.id);
  prefs.sort = 'manual';
  movingCardId = cardId;
  reorderMessage = `${cardName(hand.find((card) => card.id === cardId))}を${position + 1}番目に移動しました`;
  save();
  render();
  app.querySelector(`[data-action="move-select"][data-card-id="${cardId}"]`)?.focus({ preventScroll: true });
}

function finishReordering() {
  reorderMode = false;
  movingCardId = null;
  reorderMessage = '';
  save();
  render();
  app.querySelector('[data-action="reorder-hand"]')?.focus({ preventScroll: true });
}

const cancelHandDrag = bindHandDrag(app, {
  enabled: () => reorderMode && !modal && !autoPlay,
  select: selectMovingCard,
  move: moveVisibleCard,
});

function badge(text, kind = '') {
  return `<span class="badge ${kind}">${escape(text)}</span>`;
}

function cardMarkup(card, options = {}) {
  const isOrder = card.type === 'order';
  const isSupport = card.type === 'support';
  const data = isOrder ? DEALER_ORDER : isSupport ? SUPPORT_BY_ID[card.supportId] : MODEL_BY_ID[card.modelId];
  const color = isOrder
    ? { hex: '#c9a45c', name: DEALER_ORDER.name }
    : isSupport
      ? { hex: '#85704c', name: 'サポート' }
      : COLOR_BY_ID[card.colorId];
  const setting = isSupport || isOrder ? null : SETTING_BY_ID[card.settingId];
  const art = cardArt(card);
  const classes = [
    'game-card',
    'art-card',
    `rarity-${art.rarity}`,
    isOrder ? 'order-card' : isSupport ? 'support-card' : 'vehicle-card',
    options.compact ? 'compact' : '',
    options.selected ? 'selected' : '',
    options.moving ? 'move-selected' : '',
    options.locked ? 'locked' : '',
    options.linked ? 'linked' : '',
    options.new ? 'new-card' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label =
    cardName(card) +
    (isSupport || isOrder
      ? `、${data.description}`
      : `、${data.makerJa}、${color.name}、${setting.name}、${data.rarity}、車種倍率${data.multiplier}倍`);
  const attrs = options.reorder
    ? `type="button" data-action="move-select" data-card-id="${card.id}" aria-label="${escape(label)}を移動する" aria-pressed="${Boolean(options.moving)}" aria-describedby="reorder-help"`
    : options.interactive
      ? `type="button" data-action="select-card" data-card-id="${card.id}" aria-label="${escape(label)}${options.locked ? (isOrder ? '' : '。拾ったカードなので今回は捨てられません') : 'を捨てる候補に選ぶ'}" aria-pressed="${Boolean(options.selected)}" ${options.locked ? 'disabled' : ''}`
      : `aria-label="${escape(label)}"`;
  const tag = options.interactive || options.reorder ? 'button' : 'div';
  return markup`
    <${tag} class="${classes}" style="--card-color:${color.hex}" ${attrs}>
    <div class="card-visual"><img class="vehicle-art" src="${options.thumb ? art.thumb : art.src}" alt="" width="1024" height="1536" decoding="async" draggable="false">${settingLabelMarkup(card)}${multiplierLabelMarkup(card)}${supportValueLabelMarkup(card)}
      <span class="card-foil" aria-hidden="true"></span>
    </div>${options.new ? `<span class="new-label">${options.locked ? '拾得 · 捨て不可' : 'NEW'}</span>` : ''}${options.selected ? '<span class="selection-tick">✓</span>' : ''}</${tag}>
  `;
}

function headerMarkup() {
  return markup`
    <header class="site-header">
      <a class="brand" href="./" aria-label="86 MASTER"><span class="brand-number">86</span><span>MASTER
        <small>GARAGE SEVEN</small></span>
      </a><span class="prototype-tag">${
        inGrandPrix()
          ? `GRAND PRIX R${game.options.grandPrix.round}/${GRAND_PRIX_ROUNDS}`
          : rules().id === 'rookie'
            ? 'ROOKIE'
            : 'PLAYTEST 04'
      }</span>
      <nav class="header-nav" aria-label="ゲームメニュー">
        <button data-action="rules">遊び方</button>
        <button data-action="catalog">カード一覧</button>
        <button data-action="history">記録</button>
        <button class="new-game-button" data-action="new">新しい対戦 <span>↗</span></button>
      </nav>
    </header>
  `;
}

// The 12-card stock condition closes declarations during LAP 12.
const DECLARE_LAPS = [8, 9, 10, 11, 12];
const finalTurnsLeft = (playerId) => game.finalLap?.remaining.filter((id) => id === playerId).length || 0;
const declareLine = () => {
  const target = finalLapTarget(currentLap(game));
  return target == null
    ? `LAP ${String(FINAL_LAP_RULES.minimumLap).padStart(2, '0')}・${FINAL_LAP_RULES.startScore}点から`
    : `宣言ライン ${target}点`;
};

// A seat's discards in order, each marked if the next driver picked it up.
// Seats show them newest first; the intel dialog oldest first.
function discardRiver(playerId) {
  const rows = [];
  const lastOf = new Map();
  for (const event of game.history) {
    if (['discard', 'block', 'archive'].includes(event.type)) {
      const row = { event, pickedBy: null };
      lastOf.set(event.card.id, row);
      if (event.actor === playerId) rows.push(row);
    } else if (event.type === 'pickup' && lastOf.has(event.card.id)) lastOf.get(event.card.id).pickedBy = event.actor;
  }
  const latestTurn = rows.at(-1)?.event.turn;
  return rows.map((row) => ({ ...row, latest: row.event.turn === latestTurn }));
}

function discardBadge({ event, pickedBy }) {
  if (event.type === 'block') return 'BLOCK';
  if (pickedBy != null) return '→' + game.players[pickedBy].name;
  return game.pickup?.card.id === event.card.id ? '拾得可' : '';
}

function cpuMarkup(playerId, seat) {
  const player = game.players[playerId];
  const active = game.currentPlayer === player.id;
  const declared = game.finalLap?.declarer === player.id;
  const done = Boolean(game.finalLap) && !declared && !finalTurnsLeft(player.id);
  const river = discardRiver(player.id);
  const knownCount = publicKnownCards(game)[player.id].reduce((sum, entry) => sum + entry.count, 0);
  const status = declared
    ? `${game.finalLap.score}点 · 宣言`
    : done
      ? 'FINISHED'
      : active
        ? '思考中'
        : game.finalLap
          ? `残り${finalTurnsLeft(player.id)}手`
          : `${player.turnsTaken} / ${rules().turnsPerPlayer}`;
  return markup`
    <article class="opponent seat-${seat}${active ? ' active' : ''}${declared ? ' declared' : ''}" aria-label="${player.name}の席">
      <div class="opponent-head">${avatarMarkup(player)}<span class="driver-number">${player.symbol}</span><strong>${player.name}</strong>
        <span class="opponent-status">${status}</span>
      </div>
      <div class="seat-body">
        <div class="cpu-discards" style="--discards:${Math.max(1, river.filter((row) => row.latest).length)}">${
          river.length
            ? river
                .map((row, index) => ({ row, index }))
                .reverse()
                .map(({ row, index }) => {
                  const badge = discardBadge(row);
                  const picked = row.pickedBy != null ? `（${game.players[row.pickedBy].name}が拾った）` : '';
                  return markup`
                    <button class="cpu-discard${row.latest ? ' latest' : ''}${row.pickedBy != null ? ' picked' : ''}" data-action="inspect-card" data-card-id="${row.event.card.id}" aria-label="${player.name}の捨て札 ${index + 1}枚目 ${escape(cardName(row.event.card))}${picked}を拡大">${cardMarkup(row.event.card, { compact: true, thumb: true })}${badge ? `<span>${escape(badge)}</span>` : ''}
                    </button>
                  `;
                })
                .join('')
            : '<span class="cpu-discard-empty"><span>捨て札</span> <span>まだなし</span></span>'
        }</div>
        <div class="seat-info"><span class="seat-caption">捨て札 ${river.length}枚</span>${rules().blocks ? `<span class="seat-block">BLOCK ${player.blockAvailable ? '1' : '0'}</span>` : ''}
          <button class="public-memory" data-action="intel" aria-label="${declared ? '公開手札 7枚' : `公開情報 ${knownCount}枚`}">公開<span class="label-long">${declared ? '手札' : '情報'}</span> ${declared ? 7 : knownCount}枚 ↗</button>
        </div>
      </div>
    </article>
  `;
}

function finalLapMarkup() {
  if (game.masterVictory) return '<span class="lap-status master-status">86 MASTER <span>特殊勝利で決着</span></span>';
  if (!game.finalLap && game.phase === 'finished') return '';
  if (rules().id === 'rookie')
    return `<span class="lap-status">ROOKIE <span>のこり${rules().turnsPerPlayer - currentLap(game) + 1}周</span></span>`;
  if (!game.finalLap) return `<span class="lap-status">FINAL LAP <span>${declareLine()}</span></span>`;
  return markup`
    <button class="lap-status live" data-action="final-hand">FINAL LAP <span>${game.players[game.finalLap.declarer].name} ${game.finalLap.score}点 · ${game.phase === 'finished' ? '決着' : `残り${game.finalLap.remaining.length}手番`} ↗</span></button>
  `;
}

function scoreMarkup(score, before, preview, detailed = false) {
  const delta = score.total - before.total;
  const breakdown = score.groups.length
    ? score.groups
        .map(
          (group) =>
            markup`
              <li><span>${escape(group.name)} <b>×${group.count}</b></span><strong>${group.points}</strong></li>
            `,
        )
        .join('')
    : '<li class="muted"><span>同じ車種を2枚から揃える</span><strong>0</strong></li>';
  const delivered = score.delivered
    ? `<li class="delivered-row"><span>${DEALER_ORDER.name} → ${escape(deliveredLabel(score.delivered))}</span><strong>納車予定</strong></li>`
    : '';
  return markup`
    <aside class="score-panel">
      <div class="score-heading"><span>${
        preview
          ? '捨てた後の得点'
          : game.currentPlayer === 0 && game.phase === 'discard'
            ? '取得前の得点'
            : '今終わったら'
      }</span>
        <button class="text-button" data-action="${detailed ? 'rules' : 'strategy'}">${detailed ? '配点を見る' : '内訳・戦略'} ↗</button>
      </div>
      <div class="score-total"><strong>${score.total}</strong><span>PTS</span>${
        preview
          ? markup`
            <span class="score-delta ${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : ''}${delta}</span>
          `
          : ''
      }</div>
      <div class="score-totals">${
        rules().id === 'rookie'
          ? `<span>車 <b>${score.vehiclePoints}</b></span><span>色ボーナス <b>${score.attributePoints + score.rolePoints}</b></span>`
          : markup`
            <span>車種 <b>${score.vehiclePoints}</b></span><span>属性 <b>${score.attributePoints}</b></span>
            <span>サポート <b>${score.supportPoints}</b></span><span>役 <b>${score.rolePoints}</b></span>
          `
      }</div>
      <ul class="score-breakdown">${breakdown}${delivered}${
        score.role
          ? `<li class="role-score"><span>役 · ${escape(score.role.name)}</span><strong>+${score.role.points}</strong></li>`
          : ''
      }${
        score.attribute
          ? `<li><span>${escape(score.attribute.label)}</span><strong>+${score.attribute.points}</strong></li>`
          : ''
      }${
        score.support
          ? markup`
            <li class="support-score"><span>${escape(score.support.name)}</span><strong>+${score.support.points}</strong></li>
          `
          : ''
      }</ul>
    </aside>
  `;
}

function arenaMarkup(score, before, preview) {
  const myTurn = game.currentPlayer === 0 && !autoPlay;
  const canDraw = myTurn && game.phase === 'draw' && !reorderMode;
  const final = Boolean(game.finalLap);
  const lastBlock =
    !game.pickup &&
    game.history
      .slice()
      .reverse()
      .find((event) => ['block', 'discard'].includes(event.type))?.type === 'block';
  const delta = score.total - before.total;
  return markup`
    <section class="race-table" aria-label="対戦テーブル">${cpuMarkup(2, 'top')}${cpuMarkup(1, 'left')}${cpuMarkup(3, 'right')}
      <div class="table-center">
        <div class="central-score ${score.specialWin ? 'master-ready' : ''}"><span>${preview ? '捨てた後' : myTurn && game.phase === 'discard' ? '取得前' : 'あなた'}</span>
          <strong>${score.total}<small>PTS</small></strong>${
            preview ? `<b class="${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : ''}${delta}</b>` : ''
          }
          <button class="text-button" data-action="strategy">内訳 ↗</button>
        </div>
        <div class="center-deck">
          <button class="deck-card" data-action="draw" ${canDraw ? '' : 'disabled'} aria-label="山札から${acquisitionCount(game)}枚引く">
            <span class="deck-brand">86<small>MASTER</small></span><span class="deck-count">${game.deck.length}
            <small>枚</small></span>
          </button>
          <button class="source-label" data-action="draw" ${canDraw ? '' : 'disabled'}>山札${final ? '2枚' : '1枚'} ↗</button>${
            game.removed.length
              ? markup`
                <button class="removed-count" data-action="history-removed" title="公開除外 ${game.removed.length}枚 · 最新：${escape(cardName(game.removed.at(-1).card))}" aria-label="公開除外 ${game.removed.length}枚、最新は${escape(cardName(game.removed.at(-1).card))}。一覧を開く">除外 ${game.removed.length}</button>
              `
              : ''
          }
        </div>
        <div class="center-pickup">${
          game.pickup
            ? markup`
              <button class="pickup-button" data-action="pickup" ${canDraw ? '' : 'disabled'} aria-label="捨て札の${escape(cardName(game.pickup.card))}を拾う${final ? '、さらに山札から1枚引く' : ''}">${cardMarkup(game.pickup.card, { compact: true })}</button>
            `
            : `<div class="empty-pickup"><strong>${lastBlock ? 'BLOCK' : '—'}</strong></div>`
        }
          <button class="source-label" data-action="pickup" ${canDraw && game.pickup ? '' : 'disabled'} aria-label="${final ? '拾う＋1枚' : '捨て札を拾う'}"><span>${final ? '拾う＋1枚' : '<span class="label-long">捨て札を</span>拾う'} ↗</span></button>
        </div>
      </div>
    </section>
  `;
}

function previewHand() {
  const me = game.players[0];
  if (game.currentPlayer !== 0 || game.phase !== 'discard') return me.hand;
  const ids = !reorderMode && selectedIds.length === discardCount(game) ? selectedIds : acquiredIds(game);
  return me.hand.filter((card) => !ids.includes(card.id));
}

function handMarkup(score) {
  const availability = publicAvailability(game);
  const hand = visibleHand();
  const myDiscard = game.currentPlayer === 0 && game.phase === 'discard' && !autoPlay;
  // While choosing, score the whole hand for fresh supports and check every discard the next player could take.
  const discardContext = myDiscard
    ? {
        fullScore: scoreOf(game.players[0].hand),
        observation: getObservation(game, 0),
        legal: new Set(legalDiscards(game).map((card) => card.id)),
      }
    : null;
  const targets = new Set([
    ...score.groups.flatMap((group) => hand.filter((card) => card.modelId === group.modelId).map((card) => card.id)),
    ...(score.support?.targetIds || []),
  ]);
  const support = score.supports.find((candidate) => !candidate.points);
  const sortOptions = [
    ['manual', '自由'],
    ['model', '車種'],
    ['setting', 'セッティング'],
    ['color', '色'],
    ['draw', '取得順'],
  ];
  const cards = hand
    .map(
      (card, index) =>
        markup`
          <div class="hand-card-slot">${cardMarkup(card, {
            interactive: myDiscard,
            selected: !reorderMode && selectedIds.includes(card.id),
            reorder: reorderMode,
            moving: movingCardId === card.id,
            locked:
              myDiscard &&
              (card.type === 'order' || (game.acquired.source === 'pickup' && game.acquired.cardId === card.id)),
            new: game.currentPlayer === 0 && acquiredIds(game).includes(card.id),
            linked: targets.has(card.id),
          })}${reorderMode ? `<span class="hand-position" aria-hidden="true">${index + 1}</span>` : ''}${handCardInfo(card, score, availability[card.modelId], discardContext)}</div>
        `,
    )
    .join('');
  return markup`
    <section class="hand-section ${reorderMode ? 'is-reordering' : ''}" aria-label="あなたの手札">
      <div class="hand-heading">
        <div><span class="eyebrow">YOUR GARAGE</span>
          <h1>あなたの手札 <small>${hand.length}枚</small></h1>
        </div>
        <div class="hand-tools">
          <label class="sort-control"><span>並べ方</span>
            <select id="hand-sort" aria-label="手札の並べ方">${sortOptions
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${prefs.sort === value ? 'selected' : ''}>${label}</option>`,
              )
              .join('')}</select>
          </label>
          <button class="reorder-toggle" data-action="reorder-hand" aria-pressed="${reorderMode}" ${autoPlay ? 'disabled' : ''}>${reorderMode ? '並べ替え完了 ✓' : '並べ替え ↔'}</button>
        </div>
        <p>${
          reorderMode
            ? 'ドラッグ、または選んで矢印で移動できます。'
            : myDiscard
              ? '捨てるカードを選ぶと、得点の変化を確認できます。'
              : '同じ車種は色・セッティングが違っても揃えられます。'
        }</p>
      </div>
      <div class="hand-scroll">
        <div class="hand-cards" data-count="${hand.length}" style="--hand-count:${hand.length}">${cards}</div>
      </div>
      <div class="hand-footnote"><span>緑枠は得点に貢献するカード · 拡大で詳細</span>${
        support
          ? `<span class="support-hint">${escape(`${support.name}：${support.missing}`)}</span>`
          : score.support
            ? `<span class="support-hint">${escape(score.support.name)} が有効</span>`
            : ''
      }</div>
    </section>
  `;
}

// "GR SUPRA・白": the car a dealer order is scored as.
const deliveredLabel = (car) => `${MODEL_BY_ID[car.modelId].name}・${COLOR_BY_ID[car.colorId].name}`;

function handCardInfo(card, score, availability, discardContext) {
  if (card.type === 'order')
    return markup`
      <div class="hand-card-info"><span class="live-card-status order-status" title="${escape(DEALER_ORDER.description)}">${
        score.delivered ? `納車予定 · ${escape(deliveredLabel(score.delivered))}` : 'どの車にもなる'
      }</span>${inspectButton(card)}<span class="card-remaining">捨てられない</span></div>
    `;
  const support = card.type === 'support';
  const state = score.supports.find((part) => part.cardId === card.id);
  // A support drawn this turn is not in the pre-draw score; show what it gives with the current cars.
  const drawnState = !state && discardContext?.fullScore.supports.find((part) => part.cardId === card.id);
  const detail = support
    ? selectedIds.includes(card.id)
      ? '捨てる候補'
      : state
        ? `+${state.points}点${score.support?.cardId === card.id ? ' · 有効' : ' · 候補'}`
        : drawnState
          ? drawnState.points
            ? `残すと+${drawnState.points}点`
            : '0点 · 条件未達'
          : '未確定'
    : rules().id === 'rookie'
      ? `${COLOR_BY_ID[card.colorId].name}の車`
      : SETTING_BY_ID[card.settingId].short;
  const offer =
    discardContext?.legal.has(card.id) && !score.specialWin ? publicOffer(discardContext.observation, card) : null;
  const risk = offer?.strong && offer.recipient !== undefined;
  const remaining = risk
    ? `<span class="feed-risk" title="${escape(offer.message)}">⚠ ${escape(game.players[offer.recipient].name)}が狙う札</span>`
    : !support
      ? !availability.remaining
        ? rules().id === 'rookie'
          ? 'もうない'
          : '追加なし'
        : rules().id === 'rookie'
          ? `のこり ${availability.unseen}枚${availability.pickup ? ' · ひろえる' : ''}`
          : `未確認 ${availability.unseen}${availability.pickup ? ' · 拾得可' : ''}`
      : '';
  const offerChoice =
    !score.specialWin && game.finalLap?.remaining.length > 1 && selectedIds.includes(card.id) && !reorderMode
      ? markup`
        <button class="offer-choice" data-action="offer-card" data-card-id="${card.id}" aria-pressed="${selectedId === card.id}">${
          selectedId === card.id
            ? blockArmed
              ? '除外する札 ✓'
              : '次の人へ ✓'
            : blockArmed
              ? '除外する札に変更'
              : '次の人へ渡す'
        }</button>
      `
      : '';
  return markup`
    ${offerChoice}
    <div class="hand-card-info"><span class="live-card-status ${support ? 'support-status' : ''}${risk ? ' at-risk' : ''}" title="${escape(
      support
        ? SUPPORT_BY_ID[card.supportId].description
        : `${SETTING_BY_ID[card.settingId].name}。未確認は山札と相手の未公開札の合計です。`,
    )}">${risk ? '⚠ ' : ''}${
      !support && rules().id !== 'rookie' ? settingIconMarkup(card.settingId) : ''
    }<span class="status-text">${escape(detail)}</span></span>${inspectButton(card)}<span class="card-remaining">${remaining}</span></div>
  `;
}

function masterHint(score) {
  const selecting = game.currentPlayer === 0 && game.phase === 'discard';
  if (selecting && selectedIds.length === discardCount(game) && score.specialWin)
    return {
      message: '86 MASTER完成！確定すると即勝利',
      detail: `選んだ札を捨て、${rules().handSize}枚を確定すると得点・LAPに関係なく勝利します。`,
      ready: true,
    };
  const hand = game.players[0].hand;
  const lockedOther =
    game.acquired?.source === 'pickup' &&
    hand.some((card) => card.id === game.acquired.cardId && card.modelId !== '86');
  if (selecting && hand.filter((card) => card.modelId === '86').length >= 7 && !lockedOther)
    return {
      message: `86が${rules().handSize}枚揃いました · 捨てる札を選んで完成`,
      detail: `86を${rules().handSize}枚残す捨て方を選び、確定すると即勝利します。`,
    };
  const progress = masterProgress(game, previewHand());
  if (progress.count !== 6) return null;
  if (progress.locked)
    return {
      message: '86は6枚 · 宣言済みのため手札固定',
      detail: `ファイナルラップ宣言後は${rules().handSize}枚目を取得できません。公開した手札で勝負します。`,
    };
  if (progress.impossible)
    return {
      message: '86 MASTER成立不可 · 通常得点で勝負',
      detail: `公開捨て札・除外・宣言者の固定手札にある86を除くと、${rules().handSize}枚を集められません。`,
    };
  return {
    message: `あと1枚で86 MASTER · 未確認${progress.unseen}枚${progress.pickup ? ' · 拾得可' : ''}`,
    detail: `未確認${progress.unseen}枚は山札と相手の未公開札の合計です。${progress.revealed ? `ほかに相手の公開手札に${progress.revealed}枚。` : ''}${progress.pickup ? '場の86を拾えます。' : ''}${rules().handSize}枚を確定すると即勝利。`,
  };
}

function strategySummaryMarkup(score) {
  const selected = game.players[0].hand.find((card) => card.id === selectedId);
  const offer = selected && publicOffer(getObservation(game, 0), selected);
  const master = !reorderMode && masterHint(score);
  const message = master
    ? master.message
    : reorderMode
      ? '並び順は自動保存。新しく引く札は最後に追加します。'
      : offer?.signal
        ? offer.message
        : score.support
          ? `${score.support.name} ＋${score.support.points}点が有効`
          : '手札を選ぶと、捨てた後の得点を確認できます。';
  return markup`
    <div class="strategy-summary ${master ? 'master-chase' : offer?.signal ? 'caution' : ''}"><span title="${escape(master?.detail || message)}">${escape(message)}</span>
      <button class="text-button" data-action="strategy">戦略メモ ↗</button>
      <button class="text-button" data-action="intel">公開情報 ↗</button>
    </div>
  `;
}

function strategyMarkup(score, preview) {
  const master = masterHint(score);
  const availability = publicAvailability(game);
  const exhausted = score.groups.filter((group) => !availability[group.modelId].remaining);
  const parts = game.players[0].hand.filter((card) => card.type === 'support');
  const selected = game.players[0].hand.find((card) => card.id === selectedId);
  const offer = publicOffer(getObservation(game, 0), selected);
  const plans = parts
    .map((card) => {
      const data = SUPPORT_BY_ID[card.supportId];
      const status = score.supports.find((part) => part.cardId === card.id);
      const discarded = selectedIds.includes(card.id);
      const active = score.support?.cardId === card.id;
      const points = discarded
        ? '捨てる候補'
        : status
          ? `＋${status.points}点${active ? ' · 有効' : status.points ? ' · 他のサポートを優先' : ' · 育成中'}`
          : '捨てる札を選んで確認';
      return markup`
        <div class="support-plan ${active ? 'active' : ''}">
          <div><strong>${data.name}</strong><span>${points}</span></div>
          <div class="support-ladder">${data.levels
            .map(
              (level) =>
                markup`
                  <span class="${status && status.count >= level.count && !discarded ? 'reached' : ''}">${level.count}${card.supportId === 'tires' ? '車種' : card.supportId === 'ecu' ? '組' : '枚'}
                  <b>+${level.points}</b></span>
                `,
            )
            .join('')}</div>
          <p>${escape(
            discarded
              ? '手札から外すと、このサポートの加点はなくなります。'
              : status
                ? `${status.detail} · ${status.missing}`
                : data.condition,
          )}</p>
        </div>
      `;
    })
    .join('');
  return markup`
    <section class="strategy-strip" aria-label="戦略メモ">
      <div class="tuning-plans">
        <div class="strategy-title"><span class="eyebrow">TUNING PLAN</span><span>${
          preview
            ? `捨てた後の${rules().handSize}枚`
            : game.currentPlayer === 0 && game.phase === 'discard'
              ? `取得前の${rules().handSize}枚を基準に表示`
              : 'サポートは最高点の1枚が有効'
        }</span></div>${
          master
            ? markup`
              <div class="master-plan"><strong>${escape(master.message)}</strong>
                <p>${escape(master.detail)}</p>
              </div>
            `
            : ''
        }${
          plans ||
          '<p class="no-plan">サポートなしでも車種の大きな組を狙えます。パーツを拾ったら、1枠使う価値と比べてみましょう。</p>'
        }${
          score.attributeGoals.length
            ? markup`
              <div class="attribute-goals"><span>属性の次の目標</span>${score.attributeGoals
                .slice(0, 2)
                .map(
                  (goal) =>
                    markup`
                      <p><strong>${escape(goal.label)} ${goal.count} → ${goal.target}枚</strong><b>属性 +${goal.points}</b></p>
                    `,
                )
                .join('')}<small>属性は最高点の1つだけ。入れ替え後の合計はカード選択で確認できます。</small></div>
            `
            : ''
        }${
          score.roleGoals.length
            ? markup`
              <div class="attribute-goals role-goals"><span>役の次の目標</span>${score.roleGoals
                .map(
                  (goal) =>
                    markup`
                      <p><strong>${escape(roleGoalLabel(goal))}</strong><b>役 +${goal.points}</b></p>
                    `,
                )
                .join(
                  '',
                )}<small>役は最高点の1つだけ。フルペイントとレインボーは車7枚（サポートなし）で成立します。</small></div>
            `
            : ''
        }${
          exhausted.length
            ? markup`
              <p class="exhausted-note">追加候補なし：${exhausted
                .map(
                  (group) =>
                    `${escape(group.name)}（手札 ${availability[group.modelId].own}・過去札／除外 ${availability[group.modelId].gone}）`,
                )
                .join(' / ')}。現在の組を残すか、別の狙いへ切り替えられます。</p>
            `
            : ''
        }
      </div>
      <div class="opponent-read ${selected && offer.signal ? 'caution' : ''}">
        <div class="strategy-title"><span class="eyebrow">NEXT DRIVER</span><strong>捨て先：REN</strong></div>
        <p>${escape(selected ? offer.message : 'RENが公開拾得した札を手がかりに、渡す札とブロックの使いどころを考えられます。')}</p>${
          selected && offer.signal && game.players[0].blockAvailable && canUseBlock(game)
            ? '<span class="block-hint">ブロックラインで、この札の拾得を防げます。</span>'
            : ''
        }
        <button class="text-button" data-action="intel">相手の公開情報を見る ↗</button><small>秘密の手札や現在の得点は含みません。</small>
      </div>
    </section>
  `;
}

// Every discard of a seat, oldest first, for screens whose seats show only the latest.
function riverListMarkup(playerId) {
  const river = discardRiver(playerId);
  return markup`
    <h4 class="intel-river-title">捨て札 ${river.length}枚 <small>古い順</small></h4>${
      river.length
        ? markup`
          <div class="intel-river">${river
            .map((row) => {
              const badge = discardBadge(row);
              return markup`
                <div class="${row.pickedBy != null ? 'picked' : ''}">${cardMarkup(row.event.card, { compact: true, thumb: true })}${badge ? `<span>${escape(badge)}</span>` : ''}</div>
              `;
            })
            .join('')}</div>
        `
        : '<p>まだ捨てていません。</p>'
    }
  `;
}

function intelMarkup() {
  const known = publicKnownCards(game);
  return markup`
    ${game.finalLap ? finalHandMarkup() : ''}
    <p class="dialog-lead">公開された拾得を、判断の手がかりに。</p>
    <p>上は捨て札から拾い、その後まだ捨てていないと分かる札です。同じ絵柄を捨てた場合は、その分を記憶から減らします。宣言者以外の山札から引いた札は表示しません。下はこれまでの捨て札で、「→名前」は次の人が拾った札です。</p>${game.players
      .slice(1)
      .map(
        (player) =>
          markup`
            <section class="intel-player">
              <h3>${player.name}${player.id === 1 ? ' <small>あなたの捨て先</small>' : ''}</h3>${
                known[player.id].length
                  ? markup`
                    <div class="intel-cards">${known[player.id]
                      .map(
                        (entry) =>
                          markup`
                            <div>${cardMarkup(entry.card, { compact: true, thumb: true })}<small>確認できる枚数：${entry.count}</small></div>
                          `,
                      )
                      .join('')}</div>
                  `
                  : '<p>公開拾得の記録はありません。狙いはまだ不明です。</p>'
              }${riverListMarkup(player.id)}
            </section>
          `,
      )
      .join('')}
  `;
}

function dockMarkup(score, before) {
  if (reorderMode) {
    const hand = visibleHand();
    const index = hand.findIndex((card) => card.id === movingCardId);
    return markup`
      <footer class="action-dock reorder-dock">
        <div class="turn-instruction"><span class="step-number">↔</span>
          <div><strong>${index < 0 ? '移動するカードを選ぶ' : `${escape(cardName(hand[index]))} · ${index + 1} / ${hand.length}`}</strong>
            <span id="reorder-help">ドラッグ、または選んで左右ボタンで移動</span><span class="sr-only" role="status">${escape(reorderMessage)}</span>
          </div>
        </div>
        <div class="reorder-arrows">
          <button class="secondary-button" data-action="move-left" aria-label="選んだカードを1つ前へ移動" ${index > 0 ? '' : 'disabled'}>← <span>前へ</span></button>
          <button class="secondary-button" data-action="move-right" aria-label="選んだカードを1つ後ろへ移動" ${index >= 0 && index < hand.length - 1 ? '' : 'disabled'}>
            <span>後ろへ</span> →
          </button>
        </div>
        <button class="primary-button" data-action="finish-reorder">完了 ✓</button>
      </footer>
    `;
  }
  const myTurn = game.currentPlayer === 0 && !autoPlay;
  const selected = game.players[0].hand.find((card) => card.id === selectedId);
  const count = discardCount(game);
  const ready = myTurn && game.phase === 'discard' && selectedIds.length === count;
  const masterReady = ready && Boolean(score.specialWin);
  const canBlock = myTurn && !masterReady && canUseBlock(game);
  if (masterReady) blockArmed = false;
  const eligibility = finalLapEligibility(game, selectedId);
  const canDeclare = myTurn && ready && !masterReady && eligibility.eligible;
  if (!canDeclare) finalLapArmed = false;
  const title = masterReady
    ? '86 MASTER · 勝利を確定'
    : autoPlay
      ? '全員おまかせで進行中'
      : !myTurn
        ? `${game.players[game.currentPlayer].name}の手番`
        : game.phase === 'draw'
          ? game.finalLap
            ? `${finalTurnsLeft(0) > 1 ? 'ファイナル' : '最後の1手'} · 2枚取得`
            : '1枚引く、または拾う'
          : game.finalLap
            ? `捨てる2枚を選択 · ${selectedIds.length}/2`
            : selected
              ? `${cardName(selected)}を手放す`
              : '捨てる1枚を選択';
  const hint = masterReady
    ? `この${rules().handSize}枚で即勝利。ほかのプレーヤーの手番も終了します`
    : game.finalLap
      ? ready
        ? `確定後 ${score.total}点 · ${game.finalLap.remaining.length > 1 ? '渡す札はカード下で変更' : 'あなたの確定で全員フィニッシュ'}`
        : myTurn && game.phase === 'discard'
          ? '2枚選ぶと残る7枚の得点を確認できます'
          : `宣言者 ${game.finalLap.score}点が目標 · 山札2枚、または捨て札＋山札1枚`
      : rules().id === 'rookie'
        ? myTurn && game.phase === 'discard'
          ? selected
            ? `捨てると ${score.total}点`
            : '捨てるカードを1枚えらんでね'
          : `${rules().turnsPerPlayer}周したら点数くらべ · 同じ車をそろえよう`
        : canDeclare
          ? `宣言できます · ${score.total}点で手札を公開・固定`
          : myTurn && game.phase === 'discard'
            ? eligibility.reason
            : `${declareLine()} · 毎LAP${FINAL_LAP_RULES.scoreStep}点ずつ下がる`;
  return markup`
    <footer class="action-dock">
      <div class="turn-instruction"><span class="step-number">${game.finalLap ? 'FL' : game.phase === 'draw' ? '01' : '02'}</span>
        <div><strong>${escape(title)}</strong><span>${escape(notice || hint)}</span></div>
      </div>${
        autoPlay
          ? '<button class="secondary-button" data-action="stop-auto">自分で操作する</button>'
          : rules().id === 'rookie'
            ? ''
            : markup`
            <div class="tactic-controls">
              <label class="block-control ${blockArmed ? 'armed' : ''}"><input type="checkbox" id="block-toggle" ${blockArmed ? 'checked ' : ''}${canBlock ? '' : 'disabled '}>
                <span><strong>ブロックライン</strong><small>${!game.players[0].blockAvailable ? '使用済み / OFF' : canBlock ? '次へ渡す1枚を公開除外' : '拾わせない · 1回'}</small></span>
              </label>${
                !game.finalLap
                  ? markup`
                    <label class="final-control ${finalLapArmed ? 'armed' : ''}"><input type="checkbox" id="final-lap-toggle" ${finalLapArmed ? 'checked ' : ''}${canDeclare ? '' : 'disabled '}>
                      <span><strong>ファイナルラップ</strong><small>${canDeclare ? '手札を公開して勝負' : declareLine()}</small></span>
                    </label>
                  `
                  : `<button class="final-target" data-action="final-hand">宣言者 ${game.finalLap.score}点 ↗</button>`
              }
            </div>
          `
      }
      <button class="primary-button discard-confirm ${masterReady ? 'master-confirm' : finalLapArmed ? 'declare-confirm' : ''}" data-action="discard" ${ready ? '' : 'disabled'}>${
        masterReady
          ? '86 MASTERで勝利'
          : finalLapArmed
            ? '宣言してターン終了'
            : game.finalLap
              ? finalTurnsLeft(0) > 1
                ? '2枚捨ててターン終了'
                : '2枚捨ててフィニッシュ'
              : blockArmed
                ? '除外してターン終了'
                : '捨ててターン終了'
      }<span>→</span></button>
    </footer>
  `;
}

function resultsMarkup() {
  const rows = standings(game);
  const winners = rows.filter((row) => row.rank === 1);
  const youWon = winners.some((row) => row.player.id === 0);
  const master = game.masterVictory;
  const masterName = master ? game.players[master.playerId].name : '';
  const finishTitle = master
    ? '86 MASTER'
    : winners.length > 1
      ? '同点でフィニッシュ。'
      : youWon
        ? 'あなたのガレージが勝利。'
        : `${winners[0].player.name}のガレージが勝利。`;
  const { player, score, rank } = rows.find((row) => row.player.id === resultPlayerId) || rows[0];
  return markup`
    <section class="results ${master ? 'master-finish' : ''}">
      <div class="finish-heading">
        <div><span class="eyebrow">FINISH / ${
          master
            ? `SPECIAL VICTORY · ${masterName}`
            : game.finalLap
              ? `FINAL LAP · ${game.players[game.finalLap.declarer].name} 宣言 ${game.finalLap.score} PTS`
              : `LAP ${rules().turnsPerPlayer}`
        }</span>
          <h1>${finishTitle}</h1>${
            master
              ? `<p class="master-finish-note" role="status">${youWon ? 'あなた' : masterName}の特殊勝利 · 86 GT ${rules().handSize}枚で即フィニッシュ</p>`
              : ''
          }
        </div>
        <div class="result-actions">${
          !inGrandPrix()
            ? markup`
              <button class="primary-button" data-action="new">もう一度遊ぶ ↗</button>
              <button class="secondary-button" data-action="replay">同じ配札で再戦</button>
            `
            : isGrandPrixOver(grandPrix)
              ? markup`
                <button class="primary-button" data-action="new">新しい対戦 ↗</button>
                <button class="secondary-button" data-action="grand-prix">グランプリの結果 ↗</button>
              `
              : markup`
                <button class="primary-button" data-action="gp-next">ROUND ${nextRound(grandPrix)}へ →</button>
                <button class="secondary-button" data-action="grand-prix">総合順位 ↗</button>
              `
        }
          <button class="secondary-button" data-action="scores">ハイスコア ↗</button>
          <button class="text-button" data-action="export">記録を保存 ↓</button>
        </div>
      </div>
      <div class="result-tabs" role="tablist" aria-label="結果を見るプレーヤー">${rows
        .map(
          (row) =>
            markup`
              <button role="tab" id="result-tab-${row.player.id}" aria-controls="result-panel" aria-selected="${row.player.id === player.id}" data-action="result-player" data-player-id="${row.player.id}">
                <span>${row.rank}位 · ${row.player.name}</span><strong>${row.masterWinner ? 'MASTER' : row.score.total}
                <small>${row.masterWinner ? ' WIN' : ' PTS'}</small></strong>
              </button>
            `,
        )
        .join('')}</div>
      <article class="result-player ${master?.playerId === player.id ? 'winner master-winner' : rank === 1 ? 'winner' : ''}" id="result-panel" role="tabpanel" aria-labelledby="result-tab-${player.id}">
        <div class="result-player-head"><span class="rank">${String(rank).padStart(2, '0')}</span>${avatarMarkup(player, 'result-avatar')}
          <div>
            <h2>${player.name}${player.id === 0 ? ' <small>あなた</small>' : ''}</h2><span>${player.title}</span>
          </div>
          <div class="result-score"><strong>${score.total}</strong><span>${master?.playerId === player.id ? 'PTS · 特殊勝利' : 'PTS'}</span></div>
        </div>
        <div class="result-hand">${player.hand
          .map(
            (card) => `<div class="hand-card-slot">${cardMarkup(card, { compact: true })}${inspectButton(card)}</div>`,
          )
          .join('')}</div>
        <div class="result-details">${
          rules().id === 'rookie'
            ? `<span>車 ${score.vehiclePoints}</span><span>色ボーナス ${score.attributePoints + score.rolePoints}</span>`
            : `<span>車種 ${score.vehiclePoints}</span><span>属性 ${score.attributePoints}</span><span>サポート ${score.supportPoints}</span><span>役 ${score.rolePoints}</span>`
        }
          <p>${escape(score.groups.map((group) => `${group.name} ×${group.count}`).join(' / ') || '車種の組なし')}${score.attribute ? ` · ${escape(score.attribute.label)}` : ''}${score.support ? ` · ${escape(score.support.name)}` : ''}${score.role ? ` · 役：${escape(score.role.name)}` : ''}${score.delivered ? ` · 納車：${escape(deliveredLabel(score.delivered))}` : ''}</p>
        </div>
      </article>
    </section>
  `;
}

// The hand a high score was made with, as small cards in the order it was held.
function scoreHandMarkup(entry) {
  const hand = recordedHand(entry);
  return hand
    ? markup`
      <div class="score-hand" role="group" style="--hand-count:${hand.length}" aria-label="最後の手札 ${hand.length}枚">${hand
        .map((card) => cardMarkup(card, { compact: true, thumb: true }))
        .join('')}</div>
    `
    : '';
}

// Standings after each race: points by round, totals, and what the final race brings.
function grandPrixMarkup() {
  if (!grandPrix) return '<p>グランプリの記録がありません。</p>';
  const rows = grandPrixStandings(grandPrix);
  const done = grandPrix.races.length;
  const over = isGrandPrixOver(grandPrix);
  const champions = rows.filter((row) => row.rank === 1);
  const orders = dealerOrderSeats(grandPrix);
  const name = (id) => (id === 0 ? 'あなた' : game.players[id].name);
  const rounds = Array.from({ length: GRAND_PRIX_ROUNDS }, (_, index) => index + 1);
  return markup`
    <p class="dialog-lead gp-lead">${
      over
        ? `全${GRAND_PRIX_ROUNDS}戦終了。チャンピオンは${champions.map((row) => name(row.playerId)).join('・')}（${champions[0].total}点）`
        : `ROUND ${done} / ${GRAND_PRIX_ROUNDS} 終了。合計点でチャンピオンを決めます。`
    }</p>${
      over
        ? markup`
          <div class="gp-champion">${champions.map((row) => avatarMarkup(game.players[row.playerId], 'gp-avatar')).join('')}<div><span class="eyebrow">GRAND PRIX CHAMPION</span><strong>${champions.map((row) => escape(game.players[row.playerId].name)).join(' · ')}</strong></div></div>
        `
        : ''
    }
    <div class="table-scroll">
      <table class="gp-table">
        <thead>
          <tr><th>順位</th><th>ドライバー</th>${rounds.map((round) => `<th>R${round}</th>`).join('')}<th>合計</th></tr>
        </thead>
        <tbody>${rows
          .map(
            (row) =>
              markup`
                <tr class="${row.playerId === 0 ? 'mine' : ''}${over && row.rank === 1 ? ' champion' : ''}"><td>${row.rank}</td><th>${escape(game.players[row.playerId].name)}</th>${rounds
                  .map((round) => {
                    const race = grandPrix.races[round - 1];
                    if (!race) return '<td class="muted">−</td>';
                    return race.master === row.playerId
                      ? `<td class="gp-master" title="86 MASTER（${MASTER_POINTS}点）">${race.points[row.playerId]}</td>`
                      : `<td>${race.points[row.playerId]}</td>`;
                  })
                  .join('')}<td class="gp-total">${row.total}</td></tr>
              `,
          )
          .join('')}</tbody>
      </table>
    </div>${
      orders.length
        ? markup`
          <div class="gp-order-note">${cardMarkup({ id: 'order-note', type: 'order' }, { compact: true, thumb: true })}<p><strong>最終戦：${DEALER_ORDER.dealer}から、最下位の${orders.map(name).join('・')}へ${DEALER_ORDER.name}</strong>どの車にもなる1枚が、初期手札に入ります。</p></div>
        `
        : ''
    }
    <p class="muted">合計点で競います。86 MASTERは${MASTER_POINTS}点。先手は1戦ずつ交代し、全員が1回ずつ先手になります。</p>
    <div class="modal-actions">${
      over
        ? markup`
          <button class="secondary-button" data-action="scores">ハイスコア ↗</button>
          <button class="primary-button" data-action="new">新しい対戦 ↗</button>
        `
        : `<button class="primary-button" data-action="gp-next">ROUND ${nextRound(grandPrix)} スタート →</button>`
    }</div>
  `;
}

// Before the final race: the dealer order arrives, whoever it goes to.
function dealerOrderMarkup() {
  const seats = game.options.dealerOrder || [];
  const names = seats.map((id) => (id === 0 ? 'あなた' : game.players[id].name)).join('・');
  return markup`
    <div class="dealer-order-intro">${cardMarkup({ id: 'order-intro', type: 'order' })}
      <div><span class="eyebrow">FINAL ROUND · SPECIAL ORDER</span>
        <p class="dialog-lead">最下位の${escape(names)}へ、${DEALER_ORDER.name}が届きました。</p>
        <p>${DEALER_ORDER.description}</p>
        <p class="muted">3戦を終えて合計点がいちばん低いドライバーに届きます（同点なら全員）。</p>
        <div class="modal-actions"><button class="primary-button" data-action="close-modal">最終戦スタート →</button></div>
      </div>
    </div>
  `;
}

// Top five of one mode, with dates in JST so each score can be placed in time.
function scoresMarkup() {
  const top = topScores(highScores, scoresMode);
  const latest = lastScoreEntry?.mode === scoresMode ? lastScoreEntry : null;
  const position = latest && scorePosition(highScores, latest);
  const result = (entry) =>
    entry.mode === 'grandprix'
      ? entry.rank === 1
        ? 'チャンピオン'
        : `総合${entry.rank}位`
      : entry.master
        ? '86 MASTER'
        : entry.rank === 1
          ? '優勝'
          : `${entry.rank}位`;
  const labels = { standard: 'スタンダード', grandprix: 'グランプリ', rookie: 'ルーキー' };
  return markup`
    <div class="score-modes" role="tablist" aria-label="モード">${['standard', 'grandprix', 'rookie']
      .map(
        (mode) =>
          `<button role="tab" aria-selected="${mode === scoresMode}" class="${mode === scoresMode ? 'active' : ''}" data-action="scores-mode" data-mode="${mode}">${labels[mode]}</button>`,
      )
      .join('')}</div>${
      top.length
        ? markup`
          <ol class="score-list">${top
            .map(
              (entry, index) =>
                markup`
                  <li class="${entry.id === latest?.id ? 'latest' : ''}"><span class="score-rank">${index + 1}</span><strong>${entry.score}<small>点</small></strong>
                    <span class="score-result">${result(entry)}${
                      entry.role ? `<small class="score-role">役：${escape(entry.role)}</small>` : ''
                    }</span><time datetime="${escape(entry.at)}">${formatJst(entry.at)}</time>${
                      entry.id === latest?.id ? '<em>今回</em>' : ''
                    }${scoreHandMarkup(entry)}
                  </li>
                `,
            )
            .join('')}</ol>
        `
        : '<p class="muted">まだ記録がありません。最後まで遊ぶと記録されます。</p>'
    }${
      latest && position > 5
        ? `<p class="score-latest">今回は ${latest.score}点（${position}位）${latest.role ? `· 役：${escape(latest.role)} ` : ''}· ${formatJst(latest.at)}</p>`
        : ''
    }
    <p class="muted">日時は日本時間（JST）。この端末のブラウザに保存しています。おまかせで完走した対戦は記録しません。</p>
  `;
}

// Rookie rules in short sentences for younger players.
function rookieRulesMarkup() {
  const laps = rules().turnsPerPlayer;
  return markup`
    <p class="dialog-lead">手札は5枚。同じ車をそろえて、3人のCPUより高い点数をめざそう！</p>
    <ol class="rules-steps">
      <li>自分の番がきたら、山札から1枚ひくか、前の人がすてたカードを1枚ひろいます。</li>
      <li>6枚から1枚すてて、5枚にもどします。ひろったカードは、その番にはすてられません。</li>
      <li>みんなが${laps}回ずつ（${laps}周）やったら終わり。点数がいちばん高い人の勝ちです。</li>
    </ol>
    <h3>点数のきまり</h3>
    <p>同じ車を2枚以上そろえると点数になります。ちがう車の組も足し算します。</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>同じ車</th><th>2枚</th><th>3枚</th><th>4枚</th><th>5枚</th></tr>
        </thead>
        <tbody>
          <tr><th>点数</th><td>20</td><td>60</td><td>120</td><td>200</td></tr>
        </tbody>
      </table>
    </div>
    <p>カードの右下の「×1.5」「×2.5」はキラキラカードのしるし。そろえると点数がその倍になります。</p>
    <h3>色のボーナス（いちばん高い1つだけ）</h3>
    <div class="table-scroll">
      <table>
        <tbody>
          <tr><th>同じ色の車が4枚</th><td>+${ROOKIE_BONUSES.color4}</td></tr>
          <tr><th>フルペイント（5枚ぜんぶ同じ色）</th><td>+${ROOKIE_BONUSES.fullpaint}</td></tr>
          <tr><th>レインボー（5枚ぜんぶちがう色・ちがう車）</th><td>+${ROOKIE_BONUSES.rainbow}</td></tr>
        </tbody>
      </table>
    </div>
    <h3>とくべつな勝ち · 86 MASTER</h3>
    <p>86 GTを5枚そろえたら、点数に関係なくその場で勝ち！</p>
    <div class="rule-callout">ルーキーには、サポートカード・ブロックライン・ファイナルラップはありません。CPUも少しやさしめです。なれてきたら「新しい対戦」でスタンダードにちょうせんしよう。</div>
  `;
}

function rulesMarkup() {
  if (rules().id === 'rookie') return rookieRulesMarkup();
  return markup`
    <p class="dialog-lead">7枚のガレージを育てて、3人のCPUより高得点を目指します。</p>
    <ol class="rules-steps">
      <li>山札から1枚引くか、直前の捨て札1枚を拾います。</li>
      <li>8枚から1枚捨てて、手札を7枚に戻します。拾ったカードはその手番に捨てられません。</li>
      <li>山札が尽き、最後の人が捨て終えたら全員で得点を比較。同点なら共同勝利です。</li>
    </ol>
    <div class="rule-callout">捨て札を拾った手番も、山札から1枚を公開して除外します。通常は全員15手番ずつ。ファイナルラップ宣言があると早期終了します。</div>
    <h3>特殊役 · 86 MASTER</h3>
    <p>86 GTだけで手札7枚を揃えると、通常得点より優先する特殊勝利で即終了します。色・セッティングは不問。捨て札を確定して7枚に戻した時に自動判定し、取得直後の8枚・9枚では判定しません。</p>
    <p>LAPや山札残数の条件はなく、初期配札でも成立します。ファイナルラップ中も有効で、残りの人は行動せず決着。CPUも同じ条件です。86は全8枚なので、2枚が取得不能になると成立できません。</p>
    <h3>ファイナルラップ</h3>
    <p>残り8 LAP（LAP 08）以降、取得後の山札が12枚以上あり、捨てた後の7枚が宣言ラインに届けば、捨てるときに宣言できます。宣言ラインはLAP 08の300点から毎LAP25点ずつ下がります（LAP 09は275点、LAP 10は250点…）。手札と点数を公開・固定し、宣言者の行動は終了。宣言自体の加点はありません。</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>LAP</th>${DECLARE_LAPS.map((lap) => `<th>${String(lap).padStart(2, '0')}</th>`).join('')}</tr>
        </thead>
        <tbody>
          <tr><th>宣言ライン</th>${DECLARE_LAPS.map((lap) => `<td>${finalLapTarget(lap)}</td>`).join('')}</tr>
        </tbody>
      </table>
    </div>
    <p>山札12枚の条件があるため、宣言できるのは実質LAP 12までです。</p>
    <p>ほかの3人は順に2周、1人2手番ずつ。各手番で山札2枚、または捨て札1枚＋山札1枚を取り、9枚から2枚を捨てます。拾った札は同じ手番では捨てられません。拾う場合は通常どおり山札1枚を公開除外します。</p>
    <p>捨てる2枚のうち、次の人が拾える1枚を選びます。もう1枚は公開記録へ移り、拾えません。ブロックラインは渡す1枚に使用できます。最後の手番が終わったら残り山札に関係なく採点し、同点は共同勝利です。</p>
    <h3>得点は「車種 ＋ 属性1つ ＋ サポート1枚 ＋ 役1つ」</h3>
    <p>途中の点数は累積しません。最後の7枚だけを採点します。</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>同じ車種</th><th>2枚</th><th>3枚</th><th>4枚</th><th>5枚</th><th>6枚</th><th>7枚</th></tr>
        </thead>
        <tbody>
          <tr><th>基本点</th><td>20</td><td>60</td><td>120</td><td>200</td><td>300</td><td>420</td></tr>
        </tbody>
      </table>
    </div>
    <p>車種ごとに C ×1 / R ×1.5 / SR ×2.5。別車種の組は合算します。色・セッティングが違っても同じ車種として数えます。</p>
    <table>
      <thead>
        <tr><th>同じ属性</th><th>4枚</th><th>5枚</th><th>6枚</th><th>7枚</th></tr>
      </thead>
      <tbody>
        <tr><th>色</th>${COLOR_POINTS.slice(4)
          .map((points) => `<td>${points}</td>`)
          .join('')}</tr>
        <tr><th>メーカー</th>${MAKER_POINTS.slice(4)
          .map((points) => `<td>${points}</td>`)
          .join('')}</tr>
      </tbody>
    </table>
    <p>属性は最も高いボーナス1つだけ。国には得点を付けません。</p>
    <h3>役ボーナス</h3>
    <p>次の役のうち、成立した最高点の1つだけを加点します。属性・サポートとは別に加わります。</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>役</th><th>条件</th><th>加点</th></tr>
        </thead>
        <tbody>${ROLES.map((role) => `<tr><th>${escape(role.name)}</th><td>${escape(role.condition)}</td><td>+${role.points}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <p>フルペイントは色の属性点（7枚同色で150点）に上乗せします。フルペイントとレインボーは車7枚が条件なので、サポートを持つと成立しません。スーパーカー・ガレージ・ワールドツアー・ショールームはサポートを持っていても成立します。</p>
    <h3>サポート</h3>
    <p>手札の1枠を使います。条件を満たす中で最も高い1枚だけが有効です。サポート自体は車の枚数に含みません。</p>${SUPPORTS.map(
      (support) => `<div class="rule-support"><strong>${support.name}</strong><p>${support.description}</p></div>`,
    ).join('')}
    <h3>ブロックライン</h3>
    <p>各人1回だけ、自分の捨て札を公開除外して、次の相手に拾わせないようにできます。相手は山札から通常どおり引けます。7枚の手札には含まれません。</p>
    <h3>グランプリ</h3>
    <p>スタンダードを${GRAND_PRIX_ROUNDS}戦続けて、合計点でチャンピオンを決めます。「新しい対戦」でグランプリを選びます。</p>
    <ul>
      <li>各レースの得点をそのまま足します。86 MASTERは${MASTER_POINTS}点として数えます。</li>
      <li>先手は1戦ずつ交代し、全員が1回ずつ先手になります。</li>
      <li>最終戦の前に、合計点がいちばん低いドライバー（同点なら全員）へ、${DEALER_ORDER.dealer}から「${DEALER_ORDER.name}」が届きます。初期手札の1枚がこのカードになります。</li>
    </ul>
    <div class="rule-support"><strong>${DEALER_ORDER.name}</strong><p>${DEALER_ORDER.description}</p></div>
    <p class="muted">配点・セッティングは試作用の設定です。実車の性能順位や純正仕様を示すものではありません。</p>
  `;
}

function inspectButton(card) {
  return markup`
    <button class="card-inspect" data-action="inspect-card" data-card-id="${card.id}" aria-label="${escape(cardName(card))}のカードを拡大"><span class="inspect-word">拡大 </span>↗</button>
  `;
}

function catalogTile(card, subtitle) {
  const art = cardArt(card);
  return markup`
    <button class="catalog-car" data-action="inspect-card" data-card-id="${card.id}"><span class="catalog-thumb">
      <img src="${art.thumb}" alt="" loading="lazy" width="1024" height="1536">${multiplierLabelMarkup(card)}${supportValueLabelMarkup(card)}</span>
      <span><strong>${escape(cardName(card))}</strong><small>${escape(subtitle)}</small><span class="catalog-open">絵柄・詳細を見る ↗</span></span>
    </button>
  `;
}

function catalogMarkup() {
  const availability = publicAvailability(game);
  return markup`
    <p class="dialog-lead">車12種類・80枚 ＋ サポート4種類・8枚。計88枚。</p>
    <p>車種を選ぶと、実際のデッキにある色違いを確認できます。未確認は山札と相手の未公開札の合計です。公開拾得が残っている分は差し引きます。</p>
    <div class="table-scroll">
      <table class="catalog-table">
        <thead>
          <tr><th>車種・デザイン</th><th>メーカー</th><th>レア度</th><th>総数</th><th>自分</th><th>未確認</th></tr>
        </thead>
        <tbody>${MODELS.map(
          (model) =>
            markup`
              <tr><td>${catalogTile(
                cardPool.find((card) => card.modelId === model.id),
                `${model.generation} · ${model.country}`,
              )}</td><td>${model.makerJa}</td><td>${badge(model.rarity, model.rarity.toLowerCase())}</td>
                <td>${model.count}</td><td>${game.players[0].hand.filter((card) => card.modelId === model.id).length}</td>
                <td>${game.phase === 'finished' ? 0 : availability[model.id].unseen}</td>
              </tr>
            `,
        ).join('')}</tbody>
      </table>
    </div>
    <h3>サポートは各2枚</h3>
    <div class="catalog-supports">${SUPPORTS.map(
      (support) =>
        markup`
          <div class="rule-support">${catalogTile(
            cardPool.find((card) => card.supportId === support.id),
            `SUPPORT · 最大 +${support.max} PTS`,
          )}
            <p>${support.description}</p>
          </div>
        `,
    ).join('')}</div>
    <p class="muted">赤・青・白・黒・黄の車は各16枚。セッティングはコーナー27枚・加速27枚・安定26枚です。</p>
    <a class="catalog-collection" href="cards.html" target="_blank" rel="noopener">原画コレクションを開く ↗</a>
  `;
}

// A dealer order is only in a hand; it explains itself and names the car it is scored as.
function orderInspectorMarkup(card) {
  const owner = game.players.find((player) => player.hand.some((owned) => owned.id === card.id));
  const visible = owner && (owner.id === 0 || game.phase === 'finished' || owner.id === game.finalLap?.declarer);
  const hand = owner?.id === 0 && game.currentPlayer === 0 && game.phase === 'discard' ? previewHand() : owner?.hand;
  const delivered = visible && scoreOf(hand).delivered;
  return markup`
    <div class="inspector-layout">
      <div class="inspector-card">${cardMarkup(card)}</div>
      <div class="inspector-details"><span class="eyebrow">WORLD CAR DEALER / SPECIAL</span>
        <h3>${DEALER_ORDER.name}</h3>
        <p class="inspector-current">${
          delivered
            ? `${game.phase === 'finished' ? '納車' : '今なら'}：${escape(deliveredLabel(delivered))}`
            : `${owner ? escape(owner.name) + 'の' : ''}どの車にもなる1枚`
        }</p>
        <p>${DEALER_ORDER.description}</p>
        <p class="muted">グランプリの最終戦の前に、${DEALER_ORDER.dealer}から最下位のドライバーへ届きます。</p>
      </div>
    </div>
  `;
}

function inspectorMarkup() {
  const order = game.players.flatMap((player) => player.hand).find((owned) => owned.id === inspectedId);
  if (order?.type === 'order') return orderInspectorMarkup(order);
  const card = cardPool.find((candidate) => candidate.id === inspectedId);
  if (!card) return '<p>カードが見つかりません。</p>';
  const support = card.type === 'support';
  const data = support ? SUPPORT_BY_ID[card.supportId] : MODEL_BY_ID[card.modelId];
  // Only the player's own hand (or a revealed final hand) supplies contextual support scores.
  const owner = game.players.find(
    (player) =>
      (player.id === 0 || game.phase === 'finished' || player.id === game.finalLap?.declarer) &&
      player.hand.some((owned) => owned.id === card.id),
  );
  const scoringHand =
    owner?.id === 0 && game.currentPlayer === 0 && game.phase === 'discard' ? previewHand() : owner?.hand;
  const state = scoringHand && scoreOf(scoringHand).supports.find((part) => part.cardId === card.id);
  const variants = [
    ...new Map(
      cardPool
        .filter((candidate) => candidate.type === 'vehicle' && candidate.modelId === card.modelId)
        .map((candidate) => [candidate.colorId, candidate]),
    ).values(),
  ];
  return markup`
    ${
      inspectionReturn
        ? '<button class="text-button inspector-back" data-action="inspect-back">← カード一覧に戻る</button>'
        : ''
    }
    <div class="inspector-layout">
      <div class="inspector-card">${cardMarkup(card, { supportState: state, supportLabel: owner && !state ? '採点対象外' : undefined })}</div>
      <div class="inspector-details"><span class="eyebrow">${support ? 'TUNING PARTS' : `${data.rarity} / GARAGE COLLECTION`}</span>
        <h3>${escape(data.name)}</h3>${
          support
            ? markup`
              <p class="inspector-current">${state ? `この手札で ＋${state.points}点` : owner ? '採点対象外' : `最大 ＋${data.max}点`}</p>
              <p>${data.description}</p>
              <div class="support-ladder">${data.levels
                .map(
                  (level) =>
                    markup`
                      <span>${level.count}${card.supportId === 'tires' ? '車種' : card.supportId === 'ecu' ? '組' : '枚'}
                      <b>+${level.points}</b></span>
                    `,
                )
                .join('')}</div>
              <p class="muted">条件を満たすサポートのうち最高点の1枚だけが有効です。</p>
            `
            : markup`
              <dl>
                <div><dt>メーカー</dt><dd>${data.makerJa}</dd></div>
                <div><dt>型式</dt><dd>${data.generation}</dd></div>
                <div><dt>車体色</dt><dd>${COLOR_BY_ID[card.colorId].name}</dd></div>
                <div><dt>セッティング</dt><dd>${settingIconMarkup(card.settingId)}${SETTING_BY_ID[card.settingId].name}</dd></div>
                <div><dt>車種の倍率</dt><dd>×${data.multiplier}</dd></div>
              </dl>${
                inspectionReturn
                  ? markup`
                    <p>デッキにあるカラー</p>
                    <div class="inspector-variants">${variants
                      .map(
                        (variant) =>
                          markup`
                            <button data-action="inspect-color" data-card-id="${variant.id}" aria-pressed="${variant.colorId === card.colorId}">
                              <i style="background:${COLOR_BY_ID[variant.colorId].hex}"></i>${COLOR_BY_ID[variant.colorId].name}
                            </button>
                          `,
                      )
                      .join('')}</div>
                    <p class="muted">各色の代表カードを表示しています。同じ車種・色でもセッティングが異なる札があります。</p>
                  `
                  : '<p class="muted">実際のカードの属性を表示しています。同じ車種なら、色やセッティングが違っても車種の組になります。</p>'
              }
            `
        }
      </div>
    </div>
  `;
}

function historyMarkup() {
  const tabs = [
    ['log', '行動ログ'],
    ['discard', `過去の捨て札 ${game.archive.length}`],
    ['removed', `公開除外 ${game.removed.length}`],
  ];
  const navigation = markup`
    <div class="dialog-tabs" role="tablist">${tabs
      .map(
        ([id, name]) =>
          markup`
            <button role="tab" aria-selected="${id === historyTab}" data-action="history-tab" data-tab="${id}" class="${id === historyTab ? 'active' : ''}">${name}</button>
          `,
      )
      .join('')}</div>
  `;
  if (historyTab === 'log')
    return markup`
      ${navigation}
      <div class="history-list">${game.history
        .slice()
        .reverse()
        .map(
          (event) =>
            markup`
              <div class="history-event ${event.type}"><span>${(Math.floor(event.turn / 4) + 1).toString().padStart(2, '0')}</span>
                <p>${escape(event.text)}</p>
              </div>
            `,
        )
        .join('')}</div>
    `;
  const entries = historyTab === 'removed' ? game.removed : game.archive;
  return markup`
    ${navigation}
    <p class="muted">この一覧のカードは拾えません。現在のカードの所在で集計しています。</p>${
      entries.length
        ? markup`
          <div class="history-card-grid">${entries
            .slice()
            .reverse()
            .map(
              (entry) =>
                markup`
                  <div>${cardMarkup(entry.card, { compact: true, thumb: true })}<span class="history-card-label">${game.players[entry.by].name} · ${entry.reason === 'block' ? 'ブロック' : entry.reason === 'pickup' ? '山札から除外' : '捨て札'}</span></div>
                `,
            )
            .join('')}</div>
        `
        : '<div class="empty-state">まだカードはありません。</div>'
    }
  `;
}

// What a role still needs, in the words of its condition.
function roleGoalLabel(goal) {
  const colors = (goal.colors || []).map((id) => COLOR_BY_ID[id].name).join('・');
  if (goal.id === 'fullpaint') return `フルペイント：${colors}の車をあと${goal.needed}枚`;
  if (goal.id === 'rainbow') return `レインボー：あと${goal.needed}枚${colors ? `（${colors}）` : '（車種を増やす）'}`;
  if (goal.id === 'showroom') return `ショールーム：${MODEL_BY_ID[goal.model].name}の${colors}をあと${goal.needed}枚`;
  if (goal.id === 'supercar')
    return `スーパーカー・ガレージ：${goal.models.map((model) => `${MODEL_BY_ID[model.id].name}をあと${model.needed}枚`).join('・')}`;
  return `ワールドツアー：${goal.countries.length ? `${goal.countries.join('・')}の車` : ''}${goal.countries.length && goal.needed > goal.countries.length ? '＋' : ''}${goal.needed > goal.countries.length ? 'ペア1組' : ''}`;
}

// Where a revealed 7-card hand's points come from.
function breakdownMarkup(score) {
  const rows = [
    ...score.groups.map((group) => [`${group.name} ×${group.count}`, group.points]),
    ...(score.attribute ? [[score.attribute.label, score.attribute.points]] : []),
    ...(score.support ? [[`${score.support.name}（${score.support.detail}）`, score.support.points]] : []),
    ...(score.role ? [[`役 · ${score.role.name}`, score.role.points]] : []),
  ];
  return markup`
    <ul class="revealed-breakdown">${
      rows.length
        ? rows.map(([label, points]) => `<li><span>${escape(label)}</span><strong>${points}</strong></li>`).join('')
        : '<li class="muted"><span>加点なし</span><strong>0</strong></li>'
    }${
      score.delivered
        ? `<li class="delivered-row"><span>${DEALER_ORDER.name} → ${escape(deliveredLabel(score.delivered))}</span><strong>納車</strong></li>`
        : ''
    }
      <li class="total"><span>合計</span><strong>${score.total}</strong></li>
    </ul>
  `;
}

function finalHandMarkup() {
  if (!game.finalLap) return '';
  const final = game.finalLap;
  const myTurns = game.finalLap.remaining.filter((id) => id === 0).length;
  return markup`
    <p class="dialog-lead declarer-lead">${avatarMarkup(game.players[final.declarer], 'lead-avatar')}${game.players[final.declarer].name}が ${final.score}点で宣言</p>${
      game.phase !== 'finished' && final.declarer !== 0
        ? `<p class="final-goal">${myTurns ? `あなたの残り ${myTurns}手番で ${final.score}点を上回れば逆転です。` : 'あなたの手番は終わりました。'}</p>`
        : ''
    }
    <p>この7枚で固定。${
      game.masterVictory
        ? '86 MASTERが成立し、残りの手番を打ち切って決着しました。'
        : game.phase === 'finished'
          ? '全員が最後の手番を終えて決着しました。'
          : `残り${final.remaining.length}手番を終えると決着します。`
    }</p>
    <div class="revealed-hand">${final.hand.map((card) => `<div>${cardMarkup(card, { compact: true, thumb: true })}${inspectButton(card)}</div>`).join('')}</div>
    ${breakdownMarkup(scoreOf(final.hand))}
  `;
}

// Gold sparks for the celebration: fixed positions, so every render draws the same scene.
const MASTER_SPARKS = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  delay: ((i * 7) % 18) / 6,
  duration: 4 + ((i * 5) % 7) / 2,
  size: 3 + (i % 4),
}));

// Full-screen 86 MASTER celebration over the results: key art, title and the winning hand.
function masterShowMarkup() {
  const master = game.masterVictory;
  const winner = game.players[master.playerId];
  const mine = master.playerId === 0;
  const hand = sortHand(winner.hand, 'model');
  return markup`
    <dialog class="master-show ${mine ? 'mine' : 'rival'}" aria-labelledby="master-show-title" aria-describedby="master-show-note">
      <picture class="master-show-art" aria-hidden="true">
        <source media="(orientation: portrait)" srcset="assets/effects/master-tall.jpg"><img src="assets/effects/master-wide.jpg" alt="" decoding="async">
      </picture><span class="master-show-shade" aria-hidden="true"></span><span class="master-show-rays" aria-hidden="true"></span>
      <span class="master-show-sparks" aria-hidden="true">${MASTER_SPARKS.map(
        (spark) =>
          `<i style="--x:${spark.x}%;--delay:${spark.delay}s;--duration:${spark.duration}s;--size:${spark.size}px"></i>`,
      ).join('')}</span>
      <div class="master-show-content">
        <div class="master-show-head">
          <p class="master-show-eyebrow">SPECIAL VICTORY · ${escape(winner.name)}</p>
          <h2 id="master-show-title"><span class="master-show-86">86</span><span class="master-show-word">MASTER</span></h2>
          <p id="master-show-note"><span>${mine ? 'あなた' : escape(winner.name)}が86 GTを${hand.length}枚そろえました。</span><span>得点に関係なく即フィニッシュ！</span></p>
        </div>
        <div class="master-show-foot">
          <div class="master-show-cards" style="--count:${hand.length}">${hand
            .map(
              (card, index) =>
                `<div class="master-show-card" style="--i:${index};--tilt:${(index - (hand.length - 1) / 2) * 4}deg;--lift:${(index - (hand.length - 1) / 2) ** 2 * 2}px">${cardMarkup(card, { compact: true, thumb: true })}</div>`,
            )
            .join('')}</div>
          <button class="primary-button master-show-close" data-action="close-modal">${afterMaster === 'grand-prix' ? '総合順位を見る →' : afterMaster === 'scores' ? 'ハイスコアを見る →' : '結果を見る →'}</button>
        </div>
      </div>
    </dialog>
  `;
}

function modalMarkup(score, before, preview) {
  if (!modal) return '';
  if (modal === 'master') return game.masterVictory ? masterShowMarkup() : '';
  const titles = {
    rules: '遊び方・配点',
    catalog: 'カード一覧',
    history: '対戦の記録',
    new: '新しい対戦',
    playtest: '試遊の設定',
    scores: 'ハイスコア',
    intel: '相手の公開情報',
    inspect: 'カードの詳細',
    strategy: '得点の内訳・戦略メモ',
    'final-hand': 'ファイナルラップ · 公開手札',
    'grand-prix': 'グランプリ · 総合順位',
    'dealer-order': DEALER_ORDER.dealer,
  };
  let body = '';
  if (modal === 'final-hand') body = finalHandMarkup();
  if (modal === 'rules') body = rulesMarkup();
  if (modal === 'catalog') body = catalogMarkup();
  if (modal === 'history') body = historyMarkup();
  if (modal === 'intel') body = intelMarkup();
  if (modal === 'strategy') body = scoreMarkup(score, before, preview, true) + strategyMarkup(score, preview);
  if (modal === 'inspect') body = inspectorMarkup();
  if (modal === 'new')
    body = markup`
      <p class="dialog-lead">新しい配札で対戦を始めます。</p>${game.phase !== 'finished' ? '<p>現在の対戦は終了します。記録を残す場合は先に保存してください。</p>' : ''}${
        inGrandPrix() && !isGrandPrixOver(grandPrix)
          ? `<p>進行中のグランプリ（ROUND ${game.options.grandPrix.round}/${GRAND_PRIX_ROUNDS}）も終了します。</p>`
          : ''
      }
      <fieldset class="mode-choice"><legend>モード</legend>
        <label class="form-check"><input type="radio" name="new-mode" value="standard" ${!['rookie', 'grandprix'].includes(prefs.mode) ? 'checked' : ''}> スタンダード <small>手札7枚・サポート・ファイナルラップあり</small></label>
        <label class="form-check"><input type="radio" name="new-mode" value="grandprix" ${prefs.mode === 'grandprix' ? 'checked' : ''}> グランプリ <small>スタンダード${GRAND_PRIX_ROUNDS}戦の合計点でチャンピオンを決める</small></label>
        <label class="form-check"><input type="radio" name="new-mode" value="rookie" ${prefs.mode === 'rookie' ? 'checked' : ''}> ルーキー <small>手札5枚・車だけ・8周で点数くらべ</small></label>
      </fieldset>
      <label class="seed-field">配札コード <span>空欄ならランダム</span><input id="new-seed" type="text" maxlength="64" placeholder="同じ配札を再現するときに入力" autocomplete="off"></label>
      <label class="form-check"><input type="checkbox" id="new-blocks" ${prefs.blocks ? 'checked' : ''}> ブロックラインあり（全員1回・スタンダードのみ）</label>
      <div class="modal-actions">
        <button class="secondary-button" data-action="close-modal">戻る</button>
        <button class="primary-button" data-action="start-game">対戦をはじめる →</button>
      </div>
    `;
  if (modal === 'scores') body = scoresMarkup();
  if (modal === 'grand-prix') body = grandPrixMarkup();
  if (modal === 'dealer-order') body = dealerOrderMarkup();
  if (modal === 'playtest')
    body = markup`
      <p class="dialog-lead">同じ配札で比較したり、CPUの対戦を観察できます。</p>
      <button class="secondary-button" data-action="shine" aria-pressed="${prefs.shine}">カードの光沢 ${prefs.shine ? 'ON' : 'OFF'}</button>
      <label class="form-check"><input id="fast-setting" type="checkbox" ${prefs.fast ? 'checked' : ''}> CPUの進行を速くする</label>
      <label class="form-check"><input id="sound-setting" type="checkbox" ${prefs.sound ? 'checked' : ''}> 効果音（SE）</label>
      <label class="volume-setting">音量<input id="volume-setting" type="range" min="0" max="100" step="10" value="${Math.round(prefs.volume * 100)}" ${prefs.sound ? '' : 'disabled'} aria-label="効果音の音量"><span>${Math.round(prefs.volume * 100)}</span></label>
      <div class="rule-support"><strong>同じ配札で比較</strong>
        <p>現在の対戦をリセットし、同じ配札・引き順で始めます。ブロックラインの有無だけを変更できます。</p>
        <label class="form-check"><input id="replay-blocks" type="checkbox" ${game.options.blocks ? 'checked' : ''}> ブロックラインあり</label>
        <button class="secondary-button" data-action="compare-replay" ${inGrandPrix() ? 'disabled' : ''}>この条件で最初から</button>${
          inGrandPrix() ? '<p class="muted">グランプリ中は使えません。</p>' : ''
        }
      </div>
      <div class="rule-support"><strong>CPUに続きを任せる</strong>
        <p>あなたの手札もCPUが操作し、終了まで進めます。途中で自分の操作に戻せます。</p>
        <button class="secondary-button" data-action="auto-play" ${game.phase === 'finished' ? 'disabled' : ''}>おまかせで完走する →</button>
      </div>
      <button class="text-button" data-action="export">対戦記録を保存 ↓</button>
      <p class="muted">配札コード：${escape(game.seed)}</p>
    `;
  return markup`
    <dialog class="game-dialog" aria-labelledby="dialog-title">
      <div class="dialog-head">
        <h2 id="dialog-title">${titles[modal]}</h2>
        <button class="close-dialog" data-action="close-modal" aria-label="閉じる">×</button>
      </div>
      <div class="dialog-body">${body}</div>
    </dialog>
  `;
}

function render() {
  cancelHandDrag();
  clearTimeout(cpuTimer);
  const handScroll = app.querySelector('.hand-scroll')?.scrollLeft || 0;
  // A seat's discard list keeps its scroll while the CPUs play.
  const riverScroll = [...app.querySelectorAll('.opponent .cpu-discards')].map((river) => river.scrollTop);
  const focused = document.activeElement;
  const focusSelector = focused?.id
    ? `#${CSS.escape(focused.id)}`
    : focused?.dataset.action
      ? `[data-action="${CSS.escape(focused.dataset.action)}"]${focused.dataset.cardId ? `[data-card-id="${CSS.escape(focused.dataset.cardId)}"]` : ''}`
      : null;
  const me = game.players[0];
  const discardPhase = game.currentPlayer === 0 && game.phase === 'discard';
  const beforeHand = discardPhase ? me.hand.filter((card) => !acquiredIds(game).includes(card.id)) : me.hand;
  const before = scoreOf(beforeHand);
  const preview = !reorderMode && discardPhase && selectedIds.length === discardCount(game);
  const score = preview ? scoreOf(previewHand()) : before;
  const lap = currentLap(game);
  app.classList.toggle('shine-off', !prefs.shine);
  app.innerHTML = markup`
    ${headerMarkup()}
    <main class="${game.phase === 'finished' ? 'finished' : 'playing'}${rules().id === 'rookie' ? ' rookie' : ''}">
      <div class="match-bar">
        <div><span class="match-state ${game.currentPlayer === 0 ? 'your-turn' : ''}">${
          game.phase === 'finished'
            ? '対戦終了'
            : autoPlay
              ? '観戦中'
              : game.currentPlayer === 0
                ? 'あなたの手番'
                : 'CPUの手番'
        }</span><span class="lap-label">LAP <strong>${String(lap).padStart(2, '0')}</strong> / ${rules().turnsPerPlayer}</span></div>${finalLapMarkup()}
        <div class="match-controls">
          <button class="text-button" data-action="shine" aria-pressed="${prefs.shine}">光沢 ${prefs.shine ? 'ON' : 'OFF'}</button>
          <button class="text-button" data-action="sound" aria-pressed="${prefs.sound}">SE ${prefs.sound ? 'ON' : 'OFF'}</button>
          <button class="text-button" data-action="speed">CPU ${prefs.fast ? '高速' : '標準'}</button>
          <button class="text-button" data-action="playtest">試遊の設定 ↗</button>
        </div>
      </div>${
        game.phase === 'finished'
          ? resultsMarkup()
          : arenaMarkup(score, before, preview) +
            handMarkup(score) +
            strategySummaryMarkup(score) +
            dockMarkup(score, before)
      }
    </main>${modalMarkup(score, before, preview)}
  `;
  if (app.querySelector('.hand-scroll')) app.querySelector('.hand-scroll').scrollLeft = handScroll;
  app
    .querySelectorAll('.opponent .cpu-discards')
    .forEach((river, index) => (river.scrollTop = riverScroll[index] || 0));
  if (modal) {
    const dialog = app.querySelector('dialog');
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeModal();
    });
    dialog.showModal();
    if (focusSelector) dialog.querySelector(focusSelector)?.focus({ preventScroll: true });
  } else {
    if (focusSelector) app.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  scheduleCpu();
}

// Sounds for what changed: the new history entries, plus turn, lap and result cues.
function soundsFor(previous, next) {
  if (next.seed !== previous.seed || next.history.length < previous.history.length) return [];
  const cues = [];
  for (const event of next.history.slice(previous.history.length)) {
    const mine = event.actor === 0;
    if (event.type === 'draw' && mine) cues.push(['draw']);
    // CPU sounds come from their seat's side of the screen.
    const seat = { seat: event.actor };
    if (event.type === 'pickup') cues.push(mine ? ['pickup'] : ['cpuPickup', seat]);
    if (event.type === 'discard') cues.push(mine ? ['discard'] : ['cpuDiscard', seat]);
    if (event.type === 'block') cues.push(['block']);
    if (event.type === 'final-lap') cues.push(mine ? ['declare'] : ['cpuDeclare', seat]);
    if (event.type === '86-master') cues.push(['master', { count: rulesetOf(next).handSize }]);
  }
  if (
    previous.phase === 'discard' &&
    previous.currentPlayer === 0 &&
    next.players[0].turnsTaken > previous.players[0].turnsTaken
  ) {
    const before = scoreOf(previous.players[0].hand.filter((card) => !acquiredIds(previous).includes(card.id))).total;
    const delta = scoreOf(next.players[0].hand).total - before;
    if (delta > 0) cues.push(['scoreUp', { delta }]);
  }
  if (next.phase === 'finished' && previous.phase !== 'finished' && !next.masterVictory) {
    const rows = standings(next);
    const winners = rows.filter((row) => row.rank === 1);
    cues.push([!winners.some((row) => row.player.id === 0) ? 'lose' : winners.length > 1 ? 'tie' : 'win']);
  } else if (next.phase === 'draw' && next.currentPlayer === 0 && previous.currentPlayer !== 0) {
    const lastTurn = next.finalLap && next.finalLap.remaining.filter((id) => id === 0).length === 1;
    cues.push([
      lastTurn
        ? 'finalTurn'
        : currentLap(next) === FINAL_LAP_RULES.minimumLap && currentLap(previous) < FINAL_LAP_RULES.minimumLap
          ? 'lapUnlock'
          : 'turn',
    ]);
  }
  return cues.slice(0, 3);
}

function transition(next) {
  if (!autoPlay || next.phase === 'finished')
    soundsFor(game, next).forEach(([name, options], index) => playSound(name, options, index * 180));
  // A finished match the player played through (no hand-over to the CPU) enters the high scores.
  // A new match can also end at the deal (86 MASTER), so compare the seed as well.
  const masterArrived = Boolean(next.masterVictory) && (!game.masterVictory || game.seed !== next.seed);
  const finished = next.phase === 'finished' && (game.phase !== 'finished' || game.seed !== next.seed);
  let opens = null;
  if (finished && !next.assisted) {
    lastScoreEntry = scoreEntry(next, standings(next));
    highScores = addScore(highScores, lastScoreEntry);
    scoresMode = lastScoreEntry.mode;
    opens = 'scores';
  }
  // A Grand Prix race adds to the totals and opens the standings instead.
  if (finished && grandPrix && next.options.grandPrix?.id === grandPrix.id) {
    const recorded = grandPrix.races.length;
    grandPrix = recordRace({ ...grandPrix, assisted: grandPrix.assisted || Boolean(next.assisted) }, next);
    saveGrandPrix();
    if (grandPrix.races.length > recorded) {
      opens = 'grand-prix';
      if (isGrandPrixOver(grandPrix) && !grandPrix.assisted) {
        lastScoreEntry = grandPrixEntry(grandPrix, grandPrixStandings(grandPrix));
        highScores = addScore(highScores, lastScoreEntry);
        scoresMode = 'grandprix';
      }
    }
  }
  if (finished && !next.assisted)
    try {
      localStorage.setItem(SCORES_KEY, JSON.stringify(highScores));
    } catch {}
  // Whoever completes it, 86 MASTER ends the match on a full-screen celebration.
  if (masterArrived) {
    modal = 'master';
    modalOpener = null;
    afterMaster = opens;
  } else if (opens && (!modal || opens === 'grand-prix')) {
    modal = opens;
    modalOpener = `[data-action="${opens}"]`;
  }
  // A CPU declaration pauses play on the revealed hand, so the new target cannot be missed.
  const declaredByCpu = !game.finalLap && next.finalLap && next.finalLap.declarer !== 0 && !autoPlay && !modal;
  game = next;
  if (declaredByCpu) {
    modal = 'final-hand';
    modalOpener = '[data-action="final-hand"]';
  }
  if (game.masterVictory) resultPlayerId = game.masterVictory.playerId;
  selectedId = null;
  selectedIds = [];
  finalLapArmed = false;
  blockArmed = false;
  notice = '';
  save();
  render();
}

function scheduleCpu() {
  if (modal || reorderMode || game.phase === 'finished' || (game.currentPlayer === 0 && !autoPlay)) return;
  cpuTimer = setTimeout(
    () => {
      try {
        const observation = getObservation(game);
        if (game.phase === 'draw') transition(acquireCard(game, chooseAcquisition(observation)));
        else {
          const choice = chooseDiscard(observation);
          transition(
            discardCard(game, choice.cardIds, shouldBlock(observation, choice.cardId), {
              offerId: choice.cardId,
              declareFinalLap: shouldDeclareFinalLap(observation, choice),
            }),
          );
        }
      } catch (error) {
        autoPlay = false;
        notice = error.message;
        console.error(error);
        render();
      }
    },
    prefs.fast ? 100 : game.phase === 'draw' ? 750 : 1050,
  );
}

function closeModal() {
  if (modal === 'master' && afterMaster) {
    modal = afterMaster;
    modalOpener = `[data-action="${afterMaster}"]`;
    afterMaster = null;
    render();
    return;
  }
  modal = null;
  inspectionReturn = null;
  render();
  if (modalOpener) app.querySelector(modalOpener)?.focus({ preventScroll: true });
  modalOpener = null;
}
// mode is 'standard', 'rookie' or 'grandprix' (four standard races).
function startGame(seed = freshSeed(), blocks = prefs.blocks, mode = rules().id) {
  prefs.blocks = blocks;
  prefs.mode = mode;
  if (mode === 'grandprix') {
    const starter = Math.floor(seededRandom(seed + ':grand-prix')() * 4);
    grandPrix = createGrandPrix(seed + '-' + Date.now().toString(36), starter, blocks);
    saveGrandPrix();
    startRace(seed);
    return;
  }
  grandPrix = null;
  saveGrandPrix();
  beginMatch(createGame(seed, { blocks, mode }));
}

// The next race of the Grand Prix; the final race may bring dealer orders.
function startRace(seed = freshSeed()) {
  const options = nextRaceOptions(grandPrix);
  beginMatch(createGame(seed, { blocks: grandPrix.blocks, ...options }), options.dealerOrder ? 'dealer-order' : null);
}

function beginMatch(next, opening = null) {
  autoPlay = false;
  modal = opening;
  modalOpener = null;
  afterMaster = null;
  resultPlayerId = 0;
  reorderMode = false;
  movingCardId = null;
  reorderMessage = '';
  handOrder = sortHand(next.players[0].hand, prefs.sort === 'manual' ? 'model' : prefs.sort).map((card) => card.id);
  transition(next);
}

function exportRecord() {
  const record = {
    version: 1,
    seed: game.seed,
    rules: 'prototype-0.4-86-master',
    masterVictory: game.masterVictory || null,
    blocks: game.options.blocks,
    // The race's place in its Grand Prix, and the series so far.
    grandPrix: inGrandPrix() ? { round: game.options.grandPrix.round, ...grandPrix } : null,
    dealerOrder: game.options.dealerOrder || null,
    completed: game.phase === 'finished',
    turn: game.turnNumber,
    history: game.history,
    result:
      game.phase === 'finished'
        ? standings(game).map(({ player, score, rank }) => ({ name: player.name, rank, score, hand: player.hand }))
        : null,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `86-master-${game.seed}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'reorder-hand') {
      if (reorderMode) {
        finishReordering();
        return;
      }
      if (autoPlay || game.phase === 'finished') return;
      handOrder = visibleHand().map((card) => card.id);
      prefs.sort = 'manual';
      reorderMode = true;
      movingCardId = null;
      reorderMessage = '';
      save();
      render();
      return;
    }
    if (action === 'finish-reorder') {
      finishReordering();
      return;
    }
    if (action === 'move-select') {
      selectMovingCard(button.dataset.cardId);
      return;
    }
    if (action === 'move-left' || action === 'move-right') {
      const index = visibleHand().findIndex((card) => card.id === movingCardId);
      if (index >= 0) moveVisibleCard(movingCardId, index + (action === 'move-left' ? -1 : 1));
      return;
    }
    if (
      !modal &&
      [
        'rules',
        'catalog',
        'history',
        'new',
        'playtest',
        'intel',
        'strategy',
        'final-hand',
        'scores',
        'inspect-card',
      ].includes(action)
    )
      modalOpener = `[data-action="${action}"]${button.dataset.cardId ? `[data-card-id="${button.dataset.cardId}"]` : ''}`;
    if (action === 'history-removed') {
      if (!modal) modalOpener = '[data-action="history-removed"]';
      historyTab = 'removed';
      modal = 'history';
      render();
      return;
    }
    if (
      [
        'rules',
        'catalog',
        'history',
        'new',
        'playtest',
        'intel',
        'strategy',
        'final-hand',
        'scores',
        'grand-prix',
      ].includes(action)
    ) {
      modal = action;
      render();
      return;
    }
    if (action === 'inspect-card') {
      inspectionReturn = modal === 'catalog' ? 'catalog' : null;
      inspectedId = button.dataset.cardId;
      modal = 'inspect';
      render();
      return;
    }
    if (action === 'inspect-color') {
      inspectedId = button.dataset.cardId;
      render();
      return;
    }
    if (action === 'inspect-back') {
      modal = inspectionReturn;
      inspectionReturn = null;
      render();
      return;
    }
    if (action === 'result-player') {
      resultPlayerId = Number(button.dataset.playerId);
      render();
      return;
    }
    if (action === 'sound') {
      prefs.sound = !prefs.sound;
      configureSound({ enabled: prefs.sound });
      save();
      playSound('turn');
      render();
      return;
    }
    if (action === 'shine') {
      prefs.shine = !prefs.shine;
      save();
      render();
      return;
    }
    if (action === 'close-modal') {
      closeModal();
      return;
    }
    if (action === 'scores-mode') {
      scoresMode = SCORE_MODES.includes(button.dataset.mode) ? button.dataset.mode : 'standard';
      render();
      return;
    }
    if (action === 'history-tab') {
      historyTab = button.dataset.tab;
      render();
      return;
    }
    if (action === 'speed') {
      prefs.fast = !prefs.fast;
      save();
      render();
      return;
    }
    if (action === 'start-game') {
      startGame(
        app.querySelector('#new-seed').value.trim() || freshSeed(),
        app.querySelector('#new-blocks').checked,
        app.querySelector('input[name="new-mode"]:checked')?.value || 'standard',
      );
      return;
    }
    if (action === 'gp-next') {
      if (inGrandPrix() && game.phase === 'finished' && !isGrandPrixOver(grandPrix)) startRace();
      return;
    }
    if (action === 'replay') {
      startGame(game.seed, game.options.blocks);
      return;
    }
    if (action === 'compare-replay') {
      startGame(game.seed, app.querySelector('#replay-blocks').checked);
      return;
    }
    if (action === 'auto-play') {
      autoPlay = true;
      // Matches finished by the CPU are not the player's own score.
      game.assisted = true;
      save();
      reorderMode = false;
      movingCardId = null;
      modal = null;
      selectedId = null;
      selectedIds = [];
      finalLapArmed = false;
      blockArmed = false;
      render();
      return;
    }
    if (action === 'stop-auto') {
      autoPlay = false;
      render();
      return;
    }
    if (action === 'export') {
      exportRecord();
      return;
    }
    if (game.currentPlayer !== 0 || autoPlay || reorderMode) return;
    if (action === 'draw') transition(acquireCard(game, 'deck'));
    if (action === 'pickup') transition(acquireCard(game, 'pickup'));
    if (action === 'select-card' && legalDiscards(game).some((card) => card.id === button.dataset.cardId)) {
      const id = button.dataset.cardId;
      playSound(selectedIds.includes(id) ? 'deselect' : 'select');
      if (selectedIds.includes(id)) selectedIds = selectedIds.filter((item) => item !== id);
      else selectedIds = [...selectedIds, id].slice(-discardCount(game));
      if (!selectedIds.includes(selectedId)) selectedId = selectedIds.at(-1) || null;
      if (discardCount(game) === 1) selectedId = selectedIds[0] || null;
      finalLapArmed = false;
      render();
    }
    if (action === 'offer-card' && selectedIds.includes(button.dataset.cardId)) {
      selectedId = button.dataset.cardId;
      render();
    }
    if (action === 'discard' && selectedIds.length === discardCount(game))
      transition(discardCard(game, selectedIds, blockArmed, { offerId: selectedId, declareFinalLap: finalLapArmed }));
  } catch (error) {
    notice = error.message;
    playSound('error');
    render();
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'sound-setting' || event.target.id === 'volume-setting') {
    if (event.target.id === 'sound-setting') prefs.sound = event.target.checked;
    else prefs.volume = Number(event.target.value) / 100;
    configureSound({ enabled: prefs.sound, volume: prefs.volume });
    save();
    playSound('turn');
    render();
    return;
  }
  if (event.target.id === 'hand-sort') {
    prefs.sort = event.target.value;
    reorderMessage = '';
    save();
    render();
  }
  if (event.target.id === 'final-lap-toggle') {
    finalLapArmed = game.currentPlayer === 0 && finalLapEligibility(game, selectedId).eligible && event.target.checked;
    render();
  }
  if (event.target.id === 'block-toggle') {
    blockArmed = canUseBlock(game) && event.target.checked;
    render();
  }
  if (event.target.id === 'fast-setting') {
    prefs.fast = event.target.checked;
    save();
  }
});

app.addEventListener('keydown', (event) => {
  if (!reorderMode || modal) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    finishReordering();
    return;
  }
  const card = event.target.closest('[data-action="move-select"]');
  if (!card) return;
  const index = visibleHand().findIndex((item) => item.id === card.dataset.cardId);
  let target;
  if (event.key === 'ArrowLeft') target = index - 1;
  if (event.key === 'ArrowRight') target = index + 1;
  if (event.key === 'Home') target = 0;
  if (event.key === 'End') target = visibleHand().length - 1;
  if (target !== undefined) {
    event.preventDefault();
    moveVisibleCard(card.dataset.cardId, target);
  }
});

save();
render();
