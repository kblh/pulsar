import { mutationAmount, DRIFT_RETURN_CHANCE } from './evolution.js';
import { STEPS_PER_BAR } from './timing.js';

export const RHYTHM_PRESETS = {
  fourOnFloor: 'x...x...x...x...',
  offbeat: '..x...x...x...x.',
  sparse: 'x.......x.......',
  dense: 'x.xxx.x.xx.xx.xx',
};

const SHIFT_CHANCE = 0.5;
const DENSITY_BAND = 1;

/** A pattern from text. An empty one gets step 0 on, unless `allowEmpty` (a lane the user cleared on purpose). */
export function parsePattern(str, { allowEmpty = false } = {}) {
  const p = Array.from({ length: STEPS_PER_BAR }, (_, i) => String(str ?? '')[i] === 'x');
  if (!allowEmpty && !p.some(Boolean)) p[0] = true;
  return p;
}

/** A copy of `pattern` with step `i` inverted; an `i` outside the pattern changes nothing. */
export function flipStep(pattern, i) {
  const next = [...pattern];
  if (Number.isInteger(i) && i >= 0 && i < next.length) next[i] = !next[i];
  return next;
}

export function formatPattern(p) {
  return p.map((on) => (on ? 'x' : '.')).join('');
}

const indices = (p, on) => p.flatMap((v, i) => (v === on ? [i] : []));
const hitCount = (p) => p.filter(Boolean).length;

/** Moves one hit to an empty neighbouring step; keeps density. */
function shiftHit(p, rng) {
  const hits = indices(p, true);
  const from = hits[Math.floor(rng() * hits.length)];
  const dir = rng() < 0.5 ? -1 : 1;
  for (const d of [dir, -dir]) {
    const to = (from + d + p.length) % p.length;
    if (!p[to]) {
      p[from] = false;
      p[to] = true;
      return;
    }
  }
}

/** Adds or removes one hit, pulled back toward `anchor` density when outside the band. */
function flipHit(p, anchor, rng) {
  const n = hitCount(p);
  let add = rng() < 0.5;
  if (n > anchor + DENSITY_BAND) add = false;
  else if (n < anchor - DENSITY_BAND) add = true;
  const pool = indices(p, !add);
  if (!pool.length) return;
  p[pool[Math.floor(rng() * pool.length)]] = add;
}

/**
 * Mutates a rhythm by shifting hits and nudging density. `anchor` is the density the
 * pattern started with (carried through the returned state) so `walk` cannot decay
 * into random half-full noise.
 */
export function mutateRhythm({ current, base, anchor }, { level, mode }, rng) {
  const anchored = anchor ?? hitCount(base);
  if (anchored === 0) return { current: [...current], base: [...base], anchor: 0 }; // cleared by the user: stays empty
  const next = [...current];
  for (let n = mutationAmount(level); n > 0; n--) {
    if (rng() < SHIFT_CHANCE) shiftHit(next, rng);
    else flipHit(next, anchored, rng);
  }
  if (mode === 'drift') {
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== base[i] && rng() < DRIFT_RETURN_CHANCE) next[i] = base[i];
    }
  }
  if (!next.some(Boolean)) next[Math.floor(rng() * next.length)] = true;
  return {
    current: next,
    base: mode === 'walk' ? [...next] : [...base],
    anchor: anchored,
  };
}
