import { mutationAmount, DRIFT_RETURN_CHANCE } from './evolution.js';
import { STEPS_PER_BAR } from './timing.js';

export const RHYTHM_PRESETS = {
  fourOnFloor: 'x...x...x...x...',
  offbeat: '..x...x...x...x.',
  sparse: 'x.......x.......',
  dense: 'x.xxx.x.xx.xx.xx',
};

export function parsePattern(str) {
  const p = Array.from({ length: STEPS_PER_BAR }, (_, i) => String(str ?? '')[i] === 'x');
  if (!p.some(Boolean)) p[0] = true;
  return p;
}

export function formatPattern(p) {
  return p.map((on) => (on ? 'x' : '.')).join('');
}

export function mutateRhythm({ current, base }, { level, mode }, rng) {
  const next = [...current];
  for (let n = mutationAmount(level); n > 0; n--) {
    const i = Math.floor(rng() * next.length);
    next[i] = !next[i];
  }
  if (mode === 'drift') {
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== base[i] && rng() < DRIFT_RETURN_CHANCE) next[i] = base[i];
    }
  }
  if (!next.some(Boolean)) next[Math.floor(rng() * next.length)] = true;
  return mode === 'walk' ? { current: next, base: [...next] } : { current: next, base: [...base] };
}
