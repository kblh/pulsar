import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, formatPattern, mutateRhythm, RHYTHM_PRESETS } from '../js/rhythm.js';
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
