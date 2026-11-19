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
