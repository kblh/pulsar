import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlide, peekSeconds } from '../js/slide.js';

const SR = 8000;
/** Runs `seconds` of input (a function of the sample index) and returns the last frequency. */
function run(slide, seconds, input, speed, peek) {
  let f = speed;
  for (let i = 0; i < seconds * SR; i++) f = slide.process(input(i), speed, peek);
  return f;
}
const tone = (amp) => (i) => amp * Math.sin((2 * Math.PI * 220 * i) / SR);

test('peek 0 holds the speed whatever the input does', () => {
  const s = createSlide({ sampleRate: SR });
  assert.equal(run(s, 1, tone(0.5), 6, 0), 6);
  assert.equal(run(s, 1, () => 0, 6, 0), 6);
});

test('after a note the speed falls linearly to 0 over peekSeconds and stays there', () => {
  const s = createSlide({ sampleRate: SR });
  run(s, 0.2, () => 0, 6, 0.5); // silence first
  run(s, 0.1, tone(0.4), 6, 0.5); // a note starts
  const half = run(s, 2.4, () => 0, 6, 0.5); // about 2.5 s after the start of the note
  assert.ok(half > 2.4 && half < 3.6, `halfway: ${half}`);
  assert.equal(run(s, 3, () => 0, 6, 0.5), 0); // 5.5 s: at the bottom, and it stays
  assert.equal(run(s, 2, () => 0, 6, 0.5), 0);
});

test('a higher peek falls sooner', () => {
  const at = (peek) => {
    const s = createSlide({ sampleRate: SR });
    run(s, 0.2, () => 0, 6, peek);
    run(s, 0.1, tone(0.4), 6, peek);
    return run(s, 2, () => 0, 6, peek);
  };
  assert.ok(at(0.8) < at(0.5));
  assert.equal(at(0.8) > 0, true); // 3 s: not yet at 0 after 2 s
});

test('a new note brings the speed back to the set value', () => {
  const s = createSlide({ sampleRate: SR });
  run(s, 0.2, () => 0, 6, 0.8);
  run(s, 0.1, tone(0.4), 6, 0.8);
  assert.equal(run(s, 4, () => 0, 6, 0.8), 0);
  const back = run(s, 0.1, tone(0.4), 6, 0.8);
  assert.ok(back > 5, `after the new note: ${back}`);
});

test('peekSeconds is exported from slide.js too', () => {
  assert.equal(Math.round(peekSeconds(0.5) * 100) / 100, 5);
});
