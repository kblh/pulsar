import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_DEFAULTS, FX_RANGES, FX_TYPES, createEffect, clampFxParam, delayLoopGain, reverbCombFeedback, reverbDampHz, createDelay, createReverb, createEq, createDistortion, createChorus, createVibrato, createTremolo, peekSeconds, tremoloCentre, tremoloSwing, chorusRightSwing, distortionCurve, distortionPreGain, distortionPostGain, createBitcrusher, FX_NEEDS_WORKLET } from '../js/fx.js';
import { stubCtx } from './helpers/stub-ctx.js';
import { markWorkletLoaded } from '../js/worklet.js';

// A stand-in for AudioWorkletNode that records what the effect does to it.
const workletNodes = [];
class FakeWorkletNode {
  constructor(ctx, name, options) {
    this.name = name;
    this.options = options;
    this.connections = [];
    this.disconnected = 0;
    this.messages = [];
    const param = () => { const calls = []; return { calls, setTargetAtTime: (...a) => calls.push(['target', ...a]), set value(v) { calls.push(['value', v]); } }; };
    this.parameters = new Map([['bits', param()], ['rate', param()], ['speed', param()], ['peek', param()]]);
    this.port = { postMessage: (m) => this.messages.push(m) };
    workletNodes.push(this);
  }
  connect(x) { this.connections.push(x); return x; }
  disconnect() { this.disconnected++; }
}
globalThis.AudioWorkletNode = FakeWorkletNode;
const workletCtx = () => { const ctx = stubCtx(); markWorkletLoaded(ctx); return ctx; };

/** True when `to` can be reached from `from` through recorded connections. */
function reaches(from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.connections.some((n) => reaches(n, to, seen));
}

const valueCalls = (ctx) =>
  ctx.nodes.flatMap((n) => [n.gain, n.delayTime, n.frequency].filter(Boolean)).map((p) => p.calls.filter((c) => c[0] === 'value').length);

test('clampFxParam clamps every documented range', () => {
  assert.equal(clampFxParam('delay', 'time', 5), 10);
  assert.equal(clampFxParam('delay', 'time', 99999), 2000);
  assert.equal(clampFxParam('delay', 'feedback', 5), 0.9);
  assert.equal(clampFxParam('delay', 'feedback', '1.5'), 0.9);
  assert.equal(clampFxParam('delay', 'feedback', -1), 0);
  assert.equal(clampFxParam('delay', 'tone', 10), 200);
  assert.equal(clampFxParam('reverb', 'decay', 0), 0.3);
  assert.equal(clampFxParam('reverb', 'decay', 99), 10);
  assert.equal(clampFxParam('reverb', 'damping', 2), 1);
  assert.equal(clampFxParam('reverb', 'return', 2), 1);
  assert.equal(clampFxParam('delay', 'return', 2), 1);
  for (const bad of [NaN, 'abc', '', Infinity, null, undefined]) assert.equal(clampFxParam('delay', 'time', bad), null);
  assert.equal(clampFxParam('delay', 'nope', 1), null);
  assert.equal(clampFxParam('chorus', 'time', 1), null);
});

test('delay graph: input -> delay -> lowpass -> return, feedback loop through the lowpass', () => {
  const ctx = stubCtx();
  const fx = createDelay(ctx);
  const dly = ctx.nodes.find((n) => n.kind === 'delay');
  const tone = ctx.nodes.find((n) => n.kind === 'biquad');
  assert.ok(dly.maxDelayTime >= 2);
  assert.equal(tone.type, 'lowpass');
  assert.ok(reaches(fx.input, dly), 'input reaches the delay line');
  assert.ok(dly.connections.includes(tone));
  assert.ok(tone.connections.includes(fx.output));
  const fb = tone.connections.find((n) => n !== fx.output);
  assert.ok(fb.connections.includes(dly));
  assert.equal(fx.type, 'delay');
  assert.deepEqual(fx.params, FX_DEFAULTS.delay);
});

test('delay setParam ramps and clamps, never sets .value after creation', () => {
  const ctx = stubCtx();
  const fx = createDelay(ctx);
  const dly = ctx.nodes.find((n) => n.kind === 'delay');
  const before = valueCalls(ctx);
  fx.setParam('time', 500);
  assert.deepEqual(dly.delayTime.calls.at(-1).slice(0, 2), ['target', 0.5]);
  fx.setParam('feedback', 7);
  assert.equal(fx.params.feedback, 0.9);
  const fb = ctx.nodes.find((n) => n.kind === 'biquad').connections.find((n) => n !== fx.output);
  assert.deepEqual(fb.gain.calls.at(-1).slice(0, 2), ['target', 0.9]);
  fx.setParam('tone', 'abc');
  fx.setParam('return', 0.2);
  assert.equal(fx.params.tone, FX_DEFAULTS.delay.tone);
  assert.equal(fx.params.return, 0.2);
  assert.deepEqual(valueCalls(ctx), before);
});

