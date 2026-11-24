import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynthModule, padNote, cleanOscs, PADS } from '../js/module.js';
import { validateScene, serializeModule, cleanModule } from '../js/scene.js';
import { startVoice } from '../js/synth.js';

function fakeCtx() {
  const calls = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const node = () => ({ connect(n) { return n; }, disconnect() {}, start() {}, stop() { calls.push('stop'); }, gain: param(), frequency: param(), detune: param() });
  return { calls, currentTime: 0, createOscillator: node, createGain: node };
}

test('pad notes climb the scale from the bottom left and repeat an octave higher', () => {
  const cfg = { mode: 'scale', root: 'C', scale: 'pentatonicMinor' };
  assert.equal(padNote(cfg, 1) - padNote(cfg, 0), 3);
  assert.equal(padNote(cfg, 5) - padNote(cfg, 0), 12);
  assert.equal(padNote(cfg, 0, 1) - padNote(cfg, 0), 12);
});

test('the three oscillators are cleaned and default', () => {
  const o = cleanOscs([{ wave: 'nope', level: 9, octave: 7, detune: -90 }]);
  assert.equal(o.length, 3);
  assert.deepEqual([o[0].wave, o[0].level, o[0].octave, o[0].detune], ['triangle', 1, 2, -50]);
  assert.equal(o[2].level, 0);
});

test('a synth module plays held notes and releases them', () => {
  const ctx = fakeCtx();
  const m = createSynthModule();
  m.attach(ctx, {});
  m.noteOn(3);
  assert.equal(m.state.held.size, 1);
  m.noteOff(3);
  assert.equal(m.state.held.size, 0);
  m.noteOn(99); // not a pad
  assert.equal(m.state.held.size, 0);
  m.noteOn(0);
  m.stop();
  assert.equal(m.state.held.size, 0);
  m.noteOn(0); // stopped: silent
  assert.equal(m.state.held.size, 0);
  assert.equal(PADS, 16);
});

test('osc, octave and scale parameters are accepted and limited', () => {
  const m = createSynthModule();
  m.setParam('osc:1', { wave: 'square', level: 2 });
  assert.equal(m.params.oscs[1].wave, 'square');
  assert.equal(m.params.oscs[1].level, 1);
  m.setParam('osc:9', { wave: 'sine' });
  m.setParam('octave', 5);
  assert.equal(m.params.octave, 2);
  m.setParam('pitchConfig', { mode: 'scale', root: 'D', scale: 'major' }); // must not touch a melody
  assert.equal(m.padNote(0) % 12, 2);
});

test('a synth survives a scene round trip', () => {
  const m = createSynthModule();
  m.setParam('osc:2', { level: 0.5, octave: -2 });
  m.setParam('octave', 1);
  const data = { version: 1, effects: [], modules: [{ ...serializeModule(m), sends: [] }] };
  const { scene } = validateScene(JSON.parse(JSON.stringify(data)));
  const c = scene.modules[0];
  assert.equal(c.type, 'synth');
  assert.equal(c.params.oscs[2].level, 0.5);
  assert.equal(c.params.oscs[2].octave, -2);
  assert.equal(c.params.octave, 1);
  assert.ok(cleanModule({ type: 'synth', params: { oscs: 'x' } }));
});

test('a voice with no sounding oscillator makes no sound and does not throw', () => {
  const ctx = fakeCtx();
  const v = startVoice(ctx, {}, { freq: 220, oscs: cleanOscs([{ level: 0 }, { level: 0 }, { level: 0 }]) });
  v.release();
  v.kill();
});
