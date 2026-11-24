import test from 'node:test';
import assert from 'node:assert/strict';
import { remapPattern, positionsIn, stepAt, parsePattern, lanePatternLength } from '../js/rhythm.js';
import { createRhythmicModule } from '../js/module.js';
import { validateScene, serializeModule } from '../js/scene.js';

function stubCtx() {
  const created = [];
  const node = () =>
    new Proxy(function () {}, {
      get: (_, k) => (k === 'connect' ? (x) => x : k === 'getChannelData' ? () => new Float32Array(8) : node()),
      set: () => true,
      apply: () => node(),
    });
  const ctx = new Proxy({ sampleRate: 100 }, { get: (t, k) => (k in t ? t[k] : (...a) => (created.push(k), node())) });
  return { ctx, created };
}

test('a lane is as long as its pattern text, a text too short to say is 16', () => {
  assert.equal(lanePatternLength('x..x..x.'), 8);
  assert.equal(lanePatternLength('x'), 16);
  assert.equal(lanePatternLength('x'.repeat(40)), 32);
  assert.equal(parsePattern('x..x', { length: 4 }).length, 4);
});

test('remapPattern keeps hits at the same place in the bar', () => {
  assert.deepEqual(remapPattern([true, false, false, false], 8), [true, false, false, false, false, false, false, false]);
  assert.deepEqual(remapPattern([true, false, true, false], 8).map(Number), [1, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(remapPattern(Array(16).fill(true), 2).filter(Boolean).length, 2);
});

test('positionsIn: 16 steps is one per sixteenth, 8 is every other, 12 drifts off the grid', () => {
  assert.deepEqual(positionsIn(5, 16), [{ pos: 5, offset: 0 }]);
  assert.deepEqual(positionsIn(4, 8), [{ pos: 2, offset: 0 }]);
  assert.deepEqual(positionsIn(3, 8), []);
  const all = Array.from({ length: 16 }, (_, s) => positionsIn(s, 12)).flat();
  assert.deepEqual(all.map((p) => p.pos), Array.from({ length: 12 }, (_, i) => i)); // each position exactly once, in order
  assert.ok(all.every((p) => p.offset >= 0 && p.offset < 1));
  assert.ok(Math.abs(all[1].offset - 1 / 3) < 1e-9);
  const dense = Array.from({ length: 16 }, (_, s) => positionsIn(s, 32)).flat();
  assert.equal(dense.length, 32);
});

test('stepAt turns a lane: position 0 plays the step `rotation` before it', () => {
  assert.equal(stepAt(0, 0, 8), 0);
  assert.equal(stepAt(1, 1, 8), 0);
  assert.equal(stepAt(0, 1, 8), 7);
});

test('subs and rotation: set, clamped, junk ignored, a longer pattern text sets the subdivision', () => {
  const m = createRhythmicModule({ voices: { kick: 'x...x...x...x...' } });
  m.setParam('subs:kick', 8);
  assert.equal(m.params.voices.kick, 'x.x.x.x.');
  assert.equal(m.state.voices.kick.current.length, 8);
  m.setParam('rotation:kick', 3);
  assert.equal(m.params.rotation.kick, 3);
  m.setParam('rotation:kick', 11); // wraps inside the lane
  assert.equal(m.params.rotation.kick, 3);
  m.setParam('subs:kick', 1);
  m.setParam('subs:kick', 33);
  m.setParam('subs:kick', 'x');
  assert.equal(m.state.voices.kick.current.length, 8);
  m.setParam('subs:kick', 2);
  assert.ok(m.params.rotation.kick < 2, 'a shorter lane pulls the rotation in');
  m.setParam('voice:kick', 'x..x..x..x..');
  assert.equal(m.state.voices.kick.current.length, 12);
  assert.equal(createRhythmicModule({ voices: { hat: 'x.x.x.x.' } }).state.voices.hat.current.length, 8);
});

test('playing: a lane of 8 hits half as often as one of 16', () => {
  const hits = (kick) => {
    const { ctx, created } = stubCtx();
    const m = createRhythmicModule({ bpm: 120, voices: { kick, snare: '................', hat: '................' } });
    for (let t = 0; t < 8; t += 0.025) m.tick(ctx, { disconnect() {} }, t);
    return created.filter((k) => k === 'createOscillator').length;
  };
  const sixteen = hits('xxxxxxxxxxxxxxxx');
  const eight = hits('xxxxxxxx');
  assert.ok(sixteen > 0 && eight > 0);
  assert.ok(Math.abs(sixteen / eight - 2) < 0.2, `${sixteen} vs ${eight}`);
});

test('subs and rotation survive a scene round trip', () => {
  const m = createRhythmicModule({ voices: { kick: 'x..x..x.', snare: 'x..x..x..x..', hat: 'x.x.x.x.x.x.x.x.' }, rotation: { kick: 2, snare: 1, hat: 0 } });
  const { scene } = validateScene({ version: 1, effects: [], modules: [JSON.parse(JSON.stringify(serializeModule({ ...m, out: null, sends: [] })))] });
  const p = scene.modules[0].params;
  assert.equal(p.voices.snare.length, 12);
  assert.deepEqual(p.rotation, { kick: 2, snare: 1, hat: 0 });
});
