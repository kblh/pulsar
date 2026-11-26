import test from 'node:test';
import assert from 'node:assert/strict';
import { mutationEvery, mutationAmount, DRIFT_RETURN_CHANCE } from '../js/evolution.js';
import { mutateMelody, randomMelody } from '../js/melody.js';
import { mulberry32 } from '../js/rng.js';

const state = () => ({ current: [3, 3, 3, 3, 3, 3, 3, 3], base: [3, 3, 3, 3, 3, 3, 3, 3] });

test('evolution helpers', () => {
  assert.equal(DRIFT_RETURN_CHANCE, 0.25);
  assert.equal(mutationEvery(10), 1);
  assert.equal(mutationEvery(1), 12);
  assert.equal(mutationAmount(1), 1);
  assert.equal(mutationAmount(10), 4);
});

test('input state is not mutated', () => {
  const s = state();
  const snap = JSON.stringify(s);
  mutateMelody(s, { level: 10, mode: 'walk', poolSize: 8 }, mulberry32(1));
  assert.equal(JSON.stringify(s), snap);
});

test('values stay within pool over many mutations', () => {
  let s = { current: [0, 1, 2, 0], base: [0, 1, 2, 0] };
  const rng = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    s = mutateMelody(s, { level: 10, mode: 'walk', poolSize: 3 }, rng);
    assert.ok(s.current.every((v) => v >= 0 && v <= 2));
  }
});

test('walk: base becomes the new current', () => {
  const s = mutateMelody(state(), { level: 5, mode: 'walk', poolSize: 8 }, mulberry32(3));
  assert.deepEqual(s.base, s.current);
});

test('drift with rng 0 always reverts to base', () => {
  const s = mutateMelody(state(), { level: 5, mode: 'drift', poolSize: 8 }, () => 0);
  assert.deepEqual(s.current, s.base);
});

test('drift with rng 0.99 keeps base and diverges from it', () => {
  const s = mutateMelody(state(), { level: 1, mode: 'drift', poolSize: 8 }, () => 0.99);
  assert.deepEqual(s.base, state().base);
  assert.notDeepEqual(s.current, s.base);
});

test('poolSize 1 does not throw', () => {
  const s = mutateMelody({ current: [0, 0], base: [0, 0] }, { level: 10, mode: 'drift', poolSize: 1 }, mulberry32(2));
  assert.deepEqual(s.current, [0, 0]);
});

test('randomMelody has requested length and valid indices', () => {
  const m = randomMelody(16, 5, mulberry32(9));
  assert.equal(m.length, 16);
  assert.ok(m.every((v) => Number.isInteger(v) && v >= 0 && v < 5));
});

test('mutateMelody changes only steps that sound, and octaves lift notes by whole octaves', () => {
  const current = Array(16).fill(0);
  const active = current.map((_, i) => i % 4 === 0);
  const r = mutateMelody({ current, base: [...current] }, { level: 10, mode: 'walk', poolSize: 15, amount: 8, active, octaveSize: 5, octaves: 2 }, Math.random);
  r.current.forEach((v, i) => { if (!active[i]) assert.equal(v, 0); });
  assert.ok(r.current.some((v) => v !== 0));
  let climbed = false;
  for (let k = 0; k < 50; k++) {
    const x = mutateMelody({ current, base: [...current] }, { level: 10, mode: 'walk', poolSize: 15, amount: 8, octaveSize: 5, octaves: 2 }, Math.random);
    if (x.current.some((v) => v >= 5)) climbed = true;
    assert.ok(x.current.every((v) => v < 15));
  }
  assert.ok(climbed);
});
