import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScene, validateScene, serializeScene, addModuleFromData, cleanModule } from '../js/scene.js';
import { createMelodicModule, createDroneModule } from '../js/module.js';

function fakeEngine({ stopped = false, failAddModule = [], failSetVolume = [], failAddEffect = [], failAddSequence = false } = {}) {
  const log = [];
  let n = 0;
  const e = {
    log, modules: [], effects: [], stopped,
    isStopped: () => e.stopped,
    playAll() { log.push('playAll'); e.stopped = false; },
    removeModule(id) { e.modules = e.modules.filter((m) => m.id !== id); log.push(`removeModule:${id}`); },
    removeEffect(id) { e.effects = e.effects.filter((f) => f.id !== id); },
    addEffect(type, params) {
      if (failAddEffect.includes(type)) throw new Error('boom');
      const fx = { id: `fx${++n}`, type, params: { ...params }, name: type };
      e.effects.push(fx);
      log.push(`addEffect:${type}`);
      return fx;
    },
    addModule(m) {
      if (failAddModule.includes(m.type)) throw new Error('boom');
      m.sends = [0, 1, 2].map(() => ({ fx: null, level: 0.3 }));
      m.volume = 1;
      m.pan = 0;
      e.modules.push(m);
      log.push(`addModule:${m.type}`);
    },
    setVolume(m, v) { if (failSetVolume.includes(m.type)) throw new Error('boom'); m.volume = v; log.push('volume'); },
    setPan(m, v) { m.pan = v; log.push('pan'); },
    setSend(m, slot, patch) { Object.assign(m.sends[slot], patch); log.push('send'); },
    toggle(m) { m.running = !m.running; log.push(`toggle:${m.type}`); },
    setRunning(m, on) { if (m.running !== on) { m.running = on; log.push(`toggle:${m.type}`); } },
    tempoCalls: [],
    setTempo(t) { e.tempoCalls.push(t); },
    sequenceData: null,
    addSequence(data) {
      if (failAddSequence) throw new Error('boom');
      e.sequenceData = data;
      log.push('addSequence');
      return { id: 'sequence', ...data };
    },
    setFxEnabled(fx, on) { fx.enabled = on; log.push(`fxEnabled:${fx.id}:${on}`); },
  };
  return e;
}

function fakeUi(engine) {
  const ui = { panels: [], fxPanels: [] };
  ui.clear = () => { engine.modules.length = 0; engine.effects.length = 0; engine.log.push('clear'); };
  ui.addFxPanel = (fx) => ui.fxPanels.push(fx);
  ui.sequencePanels = [];
  ui.addSequencePanel = (q) => ui.sequencePanels.push(q);
  ui.addModulePanel = (m) => ui.panels.push(m);
  return ui;
}

const mod = (type, extra = {}) => ({ type, name: type, params: {}, volume: 1, pan: 0, running: true, sends: [], ...extra });
const scene = (modules, effects = []) => validateScene({ version: 1, effects, modules }).scene;

test('applies in order: clear, playAll when stopped, effects, modules, then mix and sends', () => {
  const e = fakeEngine({ stopped: true });
  applyScene(e, scene([mod('melodic', { volume: 0.5, pan: 0.2, sends: [{ fx: 0, level: 0.6 }] })], [{ type: 'delay', params: {} }]), fakeUi(e));
  const at = (s) => e.log.indexOf(s);
  assert.ok(at('clear') === 0);
  assert.ok(at('clear') < at('playAll') && at('playAll') < at('addEffect:delay'));
  assert.ok(at('addEffect:delay') < at('addModule:melodic') && at('addModule:melodic') < at('volume') && at('volume') < at('send'));
});

test('does not call playAll when the transport is not stopped', () => {
  const e = fakeEngine();
  applyScene(e, scene([mod('drone')]), fakeUi(e));
  assert.equal(e.log.includes('playAll'), false);
});