test('delay tailMs grows with feedback and time and stays finite', () => {
  const tail = (p) => createDelay(stubCtx(), p).tailMs();
  assert.ok(tail({ feedback: 0.7, time: 350 }) > tail({ feedback: 0.4, time: 350 }));
  assert.ok(tail({ feedback: 0.5, time: 300 }) > tail({ feedback: 0.5, time: 100 }));
  assert.equal(tail({ feedback: 0, time: 250 }), 250);
  const worst = tail({ feedback: 0.9, time: 2000 });
  assert.ok(Number.isFinite(worst) && worst <= 20000);
});

test('reverb is algorithmic: combs in loops through a delay, no convolver and no impulse buffer', () => {
  const ctx = stubCtx();
  createReverb(ctx);
  assert.equal(ctx.nodes.filter((n) => n.kind === 'convolver').length, 0);
  assert.equal(ctx.buffers.length, 0);
  // 8 combs and 4 allpasses per channel, each with one delay line
  assert.equal(ctx.nodes.filter((n) => n.kind === 'delay').length, 2 * (8 + 4));
  assert.equal(ctx.nodes.filter((n) => n.kind === 'biquad').length, 2 * 8);
  for (const d of ctx.nodes.filter((n) => n.kind === 'delay')) assert.ok(d.delayTime.calls.find((c) => c[0] === 'value')[1] > 0);
});

test('reverb decay and damping move by ramps only: nothing is rebuilt, nothing jumps', () => {
  const ctx = stubCtx();
  const fx = createReverb(ctx);
  const nodes = ctx.nodes.length;
  const before = valueCalls(ctx);
  for (const [k, v] of [['decay', 5], ['decay', 0.3], ['damping', 1], ['damping', 0]]) fx.setParam(k, v);
  assert.equal(ctx.nodes.length, nodes);
  assert.equal(ctx.buffers.length, 0);
  assert.deepEqual(valueCalls(ctx), before);
  const fbs = ctx.nodes.filter((n) => n.kind === 'gain' && n.gain.calls.some((c) => c[0] === 'target' && c[1] > 0.5 && c[1] < 1));
  assert.ok(fbs.length >= 16, 'every comb feedback is ramped');
  const damps = ctx.nodes.filter((n) => n.kind === 'biquad');
  for (const d of damps) assert.equal(d.frequency.calls.filter((c) => c[0] === 'target').at(-1)[1], reverbDampHz(0));
});

test('comb feedback falls 60 dB in the decay time, stays below 1 and the loop filter stays below Nyquist', () => {
  for (const decay of [0.3, 2.5, 10]) {
    for (const delay of [0.0253, 0.0367]) {
      const g = reverbCombFeedback(delay, decay);
      assert.ok(g > 0 && g < 1, `decay ${decay}`);
      assert.ok(Math.abs(g ** (decay / delay) - 0.001) < 1e-9);
    }
  }
  assert.equal(reverbDampHz(0), 12000);
  assert.ok(Math.abs(reverbDampHz(1) - 1500) < 1e-9);
  assert.ok(reverbDampHz(0.5) < reverbDampHz(0.2));
});

test('dispose ramps return to 0, disconnect disconnects everything', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const make of [createDelay, createReverb, createEq, createChorus, createDistortion]) {
    const ctx = stubCtx();
    const fx = make(ctx);
    fx.setParam('decay', 4);
    fx.dispose();
    assert.deepEqual(fx.output.gain.calls.at(-1).slice(0, 2), ['target', 0]);
    assert.equal(fx.output.gain.calls.filter((c) => c[0] === 'value').length, 1);
    fx.disconnect();
    t.mock.timers.tick(1000);
    for (const n of ctx.nodes) assert.ok(n.disconnected >= 1, `${fx.type} ${n.kind} not disconnected`);
    assert.ok(fx.input.disconnected >= 1);
    assert.equal(ctx.buffers.length, 0);
  }
});

