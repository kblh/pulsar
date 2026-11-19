import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneToFile, scenesToFile, parseSceneFile, uniqueName, exportFilename, MAX_FILE_BYTES, MAX_SCENES_PER_FILE } from '../js/scene-file.js';
import { serializeScene, validateScene } from '../js/scene.js';
import { createMelodicModule, createDroneModule, createRhythmicModule } from '../js/module.js';

const slots = () => [0, 1, 2].map(() => ({ fx: null, level: 0.3 }));
function sampleScene(...makers) {
  const modules = (makers.length ? makers : [createMelodicModule, createDroneModule]).map((f) => Object.assign(f(), { sends: slots() }));
  return validateScene(serializeScene({ modules, effects: [] })).scene;
}
const oneModule = { version: 1, effects: [], modules: [{ type: 'drone', name: 'd', params: {}, volume: 1, pan: 0, running: true, sends: [] }] };

test('sceneToFile wraps the scene and picks a safe file name', () => {
  const scene = sampleScene();
  const { filename, text } = sceneToFile('bass', scene);
  assert.equal(filename, 'bass.pulsar.json');
  const data = JSON.parse(text);
  assert.equal(data.pulsar, 'scene');
  assert.equal(data.name, 'bass');
  assert.deepEqual(data.scene, scene);
});

test('exportFilename never contains path separators, control characters or markup', () => {
  for (const name of ['../../etc/passwd', 'a/b\\c', 'x\u0000y\u001fz', '<img onerror=1>', '   ', '', '🎵🎶', '..', 'C:\\x']) {
    const f = exportFilename(name);
    assert.ok(!/[\/\\<>:\u0000-\u001f]/.test(f), JSON.stringify(f));
    assert.ok(f.endsWith('.pulsar.json'));
    assert.ok(!f.startsWith('.'), f);
    assert.ok(f.length <= 100);
  }
  assert.equal(exportFilename('   '), 'scene.pulsar.json');
  assert.equal(exportFilename('my song'), 'my song.pulsar.json');
});

test('round trip: one scene and several scenes', () => {
  const s1 = sampleScene();
  const one = parseSceneFile(sceneToFile('bass', s1).text, 'x.json');
  assert.deepEqual(one.problems, []);
  assert.deepEqual(one.entries, [{ name: 'bass', scene: s1 }]);

  const entries = [{ name: 'a', scene: s1 }, { name: 'b', scene: sampleScene(createRhythmicModule) }, { name: 'c', scene: sampleScene(createDroneModule) }];
  const { filename, text } = scenesToFile(entries);
  assert.equal(filename, 'pulsar-scenes.json');
  const many = parseSceneFile(text, 'x.json');
  assert.deepEqual(many.entries, entries);
  assert.deepEqual(many.problems, []);
});

test('a bare scene takes its name from the file name', () => {
  const text = JSON.stringify(oneModule);
  assert.equal(parseSceneFile(text, 'my song.pulsar.json').entries[0].name, 'my song');
  assert.equal(parseSceneFile(text, 'x.json').entries[0].name, 'x');
  assert.equal(parseSceneFile(text, '').entries[0].name, 'scene');
});

test('hostile or unsupported files give problems and no entries', () => {
  const bad = [
    '{', '', '[]', 'null', '5', '"x"', 'true',
    JSON.stringify({ pulsar: 'scenes', scenes: 'x' }),
    JSON.stringify({ pulsar: 'scenes' }),
    JSON.stringify({ pulsar: 'scene' }),
    JSON.stringify({ pulsar: 'scene', scene: 5 }),
    JSON.stringify({ pulsar: 'scene', scene: { version: 1, modules: [{ type: 'banjo' }] } }),
    JSON.stringify({ pulsar: 'other', scene: oneModule }),
    JSON.stringify({ version: 2, modules: [] }),
  ];
  for (const text of bad) {
    const r = parseSceneFile(text, 'x.json');
    assert.deepEqual(r.entries, [], text);
    assert.ok(r.problems.length >= 1, text);
  }
  assert.deepEqual(parseSceneFile(undefined, 'x').entries, []);
});

test('a file over the byte limit is refused, counting bytes not characters', () => {
  assert.deepEqual(parseSceneFile('x'.repeat(MAX_FILE_BYTES + 1), 'x').entries, []);
  const multibyte = JSON.stringify({ pulsar: 'scene', name: 'é'.repeat(MAX_FILE_BYTES / 2 + 10), scene: oneModule });
  assert.ok(multibyte.length < MAX_FILE_BYTES * 1.1);
  const r = parseSceneFile(multibyte, 'x');
  assert.deepEqual(r.entries, []);
  assert.match(r.problems.join(' '), /1 MB/);
});

