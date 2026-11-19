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
  step(6);
  assert.ok(m.state.sounding().length > 1);
});
