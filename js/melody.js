import { mutationAmount, DRIFT_RETURN_CHANCE } from './evolution.js';

const DELTAS = [-2, -1, 1, 2];

export function randomMelody(length, poolSize, rng) {
  return Array.from({ length }, () => Math.floor(rng() * poolSize));
}

/**
 * One mutation of a melody. `amount` steps change (default by `level`). With `active` (the rhythm: which steps sound) only
 * steps that are heard are picked, so every change can be heard. With `octaveSize` and `octaves` above 0 a changed note may also
 * jump to the same degree in a higher octave (a pool index past the first `octaveSize` is the note an octave up).
 */
export function mutateMelody({ current, base }, { level, mode, poolSize, amount = mutationAmount(level), active, octaveSize = poolSize, octaves = 0 }, rng) {
  const next = [...current];
  const max = Math.max(0, poolSize - 1);
  const heard = active ? next.map((_, i) => i).filter((i) => active[i]) : [];
  for (let n = amount; n > 0; n--) {
    const i = heard.length ? heard[Math.floor(rng() * heard.length)] : Math.floor(rng() * next.length);
    const delta = DELTAS[Math.floor(rng() * DELTAS.length)];
    next[i] = Math.min(max, Math.max(0, next[i] + delta));
    if (octaves > 0 && octaveSize > 0 && rng() < 0.5) {
      next[i] = Math.min(max, (next[i] % octaveSize) + octaveSize * Math.floor(rng() * (octaves + 1)));
    }
  }
  if (mode === 'walk') return { current: next, base: [...next] };
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== base[i] && rng() < DRIFT_RETURN_CHANCE) next[i] = base[i];
  }
  return { current: next, base: [...base] };
}
