import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDroneModule } from '../js/module.js';
import { midiToFreq } from '../js/scales.js';
const midiFreq = midiToFreq;

function makeCtx() {
  const log = { oscs: [], gains: [] };
  const state = { time: 0 };
  const ctx = {
    get currentTime() { return state.time; },
    sampleRate: 100,
    createOscillator() {
      const o = {
        type: '', frequency: { value: 0 }, started: [], stopped: [], disconnected: false, onended: null,
        detune: { calls: [], setTargetAtTime(...a) { this.calls.push(['target', ...a]); }, set value(v) { this.calls.push(['value', v]); } },
        connect: (x) => x, disconnect() { o.disconnected = true; },
        start: (t) => o.started.push(t), stop: (t) => o.stopped.push(t),
      };
      log.oscs.push(o);
      return o;
    },
    createGain() {
      const calls = [];
      const param = {
        _v: 0,
        set value(v) { calls.push(['value', v]); this._v = v; },
        get value() { return this._v; },
        setTargetAtTime: (...a) => calls.push(['target', ...a]),
        setValueAtTime: (...a) => calls.push(['setValue', ...a]),
        linearRampToValueAtTime: (...a) => calls.push(['linear', ...a]),
        exponentialRampToValueAtTime: (...a) => calls.push(['exp', ...a]),
        cancelScheduledValues: (...a) => calls.push(['cancel', ...a]),
      };
      const g = { gain: param, calls, disconnected: 0, context: ctx, connect: (x) => x, disconnect() { g.disconnected++; } };
      log.gains.push(g);
      return g;
    },
  };
  return { ctx, log, state };
}

function setup(overrides = {}) {
  const env = makeCtx();
  const m = createDroneModule(overrides);
  m.out = env.ctx.createGain();
  const dest = m.out;
  const step = (seconds) => {
    for (let i = 0; i < seconds / 0.025; i++) {
      env.state.time += 0.025;
      m.tick(env.ctx, dest, env.state.time);
    }
  };
  return { ...env, m, step };
}

const voiceGains = (log) => log.gains.slice(1);

test('first tick creates one root voice that fades in from 0', () => {
  const { m, log, step } = setup();
  step(0.025);
  assert.equal(log.oscs.length, 1);
  assert.ok(Math.abs(log.oscs[0].frequency.value - midiToFreq(36)) < 1e-6);
  const calls = voiceGains(log)[0].calls;
  assert.deepEqual(calls[0], ['value', 0]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'target');
  assert.equal(calls[1][1], 0.5);
  assert.equal(calls[1][3], 1);
  assert.deepEqual(m.state.sounding(), [36]);
});

test('extras come and go, capped by maxExtra, and gain never jumps', () => {
  const { m, log, step } = setup({ rate: 10, maxExtra: 2 });
  let max = 0, sawExtra = false;
  for (let i = 0; i < 60; i++) {
    step(1);
    const n = m.state.sounding().length;
    max = Math.max(max, n);
    if (n > 1) sawExtra = true;
    assert.ok(m.state.sounding().includes(36));
  }
  assert.ok(sawExtra);
  assert.ok(max <= 3);
  for (const g of voiceGains(log)) {
    for (const c of g.calls) {
      if (c[0] === 'value') assert.equal(c[1], 0);
      else assert.equal(c[0], 'target');
    }
  }
});

test('a releasing tone is not re-created until its oscillator has ended', () => {
  const { m, log, step } = setup({
    rate: 10, maxExtra: 1,
    pitchConfig: { mode: 'notes', notes: 'C2 E2' },
  });
  let guard = 0;
  while (m.state.sounding().length < 2 && guard++ < 4000) step(0.5);
  assert.equal(log.oscs.length, 2);
  guard = 0;
  while (m.state.sounding().length > 1 && guard++ < 4000) step(0.5);
  step(60);
  assert.equal(log.oscs.length, 2);
  log.oscs[1].onended();
  step(60);
  assert.ok(log.oscs.length >= 3);
});

