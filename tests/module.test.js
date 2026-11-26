import test from 'node:test';
import assert from 'node:assert/strict';
import { createMelodicModule, createRhythmicModule } from '../js/module.js';
import { stubCtx as recordingCtx } from './helpers/stub-ctx.js';

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

const oscCount = (created) => created.filter((k) => k === 'createOscillator').length;

test('melodic osc 2: defaults and validation of wave2, mix and detune', () => {
  const m = createMelodicModule();
  assert.deepEqual([m.params.wave2, m.params.mix, m.params.detune], ['sawtooth', 0, 0]);
  m.setParam('mix', 9); assert.equal(m.params.mix, 1);
  m.setParam('mix', -2); assert.equal(m.params.mix, 0);
  m.setParam('mix', '0.4'); assert.equal(m.params.mix, 0.4);
  for (const bad of [NaN, 'abc', null, true, undefined, {}]) { m.setParam('mix', bad); assert.equal(m.params.mix, 0.4, String(bad)); }
  m.setParam('detune', 1e9); assert.equal(m.params.detune, 50);
  m.setParam('detune', -1e9); assert.equal(m.params.detune, -50);
  m.setParam('detune', 12.6); assert.equal(m.params.detune, 13);
  for (const bad of [NaN, 'abc', null, true, undefined]) { m.setParam('detune', bad); assert.equal(m.params.detune, 13, String(bad)); }
  m.setParam('wave2', 'square'); assert.equal(m.params.wave2, 'square');
  for (const bad of ['evil', 5, null, undefined, '']) { m.setParam('wave2', bad); assert.equal(m.params.wave2, 'square', String(bad)); }
  const made = createMelodicModule({ mix: 9, detune: 'abc', wave2: 'evil' });
  assert.deepEqual([made.params.wave2, made.params.mix, made.params.detune], ['sawtooth', 1, 0]);
});

test('melodic osc 2: every new note follows the current mix', () => {
  const count = (mix) => {
    const { ctx, created } = stubCtx();
    const m = createMelodicModule({ bpm: 240, rhythm: 'x...x...x...x...' });
    if (mix !== undefined) m.setParam('mix', mix);
    run(m, ctx, 0.6);
    return oscCount(created);
  };
  const plain = count();
  assert.ok(plain >= 2);
  assert.equal(count(0), plain, 'mix 0 builds the same voices as a module that never heard of mix');
  assert.equal(count(0.5), plain * 2, 'mix > 0 plays a second oscillator with every note');
  const { ctx, created } = stubCtx();
  const m = createMelodicModule({ bpm: 240, rhythm: 'x...x...x...x...' });
  m.setParam('mix', 0.5);
  m.setParam('mix', 0);
  run(m, ctx, 0.6);
  assert.equal(oscCount(created), plain);
});

test('the rhythmic module has no osc 2 parameters and ignores them', () => {
  const m = createRhythmicModule();
  for (const k of ['wave2', 'mix', 'detune']) assert.ok(!(k in m.params), k);
  m.setParam('mix', 0.5);
  m.setParam('wave2', 'square');
  assert.ok(!('mix' in m.params) && !('wave2' in m.params));
});

function noteTimes(tempo, own = 60) {
  const ctx = recordingCtx();
  const m = createMelodicModule({ bpm: own, rhythm: 'xxxxxxxxxxxxxxxx', swing: 0, randomize: 1, rhythmMod: 1 });
  const dest = { disconnect() {} };
  for (let t = 0; t < 2; t += 0.025) m.tick(ctx, dest, t, tempo);
  const osc = ctx.nodes.filter((n) => n.kind === 'osc');
  return { m, starts: osc.flatMap((n) => n.starts).sort((a, b) => a - b), osc };
}