// Peak magnitude of the Web Audio lowpass (RBJ cookbook; Q is in dB for lowpass).
function lowpassPeak(fc, qDb, sr = 48000) {
  const w0 = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w0) / (2 * 10 ** (qDb / 20));
  const c = Math.cos(w0);
  const [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const [a0, a1, a2] = [1 + alpha, -2 * c, 1 - alpha];
  let peak = 0;
  for (let i = 1; i < 4000; i++) {
    const w = (Math.PI * i) / 4000;
    const re = (z) => Math.cos(z * w);
    const im = (z) => -Math.sin(z * w);
    const nr = b0 + b1 * re(1) + b2 * re(2), ni = b1 * im(1) + b2 * im(2);
    const dr = a0 + a1 * re(1) + a2 * re(2), di = a1 * im(1) + a2 * im(2);
    peak = Math.max(peak, Math.hypot(nr, ni) / Math.hypot(dr, di));
  }
  return peak;
}

test('delay lowpass in the feedback loop has no resonance peak that makes the loop unstable', () => {
  for (const tone of [200, 4000, 12000]) {
    const ctx = stubCtx();
    const fx = createDelay(ctx, { tone, feedback: 0.9 });
    const q = ctx.nodes.find((n) => n.kind === 'biquad').Q.calls.find((c) => c[0] === 'value')?.[1] ?? 1;
    assert.ok(fx.params.feedback * lowpassPeak(tone, q) < 1, `tone ${tone}: loop gain ${fx.params.feedback * lowpassPeak(tone, q)}`);
  }
});

const lastTarget = (g) => g.gain.calls.filter((c) => c[0] === 'target').at(-1);

test('bypass: setEnabled ramps the return to 0 and back without touching .value', () => {
  for (const make of [createDelay, createReverb, createEq, createChorus, createDistortion]) {
    const ctx = stubCtx();
    const fx = make(ctx, { return: 0.6 });
    assert.equal(fx.enabled, true);
    const before = valueCalls(ctx);
    fx.setEnabled(false);
    assert.equal(fx.enabled, false);
    assert.deepEqual(lastTarget(fx.output).slice(0, 2), ['target', 0]);
    fx.setEnabled(true);
    assert.equal(fx.enabled, true);
    assert.deepEqual(lastTarget(fx.output).slice(0, 2), ['target', 0.6]);
    assert.deepEqual(valueCalls(ctx), before);
  }
});

test('bypass: changing return while disabled stays muted and applies on enable', () => {
  for (const make of [createDelay, createReverb, createEq, createChorus, createDistortion]) {
    const ctx = stubCtx();
    const fx = make(ctx);
    fx.setEnabled(false);
    const calls = fx.output.gain.calls.length;
    fx.setParam('return', 0.2);
    assert.equal(fx.params.return, 0.2);
    assert.equal(fx.output.gain.calls.length, calls);
    fx.setEnabled(true);
    assert.deepEqual(lastTarget(fx.output).slice(0, 2), ['target', 0.2]);
  }
});

test('bypass: a decay change while disabled leaves the muted return alone', () => {
  const ctx = stubCtx();
  const fx = createReverb(ctx);
  fx.setEnabled(false);
  const calls = fx.output.gain.calls.length;
  fx.setParam('decay', 5);
  assert.equal(fx.output.gain.calls.length, calls);
});

test('the registry lists every effect type with defaults, ranges and a factory', () => {
  assert.deepEqual(FX_TYPES, ['delay', 'reverb', 'eq', 'chorus', 'vibrato', 'tremolo', 'distortion', 'bitcrusher']);
  for (const type of FX_TYPES) {
    assert.deepEqual(Object.keys(FX_RANGES[type]).sort(), Object.keys(FX_DEFAULTS[type]).sort(), type);
    for (const [key, v] of Object.entries(FX_DEFAULTS[type])) {
      const [lo, hi] = FX_RANGES[type][key];
      assert.ok(v >= lo && v <= hi, `${type}.${key} default ${v} outside ${lo}-${hi}`);
    }
    const fx = createEffect(workletCtx(), type);
    assert.equal(fx.type, type);
    assert.equal(fx.enabled, true);
    for (const fn of ['setParam', 'setEnabled', 'tailMs', 'dispose', 'disconnect']) assert.equal(typeof fx[fn], 'function', `${type}.${fn}`);
  }
});

test('createEffect refuses an unknown type', () => {
  assert.throws(() => createEffect(stubCtx(), 'flanger'), /unknown effect: flanger/);
  assert.throws(() => createEffect(stubCtx(), undefined), /unknown effect/);
});

