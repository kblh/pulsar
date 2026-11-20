const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bitsOf = (bits) => (Number.isFinite(bits) ? clamp(Math.round(bits), 1, 16) : 16);
const rateOf = (rate) => (Number.isFinite(rate) ? clamp(Math.round(rate), 1, 32) : 1);

/**
 * Rounds a sample to the nearest of 2^(bits-1) steps per side. Mid-tread, so silence stays exactly 0 (no DC offset);
 * at 1 bit the only levels are -1, 0 and 1. Unusable input gives a finite number in -1..1.
 */
export function quantize(sample, bits) {
  const s = Number.isFinite(sample) ? clamp(sample, -1, 1) : 0;
  const half = 2 ** (bitsOf(bits) - 1);
  return clamp(Math.round(s * half) / half, -1, 1);
}

/** One channel's crusher: quantises and holds every `rate`-th sample. Keep one instance per channel. */
export function createCrusher({ bits, rate }) {
  let b = bitsOf(bits);
  let r = rateOf(rate);
  let count = 0;
  let held = 0;
  return {
    process(sample) {
      if (count <= 0) {
        held = quantize(sample, b);
        count = r;
      }
      count--;
      return held;
    },
    set({ bits: nb, rate: nr }) {
      b = bitsOf(nb);
      r = rateOf(nr);
    },
  };
}
