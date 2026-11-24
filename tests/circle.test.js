import test from 'node:test';
import assert from 'node:assert/strict';
import { CIRCLE, circlePoint } from '../js/circle.js';

test('the circle goes up in fifths from C and covers all 12 notes once', () => {
  assert.deepEqual(CIRCLE.slice(0, 4).map((k) => k.name), ['C', 'G', 'D', 'A']);
  assert.equal(CIRCLE[11].name, 'F'); // a fourth up from C is one step back
  assert.deepEqual(CIRCLE.map((k) => k.pc).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('circlePoint puts 0 degrees at the top and 90 on the right', () => {
  assert.deepEqual(circlePoint(0, 40), { x: 50, y: 10 });
  assert.deepEqual(circlePoint(90, 40), { x: 90, y: 50 });
});
