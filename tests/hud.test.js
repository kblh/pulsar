import test from 'node:test';
import assert from 'node:assert/strict';
import { snap, toFraction, fromFraction, envLayout, nodePositions, envFromDrag, nearestNode, valueChars, formatCents, splitRoot, joinRoot, fractionFromX, keyValue, createGesture, dampedPoint } from '../js/hud.js';
import { ROOTS } from '../js/options.js';

const unit = { min: 0, max: 1, step: 0.05 };
const near = (a, b, eps = 0.0101) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('snap clamps into the range', () => {
  assert.equal(snap(5, unit), 1);
  assert.equal(snap(-3, unit), 0);
});

test('snap rounds to the step grid that starts at min', () => {
  assert.equal(snap(0.37, unit), 0.35);
  assert.equal(snap(2.2, { min: 0.5, max: 30, step: 0.5 }), 2);
  assert.equal(snap(2.3, { min: 0.5, max: 30, step: 0.5 }), 2.5);
  assert.equal(snap(141.4, { min: 20, max: 300, step: 1 }), 141);
});

test('snap leaves no floating-point noise', () => {
  assert.equal(snap(0.1 + 0.2, { min: 0, max: 1, step: 0.1 }), 0.3);
  assert.equal(snap(0.7000000001, { min: 0, max: 1, step: 0.05 }), 0.7);
});

test('snap turns unusable input into min', () => {
  for (const bad of [NaN, null, undefined, 'abc', '', Infinity, -Infinity, true, {}, []]) assert.equal(snap(bad, { min: 20, max: 300, step: 1 }), 20, String(bad));
  assert.equal(snap('140', { min: 20, max: 300, step: 1 }), 140);
});

test('toFraction and fromFraction round-trip linear values', () => {
  assert.equal(toFraction(0.5, { min: 0, max: 1 }), 0.5);
  assert.equal(toFraction(160, { min: 20, max: 300 }), 0.5);
  for (const v of [20, 57, 140, 299, 300]) assert.equal(fromFraction(toFraction(v, { min: 20, max: 300 }), { min: 20, max: 300, step: 1 }), v);
  assert.equal(toFraction(999, { min: 0, max: 1 }), 1);
  assert.equal(toFraction(-9, { min: 0, max: 1 }), 0);
  assert.equal(toFraction(NaN, { min: 0, max: 1 }), 0);
});

test('log scale maps the ends to 0 and 1 and the middle to the geometric mean', () => {
  const o = { min: 200, max: 12000, scale: 'log' };
  assert.equal(toFraction(200, o), 0);
  assert.equal(toFraction(12000, o), 1);
  near(toFraction(Math.sqrt(200 * 12000), o), 0.5, 1e-9);
  assert.equal(fromFraction(0, { ...o, step: 100 }), 200);
  assert.equal(fromFraction(1, { ...o, step: 100 }), 12000);
});

test('fromFraction clamps fractions outside 0..1', () => {
  assert.equal(fromFraction(-4, { min: 0, max: 1, step: 0.05 }), 0);
  assert.equal(fromFraction(9, { min: 0, max: 1, step: 0.05 }), 1);
  assert.equal(fromFraction(NaN, { min: 0, max: 1, step: 0.05 }), 0);
});

const layout = envLayout({ w: 320, h: 120, pad: 16 });
const DEFAULT = { a: 0.01, d: 0.1, s: 0.5, r: 0.15 };

test('envelope nodes sit where the envelope says', () => {
  const p = nodePositions(DEFAULT, layout);
  assert.ok(p.attack.x > p.start.x);
  assert.equal(p.attack.y, 16);
  near(p.decay.y, 16 + 0.5 * (120 - 32), 1e-9);
  assert.equal(nodePositions({ ...DEFAULT, s: 1 }, layout).decay.y, 16);
  assert.equal(nodePositions({ ...DEFAULT, s: 0 }, layout).decay.y, 120 - 16);
  assert.ok(p.release.x > p.sustainEnd.x);
  assert.equal(p.release.y, 120 - 16);
  assert.ok(p.decay.x >= p.attack.x);
});

test('dragging a node back onto its own position keeps the value', () => {
  for (const a of [0, 0.01, 0.5, 5]) {
    const env = { ...DEFAULT, a };
    near(envFromDrag('attack', nodePositions(env, layout).attack, env, layout).a, a);
  }
  for (const [d, s] of [[0, 0], [0.1, 0.5], [2, 1], [5, 0.25]]) {
    const env = { ...DEFAULT, d, s };
    const out = envFromDrag('decay', nodePositions(env, layout).decay, env, layout);
    near(out.d, d);
    near(out.s, s);
  }
  for (const r of [0, 0.15, 1, 5]) {
    const env = { ...DEFAULT, r };
    near(envFromDrag('release', nodePositions(env, layout).release, env, layout).r, r);
  }
});

