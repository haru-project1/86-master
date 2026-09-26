// Display order is separate from the engine's acquisition order and CPU inputs.
export function orderedHand(hand, ids = []) {
  const remaining = new Map(hand.map((card) => [card.id, card]));
  const ordered = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!remaining.has(id)) continue;
    ordered.push(remaining.get(id));
    remaining.delete(id);
  }
  return [...ordered, ...remaining.values()];
}

export function moveHandCard(hand, cardId, position) {
  const result = [...hand];
  const source = result.findIndex((card) => card.id === cardId);
  if (source < 0 || !Number.isInteger(position) || position < 0 || position >= result.length) return result;
  const [card] = result.splice(source, 1);
  result.splice(position, 0, card);
  return result;
}

// Pointer Events cover mouse, pen and touch; normal play never intercepts a drag.
export function bindHandDrag(root, { enabled, select, move }) {
  let pointer = null;
  let suppressClickUntil = 0;
  function clear() {
    if (!pointer) return;
    const id = pointer.id;
    pointer = null;
    root.querySelector('.reorder-drag-layer')?.remove();
    root
      .querySelectorAll('.drag-source,.drop-target')
      .forEach((element) => element.classList.remove('drag-source', 'drop-target'));
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }
  root.addEventListener('pointerdown', (event) => {
    const card = event.target.closest('[data-action="move-select"]');
    if (!enabled() || !card || !event.isPrimary || event.button !== 0) return;
    const rect = card.getBoundingClientRect();
    pointer = {
      id: event.pointerId,
      card,
      cardId: card.dataset.cardId,
      x: event.clientX,
      y: event.clientY,
      rect,
      dragging: false,
      target: null,
    };
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener(
    'pointermove',
    (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (!pointer.dragging && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 7) return;
      if (!pointer.dragging) {
        pointer.dragging = true;
        pointer.card.classList.add('drag-source');
        const layer = document.createElement('div');
        layer.className = 'reorder-drag-layer';
        layer.setAttribute('aria-hidden', 'true');
        const ghost = pointer.card.cloneNode(true);
        ghost.className = 'game-card art-card reorder-ghost';
        ghost.removeAttribute('data-action');
        ghost.removeAttribute('data-card-id');
        ghost.tabIndex = -1;
        ghost.style.width = pointer.rect.width + 'px';
        layer.append(ghost);
        root.append(layer);
        pointer.ghost = ghost;
      }
      event.preventDefault();
      pointer.ghost.style.transform =
        'translate(' +
        (event.clientX - (pointer.x - pointer.rect.x)) +
        'px,' +
        (event.clientY - (pointer.y - pointer.rect.y)) +
        'px) rotate(3deg)';
      root.querySelectorAll('.drop-target').forEach((element) => element.classList.remove('drop-target'));
      const area = root.querySelector('.hand-cards').getBoundingClientRect();
      pointer.target = null;
      if (
        event.clientX < area.left ||
        event.clientX > area.right ||
        event.clientY < area.top ||
        event.clientY > area.bottom
      )
        return;
      const cards = [...root.querySelectorAll('[data-action="move-select"]')];
      const closest = cards
        .map((card, index) => {
          const r = card.getBoundingClientRect();
          return {
            card,
            index,
            distance: Math.hypot(event.clientX - (r.x + r.width / 2), event.clientY - (r.y + r.height / 2)),
          };
        })
        .sort((a, b) => a.distance - b.distance)[0];
      pointer.target = closest.index;
      if (closest.card !== pointer.card) closest.card.classList.add('drop-target');
    },
    { passive: false },
  );
  root.addEventListener('pointerup', (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const { cardId, dragging, target } = pointer;
    clear();
    // Capture retargets the subsequent click to the root, so taps are handled here.
    suppressClickUntil = performance.now() + 400;
    if (dragging && target !== null) move(cardId, target);
    else select(cardId);
  });
  root.addEventListener('pointercancel', clear);
  root.addEventListener('lostpointercapture', clear);
  root.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="move-select"]') && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener('blur', clear);
  window.addEventListener('resize', clear);
  return clear;
}
