import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, serializeScene, validateScene, serializeModule, cleanModule } from '../js/scene.js';
import { createMelodicModule, createRhythmicModule, createDroneModule } from '../js/module.js';
import { createSequence } from '../js/sequence.js';

test('modules have a default name equal to their type', () => {
  assert.equal(createMelodicModule().name, 'melodic');
  assert.equal(createRhythmicModule().name, 'rhythmic');
  assert.equal(createDroneModule().name, 'drone');
});

test('cleanName trims, truncates to 24 and falls back', () => {
  assert.equal(cleanName('  bass  ', 'x'), 'bass');
  assert.equal(cleanName('a'.repeat(10000), 'x'), 'a'.repeat(24));
  for (const bad of ['', '   ', null, undefined, 12, {}]) assert.equal(cleanName(bad, 'fallback'), 'fallback');
  assert.equal(cleanName('<img onerror=x>', 'x'), '<img onerror=x>');
  assert.equal(cleanName('ab' + ' '.repeat(30) + 'cd', 'x'), 'ab');
});

const fakeFx = (id, type, params) => ({ id, type, name: type, params });

function sample() {
  const mel = createMelodicModule();
  const rhy = createRhythmicModule();
  const dro = createDroneModule();
  const effects = [fakeFx('fx3', 'delay', { time: 350, feedback: 0.4, tone: 4000, return: 0.5 }), fakeFx('fx7', 'reverb', { decay: 2.5, damping: 0.5, return: 0.5 })];
  mel.name = 'bass';
  mel.volume = 0.7;
  mel.pan = -0.3;
  mel.sends = [{ fx: 'fx7', level: 0.5 }, { fx: null, level: 0.3 }, { fx: 'fx3', level: 0.9 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }];
  rhy.sends = [{ fx: 'fx99', level: 0.2 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }];
  dro.running = false;
  dro.sends = Array.from({ length: 5 }, (_, i) => i).map(() => ({ fx: null, level: 0.3 })); // attached modules always have five slots
  return { modules: [mel, rhy, dro], effects };
}

test('serializeScene is JSON-stable and maps sends to effect indexes', () => {
  const { modules, effects } = sample();
  const scene = serializeScene({ modules, effects });
  assert.deepEqual(scene, JSON.parse(JSON.stringify(scene)));
  assert.equal(scene.version, 1);
  assert.deepEqual(scene.effects.map((e) => e.type), ['delay', 'reverb']);
  assert.deepEqual(scene.modules.map((m) => m.type), ['melodic', 'rhythmic', 'drone']);
  assert.deepEqual(scene.modules[0].sends.map((s) => s.fx), [1, null, 0, null, null]);
  assert.equal(scene.modules[1].sends[0].fx, null);
  assert.equal(scene.modules[0].name, 'bass');
  assert.equal(scene.modules[0].volume, 0.7);
  assert.equal(scene.modules[0].pan, -0.3);
  assert.equal(scene.modules[2].running, false);
});

test('serializeScene copies params deeply', () => {
  const { modules, effects } = sample();
  const scene = serializeScene({ modules, effects });
  scene.modules[0].params.env.a = 4;
  scene.modules[0].params.pitchConfig.octaves = 9;
  scene.modules[1].params.voices.kick = 'zzz';
  assert.notEqual(modules[0].params.env.a, 4);
  assert.notEqual(modules[0].params.pitchConfig.octaves, 9);
  assert.notEqual(modules[1].params.voices.kick, 'zzz');
});

test('validateScene round-trips a serialized scene unchanged', () => {
  const { modules, effects } = sample();
  const scene = serializeScene({ modules, effects });
  const { scene: out, problems } = validateScene(JSON.parse(JSON.stringify(scene)));
  assert.deepEqual(out, scene);
  assert.deepEqual(problems, []);
});

test('validateScene rejects non-scenes', () => {
  for (const bad of [null, undefined, 'x', 5, [], {}, { version: 2, modules: [{ type: 'drone' }] }, { version: 1 }, { version: 1, modules: [], effects: [] }]) {
    const r = validateScene(bad);
    assert.equal(r.scene, null, JSON.stringify(bad));
    assert.ok(r.problems.length > 0);
  }
});

const mod = (extra = {}) => ({ type: 'melodic', name: 'm', params: {}, volume: 1, pan: 0, running: true, sends: [], ...extra });