test('sends map by index to the new effect ids', () => {
  const e = fakeEngine();
  applyScene(e, scene(
    [mod('melodic', { sends: [{ fx: 1, level: 0.5 }, { fx: 0, level: 0.2 }] })],
    [{ type: 'delay', params: {} }, { type: 'reverb', params: {} }],
  ), fakeUi(e));
  const [m] = e.modules;
  assert.equal(m.sends[0].fx, e.effects[1].id);
  assert.equal(m.sends[0].level, 0.5);
  assert.equal(m.sends[1].fx, e.effects[0].id);
  assert.equal(m.sends[2].fx, null);
});

test('names, mix and effect params are applied', () => {
  const e = fakeEngine();
  applyScene(e, scene([mod('melodic', { name: 'bass', volume: 0.4, pan: -0.5 })], [{ type: 'delay', name: 'echo', params: { time: 800 } }]), fakeUi(e));
  assert.equal(e.modules[0].name, 'bass');
  assert.equal(e.modules[0].volume, 0.4);
  assert.equal(e.modules[0].pan, -0.5);
  assert.equal(e.effects[0].name, 'echo');
  assert.equal(e.effects[0].params.time, 800);
});

test('module params go through setParam (clamped, patterns rebuilt)', () => {
  const e = fakeEngine();
  applyScene(e, scene([
    mod('melodic', { params: { bpm: 9999, rhythm: 'x...............' } }),
    mod('rhythmic', { params: { voices: { kick: 'x...............' } } }),
    mod('drone', { params: { rootNote: 'D2', maxExtra: 99 } }),
  ]), fakeUi(e));
  const [mel, rhy, dro] = e.modules;
  assert.equal(mel.params.bpm, 300);
  assert.deepEqual(mel.state.rhythm.current, [true, ...Array(15).fill(false)]);
  assert.deepEqual(rhy.state.voices.kick.current, [true, ...Array(15).fill(false)]);
  assert.equal(rhy.params.voices.kick, 'x...............');
  assert.equal(dro.params.rootNote, 'D2');
  assert.equal(dro.params.maxExtra, 6);
});

test('a module saved as stopped stays stopped', () => {
  const e = fakeEngine();
  applyScene(e, scene([mod('drone', { running: false }), mod('melodic')]), fakeUi(e));
  assert.equal(e.modules[0].running, false);
  assert.equal(e.modules[1].running, true);
  assert.deepEqual(e.log.filter((l) => l.startsWith('toggle')), ['toggle:drone']);
});

test('a module that fails to add is skipped and the rest still load', () => {
  const e = fakeEngine({ failAddModule: ['rhythmic'] });
  const ui = fakeUi(e);
  const { skipped } = applyScene(e, scene([mod('melodic'), mod('rhythmic'), mod('drone')]), ui);
  assert.equal(skipped.length, 1);
  assert.deepEqual(e.modules.map((m) => m.type), ['melodic', 'drone']);
  assert.deepEqual(ui.panels.map((m) => m.type), ['melodic', 'drone']);
});

test('a module that fails half-way is removed again and gets no panel', () => {
  const e = fakeEngine({ failSetVolume: ['rhythmic'] });
  const ui = fakeUi(e);
  const { skipped } = applyScene(e, scene([mod('rhythmic'), mod('drone')]), ui);
  assert.equal(skipped.length, 1);
  assert.deepEqual(e.modules.map((m) => m.type), ['drone']);
  assert.deepEqual(ui.panels.map((m) => m.type), ['drone']);
});

test('a failed effect is skipped and sends to it become none', () => {
  const e = fakeEngine({ failAddEffect: ['reverb'] });
  const { skipped } = applyScene(e, scene(
    [mod('melodic', { sends: [{ fx: 0, level: 0.5 }, { fx: 1, level: 0.5 }] })],
    [{ type: 'reverb', params: {} }, { type: 'delay', params: {} }],
  ), fakeUi(e));
  assert.equal(skipped.length, 1);
  assert.equal(e.modules[0].sends[0].fx, null);
  assert.equal(e.modules[0].sends[1].fx, e.effects[0].id);
});

