import test from 'node:test';
import assert from 'node:assert/strict';
import { stepDuration, swingDelay, STEPS_PER_BAR, effectiveBpm, cleanTempo, createTempo, DEFAULT_TEMPO } from '../js/timing.js';

test('STEPS_PER_BAR is 16', () => assert.equal(STEPS_PER_BAR, 16));
test('stepDuration(120) is 0.125s', () => assert.equal(stepDuration(120), 0.125));
test('even steps never swing', () => assert.equal(swingDelay(0, 1, 120), 0));
test('swing 0 gives no delay', () => assert.equal(swingDelay(1, 0, 120), 0));
test('odd step at full swing is delayed by half a step', () => assert.equal(swingDelay(1, 1, 120), 0.0625));

test('effectiveBpm uses the global tempo only while it is on and usable', () => {
  assert.equal(effectiveBpm(100, { on: false, bpm: 200 }), 100);
  assert.equal(effectiveBpm(100, { on: true, bpm: 200 }), 200);
  assert.equal(effectiveBpm(100, { on: true, bpm: NaN }), 100);
  assert.equal(effectiveBpm(100, { on: true, bpm: 999 }), 300);
  assert.equal(effectiveBpm(100), 100);
});

test('cleanTempo accepts only a sane tempo', () => {
  assert.deepEqual(cleanTempo(undefined), { on: false, bpm: 120 });
  assert.deepEqual(cleanTempo({ on: true, bpm: 90.6 }), { on: true, bpm: 91 });
  assert.deepEqual(cleanTempo({ on: 'yes', bpm: '90' }), { on: false, bpm: 120 });
  assert.equal(cleanTempo({ bpm: 5 }).bpm, 20);
  assert.deepEqual(DEFAULT_TEMPO, { on: false, bpm: 120 });
});

test('createTempo keeps one state object and merges partial changes', () => {
  const t = createTempo();
  const state = t.state;
  t.set({ on: true });
  assert.deepEqual(t.state, { on: true, bpm: 120 });
  t.set({ bpm: 500 });
  assert.equal(t.state.bpm, 300);
  assert.equal(t.state, state);
});
