import test from 'node:test';
import assert from 'node:assert/strict';
import { knobAngle, polar, arcPath, dragFraction, knobOrigin, KNOB_SWEEP, KNOB_DRAG_PX, KNOB_FINE } from '../js/knob.js';
import { FX_TYPES } from '../js/fx.js';
import { FX_PEDALS } from '../js/fx-fields.js';

const near = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('the pointer sweeps 270 degrees from 7 o clock to 5 o clock', () => {
  assert.equal(KNOB_SWEEP, 270);
  assert.equal(knobAngle(0), -135);
  assert.equal(knobAngle(0.5), 0);
  assert.equal(knobAngle(1), 135);
  assert.equal(knobAngle(-3), -135);
  assert.equal(knobAngle(9), 135);
  assert.equal(knobAngle(NaN), -135);
});

test('polar runs clockwise from straight up', () => {
  assert.deepEqual(polar(32, 32, 10, 0), { x: 32, y: 22 });
  assert.deepEqual(polar(32, 32, 10, 90), { x: 42, y: 32 });
  assert.deepEqual(polar(32, 32, 10, 180), { x: 32, y: 42 });
  assert.deepEqual(polar(32, 32, 10, -90), { x: 22, y: 32 });
});

test('arcPath draws from one position to another and nothing for an empty span', () => {
  assert.equal(arcPath(32, 32, 27, 0, 0), '');
  assert.equal(arcPath(32, 32, 27, 0.5, 0.2), '');
  const half = arcPath(32, 32, 27, 0, 0.5);
  assert.match(half, /^M [\d.]+ [\d.]+ A 27 27 0 0 1 [\d.]+ [\d.]+$/); // 135 degrees: the short way round
  const full = arcPath(32, 32, 27, 0, 1);
  assert.match(full, / A 27 27 0 1 1 /); // 270 degrees: the long way round
  assert.ok(full.startsWith('M 12.91 51.09')); // the 7 o clock end
});

test('a drag raises the value going up or right and lowers it going down or left, within 0..1', () => {
  near(dragFraction(0.5, 0, -KNOB_DRAG_PX / 2), 1);
  near(dragFraction(0.5, 0, KNOB_DRAG_PX / 4), 0.25);
  near(dragFraction(0.5, KNOB_DRAG_PX / 4, 0), 0.75);
  near(dragFraction(0.5, -KNOB_DRAG_PX / 4, 0), 0.25);
  assert.equal(dragFraction(0.9, 0, -1000), 1);
  assert.equal(dragFraction(0.1, 0, 1000), 0);
  assert.equal(dragFraction(0.5, 0, 0), 0.5);
});

test('with shift a drag moves the knob a quarter as far', () => {
  const normal = dragFraction(0.5, 0, -40) - 0.5;
  const fine = dragFraction(0.5, 0, -40, { fine: true }) - 0.5;
  near(fine / normal, KNOB_FINE, 1e-9);
});

test('a range with a zero in it starts its arc at the zero, any other at the left end', () => {
  near(knobOrigin({ min: -12, max: 12 }), 0.5);
  near(knobOrigin({ min: -12, max: 36 }), 0.25);
  assert.equal(knobOrigin({ min: 0, max: 1 }), 0);
  assert.equal(knobOrigin({ min: 200, max: 12000, scale: 'log' }), 0);
});

test('every effect has a name for its pedal', () => {
  for (const type of FX_TYPES) assert.ok(FX_PEDALS[type]?.title?.length > 0, type);
});

test('dragLength: a range with many steps needs a longer drag', async () => {
  const { dragLength } = await import('../js/knob.js');
  assert.equal(dragLength({ min: 0, max: 1, step: 0.05 }), KNOB_DRAG_PX);
  assert.equal(dragLength({ min: 20, max: 300, step: 1 }), 420);
});