test('each node only reports its own keys', () => {
  const p = nodePositions(DEFAULT, layout);
  assert.deepEqual(Object.keys(envFromDrag('attack', p.attack, DEFAULT, layout)), ['a']);
  assert.deepEqual(Object.keys(envFromDrag('decay', p.decay, DEFAULT, layout)).sort(), ['d', 's']);
  assert.deepEqual(Object.keys(envFromDrag('release', p.release, DEFAULT, layout)), ['r']);
});

test('dragging far outside the graph stays inside the limits', () => {
  for (const x of [-9999, 0, 9999]) {
    for (const y of [-9999, 0, 9999]) {
      const pt = { x, y };
      const a = envFromDrag('attack', pt, DEFAULT, layout).a;
      const { d, s } = envFromDrag('decay', pt, DEFAULT, layout);
      const r = envFromDrag('release', pt, DEFAULT, layout).r;
      for (const v of [a, d, r]) assert.ok(v >= 0 && v <= 5, `time ${v}`);
      assert.ok(s >= 0 && s <= 1, `sustain ${s}`);
    }
  }
});

test('a short attack can be picked: one pixel moves it by well under 0.1 s', () => {
  const x = nodePositions({ ...DEFAULT, a: 0.01 }, layout).attack.x;
  const a1 = envFromDrag('attack', { x, y: 16 }, DEFAULT, layout).a;
  const a2 = envFromDrag('attack', { x: x + 1, y: 16 }, DEFAULT, layout).a;
  assert.ok(Math.abs(a2 - a1) < 0.1);
  assert.ok(a1 > 0 && a1 < 0.05);
});

test('splitRoot reads the drone root and shows enharmonic spellings as ROOTS names', () => {
  assert.deepEqual(splitRoot('C2'), { root: 'C', octave: 2 });
  assert.deepEqual(splitRoot('Db2'), { root: 'C#', octave: 2 });
  assert.deepEqual(splitRoot('D#3'), { root: 'Eb', octave: 3 });
  assert.deepEqual(splitRoot('A#0'), { root: 'Bb', octave: 0 });
  assert.deepEqual(splitRoot('C6'), { root: 'C', octave: 6 });
  for (const bad of ['xyz', '', null, undefined, 42]) assert.equal(splitRoot(bad), null, String(bad));
});

test('joinRoot builds a note name and split/join round-trip for every root and octave 0-6', () => {
  assert.equal(joinRoot('Eb', 3), 'Eb3');
  for (const root of ROOTS) for (let octave = 0; octave <= 6; octave++) assert.deepEqual(splitRoot(joinRoot(root, octave)), { root, octave });
});

test('nearestNode picks the closest of the three nodes within the radius, otherwise null', () => {
  const p = nodePositions(DEFAULT, layout);
  assert.equal(nearestNode({ x: p.release.x + 3, y: p.release.y - 4 }, p, 26), 'release');
  assert.equal(nearestNode({ x: p.decay.x, y: p.decay.y + 10 }, p, 26), 'decay');
  assert.equal(nearestNode({ x: p.attack.x - 10, y: p.attack.y - 18 }, p, 26), 'attack'); // above the svg box
  assert.equal(nearestNode({ x: 160, y: 60 }, p, 5), null);
  assert.equal(nearestNode({ x: p.attack.x - 20, y: p.attack.y - 18 }, p, 26), null); // 26.9 away
  assert.equal(nearestNode({ x: NaN, y: 0 }, p, 26), null);
});

test('nearestNode ignores the two fixed corner points and breaks ties towards attack', () => {
  const p = nodePositions(DEFAULT, layout);
  assert.equal(nearestNode({ x: p.start.x, y: p.start.y }, p, 4), null);
  assert.equal(nearestNode({ x: p.sustainEnd.x, y: p.sustainEnd.y }, p, 4), null);
  const stacked = nodePositions({ a: 5, d: 0, s: 1, r: 0.15 }, layout); // attack and decay coincide
  assert.equal(nearestNode({ x: stacked.attack.x, y: stacked.attack.y }, stacked, 26), 'attack');
});

test('valueChars is the widest text a slider will ever show, so its width can be fixed', () => {
  const fade = { min: 0.5, max: 30, step: 0.5 };
  const fadeFormat = (v) => `${v} s`;
  const widest = (o, fmt) => { let w = 0; for (let v = o.min; v <= o.max + 1e-9; v += o.step) w = Math.max(w, fmt(snap(v, o)).length); return w; };
  assert.equal(valueChars(fadeFormat, fade), widest(fade, fadeFormat));
  const time = { min: 10, max: 2000, step: 10 };
  const timeFormat = (v) => `${v} ms`;
  assert.equal(valueChars(timeFormat, time), widest(time, timeFormat));
  assert.equal(valueChars((v) => `${Math.round(v * 100)}%`, { min: 0, max: 1, step: 0.01 }), 4);
});

