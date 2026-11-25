export const DEFAULT_ENV = { a: 0.01, d: 0.1, s: 0.5, r: 0.15 };

const noiseBuffers = new WeakMap();

function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

const MIX_RAMP = 0.05; // seconds: moving mix or detune on a sounding voice never jumps

const finite = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

/**
 * Square and saw sound louder than sine at the same peak (more harmonics in the range the ear is most sensitive to),
 * so each wave is scaled down to match; sine keeps its level and nothing ever gets louder than it was.
 * A-weighted energy of C4 at equal gain, relative to sine: triangle -1.5 dB, saw +1.2 dB, square +4.7 dB. These gains sit
 * a little below that match (-0.9, -2.5, -6 dB) because bright waves count for more at louder levels. Tune by ear here.
 */
export const WAVE_GAIN = { sine: 1, triangle: 0.9, sawtooth: 0.75, square: 0.5 };

/** The level factor of a wave; an unknown wave is left alone. */
export function waveGain(wave) {
  return typeof wave === 'string' && Object.hasOwn(WAVE_GAIN, wave) ? WAVE_GAIN[wave] : 1;
}

/** The levels of oscillator A and B for a mix of 0..1: a linear crossfade that adds up to 1. */
export function oscMix(mix) {
  const m = finite(mix) ? Math.min(1, Math.max(0, Number(mix))) : 0;
  return { a: 1 - m, b: m };
}

/** Detune of the second oscillator in cents, a whole number within +-50; unusable input means none. */
function detuneOf(detune) {
  return finite(detune) ? Math.min(50, Math.max(-50, Math.round(Number(detune)))) : 0;
}

function disconnectOnEnd(source, ...nodes) {
  source.onended = () => nodes.forEach((n) => n.disconnect());
}

export function playNote(ctx, dest, { freq, time, duration, wave, env = DEFAULT_ENV, wave2, mix = 0, detune = 0 }) {
  const { a, d, s, r } = env;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  const end = time + Math.max(duration, a + d);
  gain.gain.setValueAtTime(0.0001, time);
  const two = oscMix(mix).b > 0;
  const peak = two ? 0.6 : 0.6 * waveGain(wave); // with two oscillators each carries its own wave's gain in its level
  gain.gain.linearRampToValueAtTime(peak, time + a);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak * s), time + a + d);
  gain.gain.setValueAtTime(Math.max(0.0001, peak * s), end);
  gain.gain.linearRampToValueAtTime(0.0001, end + r);
  const { a: levelA, b: levelB } = oscMix(mix);
  if (levelB <= 0) {
    osc.connect(gain).connect(dest);
    osc.start(time);
    osc.stop(end + r + 0.02);
    disconnectOnEnd(osc, osc, gain);
    return;
  }
  // A second oscillator: each one through its own level into the shared envelope.
  const oscB = ctx.createOscillator();
  oscB.type = typeof wave2 === 'string' ? wave2 : wave;
  oscB.frequency.value = freq;
  oscB.detune.value = detuneOf(detune);
  const gainA = ctx.createGain();
  gainA.gain.value = levelA * waveGain(wave);
  const gainB = ctx.createGain();
  gainB.gain.value = levelB * waveGain(oscB.type);
  osc.connect(gainA).connect(gain);
  oscB.connect(gainB).connect(gain);
  gain.connect(dest);
  for (const o of [osc, oscB]) {
    o.start(time);
    o.stop(end + r + 0.02);
  }
  disconnectOnEnd(osc, osc, gainA, gain);
  disconnectOnEnd(oscB, oscB, gainB);
}

/** The sounds of each drum; the first of each is the original one, a saved module without a choice keeps it. */
export const DRUM_SOUNDS = {
  kick: ['classic', 'deep', 'punchy'],
  snare: ['classic', 'tight', 'rimshot'],
  hat: ['closed', 'open', 'ride'],
};

/** Noise through a filter into a decaying gain: the building block of the snares and hats. */
function noiseHit(ctx, dest, time, { type, freq, q = 1, peak, length }) {
  const noise = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  noise.buffer = noiseBuffer(ctx);
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + length);
  noise.connect(filter).connect(gain).connect(dest);
  noise.start(time);
  noise.stop(time + length + 0.01);
  disconnectOnEnd(noise, noise, filter, gain);
}

/** A pitched hit: an oscillator that glides from `from` to `to` hertz while it fades. */
function toneHit(ctx, dest, time, { type = 'sine', from, to = from, peak, length }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, time);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, time + length);
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + length);
  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(time + length + 0.02);
  disconnectOnEnd(osc, osc, gain);
}