test('at most 100 scenes are taken from one file', () => {
  const scenes = Array.from({ length: 250 }, (_, i) => ({ name: `s${i}`, scene: oneModule }));
  const r = parseSceneFile(JSON.stringify({ pulsar: 'scenes', scenes }), 'x');
  assert.equal(r.entries.length, MAX_SCENES_PER_FILE);
  assert.ok(r.problems.length >= 1);
});

test('one bad scene in a list does not stop the others', () => {
  const text = JSON.stringify({ pulsar: 'scenes', scenes: [{ name: 'ok', scene: oneModule }, { name: 'bad', scene: { version: 1, modules: [] } }, 7, null, { name: 'ok2', scene: oneModule }] });
  const r = parseSceneFile(text, 'x');
  assert.deepEqual(r.entries.map((e) => e.name), ['ok', 'ok2']);
  assert.equal(r.problems.length, 3);
});

test('__proto__ and constructor keys do not pollute anything', () => {
  const text = '{"pulsar":"scenes","__proto__":{"polluted":true},"scenes":[{"name":"p","__proto__":{"polluted":true},"scene":{"version":1,"__proto__":{"polluted":true},"effects":[],"modules":[{"type":"drone","name":"d","constructor":{"x":1},"params":{"__proto__":{"polluted":true},"constructor":{"polluted":true}},"sends":[]}]}}]}';
  const r = parseSceneFile(text, 'x');
  assert.equal(r.entries.length, 1);
  assert.equal(({}).polluted, undefined);
  assert.equal(r.entries[0].scene.modules[0].params.polluted, undefined);
});

test('names from files are cleaned', () => {
  const text = JSON.stringify({ pulsar: 'scene', name: '  ' + 'z'.repeat(500), scene: oneModule });
  assert.equal(parseSceneFile(text, 'x').entries[0].name, 'z'.repeat(24));
  const empty = JSON.stringify({ pulsar: 'scene', name: '   ', scene: oneModule });
  assert.equal(parseSceneFile(empty, 'x').entries[0].name, 'scene');
});

test('uniqueName adds (2), (3)… and stays within 24 characters', () => {
  assert.equal(uniqueName('a', []), 'a');
  assert.equal(uniqueName('a', ['b']), 'a');
  assert.equal(uniqueName('a', ['a']), 'a (2)');
  assert.equal(uniqueName('a', ['a', 'a (2)']), 'a (3)');
  const long = 'q'.repeat(24);
  const u = uniqueName(long, [long]);
  assert.ok(u.length <= 24 && u !== long && u.endsWith(' (2)'), u);
  const taken = [long, u];
  const u3 = uniqueName(long, taken);
  assert.ok(u3.length <= 24 && !taken.includes(u3), u3);
});

test('the skipped count says how many scenes were really left out', () => {
  const many = parseSceneFile(JSON.stringify({ pulsar: 'scenes', scenes: Array.from({ length: 250 }, (_, i) => ({ name: `s${i}`, scene: oneModule })) }), 'x');
  assert.equal(many.entries.length, 100);
  assert.equal(many.skipped, 150);
  const mixed = parseSceneFile(JSON.stringify({ pulsar: 'scenes', scenes: [{ name: 'ok', scene: oneModule }, { name: 'bad', scene: { version: 1, modules: [] } }, 7, null] }), 'x');
  assert.equal(mixed.skipped, 3);
  assert.equal(parseSceneFile('{', 'x').skipped, 1);
  assert.equal(parseSceneFile(JSON.stringify({ pulsar: 'scene', name: 'a', scene: oneModule }), 'x').skipped, 0);
});

test('parts of a scene that validation dropped are reported as notes, not as skipped scenes', () => {
  const partly = { version: 1, effects: [], modules: [oneModule.modules[0], { type: 'banjo' }] };
  const r = parseSceneFile(JSON.stringify({ pulsar: 'scene', name: 'half', scene: partly }), 'x');
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].scene.modules.length, 1);
  assert.deepEqual(r.problems, []);
  assert.equal(r.skipped, 0);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /^half: /);
  assert.deepEqual(parseSceneFile(sceneToFile('ok', sampleScene()).text, 'x').notes, []);
});
