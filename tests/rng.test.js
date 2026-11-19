import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';

test('same seed gives same sequence', () => {
  const a = mulberry32(1), b = mulberry32(1);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('values lie in [0,1)', () => {
  const r = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});