test('validateScene drops unknown types and says so', () => {
  const { scene, problems } = validateScene({
    version: 1,
    effects: [{ type: 'flanger', params: {} }, { type: 'delay', params: {} }],
    modules: [mod({ type: 'banjo' }), mod()],
  });
  assert.equal(scene.effects.length, 1);
  assert.equal(scene.modules.length, 1);
  assert.equal(problems.length, 2);
});

test('validateScene clamps or drops bad parameter values', () => {
  const { scene } = validateScene({
    version: 1,
    effects: [{ type: 'delay', params: { feedback: 7, time: 'abc', bogus: 1 } }],
    modules: [
      mod({
        volume: 9, pan: NaN,
        params: {
          bpm: 'abc', swing: 99, wave: 'evil', rhythm: 5, evolution: 'sideways', hax: 1,
          env: { a: 99, d: -1, s: 5, r: 'x' },
          pitchConfig: { mode: 'weird', root: 'H', scale: 'nope', octaves: 1e9, notes: 'x'.repeat(1000) },
        },
      }),
      mod({ type: 'rhythmic', params: { voices: { kick: 'x...', snare: 7, hat: null, tom: 'x' } } }),
      mod({ type: 'drone', params: { rootNote: 'C2'.repeat(20), rate: Infinity, fade: 5 } }),
    ],
  });
  assert.deepEqual(scene.effects[0].params, { feedback: 0.9 });
  const p = scene.modules[0].params;
  assert.equal('bpm' in p, false);
  assert.equal(p.swing, 99); // numbers pass through; setParam clamps them on load
  assert.equal('wave' in p, false);
  assert.equal('rhythm' in p, false);
  assert.equal('evolution' in p, false);
  assert.equal('hax' in p, false);
  assert.deepEqual(p.env, { a: 5, d: 0, s: 1, r: 0.15 });
  assert.equal(p.pitchConfig.octaves, 4);
  assert.equal(p.pitchConfig.mode, 'scale');
  assert.equal('root' in p.pitchConfig, false);
  assert.equal('scale' in p.pitchConfig, false);
  assert.equal(p.pitchConfig.notes.length, 200);
  assert.equal(scene.modules[0].volume, 1);
  assert.equal(scene.modules[0].pan, 0);
  assert.deepEqual(scene.modules[1].params.voices, { kick: 'x...' });
  const d = scene.modules[2].params;
  assert.equal(d.rootNote.length, 8);
  assert.equal('rate' in d, false);
  assert.equal(d.fade, 5);
});

test('validateScene limits sends to five and remaps indexes after dropped effects', () => {
  const { scene } = validateScene({
    version: 1,
    effects: [{ type: 'flanger', params: {} }, { type: 'delay', params: {} }, { type: 'reverb', params: {} }],
    modules: [
      mod({ sends: [{ fx: 0, level: 0.5 }, { fx: 1, level: 2 }, { fx: 2, level: 0.1 }, { fx: 2, level: 0.1 }, { fx: 2, level: 0.1 }, { fx: 0, level: 0.9 }] }),
      mod({ sends: [{ fx: 99, level: 0.5 }] }),
    ],
  });
  assert.equal(scene.effects.length, 2);
  assert.deepEqual(scene.modules[0].sends, [{ fx: null, level: 0.5 }, { fx: 0, level: 1 }, { fx: 1, level: 0.1 }, { fx: 1, level: 0.1 }, { fx: 1, level: 0.1 }]);
  assert.deepEqual(scene.modules[1].sends, [{ fx: null, level: 0.5 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }]);
});

test('serializeScene records modules stopped by [stop all] as running', () => {
  const { modules, effects } = sample(); // the drone has running = false
  const byTransport = new Set([modules[2]]);
  const scene = serializeScene({ modules, effects, stoppedByTransport: (m) => byTransport.has(m) });
  assert.equal(scene.modules[2].running, true);
  const byHand = serializeScene({ modules, effects, stoppedByTransport: () => false });
  assert.equal(byHand.modules[2].running, false);
  assert.equal(serializeScene({ modules, effects }).modules[2].running, false); // option is optional
});

