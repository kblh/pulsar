import { mulberry32 } from './rng.js';

const RAMP = 0.02; // seconds; parameter changes never jump
const REBUILD_DEBOUNCE_MS = 150;
const RETIRE_MS = 300;
const FADE = 0.05;
const MAX_TAIL_MS = 20000;

export const FX_DEFAULTS = {
  delay: { time: 350, feedback: 0.4, tone: 4000, return: 0.5 },
  reverb: { decay: 2.5, damping: 0.5, return: 0.5 },
};

const RANGES = {
  delay: { time: [10, 2000], feedback: [0, 0.9], tone: [200, 12000], return: [0, 1] },
  reverb: { decay: [0.3, 10], damping: [0, 1], return: [0, 1] },
};

/** The accepted value for a parameter, or null when the key or value is unusable. */
export function clampFxParam(type, key, value) {
  const range = RANGES[type]?.[key];
  if (!range) return null;
  if (value === null || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(range[1], Math.max(range[0], n));
}

function accept(type, params) {
  const p = { ...FX_DEFAULTS[type] };
  for (const k of Object.keys(p)) {
    const v = clampFxParam(type, k, params?.[k]);
    if (v !== null) p[k] = v;
  }
  return p;
}

/** Decaying noise, one channel each; `damping` darkens it with a one-pole lowpass. */
export function makeImpulse(decay, damping, sampleRate, rng) {
  const len = Math.ceil(decay * sampleRate);
  const a = 1 - 0.97 * damping;
  return [0, 1].map(() => {
    const out = new Float32Array(len);
    let y = 0;
    for (let i = 0; i < len; i++) {
      y += a * ((rng() * 2 - 1) - y);
      out[i] = y * Math.exp((-6.9 * i) / len);
    }
    return out;
  });
}

export function createDelay(ctx, params) {
  const p = accept('delay', params);
  const input = ctx.createGain();
  input.gain.value = 1;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = p.time / 1000;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = -3; // dB: the default (+1 dB) peaks above 1 and, inside the feedback loop, makes it unstable
  tone.frequency.value = p.tone;
  const feedback = ctx.createGain();
  feedback.gain.value = p.feedback;
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  input.connect(delay);
  delay.connect(tone);
  tone.connect(ret);
  tone.connect(feedback);
  feedback.connect(delay);

  const ramp = (param, v) => param.setTargetAtTime(v, ctx.currentTime, RAMP);
  const tailMs = () =>
    p.feedback <= 0 ? p.time : Math.min(MAX_TAIL_MS, (p.time * Math.log(0.001)) / Math.log(p.feedback));

  return {
    type: 'delay',
    params: p,
    input,
    output: ret,
    setParam(key, value) {
      const v = clampFxParam('delay', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'time') ramp(delay.delayTime, v / 1000);
      else if (key === 'feedback') ramp(feedback.gain, v);
      else if (key === 'tone') ramp(tone.frequency, v);
      else ramp(ret.gain, v);
    },
    tailMs,
    dispose: () => ret.gain.setTargetAtTime(0, ctx.currentTime, tailMs() / 4000),
    disconnect() {
      for (const n of [input, delay, tone, feedback, ret]) n.disconnect();
    },
  };
}

export function createReverb(ctx, params) {
  const p = accept('reverb', params);
  const input = ctx.createGain();
  input.gain.value = 1;
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  let seed = 1;
  let timer = null;
  const retiring = new Map(); // timer -> voice that is fading out

  function makeVoice(startGain) {
    const conv = ctx.createConvolver();
    const [l, r] = makeImpulse(p.decay, p.damping, ctx.sampleRate, mulberry32(seed++));
    const buffer = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buffer.getChannelData(0).set(l);
    buffer.getChannelData(1).set(r);
    conv.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = startGain;
    input.connect(conv);
    conv.connect(gain);
    gain.connect(ret);
    return { conv, gain };
  }
  const dropVoice = (v) => {
    input.disconnect(v.conv);
    v.conv.disconnect();
    v.gain.disconnect();
  };

  let voice = makeVoice(1);

  function rebuild() {
    timer = null;
    const old = voice;
    voice = makeVoice(0);
    voice.gain.gain.setTargetAtTime(1, ctx.currentTime, FADE);
    old.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE);
    const h = setTimeout(() => {
      retiring.delete(h);
      dropVoice(old);
    }, RETIRE_MS);
    retiring.set(h, old);
  }

  return {
    type: 'reverb',
    params: p,
    input,
    output: ret,
    setParam(key, value) {
      const v = clampFxParam('reverb', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'return') {
        ret.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(rebuild, REBUILD_DEBOUNCE_MS);
    },
    tailMs: () => p.decay * 1000,
    dispose: () => ret.gain.setTargetAtTime(0, ctx.currentTime, p.decay / 4),
    disconnect() {
      clearTimeout(timer);
      timer = null;
      for (const [h, v] of retiring) {
        clearTimeout(h);
        dropVoice(v);
      }
      retiring.clear();
      dropVoice(voice);
      input.disconnect();
      ret.disconnect();
    },
  };
}
