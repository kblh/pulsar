export const DRIFT_RETURN_CHANCE = 0.25;

/** Bars between mutations: level 10 → every bar, level 1 → every 12 bars. */
export function mutationEvery(level) {
  return Math.max(1, Math.round(12 / level));
}

/** Number of steps changed per mutation. */
export function mutationAmount(level) {
  return Math.ceil(level / 3);
}
