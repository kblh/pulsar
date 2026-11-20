import { mulberry32 } from './rng.js';
import { hasWorklet } from './worklet.js';

const RAMP = 0.02; // seconds; parameter changes never jump
const REBUILD_DEBOUNCE_MS = 150;
const RETIRE_MS = 300;
const FADE = 0.05;
const MAX_TAIL_MS = 20000;

export const FX_DEFAULTS = {
  delay: { time: 350, feedback: 0.4, tone: 4000, return: 0.5, pingpong: 0 },
  reverb: { decay: 2.5, damping: 0.5, return: 0.5, width: 1 },
  eq: { low: 0, mid: 0, high: 0, midFreq: 1000, return: 0.5 },
  bitcrusher: { bits: 8, rate: 4, return: 0.5 },
};

export const FX_RANGES = {
  delay: { time: [10, 2000], feedback: [0, 0.9], tone: [200, 12000], return: [0, 1], pingpong: [0, 1] },
  reverb: { decay: [0.3, 10], damping: [0, 1], return: [0, 1], width: [0, 1] },
  eq: { low: [-12, 12], mid: [-12, 12], high: [-12, 12], midFreq: [200, 5000], return: [0, 1] },
  bitcrusher: { bits: [1, 16], rate: [1, 32], return: [0, 1] },
};

/** The accepted value for a parameter, or null when the key or value is unusable. */
export function clampFxParam(type, key, value) {
  const range = FX_RANGES[type]?.[key];
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

/**
 * The worst-case gain of the delay's feedback loop (the lowpass in the loop peaks at or below 1, see the Q test).
 * The straight and the crossed feedback together always carry `feedback`, so ping-pong cannot make the loop unstable.
 */
export function delayLoopGain({ feedback, pingpong }) {
  const fb = clampFxParam('delay', 'feedback', feedback) ?? 0;
  const pp = clampFxParam('delay', 'pingpong', pingpong) ?? 0;
  return fb * (1 - pp + pp);
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
  const feedback = ctx.createGain(); // the straight feedback path
  feedback.gain.value = p.feedback * (1 - p.pingpong);
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  // Ping-pong: the input is also summed to mono into the left channel only, and a second feedback path swaps the
  // channels, so the echoes alternate left and right. At 0 only the straight paths carry signal.
  const straightIn = ctx.createGain();
  straightIn.gain.value = 1 - p.pingpong;
  const ppIn = ctx.createGain();
  ppIn.gain.value = p.pingpong;
  const toLeft = ctx.createChannelMerger(2);
  const swapIn = ctx.createChannelSplitter(2);
  const swapOut = ctx.createChannelMerger(2);
  const cross = ctx.createGain(); // the crossed feedback path
  cross.gain.value = p.feedback * p.pingpong;
  input.connect(straightIn);
  straightIn.connect(delay);
  input.connect(toLeft);
  toLeft.connect(ppIn);
  ppIn.connect(delay);
  delay.connect(tone);
  tone.connect(ret);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(swapIn);
  swapIn.connect(swapOut, 0, 1);
  swapIn.connect(swapOut, 1, 0);
  swapOut.connect(cross);
  cross.connect(delay);

  const ramp = (param, v) => param.setTargetAtTime(v, ctx.currentTime, RAMP);
  const applyMix = () => {
    ramp(feedback.gain, p.feedback * (1 - p.pingpong));
    ramp(cross.gain, p.feedback * p.pingpong);
    ramp(straightIn.gain, 1 - p.pingpong);
    ramp(ppIn.gain, p.pingpong);
  };
  let enabled = true;
  const tailMs = () =>
    p.feedback <= 0 ? p.time : Math.min(MAX_TAIL_MS, (p.time * Math.log(0.001)) / Math.log(p.feedback));

  return {
    type: 'delay',
    params: p,
    input,
    output: ret,
    get enabled() { return enabled; },
    /** Bypass: mutes the return only, so sends keep flowing and nothing clicks on the way back. */
    setEnabled(on) {
      enabled = Boolean(on);
      ramp(ret.gain, enabled ? p.return : 0);
    },
    setParam(key, value) {
      const v = clampFxParam('delay', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'time') ramp(delay.delayTime, v / 1000);
      else if (key === 'feedback' || key === 'pingpong') applyMix();
      else if (key === 'tone') ramp(tone.frequency, v);
      else if (key === 'return' && enabled) ramp(ret.gain, v);
    },
    tailMs,
    dispose: () => ret.gain.setTargetAtTime(0, ctx.currentTime, tailMs() / 4000),
    disconnect() {
      for (const n of [input, straightIn, ppIn, toLeft, delay, tone, feedback, swapIn, swapOut, cross, ret]) n.disconnect();
    },
  };
}

export function createReverb(ctx, params) {
  const p = accept('reverb', params);
  const input = ctx.createGain();
  input.gain.value = 1;
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  // Width: the wet channels go through two panners; +-1 keeps them apart (as before), 0 centres both (mono).
  const widthIn = ctx.createChannelSplitter(2);
  const panL = ctx.createStereoPanner();
  panL.pan.value = 0 - p.width;
  const panR = ctx.createStereoPanner();
  panR.pan.value = p.width;
  widthIn.connect(panL, 0);
  widthIn.connect(panR, 1);
  panL.connect(ret);
  panR.connect(ret);
  let seed = 1;
  let timer = null;
  const retiring = new Map(); // timer -> voice that is fading out
  let enabled = true;

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
    gain.connect(widthIn);
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
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = Boolean(on);
      ret.gain.setTargetAtTime(enabled ? p.return : 0, ctx.currentTime, RAMP);
    },
    setParam(key, value) {
      const v = clampFxParam('reverb', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'return') {
        if (enabled) ret.gain.setTargetAtTime(v, ctx.currentTime, RAMP);
        return;
      }
      if (key === 'width') {
        panL.pan.setTargetAtTime(0 - v, ctx.currentTime, RAMP);
        panR.pan.setTargetAtTime(v, ctx.currentTime, RAMP);
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
      for (const n of [widthIn, panL, panR]) n.disconnect();
      input.disconnect();
      ret.disconnect();
    },
  };
}