const DRUM_VOICES = {
  kick: [
    (ctx, dest, t) => toneHit(ctx, dest, t, { from: 150, to: 45, peak: 0.9, length: 0.3 }),
    (ctx, dest, t) => toneHit(ctx, dest, t, { from: 90, to: 38, peak: 0.9, length: 0.55 }),
    (ctx, dest, t) => {
      toneHit(ctx, dest, t, { type: 'triangle', from: 190, to: 55, peak: 0.9, length: 0.16 });
      noiseHit(ctx, dest, t, { type: 'highpass', freq: 1500, peak: 0.3, length: 0.03 });
    },
  ],
  snare: [
    (ctx, dest, t) => {
      noiseHit(ctx, dest, t, { type: 'allpass', freq: 1000, peak: 0.5, length: 0.18 });
      toneHit(ctx, dest, t, { type: 'triangle', from: 180, peak: 0.4, length: 0.1 });
    },
    (ctx, dest, t) => noiseHit(ctx, dest, t, { type: 'bandpass', freq: 2200, q: 1.5, peak: 0.7, length: 0.09 }),
    (ctx, dest, t) => {
      toneHit(ctx, dest, t, { type: 'square', from: 420, to: 210, peak: 0.35, length: 0.05 });
      noiseHit(ctx, dest, t, { type: 'highpass', freq: 1800, peak: 0.4, length: 0.08 });
    },
  ],
  hat: [
    (ctx, dest, t) => noiseHit(ctx, dest, t, { type: 'highpass', freq: 7000, peak: 0.3, length: 0.05 }),
    (ctx, dest, t) => noiseHit(ctx, dest, t, { type: 'highpass', freq: 6000, peak: 0.3, length: 0.3 }),
    (ctx, dest, t) => {
      for (const freq of [440, 587, 659, 784, 988]) toneHit(ctx, dest, t, { from: freq, peak: 0.05, length: 0.2 });
      noiseHit(ctx, dest, t, { type: 'highpass', freq: 7000, peak: 0.12, length: 0.2 });
    },
  ],
};

/** One drum hit; `sound` is an index into DRUM_SOUNDS[kind], anything unusable plays the first one. */
export function playDrum(ctx, dest, { kind, sound = 0, time }) {
  const voices = DRUM_VOICES[kind] ?? DRUM_VOICES.hat;
  (voices[sound] ?? voices[0])(ctx, dest, time);
}

/**
 * A sustained oscillator whose level only ever changes by exponential ramps
 * (setTargetAtTime) — never a jump. Starts silent and fades in.
 */
