const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * A 4 x 4 grid of pads for playing by touch, the lowest note bottom left, rising to the right and then upwards. A pad
 * sounds while it is held: `onDown(i)` on the press, `onUp(i)` on the release (a finger, a mouse button, Enter or Space).
 * A finger that slides to the next pad calls `onSlide(from, to)` when given (a legato glide), else `onUp` and `onDown`.
 * Every pad has its own pointer, so several fingers play a chord. `label(i)` gives the text on a pad, `role(i)` marks
 * the root ('root') or the fifth ('fifth') so they are tinted; `setLabels` repaints both. `setLayout('keys')` puts all 16 in one row of tall keys that touch (easy to slide across); `setLayout('kalimba')` lays the
 * first 9 pads out as the tines of a kalimba (the lowest in the middle, rising alternately to the left and the right).
 */
export function createPlayPads({ onDown, onUp, onSlide, label = String, role = () => null, ariaLabel = 'play pads', layout = 'grid', keysActive = null }) {
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
  // Pointers: a finger or the mouse plays the pad under it and slides to the next one without lifting (the node holds the capture).
  const at = (e) => {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-pad]');
    return t && node.contains(t) ? Number(t.dataset.pad) : null;
  };
  const under = new Map(); // pointer id -> the pad it is playing
  const moveTo = (id, i) => {
    const prev = under.get(id);
    if (prev === i) return;
    if (onSlide && prev !== undefined && i !== null && !held.has(i)) {
      under.set(id, i);
      held.delete(prev);
      pads[prev].classList.remove('down');
      held.set(i, id);
      pads[i].classList.add('down');
      onSlide(prev, i);
      return;
    }
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

  // Computer keys while `keysActive()` says so (else while the pads are on screen, in the open card), when no field is being typed in. By the physical key
  // (a Czech keyboard has Y where a US one has Z), so it plays the same on every layout.
  const CODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
  // A checkbox, radio, button or slider input is not text: after clicking a synth's on/off box the keys must still play.
  const typing = (t) => t instanceof Element && t.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]), select, textarea, [contenteditable]');
  const onKeyDown = (e) => {
    if (!node.isConnected) return void removeListeners();
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !(keysActive ? keysActive() : node.closest('.card.open'))) return;
    const i = CODES.indexOf(e.code);
    if (i < 0 || pads[i].hidden) return;
    e.preventDefault();
    press(i, `kb:${e.code}`, pads[i]);
  };
  const onKeyUp = (e) => {
    const i = CODES.indexOf(e.code);
    if (i >= 0 && held.get(i) === `kb:${e.code}`) lift(i, pads[i]);
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
      const r = role(i) ?? '';
      if (`${t}|${r}` === shown[i]) return;
      shown[i] = `${t}|${r}`;
      b.textContent = t;
      if (r) b.dataset.role = r;
      else delete b.dataset.role;
    });
  };
  const GRID_ORDER = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
  const TINES = 9;
  // Left to right: the longest tine (the lowest note) in the middle, the next ones alternately on its left and right.
  const KALIMBA_ORDER = [7, 5, 3, 1, 0, 2, 4, 6, 8];
  const KEYS_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]; // one row, the lowest on the left, like the keys of a volca sample
  function setLayout(next) {
    const kalimba = next === 'kalimba';
    node.className = kalimba ? 'play-pads kalimba' : next === 'keys' ? 'play-pads pad-keys' : 'pads play-pads';
    pads.forEach((b, i) => {
      b.classList.toggle('tine', kalimba);
      b.hidden = kalimba && i >= TINES;
      if (kalimba && i < TINES) b.style.setProperty('--len', String(Math.ceil(i / 2)));
      else b.style.removeProperty('--len');
    });
    node.append(...(kalimba ? KALIMBA_ORDER : next === 'keys' ? KEYS_ORDER : GRID_ORDER).map((i) => pads[i]));
    for (const i of [...held.keys()]) if (pads[i].hidden) lift(i, pads[i]);
  }
  setLayout(layout);
  setLabels();
  return {
    node,
    setLabels,
    setLayout,
    /** Lifts every pad that is held (the module stopped). */
    releaseAll() {
      for (const i of [...held.keys()]) lift(i, pads[i]);
    },
  };
}
