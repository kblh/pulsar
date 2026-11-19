import { mutationAmount, DRIFT_RETURN_CHANCE } from './evolution.js';

const DELTAS = [-2, -1, 1, 2];

export function randomMelody(length, poolSize, rng) {
  return Array.from({ length }, () => Math.floor(rng() * poolSize));
}

export function mutateMelody({ current, base }, { level, mode, poolSize }, rng) {
  const next = [...current];
  const max = Math.max(0, poolSize - 1);
  for (let n = mutationAmount(level); n > 0; n--) {
    const i = Math.floor(rng() * next.length);
    const delta = DELTAS[Math.floor(rng() * DELTAS.length)];
    next[i] = Math.min(max, Math.max(0, next[i] + delta));
  }
  if (mode === 'walk') return { current: next, base: [...next] };
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== base[i] && rng() < DRIFT_RETURN_CHANCE) next[i] = base[i];
  }
  return { current: next, base: [...base] };
}
