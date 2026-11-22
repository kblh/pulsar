import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS } from '../js/keyboard.js';
import { PITCH_CLASS_NAMES } from '../js/scales.js';

test('the keyboard is one octave: 7 white and 5 black keys, C to B', () => {
  assert.equal(KEYS.length, 12);
  assert.deepEqual(KEYS.map((k) => k.pc), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(KEYS.filter((k) => k.black).length, 5);
  assert.deepEqual(KEYS.filter((k) => k.black).map((k) => k.pc), [1, 3, 6, 8, 10]);
  assert.deepEqual(KEYS.map((k) => k.name), PITCH_CLASS_NAMES);
});
