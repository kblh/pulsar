const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bitsOf = (bits) => (Number.isFinite(bits) ? clamp(Math.round(bits), 1, 16) : 16);
const rateOf = (rate) => (Number.isFinite(rate) ? clamp(Math.round(rate), 1, 32) : 1);

/**
 * Rounds a sample to the nearest of 2^(bits-1) steps per side of `scale` (full scale, 1 by default). Mid-tread, so
 * silence stays exactly 0 (no DC offset); at 1 bit the only levels are -scale, 0 and scale. Unusable input gives a
 * finite number within +-scale.
 */
export function quantize(sample, bits, scale = 1) {
  const s = Number.isFinite(sample) ? clamp(sample / scale, -1, 1) : 0;
  const half = 2 ** (bitsOf(bits) - 1);
  return clamp(Math.round(s * half) / half, -1, 1) * scale;
}

const RELEASE_S = 0.15; // how fast the full scale follows a signal that gets quieter
const MIN_SCALE = 1e-4; // about -80 dB: silence has to stay silent, not turn into steps of nothing

/**
 * One channel's crusher: quantises and holds every `rate`-th sample. Keep one instance per channel.
 * Full scale follows the signal's peak (instant up, `RELEASE_S` down), so the same bit depth crushes a quiet
 * voice as much as a loud one; a fixed full scale of 1 would round the quiet voices of this app to nothing at low bits.
 */
export function createCrusher({ bits, rate, sampleRate = 44100 }) {
  let b = bitsOf(bits);
  let r = rateOf(rate);
  const decay = Math.exp(-1 / (RELEASE_S * sampleRate));
  let follower = 0;
  let count = 0;
  let held = 0;
  return {
    process(sample) {
      const a = Number.isFinite(sample) ? Math.abs(sample) : 0;
      follower = Math.max(a, follower * decay);
      if (count <= 0) {
        held = quantize(sample, b, Math.max(follower, MIN_SCALE));
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
