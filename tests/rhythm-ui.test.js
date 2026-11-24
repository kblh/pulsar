import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPoint, RINGS } from '../js/rhythm-circle.js';
import { BUILT_IN_RHYTHMS, createRhythmStore, cleanRhythm } from '../js/rhythm-store.js';
import { createRhythmicModule, cleanSounds } from '../js/module.js';
import { DRUM_SOUNDS } from '../js/synth.js';
import { validateScene, serializeModule } from '../js/scene.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

test('the rings go hi-hat, snare, kick from the outside in, step 0 at the top', () => {
  assert.deepEqual(RINGS.map((r) => r.drum), ['hat', 'snare', 'kick']);
  assert.ok(RINGS[0].radius > RINGS[1].radius && RINGS[1].radius > RINGS[2].radius);
  assert.deepEqual(stepPoint(0, 100), { x: 250, y: 150 });
  assert.deepEqual(stepPoint(4, 100), { x: 350, y: 250 });
});

test('every drum has three sounds and a module keeps a valid choice per drum', () => {
  for (const d of ['kick', 'snare', 'hat']) assert.equal(DRUM_SOUNDS[d].length, 3);
  assert.deepEqual(createRhythmicModule().params.sounds, { kick: 0, snare: 0, hat: 0 });
  const m = createRhythmicModule({ sounds: { kick: 2, snare: 9, hat: 'x' } });
  assert.deepEqual(m.params.sounds, { kick: 2, snare: 0, hat: 0 });
  m.setParam('sound:hat', 1);
  m.setParam('sound:hat', 7);
  m.setParam('sound:tom', 1);
  assert.deepEqual(m.params.sounds, { kick: 2, snare: 0, hat: 1 });
  assert.deepEqual(cleanSounds(null), { kick: 0, snare: 0, hat: 0 });
});

test('the sound choice survives a scene round trip', () => {
  const m = createRhythmicModule({ sounds: { kick: 1, snare: 2, hat: 0 } });
  m.volume = 0.5;
  const { scene } = validateScene({ version: 1, effects: [], modules: [JSON.parse(JSON.stringify({ ...serializeModule({ ...m, out: null, sends: [] }) }))] });
  assert.deepEqual(scene?.modules[0].params.sounds, { kick: 1, snare: 2, hat: 0 });
});

test('built-in rhythms have 2 to 32 steps per drum and a rotation inside the lane', () => {
  assert.ok(BUILT_IN_RHYTHMS.length >= 10);
  for (const r of BUILT_IN_RHYTHMS) {
    for (const d of ['kick', 'snare', 'hat']) {
      assert.ok(r.voices[d].length >= 2 && r.voices[d].length <= 32, `${r.name} ${d}`);
      assert.ok((r.rotation?.[d] ?? 0) < r.voices[d].length);
    }
  }
  assert.equal(BUILT_IN_RHYTHMS.find((r) => r.id === 'tresillo').voices.kick.length, 8);
  assert.equal(BUILT_IN_RHYTHMS.find((r) => r.id === 'bembe').voices.hat.length, 12);
  assert.equal(new Set(BUILT_IN_RHYTHMS.map((r) => r.id)).size, BUILT_IN_RHYTHMS.length);
});

test('the rhythm store saves, overwrites by name, lists and removes', () => {
  const store = createRhythmStore(memory());
  const r = { voices: { kick: 'x...............', snare: '....x...........', hat: 'x.x.x.x.x.x.x.x.' }, sounds: { kick: 1, snare: 0, hat: 2 } };
  const a = store.save('mine', r);
  assert.equal(a.ok, true);
  assert.equal(store.save('mine', { ...r, voices: { ...r.voices, kick: 'x...x...x...x...' } }).id, a.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(a.id).voices.kick, 'x...x...x...x...');
  assert.deepEqual(store.get(a.id).sounds, { kick: 1, snare: 0, hat: 2 });
  assert.equal(store.save('  ', r).ok, false);
  assert.equal(store.remove(a.id).ok, true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove('nope').ok, false);
});

test('the store survives junk and blocked storage', () => {
  const junk = { getItem: () => '{not json', setItem: () => {} };
  assert.deepEqual(createRhythmStore(junk).list(), []);
  const full = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  assert.equal(createRhythmStore(full).save('x', { voices: { kick: 'x', snare: '', hat: '' } }).ok, false);
  assert.equal(cleanRhythm({ voices: 'x' }), null);
  assert.equal(cleanRhythm({ voices: { kick: 'xyz' } }).voices.kick, 'x..');
});
