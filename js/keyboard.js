import { PITCH_CLASS_NAMES } from './scales.js';

const BLACK = new Set([1, 3, 6, 8, 10]);

/** One octave, C to B. */
export const KEYS = PITCH_CLASS_NAMES.map((name, pc) => ({ pc, name, black: BLACK.has(pc) }));

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * A one-octave keyboard that switches pitch classes on and off. A click calls `onToggle(pc)`;
 * `set(classes)` shows which keys are lit without calling it.
 */
export function createKeyboard({ onToggle }) {
  const node = el('div', { className: 'keys' });
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', 'notes');
  let whites = 0;
  const buttons = new Map();
  for (const k of KEYS) {
    const b = el('button', { type: 'button', className: k.black ? 'key black' : 'key' });
    b.setAttribute('aria-label', k.name);
    b.setAttribute('aria-pressed', 'false');
    if (k.black) b.style.left = `${(whites / 7) * 100}%`; // between the white key before it and the one after it
    else whites++;
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
