/** How long the speed takes to fall from the set value to 0: 8.3 s at the lowest peek, 5 s at 50 %, 3 s at 80 %, 1.7 s at 100 %. */
export const peekSeconds = (peek) => 25 / 3 - (20 / 3) * peek;

const ONSET_STEP = 0.03; // the fast level must exceed the slow one by this much to count as a new note
const REFRACTORY = 0.06; // seconds after a note start during which the next one is not looked for

/**
 * The "peek" of a tap tremolo, as plain per-sample maths (it runs in the worklet): when a note starts the speed jumps
 * to `speed`, then falls linearly to 0 in `peekSeconds(peek)` and stays there until the next note. At peek 0 it just
 * holds `speed`. A note is an onset of the input: a fast level follower rising above a slow one.
 * `process(x, speed, peek)` takes one input sample and returns the LFO frequency in Hz.
 */
export function createSlide({ sampleRate = 44100 } = {}) {
  const coef = (seconds) => 1 - Math.exp(-1 / (seconds * sampleRate));
  const fastUp = coef(0.002);
  const fastDown = coef(0.02);
  const slowUp = coef(0.04);
  const slowDown = coef(0.15);
  let fast = 0;
  let slow = 0;
  let t = 0; // seconds since the last note start
  let quiet = 0; // seconds until the next onset may count
  return {
    process(x, speed, peek) {
      const a = Math.abs(x);
      fast += (a - fast) * (a > fast ? fastUp : fastDown);
      slow += (a - slow) * (a > slow ? slowUp : slowDown);
      if (quiet > 0) quiet -= 1 / sampleRate;
      else if (fast - slow > ONSET_STEP) {
        t = 0;
        quiet = REFRACTORY;
      }
      t += 1 / sampleRate;
      if (!(peek > 0)) return speed;
      return speed * Math.max(0, 1 - t / peekSeconds(peek));
    },
    /** A note starts now (also used when the effect begins: the speed starts from the set value). */
    restart() {
      t = 0;
    },
  };
}