test('with the global tempo on, steps follow it instead of the module bpm', () => {
  const on = noteTimes({ on: true, bpm: 240 });
  for (let i = 1; i < 8; i++) assert.ok(Math.abs(on.starts[i] - on.starts[i - 1] - 60 / 240 / 4) < 1e-6);
  const off = noteTimes(undefined);
  for (let i = 1; i < 8; i++) assert.ok(Math.abs(off.starts[i] - off.starts[i - 1] - 60 / 60 / 4) < 1e-6);
});

test('the module remembers the tempo it last played at and keeps its own bpm param', () => {
  assert.equal(noteTimes({ on: true, bpm: 240 }).m.bpm, 240);
  const own = noteTimes(undefined);
  assert.equal(own.m.bpm, 60);
  const on = noteTimes({ on: true, bpm: 240 });
  assert.equal(on.m.params.bpm, 60);
});

test('note length follows the effective tempo too', () => {
  const len = (r) => r.osc[0].stops[0] - r.osc[0].starts[0];
  assert.ok(len(noteTimes({ on: true, bpm: 240 })) < len(noteTimes(undefined)));
});

test('rhythmic mute: defaults, setParam, junk values and unknown drums', () => {
  const m = createRhythmicModule();
  assert.deepEqual(m.params.mute, { kick: false, snare: false, hat: false });
  m.setParam('mute:kick', true);
  assert.equal(m.params.mute.kick, true);
  m.setParam('mute:kick', 'true');
  assert.equal(m.params.mute.kick, false);
  m.setParam('mute:tom', true);
  assert.equal('tom' in m.params.mute, false);
  assert.deepEqual(createRhythmicModule({ mute: { hat: true, kick: 1, snare: 'yes' } }).params.mute, { kick: false, snare: false, hat: true });
  assert.deepEqual(createRhythmicModule({ mute: 'x' }).params.mute, { kick: false, snare: false, hat: false });
});

test('a muted drum makes no sound', () => {
  const play = (mute) => {
    const { ctx, created } = stubCtx();
    const m = createRhythmicModule({ bpm: 240, voices: { kick: 'xxxxxxxxxxxxxxxx', snare: '................', hat: '................' }, mute });
    run(m, ctx, 2);
    return created.length;
  };
  assert.ok(play({}) > 0);
  assert.equal(play({ kick: true }), 0);
});

test('a rhythmic voice can be emptied and stays empty', () => {
  const m = createRhythmicModule();
  m.setParam('voice:snare', '................');
  assert.equal(m.state.voices.snare.current.some(Boolean), false);
  const e = createRhythmicModule({ voices: { hat: '................' } });
  assert.equal(e.state.voices.hat.current.some(Boolean), false);
});

test('the melodic rhythm still keeps one hit', () => {
  const m = createMelodicModule();
  m.setParam('rhythm', '................');
  assert.equal(m.state.rhythm.current.some(Boolean), true);
});

test('melodic: the first melody stays in the base octave, randomize octaves lets it climb', () => {
  const m = createMelodicModule({ randOctaves: 2 });
  assert.equal(m.pool.length, 15);
  assert.ok(m.state.melody.current.every((i) => i < 5));
  m.setParam('randOctaves', 0);
  assert.equal(m.pool.length, 5);
  m.setParam('randOctaves', 9);
  assert.equal(m.params.randOctaves, 2);
});

test('melodic: octave knob moves the pool, notes and rhythm knobs at 0 freeze them', () => {
  const m = createMelodicModule({ randomize: 0, rhythmMod: 0, rhythm: 'x...x...x...x...' });
  assert.equal(m.params.pitchConfig.octave, 0);
  const low = m.pool[0];
  m.setParam('pitchConfig', { ...m.params.pitchConfig, octave: 2 });
  assert.equal(m.pool[0], low + 24);
  const before = JSON.stringify(m.state);
  for (let i = 0; i < 40; i++) m.mutateBar.call(m, (m.bars = i + 1));
  assert.equal(JSON.stringify(m.state), before);
});
