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

export const SUBS_MIN = 2;
export const SUBS_MAX = 32;

/** The number of steps a drum lane has per bar: the length of its pattern text; text that is too short to say is a plain 16. */
export const lanePatternLength = (str) => {
  const n = String(str ?? '').length;
  return n >= SUBS_MIN ? Math.min(n, SUBS_MAX) : STEPS_PER_BAR;
};

/** A pattern from text, `length` steps long (16 by default). An empty one gets step 0 on, unless `allowEmpty` (a lane the user cleared on purpose). */
export function parsePattern(str, { allowEmpty = false, length = STEPS_PER_BAR } = {}) {
  const p = Array.from({ length }, (_, i) => String(str ?? '')[i] === 'x');
  if (!allowEmpty && !p.some(Boolean)) p[0] = true;
  return p;
}

/** True when step `i` is the one and only hit of `pattern`. */
export function isOnlyHit(pattern, i) {
  return Boolean(pattern[i]) && pattern.filter(Boolean).length === 1;
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
const pick = (list, rng) => list[Math.floor(rng() * list.length)];

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
export function mutateRhythm({ current, base, anchor }, { level, mode, density }, rng) {
  // `density` (1-10), when given, replaces the starting density as the target: about that share of the steps sounds (10 = 3/4 of them),
  // the count only oscillates around it.
  const anchored = density > 0 ? Math.max(1, Math.round((density / 10) * 0.75 * current.length)) : (anchor ?? hitCount(base));
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
  if (density > 0) {
    for (let n = hitCount(next); n > anchored + DENSITY_BAND; n--) next[pick(indices(next, true), rng)] = false;
    for (let n = hitCount(next); n < anchored - DENSITY_BAND; n++) next[pick(indices(next, false), rng)] = true;
  }
  if (!next.some(Boolean)) next[Math.floor(rng() * next.length)] = true;
  return {
    current: next,
    base: mode === 'walk' ? [...next] : [...base],
    anchor: density > 0 ? (anchor ?? hitCount(base)) : anchored,
  };
}

/** A pattern spread over `steps` steps keeping the hits' places in the bar (a hit at 1/4 stays at 1/4); like a drum machine changing its subdivision. */
export function remapPattern(pattern, steps) {
  const out = Array(steps).fill(false);
  pattern.forEach((on, i) => {
    if (on) out[Math.round((i * steps) / pattern.length) % steps] = true;
  });
  return out;
}

/**
 * The positions of a lane of `subs` steps that start within one sixteenth of the bar (`sixteenth` 0..15), each with its
 * `offset` in sixteenths (0 up to but not including 1). A lane of 16 has exactly one at offset 0 per sixteenth.
 */
export function positionsIn(sixteenth, subs) {
  const out = [];
  const first = Math.ceil((sixteenth * subs) / STEPS_PER_BAR);
  const end = Math.ceil(((sixteenth + 1) * subs) / STEPS_PER_BAR);
  for (let pos = first; pos < end; pos++) out.push({ pos, offset: (pos * STEPS_PER_BAR) / subs - sixteenth });
  return out;
}

/** Which step of a pattern sounds at `pos` when the lane is turned by `rotation` steps. */
export const stepAt = (pos, rotation, subs) => (((pos - rotation) % subs) + subs) % subs;
