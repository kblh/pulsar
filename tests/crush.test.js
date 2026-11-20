import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize, createCrusher } from '../js/crush.js';

const ramp = Array.from({ length: 2001 }, (_, i) => -1 + i / 1000); // -1 .. 1

test('quantize keeps silence silent at every bit depth (no DC offset)', () => {
  for (let bits = 1; bits <= 16; bits++) assert.equal(quantize(0, bits), 0, `${bits} bit`);
});

test('quantize at 1 bit only produces -1, 0 or 1', () => {
  const seen = new Set(ramp.map((x) => quantize(x, 1)));
  assert.ok([...seen].every((v) => v === -1 || v === 0 || v === 1), [...seen].join());
  assert.ok(seen.size >= 2);
});

test('quantize at 16 bits stays within a quantisation step of the input', () => {
  for (const x of ramp) assert.ok(Math.abs(quantize(x, 16) - x) <= 1 / 2 ** 15, String(x));
});

test('fewer bits give fewer distinct levels', () => {
  const levels = (bits) => new Set(ramp.map((x) => quantize(x, bits))).size;
  assert.ok(levels(2) < levels(4) && levels(4) < levels(8));
  assert.ok(levels(8) <= 2 ** 8 + 1);
});

test('quantize turns unusable input into a finite number in -1..1', () => {
  for (const x of [NaN, Infinity, -Infinity, undefined, null, 9, -9]) {
    const v = quantize(x, 8);
    assert.ok(Number.isFinite(v) && v >= -1 && v <= 1, String(x));
  }
  for (const bits of [NaN, 0, -3, 99, undefined]) {
    const v = quantize(0.37, bits);
    assert.ok(Number.isFinite(v) && Math.abs(v) <= 1, String(bits));
  }
});

test('a crusher at 16 bits and rate 1 is nearly transparent', () => {
  const c = createCrusher({ bits: 16, rate: 1 });
  for (const x of ramp) assert.ok(Math.abs(c.process(x) - x) <= 1 / 2 ** 15);
});

test('rate N holds every Nth sample', () => {
  const c = createCrusher({ bits: 16, rate: 4 });
  const out = Array.from({ length: 16 }, (_, i) => c.process(i / 20));
  for (let g = 0; g < 4; g++) {
    const group = out.slice(g * 4, g * 4 + 4);
    assert.ok(group.every((v) => v === group[0]), `group ${g}: ${group}`);
  }
  assert.notEqual(out[0], out[4]);
});

test('set changes bits and rate on the fly and sanitises them', () => {
  const c = createCrusher({ bits: 16, rate: 1 });
  c.set({ bits: 1, rate: 2 });
  assert.ok([-1, 0, 1].includes(c.process(0.9)));
  c.set({ bits: NaN, rate: 0 }); // unusable: fall back to the safe ends, never throw or stall
  for (let i = 0; i < 10; i++) assert.ok(Number.isFinite(c.process(0.5)));
});

test('two crushers do not share the held sample', () => {
  const a = createCrusher({ bits: 16, rate: 4 });
  const b = createCrusher({ bits: 16, rate: 4 });
  a.process(0.5);
  a.process(0.6);
  assert.equal(b.process(-0.5), -0.5);
});
