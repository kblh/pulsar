export const DRIFT_RETURN_CHANCE = 0.25;

/** Bars between mutations: level 10 → every bar, level 1 → every 12 bars, level 0 → never. */
export function mutationEvery(level) {
  if (!(level > 0)) return Infinity; // level 0: never
  return Math.max(1, Math.round(12 / level));
}

/** Number of steps changed per mutation. */
export function mutationAmount(level) {
  return Math.ceil(level / 3);
}