test('stop and start ramp the output gain and leave voices alone', () => {
  const { m, log, step } = setup();
  step(1);
  const before = log.oscs.length;
  m.stop();
  const stopCall = m.out.calls.at(-1);
  assert.equal(stopCall[0], 'target');
  assert.equal(stopCall[1], 0);
  step(30);
  assert.equal(log.oscs.length, before);
  assert.equal(m.running, false);
  m.start();
  const startCall = m.out.calls.at(-1);
  assert.equal(startCall[0], 'target');
  assert.equal(startCall[1], 0.25);
  assert.equal(m.running, true);
});

test('dispose releases voices and disconnects only after the fade', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { m, log, step } = setup({ fade: 4 });
    step(1);
    m.dispose();
    assert.ok(log.oscs[0].stopped.length === 1);
    assert.equal(m.out.disconnected, 0);
    mock.timers.tick(7000);
    assert.equal(m.out.disconnected, 0);
    mock.timers.tick(1500);
    assert.equal(m.out.disconnected, 1);
    const n = log.oscs.length;
    step(5);
    assert.equal(log.oscs.length, n);
  } finally {
    mock.timers.reset();
  }
});

test('setParam clamps fade/rate and ignores invalid values', () => {
  const { m, step } = setup();
  step(0.025);
  m.setParam('fade', 0);
  assert.equal(m.params.fade, 0.5);
  m.setParam('fade', 1000);
  assert.equal(m.params.fade, 30);
  m.setParam('fade', NaN);
  assert.equal(m.params.fade, 4);
  m.setParam('rate', 99);
  assert.equal(m.params.rate, 10);
  m.setParam('rate', 'abc');
  assert.equal(m.params.rate, 10);
  assert.doesNotThrow(() => m.setParam('rootNote', 'xx'));
  assert.equal(m.params.rootNote, 'C2');
  assert.deepEqual(m.state.sounding(), [36]);
});

test('degenerate pools never throw and the root stays', () => {
  for (const o of [
    { maxExtra: 0 },
    { maxExtra: 5, pitchConfig: { mode: 'notes', notes: 'C2' } },
    { maxExtra: 3, pitchConfig: { mode: 'notes', notes: 'C2 E2' } },
    { maxExtra: 2, pitchConfig: { mode: 'notes', notes: '' } },
  ]) {
    const { m, step } = setup({ rate: 10, ...o });
    assert.doesNotThrow(() => step(120));
    assert.ok(m.state.sounding().includes(36));
  }
});

const alive = (log, midiFreq) =>
  log.oscs.filter((o) => Math.abs(o.frequency.value - midiFreq) < 1e-6 && !o.disconnected).length;

test('root change to a tone that is still releasing waits instead of doubling the oscillator', () => {
  const { m, log, step } = setup();
  step(0.1);
  m.setParam('rootNote', 'D2');
  step(0.1);
  m.setParam('rootNote', 'C2');
  step(1);
  assert.equal(alive(log, midiFreq(36)), 1);
  assert.equal(log.oscs.filter((o) => Math.abs(o.frequency.value - midiFreq(36)) < 1e-6).length, 1);
  log.oscs[0].onended();
  step(0.1);
  assert.equal(alive(log, midiFreq(36)), 1);
  assert.equal(log.oscs.filter((o) => Math.abs(o.frequency.value - midiFreq(36)) < 1e-6).length, 2);
  assert.ok(m.state.sounding().includes(36));
});

test('making an active extra the root promotes it instead of doubling it', () => {
  const { m, log, step } = setup({ rate: 10, maxExtra: 1, pitchConfig: { mode: 'notes', notes: 'C2 G3' } });
  let guard = 0;
  while (!m.state.sounding().includes(55) && guard++ < 4000) step(0.5);
  assert.ok(m.state.sounding().includes(55));
  m.setParam('rootNote', 'G3');
  step(1);
  assert.equal(alive(log, midiFreq(55)), 1);
  assert.ok(m.state.sounding().includes(55));
  for (const g of voiceGains(log)) for (const c of g.calls) assert.ok(c[0] === 'target' || (c[0] === 'value' && c[1] === 0));
});

