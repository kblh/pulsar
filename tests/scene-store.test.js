import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneStore } from '../js/scene-store.js';
import { serializeScene } from '../js/scene.js';
import { createMelodicModule, createDroneModule } from '../js/module.js';

const KEY = 'pulsar.scenes';

function memory(initial) {
  const data = new Map(initial === undefined ? [] : [[KEY, initial]]);
  const calls = { set: 0 };
  return {
    calls, data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { calls.set++; data.set(k, v); },
  };
}

const sceneOf = (...mods) => serializeScene({ modules: mods.map((m) => Object.assign(m, { sends: [0, 1, 2].map(() => ({ fx: null, level: 0.3 })) })), effects: [] });
const clock = () => { let t = 1000; return () => (t += 10); };

test('save then list/get round-trips a scene', () => {
  const store = createSceneStore(memory(), clock());
  const scene = sceneOf(createMelodicModule(), createDroneModule());
  const r = store.save('first', scene);
  assert.equal(r.ok, true);
  assert.deepEqual(store.list().map((s) => s.name), ['first']);
  assert.deepEqual(store.get(r.id), scene);
});

test('same name overwrites and keeps the id; different names make two entries', () => {
  const store = createSceneStore(memory(), clock());
  const a = store.save('a', sceneOf(createMelodicModule()));
  const again = store.save(' a ', sceneOf(createDroneModule()));
  assert.equal(again.id, a.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(a.id).modules[0].type, 'drone');
  store.save('b', sceneOf(createMelodicModule()));
  assert.equal(store.list().length, 2);
});

test('list is newest first', () => {
  const store = createSceneStore(memory(), clock());
  store.save('one', sceneOf(createMelodicModule()));
  store.save('two', sceneOf(createMelodicModule()));
  store.save('three', sceneOf(createMelodicModule()));
  assert.deepEqual(store.list().map((s) => s.name), ['three', 'two', 'one']);
  store.save('one', sceneOf(createDroneModule()));
  assert.deepEqual(store.list().map((s) => s.name), ['one', 'three', 'two']);
});

test('empty name falls back to "scene"', () => {
  const store = createSceneStore(memory(), clock());
  store.save('   ', sceneOf(createMelodicModule()));
  assert.equal(store.list()[0].name, 'scene');
});

test('rename, remove, and unknown ids', () => {
  const store = createSceneStore(memory(), clock());
  const a = store.save('a', sceneOf(createMelodicModule()));
  const b = store.save('b', sceneOf(createMelodicModule()));
  assert.equal(store.rename(a.id, '  renamed  ').ok, true);
  assert.deepEqual(store.list().map((s) => s.name).sort(), ['b', 'renamed']);
  assert.equal(store.rename(a.id, 'b').ok, false); // name already used
  assert.equal(store.rename('nope', 'x').ok, false);
  assert.equal(store.remove('nope').ok, false);
  assert.equal(store.remove(b.id).ok, true);
  assert.deepEqual(store.list().map((s) => s.name), ['renamed']);
  assert.equal(store.get(b.id), null);
});

test('corrupt storage reads as empty and valid entries survive', () => {
  for (const raw of ['{', '[]', '"x"', '5', 'null', '{"version":1,"scenes":"x"}', '{"version":1,"scenes":[{"id":1}]}', '{"version":0,"scenes":[]}']) {
    const store = createSceneStore(memory(raw), clock());
    assert.deepEqual(store.list(), [], raw);
    assert.equal(store.get('x'), null);
  }
  const good = sceneOf(createMelodicModule());
  const raw = JSON.stringify({ version: 1, scenes: [{ id: 5 }, { id: 'ok', name: 'good', savedAt: 1, data: good }, null, 'x'] });
  const store = createSceneStore(memory(raw), clock());
  assert.deepEqual(store.list().map((s) => s.id), ['ok']);
  assert.deepEqual(store.get('ok'), good);
  assert.equal(store.save('new', good).ok, true); // corrupt parts do not block saving
  assert.equal(store.list().length, 2);
});

test('a newer storage version is not overwritten', () => {
  const raw = JSON.stringify({ version: 2, scenes: [{ id: 'x', name: 'x', savedAt: 1, data: {} }] });
  const mem = memory(raw);
  const store = createSceneStore(mem, clock());
  assert.deepEqual(store.list(), []);
  assert.equal(store.save('a', sceneOf(createMelodicModule())).ok, false);
  assert.equal(store.rename('x', 'y').ok, false);
  assert.equal(store.remove('x').ok, false);
  assert.equal(mem.calls.set, 0);
  assert.equal(mem.data.get(KEY), raw);
});

test('throwing storage never throws out of the store', () => {
  const quota = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  for (const storage of [quota, blocked, null]) {
    const store = createSceneStore(storage, clock());
    assert.deepEqual(store.list(), []);
    const r = store.save('a', sceneOf(createMelodicModule()));
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.equal(store.rename('a', 'b').ok, false);
    assert.equal(store.remove('a').ok, false);
    assert.equal(store.get('a'), null);
  }
});

test('get returns null for an entry whose data is not a valid scene', () => {
  const raw = JSON.stringify({ version: 1, scenes: [{ id: 'bad', name: 'bad', savedAt: 1, data: { version: 1, modules: [{ type: 'banjo' }] } }] });
  const store = createSceneStore(memory(raw), clock());
  assert.deepEqual(store.list().map((s) => s.id), ['bad']);
  assert.equal(store.get('bad'), null);
});

test('ids never collide even when the clock does not move', () => {
  const store = createSceneStore(memory(), () => 5);
  const ids = ['a', 'b', 'c'].map((n) => store.save(n, sceneOf(createMelodicModule())).id);
  assert.equal(new Set(ids).size, 3);
});