test('validateScene caps modules and effects per scene and says so', () => {
  const modules = Array.from({ length: 200 }, () => mod({ type: 'drone' }));
  const effects = Array.from({ length: 100 }, () => ({ type: 'delay', params: {} }));
  modules[0].sends = [{ fx: 50, level: 0.5 }, { fx: 3, level: 0.5 }];
  const { scene, problems } = validateScene({ version: 1, effects, modules });
  assert.equal(scene.modules.length, 64);
  assert.equal(scene.effects.length, 32);
  assert.equal(scene.modules[0].sends[0].fx, null); // that effect was cut
  assert.equal(scene.modules[0].sends[1].fx, 3);
  assert.equal(problems.filter((p) => /modules/.test(p)).length, 1);
  assert.equal(problems.filter((p) => /effects/.test(p)).length, 1);
});

test('validateScene limits pattern string lengths', () => {
  const { scene } = validateScene({
    version: 1,
    modules: [mod({ params: { rhythm: 'x'.repeat(1000) } }), mod({ type: 'rhythmic', params: { voices: { kick: '.'.repeat(1000) } } })],
  });
  assert.equal(scene.modules[0].params.rhythm.length, 64);
  assert.equal(scene.modules[1].params.voices.kick.length, 64);
});

test('scene keeps the bypass state of effects and reads old scenes as enabled', () => {
  const { modules, effects } = sample();
  effects[1].enabled = false;
  const scene = serializeScene({ modules, effects });
  assert.deepEqual(scene.effects.map((e) => e.enabled), [true, false]);
  const back = validateScene(JSON.parse(JSON.stringify(scene))).scene;
  assert.deepEqual(back.effects.map((e) => e.enabled), [true, false]);
  const old = validateScene({ version: 1, effects: [{ type: 'delay', params: {} }], modules: [] }).scene;
  assert.equal(old.effects[0].enabled, true);
  for (const bad of ['no', 0, null, 1, {}]) {
    const s = validateScene({ version: 1, effects: [{ type: 'delay', enabled: bad, params: {} }], modules: [] }).scene;
    assert.equal(s.effects[0].enabled, true, String(bad));
  }
});

test('validateScene clamps ping-pong and width and keeps in-range values', () => {
  const { scene } = validateScene({
    version: 1,
    effects: [{ type: 'delay', params: { pingpong: 9 } }, { type: 'reverb', params: { width: -3 } }, { type: 'delay', params: { pingpong: 0.35 } }],
    modules: [],
  });
  assert.equal(scene.effects[0].params.pingpong, 1);
  assert.equal(scene.effects[1].params.width, 0);
  assert.equal(scene.effects[2].params.pingpong, 0.35);
});

test('an equalizer round-trips through a scene and out-of-range bands are clamped', () => {
  const { modules, effects } = sample();
  effects.push({ id: 'fx9', type: 'eq', name: 'tone', enabled: false, params: { low: 6, mid: -3, high: 2, midFreq: 2500, return: 0.4 } });
  const scene = serializeScene({ modules, effects });
  const back = validateScene(JSON.parse(JSON.stringify(scene))).scene;
  const eq = back.effects.find((e) => e.type === 'eq');
  assert.deepEqual(eq.params, { low: 6, mid: -3, high: 2, midFreq: 2500, return: 0.4 });
  assert.equal(eq.enabled, false);
  assert.equal(eq.name, 'tone');
  const wild = validateScene({ version: 1, effects: [{ type: 'eq', params: { low: 99, high: -99, midFreq: 1 } }], modules: [] }).scene;
  assert.deepEqual(wild.effects[0].params, { low: 12, high: -12, midFreq: 200 });
});

test('validateScene accepts a bitcrusher and clamps its parameters', () => {
  const { scene } = validateScene({ version: 1, effects: [{ type: 'bitcrusher', enabled: false, params: { bits: 99, rate: 0, return: 0.3, hax: 1 } }], modules: [] });
  assert.equal(scene.effects[0].type, 'bitcrusher');
  assert.deepEqual(scene.effects[0].params, { bits: 16, rate: 1, return: 0.3 });
  assert.equal(scene.effects[0].enabled, false);
});

const oscModule = (type, params) => ({ type, name: type, params, volume: 1, pan: 0, running: true, sends: [] });

