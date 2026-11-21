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

export function playDrum(ctx, dest, { kind, time }) {
  if (kind === 'kick') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(gain).connect(dest);
    osc.start(time);
    osc.stop(time + 0.32);
    disconnectOnEnd(osc, osc, gain);
  } else if (kind === 'snare') {
    const noise = ctx.createBufferSource();
    const ngain = ctx.createGain();
    const tri = ctx.createOscillator();
    const tgain = ctx.createGain();
    noise.buffer = noiseBuffer(ctx);
    ngain.gain.setValueAtTime(0.5, time);
    ngain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    tri.type = 'triangle';
    tri.frequency.value = 180;
    tgain.gain.setValueAtTime(0.4, time);
    tgain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    noise.connect(ngain).connect(dest);
    tri.connect(tgain).connect(dest);
    noise.start(time);
    noise.stop(time + 0.2);
    tri.start(time);
    tri.stop(time + 0.12);
    disconnectOnEnd(noise, noise, ngain);
    disconnectOnEnd(tri, tri, tgain);
  } else {
    const noise = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    noise.buffer = noiseBuffer(ctx);
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(hp).connect(gain).connect(dest);
    noise.start(time);
    noise.stop(time + 0.06);
    disconnectOnEnd(noise, noise, hp, gain);
  }
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