export function createDroneVoice(ctx, dest, { freq, wave, peak, fade, wave2, mix = 0, detune = 0 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  gain.gain.value = 0;
  let levelA = null; // a level stage in front of A, only for a voice that was built with a second oscillator
  let trim = null; // for a voice that already sounds: a copy of A with a negative gain that brings A down to its share
  let oscB = null;
  let gainB = null;
  let targetB = 0; // where B's level is heading: a wave change is silent only while B is muted
  let released = false;
  const own = waveGain(wave); // the voice as a whole is scaled by A's wave; B is scaled by how it differs from A
  const bScale = () => waveGain(oscB?.type) / own;

  function makeSecond(start, w2, dt, level) {
    oscB = ctx.createOscillator();
    oscB.type = typeof w2 === 'string' ? w2 : wave;
    oscB.frequency.value = freq;
    oscB.detune.value = detuneOf(dt);
    gainB = ctx.createGain();
    gainB.gain.value = level * bScale();
    targetB = level;
    oscB.connect(gainB).connect(gain);
    oscB.start(start);
  }

  const t = ctx.currentTime;
  const first = oscMix(mix);
  if (first.b > 0) {
    levelA = ctx.createGain();
    levelA.gain.value = first.a;
    osc.connect(levelA).connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(dest);
  gain.gain.setTargetAtTime(peak * own, t, fade / 4);
  osc.start(t);
  if (first.b > 0) makeSecond(t, wave2, detune, first.b);

  /** Where a second oscillator started `now` is in phase with A, which has run since `t`: a whole number of cycles later. */
  const alignedStart = (now) => (freq > 0 ? t + Math.ceil(Math.max(0, now - t) * freq - 1e-6) / freq : now);

  const freeA = () => {
    osc.disconnect();
    gain.disconnect();
    levelA?.disconnect();
    trim?.disconnect();
  };
  const freeB = () => {
    oscB?.disconnect();
    gainB?.disconnect();
  };
  return {
    setPeak(p) {
      gain.gain.setTargetAtTime(p * own, ctx.currentTime, fade / 4);
    },
    /** Moves the balance and detune of a voice (also one that is fading out); a sounding voice built without a second oscillator gets one. */
    setMix({ mix: m, detune: dt, wave2: w2 }) {
      const now = ctx.currentTime;
      const { a, b } = oscMix(m);
      if (!oscB) {
        if (released || b <= 0) return; // a fading voice never gets a new oscillator
        // Nothing is disconnected: A keeps feeding the voice and a trim path takes its level down (a gain of -b on top of 1).
        trim = ctx.createGain();
        trim.gain.value = 0;
        osc.connect(trim).connect(gain);
        makeSecond(alignedStart(now), w2, dt, 0);
      } else if (typeof w2 === 'string' && oscB.type !== w2 && targetB <= 0) {
        oscB.type = w2; // B is muted, so changing its wave cannot click
      }
      targetB = b;
      if (levelA) levelA.gain.setTargetAtTime(a, now, MIX_RAMP);
      else trim.gain.setTargetAtTime(0 - b, now, MIX_RAMP); // A * (1 + -b) = A * a, exactly
      gainB.gain.setTargetAtTime(b * bScale(), now, MIX_RAMP);
      oscB.detune.setTargetAtTime(detuneOf(dt), now, MIX_RAMP);
    },
    /** Stops immediately; only for voices that are already silent. */
    kill() {
      if (released) return;
      released = true;
      osc.onended = freeA;
      osc.stop(ctx.currentTime);
      if (oscB) {
        oscB.onended = freeB;
        oscB.stop(ctx.currentTime);
      }
    },
    release(f, onDone) {
      if (released) return;
      released = true;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(0, now, f / 4);
      osc.onended = () => {
        freeA();
        onDone?.();
      };
      osc.stop(now + f * 2);
      if (oscB) {
        oscB.onended = freeB;
        oscB.stop(now + f * 2);
      }
    },
  };
}

/**
 * A held note for live playing: up to three oscillators (`{ wave, level, octave, detune }`, a level of 0 is off) through
 * one ADSR envelope. It sounds until `release()`; the release time comes from `env.r`. `glideTo(freq, seconds)`
 * moves the held note to another pitch smoothly, without a new attack. Returns `{ release, glideTo, kill }`.
 */
export function startVoice(ctx, dest, { freq, oscs, env = DEFAULT_ENV, peak = 0.5 }) {
  const { a, d, s, r } = env;
  const time = ctx.currentTime;
  const gain = ctx.createGain();
  const active = oscs.filter((o) => o.level > 0);
  const total = active.reduce((sum, o) => sum + o.level, 0) || 1;
  const nodes = [gain];
  const sources = active.map((o) => {
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = o.wave;
    osc.frequency.value = freq * Math.pow(2, o.octave ?? 0);
    osc.detune.value = detuneOf(o.detune);
    level.gain.value = (o.level / total) * waveGain(o.wave); // the sum of the levels stays 1: more oscillators are not louder
    osc.connect(level).connect(gain);
    osc.start(time);
    nodes.push(osc, level);
    return osc;
  });
  const top = peak;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(top, time + Math.max(0.003, a));
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, top * s), time + Math.max(0.003, a) + d);
  gain.connect(dest);
  let done = false;
  const free = () => nodes.forEach((n) => n.disconnect());
  if (sources.length) sources[0].onended = free;
  else free();
  return {
    glideTo(next, seconds) {
      if (done) return;
      const now = ctx.currentTime;
      active.forEach((o, i) => {
        const f = sources[i].frequency;
        f.cancelScheduledValues(now);
        f.setValueAtTime(f.value, now);
        f.exponentialRampToValueAtTime(next * Math.pow(2, o.octave ?? 0), now + Math.max(0.005, seconds));
      });
    },
    release() {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      const tail = Math.max(0.03, r);
      const at = gain.gain.value; // where the envelope is now, so a release in the attack does not jump
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0.0001, at), now);
      gain.gain.setTargetAtTime(0, now, tail / 4);
      for (const o of sources) o.stop(now + tail * 1.6 + 0.05);
    },
    kill() {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.01);
      for (const o of sources) o.stop(now + 0.08);
    },
  };
}
