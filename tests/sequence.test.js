import test from 'node:test';
import assert from 'node:assert/strict';
import { createSequence, cleanDuration, MAX_PARTS, MIN_DURATION, MAX_DURATION, DEFAULT_DURATION } from '../js/sequence.js';

function fakeHost(ids = [1, 2, 3, 4], running = []) {
  const state = new Map(ids.map((id) => [id, running.includes(id)]));
  const calls = [];
  return {
    state,
    calls,
    ids: () => [...state.keys()],
    isRunning: (id) => state.get(id) === true,
    setRunning(id, on) {
      calls.push([id, on]);
      state.set(id, on);
    },
    remove: (id) => state.delete(id),
  };
}

const parts2 = () => [
  { name: 'intro', duration: 10, modules: [1, 2] },
  { name: 'verse', duration: 20, modules: [2, 3] },
];
const on = (host) => [...host.state].filter(([, v]) => v).map(([id]) => id).sort();

test('constants and cleanDuration', () => {
  assert.deepEqual([MAX_PARTS, MIN_DURATION, MAX_DURATION, DEFAULT_DURATION], [32, 1, 600, 30]);
  assert.equal(cleanDuration(12), 12);
  assert.equal(cleanDuration(12.6), 13);
  assert.equal(cleanDuration('45'), 45);
  assert.equal(cleanDuration(0), 1);
  assert.equal(cleanDuration(-5), 1);
  assert.equal(cleanDuration(9999), 600);
  for (const bad of [NaN, 'abc', '', null, undefined, true, {}, [], Infinity, -Infinity]) assert.equal(cleanDuration(bad), 30, String(bad));
});

test('a new sequence has defaults and no parts', () => {
  const s = createSequence({}, fakeHost());
  assert.deepEqual([s.id, s.type, s.name, s.loop, s.index, s.elapsed, s.running], ['sequence', 'sequence', 'sequence', false, 0, 0, false]);
  assert.deepEqual(s.parts, []);
});

test('given parts are cleaned: durations, names, duplicate and unknown members, the 32-part cap', () => {
  const host = fakeHost([1, 2, 3]);
  const raw = [
    { name: 'x'.repeat(100), duration: 'abc', modules: [1, 1, 2, 99, 'a', 2.5, null] },
    { duration: 0, modules: 'nope' },
    { duration: 9999, modules: [3] },
    'junk',
    null,
    { name: 5, duration: NaN },
  ];
  const s = createSequence({ name: ' '.repeat(3), loop: 'yes', parts: raw }, host);
  assert.equal(s.name, 'sequence');
  assert.equal(s.loop, false);
  assert.equal(s.parts[0].name.length, 24);
  assert.equal(s.parts[0].duration, 30);
  assert.deepEqual(s.parts[0].modules, [1, 2]);
  assert.equal(s.parts[1].name, 'part 2');
  assert.equal(s.parts[1].duration, 1);
  assert.deepEqual(s.parts[1].modules, []);
  assert.equal(s.parts[2].duration, 600);
  const many = createSequence({ parts: Array.from({ length: 50 }, () => ({ duration: 5 })) }, host);
  assert.equal(many.parts.length, 32);
});

