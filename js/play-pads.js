const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * A 4 x 4 grid of pads for playing by touch, the lowest note bottom left, rising to the right and then upwards. A pad
 * sounds while it is held: `onDown(i)` on the press, `onUp(i)` on the release (a finger, a mouse button, Enter or Space).
 * Every pad has its own pointer, so several fingers play a chord. `label(i)` gives the text on a pad; `setLabels` repaints them.
 */
export function createPlayPads({ onDown, onUp, label = String, ariaLabel = 'play pads' }) {
  const node = el('div', { className: 'pads play-pads' });
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', ariaLabel);
  const held = new Map(); // pad -> pointer id (or 'key')
  const press = (i, by, b) => {
    if (held.has(i)) return;
    held.set(i, by);
    b.classList.add('down');
    onDown?.(i);
  };
  const lift = (i, b) => {
    if (!held.delete(i)) return;
    b.classList.remove('down');
    onUp?.(i);
  };
  const pads = [];
  for (let row = 3; row >= 0; row--) {
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      const b = el('button', { type: 'button', className: 'pad play-pad' });
      b.setAttribute('aria-label', `pad ${i + 1}`);
      b.dataset.pad = String(i);
      b.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press must not open a menu
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!e.repeat) press(i, 'key', b);
      });
      b.addEventListener('keyup', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && held.get(i) === 'key') lift(i, b);
      });
      b.addEventListener('blur', () => {
        if (held.get(i) === 'key') lift(i, b);
      });
      pads[i] = b;
    }
  }
  // In the DOM order of the grid (top row first).
  node.append(...[12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3].map((i) => pads[i]));
  // Pointers: a finger or the mouse plays the pad under it and slides to the next one without lifting (the node holds the capture).
  const at = (e) => {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-pad]');
    return t && node.contains(t) ? Number(t.dataset.pad) : null;
  };
  const under = new Map(); // pointer id -> the pad it is playing
  const moveTo = (id, i) => {
    const prev = under.get(id);
    if (prev === i) return;
    if (prev !== undefined) lift(prev, pads[prev]);
    if (i === null) under.delete(id);
    else {
      under.set(id, i);
      press(i, id, pads[i]);
    }
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const i = at(e);
    if (i === null) return;
    e.preventDefault();
    try { node.setPointerCapture(e.pointerId); } catch { /* not an active pointer (synthetic event) */ }
    moveTo(e.pointerId, i);
  });
  node.addEventListener('pointermove', (e) => {
    if (under.has(e.pointerId)) moveTo(e.pointerId, at(e));
  });
  const end = (e) => moveTo(e.pointerId, null);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('lostpointercapture', end);

  // Computer keys while the pads are on screen (the open card), when no field is being typed in.
  const KEYS = ['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r', '1', '2', '3', '4'];
  const typing = (t) => t instanceof Element && t.closest('input, select, textarea, [contenteditable]');
  const onKeyDown = (e) => {
    if (!node.isConnected) return void removeListeners();
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !node.closest('.card.open')) return;
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i < 0) return;
    e.preventDefault();
    press(i, `kb:${e.key.toLowerCase()}`, pads[i]);
  };
  const onKeyUp = (e) => {
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0 && held.get(i) === `kb:${e.key.toLowerCase()}`) lift(i, pads[i]);
  };
  const letGo = () => { for (const i of [...held.keys()]) lift(i, pads[i]); };
  function removeListeners() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', letGo);
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', letGo);

  const shown = Array(16).fill(null);
  const setLabels = () => {
    pads.forEach((b, i) => {
      const t = label(i);
      if (t === shown[i]) return;
      shown[i] = t;
      b.textContent = t;
      if (KEYS[pads.indexOf(b)]) b.title = `key ${KEYS[pads.indexOf(b)]}`;
    });
  };
  setLabels();
  return {
    node,
    setLabels,
    /** Lifts every pad that is held (the module stopped). */
    releaseAll() {
      for (const i of [...held.keys()]) lift(i, pads[i]);
    },
  };
}