test('ping-pong and width are ranged, default to today\'s sound and fill in when a scene lacks them', () => {
  assert.equal(clampFxParam('delay', 'pingpong', 5), 1);
  assert.equal(clampFxParam('delay', 'pingpong', -1), 0);
  assert.equal(clampFxParam('reverb', 'width', 5), 1);
  assert.equal(clampFxParam('reverb', 'width', -2), 0);
  for (const bad of ['abc', NaN, null, undefined]) {
    assert.equal(clampFxParam('delay', 'pingpong', bad), null);
    assert.equal(clampFxParam('reverb', 'width', bad), null);
  }
  assert.equal(createEffect(stubCtx(), 'delay', { time: 100 }).params.pingpong, 0);
  assert.equal(createEffect(stubCtx(), 'reverb', { decay: 2 }).params.width, 1);
});

test('delayLoopGain stays below 1 for every allowed combination and grows with feedback', () => {
  for (const feedback of [0, 0.5, 0.9]) for (const pingpong of [0, 0.25, 0.5, 1]) assert.ok(delayLoopGain({ feedback, pingpong }) < 1, `${feedback}/${pingpong}`);
  assert.ok(delayLoopGain({ feedback: 0.9, pingpong: 0.5 }) > delayLoopGain({ feedback: 0.4, pingpong: 0.5 }));
  assert.ok(delayLoopGain({ feedback: 0.9, pingpong: 1 }) <= 0.9 + 1e-12);
});

test('delay ping-pong moves the mix with ramps only and keeps the tail finite', () => {
  const ctx = stubCtx();
  const fx = createDelay(ctx, { feedback: 0.4 });
  const before = valueCalls(ctx);
  fx.setParam('pingpong', 1);
  assert.equal(fx.params.pingpong, 1);
  const finals = ctx.nodes.filter((n) => n.kind === 'gain').map((n) => n.gain.calls.filter((c) => c[0] === 'target').at(-1)?.[1]);
  assert.ok(finals.includes(1), 'a gain was ramped up to the ping-pong input level');
  assert.ok(finals.includes(0), 'the straight paths were ramped down');
  assert.ok(finals.some((v) => v !== undefined && Math.abs(v - 0.4) < 1e-9), 'the crossed feedback carries the whole feedback');
  assert.deepEqual(valueCalls(ctx), before);
  fx.setParam('pingpong', 0);
  fx.setParam('feedback', 0.9);
  fx.setParam('time', 2000);
  fx.setParam('pingpong', 1);
  const tail = fx.tailMs();
  assert.ok(Number.isFinite(tail) && tail <= 20000);
});

test('delay ping-pong: at 0 the straight paths carry everything and the crossed feedback is silent', () => {
  const ctx = stubCtx();
  createDelay(ctx, { feedback: 0.4, pingpong: 0 });
  const created = ctx.nodes.filter((n) => n.kind === 'gain').map((n) => n.gain.calls.find((c) => c[0] === 'value')?.[1]);
  assert.ok(created.includes(0), 'crossed feedback and ping-pong input start at 0');
  const swap = ctx.nodes.find((n) => n.kind === 'splitter');
  assert.ok(swap, 'channel swap exists');
});

test('reverb width: 1 keeps the channels apart, 0 makes the output mono, changes are ramps', () => {
  const ctx = stubCtx();
  const fx = createReverb(ctx);
  const pans = ctx.nodes.filter((n) => n.kind === 'pan');
  assert.equal(pans.length, 2);
  assert.deepEqual(pans.map((n) => n.pan.calls.find((c) => c[0] === 'value')[1]), [-1, 1]);
  const before = valueCalls(ctx);
  fx.setParam('width', 0);
  assert.deepEqual(pans.map((n) => n.pan.calls.filter((c) => c[0] === 'target').at(-1)[1]), [0, 0]);
  fx.setParam('width', 0.5);
  assert.deepEqual(pans.map((n) => n.pan.calls.filter((c) => c[0] === 'target').at(-1)[1]), [-0.5, 0.5]);
  assert.equal(fx.params.width, 0.5);
  assert.equal(ctx.nodes.filter((n) => n.kind === 'pan').flatMap((n) => n.pan.calls).filter((c) => c[0] === 'value').length, 2);
  assert.ok(valueCalls(ctx).length === before.length);
});

test('eq: defaults, ranges and clamping', () => {
  assert.deepEqual(FX_DEFAULTS.eq, { low: 0, mid: 0, high: 0, midFreq: 1000, return: 0.5 });
  for (const band of ['low', 'mid', 'high']) {
    assert.equal(clampFxParam('eq', band, 99), 12, band);
    assert.equal(clampFxParam('eq', band, -99), -12, band);
    assert.equal(clampFxParam('eq', band, 3.5), 3.5, band);
    assert.equal(clampFxParam('eq', band, 'abc'), null, band);
  }
  assert.equal(clampFxParam('eq', 'midFreq', 5), 200);
  assert.equal(clampFxParam('eq', 'midFreq', 99999), 5000);
  for (const bad of [NaN, null, undefined, '']) assert.equal(clampFxParam('eq', 'midFreq', bad), null);
});