test('a __proto__ key in the given data changes nothing', () => {
  const evil = JSON.parse('{"name":"s","loop":true,"__proto__":{"polluted":1},"parts":[{"name":"p","duration":5,"modules":[1],"__proto__":{"x":1}}]}');
  const s = createSequence(evil, fakeHost());
  assert.equal(s.loop, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(s.parts[0].x, undefined);
});

test('start without parts does nothing', () => {
  const host = fakeHost();
  const s = createSequence({}, host);
  s.start();
  assert.equal(s.running, false);
  assert.deepEqual(host.calls, []);
});

test('start enters the first part: members start, controlled others stop, others untouched, running members left alone', () => {
  const host = fakeHost([1, 2, 3, 4], [2, 3, 4]); // 4 is in no part, 2 already runs
  const s = createSequence({ parts: parts2() }, host);
  s.start();
  assert.equal(s.running, true);
  assert.deepEqual(host.calls, [[1, true], [3, false]]);
  assert.deepEqual(on(host), [1, 2, 4]);
});

test('time moves from the second tick; a part ends, the next one is entered with the carried-over time', () => {
  const host = fakeHost();
  const s = createSequence({ parts: parts2() }, host);
  s.start();
  host.calls.length = 0;
  s.tick(100);
  assert.equal(s.elapsed, 0, 'the first tick only records the time');
  s.tick(109);
  assert.equal(s.elapsed, 9);
  assert.deepEqual(host.calls, []);
  s.tick(112);
  assert.equal(s.index, 1);
  assert.equal(s.elapsed, 2);
  assert.deepEqual(on(host), [2, 3]);
  assert.equal(s.remaining(), 18);
});

test('without loop the end stops the sequence, goes back to part 1 and leaves the modules as they were', () => {
  const host = fakeHost();
  const s = createSequence({ parts: parts2() }, host);
  s.start();
  s.tick(0);
  s.tick(10);
  s.tick(31);
  assert.equal(s.running, false);
  assert.equal(s.index, 0);
  assert.equal(s.elapsed, 0);
  assert.deepEqual(on(host), [2, 3], 'the last part keeps sounding');
  const calls = host.calls.length;
  s.tick(500);
  assert.equal(host.calls.length, calls);
});

test('with loop it starts again from part 1', () => {
  const host = fakeHost();
  const s = createSequence({ loop: true, parts: parts2() }, host);
  s.start();
  s.tick(0);
  s.tick(31);
  assert.equal(s.running, true);
  assert.equal(s.index, 0);
  assert.equal(s.elapsed, 1);
  assert.deepEqual(on(host), [1, 2]);
});

test('a huge jump in time ends in one tick without walking through the parts', () => {
  const host = fakeHost();
  const looped = createSequence({ loop: true, parts: parts2() }, host);
  looped.start();
  looped.tick(0);
  looped.tick(1e9);
  assert.equal(looped.running, true);
  const pos = (looped.index === 0 ? 0 : 10) + looped.elapsed;
  assert.equal(pos, 1e9 % 30);
  const plain = createSequence({ parts: parts2() }, fakeHost());
  plain.start();
  plain.tick(0);
  plain.tick(1e12);
  assert.equal(plain.running, false);
  assert.equal(plain.index, 0);
});

test('stop pauses: time is frozen, start resumes without re-entering the part, and the pause is not counted', () => {
  const host = fakeHost();
  const s = createSequence({ parts: parts2() }, host);
  s.start();
  s.tick(0);
  s.tick(4);
  s.stop();
  assert.equal(s.running, false);
  assert.equal(s.elapsed, 4);
  s.tick(50);
  assert.equal(s.elapsed, 4);
  host.calls.length = 0;
  host.setRunning(1, false); // switched off by hand during the pause
  host.calls.length = 0;
  s.start();
  assert.deepEqual(host.calls, [], 'resuming does not touch the modules');
  s.tick(60);
  assert.equal(s.elapsed, 4, 'the first tick after start only records the time');
  s.tick(62);
  assert.equal(s.elapsed, 6);
});

test('rewind sets the time of the current part to 0 and a later start enters the part again', () => {
  const host = fakeHost();
  const s = createSequence({ parts: parts2() }, host);
  s.start();
  s.tick(0);
  s.tick(12);
  assert.equal(s.index, 1);
  s.stop();
  s.rewind();
  assert.equal(s.index, 1);
  assert.equal(s.elapsed, 0);
  host.setRunning(3, false);
  host.calls.length = 0;
  s.start();
  assert.deepEqual(host.calls, [[3, true]]);
});

test('next and prev: running jumps and enters the part, stopped only moves, the ends depend on loop', () => {
  const host = fakeHost();
  const s = createSequence({ parts: parts2() }, host);
  s.next();
  assert.equal(s.index, 1);
  assert.deepEqual(host.calls, [], 'stopped: modules untouched');
  s.next();
  assert.equal(s.index, 1, 'no loop: stays on the last part');
  s.prev();
  s.prev();
  assert.equal(s.index, 0, 'no loop: stays on the first part');
  s.start();
  s.tick(0);
  s.tick(3);
  host.calls.length = 0;
  s.next();
  assert.equal(s.index, 1);
  assert.equal(s.elapsed, 0);
  assert.deepEqual(on(host), [2, 3]);
  s.setLoop(true);
  s.next();
  assert.equal(s.index, 0, 'loop: past the last part wraps to the first');
  s.prev();
  assert.equal(s.index, 1, 'loop: before the first part wraps to the last');
});

test('addPart: names, lengths, members and the cap', () => {
  const s = createSequence({}, fakeHost());
  assert.equal(s.addPart(), 0);
  assert.deepEqual(s.parts[0], { name: 'part 1', duration: 30, modules: [] });
  s.setPart(0, { duration: 45 });
  assert.equal(s.addPart(), 1);
  assert.deepEqual(s.parts[1], { name: 'part 2', duration: 45, modules: [] });
  while (s.parts.length < MAX_PARTS) s.addPart();
  assert.equal(s.addPart(), -1);
  assert.equal(s.parts.length, MAX_PARTS);
});

test('removePart keeps index sensible', () => {
  const mk = () => createSequence({ parts: [{ duration: 5 }, { duration: 6 }, { duration: 7 }] }, fakeHost());
  let s = mk();
  s.index = 2;
  s.removePart(0);
  assert.equal(s.index, 1);
  s = mk();
  s.index = 2;
  s.removePart(2);
  assert.equal(s.index, 1);
  s = mk();
  s.removePart(1);
  assert.deepEqual(s.parts.map((p) => p.duration), [5, 7]);
  assert.equal(s.index, 0);
  s.removePart(0);
  s.removePart(0);
  assert.deepEqual(s.parts, []);
  assert.equal(s.index, 0);
  assert.equal(s.running, false);
  s.removePart(5);
  s.removePart(-1);
});

test('removing the current part while running enters the part that took its place; removing the last one stops', () => {
  const host = fakeHost();
  const s = createSequence({ parts: parts2() }, host);
  s.start();
  s.tick(0);
  s.tick(2);
  host.calls.length = 0;
  s.removePart(0);
  assert.equal(s.index, 0);
  assert.equal(s.elapsed, 0);
  assert.deepEqual(on(host), [1, 2, 3], 'module 1 is in no part any more, so the sequence leaves it running');
  s.removePart(0);
  assert.equal(s.running, false);
});

test('movePart reorders and the index follows the same part', () => {
  const s = createSequence({ parts: [{ name: 'a', duration: 5 }, { name: 'b', duration: 6 }, { name: 'c', duration: 7 }] }, fakeHost());
  s.index = 1;
  s.movePart(1, -1);
  assert.deepEqual(s.parts.map((p) => p.name), ['b', 'a', 'c']);
  assert.equal(s.index, 0);
  s.movePart(0, 1);
  assert.deepEqual(s.parts.map((p) => p.name), ['a', 'b', 'c']);
  assert.equal(s.index, 1);
  s.movePart(2, 1);
  s.movePart(0, -1);
  s.movePart(0, 5);
  s.movePart(9, 1);
  assert.deepEqual(s.parts.map((p) => p.name), ['a', 'b', 'c']);
});

test('setPart cleans name and duration and ignores a part that does not exist', () => {
  const s = createSequence({ parts: [{ name: 'a', duration: 5 }] }, fakeHost());
  s.setPart(0, { name: '  intro  ', duration: '12' });
  assert.deepEqual([s.parts[0].name, s.parts[0].duration], ['intro', 12]);
  s.setPart(0, { duration: 9999 });
  assert.equal(s.parts[0].duration, 600);
  s.setPart(0, { name: 'y'.repeat(60) });
  assert.equal(s.parts[0].name.length, 24);
  s.setPart(0, { name: 7 });
  assert.equal(s.parts[0].name.length, 24);
  s.setPart(-1, { name: 'z' });
  s.setPart(3, { name: 'z' });
  assert.equal(s.parts.length, 1);
});

test('toggleMember adds and removes, refuses unknown modules and bad parts, and does not touch modules', () => {
  const host = fakeHost([1, 2]);
  const s = createSequence({ parts: [{ duration: 5 }] }, host);
  s.toggleMember(0, 1);
  assert.deepEqual(s.parts[0].modules, [1]);
  s.toggleMember(0, 2);
  s.toggleMember(0, 1);
  assert.deepEqual(s.parts[0].modules, [2]);
  s.toggleMember(0, 99);
  s.toggleMember(0, 'a');
  s.toggleMember(0, 1.5);
  s.toggleMember(7, 1);
  s.toggleMember(-1, 1);
  assert.deepEqual(s.parts[0].modules, [2]);
  assert.deepEqual(host.calls, []);
});

test('useRunning replaces the members with the running modules, an empty result is allowed', () => {
  const host = fakeHost([1, 2, 3], [2, 3]);
  const s = createSequence({ parts: [{ duration: 5, modules: [1] }] }, host);
  s.useRunning(0);
  assert.deepEqual(s.parts[0].modules.sort(), [2, 3]);
  host.setRunning(2, false);
  host.setRunning(3, false);
  s.useRunning(0);
  assert.deepEqual(s.parts[0].modules, []);
  s.useRunning(4);
});

test('forgetModule removes it everywhere and the sequence stops managing it', () => {
  const host = fakeHost([1, 2, 3]);
  const s = createSequence({ parts: parts2() }, host);
  s.forgetModule(1);
  assert.deepEqual(s.parts.map((p) => p.modules), [[2], [2, 3]]);
  host.remove(1);
  s.start();
  assert.ok(!host.calls.some(([id]) => id === 1));
});

test('toData is plain data and round-trips', () => {
  const host = fakeHost();
  const s = createSequence({ name: 'song', loop: true, parts: parts2() }, host);
  const data = s.toData();
  assert.deepEqual(data, { name: 'song', loop: true, parts: parts2() });
  data.parts[0].modules.push(99);
  assert.deepEqual(s.parts[0].modules, [1, 2], 'a copy, not a view');
  const again = createSequence(JSON.parse(JSON.stringify(s.toData())), host);
  assert.deepEqual(again.toData(), s.toData());
});

test('a non-finite time and a tick while stopped are ignored', () => {
  const s = createSequence({ parts: parts2() }, fakeHost());
  s.tick(5);
  assert.equal(s.elapsed, 0);
  s.start();
  s.tick(0);
  s.tick(NaN);
  s.tick(Infinity);
  assert.equal(s.elapsed, 0);
  s.tick(3);
  assert.equal(s.elapsed, 3);
});