test('validateScene keeps wave 2, mix and detune of melodic and drone modules and clamps them', () => {
  const { scene } = validateScene({
    version: 1,
    effects: [],
    modules: [
      oscModule('melodic', { wave2: 'square', mix: 0.4, detune: -12 }),
      oscModule('drone', { wave2: 'triangle', mix: 1, detune: 50 }),
      oscModule('melodic', { wave2: 'evil', mix: 9, detune: 1e9 }),
      oscModule('drone', { wave2: 5, mix: 'abc', detune: NaN }),
      oscModule('melodic', { mix: -3, detune: 12.6 }),
    ],
  });
  assert.deepEqual([scene.modules[0].params.wave2, scene.modules[0].params.mix, scene.modules[0].params.detune], ['square', 0.4, -12]);
  assert.deepEqual([scene.modules[1].params.wave2, scene.modules[1].params.mix, scene.modules[1].params.detune], ['triangle', 1, 50]);
  assert.deepEqual([scene.modules[2].params.wave2, scene.modules[2].params.mix, scene.modules[2].params.detune], [undefined, 1, 50]);
  assert.deepEqual([scene.modules[3].params.wave2, scene.modules[3].params.mix, scene.modules[3].params.detune], [undefined, undefined, undefined]);
  assert.deepEqual([scene.modules[4].params.mix, scene.modules[4].params.detune], [0, 13]);
});

test('validateScene drops osc 2 keys on a rhythmic module and takes a scene without them as it is', () => {
  const { scene } = validateScene({
    version: 1,
    effects: [],
    modules: [oscModule('rhythmic', { bpm: 100, wave2: 'square', mix: 0.5, detune: 5 }), oscModule('melodic', { bpm: 100 }), oscModule('drone', {})],
  });
  for (const k of ['wave2', 'mix', 'detune']) assert.ok(!(k in scene.modules[0].params), k);
  for (const i of [1, 2]) for (const k of ['wave2', 'mix', 'detune']) assert.ok(!(k in scene.modules[i].params), `old scene module ${i} ${k}`);
});

const hostOf = (modules) => ({ ids: () => modules.map((m) => m.id), isRunning: () => false, setRunning() {} });
const seqScene = (sequence, mods = ['melodic', 'rhythmic', 'drone']) => ({
  version: 1,
  effects: [],
  modules: mods.map((type) => ({ type, name: type, params: {}, volume: 1, pan: 0, running: true, sends: [] })),
  sequence,
});

test('serializeScene writes the sequence with module positions instead of ids and leaves the key out without one', () => {
  const { modules, effects } = sample();
  const seq = createSequence({ name: 'song', loop: true, parts: [{ name: 'a', duration: 12, modules: [modules[2].id, modules[0].id] }, { duration: 40, modules: [modules[1].id] }] }, hostOf(modules));
  const scene = serializeScene({ modules, effects, sequence: seq });
  assert.deepEqual(scene.sequence, { name: 'song', loop: true, parts: [{ name: 'a', duration: 12, modules: [2, 0] }, { name: 'part 2', duration: 40, modules: [1] }] });
  assert.deepEqual(scene, JSON.parse(JSON.stringify(scene)));
  assert.ok(!('sequence' in serializeScene({ modules, effects })));
  seq.parts[0].modules.push(99999); // a module that is not in the scene is left out
  assert.deepEqual(serializeScene({ modules, effects, sequence: seq }).sequence.parts[0].modules, [2, 0]);
});

test('validateScene keeps and cleans the sequence', () => {
  const { scene } = validateScene(seqScene({
    name: 'x'.repeat(100),
    loop: 'yes',
    parts: [
      { name: 'y'.repeat(100), duration: 'abc', modules: [0, 0, 2, 7, 'a', 1.5, null, -1] },
      { duration: 0, modules: 'nope' },
      { duration: 9999 },
      'junk',
      null,
    ],
  }));
  assert.equal(scene.sequence.name.length, 24);
  assert.equal(scene.sequence.loop, false);
  assert.equal(scene.sequence.parts.length, 5);
  assert.equal(scene.sequence.parts[0].name.length, 24);
  assert.equal(scene.sequence.parts[0].duration, 30);
  assert.deepEqual(scene.sequence.parts[0].modules, [0, 2]);
  assert.deepEqual([scene.sequence.parts[1].duration, scene.sequence.parts[1].modules], [1, []]);
  assert.equal(scene.sequence.parts[2].duration, 600);
  assert.equal(scene.sequence.parts[3].name, 'part 4');
  const wide = validateScene(seqScene({ parts: Array.from({ length: 50 }, () => ({ duration: 5 })) })).scene;
  assert.equal(wide.sequence.parts.length, 32);
  const huge = validateScene(seqScene({ parts: new Array(1e6).fill({ duration: 5 }) })).scene;
  assert.equal(huge.sequence.parts.length, 32);
});

