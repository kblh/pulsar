import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, serializeScene, validateScene } from '../js/scene.js';
import { createMelodicModule, createRhythmicModule, createDroneModule } from '../js/module.js';

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
  mel.sends = [{ fx: 'fx7', level: 0.5 }, { fx: null, level: 0.3 }, { fx: 'fx3', level: 0.9 }];
  rhy.sends = [{ fx: 'fx99', level: 0.2 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }];
  dro.running = false;
  dro.sends = [0, 1, 2].map(() => ({ fx: null, level: 0.3 })); // attached modules always have three slots
  return { modules: [mel, rhy, dro], effects };
}

test('serializeScene is JSON-stable and maps sends to effect indexes', () => {
  const { modules, effects } = sample();
  const scene = serializeScene({ modules, effects });
  assert.deepEqual(scene, JSON.parse(JSON.stringify(scene)));
  assert.equal(scene.version, 1);
  assert.deepEqual(scene.effects.map((e) => e.type), ['delay', 'reverb']);
  assert.deepEqual(scene.modules.map((m) => m.type), ['melodic', 'rhythmic', 'drone']);
  assert.deepEqual(scene.modules[0].sends.map((s) => s.fx), [1, null, 0]);
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
    effects: [{ type: 'chorus', params: {} }, { type: 'delay', params: {} }],
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

test('validateScene limits sends to three and remaps indexes after dropped effects', () => {
  const { scene } = validateScene({
    version: 1,
    effects: [{ type: 'chorus', params: {} }, { type: 'delay', params: {} }, { type: 'reverb', params: {} }],
    modules: [
      mod({ sends: [{ fx: 0, level: 0.5 }, { fx: 1, level: 2 }, { fx: 2, level: 0.1 }, { fx: 2, level: 0.1 }, { fx: 2, level: 0.1 }] }),
      mod({ sends: [{ fx: 99, level: 0.5 }] }),
    ],
  });
  assert.equal(scene.effects.length, 2);
  assert.deepEqual(scene.modules[0].sends, [{ fx: null, level: 0.5 }, { fx: 0, level: 1 }, { fx: 1, level: 0.1 }]);
  assert.deepEqual(scene.modules[1].sends, [{ fx: null, level: 0.5 }, { fx: null, level: 0.3 }, { fx: null, level: 0.3 }]);
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
