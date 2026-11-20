import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_FILE_SUFFIX, moduleFilename, moduleToFile, parseModuleFile } from '../js/module-file.js';
import { serializeModule, validateScene } from '../js/scene.js';
import { MAX_FILE_BYTES } from '../js/scene-file.js';
import { createMelodicModule, createRhythmicModule, createDroneModule } from '../js/module.js';

const sends = () => [0, 1, 2].map(() => ({ fx: null, level: 0.3 }));
const emptySends = sends();

test('the suffix and the file name are safe and never empty', () => {
  assert.equal(MODULE_FILE_SUFFIX, '.pulsar-module.json');
  assert.equal(moduleFilename('bass'), 'bass.pulsar-module.json');
  assert.equal(moduleFilename(''), 'module.pulsar-module.json');
  assert.equal(moduleFilename(undefined), 'module.pulsar-module.json');
  const evil = moduleFilename('../../etc/<b>x</b>\u0000.sh');
  assert.ok(!/[\\/<>\u0000]/.test(evil) && evil.endsWith(MODULE_FILE_SUFFIX), evil);
  assert.ok(moduleFilename('a'.repeat(300)).length <= 80 + MODULE_FILE_SUFFIX.length);
});

test('serializeModule keeps what the module was set to, without sends', () => {
  const mel = createMelodicModule();
  mel.name = 'bass';
  mel.volume = 0.7;
  mel.pan = -0.3;
  mel.sends = [{ fx: 'fx1', level: 0.9 }, ...sends().slice(1)];
  mel.running = false;
  const data = serializeModule(mel);
  assert.deepEqual(Object.keys(data).sort(), ['name', 'pan', 'params', 'running', 'type', 'volume']);
  assert.deepEqual([data.type, data.name, data.volume, data.pan, data.running], ['melodic', 'bass', 0.7, -0.3, false]);
  assert.notEqual(data.params, mel.params, 'a copy');
  assert.deepEqual(data.params, JSON.parse(JSON.stringify(mel.params)));
  const stoppedByAll = createDroneModule();
  stoppedByAll.running = false;
  assert.equal(serializeModule(stoppedByAll, () => true).running, true, 'stop all is not a hand-made stop');
  assert.equal(serializeModule(stoppedByAll).running, false);
});

test('a module of every type survives export, file and import', () => {
  const mel = createMelodicModule();
  mel.setParam('mix', 0.35); mel.setParam('wave2', 'triangle'); mel.setParam('detune', 9); mel.setParam('env', { a: 0.4, s: 0.2 }); mel.setParam('bpm', 111);
  const dro = createDroneModule();
  dro.setParam('mix', 0.6); dro.setParam('wave2', 'square'); dro.setParam('detune', -20); dro.setParam('rootNote', 'F#3');
  const rhy = createRhythmicModule();
  rhy.setParam('voice:kick', 'x...x...x...x...'); rhy.setParam('bpm', 100);
  for (const [m, name] of [[mel, 'lead'], [dro, 'pad'], [rhy, 'drums']]) {
    m.name = name; m.volume = 0.5; m.pan = 0.25;
    const { entries, problems } = parseModuleFile(moduleToFile(serializeModule(m)));
    assert.deepEqual(problems, []);
    assert.equal(entries.length, 1);
    const back = entries[0];
    assert.deepEqual([back.type, back.name, back.volume, back.pan], [m.type, name, 0.5, 0.25]);
    for (const k of ['bpm', 'mix', 'wave2', 'detune', 'rootNote']) if (k in m.params) assert.equal(back.params[k], m.params[k], k);
    if (m.type === 'melodic') assert.deepEqual(back.params.env, m.params.env);
    if (m.type === 'rhythmic') assert.equal(back.params.voices.kick, 'x...x...x...x...');
  }
});

test('moduleToFile writes a Pulsar module envelope', () => {
  const data = serializeModule(createDroneModule());
  const parsed = JSON.parse(moduleToFile(data));
  assert.equal(parsed.pulsar, 'module');
  assert.deepEqual(parsed.module, JSON.parse(JSON.stringify(data)));
});

test('a bare module object is accepted too', () => {
  const { entries } = parseModuleFile(JSON.stringify(serializeModule(createMelodicModule())));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'melodic');
});

