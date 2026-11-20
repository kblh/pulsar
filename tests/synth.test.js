import test from 'node:test';
import assert from 'node:assert/strict';
import { oscMix, playNote, createDroneVoice } from '../js/synth.js';
import { stubCtx } from './helpers/stub-ctx.js';

const kinds = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind);
const firstValue = (param) => param.calls.find((c) => c[0] === 'value')?.[1];
const lastTarget = (param) => param.calls.filter((c) => c[0] === 'target').at(-1);
const NOTE = { freq: 440, time: 1, duration: 0.5, wave: 'sine' };

test('oscMix is a linear crossfade that adds up to 1 and survives unusable input', () => {
  assert.deepEqual(oscMix(0), { a: 1, b: 0 });
  assert.deepEqual(oscMix(1), { a: 0, b: 1 });
  assert.deepEqual(oscMix(0.25), { a: 0.75, b: 0.25 });
  for (const bad of [9, -3, NaN, 'abc', null, undefined, true, {}]) {
    const { a, b } = oscMix(bad);
    assert.ok(a >= 0 && a <= 1 && b >= 0 && b <= 1, String(bad));
    assert.ok(Math.abs(a + b - 1) < 1e-12, String(bad));
  }
  assert.deepEqual(oscMix(9), { a: 0, b: 1 });
  assert.deepEqual(oscMix('abc'), { a: 1, b: 0 });
});

test('a note without the new options, or with mix 0, is built exactly as before: one oscillator straight into the envelope', () => {
  for (const extra of [{}, { mix: 0, wave2: 'square', detune: 30 }]) {
    const ctx = stubCtx();
    const dest = {};
    playNote(ctx, dest, { ...NOTE, ...extra });
    const oscs = kinds(ctx, 'osc');
    const gains = kinds(ctx, 'gain');
    assert.equal(oscs.length, 1);
    assert.equal(gains.length, 1);
    assert.ok(oscs[0].connections.includes(gains[0]));
    assert.ok(gains[0].connections.includes(dest));
    assert.deepEqual(oscs[0].starts, [1]);
  }
});

test('a note with mix > 0 plays both oscillators, each through its own level, into one envelope', () => {
  const ctx = stubCtx();
  const dest = {};
  playNote(ctx, dest, { ...NOTE, wave2: 'square', mix: 0.5, detune: 20 });
  const [a, b] = kinds(ctx, 'osc');
  assert.equal(kinds(ctx, 'osc').length, 2);
  assert.deepEqual([a.type, b.type], ['sine', 'square']);
  assert.equal(b.frequency.calls.find((c) => c[0] === 'value')[1], 440);
  assert.equal(firstValue(b.detune), 20);
  assert.equal(firstValue(a.detune), undefined);
  const levels = kinds(ctx, 'gain').map((g) => firstValue(g.gain)).filter((v) => v !== undefined);
  assert.deepEqual(levels.sort(), [0.5, 0.5]);
  assert.deepEqual([a.starts, b.starts], [[1], [1]]);
  assert.equal(a.stops.length, 1);
  assert.equal(b.stops.length, 1);
  assert.equal(a.stops[0], b.stops[0]);
  const env = kinds(ctx, 'gain').find((g) => g.connections.includes(dest));
  assert.ok(env, 'one envelope gain feeds the destination');
  for (const osc of [a, b]) {
    const level = kinds(ctx, 'gain').find((g) => osc.connections.includes(g));
    assert.ok(level.connections.includes(env), 'each oscillator reaches the envelope through its level');
  }
});

