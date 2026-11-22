import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, formatPattern, mutateRhythm, flipStep, RHYTHM_PRESETS } from '../js/rhythm.js';
import { mulberry32 } from '../js/rng.js';

test('parsePattern always has 16 steps', () => {
  assert.equal(parsePattern('x...').length, 16);
  assert.equal(parsePattern('x'.repeat(40)).length, 16);
});

test('formatPattern pads with rests', () => {
  assert.equal(formatPattern(parsePattern('x.x')), 'x.x.............');
});

test('empty or hitless input gets one hit at step 0', () => {
  for (const s of ['', '....']) {
    const p = parsePattern(s);
    assert.equal(p.filter(Boolean).length, 1);
    assert.equal(p[0], true);
  }
});

test('mutation never produces an empty pattern', () => {
  let s = { current: parsePattern(RHYTHM_PRESETS.sparse), base: parsePattern(RHYTHM_PRESETS.sparse) };
  const rng = mulberry32(5);
  for (let i = 0; i < 1000; i++) {
    s = mutateRhythm(s, { level: 10, mode: 'walk' }, rng);
    assert.ok(s.current.some(Boolean));
  }
});

test('walk aligns base with current', () => {
  const p = parsePattern(RHYTHM_PRESETS.fourOnFloor);
  const s = mutateRhythm({ current: p, base: p }, { level: 5, mode: 'walk' }, mulberry32(2));
  assert.deepEqual(s.base, s.current);
});

test('drift with rng 0 returns to base', () => {
  const p = parsePattern(RHYTHM_PRESETS.fourOnFloor);
  const s = mutateRhythm({ current: p, base: p }, { level: 5, mode: 'drift' }, () => 0);
  assert.deepEqual(s.current, p);
});

test('input state is not mutated', () => {
  const p = parsePattern(RHYTHM_PRESETS.dense);
  const snap = JSON.stringify(p);
  mutateRhythm({ current: p, base: p }, { level: 10, mode: 'walk' }, mulberry32(1));
  assert.equal(JSON.stringify(p), snap);
});

test('walk keeps hit density near the starting density', () => {
  for (const preset of ['sparse', 'dense', 'fourOnFloor']) {
    const p = parsePattern(RHYTHM_PRESETS[preset]);
    const anchor = p.filter(Boolean).length;
    let s = { current: p, base: [...p] };
    const rng = mulberry32(11);
    for (let i = 0; i < 1000; i++) {
      s = mutateRhythm(s, { level: 10, mode: 'walk' }, rng);
      const hits = s.current.filter(Boolean).length;
      assert.ok(Math.abs(hits - anchor) <= 2, `${preset}: ${hits} vs ${anchor} at ${i}`);
    }
  }
});

test('walk actually changes the pattern', () => {
  const p = parsePattern(RHYTHM_PRESETS.fourOnFloor);
  let s = { current: p, base: [...p] };
  const rng = mulberry32(4);
  for (let i = 0; i < 20; i++) s = mutateRhythm(s, { level: 10, mode: 'walk' }, rng);
  assert.notDeepEqual(s.current, p);
});

test('parsePattern keeps an empty pattern empty only when allowed', () => {
  assert.equal(parsePattern('................').some(Boolean), true);
  assert.equal(parsePattern('................', { allowEmpty: true }).some(Boolean), false);
  assert.equal(parsePattern('', { allowEmpty: true }).length, 16);
});

test('flipStep inverts one step on a copy', () => {
  const p = parsePattern('x...............');
  const q = flipStep(p, 3);
  assert.equal(q[3], true);
  assert.equal(p[3], false);
  assert.deepEqual(flipStep(p, 16), p);
  assert.deepEqual(flipStep(p, -1), p);
  assert.notEqual(flipStep(p, 16), p);
});

test('mutateRhythm leaves a pattern that started empty empty', () => {
  const empty = { current: parsePattern('', { allowEmpty: true }), base: parsePattern('', { allowEmpty: true }) };
  for (const mode of ['drift', 'walk']) {
    let s = empty;
    for (let i = 0; i < 50; i++) s = mutateRhythm(s, { level: 10, mode }, Math.random);
    assert.equal(s.current.some(Boolean), false, mode);
  }
});

test('mutateRhythm still never empties a pattern that has hits', () => {
  let s = { current: parsePattern('x...............'), base: parsePattern('x...............') };
  for (let i = 0; i < 200; i++) {
    s = mutateRhythm(s, { level: 10, mode: 'walk' }, Math.random);
    assert.equal(s.current.some(Boolean), true);
  }
});