test('wave change crossfades to new voices instead of switching the oscillator type', () => {
  const { m, log, step } = setup();
  step(1);
  m.setParam('wave', 'square');
  assert.equal(log.oscs[0].type, 'sine');
  assert.equal(log.oscs[0].stopped.length, 1);
  assert.equal(log.oscs.length, 2);
  assert.equal(log.oscs[1].type, 'square');
  for (const g of voiceGains(log)) for (const c of g.calls) assert.ok(c[0] === 'target' || (c[0] === 'value' && c[1] === 0));
});

test('maxExtra is clamped to 0-6 at creation and in setParam', () => {
  assert.equal(createDroneModule({ maxExtra: 'x' }).params.maxExtra, 2);
  assert.equal(createDroneModule({ maxExtra: 40 }).params.maxExtra, 6);
  const m = createDroneModule();
  m.setParam('maxExtra', 99);
  assert.equal(m.params.maxExtra, 6);
  m.setParam('maxExtra', -3);
  assert.equal(m.params.maxExtra, 0);
});

test('root note is limited to C0..C6', () => {
  assert.equal(createDroneModule({ rootNote: 'D-9' }).params.rootNote, 'C2');
  const m = createDroneModule();
  m.setParam('rootNote', 'C9');
  assert.equal(m.params.rootNote, 'C2');
  m.setParam('rootNote', 'C7');
  assert.equal(m.params.rootNote, 'C2');
  m.setParam('rootNote', 'C6');
  assert.equal(m.params.rootNote, 'C6');
  m.setParam('rootNote', 'C0');
  assert.equal(m.params.rootNote, 'C0');
});

test('state.releasing() lists tones that are fading out', () => {
  const { m, step } = setup({ rate: 10, maxExtra: 1, pitchConfig: { mode: 'notes', notes: 'C2 G3' } });
  let guard = 0;
  while (!m.state.sounding().includes(55) && guard++ < 4000) step(0.5);
  assert.deepEqual(m.state.releasing(), []);
  guard = 0;
  while (m.state.sounding().includes(55) && guard++ < 4000) step(0.5);
  assert.deepEqual(m.state.releasing(), [55]);
});

test('a stopped drone shuts its oscillators down after the fade and restarts cleanly', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { m, log, step } = setup({ fade: 4 });
    step(1);
    m.stop();
    mock.timers.tick(7000);
    assert.equal(log.oscs[0].stopped.length, 0);
    mock.timers.tick(1500);
    assert.ok(log.oscs[0].stopped.length >= 1);
    log.oscs[0].onended();
    m.start();
    step(0.1);
    assert.equal(log.oscs.length, 2);
    assert.deepEqual(m.state.sounding(), [36]);
  } finally {
    mock.timers.reset();
  }
});