test('mix and detune of a note are kept in range and cleaned up when the note ends', () => {
  const ctx = stubCtx();
  playNote(ctx, {}, { ...NOTE, wave2: 'square', mix: 7, detune: 1e9 });
  const [, b] = kinds(ctx, 'osc');
  assert.equal(firstValue(b.detune), 50);
  const levels = kinds(ctx, 'gain').map((g) => firstValue(g.gain)).filter((v) => v !== undefined).sort();
  assert.deepEqual(levels, [0, 1]);
  const ctx2 = stubCtx();
  playNote(ctx2, {}, { ...NOTE, wave2: 'square', mix: 0.5, detune: NaN });
  assert.equal(firstValue(kinds(ctx2, 'osc')[1].detune), 0);
  const ctx3 = stubCtx();
  playNote(ctx3, {}, { ...NOTE, wave2: 'square', mix: 0.5, detune: 12.6 });
  assert.equal(firstValue(kinds(ctx3, 'osc')[1].detune), 13);
  for (const osc of kinds(ctx3, 'osc')) osc.onended();
  for (const n of ctx3.nodes) assert.ok(n.disconnected >= 1, `${n.kind} left connected`);
});

test('a drone voice without a second oscillator is built as before', () => {
  const ctx = stubCtx();
  const dest = {};
  createDroneVoice(ctx, dest, { freq: 110, wave: 'sine', peak: 0.5, fade: 4 });
  assert.equal(kinds(ctx, 'osc').length, 1);
  assert.equal(kinds(ctx, 'gain').length, 1);
  assert.ok(kinds(ctx, 'osc')[0].connections.includes(kinds(ctx, 'gain')[0]));
  assert.equal(firstValue(kinds(ctx, 'gain')[0].gain), 0);
});

test('setMix on such a voice adds the second oscillator without a jump, then only moves levels', () => {
  const ctx = stubCtx();
  const voice = createDroneVoice(ctx, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4 });
  const voiceGain = kinds(ctx, 'gain')[0];
  voice.setMix({ mix: 0.5, detune: 20, wave2: 'square' });
  const [a, b] = kinds(ctx, 'osc');
  assert.equal(kinds(ctx, 'osc').length, 2);
  assert.equal(b.type, 'square');
  const [, gA, gB] = kinds(ctx, 'gain');
  assert.ok(a.connections.includes(gA) && gA.connections.includes(voiceGain), 'A now runs through its level');
  assert.ok(b.connections.includes(gB) && gB.connections.includes(voiceGain));
  assert.equal(firstValue(gA.gain), 1, 'A starts at its old level, so inserting the stage does not click');
  assert.equal(firstValue(gB.gain), 0, 'B fades in from silence');
  assert.deepEqual(lastTarget(gA.gain).slice(0, 2), ['target', 0.5]);
  assert.deepEqual(lastTarget(gB.gain).slice(0, 2), ['target', 0.5]);
  assert.deepEqual(lastTarget(b.detune).slice(0, 2), ['target', 20]);
  assert.equal(b.starts.length, 1);
  voice.setMix({ mix: 0.2, detune: -10, wave2: 'square' });
  assert.equal(kinds(ctx, 'osc').length, 2);
  assert.equal(kinds(ctx, 'gain').length, 3);
  assert.deepEqual(lastTarget(gA.gain).slice(0, 2), ['target', 0.8]);
  assert.deepEqual(lastTarget(gB.gain).slice(0, 2), ['target', 0.2]);
  assert.deepEqual(lastTarget(b.detune).slice(0, 2), ['target', -10]);
  voice.setMix({ mix: 0, detune: 0, wave2: 'square' });
  assert.deepEqual(lastTarget(gB.gain).slice(0, 2), ['target', 0]);
  assert.deepEqual(lastTarget(gA.gain).slice(0, 2), ['target', 1]);
  assert.equal(kinds(ctx, 'osc').length, 2);
  for (const g of [gA, gB]) assert.equal(g.gain.calls.filter((c) => c[0] === 'value').length, 1, 'no .value after creation');
});