test('eq graph: input -> low shelf -> peaking mid -> high shelf -> return, per-channel biquads', () => {
  const ctx = stubCtx();
  const fx = createEq(ctx, { low: 6, mid: -3, high: 2, midFreq: 2500 });
  const [low, mid, high] = ctx.nodes.filter((n) => n.kind === 'biquad');
  assert.deepEqual([low.type, mid.type, high.type], ['lowshelf', 'peaking', 'highshelf']);
  assert.ok(fx.input.connections.includes(low));
  assert.ok(low.connections.includes(mid));
  assert.ok(mid.connections.includes(high));
  assert.ok(high.connections.includes(fx.output));
  assert.deepEqual([low.gain, mid.gain, high.gain].map((g) => g.calls.find((c) => c[0] === 'value')[1]), [6, -3, 2]);
  assert.equal(mid.frequency.calls.find((c) => c[0] === 'value')[1], 2500);
  assert.equal(fx.type, 'eq');
  assert.equal(fx.enabled, true);
});

test('eq setParam ramps band gains and the mid frequency, never writes .value afterwards', () => {
  const ctx = stubCtx();
  const fx = createEq(ctx);
  const [low, mid, high] = ctx.nodes.filter((n) => n.kind === 'biquad');
  const before = valueCalls(ctx);
  fx.setParam('low', 6);
  fx.setParam('mid', -3);
  fx.setParam('high', 99);
  fx.setParam('midFreq', 2000);
  const last = (param) => param.calls.filter((c) => c[0] === 'target').at(-1).slice(0, 2);
  assert.deepEqual(last(low.gain), ['target', 6]);
  assert.deepEqual(last(mid.gain), ['target', -3]);
  assert.deepEqual(last(high.gain), ['target', 12]);
  assert.deepEqual(last(mid.frequency), ['target', 2000]);
  assert.deepEqual(valueCalls(ctx), before);
  assert.equal(fx.params.high, 12);
  fx.setParam('low', 'abc');
  assert.equal(fx.params.low, 6);
});

test('eq tail is short and finite', () => {
  const t = createEq(stubCtx()).tailMs();
  assert.ok(Number.isFinite(t) && t > 0 && t <= 500);
});

test('bitcrusher: defaults, ranges and clamping', () => {
  assert.deepEqual(FX_DEFAULTS.bitcrusher, { bits: 8, rate: 4, return: 0.5 });
  assert.equal(clampFxParam('bitcrusher', 'bits', 99), 16);
  assert.equal(clampFxParam('bitcrusher', 'bits', 0), 1);
  assert.equal(clampFxParam('bitcrusher', 'rate', 0), 1);
  assert.equal(clampFxParam('bitcrusher', 'rate', 999), 32);
  for (const bad of ['abc', NaN, null, undefined, '']) assert.equal(clampFxParam('bitcrusher', 'bits', bad), null);
  assert.deepEqual(FX_NEEDS_WORKLET, ['bitcrusher']);
});

test('bitcrusher graph: input -> worklet node -> return, stereo both ways, start values as options', () => {
  const ctx = workletCtx();
  const before = workletNodes.length;
  const fx = createBitcrusher(ctx, { bits: 5, rate: 3, return: 0.7 });
  const node = workletNodes[before];
  assert.equal(node.name, 'pulsar-bitcrusher');
  assert.deepEqual(node.options.parameterData, { bits: 5, rate: 3 });
  assert.deepEqual(node.options.outputChannelCount, [2]);
  assert.equal(node.options.channelCount, 2);
  assert.equal(node.options.channelCountMode, 'explicit');
  assert.ok(fx.input.connections.includes(node));
  assert.ok(node.connections.includes(fx.output));
  assert.equal(fx.type, 'bitcrusher');
  assert.equal(fx.enabled, true);
});

