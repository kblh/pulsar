import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNote, buildPitchPool, midiToFreq, parsePitchClass, pitchClasses, toggleClass } from '../js/scales.js';

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

test('parsePitchClass', () => {
  assert.equal(parsePitchClass('C'), 0);
  assert.equal(parsePitchClass('c#'), 1);
  assert.equal(parsePitchClass('Bb'), 10);
  assert.equal(parsePitchClass('B'), 11);
  assert.equal(parsePitchClass('C4'), null);
  assert.equal(parsePitchClass(''), null);
});

test('class tokens expand over the octaves from octave 3', () => {
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C E', octaves: 2 }), [48, 52, 60, 64]);
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'A', octaves: 1 }), [57]);
  assert.equal(buildPitchPool({ mode: 'notes', notes: 'C', octaves: 9 }).length, 4);
});

test('tokens with an octave still mean exactly those pitches, and may mix with classes', () => {
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C4 E4 G4 A4', octaves: 3 }), [60, 64, 67, 69]);
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C4 C', octaves: 1 }), [48, 60]);
});

test('pitchClasses of a scale and of legacy notes', () => {
  assert.deepEqual(pitchClasses({ mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 }), [0, 3, 5, 7, 10]);
  assert.deepEqual(pitchClasses({ mode: 'notes', notes: 'C4 E4 G4 A4' }), [0, 4, 7, 9]);
});

test('toggleClass seeds from the scale, switches to notes and flips the class', () => {
  const cfg = { mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 };
  const off = toggleClass(cfg, 3);
  assert.equal(off.mode, 'notes');
  assert.equal(off.octaves, 2);
  assert.deepEqual(pitchClasses(off), [0, 5, 7, 10]);
  assert.deepEqual(pitchClasses(toggleClass(off, 4)), [0, 4, 5, 7, 10]);
  assert.equal(off.root, 'C');
});

test('toggleClass never turns the last key off', () => {
  const one = { mode: 'notes', notes: 'E', octaves: 2 };
  assert.equal(toggleClass(one, 4), one);
  assert.deepEqual(pitchClasses(toggleClass(one, 0)), [0, 4]);
});

test('names written by toggleClass parse back', () => {
  const cfg = toggleClass({ mode: 'notes', notes: 'C', octaves: 1 }, 3);
  assert.equal(cfg.notes, 'C Eb');
  assert.deepEqual(pitchClasses(cfg), [0, 3]);
});