test('setMix with mix 0 on a voice without B does nothing; out-of-range values are kept in range', () => {
  const ctx = stubCtx();
  const voice = createDroneVoice(ctx, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4 });
  voice.setMix({ mix: 0, detune: 10, wave2: 'square' });
  assert.equal(kinds(ctx, 'osc').length, 1);
  voice.setMix({ mix: 9, detune: 1e9, wave2: 'square' });
  const [, b] = kinds(ctx, 'osc');
  assert.deepEqual(lastTarget(kinds(ctx, 'gain')[2].gain).slice(0, 2), ['target', 1]);
  assert.deepEqual(lastTarget(b.detune).slice(0, 2), ['target', 50]);
});

test('a voice created with mix > 0 starts with both oscillators', () => {
  const ctx = stubCtx();
  createDroneVoice(ctx, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4, wave2: 'square', mix: 0.3, detune: 7 });
  const [a, b] = kinds(ctx, 'osc');
  assert.deepEqual([a.type, b.type], ['sine', 'square']);
  assert.equal(firstValue(b.detune), 7);
  const levels = kinds(ctx, 'gain').map((g) => firstValue(g.gain)).filter((v) => v !== undefined && v !== 0);
  assert.ok(levels.includes(0.7) && levels.includes(0.3));
});

test('release and kill stop and free both oscillators; setMix afterwards does nothing', () => {
  for (const how of ['release', 'kill']) {
    const ctx = stubCtx();
    const voice = createDroneVoice(ctx, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4, wave2: 'square', mix: 0.5 });
    let done = 0;
    if (how === 'release') voice.release(2, () => { done++; });
    else voice.kill();
    const oscs = kinds(ctx, 'osc');
    for (const o of oscs) assert.equal(o.stops.length, 1, `${how}: ${o.type} stopped`);
    const before = ctx.nodes.map((n) => n.disconnected);
    for (const o of oscs) o.onended();
    if (how === 'release') assert.equal(done, 1);
    ctx.nodes.forEach((n, i) => assert.ok(n.disconnected > before[i] || n.disconnected >= 1, `${how}: ${n.kind} left connected`));
    voice.setMix({ mix: 1, detune: 10, wave2: 'saw' });
    assert.equal(kinds(ctx, 'osc').length, 2);
    assert.equal(kinds(ctx, 'gain').length, 3);
  }
});

test('release and kill on a voice that got its second oscillator later free that one too', () => {
  const ctx = stubCtx();
  const voice = createDroneVoice(ctx, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4 });
  voice.setMix({ mix: 0.5, detune: 0, wave2: 'square' });
  voice.release(2);
  const oscs = kinds(ctx, 'osc');
  assert.equal(oscs.length, 2);
  for (const o of oscs) { assert.equal(o.stops.length, 1); o.onended(); }
  for (const n of ctx.nodes) assert.ok(n.disconnected >= 1, `${n.kind} left connected`);
});

test('a fading-out voice that already has its second oscillator still follows setMix, but never gets a new one', () => {
  const ctx = stubCtx();
  const voice = createDroneVoice(ctx, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4, wave2: 'square', mix: 0.5 });
  voice.release(3);
  voice.setMix({ mix: 0.2, detune: -7, wave2: 'square' });
  const [, b] = kinds(ctx, 'osc');
  const [, gA, gB] = kinds(ctx, 'gain');
  assert.deepEqual(lastTarget(gA.gain).slice(0, 2), ['target', 0.8]);
  assert.deepEqual(lastTarget(gB.gain).slice(0, 2), ['target', 0.2]);
  assert.deepEqual(lastTarget(b.detune).slice(0, 2), ['target', -7]);
  const plain = createDroneVoice(stubCtx(), {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4 });
  plain.release(3);
  plain.setMix({ mix: 1, detune: 0, wave2: 'square' });
  const ctx2 = stubCtx();
  const v2 = createDroneVoice(ctx2, {}, { freq: 110, wave: 'sine', peak: 0.5, fade: 4 });
  v2.release(3);
  v2.setMix({ mix: 1, detune: 0, wave2: 'square' });
  assert.equal(kinds(ctx2, 'osc').length, 1, 'no oscillator is added to a voice that is already fading out');
});