test('starting again before the shutdown timer keeps the same voices', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { m, log, step } = setup({ fade: 4 });
    step(1);
    m.stop();
    mock.timers.tick(3000);
    m.start();
    mock.timers.tick(20000);
    step(0.1);
    assert.equal(log.oscs.length, 1);
    assert.equal(log.oscs[0].stopped.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('changing rate takes effect immediately', () => {
  const { m, step } = setup({ rate: 1, maxExtra: 2 });
  step(0.1);
  m.setParam('rate', 10);
  // At rate 10 the first change comes after 2.1-3.9 s and only an add is possible; the next one
  // can come 2.1 s later at the earliest (and might remove the tone again), so look before that.
  step(4);
  assert.ok(m.state.sounding().length > 1);
});

const lastDetune = (o) => o.detune.calls.filter((c) => c[0] === 'target').at(-1)?.[1];

test('drone osc 2: defaults are a plain voice and values are validated', () => {
  const m = createDroneModule();
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
  const made = createDroneModule({ mix: 9, detune: 'abc', wave2: 'evil' });
  assert.deepEqual([made.params.wave2, made.params.mix, made.params.detune], ['sawtooth', 1, 0]);
});

test('drone osc 2: a voice created with mix > 0 has both oscillators', () => {
  const { log, step } = setup({ mix: 0.4, wave2: 'square', detune: 9 });
  step(0.025);
  assert.equal(log.oscs.length, 2);
  assert.deepEqual([log.oscs[0].type, log.oscs[1].type], ['sine', 'square']);
  assert.equal(log.oscs[1].detune.calls.find((c) => c[0] === 'value')[1], 9);
});

test('drone osc 2: moving mix and detune is heard at once on the sounding voice', () => {
  const { m, log, step } = setup();
  step(0.025);
  assert.equal(log.oscs.length, 1);
  m.setParam('mix', 0.5);
  assert.equal(log.oscs.length, 2);
  assert.equal(log.oscs[1].type, 'sawtooth');
  m.setParam('detune', 20);
  assert.equal(lastDetune(log.oscs[1]), 20);
  const gains = log.gains; // out, voice, A level, B level
  m.setParam('mix', 0);
  assert.equal(gains[3].calls.filter((c) => c[0] === 'target').at(-1)[1], 0);
  assert.equal(log.oscs.length, 2);
});

test('drone osc 2: every sounding voice follows, fading ones keep following, ended ones stop', () => {
  const { m, log, step } = setup({ maxExtra: 2, rate: 10 });
  for (let i = 0; i < 80 && m.state.sounding().length < 2; i++) step(1);
  assert.ok(m.state.sounding().length >= 2, 'extras exist');
  const before = log.oscs.length;
  m.setParam('mix', 0.5);
  assert.equal(log.oscs.length - before, m.state.sounding().length, 'each sounding voice got a second oscillator');
  for (let i = 0; i < 200 && !m.state.releasing().length; i++) step(1);
  assert.ok(m.state.releasing().length > 0, 'a voice is fading out');
  const total = log.oscs.length;
  m.setParam('detune', 15);
  assert.equal(log.oscs.length, total, 'fading voices get no new oscillator');
  const followers = log.oscs.filter((o) => lastDetune(o) === 15);
  assert.ok(followers.length >= m.state.sounding().length + m.state.releasing().length, 'sounding and fading voices follow');
  for (const o of log.oscs) if (o.stopped.length) o.onended?.();
  const frozen = new Map(log.oscs.filter((o) => o.stopped.length).map((o) => [o, o.detune.calls.length]));
  m.setParam('detune', 5);
  // ended voices are forgotten: nothing was sent to oscillators that stopped and ended
  for (const [o, n] of frozen) assert.equal(o.detune.calls.length, n, 'an ended voice was touched');
});

test('drone osc 2: wave2 swaps the voices while mix > 0 and is only stored at mix 0', () => {
  const a = setup({ mix: 0.5 });
  a.step(1);
  const before = a.log.oscs.length;
  a.m.setParam('wave2', 'square');
  assert.equal(a.log.oscs.length - before, 2, 'a new voice with both oscillators');
  assert.equal(a.log.oscs[0].stopped.length, 1);
  assert.equal(a.log.oscs[1].stopped.length, 1);
  assert.equal(a.log.oscs.at(-1).type, 'square');
  const b = setup();
  b.step(1);
  b.m.setParam('wave2', 'square');
  assert.equal(b.log.oscs.length, 1);
  assert.equal(b.log.oscs[0].stopped.length, 0);
  b.m.setParam('mix', 0.5);
  assert.equal(b.log.oscs[1].type, 'square', 'the stored wave 2 is used when the second oscillator appears');
});

test('drone osc 2: after the shutdown killed the voices mix moves nothing, and a restart starts from a clean list', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { m, log, step } = setup({ fade: 4 });
    step(1);
    m.setParam('mix', 0.5);
    assert.equal(log.oscs.length, 2);
    m.stop();
    mock.timers.tick(8500); // the shutdown timer kills the voices
    for (const o of log.oscs) o.onended?.();
    const before = log.oscs.length;
    m.setParam('mix', 0.8);
    m.setParam('detune', 30);
    assert.equal(log.oscs.length, before, 'no oscillator for a voice that is gone');
    const killedB = log.oscs[1];
    const killedDetune = killedB.detune.calls.length;
    m.start();
    step(0.1);
    assert.equal(log.oscs.length, before + 2, 'the new root voice starts with both oscillators (mix is 0.8)');
    m.setParam('detune', 31);
    assert.equal(killedB.detune.calls.length, killedDetune, 'the killed voice is forgotten');
    assert.equal(lastDetune(log.oscs.at(-1)), 31);
  } finally {
    mock.timers.reset();
  }
});
