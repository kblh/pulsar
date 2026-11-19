import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNote, buildPitchPool, midiToFreq } from '../js/scales.js';

test('parseNote parses names', () => {
  assert.equal(parseNote('C4'), 60);
  assert.equal(parseNote('A4'), 69);
  assert.equal(parseNote('Bb3'), 58);
  assert.equal(parseNote('C#4'), 61);
});

test('parseNote rejects garbage', () => {
  assert.equal(parseNote('H9'), null);
  assert.equal(parseNote('xx'), null);
});

test('scale pool: C major 2 octaves', () => {
  const p = buildPitchPool({ mode: 'scale', root: 'C', scale: 'major', octaves: 2 });
  assert.equal(p.length, 14);
  assert.equal(p[0], 48);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1]);
});

test('notes pool ignores invalid tokens', () => {
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C4 xx H9 E4' }), [60, 64]);
});

test('empty notes fall back to a non-empty default', () => {
  assert.ok(buildPitchPool({ mode: 'notes', notes: '' }).length > 0);
});

test('midiToFreq', () => {
  assert.equal(midiToFreq(69), 440);
});
