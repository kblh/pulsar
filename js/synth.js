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

function disconnectOnEnd(source, ...nodes) {
  source.onended = () => nodes.forEach((n) => n.disconnect());
}

export function playNote(ctx, dest, { freq, time, duration, wave, env = DEFAULT_ENV }) {
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
  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(end + r + 0.02);
  disconnectOnEnd(osc, osc, gain);
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
export function createDroneVoice(ctx, dest, { freq, wave, peak, fade }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  const t = ctx.currentTime;
  gain.gain.setTargetAtTime(peak, t, fade / 4);
  osc.start(t);
  let released = false;
  return {
    setWave(w) {
      osc.type = w;
    },
    release(f, onDone) {
      if (released) return;
      released = true;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(0, now, f / 4);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        onDone?.();
      };
      osc.stop(now + f * 2);
    },
  };
}
