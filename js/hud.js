import { ROOTS } from './options.js';
import { parseNote } from './scales.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const decimals = (n) => {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(10, s.length - i - 1);
};

/** A finite number from a number or a non-empty numeric string; anything else is null. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Clamps into [min, max] and rounds to the step grid that starts at min; unusable input gives min. */
export function snap(value, { min, max, step }) {
  const n = num(value);
  if (n === null) return min;
  const on = min + Math.round((clamp(n, min, max) - min) / step) * step;
  return clamp(Number(on.toFixed(Math.max(decimals(step), decimals(min)))), min, max);
}

/** Position of a value on the bar, 0..1. `scale: 'log'` needs min > 0. */
export function toFraction(value, { min, max, scale = 'linear' }) {
  const n = num(value);
  if (n === null || max <= min) return 0;
  const v = clamp(n, min, max);
  const f = scale === 'log' ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  return clamp(f, 0, 1);
}

/** The value at a bar position (inverse of toFraction), snapped to the step. */
export function fromFraction(f, { min, max, step, scale = 'linear' }) {
  const x = clamp(num(f) ?? 0, 0, 1);
  const v = scale === 'log' ? min * Math.pow(max / min, x) : min + x * (max - min);
  return snap(v, { min, max, step });
}

// ---- envelope graph: four equal segments (attack, decay, fixed sustain, release) ----
const ENV_MAX = 5;
const timeToUnit = (t) => Math.sqrt(clamp(t, 0, ENV_MAX) / ENV_MAX); // sqrt: short times stay pickable
const unitToTime = (u) => ENV_MAX * clamp(u, 0, 1) ** 2;

export function envLayout({ w, h, pad }) {
  return { w, h, pad, seg: (w - 2 * pad) / 4 };
}

export function nodePositions(env, L) {
  const top = L.pad;
  const bottom = L.h - L.pad;
  const sy = top + (1 - clamp(env.s, 0, 1)) * (bottom - top);
  return {
    start: { x: L.pad, y: bottom },
    attack: { x: L.pad + L.seg * timeToUnit(env.a), y: top },
    decay: { x: L.pad + L.seg + L.seg * timeToUnit(env.d), y: sy },
    sustainEnd: { x: L.pad + 3 * L.seg, y: sy },
    release: { x: L.pad + 3 * L.seg + L.seg * timeToUnit(env.r), y: bottom },
  };
}

/** The envelope keys a dragged node controls, from a pointer position in graph coordinates. */
export function envFromDrag(node, point, env, L) {
  const unit = (x0) => (clamp(num(point.x) ?? x0, x0, x0 + L.seg) - x0) / L.seg;
  if (node === 'attack') return { a: round2(unitToTime(unit(L.pad))) };
  if (node === 'release') return { r: round2(unitToTime(unit(L.pad + 3 * L.seg))) };
  const top = L.pad;
  const bottom = L.h - L.pad;
  const s = 1 - (clamp(num(point.y) ?? bottom, top, bottom) - top) / (bottom - top);
  return { d: round2(unitToTime(unit(L.pad + L.seg))), s: round2(s) };
}

/** Which node (`attack`, `decay` or `release`) is nearest to a graph point within `radius`, else null. */
export function nearestNode(point, positions, radius) {
  const x = num(point?.x);
  const y = num(point?.y);
  if (x === null || y === null) return null;
  let best = null;
  let bestD = Infinity;
  for (const id of ['attack', 'decay', 'release']) {
    const d = Math.hypot(positions[id].x - x, positions[id].y - y);
    if (d <= radius && d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

/** How many characters the widest value text of a slider has, so the text can have a fixed width. */
export function valueChars(format, { min, max, step }) {
  let w = 0;
  const n = 24;
  for (let i = 0; i <= n; i++) w = Math.max(w, String(format(snap(min + ((max - min) * i) / n, { min, max, step }))).length);
  return w;
}

/** Detune in cents as a signed whole number: '+12 ct', '\u22127 ct', '0 ct'. */
export function formatCents(v) {
  const n = Math.round(num(v) ?? 0);
  return n === 0 ? '0 ct' : `${n > 0 ? '+' : '\u2212'}${Math.abs(n)} ct`;
}

// ---- drone root note <-> picker ----
/** `{ root, octave }` for a note name; enharmonic spellings come back as the ROOTS name. */
export function splitRoot(rootNote) {
  const midi = parseNote(rootNote);
  if (midi === null) return null;
  return { root: ROOTS[midi % 12], octave: Math.floor(midi / 12) - 1 };
}

export const joinRoot = (root, octave) => `${root}${octave}`;
