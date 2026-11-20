import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScene, validateScene } from '../js/scene.js';

function fakeEngine({ stopped = false, failAddModule = [], failSetVolume = [], failAddEffect = [] } = {}) {
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
    setFxEnabled(fx, on) { fx.enabled = on; log.push(`fxEnabled:${fx.id}:${on}`); },
  };
  return e;
}

function fakeUi(engine) {
  const ui = { panels: [], fxPanels: [] };
  ui.clear = () => { engine.modules.length = 0; engine.effects.length = 0; engine.log.push('clear'); };
  ui.addFxPanel = (fx) => ui.fxPanels.push(fx);
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
