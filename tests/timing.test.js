import test from 'node:test';
import assert from 'node:assert/strict';
import { stepDuration, swingDelay, STEPS_PER_BAR } from '../js/timing.js';

test('STEPS_PER_BAR is 16', () => assert.equal(STEPS_PER_BAR, 16));
test('stepDuration(120) is 0.125s', () => assert.equal(stepDuration(120), 0.125));
test('even steps never swing', () => assert.equal(swingDelay(0, 1, 120), 0));
test('swing 0 gives no delay', () => assert.equal(swingDelay(1, 0, 120), 0));
test('odd step at full swing is delayed by half a step', () => assert.equal(swingDelay(1, 1, 120), 0.0625));