test('sends in the file are ignored: the imported module has three empty slots', () => {
  const data = { ...serializeModule(createDroneModule()), sends: [{ fx: 0, level: 0.9 }, { fx: 1, level: 1 }, { fx: 2, level: 0 }] };
  const { entries } = parseModuleFile(JSON.stringify({ pulsar: 'module', module: data }));
  assert.deepEqual(entries[0].sends, emptySends);
});

test('values are clamped like in a scene', () => {
  const data = { type: 'melodic', name: 'x'.repeat(100), params: { bpm: 99999, swing: 7, mix: 9, detune: 1e9, wave: 'evil' }, volume: 9, pan: -9, running: 'yes' };
  const { entries } = parseModuleFile(JSON.stringify({ pulsar: 'module', module: data }));
  const m = entries[0];
  assert.equal(m.name.length, 24);
  assert.equal(m.params.mix, 1);
  assert.equal(m.params.detune, 50);
  assert.ok(!('wave' in m.params));
  assert.deepEqual([m.volume, m.pan, m.running], [1, -1, true]);
  // plain numbers such as bpm and swing are kept as written, exactly like in a scene; the module clamps them when it is built
  const built = createMelodicModule();
  for (const [k, v] of Object.entries(m.params)) built.setParam(k, v);
  assert.deepEqual([built.params.bpm, built.params.swing], [300, 1]);
});

test('nothing usable gives no entry, a reason and never an exception', () => {
  const cases = [
    '', 'not json', '{', 'null', '5', '"x"', '[]', '{}',
    JSON.stringify({ pulsar: 'scene', name: 'x', scene: {} }),
    JSON.stringify({ pulsar: 'module', module: null }),
    JSON.stringify({ pulsar: 'module', module: { type: 'banjo' } }),
    JSON.stringify({ pulsar: 'module', module: [] }),
    JSON.stringify({ type: 'banjo' }),
    JSON.stringify({ pulsar: 'modules', modules: [] }),
  ];
  for (const text of cases) {
    const r = parseModuleFile(text);
    assert.deepEqual(r.entries, [], text);
    assert.ok(r.problems.length > 0, text);
  }
  for (const bad of [undefined, null, 5, {}, []]) {
    const r = parseModuleFile(bad);
    assert.deepEqual(r.entries, []);
    assert.ok(r.problems.length > 0);
  }
});

test('a file over the limit is refused, also when it is a long string of one-byte characters or multibyte ones', () => {
  const pad = ' '.repeat(MAX_FILE_BYTES + 1);
  assert.deepEqual(parseModuleFile(`${JSON.stringify({ pulsar: 'module', module: { type: 'drone' } })}${pad}`).entries, []);
  const multi = JSON.stringify({ pulsar: 'module', module: { type: 'drone', name: '€'.repeat(400000) } });
  const r = parseModuleFile(multi);
  assert.deepEqual(r.entries, []);
  assert.ok(r.problems.some((p) => /larger than 1 MB/.test(p)));
});

test('hostile content: __proto__ keys, huge params and odd types do not pollute or throw', () => {
  const evil = '{"pulsar":"module","__proto__":{"polluted":1},"module":{"type":"melodic","__proto__":{"polluted":2},"params":{"__proto__":{"polluted":3},"constructor":{"prototype":{"polluted":4}},"bpm":1e999,"pitchConfig":{"notes":"' + 'C4 '.repeat(100000) + '"},"rhythm":"' + 'x'.repeat(100000) + '"},"name":{"toString":1},"volume":{},"pan":[]}}';
  const r = parseModuleFile(evil);
  assert.equal(({}).polluted, undefined);
  assert.equal(r.entries.length, 1);
  assert.ok(r.entries[0].params.rhythm.length <= 64);
  assert.ok(r.entries[0].params.pitchConfig.notes.length <= 200);
  assert.equal(r.entries[0].name, 'melodic');
});

test('importing never gives more than one module per file', () => {
  const r = parseModuleFile(JSON.stringify({ pulsar: 'module', module: { type: 'drone' }, modules: [{ type: 'drone' }, { type: 'drone' }] }));
  assert.equal(r.entries.length, 1);
});

test('a scene still validates the same after the module cleaning was moved out', () => {
  const { scene } = validateScene({ version: 1, effects: [], modules: [{ type: 'drone', params: {} }, { type: 'banjo' }, { type: 'melodic', params: { bpm: 100 } }] });
  assert.deepEqual(scene.modules.map((m) => m.type), ['drone', 'melodic']);
});
