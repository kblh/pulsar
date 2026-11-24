import { PITCH_CLASS_NAMES } from './scales.js';

/** The circle of fifths, C at the top: every step clockwise is a fifth up (7 semitones), counter-clockwise a fourth up. */
export const CIRCLE = Array.from({ length: 12 }, (_, i) => {
  const pc = (i * 7) % 12;
  return { pc, name: PITCH_CLASS_NAMES[pc], angle: i * 30 };
});

/** A position in percent (0-100, the middle is 50) on a circle of radius `r` percent; `angle` runs clockwise from the top. */
export function circlePoint(angle, r = 38) {
  const a = (angle * Math.PI) / 180;
  return { x: Math.round((50 + r * Math.sin(a)) * 100) / 100, y: Math.round((50 - r * Math.cos(a)) * 100) / 100 };
}

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * The twelve notes as a circle of fifths (fourths the other way round) that switches pitch classes on and off, a
 * counterpart of the keyboard with the same interface: a click calls `onToggle(pc)`, `set(classes)` shows which are lit.
 */
export function createCircle({ onToggle }) {
  const node = el('div', { className: 'circle' });
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', 'notes');
  const buttons = new Map();
  for (const k of CIRCLE) {
    const b = el('button', { type: 'button', className: 'circle-note', textContent: k.name });
    const { x, y } = circlePoint(k.angle);
    b.style.left = `${x}%`;
    b.style.top = `${y}%`;
    b.setAttribute('aria-label', k.name);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onToggle?.(k.pc));
    buttons.set(k.pc, b);
    node.append(b);
  }
  return {
    node,
    set(classes) {
      const lit = new Set(classes);
      for (const [pc, b] of buttons) {
        const v = String(lit.has(pc));
        if (b.getAttribute('aria-pressed') !== v) b.setAttribute('aria-pressed', v);
      }
    },
  };
}
