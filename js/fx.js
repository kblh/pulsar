import { hasWorklet } from './worklet.js';

const RAMP = 0.02; // seconds; parameter changes never jump
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

// Algorithmic reverb (Freeverb): parallel feedback combs into series allpasses, one chain per channel. A convolver with
// a decaying-noise impulse sounded similar but cost 9% (decay 2.5 s) to 37% (10 s) of real time on a desktop, 70% while
// a rebuild had two running, which on a phone ends in dropouts that sound like crackle. This costs about 4% whatever the
// decay, and every parameter is a plain ramped AudioParam: no rebuild, no crossfade, no impulse built on the main thread.
const REVERB_COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]; // delay lengths in samples at 44.1 kHz
const REVERB_ALLPASS = [556, 441, 341, 225];
const REVERB_SPREAD = 23; // samples: the right channel's delays are longer by this, which decorrelates the channels
const REVERB_RATE = 44100;
const REVERB_ALLPASS_GAIN = 0.5;
const REVERB_SMOOTH = 0.1; // seconds (time constant) for decay and damping moves
const REVERB_LEVEL = 0.068; // input scale: keeps the wet level near the old convolver's at the defaults
const REVERB_REF_DECAY = FX_DEFAULTS.reverb.decay;

/** Cutoff of the lowpass in each comb's loop: 12 kHz at damping 0 down to 1.5 kHz at 1. */
export const reverbDampHz = (damping) => 12000 * (1500 / 12000) ** damping;
/** Feedback of a comb with a loop of `delay` seconds so that it falls 60 dB in `decay` seconds. */
export const reverbCombFeedback = (delay, decay) => 10 ** ((-3 * delay) / decay);
/** The energy a comb stores grows with the decay time; this keeps the wet level the same at every decay. */
const reverbInputGain = (decay) => REVERB_LEVEL * Math.sqrt(REVERB_REF_DECAY / decay);

export function createReverb(ctx, params) {
  const p = accept('reverb', params);
  const input = ctx.createGain();
  input.gain.value = 1;
  const ret = ctx.createGain();
  ret.gain.value = p.return;
  const nodes = [input, ret];
  const own = (n) => {
    nodes.push(n);
    return n;
  };
  const send = own(ctx.createGain());
  send.channelCount = 1;
  send.channelCountMode = 'explicit'; // the reverb takes the sum of both channels, like Freeverb
  send.gain.value = reverbInputGain(p.decay);
  input.connect(send);
  const combs = [];
  const delayLine = (seconds) => {
    const d = own(ctx.createDelay(0.1));
    d.delayTime.value = seconds;
    return d;
  };
  // w[n] = x[n] + g w[n-D]; y[n] = -g w[n] + w[n-D]
  const allpass = (from, seconds) => {
    const w = own(ctx.createGain());
    const dl = delayLine(seconds);
    const back = own(ctx.createGain());
    back.gain.value = REVERB_ALLPASS_GAIN;
    const front = own(ctx.createGain());
    front.gain.value = 0 - REVERB_ALLPASS_GAIN;
    const out = own(ctx.createGain());
    from.connect(w);
    w.connect(dl);
    dl.connect(back);
    back.connect(w);
    w.connect(front);
    front.connect(out);
    dl.connect(out);
    return out;
  };
  // Width: the two channels go through panners; +-1 keeps them apart, 0 centres both (mono).
  const pans = [0 - p.width, p.width].map((pan) => {
    const node = own(ctx.createStereoPanner());
    node.pan.value = pan;
    node.connect(ret);
    return node;
  });
  pans.forEach((panner, side) => {
    const sum = own(ctx.createGain());
    for (const len of REVERB_COMBS) {
      const seconds = (len + side * REVERB_SPREAD) / REVERB_RATE;
      const dl = delayLine(seconds);
      const damp = own(ctx.createBiquadFilter());
      damp.type = 'lowpass';
      damp.Q.value = -3; // dB: like the delay's tone filter, never above 1 inside a feedback loop
      damp.frequency.value = reverbDampHz(p.damping);
      const fb = own(ctx.createGain());
      fb.gain.value = reverbCombFeedback(seconds, p.decay);
      send.connect(dl);
      dl.connect(damp);
      damp.connect(fb);
      fb.connect(dl);
      damp.connect(sum);
      combs.push({ damp, fb, seconds });
    }
    let chain = sum;
    for (const len of REVERB_ALLPASS) chain = allpass(chain, (len + side * REVERB_SPREAD) / REVERB_RATE);
    chain.connect(panner);
  });
  const [panL, panR] = pans;
  const ramp = (param, v, tau = REVERB_SMOOTH) => param.setTargetAtTime(v, ctx.currentTime, tau);
  let enabled = true;

  return {
    type: 'reverb',
    params: p,
    input,
    output: ret,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = Boolean(on);
      ramp(ret.gain, enabled ? p.return : 0, RAMP);
    },
    setParam(key, value) {
      const v = clampFxParam('reverb', key, value);
      if (v === null) return;
      p[key] = v;
      if (key === 'return') {
        if (enabled) ramp(ret.gain, v, RAMP);
      } else if (key === 'width') {
        ramp(panL.pan, 0 - v, RAMP);
        ramp(panR.pan, v, RAMP);
      } else if (key === 'decay') {
        for (const c of combs) ramp(c.fb.gain, reverbCombFeedback(c.seconds, v));
        ramp(send.gain, reverbInputGain(v));
      } else if (key === 'damping') {
        for (const c of combs) ramp(c.damp.frequency, reverbDampHz(v));
      }
    },
    tailMs: () => p.decay * 1000,
    dispose: () => ret.gain.setTargetAtTime(0, ctx.currentTime, p.decay / 4),
    disconnect() {
      for (const n of nodes) n.disconnect();
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