test('formatCents shows a signed whole number of cents', () => {
  assert.equal(formatCents(0), '0 ct');
  assert.equal(formatCents(12), '+12 ct');
  assert.equal(formatCents(-7), '\u22127 ct');
  assert.equal(formatCents(50), '+50 ct');
  assert.equal(formatCents(-50), '\u221250 ct');
  assert.equal(formatCents(12.4), '+12 ct');
  assert.equal(formatCents(-0.2), '0 ct');
});

test('fractionFromX maps a pointer to 0..1 and clamps outside the track', () => {
  const r = { left: 100, width: 200 };
  assert.equal(fractionFromX(100, r), 0);
  assert.equal(fractionFromX(200, r), 0.5);
  assert.equal(fractionFromX(300, r), 1);
  assert.equal(fractionFromX(50, r), 0);
  assert.equal(fractionFromX(999, r), 1);
});

test('fractionFromX survives a hidden or unusable track', () => {
  assert.equal(fractionFromX(150, { left: 100, width: 0 }), 0);
  assert.equal(fractionFromX(150, { left: 100, width: -5 }), 0);
  assert.equal(fractionFromX(NaN, { left: 100, width: 200 }), 0);
  assert.equal(fractionFromX(150, undefined), 0);
});

test('keyValue moves a linear slider by one step, ten with the page keys, and to the ends', () => {
  const o = { min: 0, max: 1, step: 0.05 };
  assert.equal(keyValue('ArrowRight', 0.5, o), 0.55);
  assert.equal(keyValue('ArrowDown', 0.5, o), 0.45);
  assert.equal(keyValue('PageUp', 0.5, o), 1);
  assert.equal(keyValue('PageDown', 0.5, o), 0);
  assert.equal(keyValue('Home', 0.5, o), 0);
  assert.equal(keyValue('End', 0.5, o), 1);
  assert.equal(keyValue('a', 0.5, o), null);
});

test('keyValue moves a log slider by 5 % of the value but never less than a step', () => {
  const o = { min: 20, max: 300, step: 1, scale: 'log' };
  assert.equal(keyValue('ArrowRight', 200, o), 210);
  assert.equal(keyValue('ArrowRight', 20, o), 21);
  assert.equal(keyValue('ArrowRight', 300, o), 300);
});

test('touch gesture: a short press and release is a tap that applies once on release', () => {
  const g = createGesture({ pointerType: 'touch' });
  assert.equal(g.down(100), false);
  assert.equal(g.move(104), false);
  assert.equal(g.up(104), true);
  assert.equal(g.up(104), false);
});

test('touch gesture: moving past the slop starts a drag that follows the finger', () => {
  const g = createGesture({ pointerType: 'touch' });
  assert.equal(g.down(100), false);
  assert.equal(g.move(109), true);
  assert.equal(g.move(150), true);
  assert.equal(g.up(150), false);
});

test('touch gesture: cancel after down applies nothing', () => {
  const g = createGesture({ pointerType: 'touch' });
  g.down(100);
  g.cancel();
  assert.equal(g.move(200), false);
  assert.equal(g.up(200), false);
  assert.equal(g.active, false);
});

test('mouse gesture applies on press, follows the move, and does nothing on release', () => {
  const g = createGesture({ pointerType: 'mouse' });
  assert.equal(g.down(10), true);
  assert.equal(g.move(40), true);
  assert.equal(g.up(40), false);
});

test('a gesture ignores events before down and unusable x', () => {
  const g = createGesture({ pointerType: 'touch' });
  assert.equal(g.move(5), false);
  assert.equal(g.up(5), false);
  g.down(10);
  assert.equal(g.move(NaN), false);
});

test('dampedPoint scales the pointer movement and leaves the axis alone for unusable input', () => {
  const grab = { x: 100, y: 50 };
  const pos = { x: 200, y: 80 };
  const p = dampedPoint(grab, pos, { x: 150, y: 50 }, 0.4);
  near(p.x, 220, 1e-9);
  near(p.y, 80, 1e-9);
  const q = dampedPoint(grab, pos, { x: NaN, y: 70 }, 0.4);
  near(q.x, 200, 1e-9);
  near(q.y, 88, 1e-9);
  assert.deepEqual(dampedPoint(grab, pos, grab, 0.4), pos);
});
