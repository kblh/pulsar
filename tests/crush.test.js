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
  const out = c.process(0.9);
  assert.ok([-0.9, 0, 0.9].some((v) => Math.abs(out - v) < 1e-9), `got ${out}`); // levels are relative to the signal peak
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

const SR = 44100;
const sine = (amp, n, hz = 440, from = 0) => Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * (i + from)) / SR));
const rms = (a) => Math.sqrt(a.reduce((m, x) => m + x * x, 0) / a.length);
const run = (c, input) => input.map((x) => c.process(x));

test('a quiet signal is still crushed audibly at every bit depth (levels follow the signal peak)', () => {
  // A melodic note peaks at about 0.07 on a default send; fixed full-scale levels would zero it at 1-3 bits.
  const input = sine(0.07, 4410);
  for (let bits = 1; bits <= 16; bits++) {
    const c = createCrusher({ bits, rate: 1, sampleRate: SR });
    const out = run(c, input).slice(2000);
    assert.ok(rms(out) > 0.3 * rms(input.slice(2000)), `${bits} bit: output rms ${rms(out)}`);
  }
});

test('the crush does not depend on how loud the signal is', () => {
  const shape = (amp) => {
    const out = run(createCrusher({ bits: 2, rate: 1, sampleRate: SR }), sine(amp, 8820)).slice(4410);
    const peak = Math.max(...out.map(Math.abs));
    return out.map((x) => x / peak);
  };
  const quiet = shape(0.05);
  const loud = shape(0.5);
  const diff = rms(quiet.map((x, i) => x - loud[i]));
  assert.ok(diff < 0.15, `normalised waveforms differ by rms ${diff}`);
});

test('after a loud passage a quiet one is crushed audibly again within a second', () => {
  const c = createCrusher({ bits: 2, rate: 1, sampleRate: SR });
  run(c, sine(1, 8820));
  const quiet = sine(0.07, SR * 1.2, 440, 8820);
  const out = run(c, quiet);
  const tail = out.slice(-4410);
  assert.ok(rms(tail) > 0.3 * rms(quiet.slice(-4410)), `tail rms ${rms(tail)}`);
});

test('silence stays exactly silent after any signal, and the output never exceeds the recent input peak', () => {
  for (const bits of [1, 4, 8, 16]) {
    const c = createCrusher({ bits, rate: 1, sampleRate: SR });
    const loud = sine(0.6, 4410);
    const out = run(c, loud);
    assert.ok(Math.max(...out.map(Math.abs)) <= 0.6 + 1e-9, `${bits} bit peak`);
    for (let i = 0; i < SR * 3; i++) c.process(0);
    for (let i = 0; i < 64; i++) assert.equal(c.process(0), 0, `${bits} bit silence`);
  }
});