test('loading twice leaves only the second scene', () => {
  const e = fakeEngine();
  const ui = fakeUi(e);
  applyScene(e, scene([mod('melodic'), mod('drone')], [{ type: 'delay', params: {} }]), ui);
  applyScene(e, scene([mod('rhythmic')], [{ type: 'reverb', params: {} }]), ui);
  assert.deepEqual(e.modules.map((m) => m.type), ['rhythmic']);
  assert.deepEqual(e.effects.map((f) => f.type), ['reverb']);
});

test('applyScene bypasses only the effects saved as disabled', () => {
  const e = fakeEngine();
  applyScene(e, scene([], [{ type: 'delay', params: {} }, { type: 'reverb', enabled: false, params: {} }]), fakeUi(e));
  assert.deepEqual(e.log.filter((l) => l.startsWith('fxEnabled')), ['fxEnabled:fx2:false']);
});

test('applyScene skips a bitcrusher the engine cannot build and still builds the rest', () => {
  const e = fakeEngine({ failAddEffect: ['bitcrusher'] });
  const { skipped } = applyScene(e, scene([mod('melodic')], [{ type: 'delay', params: {} }, { type: 'bitcrusher', params: {} }]), fakeUi(e));
  assert.deepEqual(skipped, ['effect 2 (bitcrusher)']);
  assert.deepEqual(e.effects.map((f) => f.type), ['delay']);
  assert.equal(e.modules.length, 1);
});

test('applyScene sets wave 2, mix and detune on the modules it builds', () => {
  const e = fakeEngine();
  applyScene(e, scene([mod('melodic', { params: { mix: 0.4, wave2: 'square', detune: -12 } }), mod('drone', { params: { mix: 1, wave2: 'triangle', detune: 50 } }), mod('rhythmic')]), fakeUi(e));
  const [melodic, drone, rhythmic] = e.modules;
  assert.deepEqual([melodic.params.mix, melodic.params.wave2, melodic.params.detune], [0.4, 'square', -12]);
  assert.deepEqual([drone.params.mix, drone.params.wave2, drone.params.detune], [1, 'triangle', 50]);
  assert.ok(!('mix' in rhythmic.params));
});

test('a serialized melodic and drone module round-trips its osc 2 settings through validation', () => {
  const m = createMelodicModule();
  m.setParam('mix', 0.35); m.setParam('wave2', 'triangle'); m.setParam('detune', 9);
  const d = createDroneModule();
  d.setParam('mix', 0.6); d.setParam('wave2', 'square'); d.setParam('detune', -20);
  for (const x of [m, d]) { x.sends = [0, 1, 2].map(() => ({ fx: null, level: 0.3 })); x.volume = 1; x.pan = 0; }
  const back = validateScene(JSON.parse(JSON.stringify(serializeScene({ modules: [m, d], effects: [] })))).scene;
  assert.deepEqual([back.modules[0].params.mix, back.modules[0].params.wave2, back.modules[0].params.detune], [0.35, 'triangle', 9]);
  assert.deepEqual([back.modules[1].params.mix, back.modules[1].params.wave2, back.modules[1].params.detune], [0.6, 'square', -20]);
});

test('applyScene builds the sequence after the modules, with the ids of the modules it built', () => {
  const e = fakeEngine();
  const ui = fakeUi(e);
  applyScene(e, scene([mod('melodic'), mod('rhythmic'), mod('drone')]), ui);
  assert.ok(!e.log.includes('addSequence'), 'a scene without a sequence builds none');
  const e2 = fakeEngine();
  const ui2 = fakeUi(e2);
  const withSeq = validateScene({
    version: 1, effects: [], modules: [mod('melodic'), mod('rhythmic'), mod('drone')],
    sequence: { name: 'song', loop: true, parts: [{ name: 'a', duration: 12, modules: [0, 2] }, { name: 'b', duration: 5, modules: [1] }] },
  }).scene;
  const { skipped } = applyScene(e2, withSeq, ui2);
  assert.deepEqual(skipped, []);
  const ids = e2.modules.map((m) => m.id);
  assert.deepEqual(e2.sequenceData, { name: 'song', loop: true, parts: [{ name: 'a', duration: 12, modules: [ids[0], ids[2]] }, { name: 'b', duration: 5, modules: [ids[1]] }] });
  assert.ok(e2.log.indexOf('addSequence') > e2.log.lastIndexOf('addModule:drone'), 'after the last module');
  assert.equal(e2.log.indexOf('clear'), 0, 'the old setup is cleared first');
  assert.equal(ui2.sequencePanels.length, 1);
});

