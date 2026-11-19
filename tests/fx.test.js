import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_DEFAULTS, clampFxParam, makeImpulse, createDelay, createReverb } from '../js/fx.js';
import { mulberry32 } from '../js/rng.js';

function stubCtx() {
  const nodes = [];
  const buffers = [];
  const time = { t: 1 };
  const param = () => {
    const calls = [];
    return { calls, setTargetAtTime: (...a) => calls.push(['target', ...a]), set value(v) { calls.push(['value', v]); } };
  };
  const mk = (kind, extra = {}) => {
    const node = { kind, connections: [], disconnected: 0, ...extra,
      connect(x) { node.connections.push(x); return x; }, disconnect() { node.disconnected++; } };
    nodes.push(node);
    return node;
  };
  return {
    nodes, buffers, sampleRate: 8000,
    get currentTime() { return time.t; },
    createGain: () => mk('gain', { gain: param() }),
    createDelay: (max) => mk('delay', { maxDelayTime: max, delayTime: param() }),
    createBiquadFilter: () => mk('biquad', { frequency: param(), Q: param() }),
    createConvolver: () => mk('convolver'),
    createBuffer: (ch, len, sr) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      const b = { length: len, sampleRate: sr, getChannelData: (i) => data[i] };
      buffers.push(b);
      return b;
    },
  };
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

test('makeImpulse is finite, bounded, decays and is deterministic', () => {
  const sr = 8000;
  const [l, r] = makeImpulse(2, 0.5, sr, mulberry32(1));
  assert.equal(l.length, 2 * sr);
  assert.equal(r.length, 2 * sr);
  for (const ch of [l, r]) for (const x of ch) assert.ok(Number.isFinite(x) && Math.abs(x) <= 1);
  const energy = (a, from, to) => a.slice(from, to).reduce((s, x) => s + x * x, 0);
  const tenth = l.length / 10;
  assert.ok(energy(l, l.length - tenth, l.length) < 0.01 * energy(l, 0, tenth));
  const [l2] = makeImpulse(2, 0.5, sr, mulberry32(1));
  assert.deepEqual(l, l2);
  assert.notDeepEqual(l, r);
});

test('makeImpulse damping darkens', () => {
  const roughness = (a) => a.reduce((s, x, i) => (i ? s + Math.abs(x - a[i - 1]) : s), 0);
  const [dark] = makeImpulse(1, 0.9, 8000, mulberry32(7));
  const [bright] = makeImpulse(1, 0.1, 8000, mulberry32(7));
  assert.ok(roughness(dark) < roughness(bright));
});

test('delay graph: input -> delay -> lowpass -> return, feedback loop through the lowpass', () => {
  const ctx = stubCtx();
  const fx = createDelay(ctx);
  const dly = ctx.nodes.find((n) => n.kind === 'delay');
  const tone = ctx.nodes.find((n) => n.kind === 'biquad');
  assert.ok(dly.maxDelayTime >= 2);
  assert.equal(tone.type, 'lowpass');
  assert.ok(fx.input.connections.includes(dly));
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

test('reverb setParam decay crossfades to a second convolver without jumps', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = stubCtx();
  const fx = createReverb(ctx);
  assert.equal(ctx.nodes.filter((n) => n.kind === 'convolver').length, 1);
  const g0 = ctx.nodes.filter((n) => n.kind === 'gain')[2];
  fx.setParam('decay', 5);
  t.mock.timers.tick(200);
  const convs = ctx.nodes.filter((n) => n.kind === 'convolver');
  assert.equal(convs.length, 2);
  const g1 = ctx.nodes.filter((n) => n.kind === 'gain')[3];
  assert.equal(fx.params.decay, 5);
  assert.deepEqual(g0.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  assert.equal(g0.gain.calls.filter((c) => c[0] === 'value').length, 1);
  assert.deepEqual(g1.gain.calls[0], ['value', 0]);
  assert.deepEqual(g1.gain.calls.at(-1).slice(0, 2), ['target', 1]);
  assert.equal(convs[1].buffer.length, 5 * ctx.sampleRate);
  assert.equal(convs[0].disconnected, 0);
  t.mock.timers.tick(500);
  assert.equal(convs[0].disconnected, 1);
});

test('reverb coalesces rapid changes into one rebuild', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = stubCtx();
  const fx = createReverb(ctx);
  for (let i = 0; i < 20; i++) {
    fx.setParam(i % 2 ? 'decay' : 'damping', i % 2 ? 1 + i * 0.1 : i / 20);
    t.mock.timers.tick(10);
  }
  assert.equal(ctx.buffers.length, 1);
  t.mock.timers.tick(300);
  assert.equal(ctx.buffers.length, 2);
  assert.equal(ctx.nodes.filter((n) => n.kind === 'convolver').length, 2);
});

test('dispose ramps return to 0, disconnect disconnects everything', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const make of [createDelay, createReverb]) {
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
    assert.equal(ctx.buffers.length, fx.type === 'reverb' ? 1 : 0);
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
