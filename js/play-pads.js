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
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* not an active pointer (synthetic event) */ }
        press(i, e.pointerId, b);
      });
      const end = (e) => {
        if (held.get(i) === e.pointerId) lift(i, b);
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('lostpointercapture', end);
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
  const shown = Array(16).fill(null);
  const setLabels = () => {
    pads.forEach((b, i) => {
      const t = label(i);
      if (t === shown[i]) return;
      shown[i] = t;
      b.textContent = t;
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
