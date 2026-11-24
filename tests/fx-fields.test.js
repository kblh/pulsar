import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_TYPES, FX_DEFAULTS, FX_RANGES } from '../js/fx.js';
import { FX_FIELDS, FX_LABELS } from '../js/fx-fields.js';

test('every effect type has UI fields for exactly its parameters, matching the ranges', () => {
  for (const type of FX_TYPES) {
    const fields = FX_FIELDS[type];
    assert.ok(Array.isArray(fields), `fields for ${type}`);
    assert.deepEqual(fields.map((f) => f.key).sort(), Object.keys(FX_DEFAULTS[type]).sort(), type);
    for (const f of fields) {
      const [lo, hi] = FX_RANGES[type][f.key];
      assert.equal(f.min, lo, `${type}.${f.key} min`);
      assert.equal(f.max, hi, `${type}.${f.key} max`);
      assert.ok(f.step > 0 && f.step <= hi - lo, `${type}.${f.key} step`);
      const text = f.format(FX_DEFAULTS[type][f.key]);
      assert.ok(typeof text === 'string' && text.length > 0, `${type}.${f.key} format`);
    }
  }
});

test('every effect type has a menu label', () => {
  for (const type of FX_TYPES) assert.ok(typeof FX_LABELS[type] === 'string' && FX_LABELS[type].length > 0, type);
});

test('eq fields show decibels with a sign and the mid frequency in hertz', () => {
  const f = Object.fromEntries(FX_FIELDS.eq.map((x) => [x.key, x]));
  assert.equal(f.low.format(0), '0 dB');
  assert.equal(f.low.format(3), '+3 dB');
  assert.equal(f.mid.format(-6), '\u22126 dB');
  assert.equal(f.high.format(1.5), '+1.5 dB');
  assert.equal(f.high.format(12), '+12 dB');
  assert.equal(f.midFreq.format(1000), '1000 Hz');
  assert.equal(f.midFreq.scale, 'log');
});

test('bitcrusher fields: bits as "N bit", rate as a divisor', () => {
  const f = Object.fromEntries(FX_FIELDS.bitcrusher.map((x) => [x.key, x]));
  assert.equal(f.bits.format(8), '8 bit');
  assert.equal(f.rate.format(4), '\u00f74');
  assert.equal(f.bits.step, 1);
  assert.equal(f.rate.step, 1);
});

test('distortion fields: drive and shape in percent, tone in Hz on a log scale', () => {
  const f = Object.fromEntries(FX_FIELDS.distortion.map((x) => [x.key, x]));
  assert.equal(f.drive.format(0.4), '40%');
  assert.equal(f.shape.format(1), '100%');
  assert.equal(f.tone.format(5000), '5000 Hz');
  assert.equal(f.tone.scale, 'log');
  assert.equal(FX_LABELS.distortion, 'drive');
});

test('chorus fields: rate in Hz on a log scale, the rest in percent', () => {
  const f = Object.fromEntries(FX_FIELDS.chorus.map((x) => [x.key, x]));
  assert.equal(f.rate.format(0.8), '0.80 Hz');
  assert.equal(f.rate.scale, 'log');
  assert.equal(f.depth.format(0.4), '40%');
  assert.equal(FX_LABELS.chorus, 'chorus');
});
