import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, advance, LOOKAHEAD, MAX_LAG, RESYNC_OFFSET } from '../js/track.js';

function simulate(track, seconds, bpm, swing = 0, tick = 0.025, start = 0) {
  const out = [];
  for (let now = start; now <= start + seconds; now += tick) out.push(...advance(track, now, bpm, swing));
  return out;
}

test('constants', () => {
  assert.equal(LOOKAHEAD, 0.12);
  assert.equal(MAX_LAG, 0.5);
  assert.equal(RESYNC_OFFSET, 0.05);
});

test('first advance schedules the first step inside the lookahead', () => {
  const t = createTrack(0);
  const ev = advance(t, 0, 120, 0);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].stepIndex, 0);
  assert.ok(Math.abs(ev[0].time - 0.05) < 1e-9);
  assert.ok(ev.every((e) => e.time <= 0.12));
});

test('long sleep resyncs instead of bursting', () => {
  const t = createTrack(0);
  advance(t, 0, 120, 0);
  const ev = advance(t, 10, 120, 0);
  assert.ok(ev.length <= Math.ceil(LOOKAHEAD / 0.125) + 1);
  assert.ok(ev[0].time >= 10);
});

test('times strictly increase across calls', () => {
  const ev = simulate(createTrack(0), 5, 120);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].time > ev[i - 1].time);
});

test('live bpm change only affects later steps, no repeats', () => {
  const t = createTrack(0);
  const ev = [...advance(t, 0, 120, 0), ...advance(t, 0.1, 60, 0), ...advance(t, 0.35, 60, 0)];
  assert.equal(ev.length, 3);
  assert.ok(Math.abs(ev[2].time - ev[1].time - 0.25) < 1e-9);
});

test('extreme bpm gives finite, increasing times', () => {
  for (const bpm of [20, 300]) {
    const ev = simulate(createTrack(0), 10, bpm);
    assert.ok(ev.length > 0);
    for (let i = 0; i < ev.length; i++) {
      assert.ok(Number.isFinite(ev[i].time));
      if (i) assert.ok(ev[i].time > ev[i - 1].time);
    }
  }
});

test('swing 1 delays odd steps by half a step', () => {
  const ev = advance(createTrack(0), 0, 240, 1);
  assert.equal(ev.length, 2);
  assert.ok(Math.abs(ev[1].time - (0.1125 + 0.03125)) < 1e-9);
});

test('a short stall (under MAX_LAG) never schedules past-dated notes', () => {
  for (const [bpm, lag] of [[300, 0.5], [120, 0.4], [240, 0.3]]) {
    const t = createTrack(0);
    advance(t, 0, bpm, 0);
    const now = lag;
    const ev = advance(t, now, bpm, 0);
    assert.ok(ev.every((e) => e.time >= now), `bpm ${bpm} lag ${lag}`);
  }
});

test('skipped steps still advance stepIndex', () => {
  const t = createTrack(0);
  advance(t, 0, 120, 0);
  advance(t, 0.4, 120, 0);
  assert.ok(t.stepIndex > 1);
});

test('stepIndex wraps after 16 steps', () => {
  const ev = simulate(createTrack(0), 5, 120);
  assert.equal(ev[16].stepIndex, 0);
  assert.equal(ev[15].stepIndex, 15);
});

test('tracks with different bpm do not share a grid', () => {
  const a = simulate(createTrack(0), 10, 100);
  const b = simulate(createTrack(0), 10, 130);
  assert.notEqual(a.length, b.length);
  assert.ok(Math.abs(b.length / a.length - 1.3) < 0.1);
});