test('a module that could not be built disappears from the parts, and a failing sequence is reported', () => {
  const e = fakeEngine({ failAddModule: ['rhythmic'] });
  const sc = validateScene({
    version: 1, effects: [], modules: [mod('melodic'), mod('rhythmic'), mod('drone')],
    sequence: { parts: [{ modules: [0, 1, 2] }] },
  }).scene;
  const { skipped } = applyScene(e, sc, fakeUi(e));
  assert.deepEqual(skipped, ['module 2 (rhythmic)']);
  const ids = e.modules.map((m) => m.id);
  assert.deepEqual(e.sequenceData.parts[0].modules, [ids[0], ids[1]]);
  const bad = fakeEngine({ failAddSequence: true });
  const r = applyScene(bad, validateScene({ version: 1, effects: [], modules: [mod('drone')], sequence: { parts: [] } }).scene, fakeUi(bad));
  assert.deepEqual(r.skipped, ['sequence']);
  assert.equal(bad.modules.length, 1);
});

test('addModuleFromData builds one module from cleaned data: params, name, volume, pan, sends and running', () => {
  const e = fakeEngine();
  const data = cleanModule({ type: 'drone', name: 'pad', params: { rate: 7, mix: 0.5 }, volume: 0.4, pan: -0.5, running: false, sends: [{ fx: 0, level: 0.8 }, { fx: null, level: 0.2 }, { fx: 5, level: 0.1 }] }, new Map([[0, 0]]));
  const m = addModuleFromData(e, data, { fxs: [{ id: 'fx1' }] });
  assert.equal(e.modules.length, 1);
  assert.equal(e.modules[0], m);
  assert.deepEqual([m.type, m.name, m.volume, m.pan, m.running], ['drone', 'pad', 0.4, -0.5, false]);
  assert.deepEqual([m.params.rate, m.params.mix], [7, 0.5]);
  assert.deepEqual(m.sends.map((x) => [x.fx, x.level]), [['fx1', 0.8], [null, 0.2], [null, 0.1]]);
  const plain = addModuleFromData(fakeEngine(), cleanModule({ type: 'melodic' }));
  assert.deepEqual(plain.sends.map((x) => x.fx), [null, null, null], 'without effects every send stays empty');
});

test('addModuleFromData removes a module it could not finish and throws', () => {
  const e = fakeEngine({ failSetVolume: ['drone'] });
  assert.throws(() => addModuleFromData(e, cleanModule({ type: 'drone' })));
  assert.equal(e.modules.length, 0);
  const e2 = fakeEngine({ failAddModule: ['drone'] });
  assert.throws(() => addModuleFromData(e2, cleanModule({ type: 'drone' })));
  assert.equal(e2.modules.length, 0);
});

test('addModuleFromData switches a module off with setRunning, so a module that the transport already stopped is not started', () => {
  const e = fakeEngine();
  e.addModule = (m) => { m.sends = [0, 1, 2].map(() => ({ fx: null, level: 0.3 })); m.volume = 1; m.pan = 0; m.running = false; e.modules.push(m); }; // [stop all] stopped it on registration
  const m = addModuleFromData(e, cleanModule({ type: 'drone', running: false }));
  assert.equal(m.running, false);
});

test('applyScene sets the global tempo of the scene, or off/120 when it has none', () => {
  const e = fakeEngine();
  const withTempo = validateScene({ version: 1, effects: [], modules: [mod('drone')], tempo: { on: true, bpm: 150 } }).scene;
  applyScene(e, withTempo, fakeUi(e));
  assert.deepEqual(e.tempoCalls, [{ on: true, bpm: 150 }]);
  const e2 = fakeEngine();
  applyScene(e2, scene([mod('drone')]), fakeUi(e2));
  assert.deepEqual(e2.tempoCalls, [{ on: false, bpm: 120 }]);
});
