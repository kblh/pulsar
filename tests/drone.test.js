import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FADE, clampFade, nextChangeDelay, pickChange } from '../js/drone.js';
import { mulberry32 } from '../js/rng.js';

test('clampFade', () => {
  assert.equal(DEFAULT_FADE, 4);
  assert.equal(clampFade(0), 0.5);
  assert.equal(clampFade(1000), 30);
  assert.equal(clampFade(NaN), 4);
  assert.equal(clampFade('x'), 4);
  assert.equal(clampFade(5), 5);
});

test('nextChangeDelay maps rate to seconds', () => {
  assert.ok(Math.abs(nextChangeDelay(10, () => 0.5) - 3) < 1e-9);
  assert.ok(Math.abs(nextChangeDelay(1, () => 0.5) - 40) < 1e-9);
  assert.equal(nextChangeDelay(99, () => 0.5), nextChangeDelay(10, () => 0.5));
});

test('nextChangeDelay jitter stays within 0.7..1.3 of base', () => {
  assert.ok(Math.abs(nextChangeDelay(1, () => 0) - 28) < 1e-9);
  assert.ok(Math.abs(nextChangeDelay(1, () => 1) - 52) < 1e-9);
});

const opts = { pool: [48, 52, 55], root: 48, maxExtra: 2 };

test('empty active adds a non-root pool tone', () => {
  for (let i = 0; i < 50; i++) {
    const c = pickChange({ active: [], releasing: [] }, opts, mulberry32(i));
    assert.ok('add' in c);
    assert.ok([52, 55].includes(c.add));
  }
});

test('full active removes one of the active tones', () => {
  const c = pickChange({ active: [52, 55], releasing: [] }, opts, mulberry32(1));
  assert.ok('remove' in c);
  assert.ok([52, 55].includes(c.remove));
});

test('a releasing tone is never re-added', () => {
  assert.equal(pickChange({ active: [], releasing: [52] }, { pool: [52], root: 48, maxExtra: 2 }, mulberry32(1)), null);
});

test('maxExtra 0', () => {
  assert.equal(pickChange({ active: [], releasing: [] }, { ...opts, maxExtra: 0 }, mulberry32(1)), null);
  assert.deepEqual(pickChange({ active: [52], releasing: [] }, { ...opts, maxExtra: 0 }, mulberry32(1)), { remove: 52 });
});

test('empty pool', () => {
  assert.equal(pickChange({ active: [], releasing: [] }, { pool: [], root: 48, maxExtra: 2 }, mulberry32(1)), null);
});

test('fuzz: never root, never duplicate, never remove a non-active tone', () => {
  const rng = mulberry32(99);
  let state = { active: [], releasing: [] };
  for (let i = 0; i < 1000; i++) {
    const c = pickChange(state, { pool: [48, 50, 52, 55, 57, 60], root: 48, maxExtra: 3 }, rng);
    if (!c) continue;
    if ('add' in c) {
      assert.notEqual(c.add, 48);
      assert.ok(!state.active.includes(c.add) && !state.releasing.includes(c.add));
      state = { active: [...state.active, c.add], releasing: state.releasing };
    } else {
      assert.ok(state.active.includes(c.remove));
      state = { active: state.active.filter((x) => x !== c.remove), releasing: [...state.releasing, c.remove] };
    }
    if (rng() < 0.3) state = { active: state.active, releasing: state.releasing.slice(1) };
  }
});