test('validateScene renumbers sequence members after an invalid module was dropped and removes references to it', () => {
  const { scene, problems } = validateScene(seqScene({ parts: [{ modules: [0, 1, 2] }, { modules: [1] }] }, ['melodic', 'banjo', 'drone']));
  assert.equal(scene.modules.length, 2);
  assert.deepEqual(scene.sequence.parts.map((p) => p.modules), [[0, 1], []]);
  assert.ok(problems.length > 0);
});

test('validateScene omits an unusable sequence, reports it and takes scenes without one as before', () => {
  for (const bad of [5, null, [], 'x', true, { parts: 'x' }, { parts: {} }, {}]) {
    const { scene } = validateScene(seqScene(bad));
    assert.ok(!('sequence' in scene), JSON.stringify(bad));
  }
  const { problems } = validateScene(seqScene({ parts: 'x' }));
  assert.ok(problems.some((p) => /sequence/.test(p)));
  const plain = validateScene({ version: 1, effects: [], modules: [{ type: 'drone', params: {} }] });
  assert.ok(!('sequence' in plain.scene));
  assert.deepEqual(plain.problems, []);
});

test('a __proto__ key in a sequence changes nothing', () => {
  const evil = JSON.parse('{"name":"s","__proto__":{"polluted":1},"parts":[{"name":"p","duration":5,"modules":[0],"__proto__":{"x":1}}]}');
  const { scene } = validateScene(seqScene(evil));
  assert.equal(({}).polluted, undefined);
  assert.equal(scene.sequence.parts[0].x, undefined);
});

test('the sequence round-trips through serialisation and validation', () => {
  const { modules, effects } = sample();
  const seq = createSequence({ name: 'song', loop: true, parts: [{ name: 'a', duration: 12, modules: [modules[0].id, modules[2].id] }, { name: 'b', duration: 40, modules: [modules[1].id] }] }, hostOf(modules));
  const back = validateScene(JSON.parse(JSON.stringify(serializeScene({ modules, effects, sequence: seq })))).scene;
  assert.deepEqual(back.sequence, { name: 'song', loop: true, parts: [{ name: 'a', duration: 12, modules: [0, 2] }, { name: 'b', duration: 40, modules: [1] }] });
});

test('the global tempo is saved only when given', () => {
  assert.deepEqual(serializeScene({ modules: [], effects: [], tempo: { on: true, bpm: 140 } }).tempo, { on: true, bpm: 140 });
  assert.ok(!('tempo' in serializeScene({ modules: [], effects: [] })));
});

test('validateScene cleans the tempo and leaves it out when there is none', () => {
  const v = (tempo) => validateScene({ version: 1, effects: [], modules: [mod()], ...(tempo === undefined ? {} : { tempo }) }).scene;
  assert.deepEqual(v({ on: true, bpm: 5000 }).tempo, { on: true, bpm: 300 });
  assert.deepEqual(v({ on: 'yes', bpm: 'x' }).tempo, { on: false, bpm: 120 });
  assert.ok(!('tempo' in v('x')));
  assert.ok(!('tempo' in v(null)));
  assert.ok(!('tempo' in v()));
});

test('a rhythmic module saves and cleans mute and an emptied lane', () => {
  const m = createRhythmicModule({ voices: { snare: '................' }, mute: { hat: true } });
  const data = serializeModule(m);
  assert.deepEqual(data.params.mute, { kick: false, snare: false, hat: true });
  const cleaned = cleanModule(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(cleaned.params.mute, { kick: false, snare: false, hat: true });
  assert.equal(cleaned.params.voices.snare, '................');
});

test('mute from untrusted data: only true counts, missing means none', () => {
  const base = { type: 'rhythmic', name: 'r', params: {}, volume: 1, pan: 0, running: true, sends: [] };
  assert.equal(cleanModule(base).params.mute, undefined);
  assert.deepEqual(cleanModule({ ...base, params: { mute: { kick: 'true', snare: 1, hat: true } } }).params.mute, { kick: false, snare: false, hat: true });
  assert.equal(cleanModule({ ...base, params: { mute: [true] } }).params.mute, undefined);
});