const EQ_LOW_HZ = 200;
const EQ_HIGH_HZ = 4000;
const EQ_TAIL_MS = 100;

/** Three bands in a row: low shelf, a peaking mid you can tune, high shelf. Biquads treat each channel alone, so L/R stay apart. */
export function createEq(ctx, params) {
  const p = accept('eq', params);
  const input = ctx.createGain();
  input.gain.value = 1;
  const band = (type, freq, gainDb, q) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.gain.value = gainDb;
    if (q !== undefined) f.Q.value = q;
    return f;
  };
  const low = band('lowshelf', EQ_LOW_HZ, p.low);
  const mid = band('peaking', p.midFreq, p.mid, 1);
  const high = band('highshelf', EQ_HIGH_HZ, p.high);
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  input.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(ret);

  const ramp = (param, v) => param.setTargetAtTime(v, ctx.currentTime, RAMP);
  let enabled = true;
  return {
    type: 'eq',
    params: p,
    input,
    output: ret,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = Boolean(on);
      ramp(ret.gain, enabled ? p.return : 0);
    },
    setParam(key, value) {
      const v = clampFxParam('eq', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'low') ramp(low.gain, v);
      else if (key === 'mid') ramp(mid.gain, v);
      else if (key === 'high') ramp(high.gain, v);
      else if (key === 'midFreq') ramp(mid.frequency, v);
      else if (key === 'return' && enabled) ramp(ret.gain, v);
    },
    tailMs: () => EQ_TAIL_MS,
    dispose: () => ret.gain.setTargetAtTime(0, ctx.currentTime, EQ_TAIL_MS / 4000),
    disconnect() {
      for (const n of [input, low, mid, high, ret]) n.disconnect();
    },
  };
}

const CRUSHER_TAIL_MS = 50;

/** Types that cannot be built without the AudioWorklet module (the UI hides them, scene load skips them). */
export const FX_NEEDS_WORKLET = ['bitcrusher'];

/** Lower bit depth and sample rate on an AudioWorklet; throws when the worklet did not load. */
export function createBitcrusher(ctx, params) {
  if (!hasWorklet(ctx)) throw new Error('bitcrusher needs AudioWorklet');
  const p = accept('bitcrusher', params);
  const input = ctx.createGain();
  input.gain.value = 1;
  const node = new AudioWorkletNode(ctx, 'pulsar-bitcrusher', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    parameterData: { bits: p.bits, rate: p.rate },
  });
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  input.connect(node);
  node.connect(ret);

  const ramp = (param, v) => param.setTargetAtTime(v, ctx.currentTime, RAMP);
  let enabled = true;
  return {
    type: 'bitcrusher',
    params: p,
    input,
    output: ret,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = Boolean(on);
      ramp(ret.gain, enabled ? p.return : 0);
    },
    setParam(key, value) {
      const v = clampFxParam('bitcrusher', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'bits' || key === 'rate') ramp(node.parameters.get(key), v);
      else if (key === 'return' && enabled) ramp(ret.gain, v);
    },
    tailMs: () => CRUSHER_TAIL_MS,
    dispose: () => ret.gain.setTargetAtTime(0, ctx.currentTime, CRUSHER_TAIL_MS / 4000),
    disconnect() {
      for (const n of [input, node, ret]) n.disconnect();
      node.port.postMessage('stop');
    },
  };
}

const MAKERS = { delay: createDelay, reverb: createReverb, eq: createEq, bitcrusher: createBitcrusher };

/** Every effect type the app knows, in menu order. Defaults, ranges and factories above are keyed by these. */
export const FX_TYPES = Object.keys(MAKERS);

export function createEffect(ctx, type, params) {
  const make = MAKERS[type];
  if (!make) throw new Error(`unknown effect: ${type}`);
  return make(ctx, params);
}
