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
  gain.gain.linearRampToValueAtTime(0.6, time + a);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, 0.6 * s), time + a + d);
  gain.gain.setValueAtTime(Math.max(0.0001, 0.6 * s), end);
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
  gainA.gain.value = levelA;
  const gainB = ctx.createGain();
  gainB.gain.value = levelB;
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
  let gainA = null; // A's level stage, inserted once a second oscillator exists
  let oscB = null;
  let gainB = null;
  let released = false;

  function addSecond(start, w2, dt, levelA = 1, levelB = 0) {
    gainA = ctx.createGain();
    gainA.gain.value = levelA; // for a voice that already sounds this is A's old level (1), so inserting the stage is inaudible
    osc.disconnect();
    osc.connect(gainA).connect(gain);
    oscB = ctx.createOscillator();
    oscB.type = typeof w2 === 'string' ? w2 : wave;
    oscB.frequency.value = freq;
    oscB.detune.value = detuneOf(dt);
    gainB = ctx.createGain();
    gainB.gain.value = levelB; // for a voice that already sounds B fades in from silence (0)
    oscB.connect(gainB).connect(gain);
    oscB.start(start);
  }

  osc.connect(gain).connect(dest);
  const t = ctx.currentTime;
  gain.gain.setTargetAtTime(peak, t, fade / 4);
  osc.start(t);
  const start = oscMix(mix);
  if (start.b > 0) addSecond(t, wave2, detune, start.a, start.b);

  const freeA = () => {
    osc.disconnect();
    gain.disconnect();
    gainA?.disconnect();
  };
  const freeB = () => {
    oscB?.disconnect();
    gainB?.disconnect();
  };
  return {
    setPeak(p) {
      gain.gain.setTargetAtTime(p, ctx.currentTime, fade / 4);
    },
    /** Moves the balance and detune of a voice (also one that is fading out); a sounding voice built without a second oscillator gets one. */
    setMix({ mix: m, detune: dt, wave2: w2 }) {
      const now = ctx.currentTime;
      const { a, b } = oscMix(m);
      if (!oscB) {
        if (released || b <= 0) return; // a fading voice never gets a new oscillator
        addSecond(now, w2, dt);
      }
      gainA.gain.setTargetAtTime(a, now, MIX_RAMP);
      gainB.gain.setTargetAtTime(b, now, MIX_RAMP);
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
