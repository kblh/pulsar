import { snap, toFraction, fromFraction, keyValue } from './hud.js';

/** A rotary knob: a grey arc for the whole range, an accent arc for the value, a body with a pointer. */
export const KNOB_SWEEP = 270; // degrees; the pointer rests at -135 (7 o'clock) and ends at +135 (5 o'clock)
export const KNOB_DRAG_PX = 180; // a drag of this many pixels (up or right) covers the whole range
export const KNOB_FINE = 0.25; // with shift held the knob moves this much of what the pointer moves

const SIZE = 64;
const C = SIZE / 2;
const R_ARC = 27;
const R_BODY = 19;
const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 100) / 100;

/** The pointer angle in degrees (0 = straight up, clockwise) for a position 0..1 on the knob. */
export const knobAngle = (fraction) => -KNOB_SWEEP / 2 + clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1) * KNOB_SWEEP;

/** A point on the circle around the centre; `deg` runs clockwise from straight up. */
export function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return { x: round(cx + r * Math.sin(a)), y: round(cy - r * Math.cos(a)) };
}

/** An SVG arc path from one position on the knob to another (both 0..1); empty when there is nothing to draw. */
export function arcPath(cx, cy, r, from, to) {
  const a0 = knobAngle(from);
  const a1 = knobAngle(to);
  if (!(a1 - a0 > 0.01)) return '';
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
}

/** Where the value arc starts: at the left end, or at the middle for a range that has a zero in it (-12..+12 dB). */
export const knobOrigin = ({ min, max, scale = 'linear' }) => (min < 0 && max > 0 ? toFraction(0, { min, max, scale }) : 0);

/** The position (0..1) after a drag that started at `start`: up and right raise it, down and left lower it. */
export function dragFraction(start, dx, dy, { fine = false, px = KNOB_DRAG_PX } = {}) {
  const gain = fine ? KNOB_FINE : 1;
  return clamp(start + (gain * (dx - dy)) / px, 0, 1);
}

/** The drag length that covers the whole range: longer for a range with many steps (a tempo), so one pixel is about a step or less. */
export const dragLength = ({ min, max, step }) => clamp(((max - min) / step) * 1.5, KNOB_DRAG_PX, 420);

function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
}

function html(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * A rotary control driven by Pointer Events: drag up or right to raise it, down or left to lower it (the finger is
 * captured, so the page does not scroll under it), the wheel and the arrow keys nudge it, a double tap returns to
 * `defaultValue`. The knob is a `role="slider"`, so keys and screen readers work. `set` shows a value without calling `onInput`.
 */
export function createKnob({ min, max, step, value, scale = 'linear', format, onInput, ariaLabel, label, defaultValue }) {
  const opts = { min, max, step, scale };
  let cur = snap(value, opts);

  const track = svg('path', { class: 'knob-track', d: arcPath(C, C, R_ARC, 0, 1) });
  const arc = svg('path', { class: 'knob-arc' });
  const body = svg('circle', { class: 'knob-body', cx: C, cy: C, r: R_BODY });
  const cap = svg('circle', { class: 'knob-cap', cx: C, cy: C, r: R_BODY - 4 });
  const pointer = svg('line', { class: 'knob-pointer', x1: C, y1: C - 5, x2: C, y2: C - R_BODY + 3 });
  const dial = svg('svg', { class: 'knob-svg', viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true' }, track, arc, body, cap, pointer);

  const face = html('div', { className: 'knob', tabIndex: 0 }, dial);
  face.setAttribute('role', 'slider');
  face.setAttribute('aria-valuemin', String(min));
  face.setAttribute('aria-valuemax', String(max));
  face.setAttribute('aria-label', ariaLabel ?? label ?? 'value');
  const labelEl = label ? html('span', { className: 'knob-label', textContent: label }) : null;
  const valueEl = format ? html('span', { className: 'knob-value' }) : null;
  const node = html('div', { className: 'knob-wrap' }, ...(valueEl ? [valueEl] : []), face, ...(labelEl ? [labelEl] : [])); // value above, name below: a thumb on the knob does not cover the value

  function render() {
    const f = toFraction(cur, opts);
    const o = knobOrigin(opts);
    arc.setAttribute('d', arcPath(C, C, R_ARC, Math.min(o, f), Math.max(o, f)));
    pointer.setAttribute('transform', `rotate(${knobAngle(f)} ${C} ${C})`);
    face.setAttribute('aria-valuenow', String(cur));
    face.setAttribute('aria-valuetext', format ? format(cur) : String(cur));
    if (valueEl) valueEl.textContent = format(cur);
  }

  function change(next) {
    if (next === cur) return;
    cur = next;
    render();
    onInput?.(cur);
  }

  // Home position: the given default, or the zero of a range that has one in the middle (a pan, an eq gain).
  const home = defaultValue ?? (min < 0 && max > 0 ? 0 : undefined);
  const goHome = () => {
    if (home !== undefined) change(snap(home, opts));
  };

  let lastTap = null; // { t, x, y } of the latest tap that did not move: two close together are a double tap (a dblclick event is not sent by every touch browser)
  let drag = null; // { id, x, y, from }: where the pointer and the knob were at the press
  face.addEventListener('pointerdown', (e) => {
    if (drag) return; // a second finger
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: toFraction(cur, opts) };
    try { face.setPointerCapture(e.pointerId); } catch { /* not an active pointer (synthetic event) */ }
    e.preventDefault();
    face.focus();
    face.classList.add('active');
  });
  face.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    change(fromFraction(dragFraction(drag.from, e.clientX - drag.x, e.clientY - drag.y, { fine: e.shiftKey, px: dragLength(opts) }), opts));
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.type === 'pointerup') {
      const still = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6;
      const now = e.timeStamp;
      if (still && lastTap && now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
        lastTap = null;
        goHome();
      } else {
        lastTap = still ? { t: now, x: e.clientX, y: e.clientY } : null;
      }
    }
    drag = null;
    face.classList.remove('active');
  };
  face.addEventListener('pointerup', end);
  face.addEventListener('pointercancel', end);
  face.addEventListener('lostpointercapture', end);
  face.addEventListener('dblclick', goHome);
  face.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    change(keyValue(dir > 0 ? 'ArrowUp' : 'ArrowDown', cur, opts));
  }, { passive: false });
  face.addEventListener('keydown', (e) => {
    const v = keyValue(e.key, cur, opts);
    if (v === null) return;
    e.preventDefault();
    change(v);
  });

  render();
  return {
    node,
    set(v) {
      cur = snap(v, opts);
      render();
    },
  };
}
