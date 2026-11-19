export const DEFAULT_FADE = 4;

export function clampFade(v) {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(30, Math.max(0.5, n)) : DEFAULT_FADE;
}

/** Seconds until the next tone change: rate 10 ≈ 3 s, rate 1 ≈ 40 s, ±30 % jitter. */
export function nextChangeDelay(rate, rng) {
  const r = Math.min(10, Math.max(1, Number(rate) || 1));
  const base = 40 - ((r - 1) * 37) / 9;
  return base * (0.7 + 0.6 * rng());
}

const choose = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/**
 * Decides whether an extra tone fades in or out. `active` are extras fading in or
 * sustaining, `releasing` are extras still fading out. The root is never touched.
 */
export function pickChange({ active, releasing }, { pool, root, maxExtra }, rng) {
  if (active.length > maxExtra || (maxExtra > 0 && active.length === maxExtra)) {
    return { remove: choose(active, rng) };
  }
  if (maxExtra <= 0) return null;
  const candidates = pool.filter((n) => n !== root && !active.includes(n) && !releasing.includes(n));
  const add = () => (candidates.length ? { add: choose(candidates, rng) } : null);
  const remove = () => (active.length ? { remove: choose(active, rng) } : null);
  if (!active.length) return add();
  return rng() < 0.5 ? add() ?? remove() : remove() ?? add();
}
