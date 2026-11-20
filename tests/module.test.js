import test from 'node:test';
import assert from 'node:assert/strict';
import { createMelodicModule, createRhythmicModule } from '../js/module.js';

function stubCtx() {
  const created = [];
  const node = () =>
    new Proxy(function () {}, {
      get: (_, k) => (k === 'connect' ? (x) => x : k === 'getChannelData' ? () => new Float32Array(8) : node()),
      set: () => true,
      apply: () => node(),
    });
  const ctx = new Proxy(
    { sampleRate: 100 },
    {
      get: (t, k) => (k in t ? t[k] : (...a) => (created.push(k), k === 'createBuffer' ? node() : node())),
    },
  );
  return { ctx, created };
}

function run(m, ctx, seconds) {
  const dest = { disconnect() {} };
  for (let t = 0; t < seconds; t += 0.025) m.tick(ctx, dest, t);
}

test('melodic module schedules sound while running', () => {
  const { ctx, created } = stubCtx();
  run(createMelodicModule({ bpm: 240, rhythm: 'xxxxxxxxxxxxxxxx' }), ctx, 2);
  assert.ok(created.includes('createOscillator'));
});

test('rhythmic module schedules drums', () => {
  const { ctx, created } = stubCtx();
  run(createRhythmicModule({ bpm: 240 }), ctx, 2);
  assert.ok(created.length > 0);
});

test('stopped and disposed modules schedule nothing and dispose disconnects output', () => {
  const { ctx, created } = stubCtx();
  const m = createMelodicModule({ bpm: 240, rhythm: 'xxxxxxxxxxxxxxxx' });
  let disconnected = 0;
  m.out = { disconnect: () => disconnected++ };
  m.stop();
  run(m, ctx, 1);
  assert.equal(created.length, 0);
  m.start();
  m.dispose();
  run(m, ctx, 1);
  assert.equal(created.length, 0);
  assert.equal(disconnected, 1);
});

test('setParam clamps bpm/levels and ignores non-numeric values', () => {
  const m = createMelodicModule();
  m.setParam('bpm', 999);
  assert.equal(m.params.bpm, 300);
  m.setParam('bpm', 1);
  assert.equal(m.params.bpm, 20);
  m.setParam('bpm', 'abc');
  assert.equal(m.params.bpm, 20);
  m.setParam('randomize', 99);
  assert.equal(m.params.randomize, 10);
  m.setParam('swing', 5);
  assert.equal(m.params.swing, 1);
});

test('shrinking the pitch pool keeps all melody indices valid', () => {
  const m = createMelodicModule();
  m.setParam('pitchConfig', { mode: 'notes', notes: 'C4 E4' });
  assert.equal(m.pool.length, 2);
  assert.ok(m.state.melody.current.every((i) => i <= 1));
  assert.ok(m.state.melody.base.every((i) => i <= 1));
});

test('nonsense rhythm text still yields a playable pattern', () => {
  const m = createMelodicModule();
  m.setParam('rhythm', 'zzz');
  assert.equal(m.state.rhythm.current.filter(Boolean).length, 1);
});

test('modules use independent clocks', () => {
  const a = createMelodicModule({ bpm: 100 });
  const b = createMelodicModule({ bpm: 130 });
  const { ctx } = stubCtx();
  run(a, ctx, 30);
  run(b, ctx, 30);
  assert.notEqual(a.bars, b.bars);
});

test('setParam env merges a partial envelope into the current one', () => {
  const m = createMelodicModule({});
  m.setParam('env', { a: 0.5 });
  assert.deepEqual(m.params.env, { a: 0.5, d: 0.1, s: 0.5, r: 0.15 });
  m.setParam('env', { d: 1 });
  assert.deepEqual(m.params.env, { a: 0.5, d: 1, s: 0.5, r: 0.15 });
});

test('setParam env clamps times to 0-5 and sustain to 0-1, keeps in-range values', () => {
  const m = createMelodicModule({});
  m.setParam('env', { a: 9, d: -1, s: 3, r: 5 });
  assert.deepEqual(m.params.env, { a: 5, d: 0, s: 1, r: 5 });
  m.setParam('env', { s: 0.25 });
  assert.equal(m.params.env.s, 0.25);
});

test('setParam env ignores unusable values per key and non-objects altogether', () => {
  const m = createMelodicModule({});
  const before = { ...m.params.env };
  m.setParam('env', { a: 'x', d: NaN, s: null, r: Infinity });
  assert.deepEqual(m.params.env, before);
  m.setParam('env', { a: true });
  assert.deepEqual(m.params.env, before);
  for (const bad of [null, undefined, [], 5, 'a']) {
    m.setParam('env', bad);
    assert.deepEqual(m.params.env, before, String(bad));
  }
  m.setParam('env', { a: 0.2, d: 'x' });
  assert.deepEqual(m.params.env, { ...before, a: 0.2 });
});

test('setParam env replaces the env object instead of mutating the old one', () => {
  const m = createMelodicModule({});
  const old = m.params.env;
  const snapshot = { ...old };
  m.setParam('env', { a: 1 });
  assert.notEqual(m.params.env, old);
  assert.deepEqual(old, snapshot);
});