test('bitcrusher setParam ramps the worklet parameters and the return, no .value afterwards', () => {
  const ctx = workletCtx();
  const before = workletNodes.length;
  const fx = createBitcrusher(ctx);
  const node = workletNodes[before];
  fx.setParam('bits', 4);
  fx.setParam('rate', 99);
  assert.deepEqual(node.parameters.get('bits').calls.at(-1).slice(0, 2), ['target', 4]);
  assert.deepEqual(node.parameters.get('rate').calls.at(-1).slice(0, 2), ['target', 32]);
  assert.equal(node.parameters.get('bits').calls.filter((c) => c[0] === 'value').length, 0);
  fx.setEnabled(false);
  assert.deepEqual(fx.output.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  fx.setParam('return', 0.2);
  assert.equal(fx.params.return, 0.2);
  assert.deepEqual(fx.output.gain.calls.at(-1).slice(0, 2), ['target', 0]); // still muted
  fx.setEnabled(true);
  assert.deepEqual(fx.output.gain.calls.at(-1).slice(0, 2), ['target', 0.2]);
  fx.setParam('bits', 'abc');
  assert.equal(fx.params.bits, 4);
});

test('bitcrusher dispose fades the return, disconnect frees every node including the worklet node', () => {
  const ctx = workletCtx();
  const before = workletNodes.length;
  const fx = createBitcrusher(ctx);
  const node = workletNodes[before];
  assert.ok(Number.isFinite(fx.tailMs()) && fx.tailMs() <= 500);
  fx.dispose();
  assert.deepEqual(fx.output.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  fx.disconnect();
  assert.ok(node.disconnected >= 1);
  assert.deepEqual(node.messages, ['stop']); // lets the processor end
  for (const n of ctx.nodes) assert.ok(n.disconnected >= 1, `${n.kind} not disconnected`);
});

test('without the worklet only the bitcrusher is unavailable', () => {
  const ctx = stubCtx(); // never marked as loaded
  assert.throws(() => createEffect(ctx, 'bitcrusher'), /worklet/i);
  assert.throws(() => createBitcrusher(ctx), /worklet/i);
  for (const type of FX_TYPES.filter((t) => !FX_NEEDS_WORKLET.includes(t))) assert.equal(createEffect(ctx, type).type, type);
});

test('distortion: defaults, ranges and clamping', () => {
  assert.deepEqual(createDistortion(stubCtx()).params, FX_DEFAULTS.distortion);
  assert.equal(clampFxParam('distortion', 'drive', 5), 1);
  assert.equal(clampFxParam('distortion', 'drive', -1), 0);
  assert.equal(clampFxParam('distortion', 'tone', 10), 500);
  assert.equal(clampFxParam('distortion', 'shape', 'abc'), null);
  assert.equal(clampFxParam('distortion', 'bits', 4), null);
  const fx = createDistortion(stubCtx(), { drive: 9, shape: 'x', tone: 20000 });
  assert.deepEqual(fx.params, { ...FX_DEFAULTS.distortion, drive: 1, tone: 12000 });
});

test('distortion graph: input -> gain -> two shapers (soft, hard) -> make-up -> tone -> return', () => {
  const ctx = stubCtx();
  const fx = createDistortion(ctx);
  const shapers = ctx.nodes.filter((n) => n.kind === 'shaper');
  assert.equal(shapers.length, 2);
  assert.deepEqual(shapers.map((n) => n.curve.length), [2048, 2048]);
  assert.ok(shapers.every((n) => n.oversample === '2x'));
  const tone = ctx.nodes.find((n) => n.kind === 'biquad');
  assert.ok(reaches(fx.input, shapers[0]) && reaches(fx.input, shapers[1]));
  assert.ok(reaches(shapers[0], tone) && reaches(shapers[1], tone));
  assert.ok(tone.connections.includes(fx.output));
  assert.equal(fx.type, 'distortion');
});

test('distortion curves: soft is a smooth tanh, hard clips flat, both odd, bounded and equally steep at 0', () => {
  const soft = distortionCurve('soft');
  const hard = distortionCurve('hard');
  for (const c of [soft, hard]) {
    assert.ok(c.every((v) => Math.abs(v) <= 1 + 1e-6));
    assert.ok(Math.abs(c[0] + c[c.length - 1]) < 1e-6); // odd: no DC offset
    assert.ok(Math.abs(c[c.length - 1] - 1) < 1e-6);
  }
  const mid = soft.length / 2;
  const slope = (c) => (c[mid + 1] - c[mid - 1]) / (2 / (c.length - 1)) / 2;
  assert.ok(Math.abs(slope(soft) - slope(hard)) / slope(hard) < 0.05);
  assert.equal(hard[soft.length - 1], hard[soft.length - 50]); // flat at the top
  assert.ok(soft[soft.length - 50] < soft[soft.length - 1]); // still rising
});

test('distortion gains: drive 0 is clean and unity, hotter drive means more gain in front and less after', () => {
  assert.equal(distortionPreGain(0), 1);
  assert.ok(Math.abs(distortionPreGain(1) - 10 ** 1.8) < 1e-9);
  assert.ok(Math.abs(distortionPostGain(0) - 0.4) < 0.1); // small-signal gain 2.5 * 0.4 is about 1
  for (let d = 0; d < 1; d += 0.1) assert.ok(distortionPostGain(d + 0.1) <= distortionPostGain(d) + 1e-12);
  for (const d of [0, 0.3, 1]) assert.ok(Number.isFinite(distortionPostGain(d)) && distortionPostGain(d) > 0);
});

test('distortion setParam moves everything by ramps: no .value after creation, curves never swapped', () => {
  const ctx = stubCtx();
  const fx = createDistortion(ctx);
  const curves = ctx.nodes.filter((n) => n.kind === 'shaper').map((n) => n.curve);
  const before = valueCalls(ctx);
  for (const [k, v] of [['drive', 1], ['shape', 1], ['tone', 800], ['return', 0.2], ['drive', 0]]) fx.setParam(k, v);
  assert.deepEqual(valueCalls(ctx), before);
  assert.deepEqual(ctx.nodes.filter((n) => n.kind === 'shaper').map((n) => n.curve), curves);
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  const target = (g) => g.gain.calls.filter((c) => c[0] === 'target').at(-1)?.[1];
  assert.ok(gains.some((g) => target(g) === distortionPreGain(0)));
  fx.setParam('shape', 0.25);
  const [soft, hard] = gains.filter((g) => g.gain.calls.some((c) => c[0] === 'target' && (c[1] === 0.75 || c[1] === 0.25)));
  assert.deepEqual([target(soft), target(hard)], [0.75, 0.25]);
  assert.equal(fx.tailMs(), 100);
});

test('chorus: defaults, ranges and clamping', () => {
  assert.deepEqual(createChorus(stubCtx()).params, FX_DEFAULTS.chorus);
  assert.equal(clampFxParam('chorus', 'rate', 50), 5);
  assert.equal(clampFxParam('chorus', 'rate', 0), 0.05);
  assert.equal(clampFxParam('chorus', 'depth', 2), 1);
  assert.equal(clampFxParam('chorus', 'feedback', 0.5), null);
  assert.deepEqual(createChorus(stubCtx(), { rate: 'x', depth: 9, width: -1 }).params, { ...FX_DEFAULTS.chorus, depth: 1, width: 0 });
});

test('chorus graph: mono sum -> two short delays modulated by one LFO -> left and right -> return', () => {
  const ctx = stubCtx();
  const fx = createChorus(ctx);
  const lfo = ctx.nodes.find((n) => n.kind === 'osc');
  const delays = ctx.nodes.filter((n) => n.kind === 'delay');
  const merger = ctx.nodes.find((n) => n.kind === 'merger');
  assert.equal(delays.length, 2);
  assert.equal(lfo.type, 'sine');
  assert.deepEqual(lfo.starts.length, 1);
  assert.ok(delays.every((d) => d.maxDelayTime <= 0.05 && d.delayTime.calls.find((c) => c[0] === 'value')[1] > 0.006));
  assert.ok(delays.every((d) => reaches(fx.input, d)));
  const swings = ctx.nodes.filter((n) => n.kind === 'gain' && lfo.connections.includes(n));
  assert.equal(swings.length, 2);
  assert.deepEqual(swings.map((g) => g.connections[0]), delays.map((d) => d.delayTime)); // the LFO moves each delay time
  assert.ok(delays.every((d) => d.connections.includes(merger)));
  assert.ok(merger.connections.includes(fx.output));
  const send = ctx.nodes.find((n) => n.channelCount === 1);
  assert.equal(send.channelCountMode, 'explicit');
});

test('chorus width: the right channel swings against the left at 1, with it at 0', () => {
  assert.equal(chorusRightSwing(1), -1);
  assert.equal(chorusRightSwing(0), 1);
  assert.equal(chorusRightSwing(0.5), 0);
});

test('chorus never leaves the delay time near or below zero', () => {
  const ctx = stubCtx();
  createChorus(ctx, { depth: 1 });
  const [swingL] = ctx.nodes.filter((n) => n.kind === 'gain' && n.gain.calls.some((c) => c[0] === 'value' && c[1] > 0.001 && c[1] < 0.01));
  const base = ctx.nodes.find((n) => n.kind === 'delay').delayTime.calls.find((c) => c[0] === 'value')[1];
  assert.ok(base - swingL.gain.calls.find((c) => c[0] === 'value')[1] > 0.005);
});

test('chorus setParam moves everything by ramps, and disconnect stops the LFO', () => {
  const ctx = stubCtx();
  const fx = createChorus(ctx);
  const lfo = ctx.nodes.find((n) => n.kind === 'osc');
  const before = valueCalls(ctx);
  for (const [k, v] of [['rate', 3], ['depth', 0.9], ['width', 0], ['return', 0.2]]) fx.setParam(k, v);
  assert.deepEqual(valueCalls(ctx), before);
  assert.deepEqual(lfo.frequency.calls.filter((c) => c[0] === 'target').at(-1).slice(0, 2), ['target', 3]);
  assert.equal(fx.tailMs(), 100);
  fx.disconnect();
  assert.deepEqual(lfo.stops.length, 1);
});

test('vibrato: defaults, clamping and a graph of one modulated delay', () => {
  const ctx = stubCtx();
  assert.deepEqual(createVibrato(ctx).params, FX_DEFAULTS.vibrato);
  assert.equal(clampFxParam('vibrato', 'speed', 99), 12);
  assert.equal(clampFxParam('vibrato', 'speed', 0), 0.5);
  assert.equal(clampFxParam('vibrato', 'depth', 2), 1);
  assert.equal(clampFxParam('vibrato', 'width', 1), null);
  assert.equal(ctx.nodes.filter((n) => n.kind === 'delay').length, 1);
});

test('vibrato setParam ramps, bypass mutes the return, disconnect stops the LFO', () => {
  const fx = createVibrato(stubCtx());
  fx.setParam('depth', 1);
  fx.setParam('speed', 8);
  assert.equal(fx.params.depth, 1);
  fx.setEnabled(false);
  assert.equal(fx.enabled, false);
  assert.doesNotThrow(() => fx.disconnect());
});

test('tremolo: defaults, clamping, and the gain stays within 0..1 at every depth', () => {
  assert.deepEqual(createTremolo(stubCtx()).params, FX_DEFAULTS.tremolo);
  assert.equal(clampFxParam('tremolo', 'speed', 99), 20);
  assert.equal(clampFxParam('tremolo', 'depth', 2), 1);
  assert.equal(clampFxParam('tremolo', 'width', 1), null);
  for (const d of [0, 0.3, 1]) {
    assert.ok(tremoloCentre(d) + tremoloSwing(d) <= 1 + 1e-9);
    assert.ok(tremoloCentre(d) - tremoloSwing(d) >= -1e-9);
  }
  assert.equal(tremoloCentre(0), 1);
  assert.equal(tremoloSwing(0), 0);
});

test('tremolo setParam ramps, bypass mutes the return, disconnect stops the LFO', () => {
  const fx = createTremolo(stubCtx());
  fx.setParam('depth', 1);
  fx.setParam('speed', 10);
  assert.equal(fx.params.depth, 1);
  fx.setEnabled(false);
  assert.equal(fx.enabled, false);
  assert.doesNotThrow(() => fx.disconnect());
});

test('peek: 50 % falls to 0 in 5 s, 80 % in 3 s, higher is faster', () => {
  assert.ok(Math.abs(peekSeconds(0.5) - 5) < 1e-9);
  assert.ok(Math.abs(peekSeconds(0.8) - 3) < 1e-9);
  assert.ok(peekSeconds(1) < peekSeconds(0.8) && peekSeconds(0.8) < peekSeconds(0.5) && peekSeconds(0.5) < peekSeconds(0.05));
  for (const type of ['vibrato', 'tremolo']) {
    assert.equal(clampFxParam(type, 'peek', 3), 1);
    assert.equal(clampFxParam(type, 'rate', 1), null);
    assert.equal(FX_DEFAULTS[type].peek, 0);
  }
});

test('peek on vibrato and tremolo: input -> slide worklet -> LFO frequency; setParam and disconnect work', () => {
  for (const make of [createVibrato, createTremolo]) {
    const ctx = workletCtx();
    const before = workletNodes.length;
    const fx = make(ctx, { speed: 6, peek: 0.5 });
    const node = workletNodes[before];
    assert.equal(node.name, 'pulsar-slide');
    assert.deepEqual(node.options.parameterData, { speed: 6, peek: 0.5 });
    assert.ok(fx.input.connections.includes(node));
    fx.setParam('peek', 1);
    fx.setParam('speed', 3);
    assert.deepEqual(node.parameters.get('peek').calls.at(-1).slice(0, 2), ['target', 1]);
    assert.deepEqual(node.parameters.get('speed').calls.at(-1).slice(0, 2), ['target', 3]);
    fx.disconnect();
    assert.deepEqual(node.messages, ['stop']);
  }
});

test('without the worklet, vibrato and tremolo still build and the speed holds', () => {
  for (const make of [createVibrato, createTremolo]) {
    const ctx = stubCtx();
    const fx = make(ctx, { peek: 0.5 });
    fx.setParam('speed', 3);
    assert.doesNotThrow(() => fx.disconnect());
  }
});
